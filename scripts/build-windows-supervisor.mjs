import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

if (process.platform !== 'win32') process.exit(0)

const root = resolve(import.meta.dirname, '..')
const manifest = join(root, 'native', 'windows-supervisor', 'Cargo.toml')
const outputBinary = join(root, 'native', 'windows-supervisor', 'target', 'release', 'pg-windows-supervisor.exe')
const verifierBinary = join(root, 'native', 'windows-supervisor', 'target', 'release', 'pg-db-path-verifier.exe')
const outputDirectory = join(root, 'packages', 'core', 'native')
const output = join(outputDirectory, 'pg-windows-supervisor.exe')
const verifierOutput = join(outputDirectory, 'pg-db-path-verifier.exe')
const debugOnly = process.argv.includes('--debug-only')
const cargo = process.env.CARGO ?? [join(homedir(), '.cargo', 'bin', 'cargo.exe'), 'cargo'].find((path) => path === 'cargo' || existsSync(path))

if (!cargo) throw new Error('Rust Cargo is required to build the Windows process supervisor.')

const args = ['build', '--locked', ...(debugOnly ? [] : ['--release']), '--manifest-path', manifest, '--bin', 'pg-windows-supervisor', '--bin', 'pg-db-path-verifier']
const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
const vswhere = join(programFilesX86, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe')
let vcvars
if (existsSync(vswhere)) {
  const found = spawnSync(vswhere, ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'], { encoding: 'utf8' })
  if (found.status === 0 && found.stdout.trim()) {
    const candidate = join(found.stdout.trim(), 'VC', 'Auxiliary', 'Build', 'vcvars64.bat')
    if (existsSync(candidate)) vcvars = candidate
  }
}

const result = vcvars
  ? spawnSync('cmd.exe', ['/d', '/s', '/c', `"call "${vcvars}" >nul && "${cargo}" ${args.map((arg) => `"${arg}"`).join(' ')}"`], { cwd: root, stdio: 'inherit', windowsVerbatimArguments: true })
  : spawnSync(cargo, args, { cwd: root, stdio: 'inherit' })
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)

if (debugOnly) process.exit(0)
mkdirSync(outputDirectory, { recursive: true })
copyFileSync(outputBinary, output)
copyFileSync(verifierBinary, verifierOutput)
