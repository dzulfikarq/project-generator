import { mutateOwnedStage, type OwnedStage } from './staging.js'
import { POSTGRES_BACKEND_FILES } from './postgres-backend-starter.js'
import type { DependencyPin } from './types.js'

const files: Record<string, string> = {
  'apps/web/index.html': '<!doctype html>\n<html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>Items</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>\n',
  'apps/web/vite.config.ts': String.raw`import { resolve } from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, resolve(import.meta.dirname, '../..'), '')
  const api = 'http://127.0.0.1:' + (process.env.API_PORT ?? environment.API_PORT ?? environment.PORT ?? '3000')
  const proxy = { '/api': api, '/health': api }
  return {
    plugins: [react()],
    server: { host: '127.0.0.1', proxy },
    preview: { host: '127.0.0.1', proxy },
  }
})
`,
  'apps/web/tsconfig.json': `${JSON.stringify({
    compilerOptions: { target: 'ES2022', useDefineForClassFields: true, lib: ['ES2022', 'DOM', 'DOM.Iterable'], module: 'ESNext', skipLibCheck: true, moduleResolution: 'Bundler', allowImportingTsExtensions: true, verbatimModuleSyntax: true, moduleDetection: 'force', noEmit: true, jsx: 'react-jsx', strict: true, noUnusedLocals: true, noUnusedParameters: true, noFallthroughCasesInSwitch: true },
    include: ['src'],
  }, null, 2)}\n`,
  'apps/web/src/main.tsx': String.raw`import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import './style.css'

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
`,
  'apps/web/src/vite-env.d.ts': '/// <reference types="vite/client" />\n',
  'apps/web/src/services/items.ts': String.raw`export type Item = { id: number; name: string; description: string; createdAt: string }
export type ItemInput = { name: string; description: string }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try { response = await fetch(path, init) }
  catch { throw new Error('API unavailable. Start the backend and retry.') }
  const body = await response.json().catch(() => undefined) as { data?: T; error?: { message?: string } } | undefined
  if (!response.ok) throw new Error(body?.error?.message ?? 'Request failed. Check API and database availability.')
  return body?.data as T
}

const json = (method: string, input: Partial<ItemInput>): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) })
export const listItems = () => request<Item[]>('/api/items')
export const createItem = (input: ItemInput) => request<Item>('/api/items', json('POST', input))
export const updateItem = (id: number, input: Partial<ItemInput>) => request<Item>('/api/items/' + id, json('PATCH', input))
export const deleteItem = (id: number) => request<Item>('/api/items/' + id, { method: 'DELETE' })
`,
  'apps/web/src/services/items.test.ts': String.raw`import assert from 'node:assert/strict'
import test from 'node:test'
import { createItem, listItems } from './items.js'

test('items client calls same-origin API and reports unavailable service safely', async () => {
  const original = globalThis.fetch
  try {
    globalThis.fetch = async (input) => {
      assert.equal(String(input), '/api/items')
      return new Response(JSON.stringify({ data: [] }), { headers: { 'content-type': 'application/json' } })
    }
    assert.deepEqual(await listItems(), [])
    globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'Database unavailable.' } }), { status: 503 })
    await assert.rejects(createItem({ name: 'item', description: '' }), /Database unavailable/)
    globalThis.fetch = async () => { throw new TypeError('offline') }
    await assert.rejects(listItems(), /API unavailable/)
  } finally { globalThis.fetch = original }
})
`,
  'apps/web/src/App.tsx': String.raw`import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { createItem, deleteItem, listItems, updateItem, type Item, type ItemInput } from './services/items.js'

export function App() {
  const [items, setItems] = useState<Item[]>([])
  const [editing, setEditing] = useState<Item>()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const refresh = useCallback(async () => {
    setLoading(true); setError('')
    try { setItems(await listItems()) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Items could not be loaded.') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void refresh() }, [refresh])
  function edit(item: Item) { setEditing(item); setName(item.name); setDescription(item.description); setError('') }
  function resetForm() { setEditing(undefined); setName(''); setDescription('') }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const input: ItemInput = { name: name.trim(), description }
    setSaving(true); setError(''); setFeedback('')
    try {
      if (editing) { await updateItem(editing.id, input); setFeedback('Item updated.') }
      else { await createItem(input); setFeedback('Item added.') }
      resetForm()
      await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Item could not be saved.') }
    finally { setSaving(false) }
  }
  async function remove(item: Item) {
    setError(''); setFeedback('')
    try { await deleteItem(item.id); setFeedback('Item deleted.'); await refresh() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Item could not be deleted.') }
  }
  return <main className="page">
    <header><p className="eyebrow">FS-06 · REACT + EXPRESS</p><h1>Items</h1><p>Manage items through your PostgreSQL-backed API.</p></header>
    {error && <div className="notice" role="alert"><span>{error}</span><button className="quiet" onClick={() => void refresh()}>Retry</button></div>}
    {feedback && !error && <p className="feedback" role="status">{feedback}</p>}
    <section className="panel"><h2>{editing ? 'Edit item' : 'Add an item'}</h2><form className="item-form" onSubmit={(event) => void save(event)}>
      <label>Item name<input value={name} maxLength={120} required disabled={saving} onChange={(event) => setName(event.target.value)} /></label>
      <label>Description<textarea value={description} maxLength={4000} rows={2} disabled={saving} onChange={(event) => setDescription(event.target.value)} /></label>
      <div className="actions"><button disabled={saving || !name.trim()}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Add item'}</button>{editing && <button type="button" className="quiet" disabled={saving} onClick={resetForm}>Cancel</button>}</div>
    </form></section>
    <section className="panel"><div className="section-heading"><h2>Your items</h2><button className="quiet" disabled={loading} onClick={() => void refresh()}>Refresh</button></div>
      {loading ? <p role="status">Loading items…</p> : items.length === 0 ? <p className="empty">No items yet. Add one above.</p> : <ul className="items">{items.map((item) => <li key={item.id}><div><h3>{item.name}</h3><p>{item.description || 'No description'}</p></div><div className="actions"><button className="quiet" onClick={() => edit(item)}>Edit</button><button className="danger" onClick={() => void remove(item)}>Delete</button></div></li>)}</ul>}
    </section>
  </main>
}
`,
  'apps/web/src/style.css': String.raw`:root{font-family:system-ui,sans-serif;color:#252a31;background:#f4f5f7;font-synthesis:none;text-rendering:optimizeLegibility}*{box-sizing:border-box}body{margin:0}.page{max-width:860px;margin:0 auto;padding:clamp(1rem,5vw,3.5rem)}header{margin-bottom:2rem}.eyebrow{font-size:.76rem;font-weight:700;letter-spacing:.12em;color:#626b76}h1{font-size:clamp(2rem,6vw,3.5rem);margin:.25rem 0}h2{font-size:1.15rem;margin:0}.panel{background:white;border:1px solid #dfe3e8;border-radius:14px;padding:1.25rem;margin:1rem 0;box-shadow:0 4px 18px #17212b0b}.item-form{display:grid;gap:1rem;margin-top:1rem}.item-form label{display:grid;gap:.4rem;font-weight:600}.item-form input,.item-form textarea{width:100%;padding:.7rem;border:1px solid #b7c0ca;border-radius:7px;font:inherit}.actions,.section-heading{display:flex;gap:.55rem;align-items:center}.section-heading{justify-content:space-between}.actions button,.notice button{padding:.55rem .85rem;border:0;border-radius:7px;background:#2457c5;color:white;font:inherit;font-weight:600;cursor:pointer}.actions button:disabled{opacity:.55}.actions .quiet,.section-heading .quiet,.notice .quiet{background:transparent;color:#334155;border:1px solid #c5cbd3}.actions .danger{background:#a83232}.items{list-style:none;margin:1rem 0 0;padding:0}.items li{display:flex;justify-content:space-between;gap:1rem;padding:1rem 0;border-top:1px solid #e7eaee}.items h3,.items p{margin:.15rem 0}.items p,.empty{color:#59636e}.notice{display:flex;justify-content:space-between;align-items:center;gap:1rem;background:#fff1ee;border:1px solid #dc8d7e;color:#762d24;padding:.85rem 1rem;border-radius:8px}.feedback{color:#24643a}.empty{padding:.7rem 0}@media(max-width:540px){.items li{align-items:flex-start;flex-direction:column}.actions{flex-wrap:wrap}}
`,
  'eslint.config.mjs': String.raw`import eslint from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/drizzle/meta/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['apps/api/**/*.ts'], languageOptions: { globals: globals.node } },
  { files: ['apps/web/**/*.{ts,tsx}'], languageOptions: { globals: globals.browser } },
)
`,
  'scripts/dev.mjs': String.raw`import { spawn } from 'node:child_process'

const api = spawn(process.execPath, ['--env-file-if-exists=.env', '--import', 'tsx', '--watch', 'apps/api/src/server.ts'], { stdio: 'inherit', windowsHide: true })
const web = spawn(process.execPath, ['../../node_modules/vite/bin/vite.js', '--host', '127.0.0.1'], { cwd: 'apps/web', stdio: 'inherit', windowsHide: true })
const children = [api, web]
let stopping = false
function stop(signal) {
  if (stopping) return
  stopping = true
  for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill(signal)
}
for (const child of children) {
  child.once('error', () => { process.exitCode = 1; stop('SIGTERM') })
  child.once('exit', (code) => { if (!stopping) { process.exitCode = code ?? 1; stop('SIGTERM') } })
}
process.once('SIGINT', () => stop('SIGINT'))
process.once('SIGTERM', () => stop('SIGTERM'))
`,
  '.env.example': 'HOST=127.0.0.1\nPORT=3000\nNODE_ENV=development\nDATABASE_URL=postgresql://app_user:replace_me@127.0.0.1:5432/app_db\n',
  '.gitignore': 'node_modules/\napps/*/dist/\n.env\n',
  'docs/DATABASE-SAFETY.md': `# PostgreSQL safety

- PostgreSQL 16+ is user-provided. Generation, dependency installation, startup, health checks, and SQL generation do not provision, connect to, or migrate a database.
- API startup validates DATABASE_URL and creates a lazy connection pool. GET /health is process-only. CRUD connects only when requested; database failures return generic HTTP 503 without credentials or driver details.
- Copy the root .env.example to .env. Keep credentials out of frontend code and VITE_* variables; .env is ignored.
- Review generated SQL before migration. Apply only with npm run db:migrate -- --target host:port/database. The wrapper matches URL target and verifies connected database, role, address, port, and PostgreSQL 16+ version before migrating on that connection.
- Target confirmation is an operator guard, not cryptographic server identity. Direct Drizzle Kit migration remains callable outside wrapper enforcement.
- npm lifecycle and build scripts execute unsandboxed after explicit consent.
`,
}

function packageScopes(pins: readonly DependencyPin[], scopes: readonly ('dependencies' | 'devDependencies')[]) {
  return Object.fromEntries(scopes.map((scope) => [scope, Object.fromEntries(pins.filter((pin) => (pin.scope ?? 'dependencies') === scope).map(({ packageName, version }) => [packageName, version]))]))
}

export async function writeFullstackStarter(stage: OwnedStage, projectName: string, dependencies: readonly DependencyPin[]): Promise<string[]> {
  const projectPrefix = `${projectName}/`
  const apiRuntime = dependencies.filter(({ packageName }) => ['express', 'drizzle-orm', 'pg'].includes(packageName))
  const apiDev = dependencies.filter(({ packageName }) => ['@types/express', '@types/node', '@types/pg', 'drizzle-kit', 'tsx', 'typescript'].includes(packageName))
  const webRuntime = dependencies.filter(({ packageName }) => ['react', 'react-dom'].includes(packageName))
  const webDev = dependencies.filter(({ packageName }) => ['@types/node', '@types/react', '@types/react-dom', '@vitejs/plugin-react', 'tsx', 'typescript', 'vite'].includes(packageName))
  const rootDev = dependencies.filter(({ packageName }) => ['@eslint/js', 'eslint', 'globals', 'typescript', 'typescript-eslint'].includes(packageName))
  const rootPackage = {
    name: projectName, version: '0.1.0', private: true, type: 'module', engines: { node: '>=22.13.0' },
    workspaces: ['apps/web', 'apps/api'],
    scripts: {
      dev: 'node scripts/dev.mjs',
      'dev:web': 'npm run dev --workspace apps/web',
      'dev:api': 'npm run dev --workspace apps/api',
      typecheck: 'npm run typecheck --workspace apps/api && npm run typecheck --workspace apps/web',
      lint: 'eslint apps/api/src apps/api/test apps/web/src',
      test: 'npm run test --workspace apps/api && npm run test --workspace apps/web',
      build: 'npm run build --workspace apps/api && npm run build --workspace apps/web',
      'db:generate': 'npm run db:generate --workspace apps/api',
      'db:migrate': 'npm run db:migrate --workspace apps/api --',
    },
    devDependencies: packageScopes(rootDev, ['devDependencies']).devDependencies,
  }
  const apiPackage = {
    name: `@${projectName}/api`, version: '0.1.0', private: true, type: 'module', engines: { node: '>=22.13.0' },
    scripts: {
      dev: 'node --env-file-if-exists=../../.env --import tsx --watch src/server.ts',
      build: 'tsc --project tsconfig.json', start: 'node --env-file-if-exists=../../.env dist/server.js',
      test: 'node --import tsx --test test/*.test.ts', typecheck: 'tsc --project tsconfig.json --noEmit',
      'db:generate': 'drizzle-kit generate', 'db:migrate': 'node --env-file-if-exists=../../.env --import tsx src/db/migrate.ts',
    },
    ...packageScopes([...apiRuntime, ...apiDev], ['dependencies', 'devDependencies']),
  }
  const webPackage = {
    name: `@${projectName}/web`, version: '0.1.0', private: true, type: 'module',
    scripts: { dev: 'vite --host 127.0.0.1', build: 'vite build', typecheck: 'tsc --project tsconfig.json --noEmit', test: 'node --import tsx --test src/services/items.test.ts' },
    ...packageScopes([...webRuntime, ...webDev], ['dependencies', 'devDependencies']),
  }
  const output: Record<string, string> = {
    'package.json': `${JSON.stringify(rootPackage, null, 2)}\n`,
    'apps/api/package.json': `${JSON.stringify(apiPackage, null, 2)}\n`,
    'apps/web/package.json': `${JSON.stringify(webPackage, null, 2)}\n`,
    'apps/api/tsconfig.json': POSTGRES_BACKEND_FILES['tsconfig.json']!,
    'apps/api/drizzle.config.ts': POSTGRES_BACKEND_FILES['drizzle.config.ts']!,
    ...Object.fromEntries(Object.entries(POSTGRES_BACKEND_FILES)
      .filter(([path]) => path.startsWith('src/') || path.startsWith('test/'))
      .map(([path, content]) => [`apps/api/${path}`, content])),
    ...files,
  }
  output['apps/api/src/app.ts'] = output['apps/api/src/app.ts']!.replace('BE-08 Express PostgreSQL API', 'FS-06 Express PostgreSQL API')
  const written = await mutateOwnedStage(stage, [
    'apps', 'apps/web', 'apps/web/src', 'apps/web/src/services', 'apps/api', 'apps/api/src', 'apps/api/src/db', 'apps/api/src/routes', 'apps/api/test', 'scripts', 'docs',
  ], Object.entries(output).map(([path, content]) => ({ path: `${projectPrefix}${path}`, content })))
  return written.map((path) => path.slice(projectPrefix.length))
}
