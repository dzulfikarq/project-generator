import { inspectTarget } from './paths.js'
import { packageManager } from './catalog.js'
import { tmpdir } from 'node:os'
import { LARAVEL_REQUIRED_EXTENSIONS, resolveComposerPhar, resolveGoTool, resolveNpmTool, resolvePhpExecutable, resolvePythonExecutable, resolveUvExecutable, supportsComposer, supportsGo, supportsGoGin, supportsNpm, supportsNodeForAngular, supportsNodeForBackend, supportsNodeForNext, supportsNodeForNuxt, supportsNodeForPnpm, supportsNodeForVite, supportsNodeForVue, supportsPhp, supportsPython, supportsUv } from './toolchain.js'
import { runSafeProcess } from './runner.js'
import type { DoctorReport, ProjectSelectionV1, ToolStatus } from './types.js'
import { resolveSelection } from './resolver.js'

export async function runDoctor(selection: ProjectSelectionV1): Promise<DoctorReport> {
  const resolved = resolveSelection(selection)
  const recipe = resolved.recipe
  const isGo = recipe.id === 'BE-02'
  const isGin = recipe.id === 'BE-04'
  const isDatabaseBackend = recipe.id === 'BE-07'
  const isPostgresBackend = recipe.id === 'BE-08'
  const isNestPostgresBackend = recipe.id === 'BE-09'
  const isVueFullstack = recipe.id === 'FS-07'
  const usesGo = isGo || isGin
  const isLaravel = recipe.id === 'BE-05'
  const isPython = recipe.id === 'BE-06'
  const isPhp = isLaravel
  const nodeVersion = process.version.replace(/^v/, '')
  const frameworkNodeSupported = isVueFullstack
    ? supportsNodeForVue(nodeVersion)
    : recipe.backend && !isPhp
    ? supportsNodeForBackend(nodeVersion)
    : recipe.frontend === 'frontend.vue-vite'
      ? supportsNodeForVue(nodeVersion)
      : recipe.frontend === 'frontend.nuxt' ? supportsNodeForNuxt(nodeVersion)
        : recipe.frontend === 'frontend.angular' ? supportsNodeForAngular(nodeVersion)
          : recipe.frontend === 'frontend.nextjs-app' ? supportsNodeForNext(nodeVersion) : supportsNodeForVite(nodeVersion)
  const nodeSupported = frameworkNodeSupported && (recipe.manager !== 'pnpm' || supportsNodeForPnpm(nodeVersion))
  const node: ToolStatus | undefined = usesGo || isPython || isPhp ? undefined : {
    id: 'node',
    available: nodeSupported,
    version: nodeVersion,
    message: nodeSupported ? isVueFullstack ? 'Node.js satisfies Vue/Vite and Express workspace requirements; Doctor does not connect to PostgreSQL.' : isDatabaseBackend ? 'Node.js satisfies Express and native SQLite requirements; better-sqlite3 runtime compatibility is verified during explicit dependency installation.' : isPostgresBackend ? 'Node.js satisfies the Express/PostgreSQL recipe requirement; Doctor does not connect to PostgreSQL.' : isNestPostgresBackend ? 'Node.js satisfies the NestJS/PostgreSQL recipe requirement; Doctor does not connect to PostgreSQL.' : 'Node.js version satisfies pinned scaffold and package-manager requirements.' : `Node.js ${process.version} is outside this recipe's supported range.`,
  }

  const npmTool = usesGo || isPython || isPhp ? undefined : await resolveNpmTool()
  const npm: ToolStatus | undefined = usesGo || isPython || isPhp ? undefined : npmTool ? {
    id: 'npm',
    available: supportsNpm(npmTool.version),
    version: npmTool.version,
    message: supportsNpm(npmTool.version) ? 'Trusted npm CLI found beside the active Node runtime.' : `npm ${npmTool.version} is older than required npm 10.`,
  } : {
    id: 'npm',
    available: false,
    message: 'Trusted npm CLI was not found beside the active Node runtime.',
  }

  const selectedManager = usesGo || isPython || isPhp || recipe.manager === 'npm' ? undefined : packageManager(recipe.manager)
  const managerTool: ToolStatus | undefined = selectedManager ? {
    id: selectedManager.id === 'go-modules' ? 'go' : selectedManager.id,
    available: npm?.available === true && (selectedManager.id !== 'pnpm' || supportsNodeForPnpm(nodeVersion)),
    version: selectedManager.version,
    message: npm?.available
      ? `Pinned ${selectedManager.id} is staged from the npm registry after consent; version and integrity are verified before use.`
      : `npm 10 or newer is required to stage pinned ${selectedManager.id}.`,
  } : undefined

  let go: ToolStatus | undefined
  if (usesGo) {
    const requiredGo = isGin ? '1.25.0' : '1.22.0'
    const executable = await resolveGoTool()
    if (!executable) {
      go = { id: 'go', available: false, message: `Go SDK was not found on PATH or under GOROOT. Install Go ${requiredGo} or newer, add its bin directory to PATH, then rerun Doctor.` }
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
          environment: { GOTOOLCHAIN: 'local', GOENV: 'off' },
          timeoutMs: 5_000,
        })
        const version = /^go version go(\d+\.\d+(?:\.\d+)?)\s/.exec(result.stdout.trim())?.[1]
        const supported = result.exitCode === 0 && version !== undefined && (isGin ? supportsGoGin(version) : supportsGo(version))
        go = {
          id: 'go',
          available: supported,
          path: executable.executablePath,
          ...(version ? { version } : {}),
          message: supported ? `Go ${version} satisfies the ${isGin ? 'Gin module graph' : 'Go Modules and net/http'} requirement (>=${requiredGo}).`
            : version ? `Go ${version} is unsupported; install Go ${requiredGo} or newer and rerun Doctor.`
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

  let php: ToolStatus | undefined
  let composer: ToolStatus | undefined
  if (isLaravel) {
    const executable = await resolvePhpExecutable()
    if (!executable) {
      php = { id: 'php', available: false, message: 'PHP was not found on PATH. Install PHP 8.2 or newer with Laravel extensions, then rerun Doctor.' }
      composer = { id: 'composer', available: false, message: 'Composer check requires a supported PHP executable.' }
    } else {
      const root = tmpdir()
      let version: string | undefined
      let missing: string[] = [...LARAVEL_REQUIRED_EXTENSIONS]
      try {
        const result = await runSafeProcess({
          executablePath: executable.executablePath,
          allowedExecutableRoot: executable.directory,
          cwd: root,
          allowedCwdRoot: root,
          args: ['-r', 'echo json_encode([PHP_VERSION, get_loaded_extensions()], JSON_THROW_ON_ERROR);'],
          homeDirectory: root,
          tempDirectory: root,
          extraPath: [executable.directory],
          timeoutMs: 5_000,
        })
        const probe = JSON.parse(result.stdout.trim()) as [string, string[]]
        version = probe[0]
        const extensions = new Set(probe[1].map((extension) => extension.toLowerCase()))
        missing = LARAVEL_REQUIRED_EXTENSIONS.filter((extension) => !extensions.has(extension))
        php = {
          id: 'php',
          available: result.exitCode === 0 && supportsPhp(version) && missing.length === 0,
          path: executable.executablePath,
          version,
          message: !supportsPhp(version) ? `PHP ${version} is unsupported; Laravel 12 requires PHP 8.2 or newer, below 9.0.`
            : missing.length ? `PHP ${version} is missing Laravel/MySQL extensions: ${missing.join(', ')}.`
              : `PHP ${version} and required Laravel/MySQL extensions are available (including pdo_mysql).`,
        }
      } catch {
        php = { id: 'php', available: false, path: executable.executablePath, message: 'PHP was found but its version/extensions could not be verified by the Windows supervisor.' }
      }

      const phar = await resolveComposerPhar()
      if (!phar) {
        composer = { id: 'composer', available: false, message: 'composer.phar was not found on PATH. Install Composer for the current user, then rerun Doctor.' }
      } else if (!version || !supportsPhp(version) || missing.length > 0) {
        composer = { id: 'composer', available: false, path: phar.pharPath, message: 'Composer checks require PHP 8.2+ with the required Laravel/MySQL extensions.' }
      } else {
        try {
          const result = await runSafeProcess({
            executablePath: executable.executablePath,
            allowedExecutableRoot: executable.directory,
            cwd: root,
            allowedCwdRoot: root,
            args: [phar.pharPath, '--version'],
            homeDirectory: root,
            tempDirectory: root,
            extraPath: [executable.directory],
            timeoutMs: 5_000,
          })
          const composerVersion = /^Composer version (\d+\.\d+\.\d+)\b/m.exec(`${result.stdout}\n${result.stderr}`)?.[1]
          const supported = result.exitCode === 0 && composerVersion !== undefined && supportsComposer(composerVersion)
          composer = {
            id: 'composer',
            available: supported,
            path: phar.pharPath,
            ...(composerVersion ? { version: composerVersion } : {}),
            message: supported ? `Composer ${composerVersion} satisfies the Composer 2.2+ requirement; generation disables plugins and scripts.`
              : composerVersion ? `Composer ${composerVersion} is unsupported; Composer 2.2 or newer is required.`
                : 'Composer was found but its version could not be verified with the selected PHP runtime.',
          }
        } catch {
          composer = { id: 'composer', available: false, path: phar.pharPath, message: 'Composer was found but could not run through the Windows supervisor.' }
        }
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
  const tools: ToolStatus[] = [...(node ? [node] : []), ...(npm ? [npm] : []), ...(managerTool ? [managerTool] : []), ...(go ? [go] : []), ...(php ? [php] : []), ...(composer ? [composer] : []), ...(python ? [python] : []), ...(uv ? [uv] : []), {
    id: 'target',
    available: target.available && windows,
    message: windows ? target.message : 'Generation is supported on Windows only in Phase 01.',
  }]
  return {
    schemaVersion: 1,
    platform: `${process.platform}-${process.arch}`,
    ready: windows && (usesGo ? Boolean(go?.available) : isLaravel ? Boolean(php?.available && composer?.available) : isPython ? Boolean(python?.available && uv?.available) : Boolean(node?.available && npm?.available && (!managerTool || managerTool.available))) && target.available,
    tools,
    target,
  }
}
