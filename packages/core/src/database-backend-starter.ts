import { mutateOwnedStage, type OwnedStage } from './staging.js'
import type { DependencyPin } from './types.js'

const files: Record<string, string> = {
  '.env.example': 'HOST=127.0.0.1\nPORT=3000\nNODE_ENV=development\nDB_FILE=data/notes.sqlite\n',
  '.gitignore': 'node_modules/\ndist/\n.env\ndata/*.sqlite\ndata/*.sqlite-*\n',
  'data/.gitkeep': '',
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

if (existsSync('.env')) process.loadEnvFile('.env')

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DB_FILE ?? 'data/notes.sqlite' },
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
  'src/db/client.ts': `import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema.js'

export function openDatabase(fileName = process.env.DB_FILE ?? 'data/notes.sqlite', projectRoot = process.cwd()) {
  if (!fileName.trim() || /[\\0\\r\\n]/.test(fileName)) throw new Error('DB_FILE must be a non-empty local file path.')
  const root = resolve(projectRoot)
  const filePath = fileName === ':memory:' ? fileName : resolve(root, fileName)
  if (fileName !== ':memory:') {
    const relativePath = relative(root, filePath)
    if (isAbsolute(fileName) || !relativePath || relativePath === '..' || relativePath.startsWith('..' + sep) || isAbsolute(relativePath)) {
      throw new Error('DB_FILE must stay inside the project directory.')
    }
    mkdirSync(dirname(filePath), { recursive: true })
  }
  const sqlite = new Database(filePath)
  sqlite.pragma('foreign_keys = ON')
  return { db: drizzle(sqlite, { schema }), close: () => sqlite.close(), filePath }
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
import { openDatabase } from './db/client.js'

export async function startServer(config: ServerConfig = readConfig(), dbFile?: string, databaseRoot = process.cwd()): Promise<{ server: Server; shutdown: () => Promise<void> }> {
  const database = openDatabase(dbFile, databaseRoot)
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
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readConfig } from '../src/config.js'
import { startServer } from '../src/server.js'

test('health/info and JSON 404/malformed request responses work without applying migrations', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'formaforge-be07-http-'))
  const running = await startServer({ host: '127.0.0.1', port: 0 }, 'http.sqlite', directory)
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
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { createApp } from '../src/app.js'
import { openDatabase } from '../src/db/client.js'

test('isolated SQLite migration supports note create/read/update/delete API', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'formaforge-be07-crud-'))
  assert.throws(() => openDatabase('../outside.sqlite', directory), /inside the project directory/)
  assert.throws(() => openDatabase(join(directory, 'outside.sqlite'), directory), /inside the project directory/)
  const database = openDatabase('crud.sqlite', directory)
  migrate(database.db, { migrationsFolder: resolve('drizzle') })
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
`,
  'test/shutdown.test.ts': `import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerShutdownHandlers, startServer } from '../src/server.js'

test('graceful shutdown closes listener and local database handle', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'formaforge-be07-shutdown-'))
  const running = await startServer({ host: '127.0.0.1', port: 0 }, 'shutdown.sqlite', directory)
  const closed = new Promise<void>((resolveClose) => running.server.once('close', resolveClose))
  const removeHandlers = registerShutdownHandlers(running)
  try {
    assert.equal(running.server.listening, true)
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
      'db:migrate': 'drizzle-kit migrate',
    },
    dependencies: runtime,
    devDependencies: development,
  }
  const prefix = `${projectName}/`
  const writes = await mutateOwnedStage(stage, [`${prefix}src/db`, `${prefix}src/routes`, `${prefix}test`], [
    { path: `${prefix}package.json`, content: `${JSON.stringify(packageJson, null, 2)}\n` },
    ...Object.entries(files).map(([path, content]) => ({ path: `${prefix}${path}`, content })),
  ])
  return writes.map((path) => path.slice(prefix.length))
}
