import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { versions, nativeVersion, syncIos, syncAndroid } from '../dist/versions.js'
import { capacitorSync, capacitorPrepare, capacitorLive } from '../dist/capacitor.js'
import { androidBuild, androidInstall, selectDevice } from '../dist/android.js'
import { localeFiles, images, capacitorAssets } from '../dist/images.js'
import { screenshots } from '../dist/screenshots.js'
import { runProcess } from '../dist/runtime.js'
import sharp from 'sharp'
import { fixture } from './helpers.mjs'

test('semver and monotonic native build handling', () => {
  assert.deepEqual(nativeVersion('1.2.3-beta.1'), { version: '1.2.3', build: 1002003 })
  for (const value of ['bad', '1.1000.0', '1.0.1000', '99999999.0.0', '01.2.3']) assert.throws(() => nativeVersion(value))
  const ios = 'MARKETING_VERSION = 1.0.0; CURRENT_PROJECT_VERSION = 9000000; CURRENT_PROJECT_VERSION = 2;'
  assert.match(syncIos(ios, '1.2.3', 1002003), /CURRENT_PROJECT_VERSION = 9000000;/)
  assert.match(syncIos(ios, '1.2.3', 1002003, true), /CURRENT_PROJECT_VERSION = 9000001;/)
  assert.throws(() => syncIos('CURRENT_PROJECT_VERSION = "$(BUILD_NUMBER)";', '1.0.0', 1))
  assert.match(syncAndroid('versionCode androidVersionCode\nversionName androidVersionName', '1.2.3', 1002003), /androidVersionCode/)
})
test('versions check is read-only and fails on stale settings', async () => {
  const f = await fixture({ version: 1, capacitor: {} }, { platform: 'android', check: true }); await f.file('package.json', '{"version":"1.2.3"}'); const path = await f.file('android/app/build.gradle', 'versionCode 1\nversionName "0.0.1"')
  await assert.rejects(versions(f.ctx), /stale/); assert.match(await readFile(path, 'utf8'), /versionCode 1\n/)
})
test('preflight all native files before bumping package version', async () => {
  const f = await fixture({ version: 1, capacitor: {} }, { bump: 'patch' }); await f.file('package.json', '{"version":"1.2.3"}'); await f.file('ios/App/App.xcodeproj/project.pbxproj', 'CURRENT_PROJECT_VERSION = invalid;')
  await assert.rejects(versions(f.ctx), /integer/); assert.equal(f.calls.length, 0)
})
test('bumping the configured workspace updates its entry in the shared npm lock, not the root or siblings', async () => {
  const f = await fixture({ version: 1, capacitor: { root: 'frontend', packageJson: 'apps/mobile/package.json' } }, { platform: 'android', bump: 'patch' })
  const rootManifest = '{"name":"parent","version":"9.0.0","workspaces":["apps/*"]}'
  const siblingManifest = '{"name":"sibling","version":"2.0.0"}'
  const lock = { name: 'parent', version: '9.0.0', lockfileVersion: 3, packages: {
    '': { name: 'parent', version: '9.0.0', workspaces: ['apps/*'] },
    'apps/mobile': { name: 'child', version: '1.0.0', dependencies: { fixture: '3.0.0' } },
    'apps/sibling': { version: '2.0.0' },
    'node_modules/child': { resolved: 'apps/mobile', link: true },
    'node_modules/sibling': { resolved: 'apps/sibling', link: true },
    'node_modules/fixture': { version: '3.0.0' }
  } }
  const format = value => JSON.stringify(value, null, '\t').replaceAll('\n', '\r\n') + '\r\n'
  const rootPath = await f.file('package.json', rootManifest)
  const siblingPath = await f.file('apps/sibling/package.json', siblingManifest)
  const manifest = await f.file('apps/mobile/package.json', '{"name":"child","version":"1.0.0","scripts":{"version":"node -e \\"process.exit(19)\\""}}')
  const native = await f.file('frontend/android/app/build.gradle', 'versionCode 1000000\nversionName "1.0.0"')
  const lockPath = await f.file('package-lock.json', format(lock))
  f.ctx.runner = runProcess
  await versions(f.ctx)
  assert.equal(await readFile(rootPath, 'utf8'), rootManifest)
  assert.equal(await readFile(siblingPath, 'utf8'), siblingManifest)
  assert.equal(JSON.parse(await readFile(manifest, 'utf8')).version, '1.0.1')
  assert.match(await readFile(native, 'utf8'), /1000001/)
  lock.packages['apps/mobile'].version = '1.0.1'
  assert.equal(await readFile(lockPath, 'utf8'), format(lock))
  assert.equal(existsSync(join(f.root, 'apps/mobile/package-lock.json')), false)
  assert.equal(existsSync(join(f.root, 'node_modules')), false)
  assert.deepEqual(f.ctx.plan.map(step => step.command), ['npm'])
})
test('standalone bumps keep updating the colocated npm lock without touching a non-member ancestor lock', async () => {
  const f = await fixture({ version: 1, capacitor: { root: 'mobile' } }, { platform: 'android', bump: 'patch' })
  const shared = '{"version":"9.0.0","lockfileVersion":3,"packages":{"":{"version":"9.0.0"},"apps/other":{"version":"1.0.0"}}}'
  await f.file('package.json', '{"name":"parent","version":"9.0.0","workspaces":["apps/*"]}')
  const sharedPath = await f.file('package-lock.json', shared)
  await f.file('mobile/package.json', '{"name":"mobile","version":"1.0.0"}')
  const local = await f.file('mobile/package-lock.json', '{"name":"mobile","version":"1.0.0","lockfileVersion":3,"packages":{"":{"name":"mobile","version":"1.0.0"}}}')
  await f.file('mobile/android/app/build.gradle', 'versionCode 1000000\nversionName "1.0.0"')
  f.ctx.runner = runProcess
  await versions(f.ctx)
  assert.equal(await readFile(sharedPath, 'utf8'), shared)
  const lock = JSON.parse(await readFile(local, 'utf8'))
  assert.equal(lock.version, '1.0.1')
  assert.equal(lock.packages[''].version, '1.0.1')
})
test('a workspace bump dry-run reports the lockfile step without mutating anything', async () => {
  const f = await fixture({ version: 1, capacitor: { root: 'mobile' } }, { platform: 'android', bump: 'patch', 'dry-run': true })
  await f.file('package.json', '{"workspaces":["mobile"]}')
  const manifest = await f.file('mobile/package.json', '{"version":"1.0.0"}')
  const native = await f.file('mobile/android/app/build.gradle', 'versionCode 1000000\nversionName "1.0.0"')
  const lock = await f.file('npm-shrinkwrap.json', '{"lockfileVersion":2,"packages":{"mobile":{"version":"1.0.0"}}}')
  const before = await Promise.all([manifest, native, lock].map(path => readFile(path, 'utf8')))
  await versions(f.ctx)
  assert.equal(f.calls.length, 0)
  assert.ok(f.messages.includes('[plan] Sync npm workspace lockfile version'))
  assert.deepEqual(await Promise.all([manifest, native, lock].map(path => readFile(path, 'utf8'))), before)
})
test('a bump never searches for shared workspace locks above the config root', async () => {
  const f = await fixture({ version: 1, capacitor: { root: 'mobile' } }, { platform: 'android', bump: 'patch' })
  const shared = '{"lockfileVersion":3,"packages":{"apps/mobile":{"version":"1.0.0"}}}'
  await f.file('package.json', '{"workspaces":["apps/*"]}')
  const lock = await f.file('package-lock.json', shared)
  const manifest = await f.file('apps/mobile/package.json', '{"name":"mobile","version":"1.0.0"}')
  await f.file('apps/mobile/android/app/build.gradle', 'versionCode 1000000\nversionName "1.0.0"')
  f.ctx.root = join(f.root, 'apps')
  f.ctx.config.capacitor.packageJson = process.platform === 'win32' ? join(f.root.toUpperCase(), 'apps/mobile/package.json') : manifest
  f.ctx.runner = runProcess
  await versions(f.ctx)
  assert.equal(JSON.parse(await readFile(manifest, 'utf8')).version, '1.0.1')
  assert.equal(await readFile(lock, 'utf8'), shared)
})
test('a malformed shared npm lock fails preflight before a workspace bump', async () => {
  const f = await fixture({ version: 1, capacitor: { root: 'mobile' } }, { platform: 'android', bump: 'patch' })
  await f.file('package.json', '{"workspaces":["mobile"]}')
  await f.file('package-lock.json', '{invalid')
  await f.file('mobile/package.json', '{"name":"mobile","version":"1.0.0"}')
  await f.file('mobile/android/app/build.gradle', 'versionCode 1000000\nversionName "1.0.0"')
  await assert.rejects(versions(f.ctx), /Invalid JSON in workspace package-lock\.json/)
  assert.equal(f.calls.length, 0)
})
test('bumping with a custom version source cannot modify a different package.json', async () => {
  const f = await fixture({ version: 1, capacitor: { packageJson: 'version.json' } }, { platform: 'android', bump: 'patch' })
  await f.file('package.json', '{"name":"other","version":"8.0.0"}')
  await f.file('version.json', '{"version":"1.0.0"}')
  await f.file('android/app/build.gradle', 'versionCode 1000000\nversionName "1.0.0"')
  await assert.rejects(versions(f.ctx), /owning package\.json/)
  assert.equal(f.calls.length, 0)
})
test('Capacitor builds separately for each platform and preserves hooks', async () => {
  const f = await fixture({ version: 1, capacitor: { platforms: ['android', 'ios'], prepare: [['node', 'prepare.mjs']], buildByPlatform: { ios: ['node', 'ios-build.mjs'], android: ['node', 'android-build.mjs'] }, afterSync: [['node', 'post.mjs', '{platform}']], verify: [['node', 'verify.mjs', '{platform}']] } }, { 'dry-run': true })
  await capacitorSync(f.ctx)
  assert.deepEqual(f.ctx.plan.map(x => x.args), [['prepare.mjs'], ['android-build.mjs'], ['sync', 'android'], ['post.mjs', 'android'], ['verify.mjs', 'android'], ['ios-build.mjs'], ['sync', 'ios'], ['post.mjs', 'ios'], ['verify.mjs', 'ios']])
})
test('skip-build does not run generator/build but does keep native verification', async () => {
  const f = await fixture({ version: 1, capacitor: { platforms: ['android'], build: ['node', 'build.mjs'], verify: [['node', 'verify.mjs']] } }, { 'dry-run': true, 'skip-build': true })
  await capacitorSync(f.ctx); assert.deepEqual(f.ctx.plan.map(x => x.args), [['sync', 'android'], ['verify.mjs']])
})
test('Capacitor profile environment and platform targets reach both build and sync', async () => {
  const f = await fixture({ version: 1, capacitor: { platforms: ['ios'], environment: { VITE_DEPLOY_ENV: '{env}' }, environmentByPlatform: { ios: { VITE_APP_TARGET: 'ios' } } } }, { 'dry-run': true, env: 'staging' })
  await capacitorSync(f.ctx)
  for (const step of f.ctx.plan.filter(x => ['vite', 'cap'].includes(x.command))) { assert.equal(step.env.VITE_DEPLOY_ENV, 'staging'); assert.equal(step.env.VITE_APP_TARGET, 'ios') }
})
test('production cannot bypass authorization; verification occurs before mutations', async () => {
  const config = { version: 1, production: { verify: [['node', 'approve.mjs', '{platform}']] }, capacitor: { platforms: ['android'] } }
  const f = await fixture(config, { env: 'production' }); await assert.rejects(capacitorSync(f.ctx), /allow-production/); assert.equal(f.calls.length, 0)
  f.ctx.flags['allow-production'] = true; await capacitorSync(f.ctx); assert.deepEqual(f.calls[0].args, ['approve.mjs', 'android']); assert.equal(f.calls[0].cwd, f.root)
})
test('live reload is never enabled in production', async () => {
  const f = await fixture({ version: 1, capacitor: { platforms: ['android'] } }, { env: 'production', 'dry-run': true, 'allow-production': true }); await assert.rejects(capacitorLive(f.ctx), /not permitted/)
})
test('private-looking public DNS names cannot enable HTTP live reload', async () => {
  const f = await fixture({ version: 1, capacitor: { platforms: ['android'] } }, { 'dry-run': true, host: '127.evil.example', 'skip-sync': true })
  await assert.rejects(capacitorLive(f.ctx), /require HTTPS/)
})
test('prerelease patch preparation uses the same native and package version', async () => {
  const f = await fixture({ version: 1, capacitor: {} }, { platform: 'android', bump: 'patch', 'dry-run': true }); await f.file('package.json', '{"version":"1.2.3-beta.1"}'); await f.file('android/app/build.gradle', 'versionCode 1002002\nversionName "1.2.2"')
  await versions(f.ctx); const args = f.ctx.plan[0].args; assert.equal(args[args.indexOf('version') + 1], '1.2.3')
})
test('device selection rejects ambiguity, offline and unauthorized devices', () => {
  assert.equal(selectDevice('List of devices attached\na\tdevice\nb\tunauthorized\n', ''), 'a')
  assert.throws(() => selectDevice('a device\nb device', ''), /Multiple/)
  assert.throws(() => selectDevice('a unauthorized', 'a'), /unavailable/)
  assert.throws(() => selectDevice('emulator-5554 device', '', true), /No authorized/)
})
test('Android build plan selects module, artifact type and clean tasks', async () => {
  const f = await fixture({ version: 1, android: { root: 'android', module: 'app' } }, { 'dry-run': true, configuration: 'release', format: 'aab', clean: true })
  await androidBuild(f.ctx); assert.deepEqual(f.ctx.plan[0].args, ['clean', ':app:bundleRelease'])
})
test('install never uninstalls unless replacement was explicitly requested', async () => {
  const f = await fixture({ version: 1, android: { appId: 'app.test' } }, { 'dry-run': true }); await androidInstall(f.ctx)
  assert.ok(!f.ctx.plan.some(x => x.args.includes('uninstall')))
  f.ctx.flags.replace = true; await androidInstall(f.ctx); assert.ok(f.ctx.plan.some(x => x.args.includes('uninstall')))
})
test('native locale escaping, BCP47 directories, and placeholder validation', async () => {
  const f = await fixture()
  const config = { defaultLocale: 'en', locales: { en: { title: 'Tom & "Jerry" %1$s' }, 'pt-BR': { title: 'Tom & Jerry %1$s' } }, targets: [{ format: 'android', directory: 'res' }, { format: 'apple', directory: 'ios' }] }
  const files = localeFiles(f.root, config)
  assert.match(files.get(join(f.root, 'res/values/strings.xml')), /Tom &amp;/)
  assert.ok(files.has(join(f.root, 'res/values-b+pt+BR/strings.xml')))
  config.locales['pt-BR'].title = 'missing'; assert.throws(() => localeFiles(f.root, config), /placeholder/)
})
test('image generation is deterministic and --check rejects modified output', async () => {
  const f = await fixture(); await f.file('icon.png', await sharp({ create: { width: 10, height: 10, channels: 4, background: '#f00' } }).png().toBuffer())
  const config = { source: 'icon.png', outputs: [{ path: 'out/icon.png', width: 32 }] }
  await images(f.ctx, f.root, config); f.ctx.flags.check = true; await images(f.ctx, f.root, config)
  await f.file('out/icon.png', 'bad'); await assert.rejects(images(f.ctx, f.root, config), /stale/)
})
test('native asset generator uses documented assetPath and detects tampering', async () => {
  const config = { version: 1, capacitor: { platforms: ['android'], assets: { source: 'icon.png' } } }
  const f = await fixture(config); await f.file('icon.png', await sharp({ create: { width: 10, height: 10, channels: 4, background: '#f00' } }).png().toBuffer())
  f.ctx.runner = async step => { f.calls.push(step); await f.file('android/app/src/main/res/mipmap-hdpi/ic_launcher.png', 'generated'); return { stdout: '', stderr: '' } }
  await capacitorAssets(f.ctx); assert.ok(f.calls[0].args.includes('--assetPath')); assert.ok(!f.calls[0].args.includes('--iconPath'))
  f.ctx.flags.check = true; await capacitorAssets(f.ctx); await f.file('android/app/src/main/res/mipmap-hdpi/ic_launcher.png', 'tampered'); await assert.rejects(capacitorAssets(f.ctx), /modified/)
})
test('Android screenshot capture labels each ADB step distinctly', async () => {
  const f = await fixture({ version: 1, capacitor: {} }, { 'dry-run': true, action: 'capture', platform: 'android', name: 'one' })
  await screenshots(f.ctx)
  assert.deepEqual(f.ctx.plan.map(step => step.label), ['Capture Android screenshot', 'Pull Android screenshot', 'Remove remote Android screenshot'])
})
test('screenshot resizing creates size-specific outputs without overwriting originals', async () => {
  const f = await fixture({ version: 1, capacitor: { screenshots: { sizes: [{ width: 20, height: 30 }] } } }, { action: 'resize', input: 'captures', output: 'resized' })
  await f.file('captures/one.png', await sharp({ create: { width: 10, height: 10, channels: 4, background: '#f00' } }).png().toBuffer())
  await screenshots(f.ctx); assert.equal((await sharp(join(f.root, 'resized/20x30/one.png')).metadata()).height, 30)
  assert.equal((await sharp(join(f.root, 'captures/one.png')).metadata()).height, 10)
})
