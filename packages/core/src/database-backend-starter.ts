import { mutateOwnedStage, type OwnedStage } from './staging.js'
import type { DependencyPin } from './types.js'

const files: Record<string, string> = {
  '.env.example': 'HOST=127.0.0.1\nPORT=3000\nNODE_ENV=development\nDB_FILE=data/notes.sqlite\n',
  '.gitignore': 'node_modules/\ndist/\n.env\ndata/*.sqlite\ndata/*.sqlite-*\n',
  'docs/DATABASE-SAFETY.md': `# Database path safety

BE-07 validates DB_FILE with Node lstat/realpath checks and, on Windows, the first-party helper at native/pg-db-path-verifier.exe. Windows reserved device names, including CLOCK$, and trailing-dot/space aliases are rejected. The helper is launched by absolute project-relative resource path with fixed arguments and shell disabled; SystemRoot, WINDIR, PATH, and current working directory do not select it. It checks existing path components through Windows handles opened without following the final reparse point. Missing helper, API error, timeout, malformed output, or a detected reparse point blocks the database operation.

The helper is part of generated project output, not a protected system binary. This design does not protect against someone who can replace the helper or modify project files. Hard-link aliases are not detected; a file inside the project may also be reachable through another path. Handle checks observe filesystem state during inspection; TOCTOU remains between the check and SQLite opening DB_FILE. npm lifecycle and native addon code are not sandboxed.

Generation and server startup do not open or migrate the application database. Migration requires explicit npm run db:migrate. The in-memory database option is runtime/test-only.
`,
  'tsconfig.json': `${JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      rootDir: 'src',
      outDir: 'dist',
      strict: true,
      esModuleInterop: true,
      forceConsistentCasingInFileNames: true,
      skipLibCheck: true,
    },
    include: ['src/**/*.ts'],
  }, null, 2)}\n`,
  'eslint.config.mjs': `import eslint from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist/**', 'drizzle/meta/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['**/*.ts'], languageOptions: { globals: globals.node } },
)
`,
  'drizzle.config.ts': `import { existsSync } from 'node:fs'
import { defineConfig } from 'drizzle-kit'
import { resolveDatabasePath } from './src/db/path.js'

if (existsSync('.env')) process.loadEnvFile('.env')

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: resolveDatabasePath(process.env.DB_FILE ?? 'data/notes.sqlite', process.cwd()) },
})
`,
  'src/config.ts': `export interface ServerConfig {
  host: string
  port: number
}

export function readConfig(environment: NodeJS.ProcessEnv = process.env): ServerConfig {
  const host = (environment.HOST ?? '127.0.0.1').trim()
  const rawPort = environment.PORT ?? '3000'
  const port = Number(rawPort)
  if (!host || /[\\r\\n\\0]/.test(host)) throw new Error('HOST must be a non-empty host name or IP address.')
  if (!/^\\d+$/.test(rawPort) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.')
  }
  return { host, port }
}
`,
  'src/db/schema.ts': `import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

export const notes = sqliteTable('notes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  body: text('body').notNull().default(''),
  createdAt: integer('created_at').notNull().default(sql\u0060(unixepoch())\u0060),
})
`,
  'src/db/path.ts': `import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { lstatSync, mkdirSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, parse, relative, resolve, sep, win32 } from 'node:path'

function pathError(): Error {
  return new Error('DB_FILE must be a project-relative SQLite file path with no symlink or reparse-point components.')
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

function lstatOrMissing(path: string) {
  try {
    return lstatSync(path)
  } catch (error) {
    if (isMissing(error)) return undefined
    throw pathError()
  }
}

function isWithin(root: string, candidate: string): boolean {
  const path = relative(root, candidate)
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith('..' + sep))
}

function isReservedWindowsName(segment: string): boolean {
  const stem = segment.split('.')[0]!.replace(/[ .]+$/g, '').toUpperCase()
  return /^(CON|PRN|AUX|NUL|CONIN\\$|CONOUT\\$|CLOCK\\$|COM[1-9¹²³]|LPT[1-9¹²³])$/.test(stem)
}

function assertDirectory(path: string, rootReal: string, checked: string[]): void {
  const info = lstatOrMissing(path)
  if (!info || info.isSymbolicLink() || !info.isDirectory()) throw pathError()
  const physicalPath = realpathSync(path)
  if (!isWithin(rootReal, physicalPath)) throw pathError()
  checked.push(path)
}

export type VerifierRunner = typeof spawnSync

export function verifyWindowsReparsePoints(
  projectRoot: string,
  databasePath: string,
  run: VerifierRunner = spawnSync,
): void {
  if (process.platform !== 'win32') return
  const root = win32.resolve(projectRoot)
  const file = win32.resolve(databasePath)
  const helper = fileURLToPath(new URL('../../native/pg-db-path-verifier.exe', import.meta.url))
  let result: ReturnType<VerifierRunner>
  try {
    result = run(helper, ['--verify'], {
      cwd: root,
      input: JSON.stringify({ protocolVersion: 1, projectRoot: root, databasePath: file }) + '\\n',
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000,
      maxBuffer: 64 * 1024,
      shell: false,
    })
  } catch {
    throw pathError()
  }
  if (result.error || result.signal !== null || result.status !== 0
    || typeof result.stdout !== 'string' || result.stderr !== '') throw pathError()
  let response: unknown
  try {
    response = JSON.parse(result.stdout)
  } catch {
    throw pathError()
  }
  if (typeof response !== 'object' || response === null || Array.isArray(response)
    || Object.keys(response).sort().join(',') !== 'ok,protocolVersion,result'
    || (response as { protocolVersion?: unknown }).protocolVersion !== 1
    || (response as { ok?: unknown }).ok !== true
    || (response as { result?: unknown }).result !== 'clear') throw pathError()
}

function assertWindowsNoReparsePoints(projectRoot: string, databasePath: string, run: VerifierRunner): void {
  verifyWindowsReparsePoints(projectRoot, databasePath, run)
}

function projectRootPath(projectRoot: string, checked: string[]): { root: string; rootReal: string } {
  const root = resolve(projectRoot)
  const volumeRoot = parse(root).root
  if (!volumeRoot) throw pathError()
  let current = volumeRoot
  assertDirectory(current, current, checked)
  for (const segment of relative(volumeRoot, root).split(sep).filter(Boolean)) {
    current = join(current, segment)
    const info = lstatOrMissing(current)
    if (!info || info.isSymbolicLink() || !info.isDirectory()) throw pathError()
    checked.push(current)
  }
  const rootReal = realpathSync(root)
  return { root, rootReal }
}

function assertSafeExistingPath(filePath: string, root: string, rootReal: string, checked: string[]): void {
  const parent = dirname(filePath)
  const parentRelative = relative(root, parent)
  let current = root
  for (const segment of parentRelative.split(sep).filter(Boolean)) {
    current = join(current, segment)
    const info = lstatOrMissing(current)
    if (!info) return
    if (info.isSymbolicLink() || !info.isDirectory()) throw pathError()
    const physicalPath = realpathSync(current)
    if (!isWithin(rootReal, physicalPath)) throw pathError()
    checked.push(current)
  }
  const fileInfo = lstatOrMissing(filePath)
  if (!fileInfo) return
  if (fileInfo.isSymbolicLink() || !fileInfo.isFile()) throw pathError()
  const physicalPath = realpathSync(filePath)
  if (!isWithin(rootReal, physicalPath)) throw pathError()
  checked.push(filePath)
}

export function resolveDatabasePath(fileName: string, projectRoot: string, run: VerifierRunner = spawnSync): string {
  if (fileName === ':memory:') {
    throw pathError()
  }
  if (typeof fileName !== 'string' || !fileName.trim() || /[\\0\\r\\n:]/.test(fileName)
    || isAbsolute(fileName) || win32.isAbsolute(fileName)) throw pathError()
  const segments = fileName.split(/[\\\\/]/)
  if (segments.some((segment) => !segment || segment === '.' || segment === '..'
    || (process.platform === 'win32' && (/[ .]$/.test(segment) || isReservedWindowsName(segment))))) throw pathError()
  const checked: string[] = []
  const { root, rootReal } = projectRootPath(projectRoot, checked)
  const filePath = resolve(root, ...segments)
  const relativePath = relative(root, filePath)
  if (!relativePath || isAbsolute(relativePath) || relativePath === '..' || relativePath.startsWith('..' + sep)) throw pathError()
  assertSafeExistingPath(filePath, root, rootReal, checked)
  assertWindowsNoReparsePoints(root, filePath, run)
  return filePath
}

export function createDatabaseDirectories(fileName: string, projectRoot: string, run: VerifierRunner = spawnSync): string {
  const filePath = resolveDatabasePath(fileName, projectRoot, run)
  const root = resolve(projectRoot)
  const parent = dirname(filePath)
  const segments = relative(root, parent).split(sep).filter(Boolean)
  let current = root
  const rootReal = realpathSync(root)
  for (const segment of segments) {
    current = join(current, segment)
    let info = lstatOrMissing(current)
    if (!info) {
      try {
        mkdirSync(current)
      } catch (error) {
        if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 'EEXIST') throw pathError()
      }
      info = lstatOrMissing(current)
    }
    if (!info || info.isSymbolicLink() || !info.isDirectory() || !isWithin(rootReal, realpathSync(current))) throw pathError()
  }
  return resolveDatabasePath(fileName, projectRoot, run)
}
`,
  'src/db/client.ts': `import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { createDatabaseDirectories, type VerifierRunner } from './path.js'
import * as schema from './schema.js'

export function openDatabase(fileName = process.env.DB_FILE ?? 'data/notes.sqlite', projectRoot = process.cwd(), verifierRunner?: VerifierRunner) {
  const filePath = fileName === ':memory:' ? fileName : createDatabaseDirectories(fileName, projectRoot, verifierRunner)
  const sqlite = new Database(filePath)
  try {
    sqlite.pragma('foreign_keys = ON')
    return { db: drizzle(sqlite, { schema }), close: () => sqlite.close(), filePath }
  } catch (error) {
    try { sqlite.close() } catch { /* Preserve the initialization error. */ }
    throw error
  }
}

type Database = ReturnType<typeof openDatabase>['db']

export function createLazyDatabase(fileName?: string, projectRoot = process.cwd()) {
  let opened: ReturnType<typeof openDatabase> | undefined
  const open = () => opened ??= openDatabase(fileName, projectRoot)
  const db = new Proxy({} as Database, {
    get(_target, property) {
      const instance = open().db
      const value = Reflect.get(instance, property, instance) as unknown
      return typeof value === 'function' ? value.bind(instance) : value
    },
  })
  return { db, close: () => opened?.close() }
}
`,
  'src/db/migrate.ts': `import Database from 'better-sqlite3'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { createDatabaseDirectories } from './path.js'
import * as schema from './schema.js'

if (existsSync('.env')) process.loadEnvFile('.env')

const filePath = createDatabaseDirectories(process.env.DB_FILE ?? 'data/notes.sqlite', process.cwd())
const sqlite = new Database(filePath)
try {
  migrate(drizzle(sqlite, { schema }), { migrationsFolder: resolve('drizzle') })
} finally {
  sqlite.close()
}
`,
  'src/db/notes.ts': `import { eq } from 'drizzle-orm'
import type { openDatabase } from './client.js'
import { notes } from './schema.js'

type Database = ReturnType<typeof openDatabase>['db']
export type NoteInput = { title: string; body: string }

export function listNotes(db: Database) {
  return db.select().from(notes).all()
}

export function findNote(db: Database, id: number) {
  return db.select().from(notes).where(eq(notes.id, id)).get()
}

export function createNote(db: Database, input: NoteInput) {
  return db.insert(notes).values(input).returning().get()
}

export function updateNote(db: Database, id: number, input: Partial<NoteInput>) {
  return db.update(notes).set(input).where(eq(notes.id, id)).returning().get()
}

export function deleteNote(db: Database, id: number) {
  return db.delete(notes).where(eq(notes.id, id)).returning().get()
}
`,
  'src/routes/notes.ts': `import { Router } from 'express'
import { createNote, deleteNote, findNote, listNotes, updateNote, type NoteInput } from '../db/notes.js'
import type { openDatabase } from '../db/client.js'

type Database = ReturnType<typeof openDatabase>['db']

function noteId(raw: string): number | undefined {
  if (!/^[1-9]\\d*$/.test(raw)) return undefined
  const value = Number(raw)
  return Number.isSafeInteger(value) ? value : undefined
}

function validInput(value: unknown, partial = false): Partial<NoteInput> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const input = value as Record<string, unknown>
  if (Object.keys(input).some((key) => !['title', 'body'].includes(key))) return undefined
  if (!partial || Object.hasOwn(input, 'title')) {
    if (typeof input.title !== 'string' || !input.title.trim() || input.title.trim().length > 120) return undefined
  }
  if (Object.hasOwn(input, 'body') && (typeof input.body !== 'string' || input.body.length > 4000)) return undefined
  if (partial && Object.keys(input).length === 0) return undefined
  return {
    ...(typeof input.title === 'string' ? { title: input.title.trim() } : {}),
    ...(typeof input.body === 'string' ? { body: input.body } : {}),
  }
}

export function createNotesRouter(db: Database) {
  const router = Router()
  router.get('/', (_request, response) => response.json({ data: listNotes(db) }))
  router.get('/:id', (request, response) => {
    const id = noteId(request.params.id ?? '')
    if (!id) return response.status(400).json({ error: { code: 'INVALID_ID', message: 'Note ID must be a positive integer.' } })
    const note = findNote(db, id)
    if (!note) return response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Note not found.' } })
    return response.json({ data: note })
  })
  router.post('/', (request, response) => {
    const input = validInput(request.body)
    if (!input || typeof input.title !== 'string') return response.status(400).json({ error: { code: 'INVALID_NOTE', message: 'Provide a title (1–120 characters) and optional body (up to 4000 characters).' } })
    return response.status(201).json({ data: createNote(db, { title: input.title, body: typeof input.body === 'string' ? input.body : '' }) })
  })
  router.patch('/:id', (request, response) => {
    const id = noteId(request.params.id ?? '')
    const input = validInput(request.body, true)
    if (!id) return response.status(400).json({ error: { code: 'INVALID_ID', message: 'Note ID must be a positive integer.' } })
    if (!input) return response.status(400).json({ error: { code: 'INVALID_NOTE', message: 'Provide a valid title or body update.' } })
    const note = updateNote(db, id, input)
    if (!note) return response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Note not found.' } })
    return response.json({ data: note })
  })
  router.delete('/:id', (request, response) => {
    const id = noteId(request.params.id ?? '')
    if (!id) return response.status(400).json({ error: { code: 'INVALID_ID', message: 'Note ID must be a positive integer.' } })
    const note = deleteNote(db, id)
    if (!note) return response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Note not found.' } })
    return response.json({ data: note })
  })
  return router
}
`,
  'src/app.ts': `import express, { type ErrorRequestHandler } from 'express'
import type { openDatabase } from './db/client.js'
import { createNotesRouter } from './routes/notes.js'

type Database = ReturnType<typeof openDatabase>['db']

export function createApp(db: Database) {
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: '1mb' }))
  app.get('/health', (_request, response) => response.status(200).json({ status: 'ok' }))
  app.get('/api/info', (_request, response) => response.status(200).json({
    name: 'BE-07 Express SQLite API',
    version: '0.1.0',
    environment: process.env.NODE_ENV ?? 'development',
  }))
  app.use('/api/notes', createNotesRouter(db))
  app.use((_request, response) => response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found.' } }))
  const handleError: ErrorRequestHandler = (error: unknown, _request, response, next) => {
    if (response.headersSent) return next(error)
    const status = typeof error === 'object' && error !== null && 'status' in error
      && typeof error.status === 'number' && error.status >= 400 && error.status <= 599 ? error.status : 500
    response.status(status).json({ error: { code: status < 500 ? 'INVALID_REQUEST' : 'INTERNAL_ERROR', message: status < 500 ? 'Request could not be processed.' : 'Internal server error.' } })
  }
  app.use(handleError)
  return app
}
`,
  'src/server.ts': `import { existsSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createApp } from './app.js'
import { readConfig, type ServerConfig } from './config.js'
import { createLazyDatabase } from './db/client.js'

export async function startServer(config: ServerConfig = readConfig(), dbFile?: string, databaseRoot = process.cwd()): Promise<{ server: Server; shutdown: () => Promise<void> }> {
  const database = createLazyDatabase(dbFile, databaseRoot)
  const server = createServer(createApp(database.db))
  try {
    await new Promise<void>((resolveListen, reject) => {
      server.once('error', reject)
      server.listen(config.port, config.host, () => {
        server.off('error', reject)
        resolveListen()
      })
    })
  } catch (error) {
    database.close()
    throw error
  }
  let shutdownPromise: Promise<void> | undefined
  return {
    server,
    shutdown: () => shutdownPromise ??= new Promise<void>((resolveClose, reject) => {
      server.close((error) => {
        database.close()
        if (error) reject(error)
        else resolveClose()
      })
      server.closeIdleConnections()
    }),
  }
}

export function registerShutdownHandlers(running: { shutdown: () => Promise<void> }): () => void {
  let stopping = false
  const shutdown = () => {
    if (stopping) return
    stopping = true
    void running.shutdown().then(() => console.log('Server stopped.'), (error: unknown) => {
      console.error('Graceful shutdown failed.', error)
      process.exitCode = 1
    })
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
  return () => {
    process.removeListener('SIGINT', shutdown)
    process.removeListener('SIGTERM', shutdown)
  }
}

async function main(): Promise<void> {
  if (existsSync('.env')) process.loadEnvFile('.env')
  const running = await startServer()
  const address = running.server.address()
  console.log('Listening on ' + (typeof address === 'object' && address ? address.address + ':' + address.port : 'configured address'))
  registerShutdownHandlers(running)
}

const entry = process.argv[1]
if (entry && import.meta.url === pathToFileURL(resolve(entry)).href) {
  void main().catch((error: unknown) => {
    console.error('Server startup failed.', error)
    process.exitCode = 1
  })
}
`,
  'test/backend.test.ts': `import assert from 'node:assert/strict'
import test from 'node:test'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readConfig } from '../src/config.js'
import { startServer } from '../src/server.js'

test('startup and health stay database-free; first CRUD query opens an unmigrated database', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'formaforge-be07-http-'))
  const running = await startServer({ host: '127.0.0.1', port: 0 }, 'data/http.sqlite', directory)
  const address = running.server.address()
  assert.ok(address && typeof address === 'object')
  const base = 'http://127.0.0.1:' + address.port
  try {
    const health = await fetch(base + '/health')
    assert.equal(health.status, 200)
    assert.deepEqual(await health.json(), { status: 'ok' })
    const info = await fetch(base + '/api/info')
    assert.deepEqual(await info.json(), { name: 'BE-07 Express SQLite API', version: '0.1.0', environment: process.env.NODE_ENV ?? 'development' })
    const missing = await fetch(base + '/missing')
    assert.equal(missing.status, 404)
    assert.deepEqual(await missing.json(), { error: { code: 'NOT_FOUND', message: 'Route not found.' } })
    const malformed = await fetch(base + '/health', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' })
    assert.equal(malformed.status, 400)
    assert.deepEqual(await malformed.json(), { error: { code: 'INVALID_REQUEST', message: 'Request could not be processed.' } })
    await assert.rejects(access(join(directory, 'data')), { code: 'ENOENT' })
    const notes = await fetch(base + '/api/notes')
    assert.equal(notes.status, 500)
    await access(join(directory, 'data', 'http.sqlite'))
    const sqlite = new (await import('better-sqlite3')).default(join(directory, 'data', 'http.sqlite'), { readonly: true })
    try {
      assert.deepEqual(sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all(), [])
    } finally {
      sqlite.close()
    }
  } finally {
    await running.shutdown()
    await rm(directory, { recursive: true, force: true })
  }
})

test('environment configuration rejects invalid host and port', () => {
  assert.throws(() => readConfig({ PORT: 'not-a-port' }), /PORT must be an integer/)
  assert.throws(() => readConfig({ PORT: '65536' }), /PORT must be an integer/)
  assert.throws(() => readConfig({ HOST: 'bad\\nhost' }), /HOST must be/)
})
`,
  'test/database.test.ts': `import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { access, copyFile, mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import Database from 'better-sqlite3'
import { join, win32 } from 'node:path'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { createApp } from '../src/app.js'
import { createLazyDatabase, openDatabase } from '../src/db/client.js'
import { createDatabaseDirectories, resolveDatabasePath, verifyWindowsReparsePoints } from '../src/db/path.js'

test('isolated SQLite migration supports note create/read/update/delete API', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'formaforge-be07-crud-'))
  assert.throws(() => openDatabase('../outside.sqlite', directory), /project-relative/)
  assert.throws(() => openDatabase(join(directory, 'outside.sqlite'), directory), /project-relative/)
  assert.throws(() => resolveDatabasePath(':memory:', directory), /project-relative/)
  const memory = openDatabase(':memory:', directory)
  assert.equal(memory.filePath, ':memory:')
  memory.close()
  const database = openDatabase('crud.sqlite', directory)
  migrate(database.db, { migrationsFolder: join(process.cwd(), 'drizzle') })
  const server = createServer(createApp(database.db))
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const base = 'http://127.0.0.1:' + address.port + '/api/notes'
  try {
    const created = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'First note', body: 'Initial body' }) })
    assert.equal(created.status, 201)
    const row = (await created.json() as { data: { id: number; title: string; body: string } }).data
    assert.equal(row.title, 'First note')
    assert.equal(row.body, 'Initial body')
    assert.equal((await (await fetch(base)).json() as { data: unknown[] }).data.length, 1)
    assert.equal((await (await fetch(base + '/' + row.id)).json() as { data: { title: string } }).data.title, 'First note')
    const updated = await fetch(base + '/' + row.id, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Updated note' }) })
    assert.equal((await updated.json() as { data: { title: string } }).data.title, 'Updated note')
    assert.equal((await fetch(base + '/' + row.id, { method: 'DELETE' })).status, 200)
    assert.equal((await fetch(base + '/' + row.id)).status, 404)
    assert.equal((await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: '' }) })).status, 400)
  } finally {
    await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()))
    database.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('database initialization failure closes handle, preserves cause, and permits retry', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'formaforge-be07-init-failure-'))
  const prototype = Database.prototype as unknown as {
    pragma: (...args: unknown[]) => unknown
    close: (...args: unknown[]) => unknown
  }
  const originalPragma = prototype.pragma
  const originalClose = prototype.close
  const initializationError = new Error('injected pragma failure')
  const cleanupError = new Error('injected cleanup failure')
  let failNextPragma = true
  let closeCalls = 0
  prototype.pragma = function (this: unknown, ...args: unknown[]) {
    if (failNextPragma) {
      failNextPragma = false
      throw initializationError
    }
    return originalPragma.apply(this, args)
  }
  prototype.close = function (this: unknown, ...args: unknown[]) {
    closeCalls += 1
    const result = originalClose.apply(this, args)
    if (closeCalls === 1) throw cleanupError
    return result
  }
  const lazy = createLazyDatabase('retry.sqlite', directory)
  try {
    assert.throws(() => lazy.db.select, (error: unknown) => error === initializationError)
    assert.equal(closeCalls, 1)
    assert.equal(typeof lazy.db.select, 'function')
    lazy.close()
    assert.equal(closeCalls, 2)
  } finally {
    prototype.pragma = originalPragma
    prototype.close = originalClose
    await rm(directory, { recursive: true, force: true })
  }
})

test('native verifier uses project-local helper and ignores fake Windows-root environment', async (t) => {
  if (process.platform !== 'win32') { t.skip('Windows native verifier test.'); return }
  const directory = await mkdtemp(join(tmpdir(), 'formaforge-be07-native-guard-'))
  const project = join(directory, 'project')
  const fakeRoot = join(directory, 'fake-windows')
  const sentinel = join(fakeRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  await mkdir(project)
  await mkdir(join(fakeRoot, 'System32', 'WindowsPowerShell', 'v1.0'), { recursive: true })
  await copyFile(join(process.cwd(), 'native', 'pg-db-path-verifier.exe'), sentinel)
  const databasePath = join(project, 'nested', 'notes-雪.sqlite')
  const previousSystemRoot = process.env.SystemRoot
  const previousWinDir = process.env.WINDIR
  try {
    process.env.SystemRoot = fakeRoot
    process.env.WINDIR = fakeRoot
    assert.equal(verifyWindowsReparsePoints(project, databasePath), undefined)
    assert.equal((await (await import('node:fs/promises')).stat(sentinel)).isFile(), true)
    await assert.rejects(access(databasePath), { code: 'ENOENT' })

    let invocation: { command: string; args: readonly string[]; options: Record<string, unknown> } | undefined
    const success = { error: undefined, status: 0, signal: null, stdout: JSON.stringify({ protocolVersion: 1, ok: true, result: 'clear' }), stderr: '', output: [], pid: 1 }
    const successfulSpawn = ((command: string, args: readonly string[], options: Record<string, unknown>) => {
      invocation = { command, args, options }
      return success
    }) as unknown as typeof spawnSync
    verifyWindowsReparsePoints(project, databasePath, successfulSpawn)
    assert.ok(invocation)
    assert.equal(invocation.command, join(process.cwd(), 'native', 'pg-db-path-verifier.exe'))
    assert.deepEqual(invocation.args, ['--verify'])
    assert.equal(invocation.options.shell, false)
    assert.equal(invocation.options.env, undefined)
    const request = JSON.parse(String(invocation.options.input))
    assert.deepEqual(request, { protocolVersion: 1, projectRoot: project, databasePath })
  } finally {
    if (previousSystemRoot === undefined) delete process.env.SystemRoot
    else process.env.SystemRoot = previousSystemRoot
    if (previousWinDir === undefined) delete process.env.WINDIR
    else process.env.WINDIR = previousWinDir
    await rm(directory, { recursive: true, force: true })
  }
})

test('native verifier and protocol failures fail closed before SQLite opens', async (t) => {
  if (process.platform !== 'win32') { t.skip('Windows native verifier test.'); return }
  const directory = await mkdtemp(join(tmpdir(), 'formaforge-be07-guard-failures-'))
  const project = join(directory, 'project')
  await mkdir(project)
  const success = JSON.stringify({ protocolVersion: 1, ok: true, result: 'clear' })
  const failure = JSON.stringify({ protocolVersion: 1, ok: false, code: 'filesystem_error' })
  const cases = [
    ['helper missing', { error: Object.assign(new Error('missing'), { code: 'ENOENT' }), status: null, signal: null, stdout: '', stderr: '' }],
    ['helper cannot execute', { error: Object.assign(new Error('denied'), { code: 'EACCES' }), status: null, signal: null, stdout: '', stderr: '' }],
    ['timeout', { error: Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }), status: null, signal: 'SIGTERM', stdout: '', stderr: '' }],
    ['nonzero exit', { error: undefined, status: 1, signal: null, stdout: failure, stderr: '' }],
    ['crash', { error: undefined, status: null, signal: null, stdout: '', stderr: '' }],
    ['malformed output', { error: undefined, status: 0, signal: null, stdout: '{', stderr: '' }],
    ['protocol mismatch', { error: undefined, status: 0, signal: null, stdout: JSON.stringify({ protocolVersion: 2, ok: true, result: 'clear' }), stderr: '' }],
    ['API failure', { error: undefined, status: 1, signal: null, stdout: failure, stderr: '' }],
    ['unexpected stderr', { error: undefined, status: 0, signal: null, stdout: success, stderr: 'diagnostic' }],
  ] as const
  try {
    for (const [label, result] of cases) {
      const databasePath = join(project, label.replaceAll(' ', '-') + '.sqlite')
      let calls = 0
      const runner = (() => { calls += 1; return { ...result, output: [], pid: 1 } }) as unknown as typeof spawnSync
      assert.throws(() => openDatabase(databasePath.slice(project.length + 1), project, runner), /project-relative/, label)
      assert.equal(calls, 1, label)
      await assert.rejects(access(databasePath), { code: 'ENOENT' }, label)
    }

    const helper = join(process.cwd(), 'native', 'pg-db-path-verifier.exe')
    const held = helper + '.held'
    await rename(helper, held)
    try {
      const databasePath = join(project, 'missing-helper.sqlite')
      assert.throws(() => openDatabase('missing-helper.sqlite', project), /project-relative/)
      await assert.rejects(access(databasePath), { code: 'ENOENT' })
    } finally {
      await rename(held, helper)
    }

    const directoryDatabase = join(project, 'database-is-directory')
    await mkdir(directoryDatabase)
    assert.throws(() => verifyWindowsReparsePoints(project, directoryDatabase), /project-relative/)
    await assert.rejects(access(join(project, 'database-is-directory.sqlite')), { code: 'ENOENT' })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('native handle walk accepts normal and not-yet-created database paths', async (t) => {
  if (process.platform !== 'win32') { t.skip('Windows native verifier test.'); return }
  const directory = await mkdtemp(join(tmpdir(), 'formaforge-be07-native-paths-'))
  const project = join(directory, 'project')
  await mkdir(project)
  try {
    await mkdir(join(project, 'nested'))
    await writeFile(join(project, 'nested', 'notes.sqlite'), '')
    assert.equal(verifyWindowsReparsePoints(project, join(project, 'nested', 'notes.sqlite')), undefined)
    const missing = join(project, 'not-created', 'notes.sqlite')
    assert.equal(verifyWindowsReparsePoints(project, missing), undefined)
    await assert.rejects(access(join(project, 'not-created')), { code: 'ENOENT' })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('native handle walk rejects project root and parent directory junctions', async (t) => {
  if (process.platform !== 'win32') { t.skip('Windows native verifier test.'); return }
  const parent = await mkdtemp(join(tmpdir(), 'formaforge-be07-native-junction-'))
  const project = join(parent, 'project')
  const outside = join(parent, 'outside')
  const rootJunction = join(parent, 'project-root-junction')
  await mkdir(project)
  await mkdir(outside)
  try {
    await symlink(project, rootJunction, 'junction')
    assert.throws(() => verifyWindowsReparsePoints(rootJunction, join(rootJunction, 'notes.sqlite')), /project-relative/)
    const parentJunction = join(project, 'linked-data')
    await symlink(outside, parentJunction, 'junction')
    assert.throws(() => verifyWindowsReparsePoints(project, join(parentJunction, 'escape.sqlite')), /project-relative/)
    await assert.rejects(access(join(outside, 'escape.sqlite')), { code: 'ENOENT' })
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})

test('native handle walk rejects an existing reparse-point database file', async (t) => {
  if (process.platform !== 'win32') { t.skip('Windows native verifier test.'); return }
  const parent = await mkdtemp(join(tmpdir(), 'formaforge-be07-native-file-link-'))
  const project = join(parent, 'project')
  const outsideFile = join(parent, 'outside.sqlite')
  await mkdir(project)
  await writeFile(outsideFile, '')
  try {
    const fileLink = join(project, 'linked.sqlite')
    try {
      await symlink(outsideFile, fileLink, 'file')
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && ['EPERM', 'EACCES', 'UNKNOWN'].includes(String(error.code))) {
        t.skip('Windows file-symlink creation is unavailable without changing machine settings.')
        return
      }
      throw error
    }
    assert.throws(() => verifyWindowsReparsePoints(project, fileLink), /project-relative/)
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})

test('DB_FILE safely creates missing local directories and rejects symlink/junction escapes', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'formaforge-be07-path-'))
  const project = join(parent, 'project')
  const outside = join(parent, 'outside')
  await mkdir(project)
  await mkdir(outside)
  try {
    const nested = openDatabase('new/deep/notes.sqlite', project)
    nested.close()
    assert.equal(resolveDatabasePath('new/deep/notes.sqlite', project), join(project, 'new', 'deep', 'notes.sqlite'))
    assert.throws(() => openDatabase('../outside/escape.sqlite', project), /project-relative/)
    assert.throws(() => openDatabase(join(outside, 'absolute.sqlite'), project), /project-relative/)

    const dataLink = join(project, 'linked-data')
    await symlink(outside, dataLink, process.platform === 'win32' ? 'junction' : 'dir')
    assert.throws(() => openDatabase('linked-data/escape.sqlite', project), /project-relative/)
    await assert.rejects(access(join(outside, 'escape.sqlite')), { code: 'ENOENT' })

    const rootLink = join(parent, 'project-link')
    await symlink(project, rootLink, process.platform === 'win32' ? 'junction' : 'dir')
    assert.throws(() => openDatabase('inside.sqlite', rootLink), /project-relative/)
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})

test('DB_FILE accepts in-project spaces and rejects Windows absolute, traversal, and normalized aliases', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'formaforge-be07-path-vectors-'))
  const project = join(parent, 'project')
  await mkdir(project)
  const backslash = String.fromCharCode(92)
  const driveAbsolute = win32.join(win32.parse(project).root, 'outside.sqlite')
  const invalid = [
    driveAbsolute,
    backslash + backslash + 'server' + backslash + 'share' + backslash + 'outside.sqlite',
    backslash + backslash + '?' + backslash + 'C:' + backslash + 'outside.sqlite',
    backslash + backslash + '?' + backslash + 'UNC' + backslash + 'server' + backslash + 'share' + backslash + 'outside.sqlite',
    '..' + backslash + 'outside.sqlite',
    'nested' + backslash + '..' + backslash + '..' + backslash + 'outside.sqlite',
    'nested/..' + backslash + '..' + backslash + 'outside.sqlite',
    'folder' + backslash + '.. ' + backslash + 'outside.sqlite',
    'folder.' + backslash + 'outside.sqlite',
    'notes.sqlite ',
    'notes.sqlite.',
    'NUL',
    'CON.txt',
    'CLOCK$',
  ]
  try {
    const valid = 'folder with space' + backslash + 'notes file.sqlite'
    assert.equal(resolveDatabasePath(valid, project), join(project, 'folder with space', 'notes file.sqlite'))
    for (const fileName of invalid) {
      assert.throws(() => resolveDatabasePath(fileName, project), /project-relative/, fileName)
      assert.throws(() => createDatabaseDirectories(fileName, project), /project-relative/, fileName)
    }
    assert.throws(() => resolveDatabasePath(':memory:', project), /project-relative/)
    assert.throws(() => createDatabaseDirectories(':memory:', project), /project-relative/)
    const memory = openDatabase(':memory:', project)
    assert.equal(memory.filePath, ':memory:')
    memory.close()
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})

test('DB_FILE rejects a symlink database file', async (t) => {
  const parent = await mkdtemp(join(tmpdir(), 'formaforge-be07-file-link-'))
  const project = join(parent, 'project')
  const outsideFile = join(parent, 'outside.sqlite')
  await mkdir(project)
  await writeFile(outsideFile, '')
  try {
    const fileLink = join(project, 'linked.sqlite')
    try {
      await symlink(outsideFile, fileLink, 'file')
    } catch (error) {
      if (process.platform === 'win32' && typeof error === 'object' && error !== null && 'code' in error && ['EPERM', 'EACCES', 'UNKNOWN'].includes(String(error.code))) {
        t.skip('Windows file-symlink creation is unavailable without changing machine settings.')
        return
      }
      throw error
    }
    assert.throws(() => openDatabase('linked.sqlite', project), /project-relative/)
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})
`,
  'test/shutdown.test.ts': `import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerShutdownHandlers, startServer } from '../src/server.js'

test('graceful shutdown closes listener and lazily opened database handle', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'formaforge-be07-shutdown-'))
  const running = await startServer({ host: '127.0.0.1', port: 0 }, 'data/shutdown.sqlite', directory)
  const closed = new Promise<void>((resolveClose) => running.server.once('close', resolveClose))
  const removeHandlers = registerShutdownHandlers(running)
  try {
    assert.equal(running.server.listening, true)
    const address = running.server.address()
    assert.ok(address && typeof address === 'object')
    assert.equal((await fetch('http://127.0.0.1:' + address.port + '/api/notes')).status, 500)
    process.emit('SIGTERM')
    process.emit('SIGINT')
    await closed
    assert.equal(running.server.listening, false)
  } finally {
    removeHandlers()
    await running.shutdown()
    await rm(directory, { recursive: true, force: true })
  }
})
`,
}

export async function writeDatabaseBackendStarter(stage: OwnedStage, projectName: string, dependencies: readonly DependencyPin[]): Promise<string[]> {
  const runtime = Object.fromEntries(dependencies.filter((pin) => (pin.scope ?? 'dependencies') === 'dependencies').map(({ packageName, version }) => [packageName, version]))
  const development = Object.fromEntries(dependencies.filter((pin) => pin.scope === 'devDependencies').map(({ packageName, version }) => [packageName, version]))
  const packageJson = {
    name: projectName,
    version: '0.1.0',
    private: true,
    type: 'module',
    engines: { node: '>=22.13.0' },
    scripts: {
      dev: 'node --import tsx --watch src/server.ts',
      build: 'tsc --project tsconfig.json',
      start: 'node dist/server.js',
      test: 'node --import tsx --test test/backend.test.ts test/database.test.ts test/shutdown.test.ts',
      typecheck: 'tsc --project tsconfig.json --noEmit',
      lint: 'eslint src test',
      'db:generate': 'drizzle-kit generate',
      'db:migrate': 'node --import tsx src/db/migrate.ts',
    },
    dependencies: runtime,
    devDependencies: development,
  }
  const prefix = `${projectName}/`
  const writes = await mutateOwnedStage(stage, [
    `${prefix}src/db`, `${prefix}src/routes`, `${prefix}test`, `${prefix}docs`,
    ...(process.platform === 'win32' ? [`${prefix}native`] : []),
  ], [
    { path: `${prefix}package.json`, content: `${JSON.stringify(packageJson, null, 2)}\n` },
    ...Object.entries(files).map(([path, content]) => ({ path: `${prefix}${path}`, content })),
  ], process.platform === 'win32')
  return writes.map((path) => path.slice(prefix.length))
}
