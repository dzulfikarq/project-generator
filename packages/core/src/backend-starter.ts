import type { DependencyPin } from './types.js'
import { mutateOwnedStage, type OwnedStage } from './staging.js'

const starterFiles: Record<string, string> = {
  '.env.example': 'HOST=127.0.0.1\nPORT=3000\nNODE_ENV=development\n',
  '.gitignore': 'node_modules/\ndist/\n.env\n',
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
  'src/app.ts': `import express, { type ErrorRequestHandler } from 'express'

export function createApp() {
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: '1mb' }))

  app.get('/health', (_request, response) => response.status(200).json({ status: 'ok' }))
  app.get('/api/info', (_request, response) => response.status(200).json({
    name: 'BE-01 Express API',
    version: '0.1.0',
    environment: process.env.NODE_ENV ?? 'development',
  }))

  app.use((_request, response) => response.status(404).json({
    error: { code: 'NOT_FOUND', message: 'Route not found.' },
  }))

  const handleError: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
    const status = typeof error === 'object' && error !== null && 'status' in error
      && typeof error.status === 'number' && error.status >= 400 && error.status <= 599
      ? error.status
      : 500
    response.status(status).json({
      error: {
        code: status < 500 ? 'INVALID_REQUEST' : 'INTERNAL_ERROR',
        message: status < 500 ? 'Request could not be processed.' : 'Internal server error.',
      },
    })
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

export async function startServer(config: ServerConfig = readConfig()): Promise<{ server: Server; shutdown: () => Promise<void> }> {
  const server = createServer(createApp())
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(config.port, config.host, () => {
      server.off('error', reject)
      resolveListen()
    })
  })

  let shutdownPromise: Promise<void> | undefined
  return {
    server,
    shutdown: () => shutdownPromise ??= new Promise<void>((resolveClose, reject) => {
      server.close((error) => error ? reject(error) : resolveClose())
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
  console.log(\`Listening on \${typeof address === 'object' && address ? address.address + ':' + address.port : 'configured address'}\`)
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
import { readConfig } from '../src/config.js'
import { startServer } from '../src/server.js'

test('API serves health and info, and returns JSON for unknown or malformed requests', async () => {
  const running = await startServer({ host: '127.0.0.1', port: 0 })
  const address = running.server.address()
  assert.ok(address && typeof address === 'object')
  const base = \`http://127.0.0.1:\${address.port}\`
  try {
    const health = await fetch(\`\${base}/health\`)
    assert.equal(health.status, 200)
    assert.deepEqual(await health.json(), { status: 'ok' })

    const info = await fetch(\`\${base}/api/info\`)
    assert.equal(info.status, 200)
    assert.deepEqual(await info.json(), { name: 'BE-01 Express API', version: '0.1.0', environment: process.env.NODE_ENV ?? 'development' })

    const missing = await fetch(\`\${base}/missing\`)
    assert.equal(missing.status, 404)
    assert.deepEqual(await missing.json(), { error: { code: 'NOT_FOUND', message: 'Route not found.' } })

    const malformed = await fetch(\`\${base}/health\`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' })
    assert.equal(malformed.status, 400)
    assert.deepEqual(await malformed.json(), { error: { code: 'INVALID_REQUEST', message: 'Request could not be processed.' } })
  } finally {
    await running.shutdown()
  }
})

test('environment configuration rejects invalid host and port before listen', () => {
  assert.throws(() => readConfig({ PORT: 'not-a-port' }), /PORT must be an integer/)
  assert.throws(() => readConfig({ PORT: '65536' }), /PORT must be an integer/)
  assert.throws(() => readConfig({ HOST: 'bad\\nhost' }), /HOST must be/)
})
`,
  'test/shutdown.test.ts': `import assert from 'node:assert/strict'
import test from 'node:test'
import { registerShutdownHandlers, startServer } from '../src/server.js'

test('graceful shutdown closes listener and is safe to repeat', async () => {
  const running = await startServer({ host: '127.0.0.1', port: 0 })
  const closed = new Promise<void>((resolveClose) => running.server.once('close', resolveClose))
  const removeHandlers = registerShutdownHandlers(running)
  assert.equal(running.server.listening, true)
  process.emit('SIGTERM')
  process.emit('SIGINT')
  await closed
  removeHandlers()
  assert.equal(running.server.listening, false)
})
`,
}

export async function writeBackendStarter(stage: OwnedStage, projectName: string, dependencies: readonly DependencyPin[]): Promise<string[]> {
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
      test: 'node --import tsx --test test/backend.test.ts test/shutdown.test.ts',
      typecheck: 'tsc --project tsconfig.json --noEmit',
    },
    dependencies: runtime,
    devDependencies: development,
  }
  const prefix = `${projectName}/`
  const writes = await mutateOwnedStage(stage, [`${prefix}src`, `${prefix}test`], [
    { path: `${prefix}package.json`, content: `${JSON.stringify(packageJson, null, 2)}\n` },
    ...Object.entries(starterFiles).map(([path, content]) => ({ path: `${prefix}${path}`, content })),
  ])
  return writes.map((path) => path.slice(prefix.length))
}
