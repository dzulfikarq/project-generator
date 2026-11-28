import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { ALLOW_PLANNED_RECIPE_GENERATION, BUILD_PROFILE } from '../packages/core/dist/src/index.js'

if (process.platform !== 'win32') throw new Error('Phase 08A BE-02 reproducibility check requires Windows.')
assert.equal(BUILD_PROFILE, 'development', 'Build the internal development CLI before this evidence-only check.')
assert.equal(ALLOW_PLANNED_RECIPE_GENERATION, true)

const tempBase = join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'Temp', 'opencode')
await access(tempBase)
const runRoot = await mkdtemp(join(tempBase, 'phase-08a-be02-repro-'))
let passed = false

try {
  const localAppData = join(runRoot, 'app-data', 'local')
  const roamingAppData = join(runRoot, 'app-data', 'roaming')
  const temp = join(runRoot, 'app-data', 'temp')
  const workspaces = join(runRoot, 'workspaces')
  for (const path of [localAppData, roamingAppData, temp, workspaces]) await mkdir(path, { recursive: true })

  const cli = join(import.meta.dirname, '..', 'packages', 'cli', 'dist', 'src', 'index.js')
  const projectName = 'repro-go'
  const modulePath = 'example.com/repro-go'
  const runs = []

  for (const label of ['first', 'second']) {
    const parentDirectory = join(workspaces, label)
    await mkdir(parentDirectory)
    const config = join(runRoot, `${label}.json`)
    await writeFile(config, JSON.stringify({
      schemaVersion: 1,
      project: { name: projectName, parentDirectory, type: 'backend' },
      backend: { adapterId: 'backend.go-net-http', manager: 'go-modules', modulePath },
      documentation: 'minimal',
      git: { initialize: false, initialCommit: false },
    }))

    const result = spawnSync(process.execPath, [cli, 'generate', '--config', config, '--jsonl', '--development-allow-planned'], {
      cwd: join(import.meta.dirname, '..'),
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10 * 60 * 1000,
      env: {
        ...process.env,
        LOCALAPPDATA: localAppData,
        APPDATA: roamingAppData,
        TEMP: temp,
        TMP: temp,
        GOTOOLCHAIN: 'local',
        GOENV: 'off',
        GOPROXY: 'off',
        GOSUMDB: 'off',
        PG_BUILD_PROFILE: 'development',
        PG_ALLOW_PLANNED_RECIPE_GENERATION: 'true',
      },
    })
    assert.ifError(result.error)
    assert.equal(result.status, 0, `${label}: ${result.stderr}\n${result.stdout}`)
    const events = result.stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line))
    assert.ok(events.some((event) => event.type === 'job-finished' && event.status === 'completed'), label)

    const project = join(parentDirectory, projectName)
    const manifestPath = join(project, '.project-generator', 'manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    assert.equal(manifest.recipeId, 'BE-02')
    assert.equal(manifest.recipeStatusAtCreation, 'planned')
    assert.equal(manifest.modulePath, modulePath)
    assert.deepEqual(manifest.dependencyFiles, ['go.mod'])
    assert.deepEqual(manifest.validation.map(({ id, status }) => [id, status]), [
      ['scaffold-identity', 'pass'], ['go-module', 'pass'], ['go-fmt', 'pass'],
      ['go-vet', 'pass'], ['go-test', 'pass'], ['go-build', 'pass'], ['http-smoke', 'pass'],
    ])
    await assert.rejects(access(join(project, 'go.sum')), { code: 'ENOENT' })

    const files = []
    async function collect(directory) {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) await collect(path)
        else if (entry.isFile()) files.push(path)
      }
    }
    await collect(project)
    files.sort((left, right) => left.localeCompare(right, 'en'))

    const generatedTree = createHash('sha256')
    let generatedFileCount = 0
    for (const path of files) {
      if (path === manifestPath) continue
      generatedTree.update(path.slice(project.length + 1).replaceAll('\\', '/'))
      generatedTree.update('\0')
      generatedTree.update(await readFile(path))
      generatedTree.update('\0')
      generatedFileCount++
    }
    runs.push({
      label,
      generatedTreeSha256: generatedTree.digest('hex'),
      generatedFileCount,
      manifestSha256: createHash('sha256').update(await readFile(manifestPath)).digest('hex'),
      manifest,
    })
  }

  assert.equal(runs[0].generatedTreeSha256, runs[1].generatedTreeSha256)
  assert.equal(runs[0].generatedFileCount, runs[1].generatedFileCount)
  // ponytail: createdAt is intentionally volatile; compare every other manifest field.
  for (const run of runs) delete run.manifest.createdAt
  assert.deepEqual(runs[0].manifest, runs[1].manifest)

  passed = true
  console.log(JSON.stringify({
    status: 'PASS',
    recipe: 'BE-02',
    recipeStatus: 'planned',
    go: runs[0].manifest.toolVersions.go,
    generatedTreeSha256: runs[0].generatedTreeSha256,
    generatedFileCount: runs[0].generatedFileCount,
    manifestHashesDifferOnlyByCreatedAt: runs[0].manifestSha256 !== runs[1].manifestSha256,
    validations: runs[0].manifest.validation.map(({ id, status }) => ({ id, status })),
  }, null, 2))
} finally {
  if (passed) await rm(runRoot, { recursive: true, force: true })
  else console.error(`Retained reproducibility run for diagnosis: ${runRoot}`)
}
