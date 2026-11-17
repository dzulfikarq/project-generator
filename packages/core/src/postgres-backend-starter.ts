import { mutateOwnedStage, type OwnedStage } from './staging.js'
import type { DependencyPin } from './types.js'

const files: Record<string, string> = {
  '.env.example': 'HOST=127.0.0.1\nPORT=3000\nNODE_ENV=development\nDATABASE_URL=postgresql://app_user:replace_me@127.0.0.1:5432/app_db\n',
  '.gitignore': 'node_modules/\ndist/\n.env\n',
  'tsconfig.json': `${JSON.stringify({
    compilerOptions: {
      target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', rootDir: 'src', outDir: 'dist', strict: true,
      esModuleInterop: true, forceConsistentCasingInFileNames: true, skipLibCheck: true,
    },
    include: ['src/**/*.ts'],
  }, null, 2)}\n`,
  'eslint.config.mjs': String.raw`import eslint from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist/**', 'drizzle/meta/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['**/*.ts'], languageOptions: { globals: globals.node } },
)
`,
  'drizzle.config.ts': String.raw`import { existsSync } from 'node:fs'
import { defineConfig } from 'drizzle-kit'

if (existsSync('.env')) process.loadEnvFile('.env')

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgresql://127.0.0.1:5432/project_generator_placeholder' },
})
`,
  'src/config.ts': String.raw`export interface ServerConfig { host: string; port: number }

export function readConfig(environment: NodeJS.ProcessEnv = process.env): ServerConfig {
  const host = (environment.HOST ?? '127.0.0.1').trim()
  const rawPort = environment.PORT ?? '3000'
  const port = Number(rawPort)
  if (!host || /[\r\n\0]/.test(host)) throw new Error('HOST must be a non-empty host name or IP address.')
  if (!/^\d+$/.test(rawPort) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.')
  }
  return { host, port }
}
`,
  'src/db/schema.ts': String.raw`import { pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core'

export const items = pgTable('items', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 120 }).notNull(),
  description: text('description').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
})
`,
  'src/db/target.ts': String.raw`import { isIP } from 'node:net'

export interface DatabaseTarget { host: string; port: number; database: string }
export interface ParsedDatabaseUrl { connectionString: string; username: string; target: DatabaseTarget }
export class TargetSafetyError extends Error {}

function safeHost(input: string): string {
  const host = input.startsWith('[') && input.endsWith(']') ? input.slice(1, -1) : input
  if (isIP(host) === 6) return host.toLowerCase()
  if (isIP(host) === 4) return host
  if (host.length > 253 || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(host)
    || host.includes('..') || host.split('.').some((label) => !label || label.length > 63 || label.startsWith('-') || label.endsWith('-'))) {
    throw new TargetSafetyError('Host is not a supported DNS name or IP address.')
  }
  return host.toLowerCase()
}

function validPort(value: string): number {
  if (!/^\d{1,5}$/.test(value)) throw new TargetSafetyError('Port must be an explicit integer from 1 to 65535.')
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new TargetSafetyError('Port must be an explicit integer from 1 to 65535.')
  return port
}

function validDatabase(value: string): string {
  if (!/^[a-zA-Z0-9_][a-zA-Z0-9_$-]{0,62}$/.test(value)) throw new TargetSafetyError('Database name uses unsupported characters.')
  return value
}

export function parseMigrationTarget(value: string): DatabaseTarget {
  const match = /^(\[[0-9a-fA-F:.]+\]|[a-zA-Z0-9.-]+):(\d{1,5})\/([a-zA-Z0-9_][a-zA-Z0-9_$-]{0,62})$/.exec(value)
  if (!match) throw new TargetSafetyError('Use an unambiguous target in host:port/database form.')
  return { host: safeHost(match[1]!), port: validPort(match[2]!), database: validDatabase(match[3]!) }
}

export function parseDatabaseUrl(value: string | undefined): ParsedDatabaseUrl {
  if (!value || value.trim() !== value || /[\r\n\0]/.test(value)) throw new TargetSafetyError('DATABASE_URL is required and must not contain whitespace or control characters.')
  const match = /^(postgres|postgresql):\/\/([^/?#@]+)@(\[[0-9a-fA-F:.]+\]|[a-zA-Z0-9.-]+):(\d{1,5})\/([a-zA-Z0-9_][a-zA-Z0-9_$-]{0,62})$/i.exec(value)
  if (!match) throw new TargetSafetyError('DATABASE_URL must be a PostgreSQL URL with username, password, explicit host/port/database, and no query or fragment.')
  const userInfo = match[2]!
  const separator = userInfo.indexOf(':')
  if (separator < 1 || separator === userInfo.length - 1) throw new TargetSafetyError('DATABASE_URL must include a non-empty username and password.')
  let username: string
  let password: string
  try {
    username = decodeURIComponent(userInfo.slice(0, separator))
    password = decodeURIComponent(userInfo.slice(separator + 1))
  } catch {
    throw new TargetSafetyError('DATABASE_URL contains invalid credential encoding.')
  }
  if (!username || !password) throw new TargetSafetyError('DATABASE_URL must include a non-empty username and password.')
  const host = safeHost(match[3]!)
  const port = validPort(match[4]!)
  const database = validDatabase(match[5]!)
  let parsed: URL
  try { parsed = new URL(value) } catch { throw new TargetSafetyError('DATABASE_URL is not a valid PostgreSQL URL.') }
  let parsedUser: string
  let parsedPassword: string
  try {
    parsedUser = decodeURIComponent(parsed.username)
    parsedPassword = decodeURIComponent(parsed.password)
  } catch { throw new TargetSafetyError('DATABASE_URL contains invalid credential encoding.') }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || parsed.search || parsed.hash
    || parsed.pathname !== '/' + database || safeHost(parsed.hostname) !== host
    || Number(parsed.port) !== port || parsedUser !== username || parsedPassword !== password) {
    throw new TargetSafetyError('DATABASE_URL uses an unsupported or ambiguous URL form.')
  }
  return { connectionString: value, username, target: { host, port, database } }
}

export function assertTargetMatches(actual: DatabaseTarget, confirmed: DatabaseTarget): void {
  if (actual.host !== confirmed.host || actual.port !== confirmed.port || actual.database !== confirmed.database) {
    throw new TargetSafetyError('Confirmed target does not match DATABASE_URL host, port, and database.')
  }
}
`,
  'src/db/client.ts': String.raw`import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from './schema.js'
import { parseDatabaseUrl } from './target.js'

export function createDatabase(environment: NodeJS.ProcessEnv = process.env) {
  const { connectionString } = parseDatabaseUrl(environment.DATABASE_URL)
  const pool = new Pool({ connectionString, max: 10, connectionTimeoutMillis: 1500 })
  pool.on('error', () => undefined)
  return { db: drizzle(pool, { schema }), pool, close: () => pool.end() }
}
`,
  'src/db/items.ts': String.raw`import { eq } from 'drizzle-orm'
import type { createDatabase } from './client.js'
import { items } from './schema.js'

type Database = ReturnType<typeof createDatabase>['db']
export type ItemInput = { name: string; description: string }
export async function listItems(db: Database) { return db.select().from(items).orderBy(items.id) }
export async function findItem(db: Database, id: number) { return (await db.select().from(items).where(eq(items.id, id)).limit(1))[0] }
export async function createItem(db: Database, input: ItemInput) { return (await db.insert(items).values(input).returning())[0] }
export async function updateItem(db: Database, id: number, input: Partial<ItemInput>) { return (await db.update(items).set(input).where(eq(items.id, id)).returning())[0] }
export async function deleteItem(db: Database, id: number) { return (await db.delete(items).where(eq(items.id, id)).returning())[0] }
`,
  'src/routes/items.ts': String.raw`import { Router } from 'express'
import type { Response } from 'express'
import { createItem, deleteItem, findItem, listItems, updateItem, type ItemInput } from '../db/items.js'
import type { createDatabase } from '../db/client.js'

type Database = ReturnType<typeof createDatabase>['db']
const unavailable = (response: Response) => response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Database unavailable.' } })
function itemId(raw: string): number | undefined {
  if (!/^[1-9]\d*$/.test(raw)) return undefined
  const id = Number(raw)
  return Number.isSafeInteger(id) ? id : undefined
}
function validInput(value: unknown, partial = false): Partial<ItemInput> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const input = value as Record<string, unknown>
  if (Object.keys(input).some((key) => !['name', 'description'].includes(key))) return undefined
  if (!partial || Object.hasOwn(input, 'name')) {
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 120) return undefined
  }
  if (Object.hasOwn(input, 'description') && (typeof input.description !== 'string' || input.description.length > 4000)) return undefined
  if (partial && Object.keys(input).length === 0) return undefined
  return { ...(typeof input.name === 'string' ? { name: input.name.trim() } : {}), ...(typeof input.description === 'string' ? { description: input.description } : {}) }
}

export function createItemsRouter(db: Database) {
  const router = Router()
  router.get('/', async (_request, response) => {
    try { return response.json({ data: await listItems(db) }) } catch { return unavailable(response) }
  })
  router.get('/:id', async (request, response) => {
    const id = itemId(request.params.id ?? '')
    if (!id) return response.status(400).json({ error: { code: 'INVALID_ID', message: 'Item ID must be a positive integer.' } })
    try {
      const item = await findItem(db, id)
      return item ? response.json({ data: item }) : response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Item not found.' } })
    } catch { return unavailable(response) }
  })
  router.post('/', async (request, response) => {
    const input = validInput(request.body)
    if (!input || typeof input.name !== 'string') return response.status(400).json({ error: { code: 'INVALID_ITEM', message: 'Provide a name (1–120 characters) and optional description (up to 4000 characters).' } })
    try { return response.status(201).json({ data: await createItem(db, { name: input.name, description: typeof input.description === 'string' ? input.description : '' }) }) } catch { return unavailable(response) }
  })
  router.patch('/:id', async (request, response) => {
    const id = itemId(request.params.id ?? '')
    const input = validInput(request.body, true)
    if (!id) return response.status(400).json({ error: { code: 'INVALID_ID', message: 'Item ID must be a positive integer.' } })
    if (!input) return response.status(400).json({ error: { code: 'INVALID_ITEM', message: 'Provide a valid name or description update.' } })
    try {
      const item = await updateItem(db, id, input)
      return item ? response.json({ data: item }) : response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Item not found.' } })
    } catch { return unavailable(response) }
  })
  router.delete('/:id', async (request, response) => {
    const id = itemId(request.params.id ?? '')
    if (!id) return response.status(400).json({ error: { code: 'INVALID_ID', message: 'Item ID must be a positive integer.' } })
    try {
      const item = await deleteItem(db, id)
      return item ? response.json({ data: item }) : response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Item not found.' } })
    } catch { return unavailable(response) }
  })
  return router
}
`,
  'src/app.ts': String.raw`import express, { type ErrorRequestHandler } from 'express'
import type { createDatabase } from './db/client.js'
import { createItemsRouter } from './routes/items.js'

type Database = ReturnType<typeof createDatabase>['db']
export function createApp(db: Database) {
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: '1mb' }))
  app.get('/health', (_request, response) => response.status(200).json({ status: 'ok' }))
  app.get('/api/info', (_request, response) => response.status(200).json({ name: 'BE-08 Express PostgreSQL API', version: '0.1.0', environment: process.env.NODE_ENV ?? 'development' }))
  app.use('/api/items', createItemsRouter(db))
  app.use((_request, response) => response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found.' } }))
  const handleError: ErrorRequestHandler = (error: unknown, _request, response, next) => {
    if (response.headersSent) return next(error)
    const status = typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number' && error.status >= 400 && error.status <= 599 ? error.status : 500
    response.status(status).json({ error: { code: status < 500 ? 'INVALID_REQUEST' : 'INTERNAL_ERROR', message: status < 500 ? 'Request could not be processed.' : 'Internal server error.' } })
  }
  app.use(handleError)
  return app
}
`,
  'src/server.ts': String.raw`import { existsSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createApp } from './app.js'
import { readConfig, type ServerConfig } from './config.js'
import { createDatabase } from './db/client.js'

export async function startServer(config: ServerConfig = readConfig(), environment: NodeJS.ProcessEnv = process.env) {
  const database = createDatabase(environment)
  const server: Server = createServer(createApp(database.db))
  try {
    await new Promise<void>((resolveListen, reject) => {
      server.once('error', reject)
      server.listen(config.port, config.host, () => { server.off('error', reject); resolveListen() })
    })
  } catch (error) {
    await database.close()
    throw error
  }
  let shutdownPromise: Promise<void> | undefined
  return {
    server,
    pool: database.pool,
    shutdown: () => shutdownPromise ??= (async () => {
      try {
        await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()))
        server.closeIdleConnections()
      } finally { await database.close() }
    })(),
  }
}

export function registerShutdownHandlers(running: { shutdown: () => Promise<void> }): () => void {
  let stopping = false
  const shutdown = () => {
    if (stopping) return
    stopping = true
    void running.shutdown().then(() => console.log('Server stopped.'), () => {
      console.error('Graceful shutdown failed; details withheld.')
      process.exitCode = 1
    })
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
  return () => { process.removeListener('SIGINT', shutdown); process.removeListener('SIGTERM', shutdown) }
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
  void main().catch(() => {
    console.error('Server startup failed; check HOST, PORT, and DATABASE_URL without sharing credentials.')
    process.exitCode = 1
  })
}
`,
  'src/db/migrate.ts': String.raw`import { existsSync } from 'node:fs'
import { lookup } from 'node:dns/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Pool, type PoolClient } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import * as schema from './schema.js'
import { assertTargetMatches, parseDatabaseUrl, parseMigrationTarget, TargetSafetyError, type DatabaseTarget } from './target.js'

export async function verifyDatabaseIdentity(client: PoolClient, parsed: ReturnType<typeof parseDatabaseUrl>): Promise<void> {
  const result = await client.query<{ database: string; username: string; address: string | null; port: number; version_num: number }>(
    'SELECT current_database() AS database, current_user AS username, host(inet_server_addr()) AS address, inet_server_port() AS port, current_setting(\'server_version_num\')::int AS version_num',
  )
  const identity = result.rows[0]
  if (!identity || identity.database !== parsed.target.database || identity.username !== parsed.username
    || Number(identity.port) !== parsed.target.port || Number(identity.version_num) < 160000 || !identity.address) {
    throw new TargetSafetyError('Connected PostgreSQL identity does not match the confirmed database, role, port, or PostgreSQL 16+ baseline.')
  }
  const addresses = await lookup(parsed.target.host, { all: true, verbatim: true })
  const normalized = identity.address.toLowerCase().replace(/^::ffff:/, '')
  if (!addresses.some(({ address }) => address.toLowerCase().replace(/^::ffff:/, '') === normalized)) {
    throw new TargetSafetyError('Connected PostgreSQL server address does not match the confirmed host.')
  }
}

export async function migrateDatabase(targetInput: string, environment: NodeJS.ProcessEnv = process.env): Promise<void> {
  const confirmed: DatabaseTarget = parseMigrationTarget(targetInput)
  const parsed = parseDatabaseUrl(environment.DATABASE_URL)
  assertTargetMatches(parsed.target, confirmed)
  const pool = new Pool({ connectionString: parsed.connectionString, max: 1, connectionTimeoutMillis: 3000 })
  pool.on('error', () => undefined)
  let client: PoolClient | undefined
  try {
    client = await pool.connect()
    await verifyDatabaseIdentity(client, parsed)
    await migrate(drizzle(client, { schema }), { migrationsFolder: resolve('drizzle') })
  } finally {
    try { client?.release() } finally { await pool.end() }
  }
}

function targetArgument(args: readonly string[]): string {
  if (args.length !== 2 || args[0] !== '--target') throw new TargetSafetyError('Usage: npm run db:migrate -- --target host:port/database')
  return args[1]!
}

async function main(): Promise<void> {
  if (existsSync('.env')) process.loadEnvFile('.env')
  await migrateDatabase(targetArgument(process.argv.slice(2)))
  console.log('Database migrations applied to the confirmed PostgreSQL target.')
}

const entry = process.argv[1]
if (entry && import.meta.url === pathToFileURL(resolve(entry)).href) {
  void main().catch((error: unknown) => {
    const message = error instanceof TargetSafetyError ? error.message : 'Database migration failed; database and connection details are withheld.'
    console.error(message)
    process.exitCode = 1
  })
}
`,
  'test/backend.test.ts': String.raw`import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer as createTcpServer } from 'node:net'
import { startServer } from '../src/server.js'
import { createDatabase } from '../src/db/client.js'

async function unusedPort(): Promise<number> {
  const server = createTcpServer()
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()))
  return address.port
}

test('startup and health do not connect to PostgreSQL; missing and invalid URLs fail locally', async () => {
  assert.throws(() => createDatabase({}), /DATABASE_URL is required/)
  assert.throws(() => createDatabase({ DATABASE_URL: 'postgresql://bad' }), /DATABASE_URL must be/)
  const port = await unusedPort()
  const running = await startServer({ host: '127.0.0.1', port: 0 }, { DATABASE_URL: 'postgresql://smoke:smoke@127.0.0.1:' + port + '/smoke_db', NODE_ENV: 'test' })
  const address = running.server.address()
  assert.ok(address && typeof address === 'object')
  try {
    const health = await fetch('http://127.0.0.1:' + address.port + '/health')
    assert.equal(health.status, 200)
    assert.deepEqual(await health.json(), { status: 'ok' })
    const info = await fetch('http://127.0.0.1:' + address.port + '/api/info')
    assert.equal(info.status, 200)
    assert.equal(running.pool.totalCount, 0)
  } finally { await running.shutdown() }
})

test('database connection errors return generic 503 without URL credentials', async () => {
  const port = await unusedPort()
  const running = await startServer({ host: '127.0.0.1', port: 0 }, { DATABASE_URL: 'postgresql://hidden_user:hidden_password@127.0.0.1:' + port + '/hidden_db' })
  const address = running.server.address()
  assert.ok(address && typeof address === 'object')
  try {
    const response = await fetch('http://127.0.0.1:' + address.port + '/api/items')
    const body = await response.text()
    assert.equal(response.status, 503)
    assert.match(body, /DATABASE_UNAVAILABLE/)
    assert.doesNotMatch(body, /hidden_user|hidden_password|hidden_db/)
  } finally { await running.shutdown() }
})
`,
  'test/database.test.ts': String.raw`import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:net'
import { startServer } from '../src/server.js'
import { createDatabase } from '../src/db/client.js'
import { assertTargetMatches, parseDatabaseUrl, parseMigrationTarget } from '../src/db/target.js'

test('PostgreSQL URL and explicit target reject ambiguous or mismatched forms', () => {
  const parsed = parseDatabaseUrl('postgresql://app_user:pass%40word@127.0.0.1:5432/app_db')
  const target = parseMigrationTarget('127.0.0.1:5432/app_db')
  assert.equal(parsed.username, 'app_user')
  assertTargetMatches(parsed.target, target)
  for (const value of ['', '127.0.0.1/app_db', '127.0.0.1:0/app_db', '127.0.0.1:5432/a/b']) assert.throws(() => parseMigrationTarget(value))
  for (const value of [undefined, 'postgresql://user:pass@localhost/app_db', 'postgresql://user:pass@localhost:5432/app_db?sslmode=disable', 'postgresql://user:pass@localhost:5432/app_db#fragment']) assert.throws(() => parseDatabaseUrl(value))
  assert.throws(() => assertTargetMatches(parsed.target, { ...target, database: 'other_db' }), /does not match/)
  assert.throws(() => createDatabase({}), /DATABASE_URL is required/)
})

test('target mismatch is rejected before creating a network connection', async () => {
  const { migrateDatabase } = await import('../src/db/migrate.js')
  let connections = 0
  const probe = createServer((socket) => { connections += 1; socket.destroy() })
  await new Promise<void>((resolveListen, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolveListen) })
  const address = probe.address()
  assert.ok(address && typeof address === 'object')
  try {
    await assert.rejects(migrateDatabase('127.0.0.1:' + address.port + '/other_db', { DATABASE_URL: 'postgresql://user:pass@127.0.0.1:' + address.port + '/app_db' }), /does not match/)
    assert.equal(connections, 0)
  } finally { await new Promise<void>((resolveClose, reject) => probe.close((error) => error ? reject(error) : resolveClose())) }
})

test('connected identity must match target, role, server address, port, and PostgreSQL 16+', async () => {
  const { verifyDatabaseIdentity } = await import('../src/db/migrate.js')
  const parsed = parseDatabaseUrl('postgresql://app_user:pass@127.0.0.1:5432/app_db')
  let identityQuery = ''
  const client = (row: Record<string, unknown>) => ({ query: async (query: string) => { identityQuery = query; return { rows: [row] } } })
  const valid = { database: 'app_db', username: 'app_user', address: '127.0.0.1', port: 5432, version_num: 160000 }
  await verifyDatabaseIdentity(client(valid) as never, parsed)
  assert.match(identityQuery, /host\(inet_server_addr\(\)\)/)
  for (const invalid of [
    { ...valid, database: 'other_db' },
    { ...valid, username: 'other_user' },
    { ...valid, address: null },
    { ...valid, port: 5433 },
    { ...valid, version_num: 150000 },
  ]) await assert.rejects(verifyDatabaseIdentity(client(invalid) as never, parsed))
})

const e2eUrl = process.env.PG_E2E_DATABASE_URL
test('isolated PostgreSQL migration supports item CRUD endpoints', { skip: !e2eUrl }, async () => {
  const running = await startServer({ host: '127.0.0.1', port: 0 }, { DATABASE_URL: e2eUrl })
  const address = running.server.address()
  assert.ok(address && typeof address === 'object')
  const base = 'http://127.0.0.1:' + address.port + '/api/items'
  let createdId: number | undefined
  try {
    assert.equal((await fetch(base + '/bad-id')).status, 400)
    const invalid = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '  ' }) })
    assert.equal(invalid.status, 400)
    assert.equal((await fetch(base + '/2147483647')).status, 404)
    const createdResponse = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'isolated e2e item', description: 'before update' }) })
    assert.equal(createdResponse.status, 201)
    const created = (await createdResponse.json() as { data: { id: number; name: string } }).data
    createdId = created.id
    assert.equal(created.name, 'isolated e2e item')
    const listed = await (await fetch(base)).json() as { data: { id: number }[] }
    assert.ok(listed.data.some(({ id }) => id === created.id))
    assert.equal((await (await fetch(base + '/' + created.id)).json() as { data: { description: string } }).data.description, 'before update')
    const updated = await fetch(base + '/' + created.id, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ description: 'after update' }) })
    assert.equal((await updated.json() as { data: { description: string } }).data.description, 'after update')
    assert.equal((await fetch(base + '/' + created.id, { method: 'DELETE' })).status, 200)
    createdId = undefined
    assert.equal((await fetch(base + '/' + created.id)).status, 404)
    assert.equal((await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'x', unexpected: true }) })).status, 400)
  } finally {
    if (createdId) await fetch(base + '/' + createdId, { method: 'DELETE' })
    await running.shutdown()
  }
})
`,
  'test/shutdown.test.ts': String.raw`import assert from 'node:assert/strict'
import test from 'node:test'
import { startServer } from '../src/server.js'

test('graceful shutdown closes listener and PostgreSQL pool', async () => {
  const running = await startServer({ host: '127.0.0.1', port: 0 }, { DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/test_db' })
  assert.equal(running.server.listening, true)
  await running.shutdown()
  assert.equal(running.server.listening, false)
  await assert.rejects(running.pool.query('SELECT 1'), /end/i)
})
`,
}

export async function writePostgresBackendStarter(stage: OwnedStage, projectName: string, dependencies: readonly DependencyPin[]): Promise<string[]> {
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
      test: 'node --import tsx --test test/*.test.ts',
      typecheck: 'tsc --project tsconfig.json --noEmit',
      lint: 'eslint src test',
      'db:generate': 'drizzle-kit generate',
      'db:migrate': 'node --import tsx src/db/migrate.ts',
    },
    dependencies: runtime,
    devDependencies: development,
  }
  const prefix = `${projectName}/`
  const writes = await mutateOwnedStage(stage, [`${prefix}src`, `${prefix}src/db`, `${prefix}src/routes`, `${prefix}test`, `${prefix}docs`], [
    { path: `${prefix}package.json`, content: `${JSON.stringify(packageJson, null, 2)}\n` },
    ...Object.entries(files).map(([path, content]) => ({ path: `${prefix}${path}`, content })),
  ])
  return writes.map((path) => path.slice(prefix.length))
}

export function postgresDatabaseSupportFiles(): { drizzleConfig: string; schema: string; target: string; migrate: string; databaseSafety: string } {
  return {
    drizzleConfig: files['drizzle.config.ts']!,
    schema: files['src/db/schema.ts']!,
    target: files['src/db/target.ts']!,
    migrate: files['src/db/migrate.ts']!,
    databaseSafety: `# PostgreSQL safety

- Generation installs pinned npm dependencies and generates Drizzle SQL; it never connects to PostgreSQL or applies migrations.
- Nest starts without DATABASE_URL. DatabaseService creates one pooled connection service only on the first CRUD request; GET /health is process-only.
- PostgreSQL 16+ is user-provided and needed only for CRUD and explicit migration. No database is automatically created, reset, or dropped.
- DTO validation rejects unknown properties and invalid item values. Database failures return generic HTTP 503; credentials and driver errors are not returned or logged.
- .env is ignored; .env.example contains placeholders only. Never commit credentials.
- Migration requires npm run db:migrate -- --target host:port/database. The wrapper matches DATABASE_URL, verifies connected database, role, server address, port, and PostgreSQL version, then migrates on that checked connection.
- Drizzle Kit generates SQL only. Do not invoke drizzle-kit migrate directly; installed tools remain manually callable outside wrapper enforcement.
- npm lifecycle/build scripts run unsandboxed after explicit consent.
`,
  }
}
