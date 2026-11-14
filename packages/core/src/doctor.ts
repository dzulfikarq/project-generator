import { inspectTarget } from './paths.js'
import { packageManager } from './catalog.js'
import { resolveNpmTool, supportsNpm, supportsNodeForAngular, supportsNodeForNext, supportsNodeForNuxt, supportsNodeForPnpm, supportsNodeForVite, supportsNodeForVue } from './toolchain.js'
import type { DoctorReport, ProjectSelectionV1, ToolStatus } from './types.js'
import { resolveSelection } from './resolver.js'

export async function runDoctor(selection: ProjectSelectionV1): Promise<DoctorReport> {
  const resolved = resolveSelection(selection)
  const recipe = resolved.recipe
  const nodeVersion = process.version.replace(/^v/, '')
  const frameworkNodeSupported = recipe.frontend === 'frontend.vue-vite'
    ? supportsNodeForVue(nodeVersion)
    : recipe.frontend === 'frontend.nuxt' ? supportsNodeForNuxt(nodeVersion)
      : recipe.frontend === 'frontend.angular' ? supportsNodeForAngular(nodeVersion)
        : recipe.frontend === 'frontend.nextjs-app' ? supportsNodeForNext(nodeVersion) : supportsNodeForVite(nodeVersion)
  const nodeSupported = frameworkNodeSupported && (recipe.manager !== 'pnpm' || supportsNodeForPnpm(nodeVersion))
  const node: ToolStatus = {
    id: 'node',
    available: nodeSupported,
    version: nodeVersion,
    message: nodeSupported ? 'Node.js version satisfies pinned scaffold and package-manager requirements.' : `Node.js ${process.version} is outside this recipe's supported range.`,
  }

  const npmTool = await resolveNpmTool()
  const npm: ToolStatus = npmTool ? {
    id: 'npm',
    available: supportsNpm(npmTool.version),
    version: npmTool.version,
    message: supportsNpm(npmTool.version) ? 'Trusted npm CLI found beside the active Node runtime.' : `npm ${npmTool.version} is older than required npm 10.`,
  } : {
    id: 'npm',
    available: false,
    message: 'Trusted npm CLI was not found beside the active Node runtime.',
  }

  const selectedManager = recipe.manager === 'npm' ? undefined : packageManager(recipe.manager)
  const managerTool: ToolStatus | undefined = selectedManager ? {
    id: selectedManager.id,
    available: npm.available && (selectedManager.id !== 'pnpm' || supportsNodeForPnpm(nodeVersion)),
    version: selectedManager.version,
    message: npm.available
      ? `Pinned ${selectedManager.id} is staged from the npm registry after consent; version and integrity are verified before use.`
      : `npm 10 or newer is required to stage pinned ${selectedManager.id}.`,
  } : undefined

  let target: DoctorReport['target']
  try {
    const inspected = await inspectTarget(selection.project.parentDirectory, selection.project.name)
    target = { path: inspected.targetPath, available: inspected.available, message: 'Parent exists, has no detected reparse points, and target is absent.' }
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'GEN_PATH_UNSAFE'
    target = {
      path: resolved.outputPath,
      available: false,
      message: code === 'GEN_PATH_EXISTS' ? 'Destination already exists.' : 'Destination parent is missing, inaccessible, or unsafe.',
    }
  }

  const windows = process.platform === 'win32'
  const tools: ToolStatus[] = [node, npm, ...(managerTool ? [managerTool] : []), {
    id: 'target',
    available: target.available && windows,
    message: windows ? target.message : 'Generation is supported on Windows only in Phase 01.',
  }]
  return {
    schemaVersion: 1,
    platform: `${process.platform}-${process.arch}`,
    ready: windows && node.available && npm.available && (!managerTool || managerTool.available) && target.available,
    tools,
    target,
  }
}
