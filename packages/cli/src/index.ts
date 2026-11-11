#!/usr/bin/env node
import { lstat, readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { resolve, win32 } from 'node:path'
import { catalog, createPlan, generateProject, GeneratorError, parseSelectionJson, runDoctor } from '@project-generator/core'

const usage = `Project Generator CLI 0.1.0

Usage:
  project-generator catalog --json
  project-generator plan --config <file> --json
  project-generator doctor --config <file> [--json]
  project-generator generate --config <file> --jsonl [--development-allow-planned]
  project-generator inspect --output <folder> [--json]

Phase 01 recipes: FE-01 React + Vite + TypeScript + npm + CSS; FE-02 Next.js App Router + TypeScript + npm + Tailwind.
Both recipes remain planned until independent Windows acceptance and review. Normal generation refuses planned recipes.
The development-only flag runs a planned recipe for evidence gathering; it does not mark that recipe tested.
npm installs may execute third-party lifecycle scripts and are not sandboxed.`

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
      validateFlags(flags, ['--config'], ['--jsonl', '--development-allow-planned'])
      const configPath = option(flags, '--config')
      const allowPlanned = flags.includes('--development-allow-planned')
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
      process.once('SIGINT', interrupt)
      process.once('SIGTERM', interrupt)
      try {
        const result = await generateProject(selection, {
          allowPlanned,
          signal: controller.signal,
          onEvent: (event) => writeEvent(event as unknown as Record<string, unknown>),
        })
        if (result.logFile) process.stderr.write(`Redacted job log: ${result.logFile}\n`)
        return result.exitCode
      } finally {
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
