export type SupportState = 'cataloged' | 'planned' | 'experimental' | 'tested' | 'blocked' | 'retired'
export type DocumentationMode = 'minimal' | 'standard' | 'full'
export type RecipeId = 'FE-01' | 'FE-02' | 'FE-03' | 'FE-04' | 'FE-05' | 'FE-06' | 'FE-07' | 'FE-08' | 'FE-09' | 'FE-10' | 'FE-11' | 'FE-12' | 'FE-13' | 'FE-14' | 'FE-15' | 'BE-01' | 'BE-02' | 'BE-03' | 'BE-04' | 'BE-05' | 'BE-06' | 'BE-07' | 'BE-08' | 'BE-09' | 'FS-06' | 'FS-07' | 'FM-01' | 'FM-02'
export type StylingId = 'styling.css' | 'styling.tailwind' | 'styling.bootstrap' | 'styling.scss'
export type FrontendId = 'frontend.react-vite' | 'frontend.nextjs-app' | 'frontend.vue-vite' | 'frontend.nuxt' | 'frontend.angular'
export type BackendId = 'backend.express' | 'backend.nestjs' | 'backend.go-net-http' | 'backend.go-gin' | 'backend.laravel' | 'backend.fastapi'
export type PackageManagerId = 'npm' | 'yarn' | 'pnpm' | 'go-modules' | 'composer' | 'uv'

export interface ProjectSelectionV1 {
  schemaVersion: 1
  project: {
    name: string
    description?: string
    parentDirectory: string
    type: 'frontend' | 'backend' | 'fullstack' | 'mobile'
  }
  frontend?: { adapterId: string; language?: 'ts' | 'js'; manager?: string }
  backend?: { adapterId: string; manager?: string; modulePath?: string }
  database?: { adapterId: string; accessAdapterId?: string; mode: 'none' | 'embedded' | 'existing-service' | 'docker-compose' }
  styling?: { adapterId: string; uiLibraryId?: string }
  template?: { adapterId: 'template.forma'; templateId: string; commitSha: string; variantId?: string }
  documentation: DocumentationMode
  git: { initialize: boolean; initialCommit: boolean }
}

export interface ToolRequirement {
  executableId: string
  versionRange: string
  optional: boolean
  reason: string
}

export interface AdapterManifestV1 {
  schemaVersion: 1
  id: string
  adapterVersion: string
  kind: 'frontend' | 'backend' | 'database' | 'data-access' | 'styling' | 'template'
  displayName: string
  supportState: SupportState
  supportedOS: readonly ('windows' | 'macos' | 'linux')[]
  versionConstraints: Record<string, string>
  packageManagers: readonly string[]
  prerequisites: readonly ToolRequirement[]
  capabilities: readonly string[]
  compatibleWith: readonly string[]
  incompatibleWith: readonly string[]
  recipeEvidenceIds: readonly string[]
}

export interface ScaffoldPin {
  packageName: 'create-vite' | 'create-next-app' | 'create-vue' | 'create-nuxt' | '@angular/cli' | '@nestjs/cli'
  version: string
  integrity: string
  binPath: string
  source?: { repository: string; commitSha: string }
}

export interface DependencyPin {
  packageName: string
  version: string
  integrity: string
  scope?: 'dependencies' | 'devDependencies'
}

export interface PackageManagerManifestV1 {
  id: PackageManagerId
  version: string
  lockfile?: string
  nodeLinker?: 'node-modules' | 'hoisted'
  configFile?: string
  packageName?: string
  integrity?: string
  binPath?: string
  nodeVersionRange?: string
}

export interface RecipeManifestV1 {
  schemaVersion: 1
  id: RecipeId
  status: SupportState
  platform: 'windows'
  projectType?: 'backend' | 'fullstack'
  frontend?: FrontendId
  backend?: BackendId
  database?: string
  dataAccess?: string
  language: 'ts' | 'go' | 'php' | 'python'
  manager: PackageManagerId
  styling?: StylingId
  scaffold?: ScaffoldPin
  scaffoldArgs?: readonly string[]
  dependencies?: readonly DependencyPin[]
  checks: readonly string[]
  limitations: readonly string[]
  evidenceIds: readonly string[]
}

export interface ResolvedSelection {
  selection: ProjectSelectionV1
  recipe: RecipeManifestV1
  outputPath: string
}

export interface PlannedStep {
  id: string
  ownerAdapterId: string
  phase: 'preflight' | 'stage' | 'scaffold' | 'configure' | 'install' | 'validate' | 'finalize'
  action: 'inspect' | 'create-owned-stage' | 'run-pinned-cli' | 'write-declared-files' | 'install-dependencies' | 'run-check' | 'commit-no-replace'
  readableSummary: string
  sideEffects: string[]
  consentKind?: 'network' | 'external-tool'
}

export interface GenerationPlan {
  schemaVersion: 1
  recipeId: RecipeId
  recipeStatus: SupportState
  targetPath: string
  steps: readonly PlannedStep[]
  expectedWrites: readonly string[]
  networkAccess: readonly string[]
  executesDependencyLifecycleScripts: boolean
  requiresDependencyConsent: boolean
  requiresNetworkConsent: boolean
  executionAvailable: boolean
  warnings: readonly string[]
  template?: { adapterId: 'template.forma'; templateId: string; commitSha: string }
}

export type StageId = 'preflight' | 'staging' | 'scaffolding' | 'configuring' | 'installing' | 'validating' | 'finalizing'
export type StageStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped'
export type JobStatus = 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled'

export interface JobEventV1 {
  schemaVersion: 1
  jobId: string
  sequence: number
  timestamp: string
  type: 'job-started' | 'stage-started' | 'stage-progress' | 'stage-finished' | 'validation' | 'warning' | 'error' | 'job-finished'
  stageId?: StageId
  stageOwner?: string
  stageStatus?: StageStatus
  status?: JobStatus
  percent?: number
  message: string
  code?: string
}

export interface GeneratorErrorShape {
  code: string
  stage: string
  message: string
  nextAction: string
  targetModified: boolean
}

export interface ToolStatus {
  id: 'node' | 'npm' | 'yarn' | 'pnpm' | 'go' | 'php' | 'composer' | 'python' | 'uv' | 'target'
  available: boolean
  version?: string
  path?: string
  message: string
}

export interface DoctorReport {
  schemaVersion: 1
  platform: string
  ready: boolean
  tools: readonly ToolStatus[]
  target: { path: string; available: boolean; message: string }
}

export interface ValidationOutcome {
  id: string
  status: 'pass' | 'fail' | 'skipped' | 'not_run'
  message: string
  exitCode?: number
}
