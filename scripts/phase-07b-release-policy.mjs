import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const result = spawnSync(process.execPath, [join(root, 'scripts', 'phase-06b-release-policy.mjs')], {
  cwd: root,
  env: { ...process.env, PG_POLICY_PHASE: '07B' },
  stdio: 'inherit',
  windowsHide: true,
  timeout: 30 * 60 * 1000,
})
if (result.error) throw result.error
if (result.status !== 0) process.exitCode = result.status ?? 1
