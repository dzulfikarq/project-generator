import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { createGinGoMod, GIN_GO_MINIMUM, GIN_GO_SUM, GIN_GO_SUM_SHA256, GIN_VERSION, verifyGinModuleGraph } from '../src/gin-module-graph.js'

test('Gin module pins match checksum baseline and Go minimum', () => {
  assert.equal(createHash('sha256').update(GIN_GO_SUM).digest('hex'), GIN_GO_SUM_SHA256)
  const manifest = createGinGoMod('example.com/gin-api')
  assert.match(manifest, /^module example\.com\/gin-api\n\ngo 1\.25\.0\n/m)
  assert.ok(manifest.includes(`github.com/gin-gonic/gin v${GIN_VERSION}`))
  assert.ok(manifest.includes('golang.org/x/net v0.51.0 // indirect'))
  assert.equal(GIN_GO_MINIMUM, '1.25.0')
})

test('Gin module graph requires exact Gin pin and rejects transitive Go requirements above minimum', () => {
  const compatible = [
    'example.com/gin-api||1.25.0',
    'github.com/gin-gonic/gin|v1.12.0|1.25.0',
    'golang.org/x/net|v0.51.0|1.24.0',
  ].join('\n')
  assert.deepEqual(verifyGinModuleGraph(compatible), { moduleCount: 2, maximumGoVersion: '1.25.0' })
  assert.throws(() => verifyGinModuleGraph('example.com/gin-api||1.25.0\ngithub.com/gin-gonic/gin|v1.11.0|1.25.0'))
  assert.throws(() => verifyGinModuleGraph('example.com/gin-api||1.25.0\ngithub.com/gin-gonic/gin|v1.12.0|1.25.0\ngolang.org/x/net|v0.51.0|1.26.0'), /requires Go 1\.26\.0/)
})
