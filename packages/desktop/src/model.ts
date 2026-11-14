import { isValidGoModulePath } from '@project-generator/core/go-module'

export type Theme = 'system' | 'light' | 'dark'
export type HistoryStatus = 'completed' | 'partial'

export type ProjectRecord = {
  name: string
  path: string
  recipeId: string
  status: HistoryStatus
  createdAt: string
}

export type AppPreferences = {
  theme: Theme
  defaultParentDirectory: string
  projects: ProjectRecord[]
}

export type Adapter = {
  id: string
  kind: string
  displayName: string
  supportState: string
  packageManagers: string[]
  compatibleWith: string[]
  prerequisites: { executableId: string; versionRange: string; optional: boolean; reason: string }[]
}

export type Recipe = {
  id: string
  status: string
  projectType?: string
  frontend?: string
  backend?: string
  styling?: string
  manager: string
  limitations: string[]
  checks: string[]
  scaffold?: { packageName: string; version: string }
}

export type Template = {
  id: string
  name: string
  description: string
  version: string
  contentHash: string
  category: string
  tags: string[]
  license: string
  variants: { id: string; name: string; accent: string; default: boolean }[]
  testedFrameworks: string[]
  commitSha: string
}

export type Catalog = {
  schemaVersion: number
  adapters: Adapter[]
  packageManagers: { id: string; version: string; lockfile?: string; nodeLinker?: string }[]
  recipes: Recipe[]
  forma: {
    commitSha: string
    integrations: { recipeId: string; frontend: string; status: string }[]
    templates: Template[]
  }
}

export const STORAGE_KEY = 'project-generator.desktop.v1'
export const MAX_HISTORY = 30
const reservedWindowsName = /^(CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|CLOCK\$|COM[1-9¹²³]|LPT[1-9¹²³])(?:\..*)?$/i

export function emptyPreferences(defaultParentDirectory = ''): AppPreferences {
  return { theme: 'system', defaultParentDirectory, projects: [] }
}

export function validateProjectName(name: string): string | null {
  if (name.length > 100 || !/^[a-z0-9][a-z0-9._-]*$/.test(name)) {
    return 'Use lowercase letters, numbers, dots, underscores, or hyphens; start with a letter or number (100 characters max).'
  }
  if (name.endsWith('.') || reservedWindowsName.test(name)) {
    return 'This name is reserved or invalid on Windows.'
  }
  return null
}

export function validateGoModulePath(value: string): string | null {
  return isValidGoModulePath(value)
    ? null
    : 'Use a valid Go module path, such as github.com/user/project or example.com/project.'
}

export function validateParentDirectory(path: string): string | null {
  if (!/^[a-z]:[\\/]/i.test(path)) return 'Enter an absolute local Windows drive path, such as C:\\Projects.'
  if (path.startsWith('\\\\') || /(?:^|[\\/])(?:\.|\.\.)(?:[\\/]|$)/.test(path)) {
    return 'Network, device, and traversal paths are not allowed.'
  }
  if (path.length > 220 || /[<>:"|?*\x00-\x1f]/.test(path.slice(3))) return 'Path contains unsupported characters or is too long.'
  if (path.split(/[\\/]/).some((part) => part.endsWith('.') || part.endsWith(' ') || reservedWindowsName.test(part))) {
    return 'Path contains a Windows-reserved or invalid folder name.'
  }
  return null
}

export function findRecipe(catalog: Catalog | null, frontendId: string, stylingId: string, managerId: string): Recipe | undefined {
  return catalog?.recipes.find((recipe) => recipe.frontend === frontendId && (recipe.styling ?? '') === stylingId && recipe.manager === managerId)
}

export function retainCompatibleStyling(catalog: Catalog | null, frontendId: string, stylingId: string, managerId: string): string {
  return findRecipe(catalog, frontendId, stylingId, managerId) ? stylingId : ''
}

export function findFrameworkRecipe(catalog: Catalog | null, frontendId: string, managerId: string): Recipe | undefined {
  if (managerId !== 'npm') return undefined
  const forma = catalog?.adapters.find((adapter) => adapter.id === 'template.forma')
  if (!forma?.compatibleWith.includes(frontendId)) return undefined
  return catalog?.recipes.find((recipe) => recipe.id.startsWith('FE-')
    && recipe.frontend === frontendId && recipe.manager === managerId)
}

// This reports pinned Forma metadata compatibility only, never generator support.
export function formaMetadataCompatible(template: Template, frontendId: string, catalog: Catalog): boolean {
  return template.testedFrameworks.includes(frontendId)
    && catalog.adapters.some((adapter) => adapter.id === 'template.forma' && adapter.compatibleWith.includes(frontendId))
}

export function filterFormaTemplates(templates: readonly Template[], query: string, category: string, frontendId: string): Template[] {
  const search = query.trim().toLowerCase()
  return templates.filter((template) => (category === 'all' || template.category === category)
    && (frontendId === 'all' || template.testedFrameworks.includes(frontendId))
    && (!search || [
      template.name,
      template.description,
      template.category,
      template.version,
      template.license,
      ...template.tags,
      ...template.testedFrameworks,
    ].join(' ').toLowerCase().includes(search)))
}

export function documentationFiles(mode: 'minimal' | 'standard' | 'full'): string[] {
  const files = ['README.md', 'docs/SETUP.md']
  if (mode === 'minimal') return files
  files.push('AGENTS.md', 'docs/ARCHITECTURE.md', 'docs/TESTING.md')
  if (mode === 'standard') return files
  return [...files, 'CLAUDE.md', 'agent.md', 'decision.md', 'design.md', 'docs/PRD.md', 'docs/decisions/index.md', 'docs/qa/acceptance-matrix.md']
}

export function canStartGeneration(input: {
  busy: boolean
  invocationActive: boolean
  hasSelection: boolean
  planAvailable: boolean
  doctorReady: boolean
  lifecycleConsent: boolean
  executionAvailable: boolean
  internalDevelopmentMode: boolean
  allowPlanned: boolean
}): boolean {
  return !input.busy && !input.invocationActive && input.hasSelection && input.planAvailable
    && input.doctorReady && input.lifecycleConsent
    && (input.executionAvailable || (input.internalDevelopmentMode && input.allowPlanned))
}

export function loadPreferences(storage: Pick<Storage, 'getItem'>, defaultParentDirectory = ''): AppPreferences {
  try {
    const value: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null')
    if (typeof value !== 'object' || value === null) return emptyPreferences(defaultParentDirectory)
    const data = value as Record<string, unknown>
    if (data.schemaVersion !== 1) return emptyPreferences(defaultParentDirectory)
    const settings = typeof data.settings === 'object' && data.settings !== null ? data.settings as Record<string, unknown> : {}
    const theme: Theme = settings.theme === 'light' || settings.theme === 'dark' ? settings.theme : 'system'
    const directory = typeof settings.defaultParentDirectory === 'string' && settings.defaultParentDirectory.length <= 4096
      ? settings.defaultParentDirectory
      : defaultParentDirectory
    const projects = Array.isArray(data.projects) ? data.projects.flatMap((entry): ProjectRecord[] => {
      if (typeof entry !== 'object' || entry === null) return []
      const project = entry as Record<string, unknown>
      if (typeof project.name !== 'string' || project.name.length > 100
        || typeof project.path !== 'string' || project.path.length > 4096
        || typeof project.recipeId !== 'string' || project.recipeId.length > 32
        || (project.status !== 'completed' && project.status !== 'partial')
        || typeof project.createdAt !== 'string' || project.createdAt.length > 40 || !Number.isFinite(Date.parse(project.createdAt))) return []
      return [{ name: project.name, path: project.path, recipeId: project.recipeId, status: project.status, createdAt: project.createdAt }]
    }).slice(0, MAX_HISTORY) : []
    return { theme, defaultParentDirectory: directory, projects }
  } catch {
    return emptyPreferences(defaultParentDirectory)
  }
}

export function savePreferences(storage: Pick<Storage, 'setItem'>, preferences: AppPreferences): boolean {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({
      schemaVersion: 1,
      settings: {
        theme: preferences.theme,
        defaultParentDirectory: preferences.defaultParentDirectory.slice(0, 4096),
      },
      projects: preferences.projects.slice(0, MAX_HISTORY).map(({ name, path, recipeId, status, createdAt }) => ({
        name: name.slice(0, 100),
        path: path.slice(0, 4096),
        recipeId: recipeId.slice(0, 32),
        status,
        createdAt: createdAt.slice(0, 40),
      })),
    }))
    return true
  } catch {
    return false
  }
}
