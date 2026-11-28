import { randomBytes, randomUUID } from 'node:crypto'
import { win32 } from 'node:path'
import { GeneratorError } from './errors.js'
import { callSupervisor, type SupervisorResult } from './native-supervisor.js'

const liveStages = new WeakSet<OwnedStage>()

export interface OwnedStage {
  readonly jobId: string
  readonly transactionNonce: string
  readonly journalRootPath: string
  readonly path: string
  readonly childPath: string
  readonly parentPath: string
  readonly targetPath: string
  readonly markerPath: string
}

export interface OwnedStageFile {
  readonly path: string
  readonly content: string
  readonly replace?: boolean
  readonly skipExisting?: boolean
}

function stagingError(code: string, stage: string, message: string, nextAction: string, targetModified = false): GeneratorError {
  return new GeneratorError({ code, stage, message, nextAction, targetModified })
}

function requestFor(stage: OwnedStage, projectName = win32.basename(stage.targetPath), modulePath?: string, manifestFile?: string): Record<string, string> {
  return {
    jobId: stage.jobId,
    transactionNonce: stage.transactionNonce,
    journalRootPath: stage.journalRootPath,
    stagePath: stage.path,
    parentPath: stage.parentPath,
    projectName,
    ...(modulePath ? { modulePath } : {}),
    ...(manifestFile ? { manifestFile } : {}),
    targetPath: stage.targetPath,
    sourcePath: stage.childPath,
  }
}

export function checkFsResult(result: SupervisorResult, operation: 'bind' | 'create' | 'scaffold' | 'cleanup' | 'finalize' | 'write'): void {
  const { response, exitCode } = result
  if (operation === 'finalize'
    && !((exitCode === 0 && response.ok === true) || (exitCode === 1 && response.ok === false))) {
    throw stagingError('GEN_FINALIZE_UNCONFIRMED', 'finalizing', 'Native finalization response and process exit status are inconsistent or incomplete; destination state is uncertain.', 'Do not clean staging or overwrite the destination; inspect both paths before retrying.', true)
  }
  if (exitCode === 0 && response.ok === true) return
  const code = typeof response.code === 'string' ? response.code : ''
  if (code === 'elevated_caller') {
    throw stagingError('GEN_ELEVATED_CALLER', 'preflight', 'Generation is blocked in an elevated Windows session.', 'Start Project Generator without administrator elevation and retry.')
  }
  if (operation === 'create' && code === 'stage_orphaned') {
    throw stagingError('GEN_STAGING_LEFTOVER', 'staging', 'Staging creation failed and its partial directory could not be safely removed.', 'Inspect the staging path associated with this job before retrying.')
  }
  if (code === 'stage_identity_mismatch') {
    throw stagingError('GEN_STAGE_IDENTITY_MISMATCH', 'finalizing', 'Staged project directory identity changed after scaffold creation; staging was retained.', 'Do not clean staging or overwrite the destination; inspect the stage and target before retrying.')
  }
  if (operation === 'bind' || code === 'stage_identity_unconfirmed') {
    throw stagingError('GEN_STAGE_IDENTITY_UNCONFIRMED', 'scaffolding', 'Native project identity could not be bound or verified; staging was retained.', 'Do not clean staging or overwrite the destination; inspect the stage before retrying.')
  }
  if (operation === 'scaffold') {
    if (code === 'scaffold_invalid') throw stagingError('GEN_SCAFFOLD_INVALID', 'scaffolding', 'Generated project manifest is missing or its identity does not match the reviewed selection.', 'Review the generated package manifest and retry.')
    throw stagingError('GEN_STAGE_IDENTITY_UNCONFIRMED', 'scaffolding', 'Native scaffold identity verification could not be confirmed; staging was retained.', 'Do not clean staging; inspect it before retrying.')
  }
  if (operation === 'write') {
    if (code === 'unsafe_path') throw stagingError('GEN_PATH_UNSAFE', 'configuring', 'A generated file path failed native handle validation.', 'Inspect staging for reparse points and retry with a new destination.')
    if (code === 'native_fs_unconfirmed') throw stagingError('GEN_STAGING_LEFTOVER', 'configuring', 'A native staging mutation could not be confirmed; staging was retained.', 'Inspect staging before retrying; do not remove it automatically.')
    throw stagingError('GEN_CONFIGURE_FAILED', 'configuring', 'Native staging file operation failed closed.', 'Inspect the local redacted job log and retry from a new destination.')
  }
  if (operation === 'create') {
    if (code === 'stage_exists' || code === 'entry_exists') throw stagingError('GEN_STAGE_CREATE_FAILED', 'staging', 'Could not create a unique owned staging directory.', 'Check destination permissions and retry.')
    throw stagingError('GEN_STAGE_CREATE_FAILED', 'staging', 'Native staging creation failed closed.', 'Do not modify any retained staging folder; inspect it before retrying.')
  }
  if (operation === 'finalize') {
    if (code === 'finalize_unconfirmed') throw stagingError('GEN_FINALIZE_UNCONFIRMED', 'finalizing', 'Native finalization returned success, but destination identity could not be verified.', 'Do not clean staging or overwrite the destination; inspect both paths before retrying.', true)
    if (code === 'native_fs_unconfirmed') throw stagingError('GEN_FINALIZE_UNCONFIRMED', 'finalizing', 'Native finalization operation could not be confirmed.', 'Do not clean staging or overwrite the destination; inspect both paths before retrying.', true)
    if (code === 'target_exists') throw stagingError('GEN_PATH_EXISTS', 'finalizing', 'Destination became occupied before finalization; existing files were not changed.', 'Choose a new destination and retry.')
    if (code === 'unsafe_path') throw stagingError('GEN_PATH_UNSAFE', 'finalizing', 'Staged project or destination failed native path verification.', 'Do not modify staging; inspect it before retrying.')
    throw stagingError('GEN_FINALIZE_FAILED', 'finalizing', 'Native no-replace finalization failed.', 'Inspect both destination and retained staging before retrying.')
  }
  throw stagingError('GEN_STAGING_LEFTOVER', 'cleanup', 'Owned staging could not be safely removed; it was retained.', 'Inspect the recorded staging folder and remove it manually only after confirming ownership.')
}

async function nativeFs(mode: string, request: unknown, operation: 'bind' | 'create' | 'scaffold' | 'cleanup' | 'finalize' | 'write'): Promise<SupervisorResult> {
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
    if (operation === 'write') {
      throw stagingError('GEN_STAGING_LEFTOVER', 'configuring', 'Native staging mutation could not be confirmed; staging was retained.', 'Inspect staging before retrying; do not remove it automatically.')
    }
    if (operation === 'bind') {
      throw stagingError('GEN_STAGE_IDENTITY_UNCONFIRMED', 'scaffolding', 'Native project identity could not be bound; staging was retained.', 'Do not clean staging; inspect it before retrying.')
    }
    if (operation === 'scaffold') {
      throw stagingError('GEN_STAGE_IDENTITY_UNCONFIRMED', 'scaffolding', 'Native scaffold identity verification could not be confirmed; staging was retained.', 'Do not clean staging; inspect it before retrying.')
    }
    throw error
  }
  checkFsResult(result, operation)
  return result
}

export async function createOwnedStage(parentPath: string, targetPath: string, projectName: string, jobId: string = randomUUID()): Promise<OwnedStage> {
  const localAppData = process.env.LOCALAPPDATA
  if (!localAppData || !win32.isAbsolute(localAppData)) {
    throw stagingError('GEN_JOURNAL_UNAVAILABLE', 'staging', 'Protected transaction journal location is unavailable.', 'Restore the Windows LOCALAPPDATA environment and retry.')
  }
  const transactionNonce = randomBytes(32).toString('hex')
  const journalRootPath = win32.join(localAppData, '.project-generator-transactions')
  const stagePath = win32.join(parentPath, `.project-generator-stage-${jobId}`)
  const stage = Object.freeze({
    jobId,
    transactionNonce,
    journalRootPath,
    path: stagePath,
    childPath: win32.join(stagePath, projectName),
    parentPath,
    targetPath,
    markerPath: win32.join(stagePath, '.ownership.json'),
  })
  await nativeFs('--create-journal', {
    ...requestFor(stage, projectName),
  }, 'create')
  await nativeFs('--create-stage', { ...requestFor(stage, projectName) }, 'create')
  liveStages.add(stage)
  return stage
}

export async function markOwnedStageGenerating(stage: OwnedStage): Promise<void> {
  if (!liveStages.has(stage)) throw stagingError('GEN_STAGING_LEFTOVER', 'staging', 'Refused generation phase update without a live in-process staging record.', 'Inspect staging manually; do not write to an unverified path.')
  await nativeFs('--journal-phase', { ...requestFor(stage), phase: 'generating' }, 'write')
}

export async function cleanupStageSupportFiles(stage: OwnedStage): Promise<void> {
  if (!liveStages.has(stage)) throw stagingError('GEN_STAGING_LEFTOVER', 'cleanup', 'Refused cleanup without a live in-process staging record.', 'Inspect staging manually; do not delete an unverified path.')
  await nativeFs('--cleanup-support', requestFor(stage), 'cleanup')
}

export async function bindOwnedStageProjectIdentity(stage: OwnedStage, projectName: string): Promise<void> {
  if (!liveStages.has(stage)) throw stagingError('GEN_STAGING_LEFTOVER', 'scaffolding', 'Refused project identity binding without a live in-process staging record.', 'Inspect staging manually; do not clean an unverified path.')
  await nativeFs('--bind-stage-identity', requestFor(stage, projectName), 'bind')
}

export async function verifyOwnedStageProjectIdentity(stage: OwnedStage, projectName: string, modulePath?: string, manifestFile?: 'composer.json' | 'pyproject.toml'): Promise<void> {
  if (!liveStages.has(stage)) throw stagingError('GEN_STAGING_LEFTOVER', 'scaffolding', 'Refused project identity verification without a live in-process staging record.', 'Inspect staging manually; do not clean an unverified path.')
  await nativeFs('--verify-scaffold-identity', requestFor(stage, projectName, modulePath, manifestFile), 'scaffold')
}

export async function mutateOwnedStage(
  stage: OwnedStage,
  directories: readonly string[],
  files: readonly OwnedStageFile[],
  includePathVerifier = false,
): Promise<string[]> {
  if (!liveStages.has(stage)) throw stagingError('GEN_STAGING_LEFTOVER', 'configuring', 'Refused staging mutation without a live in-process ownership record.', 'Inspect staging manually; do not write to an unverified path.')
  const result = await nativeFs('--prepare-stage', {
    ...requestFor(stage),
    directories,
    files: files.map((file) => ({ ...file, replace: file.replace ?? false, skipExisting: file.skipExisting ?? false })),
    ...(includePathVerifier ? { includePathVerifier: true } : {}),
  }, 'write')
  if (!Array.isArray(result.response.writtenFiles) || !result.response.writtenFiles.every((path) => typeof path === 'string')) {
    throw stagingError('GEN_CONFIGURE_FAILED', 'configuring', 'Native staging file operation returned an invalid response.', 'Inspect the local redacted job log and retry from a new destination.')
  }
  return result.response.writtenFiles as string[]
}

export async function cleanupOwnedStage(stage: OwnedStage): Promise<void> {
  if (!liveStages.has(stage)) throw stagingError('GEN_STAGING_LEFTOVER', 'cleanup', 'Refused cleanup without a live in-process staging record.', 'Inspect staging manually; do not delete an unverified path.')
  await nativeFs('--cleanup-stage', requestFor(stage), 'cleanup')
  liveStages.delete(stage)
}

export async function moveDirectoryNoReplace(stage: OwnedStage): Promise<void> {
  if (process.platform !== 'win32') throw stagingError('GEN_FINALIZE_UNSUPPORTED', 'finalizing', 'Fail-if-exists finalization is supported on Windows only.', 'Run generation on Windows.')
  if (!liveStages.has(stage)) throw stagingError('GEN_STAGING_LEFTOVER', 'finalizing', 'Refused finalization without a live in-process staging record.', 'Inspect staging manually; do not move an unverified path.')
  await nativeFs('--finalize-stage', requestFor(stage, win32.basename(stage.targetPath)), 'finalize')
}

export interface RecoveryReport {
  jobId: string
  phase: string
  state: string
  parentPath: string
  stagePath: string
  sourcePath: string
  targetPath: string
  canFinalize: boolean
  canCleanupStage: boolean
  canDiscardJournal: boolean
  detail: string
}

export function recoveryFailureDetails(result: SupervisorResult) {
  const code = result.response.code
  return {
    category: result.response.ok === false ? 'supervisor_rejected' : 'invalid_response',
    code: typeof code === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(code) ? code : 'unknown',
    exitCode: Number.isSafeInteger(result.exitCode) ? result.exitCode : null,
  }
}

function journalRootPath(): string {
  const localAppData = process.env.LOCALAPPDATA
  if (!localAppData || !win32.isAbsolute(localAppData)) {
    throw stagingError('GEN_JOURNAL_UNAVAILABLE', 'recovery', 'Protected transaction journal location is unavailable.', 'Restore the Windows LOCALAPPDATA environment.')
  }
  return win32.join(localAppData, '.project-generator-transactions')
}

export async function inspectRecovery(jobId?: string): Promise<RecoveryReport[]> {
  const result = await callSupervisor('--recovery-inspect', { journalRootPath: journalRootPath(), ...(jobId ? { jobId } : {}) })
  if (result.exitCode !== 0 || result.response.ok !== true || !Array.isArray(result.response.reports)) {
    const failure = recoveryFailureDetails(result)
    throw stagingError('GEN_RECOVERY_INSPECT_FAILED', 'recovery', `Native recovery inspection could not verify the transaction journal (category=${failure.category}, code=${failure.code}, supervisorExitCode=${failure.exitCode ?? 'unknown'}).`, 'Preserve stage and target paths; inspect manually.')
  }
  return result.response.reports as RecoveryReport[]
}

export async function applyRecovery(jobId: string, action: 'cleanup' | 'finalize', confirmJobId: string): Promise<void> {
  if (jobId !== confirmJobId) {
    throw stagingError('GEN_RECOVERY_CONFIRMATION_REQUIRED', 'recovery', 'Recovery confirmation must exactly match the transaction job ID.', 'Pass --confirm-job with the complete job ID shown by recovery inspect.')
  }
  await nativeFs('--recovery-apply', {
    journalRootPath: journalRootPath(),
    jobId,
    action,
    confirmJobId,
  }, action === 'finalize' ? 'finalize' : 'cleanup')
}
