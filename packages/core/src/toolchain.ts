import { lstat, readFile, realpath } from 'node:fs/promises'
import { dirname, resolve, win32 } from 'node:path'

export interface NpmTool {
  cliPath: string
  version: string
}

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

export function supportsNpm(version: string): boolean {
  return atLeast(version, [10, 0, 0])
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
