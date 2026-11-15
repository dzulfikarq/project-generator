import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { win32 } from 'node:path'
import test from 'node:test'
import { verifyComposerLockfile } from '../src/laravel-project-docs.js'

function composerJson(framework = '12.72.0') {
  return JSON.stringify({
    name: 'forma/sample-api',
    require: { php: '^8.2', 'laravel/framework': framework, 'ext-pdo_mysql': '*' },
    'require-dev': { 'phpunit/phpunit': '^11.5.50' },
  })
}

function composerLock(framework = 'v12.72.0', phpunit = '11.5.55') {
  return JSON.stringify({
    'content-hash': 'a'.repeat(32),
    packages: [{ name: 'laravel/framework', version: framework }],
    'packages-dev': [{ name: 'phpunit/phpunit', version: phpunit }],
  }, null, 2)
}

test('Laravel Composer lock validation pins framework, PHPUnit, and one lockfile hash', async () => {
  const directory = await mkdtemp(win32.join(tmpdir(), 'pg-laravel-lock-'))
  try {
    await writeFile(win32.join(directory, 'composer.json'), composerJson())
    const lock = composerLock()
    await writeFile(win32.join(directory, 'composer.lock'), lock)
    const evidence = await verifyComposerLockfile(directory)
    assert.equal(evidence.sha256, createHash('sha256').update(lock).digest('hex'))
    assert.equal(evidence.frameworkVersion, '12.72.0')
    assert.equal(evidence.phpunitVersion, '11.5.55')
    assert.equal(evidence.packageCount, 2)

    await writeFile(win32.join(directory, 'composer.lock'), composerLock('v12.71.0'))
    await assert.rejects(verifyComposerLockfile(directory), /does not contain pinned Laravel 12/)
    await writeFile(win32.join(directory, 'composer.lock'), composerLock('v12.72.0', '11.5.49'))
    await assert.rejects(verifyComposerLockfile(directory), /does not contain pinned Laravel 12/)
    await writeFile(win32.join(directory, 'composer.lock'), composerLock())
    await writeFile(win32.join(directory, 'package-lock.json'), '{}')
    await assert.rejects(verifyComposerLockfile(directory), /Unexpected project lockfile set/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
