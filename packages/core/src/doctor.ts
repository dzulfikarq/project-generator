import { inspectTarget } from './paths.js'
import { packageManager } from './catalog.js'
import { tmpdir } from 'node:os'
import { resolveGoTool, resolveNpmTool, resolvePythonExecutable, resolveUvExecutable, supportsGo, supportsNpm, supportsNodeForAngular, supportsNodeForBackend, supportsNodeForNext, supportsNodeForNuxt, supportsNodeForPnpm, supportsNodeForVite, supportsNodeForVue, supportsPython, supportsUv } from './toolchain.js'
import { runSafeProcess } from './runner.js'
import type { DoctorReport, ProjectSelectionV1, ToolStatus } from './types.js'
import { resolveSelection } from './resolver.js'

export async function runDoctor(selection: ProjectSelectionV1): Promise<DoctorReport> {
  const resolved = resolveSelection(selection)
  const recipe = resolved.recipe
  const isGo = recipe.id === 'BE-02'
  const isPython = recipe.id === 'BE-06'
  const nodeVersion = process.version.replace(/^v/, '')
  const frameworkNodeSupported = recipe.backend
    ? supportsNodeForBackend(nodeVersion)
    : recipe.frontend === 'frontend.vue-vite'
      ? supportsNodeForVue(nodeVersion)
      : recipe.frontend === 'frontend.nuxt' ? supportsNodeForNuxt(nodeVersion)
        : recipe.frontend === 'frontend.angular' ? supportsNodeForAngular(nodeVersion)
          : recipe.frontend === 'frontend.nextjs-app' ? supportsNodeForNext(nodeVersion) : supportsNodeForVite(nodeVersion)
  const nodeSupported = frameworkNodeSupported && (recipe.manager !== 'pnpm' || supportsNodeForPnpm(nodeVersion))
  const node: ToolStatus | undefined = isGo || isPython ? undefined : {
    id: 'node',
    available: nodeSupported,
    version: nodeVersion,
    message: nodeSupported ? 'Node.js version satisfies pinned scaffold and package-manager requirements.' : `Node.js ${process.version} is outside this recipe's supported range.`,
  }

  const npmTool = isGo || isPython ? undefined : await resolveNpmTool()
  const npm: ToolStatus | undefined = isGo || isPython ? undefined : npmTool ? {
    id: 'npm',
    available: supportsNpm(npmTool.version),
    version: npmTool.version,
    message: supportsNpm(npmTool.version) ? 'Trusted npm CLI found beside the active Node runtime.' : `npm ${npmTool.version} is older than required npm 10.`,
  } : {
    id: 'npm',
    available: false,
    message: 'Trusted npm CLI was not found beside the active Node runtime.',
  }

  const selectedManager = isGo || isPython || recipe.manager === 'npm' ? undefined : packageManager(recipe.manager)
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

  let python: ToolStatus | undefined
  let uv: ToolStatus | undefined
  if (isPython) {
    const executable = await resolvePythonExecutable()
    if (!executable) {
      python = { id: 'python', available: false, message: 'Python was not found on PATH. Install a user-managed Python 3.14 runtime, add python.exe to PATH, then rerun Doctor.' }
    } else {
      try {
        const root = tmpdir()
        const result = await runSafeProcess({
          executablePath: executable.executablePath,
          allowedExecutableRoot: executable.directory,
          cwd: root,
          allowedCwdRoot: root,
          args: ['--version'],
          homeDirectory: root,
          tempDirectory: root,
          extraPath: [executable.directory],
          timeoutMs: 5_000,
        })
        const version = /^Python (\d+\.\d+\.\d+)\b/m.exec(`${result.stdout}\n${result.stderr}`)?.[1]
        const supported = result.exitCode === 0 && version !== undefined && supportsPython(version)
        python = {
          id: 'python',
          available: supported,
          path: executable.executablePath,
          ...(version ? { version } : {}),
          message: supported ? `Python ${version} satisfies the 3.14 acceptance baseline.`
            : version ? `Python ${version} is unsupported; Python 3.14.x is required. Automatic runtime downloads are disabled.`
              : 'Python was found but its version could not be verified under the Windows process supervisor.',
        }
      } catch {
        python = { id: 'python', available: false, path: executable.executablePath, message: 'Python was found but could not run under the Windows process supervisor.' }
      }
    }

    const uvExecutable = await resolveUvExecutable()
    if (!uvExecutable) {
      uv = { id: 'uv', available: false, message: 'uv was not found on PATH. Install uv using its official user-managed installer, add uv.exe to PATH, then rerun Doctor.' }
    } else {
      try {
        const root = tmpdir()
        const result = await runSafeProcess({
          executablePath: uvExecutable.executablePath,
          allowedExecutableRoot: uvExecutable.directory,
          cwd: root,
          allowedCwdRoot: root,
          args: ['--version'],
          homeDirectory: root,
          tempDirectory: root,
          extraPath: [uvExecutable.directory],
          timeoutMs: 5_000,
        })
        const version = /^uv (\d+\.\d+\.\d+)\b/m.exec(`${result.stdout}\n${result.stderr}`)?.[1]
        const supported = result.exitCode === 0 && version !== undefined && supportsUv(version)
        uv = {
          id: 'uv',
          available: supported,
          path: uvExecutable.executablePath,
          ...(version ? { version } : {}),
          message: supported ? `uv ${version} satisfies the locked-project requirement (>=0.8.0).`
            : version ? `uv ${version} is too old; uv 0.8.0 or newer is required.`
              : 'uv was found but its version could not be verified under the Windows process supervisor.',
        }
      } catch {
        uv = { id: 'uv', available: false, path: uvExecutable.executablePath, message: 'uv was found but could not run under the Windows process supervisor.' }
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
  const tools: ToolStatus[] = [...(node ? [node] : []), ...(npm ? [npm] : []), ...(managerTool ? [managerTool] : []), ...(go ? [go] : []), ...(python ? [python] : []), ...(uv ? [uv] : []), {
    id: 'target',
    available: target.available && windows,
    message: windows ? target.message : 'Generation is supported on Windows only in Phase 01.',
  }]
  return {
    schemaVersion: 1,
    platform: `${process.platform}-${process.arch}`,
    ready: windows && (isGo ? Boolean(go?.available) : isPython ? Boolean(python?.available && uv?.available) : Boolean(node?.available && npm?.available && (!managerTool || managerTool.available))) && target.available,
    tools,
    target,
  }
}
