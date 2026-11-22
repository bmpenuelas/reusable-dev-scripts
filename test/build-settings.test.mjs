import test from 'node:test'
import assert from 'node:assert/strict'
import { androidBuild } from '../dist/android.js'
import { validateConfig } from '../dist/config.js'
import { resolveBuildSettings } from '../dist/build-settings.js'
import { fixture } from './helpers.mjs'

const settings = { android: { all: ['sharedFlag=on'], debug: ['kindIs=debug'], release: ['kindIs=release'], 'internal-only': ['diagnostics=true'] }, ios: { release: ['A=1'], 'testflight-only': ['B=2'] } }

async function gradleArgs(flags, config = { version: 1, buildSettings: settings }) {
  const f = await fixture(config, { 'dry-run': true, ...flags })
  await androidBuild(f.ctx)
  return f.ctx.plan.find(step => step.label === 'Android Gradle build').args
}

test('Android builds receive the platform list, then their configuration list, then an optional custom kind, as Gradle properties', async () => {
  assert.deepEqual(await gradleArgs({ configuration: 'release', format: 'aab' }), ['-PsharedFlag=on', '-PkindIs=release', ':app:bundleRelease'])
  assert.deepEqual(await gradleArgs({ configuration: 'debug', format: 'apk' }), ['-PsharedFlag=on', '-PkindIs=debug', ':app:assembleDebug'])
  assert.deepEqual(await gradleArgs({ configuration: 'release', format: 'aab', kind: 'internal-only', clean: true }), ['clean', '-PsharedFlag=on', '-PkindIs=release', '-Pdiagnostics=true', ':app:bundleRelease'])
  assert.deepEqual(await gradleArgs({ configuration: 'release', format: 'aab' }, { version: 1 }), [':app:bundleRelease'], 'nothing changes without configuration')
})

test('an Android kind must be defined in the configuration; reserved and malformed settings are rejected when the configuration loads', async () => {
  await assert.rejects(gradleArgs({ configuration: 'release', format: 'aab', kind: 'nope' }), /Unknown Android build kind: nope/)
  await assert.rejects(gradleArgs({ configuration: 'release', format: 'aab', kind: 'release' }), /Invalid --kind/)
  await assert.rejects(gradleArgs({ configuration: 'release', format: 'aab', kind: 'all' }), /Invalid --kind/)
  await assert.rejects(gradleArgs({ configuration: 'release', format: 'aab', kind: '../x' }), /Invalid --kind/)
  const with_ = buildSettings => () => validateConfig({ version: 1, buildSettings })
  for (const bad of ['no-equals', '1bad=x', 'android.injected.signing.store.file=x', 'storePassword=x', 'releaseKeystore=x', 'versionCode=9', 'a=b\nc'])
    assert.throws(with_({ android: { release: [bad] } }), /buildSettings\.android\.release/, bad)
  for (const bad of ['lower=case', 'NO_VALUE', 'CODE_SIGN_IDENTITY=x', 'DEVELOPMENT_TEAM=ABC', 'MARKETING_VERSION=9.9.9', 'PRODUCT_BUNDLE_IDENTIFIER=evil', 'CONFIGURATION=Debug'])
    assert.throws(with_({ ios: { 'testflight-only': [bad] } }), /buildSettings\.ios\.testflight-only/, bad)
  assert.throws(with_({ ios: { beta: ['A=1'] } }), /Unknown iOS build kind: beta/)
  assert.throws(with_({ android: { 'Bad Kind': ['A=1'] } }), /Invalid Android build kind name/)
  assert.throws(with_({ windows: {} }), /Unknown buildSettings platform|Unknown buildSettings field/)
  assert.throws(with_({ android: { release: 'A=1' } }), /must be an array/)
  assert.doesNotThrow(with_(settings))
})

test('resolveBuildSettings keeps the order all, then each kind, and ignores kinds that are not configured', () => {
  const config = { version: 1, buildSettings: settings }
  assert.deepEqual(resolveBuildSettings(config, 'android', ['release', 'internal-only']), ['sharedFlag=on', 'kindIs=release', 'diagnostics=true'])
  assert.deepEqual(resolveBuildSettings(config, 'ios', ['release']), ['A=1'])
  assert.deepEqual(resolveBuildSettings({ version: 1 }, 'ios', ['release']), [])
})
