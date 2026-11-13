import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const profile = process.argv[2]
if (profile !== 'release' && profile !== 'development') {
  throw new Error('Pass build profile: release or development.')
}

const policyPath = resolve(import.meta.dirname, '..', 'packages', 'core', 'dist', 'src', 'build-policy.js')
writeFileSync(policyPath, `export const BUILD_PROFILE = '${profile}';\nexport const ALLOW_PLANNED_RECIPE_GENERATION = ${profile === 'development'};\n`)
