import { lstat, readFile, realpath } from 'node:fs/promises'
import { dirname, resolve, win32 } from 'node:path'

export interface NpmTool {
  cliPath: string
  version: string
}

export interface GoExecutable {
  executablePath: string
  directory: string
}

export interface GoTool extends GoExecutable {
  version: string
}

export interface PythonExecutable {
  executablePath: string
  directory: string
}

export interface PhpExecutable {
  executablePath: string
  directory: string
}

export interface UvExecutable {
  executablePath: string
  directory: string
}

export interface ComposerPhar {
  pharPath: string
  directory: string
}

export const LARAVEL_REQUIRED_EXTENSIONS = [
  'ctype', 'curl', 'dom', 'fileinfo', 'filter', 'hash', 'mbstring', 'openssl',
  'pcre', 'pdo', 'session', 'tokenizer', 'xml', 'pdo_mysql',
] as const

function versionParts(version: string): [number, number, number] | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim())
  if (!match) return undefined
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function atLeast(version: string, minimum: [number, number, number]): boolean {
  const parsed = versionParts(version)
  if (!parsed) return false
  for (let index = 0; index < 3; index += 1) {
    if (parsed[index] !== minimum[index]) return parsed[index]! > minimum[index]!
  }
  return true
}

export function supportsNodeForVite(version: string): boolean {
  const major = versionParts(version)?.[0]
  return (major === 20 && atLeast(version, [20, 19, 0])) || ((major ?? 0) >= 22 && atLeast(version, [22, 12, 0]))
}

export function supportsNodeForNext(version: string): boolean {
  return atLeast(version, [20, 9, 0])
}

export function supportsNodeForVue(version: string): boolean {
  const major = versionParts(version)?.[0]
  return (major === 22 && atLeast(version, [22, 18, 0])) || ((major ?? 0) >= 24 && atLeast(version, [24, 12, 0]))
}

export function supportsNodeForNuxt(version: string): boolean {
  const major = versionParts(version)?.[0]
  return (major === 22 && atLeast(version, [22, 22, 3]))
    || (major === 24 && atLeast(version, [24, 15, 0]))
    || (major ?? 0) >= 26
}

export function supportsNodeForAngular(version: string): boolean {
  const major = versionParts(version)?.[0]
  return (major === 20 && atLeast(version, [20, 19, 0]))
    || (major === 22 && atLeast(version, [22, 12, 0]))
    || (major ?? 0) >= 24
}

export function supportsNpm(version: string): boolean {
  return atLeast(version, [10, 0, 0])
}

export function supportsGo(version: string): boolean {
  return atLeast(version, [1, 22, 0])
}

export function supportsGoGin(version: string): boolean {
  return atLeast(version, [1, 25, 0])
}

export function supportsPython(version: string): boolean {
  return /^3\.14\.\d+$/.test(version.trim())
}

export function supportsUv(version: string): boolean {
  return atLeast(version, [0, 8, 0])
}

export function supportsPhp(version: string): boolean {
  const parsed = versionParts(version)
  return parsed !== undefined && parsed[0] === 8 && parsed[1] >= 2
}

export function supportsComposer(version: string): boolean {
  return atLeast(version, [2, 2, 0])
}

async function resolvePathExecutable(fileName: string): Promise<{ executablePath: string; directory: string } | undefined> {
  for (const candidateDirectory of (process.env.PATH ?? '').split(win32.delimiter).filter(Boolean)) {
    const directory = candidateDirectory.replace(/^"(.*)"$/, '$1')
    const executable = resolve(directory, fileName)
    try {
      const [rootEntry, realDirectory, entry, realExecutable] = await Promise.all([
        lstat(directory), realpath(directory), lstat(executable), realpath(executable),
      ])
      const relativePath = win32.relative(realDirectory, realExecutable)
      if (!rootEntry.isDirectory() || rootEntry.isSymbolicLink() || !entry.isFile() || entry.isSymbolicLink()
        || relativePath.startsWith('..') || win32.isAbsolute(relativePath)) continue
      return { executablePath: realExecutable, directory: realDirectory }
    } catch {
      // Ignore absent or inaccessible PATH entries.
    }
  }
  return undefined
}

export async function resolvePythonExecutable(): Promise<PythonExecutable | undefined> {
  return resolvePathExecutable('python.exe')
}

export async function resolveUvExecutable(): Promise<UvExecutable | undefined> {
  return resolvePathExecutable('uv.exe')
}

export async function resolvePhpExecutable(): Promise<PhpExecutable | undefined> {
  return resolvePathExecutable('php.exe')
}

export async function resolveComposerPhar(): Promise<ComposerPhar | undefined> {
  for (const candidateDirectory of (process.env.PATH ?? '').split(win32.delimiter).filter(Boolean)) {
    const directory = candidateDirectory.replace(/^"(.*)"$/, '$1')
    const phar = resolve(directory, 'composer.phar')
    try {
      const [rootEntry, realDirectory, entry, realPhar] = await Promise.all([
        lstat(directory), realpath(directory), lstat(phar), realpath(phar),
      ])
      const relativePath = win32.relative(realDirectory, realPhar)
      if (!rootEntry.isDirectory() || rootEntry.isSymbolicLink() || !entry.isFile() || entry.isSymbolicLink()
        || relativePath.startsWith('..') || win32.isAbsolute(relativePath)) continue
      return { pharPath: realPhar, directory: realDirectory }
    } catch {
      // Ignore absent or inaccessible PATH entries.
    }
  }
  return undefined
}

export async function resolveGoTool(): Promise<GoExecutable | undefined> {
  const candidates = [
    ...(process.env.GOROOT ? [resolve(process.env.GOROOT, 'bin')] : []),
    ...(process.env.PATH ?? '').split(win32.delimiter).filter(Boolean).map((directory) => directory.replace(/^"(.*)"$/, '$1')),
  ]
  for (const directory of candidates) {
    const executable = resolve(directory, 'go.exe')
    try {
      const [rootEntry, realDirectory, entry, realExecutable] = await Promise.all([
        lstat(directory), realpath(directory), lstat(executable), realpath(executable),
      ])
      const relativePath = win32.relative(realDirectory, realExecutable)
      if (!rootEntry.isDirectory() || rootEntry.isSymbolicLink() || !entry.isFile() || entry.isSymbolicLink()
        || relativePath.startsWith('..') || win32.isAbsolute(relativePath)) continue
      return { executablePath: realExecutable, directory: realDirectory }
    } catch {
      // Ignore absent or inaccessible PATH entries.
    }
  }
  return undefined
}

export function supportsNodeForPnpm(version: string): boolean {
  const major = versionParts(version)?.[0]
  return (major === 22 && atLeast(version, [22, 13, 0])) || (major ?? 0) > 22
}

export function supportsNodeForBackend(version: string): boolean {
  return atLeast(version, [22, 13, 0])
}

async function npmAt(path: string, nodeRoot: string): Promise<NpmTool | undefined> {
  try {
    const [entry, realRoot, realScript] = await Promise.all([
      lstat(path),
      realpath(nodeRoot),
      realpath(path),
    ])
    const packageFile = resolve(dirname(path), '..', 'package.json')
    const packageJson = JSON.parse(await readFile(packageFile, 'utf8')) as { name?: string; version?: string }
    const relativePath = win32.relative(realRoot, realScript)
    if (!entry.isFile() || entry.isSymbolicLink() || packageJson.name !== 'npm' || !packageJson.version || relativePath.startsWith('..')) return undefined
    return { cliPath: realScript, version: packageJson.version }
  } catch {
    return undefined
  }
}

export async function resolveNpmTool(): Promise<NpmTool | undefined> {
  const nodeRoot = dirname(await realpath(process.execPath))
  const candidates = [
    resolve(nodeRoot, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    resolve(nodeRoot, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ]
  for (const candidate of candidates) {
    const tool = await npmAt(candidate, nodeRoot)
    if (tool) return tool
  }
  return undefined
}
