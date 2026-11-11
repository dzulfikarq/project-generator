import { randomUUID } from 'node:crypto'
import { win32 } from 'node:path'
import { GeneratorError } from './errors.js'
import { callSupervisor, type SupervisorResult } from './native-supervisor.js'

const liveStages = new WeakSet<OwnedStage>()

export interface OwnedStage {
  readonly jobId: string
  readonly path: string
  readonly childPath: string
  readonly parentPath: string
  readonly targetPath: string
  readonly markerPath: string
}

function stagingError(code: string, stage: string, message: string, nextAction: string, targetModified = false): GeneratorError {
  return new GeneratorError({ code, stage, message, nextAction, targetModified })
}

function requestFor(stage: OwnedStage, projectName?: string): Record<string, string> {
  return {
    jobId: stage.jobId,
    stagePath: stage.path,
    parentPath: stage.parentPath,
    ...(projectName ? { projectName, targetPath: stage.targetPath } : {}),
  }
}

function checkFsResult(result: SupervisorResult, operation: 'create' | 'cleanup' | 'finalize'): void {
  const { response, exitCode } = result
  if (exitCode === 0 && response.ok === true) return
  const code = typeof response.code === 'string' ? response.code : ''
  if (code === 'elevated_caller') {
    throw stagingError('GEN_ELEVATED_CALLER', 'preflight', 'Generation is blocked in an elevated Windows session.', 'Start Project Generator without administrator elevation and retry.')
  }
  if (operation === 'create') {
    if (code === 'stage_exists' || code === 'entry_exists') throw stagingError('GEN_STAGE_CREATE_FAILED', 'staging', 'Could not create a unique owned staging directory.', 'Check destination permissions and retry.')
    throw stagingError('GEN_STAGE_CREATE_FAILED', 'staging', 'Native staging creation failed closed.', 'Do not modify any retained staging folder; inspect it before retrying.')
  }
  if (operation === 'finalize') {
    if (code === 'target_exists') throw stagingError('GEN_PATH_EXISTS', 'finalizing', 'Destination became occupied before finalization; existing files were not changed.', 'Choose a new destination and retry.')
    if (code === 'unsafe_path') throw stagingError('GEN_PATH_UNSAFE', 'finalizing', 'Staged project or destination failed native path verification.', 'Do not modify staging; inspect it before retrying.')
    throw stagingError('GEN_FINALIZE_FAILED', 'finalizing', 'Native no-replace finalization failed.', 'Inspect both destination and retained staging before retrying.')
  }
  throw stagingError('GEN_STAGING_LEFTOVER', 'cleanup', 'Owned staging could not be safely removed; it was retained.', 'Inspect the recorded staging folder and remove it manually only after confirming ownership.')
}

async function nativeFs(mode: string, request: unknown, operation: 'create' | 'cleanup' | 'finalize'): Promise<void> {
  let result: SupervisorResult
  try {
    result = await callSupervisor(mode, request)
  } catch (error) {
    if (operation === 'finalize') {
      throw stagingError('GEN_FINALIZE_UNCONFIRMED', 'finalizing', 'Could not confirm whether native finalization changed the destination.', 'Do not clean staging or overwrite the destination; inspect both paths before retrying.', true)
    }
    if (operation === 'cleanup') {
      throw stagingError('GEN_STAGING_LEFTOVER', 'cleanup', 'Native cleanup could not be confirmed; staging was retained.', 'Inspect the recorded staging folder and remove it manually only after confirming ownership.')
    }
    throw error
  }
  checkFsResult(result, operation)
}

export async function createOwnedStage(parentPath: string, targetPath: string, projectName: string, jobId: string = randomUUID()): Promise<OwnedStage> {
  const stagePath = win32.join(parentPath, `.project-generator-stage-${jobId}`)
  const stage = Object.freeze({
    jobId,
    path: stagePath,
    childPath: win32.join(stagePath, projectName),
    parentPath,
    targetPath,
    markerPath: win32.join(stagePath, '.ownership.json'),
  })
  await nativeFs('--create-stage', { ...requestFor(stage, projectName) }, 'create')
  liveStages.add(stage)
  return stage
}

export async function cleanupStageSupportFiles(stage: OwnedStage): Promise<void> {
  if (!liveStages.has(stage)) throw stagingError('GEN_STAGING_LEFTOVER', 'cleanup', 'Refused cleanup without a live in-process staging record.', 'Inspect staging manually; do not delete an unverified path.')
  await nativeFs('--cleanup-support', requestFor(stage), 'cleanup')
}

export async function cleanupOwnedStage(stage: OwnedStage): Promise<void> {
  if (!liveStages.has(stage)) throw stagingError('GEN_STAGING_LEFTOVER', 'cleanup', 'Refused cleanup without a live in-process staging record.', 'Inspect staging manually; do not delete an unverified path.')
  await nativeFs('--cleanup-stage', requestFor(stage), 'cleanup')
  liveStages.delete(stage)
}

export async function moveDirectoryNoReplace(stage: OwnedStage): Promise<void> {
  if (process.platform !== 'win32') throw stagingError('GEN_FINALIZE_UNSUPPORTED', 'finalizing', 'Fail-if-exists finalization is supported on Windows only.', 'Run generation on Windows.')
  await nativeFs('--finalize-stage', requestFor(stage, win32.basename(stage.targetPath)), 'finalize')
}
