import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { cp, mkdtemp, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve, win32 } from 'node:path'

if (process.platform !== 'win32') throw new Error('Phase 06B packaged release-policy check requires Windows.')

const root = resolve(import.meta.dirname, '..')
const tempBase = join(process.env.LOCALAPPDATA ?? win32.join(homedir(), 'AppData', 'Local'), 'Temp', 'opencode')
const cliDist = join(root, 'packages', 'cli', 'dist', 'src')
const coreDist = join(root, 'packages', 'core', 'dist', 'src')
const corePackage = join(root, 'packages', 'core', 'package.json')
const npmSource = join(dirname(process.execPath), 'node_modules', 'npm')
const packagedSmoke = join(root, 'scripts', 'packaged-cli-policy-smoke.mjs')
const tempRoot = await mkdtemp(join(tempBase, 'phase-06b-release-policy-'))

function copyJavaScriptTree(source, destination) {
  mkdirSync(destination, { recursive: true })
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name)
    const to = join(destination, entry.name)
    if (entry.isDirectory()) copyJavaScriptTree(from, to)
    else if (entry.isFile() && entry.name.endsWith('.js')) cpSync(from, to)
  }
}

function run(mode, resources) {
  const result = spawnSync(process.execPath, [packagedSmoke, mode, resources], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 10 * 60 * 1000,
    maxBuffer: 30 * 1024 * 1024,
    env: { ...process.env },
  })
  if (result.error) throw result.error
  assert.equal(result.status, 0, `${mode} packaged policy smoke failed:\n${result.stdout}\n${result.stderr}`)
  return result.stdout.trim()
}

try {
  for (const path of [cliDist, coreDist, corePackage, npmSource, packagedSmoke]) assert.ok(existsSync(path), `missing release input: ${path}`)
  const supervisor = join(root, 'packages', 'core', 'native', 'pg-windows-supervisor.exe')
  const pathVerifier = join(root, 'packages', 'core', 'native', 'pg-db-path-verifier.exe')
  for (const path of [supervisor, pathVerifier]) assert.ok(existsSync(path), `missing packaged native input: ${path}`)

  for (const mode of ['system', 'bundled']) {
    const resources = join(tempRoot, mode)
    const cli = join(resources, 'cli')
    const core = join(cli, 'node_modules', '@project-generator', 'core')
    mkdirSync(join(cli, 'dist', 'src'), { recursive: true })
    mkdirSync(join(core, 'dist', 'src'), { recursive: true })
    copyJavaScriptTree(cliDist, join(cli, 'dist', 'src'))
    copyJavaScriptTree(coreDist, join(core, 'dist', 'src'))
    writeFileSync(join(cli, 'package.json'), JSON.stringify({ name: '@project-generator/cli', private: true, type: 'module' }))
    writeFileSync(join(core, 'package.json'), readFileSync(corePackage, 'utf8'))
    mkdirSync(join(core, 'native'), { recursive: true })
    cpSync(supervisor, join(core, 'native', 'pg-windows-supervisor.exe'))
    cpSync(pathVerifier, join(core, 'native', 'pg-db-path-verifier.exe'))
    if (mode === 'bundled') {
      mkdirSync(join(resources, 'runtime', 'node_modules'), { recursive: true })
      cpSync(process.execPath, join(resources, 'runtime', 'node.exe'))
      await cp(npmSource, join(resources, 'runtime', 'node_modules', 'npm'), { recursive: true })
    }
    const output = run(mode, resources)
    assert.match(output, new RegExp(`Packaged ${mode} CLI policy smoke passed`))
  }
  console.log('Phase 06B packaged release policy passed for system and bundled Node; BE-08 remains planned and blocked before staging.')
} finally {
  await rm(tempRoot, { recursive: true, force: true })
}
