import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, realpath, rename } from 'node:fs/promises'
import { dirname, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GeneratorError } from './errors.js'
import { FORMA_COMMIT_SHA, FORMA_REPOSITORY, formaTemplate, isFormaCommit } from './forma-catalog.js'
import { runNodeProcess, type ProcessResult } from './runner.js'
import { mutateOwnedStage, type OwnedStage } from './staging.js'
import type { FrontendId, ProjectSelectionV1 } from './types.js'

interface FormaDirs {
  home: string
  temp: string
}

interface FormaJobLog {
  process(label: string, result: ProcessResult, hiddenPaths: readonly string[]): void
}

export interface FormaInstallEvidence {
  id: string
  name: string
  version: string
  commitSha: string
  contentHash: string
  license: string
  variantId: string
  variantName: string
}

function fail(code: string, message: string, nextAction: string): GeneratorError {
  return new GeneratorError({ code, stage: 'scaffolding', message, nextAction, targetModified: false })
}

function within(root: string, candidate: string): boolean {
  const relative = win32.relative(root, candidate)
  return relative === '' || (!win32.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..\\'))
}

async function realDirectory(path: string, parent?: string): Promise<string> {
  let info
  try {
    info = await lstat(path)
  } catch {
    throw fail('GEN_FORMA_CACHE_INVALID', 'Forma cache path is missing or inaccessible.', 'Inspect the Forma cache under LOCALAPPDATA; do not replace it automatically.')
  }
  if (!info.isDirectory() || info.isSymbolicLink()) throw fail('GEN_FORMA_CACHE_INVALID', 'Forma cache contains a non-directory or reparse point.', 'Inspect the Forma cache under LOCALAPPDATA; do not replace it automatically.')
  const resolved = await realpath(path)
  if (parent) {
    const realParent = await realpath(parent)
    if (!within(realParent, resolved)) throw fail('GEN_FORMA_CACHE_INVALID', 'Forma cache resolved outside its expected local directory.', 'Inspect LOCALAPPDATA and retry after correcting the cache path.')
  }
  return resolved
}

async function ensureChildDirectory(parent: string, name: string): Promise<string> {
  const parentReal = await realDirectory(parent)
  const child = win32.join(parentReal, name)
  try {
    await mkdir(child)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  return realDirectory(child, parentReal)
}

async function existingPath(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function cacheDirectories(): Promise<{ root: string; sources: string; bundles: string }> {
  const localAppData = process.env.LOCALAPPDATA
  if (!localAppData || !win32.isAbsolute(localAppData) || win32.parse(localAppData).root.startsWith('\\\\')) {
    throw fail('GEN_FORMA_CACHE_INVALID', 'A local Windows Forma cache location is unavailable.', 'Restore LOCALAPPDATA to a local drive and retry.')
  }
  const local = await realDirectory(localAppData)
  const root = await ensureChildDirectory(local, '.project-generator-forma-cache')
  const sources = await ensureChildDirectory(root, 'sources')
  const bundles = await ensureChildDirectory(root, 'bundles')
  return { root, sources, bundles }
}

async function gitExecutable(): Promise<string> {
  const searchPath = process.env.Path ?? process.env.PATH ?? ''
  for (const directory of searchPath.split(';').filter(Boolean)) {
    const candidate = win32.join(directory.replace(/^"|"$/g, ''), 'git.exe')
    try {
      const info = await lstat(candidate)
      if (info.isFile() && !info.isSymbolicLink()) return await realpath(candidate)
    } catch {
      // Continue through the user's configured executable search path.
    }
  }
  throw fail('GEN_FORMA_GIT_MISSING', 'Git is required to fetch the private Forma repository.', 'Install Git for Windows and sign in through its configured credential manager.')
}

async function runGitWorker(
  operation: 'fetch' | 'verify',
  gitPath: string,
  repositoryPath: string,
  stage: OwnedStage,
  dirs: FormaDirs,
  log: FormaJobLog,
  signal?: AbortSignal,
): Promise<void> {
  const workerPath = fileURLToPath(new URL('./forma-worker.js', import.meta.url))
  const profile = process.env.USERPROFILE ?? homedir()
  const result = await runNodeProcess({
    scriptPath: workerPath,
    allowedScriptRoot: dirname(workerPath),
    cwd: stage.path,
    allowedCwdRoot: stage.path,
    args: [operation, gitPath, repositoryPath, FORMA_COMMIT_SHA, profile],
    homeDirectory: dirs.home,
    tempDirectory: dirs.temp,
    extraPath: [dirname(gitPath)],
    ...(signal ? { signal } : {}),
    timeoutMs: 5 * 60 * 1000,
  })
  log.process(`forma-source-${operation}`, result, [stage.parentPath, stage.path, stage.targetPath, dirs.home, dirs.temp, profile])
  if (result.exitCode !== 0) {
    throw fail(operation === 'fetch' ? 'GEN_FORMA_FETCH_FAILED' : 'GEN_FORMA_CACHE_INVALID',
      operation === 'fetch' ? 'Authenticated Forma fetch or pinned commit verification failed.' : 'Cached Forma source differs from its immutable commit or contains local changes.',
      operation === 'fetch' ? 'Sign into GitHub through Git Credential Manager with repository read access, then retry.' : 'Inspect the Forma source cache; do not overwrite it automatically.')
  }
  let response: { ok?: boolean; commitSha?: string }
  try {
    response = JSON.parse(result.stdout) as typeof response
  } catch {
    throw fail('GEN_FORMA_CACHE_INVALID', 'Forma source verifier returned an invalid response.', 'Inspect the local redacted job log and retry.')
  }
  if (!response.ok || response.commitSha?.toLowerCase() !== FORMA_COMMIT_SHA) {
    throw fail('GEN_FORMA_CACHE_INVALID', 'Forma source commit did not match the immutable catalog pin.', 'Inspect the Forma source cache; do not overwrite it automatically.')
  }
}

async function formaSource(stage: OwnedStage, dirs: FormaDirs, log: FormaJobLog, signal?: AbortSignal): Promise<{ root: string; gitPath: string }> {
  const cache = await cacheDirectories()
  const gitPath = await gitExecutable()
  const repoPath = win32.join(cache.sources, FORMA_COMMIT_SHA)
  if (await existingPath(repoPath)) {
    await realDirectory(repoPath, cache.sources)
    await runGitWorker('verify', gitPath, repoPath, stage, dirs, log, signal)
    return { root: repoPath, gitPath }
  }

  const temporary = await mkdtemp(win32.join(cache.sources, `.partial-${FORMA_COMMIT_SHA}-`))
  await runGitWorker('fetch', gitPath, temporary, stage, dirs, log, signal)
  try {
    await rename(temporary, repoPath)
  } catch {
    if (!(await existingPath(repoPath))) throw fail('GEN_FORMA_CACHE_INVALID', 'Verified Forma source could not be committed to the local cache.', 'Inspect LOCALAPPDATA permissions and retry.')
    await realDirectory(repoPath, cache.sources)
    await runGitWorker('verify', gitPath, repoPath, stage, dirs, log, signal)
  }
  return { root: repoPath, gitPath }
}

async function runFormaScript(
  sourceRoot: string,
  gitPath: string,
  scriptName: 'template-export.mjs' | 'template-install.mjs',
  args: string[],
  stage: OwnedStage,
  dirs: FormaDirs,
  log: FormaJobLog,
  signal?: AbortSignal,
): Promise<ProcessResult> {
  const scriptPath = win32.join(sourceRoot, 'scripts', scriptName)
  const scriptInfo = await lstat(scriptPath).catch(() => undefined)
  if (!scriptInfo?.isFile() || scriptInfo.isSymbolicLink()) throw fail('GEN_FORMA_SOURCE_INVALID', 'Pinned Forma exporter or installer is missing or unsafe.', 'Inspect the immutable Forma source cache; do not substitute another script.')
  const result = await runNodeProcess({
    scriptPath,
    allowedScriptRoot: sourceRoot,
    cwd: stage.path,
    allowedCwdRoot: stage.path,
    args,
    homeDirectory: dirs.home,
    tempDirectory: dirs.temp,
    extraPath: [dirname(gitPath)],
    ...(signal ? { signal } : {}),
    timeoutMs: 5 * 60 * 1000,
  })
  log.process(`forma-${scriptName === 'template-export.mjs' ? 'export' : 'install'}`, result, [stage.parentPath, stage.path, stage.targetPath, dirs.home, dirs.temp, sourceRoot, ...args.filter((argument) => win32.isAbsolute(argument))])
  return result
}

async function readFormaManifest(bundlePath: string, templateId: string, framework: FrontendId, parent?: string): Promise<Record<string, unknown>> {
  const bundleRoot = await realDirectory(bundlePath, parent)
  const manifestPath = win32.join(bundleRoot, 'forma.install.json')
  const info = await lstat(manifestPath).catch(() => undefined)
  if (!info?.isFile() || info.isSymbolicLink()) throw fail('GEN_FORMA_CACHE_INVALID', 'Cached Forma bundle manifest is missing or unsafe.', 'Inspect the Forma package cache; do not overwrite it automatically.')
  let manifest: Record<string, unknown>
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>
  } catch {
    throw fail('GEN_FORMA_CACHE_INVALID', 'Cached Forma bundle manifest is invalid JSON.', 'Inspect the Forma package cache; do not overwrite it automatically.')
  }
  const source = manifest.source as { repository?: string; ref?: string } | undefined
  const template = manifest.template as { id?: string; version?: string; compatibility?: { framework?: string; status?: string }[] } | undefined
  const integrity = manifest.integrity as { algorithm?: string; contentHash?: string } | undefined
  const frameworkName = framework === 'frontend.react-vite' ? 'React + Vite' : 'Next.js App Router'
  const expected = formaTemplate(templateId)
  if (!expected || manifest.format !== 'forma-portable-template' || manifest.formatVersion !== 1
    || source?.repository !== FORMA_REPOSITORY.replace(/\.git$/, '')
    || source.ref?.toLowerCase() !== FORMA_COMMIT_SHA
    || template?.id !== templateId || template.version !== expected.version
    || integrity?.algorithm !== 'sha256' || integrity.contentHash?.toLowerCase() !== expected.contentHash
    || template.compatibility?.find((item) => item.framework === frameworkName)?.status !== 'tested') {
    throw fail('GEN_FORMA_CACHE_INVALID', 'Forma bundle provenance, template version, compatibility, or integrity metadata does not match the pinned catalog.', 'Inspect the Forma package cache; do not overwrite it automatically.')
  }
  return manifest
}

export async function installFormaTemplate(
  stage: OwnedStage,
  selection: NonNullable<ProjectSelectionV1['template']>,
  framework: FrontendId,
  projectName: string,
  dirs: FormaDirs,
  log: FormaJobLog,
  signal?: AbortSignal,
): Promise<FormaInstallEvidence> {
  const template = formaTemplate(selection.templateId)
  if (!template || !isFormaCommit(selection.commitSha) || !template.testedFrameworks.includes(framework)) {
    throw fail('GEN_INCOMPATIBLE', 'Forma template is not in the pinned compatibility catalog.', 'Choose a template verified for the selected framework and pinned commit.')
  }
  const { root, gitPath } = await formaSource(stage, dirs, log, signal)
  const cache = await cacheDirectories()
  const commitRoot = await ensureChildDirectory(cache.bundles, FORMA_COMMIT_SHA)
  const templateRoot = await ensureChildDirectory(commitRoot, template.id)
  const versionRoot = await ensureChildDirectory(templateRoot, template.version)
  const bundlePath = win32.join(versionRoot, template.contentHash)
  if (!(await existingPath(bundlePath))) {
    const temporaryBundle = win32.join(versionRoot, `.partial-${randomUUID()}`)
    const exported = await runFormaScript(root, gitPath, 'template-export.mjs', ['--id', template.id, '--out', temporaryBundle], stage, dirs, log, signal)
    if (exported.exitCode !== 0) {
      throw fail('GEN_FORMA_EXPORT_FAILED', 'Pinned Forma exporter could not create the portable package.', 'Review the redacted job log and retry with the same pinned source.')
    }
    await readFormaManifest(temporaryBundle, template.id, framework, versionRoot)
    try {
      await rename(temporaryBundle, bundlePath)
    } catch {
      if (!(await existingPath(bundlePath))) throw fail('GEN_FORMA_CACHE_INVALID', 'Verified Forma package could not be committed to the local cache.', 'Inspect LOCALAPPDATA permissions and retry.')
    }
  }
  const manifest = await readFormaManifest(bundlePath, template.id, framework, versionRoot)
  const integrity = manifest.integrity as { contentHash: string }
  const installer = await runFormaScript(root, gitPath, 'template-install.mjs', [
    '--id', template.id,
    '--package', bundlePath,
    '--framework', framework === 'frontend.react-vite' ? 'react-vite' : 'next-app-router',
    '--target', stage.childPath,
    ...(selection.variantId ? ['--variant', selection.variantId] : []),
  ], stage, dirs, log, signal)
  if (installer.exitCode !== 0) throw fail('GEN_FORMA_INSTALL_FAILED', 'The pinned Forma installer rejected the package or failed inside owned staging.', 'Review the redacted job log; staging cleanup or recovery remains owned by Project Generator.')

  const packagePath = win32.join(stage.childPath, 'package.json')
  const packageInfo = await lstat(packagePath).catch(() => undefined)
  if (!packageInfo?.isFile() || packageInfo.isSymbolicLink()) throw fail('GEN_FORMA_INSTALL_FAILED', 'Forma installer did not create a regular package.json.', 'Inspect the owned staging job and retry.')
  let packageManifest: Record<string, unknown>
  try {
    packageManifest = JSON.parse(await readFile(packagePath, 'utf8')) as Record<string, unknown>
  } catch {
    throw fail('GEN_FORMA_INSTALL_FAILED', 'Forma installer created an invalid package.json.', 'Inspect the owned staging job and retry.')
  }
  packageManifest.name = projectName
  const selectedVariant = template.variants.find((variant) => variant.id === selection.variantId)
    ?? template.variants.find((variant) => variant.default)
  if (!selectedVariant) throw fail('GEN_FORMA_CACHE_INVALID', 'Pinned template has no default theme variant.', 'Review Forma registry metadata at the pinned commit.')
  const reportPath = win32.join(stage.childPath, 'forma-install-report.json')
  const reportInfo = await lstat(reportPath).catch(() => undefined)
  if (!reportInfo?.isFile() || reportInfo.isSymbolicLink()) throw fail('GEN_FORMA_INSTALL_FAILED', 'Forma installer did not create a regular install report.', 'Inspect the owned staging job and retry.')
  let installReport: Record<string, unknown>
  try {
    installReport = JSON.parse(await readFile(reportPath, 'utf8')) as Record<string, unknown>
  } catch {
    throw fail('GEN_FORMA_INSTALL_FAILED', 'Forma installer created an invalid install report.', 'Inspect the owned staging job and retry.')
  }
  installReport.target = '.'
  installReport.packageManager = 'npm'
  installReport.commands = ['npm install', 'npm run typecheck', 'npm run build', 'npm run dev']
  await mutateOwnedStage(stage, [], [{
    path: `${win32.basename(stage.childPath)}/package.json`,
    content: `${JSON.stringify(packageManifest, null, 2)}\n`,
    replace: true,
  }, {
    path: `${win32.basename(stage.childPath)}/FORMA-INSTALL.md`,
    content: `# ${template.name} · Project Generator\n\nFramework: ${framework === 'frontend.react-vite' ? 'React + Vite' : 'Next.js App Router'}\nTemplate: ${template.id}@${template.version}\nTheme: ${selectedVariant.name}\nForma source commit: ${FORMA_COMMIT_SHA}\nPortable package SHA-256: ${integrity.contentHash}\n\nDependencies were installed with npm during generation. Run \`npm run dev\` to start the project; run \`npm run typecheck\` and \`npm run build\` to validate changes.\n\nTemplate interactions use local mock data where indicated in the bundled design notes.\n`,
    replace: true,
  }, {
    path: `${win32.basename(stage.childPath)}/INSTALL.md`,
    content: `# Forma template installation\n\nProject Generator installed ${template.id}@${template.version} for ${framework === 'frontend.react-vite' ? 'React + Vite' : 'Next.js App Router'} using Forma's portable exporter and installer.\n\nUse npm in this generated project. See [FORMA-INSTALL.md](FORMA-INSTALL.md) for source provenance and validation commands.\n`,
    replace: true,
  }, {
    path: `${win32.basename(stage.childPath)}/forma-install-report.json`,
    content: `${JSON.stringify(installReport, null, 2)}\n`,
    replace: true,
  }])
  return {
    id: template.id,
    name: template.name,
    version: template.version,
    commitSha: FORMA_COMMIT_SHA,
    contentHash: integrity.contentHash,
    license: template.license,
    variantId: selectedVariant.id,
    variantName: selectedVariant.name,
  }
}
