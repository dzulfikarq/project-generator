import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { win32 } from 'node:path'
import test from 'node:test'
import { FASTAPI_PINS } from '../src/fastapi-backend-starter.js'
import { verifyUvLockfile } from '../src/fastapi-project-docs.js'

function lockfile(): string {
  return [
    'version = 1',
    'revision = 3',
    'requires-python = ">=3.14, <3.15"',
    ...Object.entries(FASTAPI_PINS).flatMap(([name, version]) => [
      '', '[[package]]', `name = "${name}"`, `version = "${version}"`,
      `wheels = [{ url = "https://files.pythonhosted.org/${name}.whl", hash = "sha256:${'a'.repeat(64)}" }]`,
    ]),
    '',
  ].join('\n')
}

test('uv lock validation requires exact direct pins, artifact hashes, and one native lockfile', async () => {
  const directory = await mkdtemp(win32.join(tmpdir(), 'pg-fastapi-lock-'))
  try {
    await writeFile(win32.join(directory, 'uv.lock'), lockfile())
    assert.match(await verifyUvLockfile(directory), /^[a-f0-9]{64}$/)

    await writeFile(win32.join(directory, 'uv.lock'), lockfile().replace('version = "0.163.0"', 'version = "0.1.0"'))
    await assert.rejects(verifyUvLockfile(directory), /Expected exactly one valid uv\.lock/)

    await writeFile(win32.join(directory, 'uv.lock'), lockfile())
    await writeFile(win32.join(directory, 'package-lock.json'), '{}')
    await assert.rejects(verifyUvLockfile(directory), /Expected exactly one valid uv\.lock/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
