import { configError } from './errors.js'
import type { DocumentationMode, ProjectSelectionV1 } from './types.js'

type JsonObject = Record<string, unknown>

function object(value: unknown, label: string, allowed: readonly string[], required: readonly string[]): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw configError(`${label} must be an object.`)
  const result = value as JsonObject
  const extra = Object.keys(result).find((key) => !allowed.includes(key))
  if (extra) throw configError(`${label} contains unsupported field "${extra}".`)
  const missing = required.find((key) => !(key in result))
  if (missing) throw configError(`${label}.${missing} is required.`)
  return result
}

function text(value: unknown, label: string, maxLength = 4096): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw configError(`${label} must be a non-empty string of at most ${maxLength} characters.`)
  }
  return value
}

function bool(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw configError(`${label} must be a boolean.`)
  return value
}

function optionalObject(value: unknown, label: string, allowed: readonly string[], required: readonly string[] = []): JsonObject | undefined {
  return value === undefined ? undefined : object(value, label, allowed, required)
}

function noUnknownStrings(record: JsonObject, label: string, required: readonly string[], optional: readonly string[] = []): void {
  for (const key of required) text(record[key], `${label}.${key}`)
  for (const key of optional) if (record[key] !== undefined) text(record[key], `${label}.${key}`)
}

export function parseSelection(value: unknown): ProjectSelectionV1 {
  const root = object(value, 'config', ['schemaVersion', 'project', 'frontend', 'backend', 'database', 'styling', 'template', 'documentation', 'git'], ['schemaVersion', 'project', 'documentation', 'git'])
  if (root.schemaVersion !== 1) throw configError('schemaVersion must be 1.')

  const project = object(root.project, 'project', ['name', 'description', 'parentDirectory', 'type'], ['name', 'parentDirectory', 'type'])
  noUnknownStrings(project, 'project', ['name', 'parentDirectory', 'type'], ['description'])
  if (project.description !== undefined && (project.description as string).length > 500) throw configError('project.description must be at most 500 characters.')
  if (!['frontend', 'backend', 'fullstack', 'mobile'].includes(project.type as string)) throw configError('project.type is unsupported.')

  const frontend = optionalObject(root.frontend, 'frontend', ['adapterId', 'language', 'manager'], ['adapterId'])
  if (frontend) {
    noUnknownStrings(frontend, 'frontend', ['adapterId'], ['language', 'manager'])
    if (frontend.language !== undefined && !['ts', 'js'].includes(frontend.language as string)) throw configError('frontend.language must be "ts" or "js".')
  }

  const backend = optionalObject(root.backend, 'backend', ['adapterId', 'manager'], ['adapterId'])
  if (backend) noUnknownStrings(backend, 'backend', ['adapterId'], ['manager'])

  const database = optionalObject(root.database, 'database', ['adapterId', 'accessAdapterId', 'mode'], ['adapterId', 'mode'])
  if (database) {
    noUnknownStrings(database, 'database', ['adapterId', 'mode'], ['accessAdapterId'])
    if (!['none', 'existing-service', 'docker-compose'].includes(database.mode as string)) throw configError('database.mode is unsupported.')
  }

  const styling = optionalObject(root.styling, 'styling', ['adapterId', 'uiLibraryId'], ['adapterId'])
  if (styling) noUnknownStrings(styling, 'styling', ['adapterId'], ['uiLibraryId'])

  const template = optionalObject(root.template, 'template', ['adapterId', 'templateId', 'commitSha', 'variantId'], ['adapterId', 'templateId', 'commitSha'])
  if (template) {
    noUnknownStrings(template, 'template', ['adapterId', 'templateId', 'commitSha'], ['variantId'])
    if (template.adapterId !== 'template.forma') throw configError('template.adapterId must be "template.forma".')
    if (!/^[a-f0-9]{40}$/i.test(template.commitSha as string)) throw configError('template.commitSha must be a full 40-character commit SHA.')
  }

  if (!['minimal', 'standard', 'full'].includes(root.documentation as string)) throw configError('documentation must be minimal, standard, or full.')
  const git = object(root.git, 'git', ['initialize', 'initialCommit'], ['initialize', 'initialCommit'])
  const initialize = bool(git.initialize, 'git.initialize')
  const initialCommit = bool(git.initialCommit, 'git.initialCommit')

  return {
    schemaVersion: 1,
    project: {
      name: project.name as string,
      parentDirectory: project.parentDirectory as string,
      type: project.type as ProjectSelectionV1['project']['type'],
      ...(project.description === undefined ? {} : { description: project.description as string }),
    },
    ...(frontend === undefined ? {} : { frontend: {
      adapterId: frontend.adapterId as string,
      ...(frontend.language === undefined ? {} : { language: frontend.language as 'ts' | 'js' }),
      ...(frontend.manager === undefined ? {} : { manager: frontend.manager as string }),
    } }),
    ...(backend === undefined ? {} : { backend: {
      adapterId: backend.adapterId as string,
      ...(backend.manager === undefined ? {} : { manager: backend.manager as string }),
    } }),
    ...(database === undefined ? {} : { database: {
      adapterId: database.adapterId as string,
      mode: database.mode as 'none' | 'existing-service' | 'docker-compose',
      ...(database.accessAdapterId === undefined ? {} : { accessAdapterId: database.accessAdapterId as string }),
    } }),
    ...(styling === undefined ? {} : { styling: {
      adapterId: styling.adapterId as string,
      ...(styling.uiLibraryId === undefined ? {} : { uiLibraryId: styling.uiLibraryId as string }),
    } }),
    ...(template === undefined ? {} : { template: {
      adapterId: 'template.forma',
      templateId: template.templateId as string,
      commitSha: template.commitSha as string,
      ...(template.variantId === undefined ? {} : { variantId: template.variantId as string }),
    } }),
    documentation: root.documentation as DocumentationMode,
    git: { initialize, initialCommit },
  }
}

export function parseSelectionJson(input: string): ProjectSelectionV1 {
  let value: unknown
  try {
    value = JSON.parse(input) as unknown
  } catch {
    throw configError('Config file is not valid JSON.')
  }
  return parseSelection(value)
}
