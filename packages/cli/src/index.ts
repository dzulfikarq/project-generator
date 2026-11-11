#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { catalog, createPlan, GeneratorError, parseSelectionJson } from '@project-generator/core'

const usage = `Project Generator CLI 0.1.0

Usage:
  project-generator catalog --json
  project-generator plan --config <file> --json

Phase 01 recipes: FE-01 React + Vite + TypeScript + npm + CSS; FE-02 Next.js App Router + TypeScript + npm + Tailwind.
Both recipes remain planned until independent Windows acceptance and review.`

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  return index < 0 ? undefined : args[index + 1]
}

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

async function main(args: string[]): Promise<number> {
  const [command, ...flags] = args
  if (!command || command === '--help' || command === '-h') {
    process.stdout.write(`${usage}\n`)
    return 0
  }
  try {
    if (command === 'catalog' && flags.includes('--json')) {
      writeJson({ schemaVersion: 1, ok: true, data: catalog() })
      return 0
    }
    if (command === 'plan' && flags.includes('--json')) {
      const configPath = option(flags, '--config')
      if (!configPath) throw new GeneratorError({ code: 'GEN_CONFIG_INVALID', stage: 'plan', message: 'Missing --config path.', nextAction: 'Pass --config <file>.', targetModified: false })
      const source = await readFile(configPath, 'utf8')
      const plan = createPlan(parseSelectionJson(source))
      writeJson({ schemaVersion: 1, ok: true, data: plan })
      return 0
    }
    throw new GeneratorError({ code: 'GEN_CLI_USAGE', stage: 'cli', message: `Unsupported command or output mode: ${command}`, nextAction: 'Run project-generator --help.', targetModified: false })
  } catch (error) {
    const detail = error instanceof GeneratorError ? error.toJSON() : {
      code: 'GEN_INTERNAL_ERROR',
      stage: command,
      message: 'Unexpected CLI error.',
      nextAction: 'Review the local CLI diagnostics and retry.',
      targetModified: false,
    }
    writeJson({ schemaVersion: 1, ok: false, error: detail })
    return detail.code === 'GEN_CONFIG_INVALID' ? 2 : 3
  }
}

main(process.argv.slice(2)).then((code) => {
  process.exitCode = code
}).catch(() => {
  process.stderr.write('GEN_INTERNAL_ERROR: CLI startup failed.\n')
  process.exitCode = 70
})
