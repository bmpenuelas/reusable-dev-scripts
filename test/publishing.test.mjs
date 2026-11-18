import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { unzipSync, strFromU8 } from 'fflate'
import { vscode, browserPackage } from '../dist/extensions.js'
import { cloudflare } from '../dist/cloudflare.js'
import { electron, electronAssets, swift } from '../dist/desktop.js'
import sharp from 'sharp'
import { ownedDirectory } from '../dist/files.js'
import { store, storeSettings } from '../dist/store.js'
import { fixture } from './helpers.mjs'

test('VS Code publishes exactly the same VSIX to both registries', async () => {
  const f = await fixture({ version: 1, vscode: { prepare: [['node', 'compile.mjs']], noDependencies: true } }, { 'dry-run': true, registry: 'all' })
  await f.file('package.json', '{"name":"fixture","version":"1.0.0"}'); await vscode(f.ctx, 'publish')
  const packageStep = f.ctx.plan.find(x => x.args[0] === 'package'), marketplace = f.ctx.plan.find(x => x.args[0] === 'publish' && x.command === 'vsce'), openvsx = f.ctx.plan.find(x => x.command === 'ovsx')
  assert.equal(packageStep.args[2], marketplace.args[2]); assert.equal(packageStep.args[2], openvsx.args[1]); assert.ok(packageStep.args.includes('--no-dependencies'))
  assert.ok(!f.ctx.plan.some(x => x.command === 'git'))
})
test('browser packaging produces a ZIP with a manifest and no filesystem paths', async () => {
  const f = await fixture({ version: 1, browser: { directory: 'dist', output: 'release/extension.zip' } })
  await f.file('dist/manifest.json', '{"manifest_version":3,"name":"fixture","version":"1"}'); await f.file('dist/sub/code.js', 'hello')
  await browserPackage(f.ctx); const archive = unzipSync(await readFile(join(f.root, 'release/extension.zip')))
  assert.equal(strFromU8(archive['sub/code.js']), 'hello'); assert.ok(archive['manifest.json']); assert.ok(!Object.keys(archive).some(x => x.includes('..') || x.includes('\\')))
})
test('browser rejects output inside source directory and dry-run does not write', async () => {
  const f = await fixture({ version: 1, browser: { directory: 'dist', output: 'dist/archive.zip' } }, { 'dry-run': true }); await assert.rejects(browserPackage(f.ctx), /outside/)
  f.ctx.config.browser.output = 'release/extension.zip'; await browserPackage(f.ctx); assert.equal(existsSync(join(f.root, 'release')), false)
})
test('Cloudflare requires a selected kind and explicit environment', async () => {
  const f = await fixture({ version: 1, cloudflare: { targets: { worker: { kind: 'worker', config: 'wrangler.toml' } } } }, { 'dry-run': true })
  await assert.rejects(cloudflare(f.ctx, 'deploy-worker'), /explicit/)
  f.ctx.flags.env = 'staging'; await assert.rejects(cloudflare(f.ctx, 'deploy-pages'), /Pages/)
})
test('Worker and Pages deployment plans are intentionally different', async () => {
  const f = await fixture({ version: 1, cloudflare: { targets: { app: { kind: 'worker', root: 'backend', config: 'wrangler.toml' }, landing: { kind: 'pages', directory: 'landing/dist', projectName: 'fixture' } } } }, { 'dry-run': true, env: 'staging', target: 'app' })
  await cloudflare(f.ctx, 'deploy-worker'); assert.deepEqual(f.ctx.plan[0].args.slice(0, 2), ['deploy', '--config'])
  f.ctx.flags.target = 'landing'; await cloudflare(f.ctx, 'deploy-pages'); assert.deepEqual(f.ctx.plan[1].args.slice(0, 2), ['pages', 'deploy']); assert.ok(f.ctx.plan[1].args.includes('staging'))
})
test('Worker secrets use stdin and an allowlist without leaking to logs', async () => {
  const f = await fixture({ version: 1, cloudflare: { targets: { app: { kind: 'worker', config: 'wrangler.jsonc', secretsFile: 'secrets.json', secretNames: ['SESSION_SECRET'] } } } }, { env: 'staging' })
  await f.file('secrets.json', '{"SESSION_SECRET":"secret-with-spaces","DO_NOT_UPLOAD":"private"}')
  await cloudflare(f.ctx, 'push-secrets'); assert.deepEqual(JSON.parse(f.calls[0].input), { SESSION_SECRET: 'secret-with-spaces' }); assert.ok(!f.messages.join('').includes('secret-with-spaces')); assert.ok(!f.calls[0].args.includes('secret-with-spaces'))
})
test('cleanup only operates on output directories marked as owned', async () => {
  const f = await fixture(); await f.file('output/irreplaceable.txt', 'important'); await assert.rejects(ownedDirectory(f.ctx, 'output', true), /not created/)
  await ownedDirectory(f.ctx, 'new-output'); await f.file('new-output/old.txt', 'old'); await ownedDirectory(f.ctx, 'new-output', true); assert.ok(!existsSync(join(f.root, 'new-output/old.txt')))
})
test('Electron build passes platform/architecture without implicit publishing', async () => {
  const f = await fixture({ version: 1, electron: {} }, { 'dry-run': true, platform: 'windows', arch: 'arm64', format: 'nsis' }); await electron(f.ctx, 'build')
  assert.ok(f.ctx.plan[0].args.includes('--win')); assert.ok(f.ctx.plan[0].args.includes('--arm64')); assert.deepEqual(f.ctx.plan[0].args.slice(3, 5), ['--publish', 'never']); assert.equal(existsSync(join(f.root, 'release')), false)
})
test('Electron icons are real multi-resolution ICO/ICNS containers', async () => {
  const f = await fixture({ version: 1, electron: { assets: { source: 'icon.png', ico: 'build/icon.ico', icns: 'build/icon.icns' } } })
  await f.file('icon.png', await sharp({ create: { width: 32, height: 32, channels: 4, background: '#09f' } }).png().toBuffer())
  await electronAssets(f.ctx)
  const ico = await readFile(join(f.root, 'build/icon.ico')), icns = await readFile(join(f.root, 'build/icon.icns'))
  assert.equal(ico.readUInt16LE(2), 1); assert.equal(ico.readUInt16LE(4), 7); assert.equal((await sharp(ico.subarray(ico.readUInt32LE(18), ico.readUInt32LE(18) + ico.readUInt32LE(14))).metadata()).width, 16)
  assert.equal(icns.subarray(0, 4).toString(), 'icns'); assert.equal(icns.readUInt32BE(4), icns.length)
  f.ctx.flags.check = true; await electronAssets(f.ctx)
})
test('Swift bundles use explicit entitlements and launch a bundled app', async () => {
  const f = await fixture({ version: 1, swift: { executable: 'Fixture', plist: 'Info.plist', entitlements: 'app.entitlements' } }, { 'dry-run': true, open: true }); await swift(f.ctx, 'bundle')
  const sign = f.ctx.plan.find(x => x.command === 'codesign' && x.args.includes('--sign')); assert.ok(sign.args.includes('--entitlements'))
  assert.equal(f.ctx.plan.at(-1).command, 'open'); assert.match(f.ctx.plan.at(-1).args[0], /Fixture\.app$/); assert.equal(existsSync(join(f.root, 'build')), false)
})
test('store locale schema is app-owned and defaults must exist', async () => {
  const f = await fixture({ version: 1, store: { root: 'store', locales: [{ app: 'pt', android: 'pt-BR', ios: 'pt-BR' }], defaultLocale: 'en-US' } })
  assert.throws(() => storeSettings(f.ctx), /defaults/)
  f.ctx.config.store.defaultLocale = 'pt-BR'; assert.equal(storeSettings(f.ctx).locales[0].app, 'pt')
  f.ctx.config.store.locales = ['../../escape']; assert.throws(() => storeSettings(f.ctx), /locale/)
})
test('store scaffold creates both stores without overwriting existing text', async () => {
  const f = await fixture({ version: 1, store: { root: 'store', locales: ['en-US'] } }); await f.file('store/fastlane/metadata/android/en-US/title.txt', 'Keep me')
  await store(f.ctx, 'scaffold', []); assert.equal(await readFile(join(f.root, 'store/fastlane/metadata/android/en-US/title.txt'), 'utf8'), 'Keep me')
  assert.ok(existsSync(join(f.root, 'store/fastlane/metadata/android/en-US/full_description.txt'))); assert.ok(existsSync(join(f.root, 'store/fastlane/metadata/ios/en-US/name.txt')))
  f.ctx.flags.strict = true; f.ctx.flags.scope = 'text'; await assert.rejects(store(f.ctx, 'check', []), /checks failed/)
})
test('store CSV preserves commas, quotes, Unicode and newlines', async () => {
  const f = await fixture({ version: 1, store: { root: 'store', locales: ['en-US'] } }, { platform: 'android' })
  for (const field of ['title', 'short_description', 'full_description']) await f.file(`store/fastlane/metadata/android/en-US/${field}.txt`, 'Olá, "world"\nsecond line\n')
  await f.file('store/fastlane/metadata/android/en-US/video.txt', 'https://example.test/video')
  await store(f.ctx, 'export', []); const csv = await readFile(join(f.root, 'store/exports/android.csv'), 'utf8'); assert.ok(csv.startsWith('\uFEFF')); assert.match(csv, /Olá, ""world""\nsecond line/); assert.match(csv, /"video"/); assert.match(csv, /example.test\/video/)
})
test('Fastlane dry-run uses shared lanes and project-local cache, with no writes', async () => {
  const f = await fixture({ version: 1, store: { root: 'store', locales: ['en-US'], androidId: 'app.fixture', playKey: 'private/play.json' } }, { 'dry-run': true, platform: 'android' })
  await store(f.ctx, 'doctor', []); assert.equal(f.calls.length, 0); assert.equal(existsSync(join(f.root, '.rds')), false)
  const lane = f.ctx.plan.at(-1); assert.deepEqual(lane.args.slice(-2), ['android', 'doctor']); assert.equal(lane.env.RDS_STORE_ROOT, join(f.root, 'store')); assert.equal(lane.env.FASTLANE_OPT_OUT_USAGE, '1')
})
test('store verify defaults to every configured store, takes platform and scope, and never uploads', async () => {
  const both = { root: 'store', locales: ['en-US'], androidId: 'app.fixture', playKey: 'private/play.json', iosId: 'app.fixture', appleKey: 'private/apple.json' }
  const verifyLanes = f => f.ctx.plan.filter(x => x.args.at(-2) === 'verify').map(x => x.args.slice(-3))
  let f = await fixture({ version: 1, store: both }, { 'dry-run': true })
  await store(f.ctx, 'verify', []); assert.deepEqual(verifyLanes(f), [['android', 'verify', 'scope:all'], ['ios', 'verify', 'scope:all']])
  assert.equal(f.calls.length, 0); assert.equal(existsSync(join(f.root, '.rds')), false)
  f = await fixture({ version: 1, store: both }, { 'dry-run': true, platform: 'ios', scope: 'text' })
  await store(f.ctx, 'verify', []); assert.deepEqual(verifyLanes(f), [['ios', 'verify', 'scope:text']])
  f = await fixture({ version: 1, store: { root: 'store', locales: ['en-US'], androidId: 'app.fixture', playKey: 'private/play.json' } }, { 'dry-run': true })
  await store(f.ctx, 'verify', []); assert.deepEqual(verifyLanes(f), [['android', 'verify', 'scope:all']])
  f.ctx.flags.platform = 'ios'; await assert.rejects(store(f.ctx, 'verify', []), /Configure store.iosId/)
  f.ctx.flags.platform = 'all'; f.ctx.flags.scope = 'bogus'; await assert.rejects(store(f.ctx, 'verify', []), /scope/)
  f = await fixture({ version: 1, store: both }, { 'dry-run': true })
  await store(f.ctx, 'run', ['ios', 'verify', 'scope:media']); assert.deepEqual(verifyLanes(f), [['ios', 'verify', 'scope:media']])
  await assert.rejects(store(f.ctx, 'run', ['ios', 'listing', 'scope:media']), /only the verify lane/i)
  const ruby = await readFile(new URL('../support/store/verify.rb', import.meta.url), 'utf8')
  assert.ok(ruby.includes('abort_current_edit')); assert.ok(!/upload_to_play_store|deliver\(|\.update!|\.delete!|commit_edit|\.save\b/u.test(ruby))
})
test('only the internal lanes reach testers; every listing lane stays a draft', async () => {
  const f = await fixture({ version: 1, store: { root: 'store', locales: ['en-US'], androidId: 'app.fixture', playKey: 'private/play.json', iosId: 'app.fixture', appleKey: 'private/apple.json' } }, { 'dry-run': true, platform: 'android' })
  const lane = () => f.ctx.plan.at(-1).args.slice(-3)
  await store(f.ctx, 'upload-build', []); assert.deepEqual(lane(), ['android', 'internal', 'status:completed'])
  f.ctx.flags.status = 'draft'; await store(f.ctx, 'upload-build', []); assert.deepEqual(lane(), ['android', 'internal', 'status:draft'])
  f.ctx.flags.status = 'inProgress'; await assert.rejects(store(f.ctx, 'upload-build', []), /status/)
  f.ctx.flags.status = undefined
  await assert.rejects(store(f.ctx, 'run', ['android', 'internal', 'status:halted']), /draft or completed/)
  await assert.rejects(store(f.ctx, 'run', ['android', 'listing', 'track:production', 'rollout:1.0']), /Unsupported/)
  for (const option of ['submit_for_review:true', 'automatic_release:true', 'release_status:completed']) await assert.rejects(store(f.ctx, 'run', ['ios', 'listing', option]), /Unsupported/)
  const content = await readFile(new URL('../support/store/Fastfile', import.meta.url), 'utf8')
  assert.ok(!/submit_for_review: (?!false)/u.test(content)); assert.ok(!content.includes('automatic_release')); assert.ok(!content.includes('rollout'))
  assert.equal(content.match(/release_status:/gu).length, 1); assert.match(content, /track: "internal"/); assert.match(content, /distribute_external: false/)
  assert.match(content, /%w\[draft completed\]\.include\?\(status\)/)
})
test('raw Fastlane cannot bypass checks or run review-submission actions', async () => {
  const f = await fixture({ version: 1, store: { locales: ['en-US'] } }, { 'dry-run': true })
  await assert.rejects(store(f.ctx, 'run', ['ios', 'deliver']), /Unsupported/)
  await assert.rejects(store(f.ctx, 'run', ['ios', 'listing', 'skip_check:true']), /cannot be bypassed/)
  await assert.rejects(store(f.ctx, 'run', ['android', 'previews']), /Unsupported/)
  f.ctx.flags.track = 'production'; await assert.rejects(store(f.ctx, 'upload-build', []), /internal/)
})
test('Ruby support receives application identities and never mutates Git implicitly', async () => {
  const content = await readFile(new URL('../support/store/Fastfile', import.meta.url), 'utf8')
  assert.ok(!content.includes('commit_publish.call')); assert.match(content, /ENV.fetch\("RDS_IOS_ID"\)/); assert.ok(!content.includes('skip_check]'))
  assert.match(content, /RDS_IOS_PROJECT/); assert.match(content, /RDS_DEFAULT_IOS_LOCALE/); assert.match(content, /submit_for_review: false/); assert.match(content, /app_identifier: bundle_id.call/); assert.ok(content.includes('ENV.fetch(\'RDS_STORE_ROOT\').tr("\\\\", "/")'))
})
