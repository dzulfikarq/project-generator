#!/usr/bin/env node
import { lstat, readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { resolve, win32 } from 'node:path'
import { ALLOW_PLANNED_RECIPE_GENERATION, applyRecovery, catalog, createPlan, generateProject, GeneratorError, inspectRecovery, parseSelectionJson, runDoctor } from '@project-generator/core'
import { listenForDesktopCancel } from './desktop-control.js'

const usage = `Project Generator CLI 0.1.0

Usage:
  project-generator catalog --json
  project-generator plan --config <file> --json
  project-generator doctor --config <file> [--json]
  project-generator generate --config <file> --jsonl [--allow-dependency-scripts]${ALLOW_PLANNED_RECIPE_GENERATION ? ' [--development-allow-planned]' : ''} [--desktop-control]
  project-generator inspect --output <folder> [--json]
  project-generator recovery inspect [--job-id <id>] [--json]
  project-generator recovery apply --job-id <id> --action <cleanup|finalize> --confirm-job <id> [--json]

Frontend recipes: FE-01 React + Vite + TypeScript + npm + CSS; FE-02 Next.js App Router + TypeScript + npm + Tailwind; FE-03 Vue + Vite + TypeScript + npm + CSS; FE-04 React + Vite + Bootstrap 5 CSS + npm; FE-05 Vue + Vite + Bootstrap 5 CSS + npm; FE-06 Nuxt 4 + npm + CSS; FE-07 Angular 21 + npm + SCSS; FE-08 React + Vite + SCSS + npm; FE-09 Vue + Vite + SCSS + npm; FE-10 React + Vite + Tailwind CSS 4 + npm; FE-11 Vue + Vite + Tailwind CSS 4 + npm.
Backend recipes: BE-01 Express + npm; BE-02 Go net/http + Go Modules; BE-05 Laravel 12 + PHP/Composer + MySQL/Eloquent; BE-06 FastAPI + uv. Laravel does not provision or migrate a database.
All FE-01–FE-15, BE-01, BE-02, BE-05, BE-06, and FM-01/FM-02 recipes remain planned until independent Windows acceptance and review. Normal generation refuses planned recipes.
The development-only flag runs a planned recipe for evidence gathering; it does not mark that recipe tested.
Optional Forma selections live in config.template; inspect the pinned catalog with catalog --json. Forma template combos FM-01/FM-02 are also planned and require the development-only flag. Private fetch uses Git for Windows' configured credential manager; config never accepts tokens.
npm and uv installs may execute third-party lifecycle/build code and are not sandboxed; pass --allow-dependency-scripts only after reviewing the plan. BE-05 uses the same explicit consent gate because Composer downloads packages and Artisan/PHPUnit load third-party PHP code; Composer plugins and root scripts are disabled. BE-02 has no third-party dependencies. BE-06 requires user-managed Python 3.14 and uv; automatic Python downloads are disabled.`

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  const value = index < 0 ? undefined : args[index + 1]
  return value && !value.startsWith('--') ? value : undefined
}

function validateFlags(args: string[], valueFlags: readonly string[], switchFlags: readonly string[]): void {
  const seen = new Set<string>()
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]!
    if (seen.has(flag)) throw new GeneratorError({ code: 'GEN_CLI_USAGE', stage: 'cli', message: `Repeated option: ${flag}`, nextAction: 'Pass each CLI option once.', targetModified: false })
    seen.add(flag)
    if (valueFlags.includes(flag)) {
      const value = args[index + 1]
      if (!value || value.startsWith('--')) throw new GeneratorError({ code: 'GEN_CLI_USAGE', stage: 'cli', message: `Option ${flag} requires a value.`, nextAction: `Pass ${flag} <value>.`, targetModified: false })
      index += 1
    } else if (!switchFlags.includes(flag)) {
      throw new GeneratorError({ code: 'GEN_CLI_USAGE', stage: 'cli', message: `Unknown option: ${flag}`, nextAction: 'Run project-generator --help.', targetModified: false })
    }
  }
}

async function loadSelection(configPath: string) {
  try {
    return parseSelectionJson(await readFile(configPath, 'utf8'))
  } catch (error) {
    if (error instanceof GeneratorError) throw error
    throw new GeneratorError({ code: 'GEN_CONFIG_INVALID', stage: 'plan', message: 'Could not read config file.', nextAction: 'Check the config path and JSON syntax.', targetModified: false })
  }
}

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

function writeEvent(event: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(event)}\n`)
}

function exitCodeFor(error: GeneratorError): number {
  if (error.code === 'GEN_CONFIG_INVALID' || error.code === 'GEN_CLI_USAGE') return 2
  if (error.code === 'GEN_PATH_EXISTS') return 6
  if (error.code === 'GEN_CANCELLED') return 5
  if (error.stage === 'preflight' || error.code === 'GEN_RECIPE_UNTESTED' || error.code === 'GEN_INCOMPATIBLE') return 3
  return 4
}

function jsonlError(error: GeneratorError): void {
  const jobId = randomUUID()
  const timestamp = new Date().toISOString()
  writeEvent({ schemaVersion: 1, jobId, sequence: 1, timestamp, type: 'job-started', stageOwner: 'cli', status: 'running', message: 'Generation request received.' })
  writeEvent({ schemaVersion: 1, jobId, sequence: 2, timestamp: new Date().toISOString(), type: 'error', stageId: error.stage, stageOwner: 'cli', code: error.code, message: error.message })
  writeEvent({ schemaVersion: 1, jobId, sequence: 3, timestamp: new Date().toISOString(), type: 'job-finished', stageOwner: 'cli', status: 'failed', code: error.code, message: 'Generation failed before staging.' })
}

function humanPlan(plan: ReturnType<typeof createPlan>): void {
  process.stdout.write(`Recipe ${plan.recipeId} (${plan.recipeStatus})\nTarget ${plan.targetPath}\n\n`)
  for (const [index, step] of plan.steps.entries()) process.stdout.write(`${index + 1}. ${step.readableSummary}\n`)
  process.stdout.write(`\nNetwork: ${plan.networkAccess.join(', ')}\nLifecycle scripts: ${plan.executesDependencyLifecycleScripts ? 'may execute third-party code' : 'none'}\n`)
  process.stdout.write(`Dependency execution consent: ${plan.requiresDependencyConsent ? 'required' : 'not required'}\n`)
  process.stdout.write(`Execution: ${plan.executionAvailable ? 'available' : 'blocked until recipe is tested'}\n`)
}

async function inspectOutput(output: string): Promise<Record<string, unknown>> {
  const absolute = resolve(output)
  let directoryInfo
  try {
    directoryInfo = await lstat(absolute)
  } catch {
    throw new GeneratorError({ code: 'GEN_INSPECT_METADATA_MISSING', stage: 'inspect', message: 'Output directory does not exist or cannot be accessed.', nextAction: 'Pass an existing Project Generator output folder.', targetModified: false })
  }
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) {
    throw new GeneratorError({ code: 'GEN_PATH_UNSAFE', stage: 'inspect', message: 'Output must be a regular project directory.', nextAction: 'Pass the generated project directory.', targetModified: false })
  }
  const metadataDirectory = win32.join(absolute, '.project-generator')
  let metadataInfo
  try {
    metadataInfo = await lstat(metadataDirectory)
  } catch {
    throw new GeneratorError({ code: 'GEN_INSPECT_METADATA_MISSING', stage: 'inspect', message: 'Generator metadata directory is missing.', nextAction: 'Pass a Project Generator output folder.', targetModified: false })
  }
  if (!metadataInfo.isDirectory() || metadataInfo.isSymbolicLink()) throw new GeneratorError({ code: 'GEN_PATH_UNSAFE', stage: 'inspect', message: 'Generator metadata directory is unsafe.', nextAction: 'Inspect the output folder manually.', targetModified: false })
  const manifestPath = win32.join(metadataDirectory, 'manifest.json')
  let manifestInfo
  try {
    manifestInfo = await lstat(manifestPath)
  } catch {
    throw new GeneratorError({ code: 'GEN_INSPECT_METADATA_MISSING', stage: 'inspect', message: 'Generator manifest is missing.', nextAction: 'Pass a Project Generator output folder.', targetModified: false })
  }
  if (!manifestInfo.isFile() || manifestInfo.isSymbolicLink()) {
    throw new GeneratorError({ code: 'GEN_INSPECT_METADATA_MISSING', stage: 'inspect', message: 'Generator manifest is missing or unsafe.', nextAction: 'Pass a Project Generator output folder.', targetModified: false })
  }
  let manifest: Record<string, unknown>
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>
  } catch {
    throw new GeneratorError({ code: 'GEN_INSPECT_METADATA_INVALID', stage: 'inspect', message: 'Generator manifest is not valid JSON.', nextAction: 'Use a compatible Project Generator version or inspect the file manually.', targetModified: false })
  }
  if (manifest.schemaVersion !== 1) throw new GeneratorError({ code: 'GEN_INSPECT_METADATA_INVALID', stage: 'inspect', message: 'Generator manifest schema is unsupported.', nextAction: 'Use a compatible Project Generator version.', targetModified: false })
  let packageLock = false
  try {
    const entry = await lstat(win32.join(absolute, 'package-lock.json'))
    packageLock = entry.isFile() && !entry.isSymbolicLink()
  } catch {
    packageLock = false
  }
  return {
    schemaVersion: 1,
    outputPath: absolute,
    recipeId: manifest.recipeId,
    recipeStatusAtCreation: manifest.recipeStatusAtCreation,
    packageLock,
    validation: manifest.validation,
    note: 'Inspection reads metadata only; it does not infer current build readiness.',
  }
}

async function main(args: string[]): Promise<number> {
  const [command, ...flags] = args
  if (!command || command === '--help' || command === '-h') {
    process.stdout.write(`${usage}\n`)
    return 0
  }
  try {
    if (command === 'catalog') {
      validateFlags(flags, [], ['--json'])
      if (flags.length !== 1 || flags[0] !== '--json') throw new GeneratorError({ code: 'GEN_CLI_USAGE', stage: 'cli', message: 'catalog requires --json.', nextAction: 'Run project-generator catalog --json.', targetModified: false })
      writeJson({ schemaVersion: 1, ok: true, data: catalog() })
      return 0
    }
    if (command === 'plan') {
      validateFlags(flags, ['--config'], ['--json'])
      const configPath = option(flags, '--config')
      if (!configPath) throw new GeneratorError({ code: 'GEN_CONFIG_INVALID', stage: 'plan', message: 'Missing --config path.', nextAction: 'Pass --config <file>.', targetModified: false })
      const plan = createPlan(await loadSelection(configPath))
      if (flags.includes('--json')) writeJson({ schemaVersion: 1, ok: true, data: plan })
      else humanPlan(plan)
      return 0
    }
    if (command === 'doctor') {
      validateFlags(flags, ['--config'], ['--json'])
      const configPath = option(flags, '--config')
      if (!configPath) throw new GeneratorError({ code: 'GEN_CONFIG_INVALID', stage: 'doctor', message: 'Missing --config path.', nextAction: 'Pass --config <file>.', targetModified: false })
      const report = await runDoctor(await loadSelection(configPath))
      if (flags.includes('--json')) writeJson({ schemaVersion: 1, ok: true, data: report })
      else {
        for (const tool of report.tools) process.stdout.write(`${tool.available ? 'PASS' : 'BLOCK'} ${tool.id}: ${tool.message}${tool.version ? ` (${tool.version})` : ''}\n`)
        process.stdout.write(`Target: ${report.target.message}\n`)
      }
      return report.ready ? 0 : 3
    }
    if (command === 'generate') {
      if (flags.includes('--development-allow-planned') && !ALLOW_PLANNED_RECIPE_GENERATION) {
        throw new GeneratorError({ code: 'GEN_RECIPE_UNTESTED', stage: 'preflight', message: 'This release CLI does not permit the development-only planned-recipe override.', nextAction: 'Use a tested recipe; internal development builds are required for planned-recipe evidence runs.', targetModified: false })
      }
      const switches = ['--jsonl', '--desktop-control', '--allow-dependency-scripts']
      if (ALLOW_PLANNED_RECIPE_GENERATION) switches.push('--development-allow-planned')
      validateFlags(flags, ['--config'], switches)
      const configPath = option(flags, '--config')
      const allowPlanned = ALLOW_PLANNED_RECIPE_GENERATION && flags.includes('--development-allow-planned')
      if (!configPath || !flags.includes('--jsonl')) throw new GeneratorError({ code: 'GEN_CLI_USAGE', stage: 'cli', message: 'generate requires --config <file> and --jsonl.', nextAction: 'Run project-generator generate --config <file> --jsonl.', targetModified: false })
      let selection
      try {
        selection = await loadSelection(configPath)
      } catch (error) {
        const detail = error instanceof GeneratorError ? error : new GeneratorError({ code: 'GEN_CONFIG_INVALID', stage: 'plan', message: 'Could not read or parse config file.', nextAction: 'Check config path and JSON syntax.', targetModified: false })
        jsonlError(detail)
        return exitCodeFor(detail)
      }
      const controller = new AbortController()
      const interrupt = (): void => controller.abort()
      const stopDesktopControl = flags.includes('--desktop-control') ? listenForDesktopCancel(controller) : () => undefined
      process.once('SIGINT', interrupt)
      process.once('SIGTERM', interrupt)
      try {
        const result = await generateProject(selection, {
          allowPlanned,
          allowDependencyScripts: flags.includes('--allow-dependency-scripts'),
          signal: controller.signal,
          onEvent: (event) => writeEvent(event as unknown as Record<string, unknown>),
        })
        if (result.logFile) process.stderr.write(`Redacted job log: ${result.logFile}\n`)
        return result.exitCode
      } finally {
        stopDesktopControl()
        process.removeListener('SIGINT', interrupt)
        process.removeListener('SIGTERM', interrupt)
      }
    }
    if (command === 'inspect') {
      validateFlags(flags, ['--output'], ['--json'])
      const output = option(flags, '--output')
      if (!output) throw new GeneratorError({ code: 'GEN_CLI_USAGE', stage: 'cli', message: 'inspect requires --output <folder>.', nextAction: 'Pass the generated project directory.', targetModified: false })
      const report = await inspectOutput(output)
      if (flags.includes('--json')) writeJson({ schemaVersion: 1, ok: true, data: report })
      else writeJson(report)
      return 0
    }
    if (command === 'recovery') {
      const [operation, ...recoveryFlags] = flags
      if (operation === 'inspect') {
        validateFlags(recoveryFlags, ['--job-id'], ['--json'])
        const jobId = option(recoveryFlags, '--job-id')
        const reports = await inspectRecovery(jobId)
        if (recoveryFlags.includes('--json')) writeJson({ schemaVersion: 1, ok: true, data: reports })
        else if (reports.length === 0) process.stdout.write('No pending recovery transactions.\n')
        else for (const report of reports) {
          process.stdout.write(`${report.jobId} ${report.state} (${report.phase})\n`)
          process.stdout.write(`  Parent: ${report.parentPath}\n  Stage: ${report.stagePath}\n  Source: ${report.sourcePath}\n  Target: ${report.targetPath}\n`)
          process.stdout.write(`  ${report.detail}\n`)
          if (report.canFinalize) process.stdout.write(`  Explicit action: project-generator recovery apply --job-id ${report.jobId} --action finalize --confirm-job ${report.jobId}\n`)
          if (report.canCleanupStage || report.canDiscardJournal) process.stdout.write(`  Explicit action: project-generator recovery apply --job-id ${report.jobId} --action cleanup --confirm-job ${report.jobId}\n`)
        }
        return 0
      }
      if (operation === 'apply') {
        validateFlags(recoveryFlags, ['--job-id', '--action', '--confirm-job'], ['--json'])
        const jobId = option(recoveryFlags, '--job-id')
        const action = option(recoveryFlags, '--action')
        const confirmJobId = option(recoveryFlags, '--confirm-job')
        if (!jobId || !confirmJobId || (action !== 'cleanup' && action !== 'finalize')) {
          throw new GeneratorError({ code: 'GEN_CLI_USAGE', stage: 'cli', message: 'recovery apply requires --job-id, --action cleanup|finalize, and --confirm-job.', nextAction: 'Run recovery inspect first, then confirm exact job ID.', targetModified: false })
        }
        await applyRecovery(jobId, action, confirmJobId)
        const result = { jobId, action, status: 'completed' }
        if (recoveryFlags.includes('--json')) writeJson({ schemaVersion: 1, ok: true, data: result })
        else process.stdout.write(`Recovery ${action} completed for ${jobId}.\n`)
        return 0
      }
      throw new GeneratorError({ code: 'GEN_CLI_USAGE', stage: 'cli', message: 'recovery requires inspect or apply.', nextAction: 'Run project-generator recovery inspect --help.', targetModified: false })
    }
    throw new GeneratorError({ code: 'GEN_CLI_USAGE', stage: 'cli', message: `Unsupported command or output mode: ${command}`, nextAction: 'Run project-generator --help.', targetModified: false })
  } catch (error) {
    const detail = error instanceof GeneratorError ? error : new GeneratorError({ code: 'GEN_INTERNAL_ERROR', stage: command ?? 'cli', message: 'Unexpected CLI error.', nextAction: 'Review local diagnostics and retry.', targetModified: false })
    if (command === 'generate' && flags.includes('--jsonl')) jsonlError(detail)
    else if (flags.includes('--json') || command === 'catalog' || command === 'plan' || command === 'doctor' || command === 'inspect') writeJson({ schemaVersion: 1, ok: false, error: detail.toJSON() })
    else process.stderr.write(`${detail.code}: ${detail.message}\nNext: ${detail.nextAction}\n`)
    return exitCodeFor(detail)
  }
}

main(process.argv.slice(2)).then((code) => {
  process.exitCode = code
}).catch(() => {
  process.stderr.write('GEN_INTERNAL_ERROR: CLI startup failed.\n')
  process.exitCode = 70
})
