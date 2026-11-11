import type { AdapterManifestV1, RecipeManifestV1 } from './types.js'

const nodeRequirement = {
  executableId: 'node',
  versionRange: '>=20.19.0 or >=22.12.0',
  optional: false,
  reason: 'Pinned official scaffold and generated development toolchain.',
} as const

const npmRequirement = {
  executableId: 'npm',
  versionRange: '>=10.0.0',
  optional: false,
  reason: 'Installs pinned scaffolds and generated project dependencies.',
} as const

export const ADAPTERS: readonly AdapterManifestV1[] = [
  {
    schemaVersion: 1,
    id: 'frontend.react-vite',
    adapterVersion: '0.1.0',
    kind: 'frontend',
    displayName: 'React + Vite',
    supportState: 'planned',
    supportedOS: ['windows'],
    versionConstraints: { node: '>=20.19.0 or >=22.12.0', npm: '>=10.0.0', 'create-vite': '9.3.4' },
    packageManagers: ['npm'],
    prerequisites: [nodeRequirement, npmRequirement],
    capabilities: ['typescript', 'plain-css', 'npm-lockfile', 'build', 'lint', 'http-smoke'],
    compatibleWith: ['styling.css'],
    incompatibleWith: ['styling.tailwind', 'database.*', 'backend.*', 'template.*'],
    recipeEvidenceIds: [],
  },
  {
    schemaVersion: 1,
    id: 'frontend.nextjs-app',
    adapterVersion: '0.1.0',
    kind: 'frontend',
    displayName: 'Next.js App Router',
    supportState: 'planned',
    supportedOS: ['windows'],
    versionConstraints: { node: '>=20.9.0', npm: '>=10.0.0', 'create-next-app': '16.4.6' },
    packageManagers: ['npm'],
    prerequisites: [{ ...nodeRequirement, versionRange: '>=20.9.0' }, npmRequirement],
    capabilities: ['app-router', 'typescript', 'tailwind', 'npm-lockfile', 'build', 'lint', 'http-smoke'],
    compatibleWith: ['styling.tailwind'],
    incompatibleWith: ['styling.css', 'database.*', 'backend.*', 'template.*'],
    recipeEvidenceIds: [],
  },
  {
    schemaVersion: 1,
    id: 'styling.css',
    adapterVersion: '0.1.0',
    kind: 'styling',
    displayName: 'Plain CSS',
    supportState: 'planned',
    supportedOS: ['windows'],
    versionConstraints: {},
    packageManagers: ['npm'],
    prerequisites: [],
    capabilities: ['plain-css'],
    compatibleWith: ['frontend.react-vite'],
    incompatibleWith: ['frontend.nextjs-app'],
    recipeEvidenceIds: [],
  },
  {
    schemaVersion: 1,
    id: 'styling.tailwind',
    adapterVersion: '0.1.0',
    kind: 'styling',
    displayName: 'Tailwind CSS',
    supportState: 'planned',
    supportedOS: ['windows'],
    versionConstraints: {},
    packageManagers: ['npm'],
    prerequisites: [],
    capabilities: ['tailwind'],
    compatibleWith: ['frontend.nextjs-app'],
    incompatibleWith: ['frontend.react-vite'],
    recipeEvidenceIds: [],
  },
] as const

export const RECIPES: readonly RecipeManifestV1[] = [
  {
    schemaVersion: 1,
    id: 'FE-01',
    status: 'planned',
    platform: 'windows',
    frontend: 'frontend.react-vite',
    language: 'ts',
    manager: 'npm',
    styling: 'styling.css',
    scaffold: {
      packageName: 'create-vite',
      version: '9.3.4',
      integrity: 'sha512-L02vtfSVndf0I65g0axXCjrFbhyjmN5K7szeaLRd0mMx0duW2BpzNvps5q4zHHCWexOrWrPgAx17hRz88I3bHw==',
      binPath: 'index.js',
    },
    scaffoldArgs: ['--template', 'react-ts', '--no-interactive', '--eslint'],
    checks: ['dependency-install', 'lint', 'typecheck', 'build', 'http-smoke'],
    limitations: ['No separate backend or database.', 'Browser automation is not included; smoke check verifies an HTTP-served page.'],
    evidenceIds: [],
  },
  {
    schemaVersion: 1,
    id: 'FE-02',
    status: 'planned',
    platform: 'windows',
    frontend: 'frontend.nextjs-app',
    language: 'ts',
    manager: 'npm',
    styling: 'styling.tailwind',
    scaffold: {
      packageName: 'create-next-app',
      version: '16.4.6',
      integrity: 'sha512-Y4TvDShkVp+66MaPXRGEGl4xMf962voeA1eEuu7Hw4S5TodM9e4suXoZASwgCCVHi7444J0sHTr3bHNvvLWb3w==',
      binPath: 'dist/index.js',
    },
    scaffoldArgs: ['--typescript', '--app', '--tailwind', '--eslint', '--use-npm', '--skip-install', '--disable-git', '--yes', '--no-agent-feedback'],
    checks: ['dependency-install', 'lint', 'build', 'http-smoke'],
    limitations: ['No separate backend or database.', 'Browser automation is not included; smoke check verifies an HTTP-served page.'],
    evidenceIds: [],
  },
] as const

export function catalog(): { schemaVersion: 1; adapters: readonly AdapterManifestV1[]; recipes: readonly RecipeManifestV1[] } {
  return { schemaVersion: 1, adapters: ADAPTERS, recipes: RECIPES }
}
