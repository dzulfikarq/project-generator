import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { lstat, mkdir, readFile, readdir, realpath, rm, rmdir, writeFile } from 'node:fs/promises'
import { dirname, win32 } from 'node:path'
import { GeneratorError } from './errors.js'
import { assertSafeStageDirectory, assertNoReparsePoints } from './paths.js'

const liveStages = new WeakSet<OwnedStage>()
const moveScript = '[System.IO.Directory]::Move($env:PG_SOURCE, $env:PG_TARGET)'

export interface OwnedStage {
  readonly jobId: string
  readonly path: string
  readonly childPath: string
  readonly parentPath: string
  readonly targetPath: string
  readonly markerPath: string
}

function stagingError(code: string, stage: string, message: string, nextAction: string): GeneratorError {
  return new GeneratorError({ code, stage, message, nextAction, targetModified: false })
}

export async function createOwnedStage(parentPath: string, targetPath: string, projectName: string, jobId: string = randomUUID()): Promise<OwnedStage> {
  await assertNoReparsePoints(parentPath)
  const canonicalParent = await realpath(parentPath)
  const canonicalTarget = win32.join(canonicalParent, win32.basename(targetPath))
  const targetParent = await realpath(dirname(targetPath))
  if (targetParent.toLowerCase() !== canonicalParent.toLowerCase()) {
    throw stagingError('GEN_PATH_UNSAFE', 'preflight', 'Destination parent changed during preflight.', 'Choose a safe destination and retry.')
  }
  try {
    await lstat(canonicalTarget)
    throw stagingError('GEN_PATH_EXISTS', 'preflight', 'Destination became occupied before staging.', 'Choose a new destination and retry.')
  } catch (error) {
    if (error instanceof GeneratorError) throw error
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw stagingError('GEN_PATH_UNSAFE', 'preflight', 'Destination cannot be checked safely.', 'Choose a different destination.')
  }
  const stagePath = win32.join(canonicalParent, `.project-generator-stage-${jobId}`)
  try {
    await mkdir(stagePath, { recursive: false, mode: 0o700 })
  } catch {
    throw stagingError('GEN_STAGE_CREATE_FAILED', 'staging', 'Could not create a unique owned staging directory.', 'Check destination permissions and retry.')
  }
  const markerPath = win32.join(stagePath, '.ownership.json')
  const stage = Object.freeze({
    jobId,
    path: stagePath,
    childPath: win32.join(stagePath, projectName),
    parentPath: canonicalParent,
    targetPath: canonicalTarget,
    markerPath,
  })
  liveStages.add(stage)
  try {
    await writeFile(markerPath, JSON.stringify({ schemaVersion: 1, jobId, stageName: win32.basename(stagePath) }), { flag: 'wx' })
    await assertSafeStageDirectory(stagePath, canonicalParent)
    return stage
  } catch (error) {
    await cleanupOwnedStage(stage).catch(() => undefined)
    if (error instanceof GeneratorError) throw error
    throw stagingError('GEN_STAGE_CREATE_FAILED', 'staging', 'Could not initialize owned staging metadata.', 'Check destination permissions and retry.')
  }
}

async function removeTreeWithoutFollowingLinks(entryPath: string, parentPath: string): Promise<void> {
  const entry = await lstat(entryPath)
  if (entry.isSymbolicLink()) {
    await rm(entryPath, { recursive: false, force: false })
    return
  }
  const canonical = await realpath(entryPath)
  if (!canonical.toLowerCase().startsWith(`${parentPath.toLowerCase()}\\`) && canonical.toLowerCase() !== parentPath.toLowerCase()) {
    throw stagingError('GEN_STAGING_LEFTOVER', 'cleanup', 'Owned staging contains a path outside its recorded boundary.', 'Leave staging untouched and remove it manually only after inspection.')
  }
  if (!entry.isDirectory()) {
    await rm(entryPath, { force: false })
    return
  }
  for (const child of await readdir(entryPath)) await removeTreeWithoutFollowingLinks(win32.join(entryPath, child), canonical)
  await rmdir(entryPath)
}

async function validateOwnership(stage: OwnedStage): Promise<string> {
  if (!liveStages.has(stage)) throw new Error('No live in-process owner.')
  await assertSafeStageDirectory(stage.path, stage.parentPath)
  const markerEntry = await lstat(stage.markerPath)
  if (!markerEntry.isFile() || markerEntry.isSymbolicLink()) throw new Error('Ownership metadata is not a regular file.')
  const marker = JSON.parse(await readFile(stage.markerPath, 'utf8')) as { schemaVersion?: number; jobId?: string; stageName?: string }
  if (marker.schemaVersion !== 1 || marker.jobId !== stage.jobId || marker.stageName !== win32.basename(stage.path)) throw new Error('Ownership metadata mismatch.')
  return realpath(stage.path)
}

export async function cleanupStageSupportFiles(stage: OwnedStage): Promise<void> {
  try {
    const stageRoot = await validateOwnership(stage)
    for (const name of ['.tools', '.home', '.tmp', '.npm-cache', '.npmrc-user', '.npmrc-global']) {
      const path = win32.join(stage.path, name)
      try {
        await lstat(path)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
        throw error
      }
      await removeTreeWithoutFollowingLinks(path, stageRoot)
    }
  } catch {
    throw stagingError('GEN_STAGING_LEFTOVER', 'cleanup', 'Temporary tool files could not be safely removed.', 'Leave staging untouched and inspect it manually before retrying.')
  }
}

export async function cleanupOwnedStage(stage: OwnedStage): Promise<void> {
  if (!liveStages.has(stage)) {
    throw stagingError('GEN_STAGING_LEFTOVER', 'cleanup', 'Refused cleanup without a live in-process staging record.', 'Inspect the staging directory manually; do not delete an unverified path.')
  }
  try {
    await validateOwnership(stage)
    await removeTreeWithoutFollowingLinks(stage.path, stage.parentPath)
    liveStages.delete(stage)
  } catch {
    throw stagingError('GEN_STAGING_LEFTOVER', 'cleanup', 'Owned staging could not be safely removed; it was retained.', 'Inspect the recorded staging folder and remove it manually only after confirming ownership.')
  }
}

export async function moveDirectoryNoReplace(stage: OwnedStage): Promise<void> {
  if (process.platform !== 'win32') throw stagingError('GEN_FINALIZE_UNSUPPORTED', 'finalizing', 'Fail-if-exists finalization is supported on Windows only.', 'Run generation on Windows.')
  await assertSafeStageDirectory(stage.path, stage.parentPath)
  const child = await lstat(stage.childPath)
  if (!child.isDirectory() || child.isSymbolicLink()) throw stagingError('GEN_PATH_UNSAFE', 'finalizing', 'Staged project directory changed unexpectedly.', 'Do not modify staging; retry generation.')
  const sourceParent = await realpath(dirname(stage.childPath))
  if (sourceParent.toLowerCase() !== stage.path.toLowerCase()) throw stagingError('GEN_PATH_UNSAFE', 'finalizing', 'Staged project escaped its owned directory.', 'Do not modify staging; retry generation.')

  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR ?? 'C:\\Windows'
  const powershell = win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const result = await new Promise<{ code: number | null; failedToStart: boolean }>((resolveResult) => {
    const childProcess = spawn(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', moveScript], {
      cwd: stage.parentPath,
      env: { SystemRoot: systemRoot, WINDIR: systemRoot, PATH: win32.join(systemRoot, 'System32'), PG_SOURCE: stage.childPath, PG_TARGET: stage.targetPath },
      shell: false,
      windowsHide: true,
      stdio: 'ignore',
    })
    childProcess.once('error', () => resolveResult({ code: null, failedToStart: true }))
    childProcess.once('close', (code) => resolveResult({ code, failedToStart: false }))
  })
  if (result.failedToStart) throw stagingError('GEN_FINALIZE_FAILED', 'finalizing', 'Could not start the reviewed Windows no-replace directory move.', 'Check Windows PowerShell availability and retry.')
  if (result.code !== 0) {
    try {
      await lstat(stage.targetPath)
      throw stagingError('GEN_PATH_EXISTS', 'finalizing', 'Destination became occupied before finalization; existing files were not changed.', 'Choose a new destination and retry.')
    } catch (error) {
      if (error instanceof GeneratorError) throw error
      throw stagingError('GEN_FINALIZE_FAILED', 'finalizing', 'Windows refused the final directory move; destination was not changed by the generator.', 'Review the redacted job log and retry with a new destination.')
    }
  }
}
