import type { FrontendId } from './types.js'

export const FORMA_REPOSITORY = 'https://github.com/dzulfikarq/design-templates.git'
export const FORMA_COMMIT_SHA = '5cf3c4e5b7b0bc454a653f58d12237c56f2548e2'

export function isFormaCommit(commitSha: string): boolean {
  return commitSha.toLowerCase() === FORMA_COMMIT_SHA
}

export interface FormaTemplate {
  id: string
  name: string
  description: string
  version: string
  contentHash: string
  category: string
  tags: readonly string[]
  license: string
  variants: readonly { id: string; name: string; accent: string; default: boolean }[]
  testedFrameworks: readonly FrontendId[]
  commitSha: string
}

// Snapshot of Forma registry metadata at FORMA_COMMIT_SHA; only externally tested adapters appear here.
export const FORMA_TEMPLATES: readonly FormaTemplate[] = [
  {
    id: 'focus-planner',
    name: 'Focus Planner',
    description: 'A calm daily planning board with actionable tasks and clear progress states.',
    version: '0.1.0',
    contentHash: 'cbe3dacea2ba9ce64a8d619d9f699875cf1549be88f143a5519ca326c048e779',
    category: 'productivity',
    tags: ['focus', 'planner'],
    license: 'MIT',
    variants: [
      { id: 'coral', name: 'Coral', accent: '12 76% 54%', default: true },
      { id: 'moss', name: 'Moss', accent: '151 52% 38%', default: false },
    ],
    testedFrameworks: ['frontend.react-vite'],
    commitSha: FORMA_COMMIT_SHA,
  },
  {
    id: 'modern-admin',
    name: 'Modern Admin',
    description: 'A charcoal operations workspace with live sales insights, order lanes, and a focused settings area.',
    version: '1.0.0',
    contentHash: '1b5b7525e8c418eb6ec9b12d98b4fd6ed9e1863e1a4cfe96fcf2bcab29ea1eb0',
    category: 'admin-cms',
    tags: ['dashboard', 'analytics', 'orders', 'dark', 'operations'],
    license: 'MIT',
    variants: [
      { id: 'ember', name: 'Ember', accent: '24 95% 53%', default: true },
      { id: 'violet', name: 'Violet', accent: '263 83% 62%', default: false },
    ],
    testedFrameworks: ['frontend.react-vite', 'frontend.nextjs-app'],
    commitSha: FORMA_COMMIT_SHA,
  },
  {
    id: 'staywise-host-dashboard',
    name: 'Staywise Host Dashboard',
    description: 'A responsive short-term rental workspace for bookings, properties, rates, pricing, and host support.',
    version: '0.1.0',
    contentHash: 'b84213bb8c0950ee7297ea423338eae2d2ac577023444d0893b7d31d36b331cd',
    category: 'admin-cms',
    tags: ['staywise', 'host', 'dashboard'],
    license: 'MIT',
    variants: [
      { id: 'lagoon', name: 'Lagoon', accent: '174 58% 34%', default: true },
      { id: 'coral', name: 'Coral', accent: '12 68% 46%', default: false },
    ],
    testedFrameworks: ['frontend.react-vite', 'frontend.nextjs-app'],
    commitSha: FORMA_COMMIT_SHA,
  },
] as const

export const FORMA_INTEGRATIONS = [
  { recipeId: 'FM-01', frontend: 'frontend.react-vite', status: 'planned' },
  { recipeId: 'FM-02', frontend: 'frontend.nextjs-app', status: 'planned' },
] as const

export function formaTemplate(id: string): FormaTemplate | undefined {
  return FORMA_TEMPLATES.find((template) => template.id === id)
}
