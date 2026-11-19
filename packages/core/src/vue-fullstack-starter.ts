import { mutateOwnedStage, type OwnedStage } from './staging.js'
import { POSTGRES_BACKEND_FILES } from './postgres-backend-starter.js'
import type { DependencyPin } from './types.js'

const files: Record<string, string> = {
  'apps/web/index.html': '<!doctype html>\n<html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>Items</title></head><body><div id="app"></div><script type="module" src="/src/main.ts"></script></body></html>\n',
  'apps/web/vite.config.ts': String.raw`import { resolve } from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, resolve(import.meta.dirname, '../..'), '')
  const api = 'http://127.0.0.1:' + (process.env.API_PORT ?? environment.API_PORT ?? environment.PORT ?? '3000')
  const proxy = { '/api': api, '/health': api }
  return {
    plugins: [vue()],
    server: { host: '127.0.0.1', proxy },
    preview: { host: '127.0.0.1', proxy },
  }
})
`,
  'apps/web/tsconfig.json': `${JSON.stringify({
    compilerOptions: { target: 'ES2022', useDefineForClassFields: true, lib: ['ES2022', 'DOM', 'DOM.Iterable'], module: 'ESNext', skipLibCheck: true, moduleResolution: 'Bundler', allowImportingTsExtensions: true, verbatimModuleSyntax: true, moduleDetection: 'force', noEmit: true, strict: true, noUnusedLocals: true, noUnusedParameters: true, noFallthroughCasesInSwitch: true, types: ['vite/client', 'node'] },
    include: ['src/**/*.ts', 'src/**/*.vue'],
  }, null, 2)}\n`,
  'apps/web/src/main.ts': String.raw`import { createApp } from 'vue'
import App from './App.vue'
import './style.css'

createApp(App).mount('#app')
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
  'apps/web/src/components/ItemForm.vue': String.raw`<script setup lang="ts">
import { ref, watch } from 'vue'
import type { Item, ItemInput } from '../services/items.js'

const props = defineProps<{ editing?: Item; saving: boolean }>()
const emit = defineEmits<{ save: [input: ItemInput]; cancel: [] }>()
const name = ref('')
const description = ref('')
const validation = ref('')

watch(() => props.editing, (item) => {
  name.value = item?.name ?? ''
  description.value = item?.description ?? ''
  validation.value = ''
}, { immediate: true })

function submit() {
  const normalizedName = name.value.trim()
  if (!normalizedName || normalizedName.length > 120 || description.value.length > 4000) {
    validation.value = 'Enter an item name (1–120 characters); description must be 4,000 characters or less.'
    return
  }
  validation.value = ''
  emit('save', { name: normalizedName, description: description.value })
}
</script>

<template>
  <section class="panel">
    <h2>{{ editing ? 'Edit item' : 'Add an item' }}</h2>
    <form class="item-form" @submit.prevent="submit">
      <label>Item name<input v-model="name" maxlength="120" required :disabled="saving" /></label>
      <label>Description<textarea v-model="description" maxlength="4000" rows="2" :disabled="saving" /></label>
      <p v-if="validation" class="field-error" role="alert">{{ validation }}</p>
      <div class="actions">
        <button :disabled="saving">{{ saving ? 'Saving…' : editing ? 'Save changes' : 'Add item' }}</button>
        <button v-if="editing" type="button" class="quiet" :disabled="saving" @click="emit('cancel')">Cancel</button>
      </div>
    </form>
  </section>
</template>
`,
  'apps/web/src/components/ItemsList.vue': String.raw`<script setup lang="ts">
import type { Item } from '../services/items.js'

defineProps<{ items: Item[]; loading: boolean }>()
const emit = defineEmits<{ edit: [item: Item]; delete: [item: Item]; refresh: [] }>()

function confirmDelete(item: Item) {
  if (window.confirm('Delete “' + item.name + '”? This cannot be undone.')) emit('delete', item)
}
</script>

<template>
  <section class="panel">
    <div class="section-heading"><h2>Your items</h2><button class="quiet" :disabled="loading" @click="emit('refresh')">Refresh</button></div>
    <p v-if="loading" role="status">Loading items…</p>
    <p v-else-if="items.length === 0" class="empty">No items yet. Add one above.</p>
    <ul v-else class="items">
      <li v-for="item in items" :key="item.id">
        <div><h3>{{ item.name }}</h3><p>{{ item.description || 'No description' }}</p></div>
        <div class="actions"><button class="quiet" @click="emit('edit', item)">Edit</button><button class="danger" @click="confirmDelete(item)">Delete</button></div>
      </li>
    </ul>
  </section>
</template>
`,
  'apps/web/src/App.vue': String.raw`<script setup lang="ts">
import { onMounted, ref } from 'vue'
import ItemForm from './components/ItemForm.vue'
import ItemsList from './components/ItemsList.vue'
import { createItem, deleteItem, listItems, updateItem, type Item, type ItemInput } from './services/items.js'

const items = ref<Item[]>([])
const editing = ref<Item>()
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const feedback = ref('')

async function refresh() {
  loading.value = true
  error.value = ''
  try { items.value = await listItems() }
  catch (cause) { error.value = cause instanceof Error ? cause.message : 'Items could not be loaded.' }
  finally { loading.value = false }
}

function edit(item: Item) { editing.value = item; error.value = '' }
function resetForm() { editing.value = undefined }

async function save(input: ItemInput) {
  saving.value = true
  error.value = ''
  feedback.value = ''
  try {
    if (editing.value) { await updateItem(editing.value.id, input); feedback.value = 'Item updated.' }
    else { await createItem(input); feedback.value = 'Item added.' }
    resetForm()
    await refresh()
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Item could not be saved.' }
  finally { saving.value = false }
}

async function remove(item: Item) {
  error.value = ''
  feedback.value = ''
  try { await deleteItem(item.id); feedback.value = 'Item deleted.'; await refresh() }
  catch (cause) { error.value = cause instanceof Error ? cause.message : 'Item could not be deleted.' }
}

onMounted(() => { void refresh() })
</script>

<template>
  <main class="page">
    <header><p class="eyebrow">FS-07 · VUE + EXPRESS</p><h1>Items</h1><p>Manage items through your PostgreSQL-backed API.</p></header>
    <div v-if="error" class="notice" role="alert"><span>{{ error }}</span><button class="quiet" @click="refresh">Retry</button></div>
    <p v-if="feedback && !error" class="feedback" role="status">{{ feedback }}</p>
    <ItemForm :editing="editing" :saving="saving" @save="save" @cancel="resetForm" />
    <ItemsList :items="items" :loading="loading" @edit="edit" @delete="remove" @refresh="refresh" />
  </main>
</template>
`,
  'apps/web/src/style.css': String.raw`:root{font-family:system-ui,sans-serif;color:#252a31;background:#f4f5f7;font-synthesis:none;text-rendering:optimizeLegibility}*{box-sizing:border-box}body{margin:0}.page{max-width:860px;margin:0 auto;padding:clamp(1rem,5vw,3.5rem)}header{margin-bottom:2rem}.eyebrow{font-size:.76rem;font-weight:700;letter-spacing:.12em;color:#626b76}h1{font-size:clamp(2rem,6vw,3.5rem);margin:.25rem 0}h2{font-size:1.15rem;margin:0}.panel{background:white;border:1px solid #dfe3e8;border-radius:14px;padding:1.25rem;margin:1rem 0;box-shadow:0 4px 18px #17212b0b}.item-form{display:grid;gap:1rem;margin-top:1rem}.item-form label{display:grid;gap:.4rem;font-weight:600}.item-form input,.item-form textarea{width:100%;padding:.7rem;border:1px solid #b7c0ca;border-radius:7px;font:inherit}.actions,.section-heading{display:flex;gap:.55rem;align-items:center}.section-heading{justify-content:space-between}.actions button,.notice button{padding:.55rem .85rem;border:0;border-radius:7px;background:#2457c5;color:white;font:inherit;font-weight:600;cursor:pointer}.actions button:disabled{opacity:.55}.actions .quiet,.section-heading .quiet,.notice .quiet{background:transparent;color:#334155;border:1px solid #c5cbd3}.actions .danger{background:#a83232}.items{list-style:none;margin:1rem 0 0;padding:0}.items li{display:flex;justify-content:space-between;gap:1rem;padding:1rem 0;border-top:1px solid #e7eaee}.items h3,.items p{margin:.15rem 0}.items p,.empty{color:#59636e}.notice{display:flex;justify-content:space-between;align-items:center;gap:1rem;background:#fff1ee;border:1px solid #dc8d7e;color:#762d24;padding:.85rem 1rem;border-radius:8px}.feedback{color:#24643a}.field-error{color:#8f261d;margin:0}.empty{padding:.7rem 0}@media(max-width:540px){.items li{align-items:flex-start;flex-direction:column}.actions{flex-wrap:wrap}}
`,
  'eslint.config.mjs': String.raw`import eslint from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import tsParser from '@typescript-eslint/parser'
import vue from 'eslint-plugin-vue'

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/drizzle/meta/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...vue.configs['flat/recommended'],
  { files: ['apps/api/**/*.ts'], languageOptions: { globals: globals.node } },
  { files: ['apps/web/src/**/*.{ts,vue}'], languageOptions: { globals: globals.browser } },
  { files: ['apps/web/src/**/*.vue'], languageOptions: { parserOptions: { parser: tsParser } } },
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
  '.env.example': POSTGRES_BACKEND_FILES['.env.example']!,
  '.gitignore': 'node_modules/\napps/*/dist/\n.env\n',
  'docs/DATABASE-SAFETY.md': `# PostgreSQL safety

- PostgreSQL 16+ is user-provided. Generation, dependency installation, startup, health checks, and SQL generation do not provision, connect to, or migrate a database.
- API startup validates DATABASE_URL and creates a lazy connection pool. GET /health is process-only. CRUD connects only when requested; database failures return generic HTTP 503 without credentials or driver details.
- Copy the root .env.example to .env. Keep credentials out of Vue source and VITE_* variables; .env is ignored.
- Review generated SQL before migration. Apply only with npm run db:migrate -- --target host:port/database. The wrapper matches URL target and verifies connected database, role, address, port, and PostgreSQL 16+ version before migrating on that connection.
- Target confirmation is an operator guard, not cryptographic server identity. Direct Drizzle Kit migration remains callable outside wrapper enforcement.
- npm lifecycle and build scripts execute unsandboxed after explicit consent.
`,
}

function scopes(pins: readonly DependencyPin[], scope: 'dependencies' | 'devDependencies') {
  return Object.fromEntries(pins.filter((pin) => (pin.scope ?? 'dependencies') === scope).map(({ packageName, version }) => [packageName, version]))
}

export async function writeVueFullstackStarter(stage: OwnedStage, projectName: string, dependencies: readonly DependencyPin[]): Promise<string[]> {
  const projectPrefix = `${projectName}/`
  const apiRuntime = dependencies.filter(({ packageName }) => ['express', 'drizzle-orm', 'pg'].includes(packageName))
  const apiDev = dependencies.filter(({ packageName }) => ['@types/express', '@types/node', '@types/pg', 'drizzle-kit', 'tsx', 'typescript'].includes(packageName))
  const webRuntime = dependencies.filter(({ packageName }) => ['vue'].includes(packageName))
  const webDev = dependencies.filter(({ packageName }) => ['@types/node', '@vitejs/plugin-vue', 'tsx', 'typescript', 'vite', 'vue-tsc'].includes(packageName))
  const rootDev = dependencies.filter(({ packageName }) => ['@eslint/js', '@typescript-eslint/parser', 'eslint', 'eslint-plugin-vue', 'globals', 'typescript-eslint', 'vue-eslint-parser'].includes(packageName))
  const rootPackage = {
    name: projectName, version: '0.1.0', private: true, type: 'module', engines: { node: '^22.18.0 || >=24.12.0' },
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
    devDependencies: scopes(rootDev, 'devDependencies'),
  }
  const apiPackage = {
    name: `@${projectName}/api`, version: '0.1.0', private: true, type: 'module', engines: { node: '>=22.13.0' },
    scripts: {
      dev: 'node --env-file-if-exists=../../.env --import tsx --watch src/server.ts',
      build: 'tsc --project tsconfig.json', start: 'node --env-file-if-exists=../../.env dist/server.js',
      test: 'node --import tsx --test test/*.test.ts', typecheck: 'tsc --project tsconfig.json --noEmit',
      'db:generate': 'drizzle-kit generate', 'db:migrate': 'node --env-file-if-exists=../../.env --import tsx src/db/migrate.ts',
    },
    dependencies: scopes([...apiRuntime, ...apiDev], 'dependencies'),
    devDependencies: scopes([...apiRuntime, ...apiDev], 'devDependencies'),
  }
  const webPackage = {
    name: `@${projectName}/web`, version: '0.1.0', private: true, type: 'module', engines: { node: '^22.18.0 || >=24.12.0' },
    scripts: { dev: 'vite --host 127.0.0.1', build: 'vite build', typecheck: 'vue-tsc --noEmit --project tsconfig.json', test: 'node --import tsx --test src/services/items.test.ts' },
    dependencies: scopes([...webRuntime, ...webDev], 'dependencies'),
    devDependencies: scopes([...webRuntime, ...webDev], 'devDependencies'),
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
  output['apps/api/src/app.ts'] = output['apps/api/src/app.ts']!.replace('BE-08 Express PostgreSQL API', 'FS-07 Express PostgreSQL API')
  const written = await mutateOwnedStage(stage, [
    'apps', 'apps/web', 'apps/web/src', 'apps/web/src/components', 'apps/web/src/services', 'apps/api', 'apps/api/src', 'apps/api/src/db', 'apps/api/src/routes', 'apps/api/test', 'scripts', 'docs',
  ], Object.entries(output).map(([path, content]) => ({ path: `${projectPrefix}${path}`, content })))
  return written.map((path) => path.slice(projectPrefix.length))
}
