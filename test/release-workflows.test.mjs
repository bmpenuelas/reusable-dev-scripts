import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { electron } from '../dist/desktop.js'
import { androidBuild } from '../dist/android.js'
import { store } from '../dist/store.js'
import { cloudflare } from '../dist/cloudflare.js'
import { validateConfig } from '../dist/config.js'
import { fixture } from './helpers.mjs'

const storeConfig = hooks => ({ version: 1, store: { root: 'store', locales: ['en-US'], androidId: 'app.fixture', playKey: 'private/play.json', iosId: 'app.fixture', appleKey: 'private/apple.json', hooks } })
const afterHook = [['node', 'scripts/after-upload.mjs', '{platform}']]
const hookCalls = f => f.ctx.plan.filter(step => step.label === 'Project hook' && step.args.includes('scripts/after-upload.mjs'))

test('afterBuildUpload runs only after a build upload the store accepted', async () => {
  const f = await fixture(storeConfig({ afterBuildUpload: afterHook }), { 'dry-run': true, platform: 'android' })
  await store(f.ctx, 'upload-build', [])
  assert.deepEqual(hookCalls(f).map(step => step.args), [['scripts/after-upload.mjs', 'android']])
  const lanes = f.ctx.plan.filter(step => step.label === 'Run shared Fastlane lane')
  assert.equal(f.ctx.plan.indexOf(hookCalls(f)[0]) > f.ctx.plan.indexOf(lanes.at(-1)), true, 'the hook follows the Fastlane upload')
})

test('afterBuildUpload is skipped for listings, validation-only runs, commit:false and failed uploads', async () => {
  const f = await fixture(storeConfig({ afterBuildUpload: afterHook }), { 'dry-run': true, platform: 'android' })
  await store(f.ctx, 'upload-listing', []); await store(f.ctx, 'verify', []); await store(f.ctx, 'doctor', [])
  await store(f.ctx, 'run', ['android', 'internal', 'validate:true'])
  await store(f.ctx, 'run', ['android', 'internal', 'commit:false'])
  assert.equal(hookCalls(f).length, 0)
  await store(f.ctx, 'run', ['android', 'internal', 'commit:true'])
  assert.equal(hookCalls(f).length, 1)
  await assert.rejects(store(f.ctx, 'run', ['android', 'internal', 'commit:maybe']), /commit must be true or false/)
  const failing = await fixture(storeConfig({ afterBuildUpload: afterHook }), { platform: 'android' })
  failing.ctx.runner = async step => { failing.calls.push(step); if (step.label === 'Run shared Fastlane lane') throw new Error('upload rejected'); return { stdout: '3.3.0', stderr: '' } }
  await failing.file('private/play.json', '{}'); await failing.file('store/fastlane/.keep')
  await assert.rejects(store(failing.ctx, 'upload-build', []), /upload rejected/)
  assert.equal(failing.calls.filter(step => step.args?.includes('scripts/after-upload.mjs')).length, 0)
})

test('afterBuildUpload is validated as an argv hook list', () => {
  assert.doesNotThrow(() => validateConfig(storeConfig({ afterBuildUpload: afterHook })))
  assert.throws(() => validateConfig(storeConfig({ afterBuildUpload: ['node scripts/after.mjs'] })))
  assert.throws(() => validateConfig(storeConfig({ afterUpload: afterHook })), /Unknown/)
})

// Notarization only runs on macOS; pretend to be on it while every external tool stays mocked.
const asMac = async action => { const original = Object.getOwnPropertyDescriptor(process, 'platform'); Object.defineProperty(process, 'platform', { value: 'darwin' }); try { return await action() } finally { Object.defineProperty(process, 'platform', original) } }
const notarize = (f, extra = {}) => { Object.assign(f.ctx.flags, { profile: 'fixture-profile', ...extra }); return asMac(() => electron(f.ctx, 'notarize')) }
const xcrun = f => f.calls.filter(step => step.command === 'xcrun').map(step => step.args.slice(0, 2).join(' '))

test('notarizing a ZIP can staple the app it contains, and a plain DMG staples itself', async () => {
  const f = await fixture({ version: 1, electron: {} })
  await f.file('release/desktop/App-mac-Intel.zip'); await f.file('release/desktop/mac/App.app/Contents/Info.plist'); await f.file('release/desktop/App-mac-Intel.dmg')
  await notarize(f, { artifact: 'release/desktop/App-mac-Intel.zip', 'dry-run': true })
  assert.deepEqual(xcrun(f), ['notarytool history', 'notarytool submit'], 'a ZIP is not stapled without --staple')
  f.calls.length = 0
  await notarize(f, { artifact: 'release/desktop/*-Intel.zip', staple: 'release/desktop/mac/*.app' })
  const staples = f.calls.filter(step => step.args[0] === 'stapler')
  assert.deepEqual(staples.map(step => step.args[1]), ['staple', 'validate'])
  assert.equal(staples[0].args[2], join(f.root, 'release/desktop/mac/App.app'))
  assert.equal(f.calls.find(step => step.args[1] === 'submit').args[2], join(f.root, 'release/desktop/App-mac-Intel.zip'))
  f.calls.length = 0; delete f.ctx.flags.staple
  await notarize(f, { artifact: 'release/desktop/App-mac-Intel.dmg' })
  assert.equal(f.calls.find(step => step.args[1] === 'staple').args[2], join(f.root, 'release/desktop/App-mac-Intel.dmg'))
})

test('notarization patterns must match one item and stay inside the project', async () => {
  const f = await fixture({ version: 1, electron: {} })
  await f.file('release/desktop/a-Intel.zip'); await f.file('release/desktop/b-Intel.zip'); await f.file('release/desktop/mac/App.app/x')
  await assert.rejects(notarize(f, { artifact: 'release/desktop/*-Intel.zip' }), /exactly one item; found 2/)
  await assert.rejects(notarize(f, { artifact: 'release/desktop/*-Arm.zip' }), /exactly one item; found 0/)
  await assert.rejects(notarize(f, { artifact: 'release/*/a-Intel.zip' }), /only in the last path segment/)
  await assert.rejects(notarize(f, { artifact: '../outside.zip' }), /inside|escapes/)
  await assert.rejects(notarize(f, { artifact: 'release/desktop/a-Intel.zip', staple: 'release/desktop/mac/App.txt' }), /\.app, DMG, or PKG/)
  assert.equal(xcrun(f).includes('notarytool submit'), false, 'invalid requests fail before anything is submitted')
})

test('the notary profile comes from the flag, then the environment, then configuration', async () => {
  const original = process.env.APPLE_NOTARY_PROFILE
  try {
    const f = await fixture({ version: 1, electron: { notaryProfile: 'configured' } }, { preflight: true })
    process.env.APPLE_NOTARY_PROFILE = 'from-env'
    await asMac(() => electron(f.ctx, 'notarize')); assert.ok(f.calls[0].args.includes('from-env'))
    f.ctx.flags.profile = 'from-flag'; await asMac(() => electron(f.ctx, 'notarize')); assert.ok(f.calls[1].args.includes('from-flag'))
    delete process.env.APPLE_NOTARY_PROFILE; delete f.ctx.flags.profile
    await asMac(() => electron(f.ctx, 'notarize')); assert.ok(f.calls[2].args.includes('configured'))
  } finally { if (original === undefined) delete process.env.APPLE_NOTARY_PROFILE; else process.env.APPLE_NOTARY_PROFILE = original }
})

test('Pages deployments opt into uploading a dirty tree explicitly', async () => {
  const config = commitDirty => ({ version: 1, cloudflare: { targets: { web: { kind: 'pages', directory: 'dist', projectName: 'fixture', ...(commitDirty === undefined ? {} : { commitDirty }) } } } })
  const plain = await fixture(config(), { env: 'staging' }); await cloudflare(plain.ctx, 'deploy-pages')
  assert.ok(!plain.calls[0].args.some(arg => arg.startsWith('--commit-dirty')))
  const dirty = await fixture(config(true), { env: 'staging' }); await cloudflare(dirty.ctx, 'deploy-pages')
  assert.ok(dirty.calls[0].args.includes('--commit-dirty=true'))
  assert.throws(() => validateConfig(config('yes')), /boolean/)
})

test('release Android builds report the mapping and native symbols that exist', async () => {
  const f = await fixture({ version: 1, android: { root: 'android', module: 'app' } }, { configuration: 'release', format: 'aab' })
  await f.file(process.platform === 'win32' ? 'android/gradlew.bat' : 'android/gradlew', 'wrapper'); await f.file('android/app/build/outputs/bundle/release/app-release.aab')
  await f.file('android/app/build/outputs/mapping/release/mapping.txt')
  await androidBuild(f.ctx)
  const logs = f.messages.join('\n')
  assert.match(logs, /R8 mapping: .*mapping\.txt/); assert.ok(!logs.includes('Native debug symbols'))
})
