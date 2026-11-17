import { lstat, realpath, stat } from 'node:fs/promises'
import { win32 } from 'node:path'
import { GeneratorError, configError } from './errors.js'

const reservedName = /^(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|CLOCK\$|COM[1-9¹²³]|LPT[1-9¹²³])(?:\..*)?$/i
const invalidWindowsChars = /[<>:"|?*\x00-\x1f]/

export function validateProjectName(name: string): void {
  if (name.length > 100 || !/^[a-z0-9][a-z0-9._-]*$/.test(name)) {
    throw configError('project.name must be a lowercase npm-safe name (letters, numbers, dot, underscore, hyphen; max 100 characters).')
  }
  if (name.endsWith('.') || name.endsWith(' ') || reservedName.test(name)) {
    throw configError('project.name is not a safe Windows directory name.')
  }
}

export function normalizeWindowsParent(input: string): string {
  if (input.includes('\0') || input.startsWith('\\\\') || input.startsWith('\\?\\') || input.startsWith('\\.\\')) {
    throw configError('project.parentDirectory must be a local Windows drive path, not UNC or a device path.')
  }
  const rawSegments = input.split(/[\\/]/)
  if (rawSegments.some((segment) => segment === '..' || segment === '.' || segment.endsWith('.') || segment.endsWith(' '))) {
    throw configError('project.parentDirectory contains traversal or a Windows-invalid path segment.')
  }
  if (!win32.isAbsolute(input) || !/^[A-Za-z]:[\\/]/.test(input)) {
    throw configError('project.parentDirectory must be an absolute local drive path, such as C:\\Projects.')
  }
  const normalized = win32.normalize(input)
  const components = normalized.slice(3).split('\\').filter(Boolean)
  if (components.some((part) => invalidWindowsChars.test(part) || reservedName.test(part))) {
    throw configError('project.parentDirectory contains a Windows-reserved or invalid path segment.')
  }
  if (normalized.length > 220) throw configError('project.parentDirectory is too long for a safe generated project path.')
  return normalized
}

export function resolveOutputPath(parentDirectory: string, projectName: string): string {
  validateProjectName(projectName)
  const parent = normalizeWindowsParent(parentDirectory)
  const output = win32.join(parent, projectName)
  if (output.length > 240) throw configError('Generated destination path exceeds the supported 240-character limit.')
  return output
}

export function assertNestPostgresInstallPathSafe(parentPath: string, projectName: string, jobId: string): void {
  const stagePath = win32.join(parentPath, `.project-generator-stage-${jobId}`)
  const executablePath = win32.join(stagePath, projectName, 'node_modules', '@esbuild-kit', 'core-utils', 'node_modules', '@esbuild', 'win32-x64', 'esbuild.exe')
  if (executablePath.length > 240) {
    throw pathError(
      'GEN_PATH_UNSAFE',
      `BE-09 dependency installation is blocked because its staged esbuild.exe path would be ${executablePath.length} characters; the conservative Windows limit is 240.`,
      'Choose a shorter parent directory or project name, then rerun generation.',
    )
  }
}

function pathError(code: string, message: string, nextAction: string): GeneratorError {
  return new GeneratorError({ code, stage: 'preflight', message, nextAction, targetModified: false })
}

export async function assertNoReparsePoints(directory: string): Promise<void> {
  const normalized = win32.resolve(directory)
  const root = win32.parse(normalized).root
  let current = root
  for (const component of normalized.slice(root.length).split('\\').filter(Boolean)) {
    current = win32.join(current, component)
    const entry = await lstat(current)
    if (entry.isSymbolicLink()) {
      throw pathError('GEN_PATH_UNSAFE', 'Destination parent contains a symbolic link or junction.', 'Choose a parent path without reparse points.')
    }
  }
}

export async function inspectTarget(parentDirectory: string, projectName: string): Promise<{ targetPath: string; parentPath: string; available: boolean }> {
  const normalizedParent = normalizeWindowsParent(parentDirectory)
  try {
    const parentStat = await stat(normalizedParent)
    if (!parentStat.isDirectory()) throw pathError('GEN_PATH_UNSAFE', 'Destination parent is not a directory.', 'Choose an existing directory as the destination parent.')
  } catch (error) {
    if (error instanceof GeneratorError) throw error
    throw pathError('GEN_PATH_UNSAFE', 'Destination parent does not exist or cannot be accessed.', 'Create or choose an accessible destination parent directory.')
  }
  await assertNoReparsePoints(normalizedParent)
  const parentPath = await realpath(normalizedParent)
  const targetPath = win32.join(parentPath, projectName)
  try {
    await lstat(targetPath)
    throw pathError('GEN_PATH_EXISTS', 'Destination already exists.', 'Choose a new project name or a different destination parent.')
  } catch (error) {
    if (error instanceof GeneratorError) throw error
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw pathError('GEN_PATH_UNSAFE', 'Destination cannot be checked safely.', 'Choose a different destination parent.')
    }
  }
  return { targetPath, parentPath, available: true }
}

export async function assertSafeStageDirectory(stagePath: string, parentPath: string): Promise<void> {
  const stage = await lstat(stagePath)
  if (!stage.isDirectory() || stage.isSymbolicLink()) throw pathError('GEN_PATH_UNSAFE', 'Owned staging path changed unexpectedly.', 'Do not modify the staging path; retry generation.')
  const stageReal = await realpath(stagePath)
  if (win32.dirname(stageReal).toLowerCase() !== parentPath.toLowerCase()) {
    throw pathError('GEN_PATH_UNSAFE', 'Owned staging path escaped its destination parent.', 'Do not modify the staging path; contact support with the job ID.')
  }
}
