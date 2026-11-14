import { inspectTarget } from './paths.js'
import { packageManager } from './catalog.js'
import { tmpdir } from 'node:os'
import { resolveGoTool, resolveNpmTool, supportsGo, supportsNpm, supportsNodeForAngular, supportsNodeForBackend, supportsNodeForNext, supportsNodeForNuxt, supportsNodeForPnpm, supportsNodeForVite, supportsNodeForVue } from './toolchain.js'
import { runSafeProcess } from './runner.js'
import type { DoctorReport, ProjectSelectionV1, ToolStatus } from './types.js'
import { resolveSelection } from './resolver.js'

export async function runDoctor(selection: ProjectSelectionV1): Promise<DoctorReport> {
  const resolved = resolveSelection(selection)
  const recipe = resolved.recipe
  const isGo = recipe.id === 'BE-02'
  const nodeVersion = process.version.replace(/^v/, '')
  const frameworkNodeSupported = recipe.backend
    ? supportsNodeForBackend(nodeVersion)
    : recipe.frontend === 'frontend.vue-vite'
      ? supportsNodeForVue(nodeVersion)
      : recipe.frontend === 'frontend.nuxt' ? supportsNodeForNuxt(nodeVersion)
        : recipe.frontend === 'frontend.angular' ? supportsNodeForAngular(nodeVersion)
          : recipe.frontend === 'frontend.nextjs-app' ? supportsNodeForNext(nodeVersion) : supportsNodeForVite(nodeVersion)
  const nodeSupported = frameworkNodeSupported && (recipe.manager !== 'pnpm' || supportsNodeForPnpm(nodeVersion))
  const node: ToolStatus | undefined = isGo ? undefined : {
    id: 'node',
    available: nodeSupported,
    version: nodeVersion,
    message: nodeSupported ? 'Node.js version satisfies pinned scaffold and package-manager requirements.' : `Node.js ${process.version} is outside this recipe's supported range.`,
  }

  const npmTool = isGo ? undefined : await resolveNpmTool()
  const npm: ToolStatus | undefined = isGo ? undefined : npmTool ? {
    id: 'npm',
    available: supportsNpm(npmTool.version),
    version: npmTool.version,
    message: supportsNpm(npmTool.version) ? 'Trusted npm CLI found beside the active Node runtime.' : `npm ${npmTool.version} is older than required npm 10.`,
  } : {
    id: 'npm',
    available: false,
    message: 'Trusted npm CLI was not found beside the active Node runtime.',
  }

  const selectedManager = isGo || recipe.manager === 'npm' ? undefined : packageManager(recipe.manager)
  const managerTool: ToolStatus | undefined = selectedManager ? {
    id: selectedManager.id === 'go-modules' ? 'go' : selectedManager.id,
    available: npm?.available === true && (selectedManager.id !== 'pnpm' || supportsNodeForPnpm(nodeVersion)),
    version: selectedManager.version,
    message: npm?.available
      ? `Pinned ${selectedManager.id} is staged from the npm registry after consent; version and integrity are verified before use.`
      : `npm 10 or newer is required to stage pinned ${selectedManager.id}.`,
  } : undefined

  let go: ToolStatus | undefined
  if (isGo) {
    const executable = await resolveGoTool()
    if (!executable) {
      go = { id: 'go', available: false, message: 'Go SDK was not found on PATH or under GOROOT. Install Go 1.22 or newer, add its bin directory to PATH, then rerun Doctor.' }
    } else {
      try {
        const root = tmpdir()
        const result = await runSafeProcess({
          executablePath: executable.executablePath,
          allowedExecutableRoot: executable.directory,
          cwd: root,
          allowedCwdRoot: root,
          args: ['version'],
          homeDirectory: root,
          tempDirectory: root,
          extraPath: [executable.directory],
          environment: { GOTOOLCHAIN: 'local' },
          timeoutMs: 5_000,
        })
        const version = /^go version go(\d+\.\d+(?:\.\d+)?)\s/.exec(result.stdout.trim())?.[1]
        const supported = result.exitCode === 0 && version !== undefined && supportsGo(version)
        go = {
          id: 'go',
          available: supported,
          path: executable.executablePath,
          ...(version ? { version } : {}),
          message: supported ? `Go ${version} satisfies the Go Modules and net/http requirement (>=1.22.0).`
            : version ? `Go ${version} is unsupported; install Go 1.22 or newer and rerun Doctor.`
              : 'Go SDK was found but its version could not be verified. Repair the Go installation and rerun Doctor.',
        }
      } catch {
        go = { id: 'go', available: false, path: executable.executablePath, message: 'Go SDK was found but could not run under the Windows process supervisor. Repair Go or rerun Doctor.' }
      }
    }
  }

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
  const tools: ToolStatus[] = [...(node ? [node] : []), ...(npm ? [npm] : []), ...(managerTool ? [managerTool] : []), ...(go ? [go] : []), {
    id: 'target',
    available: target.available && windows,
    message: windows ? target.message : 'Generation is supported on Windows only in Phase 01.',
  }]
  return {
    schemaVersion: 1,
    platform: `${process.platform}-${process.arch}`,
    ready: windows && (isGo ? Boolean(go?.available) : Boolean(node?.available && npm?.available && (!managerTool || managerTool.available))) && target.available,
    tools,
    target,
  }
}
