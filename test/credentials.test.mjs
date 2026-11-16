import test from 'node:test'
import assert from 'node:assert/strict'
import { join, relative } from 'node:path'
import { existsSync } from 'node:fs'
import { store, storeCredentialPath } from '../dist/store.js'
import { validateConfig } from '../dist/config.js'
import { outputPath } from '../dist/runtime.js'
import { fixture } from './helpers.mjs'

test('external credentials require boolean opt-in and do not enable relative traversal', async () => {
  const f = await fixture({ version: 1, store: { allowExternalCredentials: false } })
  const other = await fixture(), outside = join(other.root, 'not-opened.json')
  assert.throws(() => storeCredentialPath(f.ctx, outside), /inside/)
  f.ctx.config.store.allowExternalCredentials = true
  assert.equal(storeCredentialPath(f.ctx, outside), outside)
  assert.throws(() => storeCredentialPath(f.ctx, relative(f.root, outside)), /inside/)
  assert.throws(() => outputPath(f.root, outside), /inside/)
  assert.equal(storeCredentialPath(f.ctx, 'local-key.json'), join(f.root, 'local-key.json'))
  for (const value of ['true', 1, null]) assert.throws(() => validateConfig({ version: 1, store: { allowExternalCredentials: value } }), /boolean/)
  for (const value of ['', 1, null, 'bad\0file']) assert.throws(() => validateConfig({ version: 1, store: { playKey: value } }), /filename/)
})

test('store dry-run passes absolute key references without reading/copying them or leaking paths', async () => {
  const other = await fixture(), playKey = join(other.root, 'absent-play.json'), appleKey = join(other.root, 'absent-apple.json')
  const f = await fixture({ version: 1, store: { root: 'store', locales: ['en-US'], androidId: 'com.example.app', iosId: 'com.example.app', allowExternalCredentials: true, playKey, appleKey } }, { 'dry-run': true, platform: 'android' })
  await store(f.ctx, 'doctor', [])
  const invocation = f.ctx.plan.at(-1)
  assert.equal(invocation.env.SUPPLY_JSON_KEY, playKey)
  assert.equal(invocation.env.APP_STORE_CONNECT_API_KEY_PATH, appleKey)
  assert.equal(f.calls.length, 0)
  assert.equal(existsSync(join(f.root, '.rds')), false)
  assert.equal(existsSync(playKey), false)
  assert.equal(existsSync(appleKey), false)
  assert.ok(!f.messages.join('').includes(other.root))
})
