import test from 'node:test'
import assert from 'node:assert/strict'
import { parseJson5, mergeDefaults, isObject } from '../dist/json5.js'
import { parseJson5 as fromEnv, mergeDefaults as mergeFromEnv } from '../dist/env.js'

test('the json5 subpath parses comments and trailing commas without touching string contents', () => {
  const value = parseJson5('{\n  // line\n  "a": [1, 2,], /* block */\n  "b": "keep , } // and /* these */",\n}\n')
  assert.deepEqual(value, { a: [1, 2], b: 'keep , } // and /* these */' })
  assert.throws(() => parseJson5('{"a": }'))
})

test('the json5 helpers are shared with the env module and the package exports', async () => {
  assert.equal(fromEnv, parseJson5); assert.equal(mergeFromEnv, mergeDefaults)
  assert.deepEqual(mergeDefaults({ a: 1, n: { x: 1 } }, { a: 2, b: 3, n: { x: 9, y: 2 } }), { a: 1, b: 3, n: { x: 1, y: 2 } })
  assert.ok(isObject({}) && !isObject([]) && !isObject(null))
  const manifest = JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(manifest.exports['./json5'].import, './dist/json5.js')
})
