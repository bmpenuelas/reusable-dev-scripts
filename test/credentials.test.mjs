import test from 'node:test'
import assert from 'node:assert/strict'
import { join, relative } from 'node:path'
import { existsSync } from 'node:fs'
import { store, storeCredentialPath } from '../dist/store.js'
import { validateConfig } from '../dist/config.js'
import { outputPath } from '../dist/runtime.js'
import { fixture } from './helpers.mjs'

const variables = ['SUPPLY_JSON_KEY', 'APP_STORE_CONNECT_API_KEY_PATH']
// Starts without the key variables of whoever runs the tests and restores them afterwards.
function isolateKeyVariables(t) {
  const saved = variables.map(name => [name, process.env[name]])
  for (const name of variables) delete process.env[name]
  t.after(() => { for (const [name, value] of saved) if (value === undefined) delete process.env[name]; else process.env[name] = value })
}
const ids = { root: 'store', locales: ['en-US'], androidId: 'com.example.app', iosId: 'com.example.app' }
const keyCases = [
  { platform: 'ios', setting: 'appleKey', variable: 'APP_STORE_CONNECT_API_KEY_PATH', file: 'store/fastlane/app-store-connect-api-key.json' },
  { platform: 'android', setting: 'playKey', variable: 'SUPPLY_JSON_KEY', file: 'store/fastlane/play-service-account.json' },
]

test('store keys resolve from the setting, then the environment variable, then the default file', async t => {
  isolateKeyVariables(t)
  for (const { platform, setting, variable, file } of keyCases) {
    const f = await fixture({ version: 1, store: { ...ids } }, { 'dry-run': true, platform })
    const passed = async () => { await store(f.ctx, 'doctor', []); return f.ctx.plan.at(-1).env[variable] }
    await assert.rejects(store(f.ctx, 'doctor', []), error => [`store.${setting}`, variable, file].every(text => error.message.includes(text)) && !error.message.includes(f.root))
    await f.file(file)
    assert.equal(await passed(), join(f.root, file))
    process.env[variable] = 'private/from-variable.json'
    assert.equal(await passed(), join(f.root, 'private/from-variable.json'))
    f.ctx.config.store[setting] = 'private/from-config.json'
    assert.equal(await passed(), join(f.root, 'private/from-config.json'))
    delete process.env[variable]
  }
})

test('a key variable obeys containment and does not affect the other store', async t => {
  isolateKeyVariables(t)
  const other = await fixture(), outside = join(other.root, 'not-opened.json')
  const f = await fixture({ version: 1, store: { ...ids, appleKey: 'private/apple.json' } }, { 'dry-run': true, platform: 'ios' })
  process.env.SUPPLY_JSON_KEY = outside
  await store(f.ctx, 'doctor', [])
  f.ctx.flags.platform = 'android'
  await assert.rejects(store(f.ctx, 'doctor', []), /inside/)
  f.ctx.config.store.allowExternalCredentials = true
  await store(f.ctx, 'doctor', [])
  assert.equal(f.ctx.plan.at(-1).env.SUPPLY_JSON_KEY, outside)
})

test('store verify covers a store whose key is only the default file', async t => {
  isolateKeyVariables(t)
  const f = await fixture({ version: 1, store: { ...ids } }, { 'dry-run': true })
  await assert.rejects(store(f.ctx, 'verify', []), /Configure store.androidId/)
  await f.file('store/fastlane/app-store-connect-api-key.json')
  await store(f.ctx, 'verify', [])
  assert.deepEqual(f.ctx.plan.filter(step => step.args.at(-2) === 'verify').map(step => step.args.at(-3)), ['ios'])
})

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
