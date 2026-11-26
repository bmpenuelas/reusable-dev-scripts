import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { main } from '../dist/cli.js'
import { runCli } from '../dist/result.js'
import { validateConfig } from '../dist/config.js'
import { Context } from '../dist/context.js'
import { capacitorAssets } from '../dist/images.js'
import { electron } from '../dist/desktop.js'
import { parseApkBadging, findAapt2 } from '../dist/apk.js'
import { checkSigningIdentity, hasSigningIdentity } from '../dist/signing.js'
import { esp32AppSlots } from '../dist/firmware-size.js'
import { fixture } from './helpers.mjs'

const fingerprint = Array.from({ length: 32 }, (_, index) => index.toString(16).padStart(2, '0')).join(':')
const links = {
  directory: 'web/public',
  android: [{ packageName: 'com.example.app', fingerprints: [fingerprint, fingerprint.toUpperCase()] }],
  apple: [{ teamId: 'TEAMID1234', bundleId: 'com.example.app', paths: ['/open/*', '*'] }],
}
const assetlinks = 'web/public/.well-known/assetlinks.json'
const association = 'web/public/.well-known/apple-app-site-association'

async function project(config) {
  const f = await fixture(config)
  await f.file('reusable-dev-scripts.config.json', JSON.stringify(config))
  const logs = [], calls = []
  const run = (...args) => main([...args, '--cwd', f.root], async step => { calls.push(step); return { stdout: f.stdout ?? '', stderr: '' } }, line => logs.push(line))
  const read = path => readFile(join(f.root, path), 'utf8')
  return Object.assign(f, { logs, calls, run, read })
}

test('app-links generate writes both association files and check compares what they declare', async () => {
  const f = await project({ version: 1, appLinks: links })
  await assert.rejects(f.run('app-links', 'check'), /missing: web\/public\/\.well-known\/assetlinks\.json/u)
  await f.run('app-links', 'generate')
  assert.deepEqual(JSON.parse(await f.read(assetlinks)), [{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: 'com.example.app', sha256_cert_fingerprints: [fingerprint.toUpperCase()] } }])
  assert.deepEqual(JSON.parse(await f.read(association)), { applinks: { details: [{ appIDs: ['TEAMID1234.com.example.app'], components: [{ '/': '/open/*' }, { '/': '*' }] }] } })
  await f.run('app-links', 'check')

  // A hand-written file with the same meaning (formatting, comments, empty legacy list, CRLF) passes and is left alone.
  const handWritten = '{\r\n "applinks": { "apps": [], "details": [ { "appIDs": ["TEAMID1234.com.example.app"], "components": [ { "/": "/open/*", "comment": "Shared links." }, { "/": "*" } ] } ] }\r\n}\r\n'
  await f.file(association, handWritten)
  await f.run('app-links', 'check')
  await f.run('app-links', 'generate')
  assert.equal(await f.read(association), handWritten)

  await f.file(association, handWritten.replace('TEAMID1234', 'OTHERTEAM1'))
  await assert.rejects(f.run('app-links', 'check'), /does not match the configuration: web\/public\/\.well-known\/apple-app-site-association/u)
  await f.run('app-links', 'generate')
  await f.run('app-links', 'check')
})

test('app-links refuses to overwrite declarations it does not manage, and then writes nothing', async () => {
  const unmanaged = [
    [association, '{"applinks":{"details":[]},"webcredentials":{"apps":["TEAMID1234.com.example.app"]}}'],
    [association, '{"applinks":{"details":[{"appIDs":["TEAMID1234.com.example.app"],"components":[{"/":"/open/*","exclude":true}]}]}}'],
    [assetlinks, '[{"relation":["delegate_permission/common.handle_all_urls","delegate_permission/common.get_login_creds"],"target":{"namespace":"android_app","package_name":"com.example.app","sha256_cert_fingerprints":[]}}]'],
    [assetlinks, 'not json'],
  ]
  for (const [path, content] of unmanaged) {
    const f = await project({ version: 1, appLinks: links })
    await f.file(path, content)
    await assert.rejects(f.run('app-links', 'generate'), /Refusing to overwrite/u)
    assert.equal(await f.read(path), content)
    await assert.rejects(f.read(path === association ? assetlinks : association), /ENOENT/u)
    await assert.rejects(f.run('app-links', 'check'), /does not match|missing/u)
  }
})

test('app-links needs explicit, well-formed identities inside the project', async () => {
  const invalid = value => () => validateConfig({ version: 1, appLinks: { directory: 'web', ...value } })
  assert.throws(invalid({}), /at least one/u)
  assert.throws(invalid({ android: [{ packageName: 'com.example.app', fingerprints: ['AB:CD'] }] }), /SHA-256/u)
  assert.throws(invalid({ android: [{ packageName: 'app', fingerprints: [fingerprint] }] }), /package name/u)
  assert.throws(invalid({ apple: [{ teamId: 'short', bundleId: 'com.example.app', paths: ['/'] }] }), /team ID/u)
  assert.throws(invalid({ apple: [{ teamId: 'TEAMID1234', bundleId: 'com.example.app', paths: ['open'] }] }), /path patterns/u)
  assert.throws(invalid({ apple: [], deploy: true }), /Invalid appLinks fields/u)
  const f = await project({ version: 1, appLinks: { ...links, directory: '../outside' } })
  await assert.rejects(f.run('app-links', 'generate'), /inside its project/u)
})

const partitions = [
  '# Name, Type, SubType, Offset, Size, Flags',
  'nvs, data, nvs, 0x9000, 0x5000,',
  'factory, app, factory, , 64K,',
  'ota_0, app, ota_0, , 0x2000, # first slot',
  'ota_1, 0, 0x11, , 12K,',
  'spiffs, data, spiffs, , 1M,',
].join('\r\n')

test('ESP32 partition slots accept the CSV forms ESP-IDF accepts', () => {
  assert.deepEqual(esp32AppSlots(`﻿${partitions}`).map(({ name, bytes, ota }) => [name, bytes, ota]), [['factory', 65536, false], ['ota_0', 8192, true], ['ota_1', 12288, true]])
  assert.throws(() => esp32AppSlots('a, app, ota_0, , 12X'), /Invalid ESP32 app partition size/u)
  assert.throws(() => esp32AppSlots('a, app, ota_0, , 4K\na, app, ota_1, , 4K'), /duplicate/u)
})

test('esp32 check-size enforces the smallest OTA slot, a named slot and the free-space budget', async () => {
  const f = await project({ version: 1 })
  await f.file('partitions.csv', partitions)
  await f.file('build/firmware.bin', Buffer.alloc(8000))
  const check = (...extra) => f.run('esp32', 'check-size', '--artifact', 'build/firmware.bin', '--partitions', 'partitions.csv', ...extra)
  await check()
  assert.match(f.logs.at(-1), /8000\/8192 bytes, 192 bytes free/u)
  await check('--min-free-bytes', '192')
  await assert.rejects(check('--min-free-bytes', '193'), /requires 193 bytes free \(available: 192\)/u)
  await check('--slot', 'factory', '--min-free-bytes', '50000')
  await assert.rejects(check('--slot', 'missing'), /not found/u)
  await assert.rejects(check('--min-free-bytes', '4K'), /non-negative integer/u)
  await f.file('build/firmware.bin', Buffer.alloc(9000))
  await assert.rejects(check(), /available: -808/u)
  await f.file('factory-only.csv', 'factory, app, factory, , 1M')
  await assert.rejects(f.run('esp32', 'check-size', '--artifact', 'build/firmware.bin', '--partitions', 'factory-only.csv'), /No ESP32 OTA app partitions/u)
  await assert.rejects(f.run('esp32', 'check-size', '--artifact', 'build/none.bin', '--partitions', 'partitions.csv'), /artifact not found/u)
  await assert.rejects(f.run('esp32', 'check-size', '--artifact', '../firmware.bin', '--partitions', 'partitions.csv'), /inside its project/u)
  assert.equal(f.calls.length, 0)
})

test('esp32 check-size --format json reports the numbers alone on stdout, also when the binary does not fit', async () => {
  const f = await project({ version: 1 })
  await f.file('partitions.csv', partitions)
  await f.file('build/firmware.bin', Buffer.alloc(8000))
  const args = ['esp32', 'check-size', '--artifact', 'build/firmware.bin', '--partitions', 'partitions.csv']
  const slots = [{ name: 'ota_0', bytes: 8192 }, { name: 'ota_1', bytes: 12288 }]
  const capture = async (...extra) => {
    const original = [console.log, console.error], stdout = [], stderr = []
    console.log = line => stdout.push(line)
    console.error = line => stderr.push(line)
    // The executable boundary with its default logger, banners included.
    try { return { code: await runCli([...args, ...extra, '--banner', '--cwd', f.root]), stdout, stderr: stderr.join('\n') } }
    finally { [console.log, console.error] = original }
  }

  const fits = await capture('--format', 'json', '--min-free-bytes', '100')
  assert.equal(fits.code, 0)
  assert.equal(fits.stdout.length, 1)
  assert.deepEqual(JSON.parse(fits.stdout[0]), { artifactBytes: 8000, budgetBytes: 8192, freeBytes: 192, minFreeBytes: 100, fits: true, slots })

  const over = await capture('--format', 'json', '--min-free-bytes', '193')
  assert.equal(over.code, 1)
  assert.equal(over.stdout.length, 1)
  assert.deepEqual(JSON.parse(over.stdout[0]), { artifactBytes: 8000, budgetBytes: 8192, freeBytes: 192, minFreeBytes: 193, fits: false, slots })
  assert.match(over.stderr, /requires 193 bytes free/u)

  const planned = await capture('--format', 'json', '--dry-run')
  assert.deepEqual([planned.code, planned.stdout], [0, []])
  assert.match(planned.stderr, /\[plan\] Check existing ESP32 binary/u)

  await f.run(...args, '--format', 'json', '--slot', 'factory')
  assert.deepEqual(JSON.parse(f.logs.at(-1)).slots, [{ name: 'factory', bytes: 65536 }])
  await f.run(...args, '--format', 'text')
  assert.equal(f.logs.at(-1), '[rds] ESP32 firmware: 8000/8192 bytes, 192 bytes free')
  await assert.rejects(f.run(...args, '--format', 'xml'), /--format must be text, json/u)
})

const badging = [
  "package: name='com.example.app' versionCode='1002003' versionName='1.2.3' platformBuildVersionName='15' compileSdkVersion='35'",
  "minSdkVersion:'24'",
  "targetSdkVersion:'35'",
  "uses-permission: name='android.permission.POST_NOTIFICATIONS'",
  "uses-permission: name='android.permission.INTERNET'",
  "uses-permission-sdk-23: name='android.permission.CAMERA' maxSdkVersion='32'",
  "uses-permission: name='android.permission.INTERNET'",
  "uses-implied-permission: name='android.permission.READ_EXTERNAL_STORAGE' reason='requested WRITE_EXTERNAL_STORAGE'",
  "application-label:'Example'",
  "application: label='Example' icon='res/icon.png'",
  'application-debuggable',
].join('\r\n')

test('APK badging yields identity, version, SDK levels and permissions', () => {
  assert.deepEqual(parseApkBadging(badging), {
    packageName: 'com.example.app', versionName: '1.2.3', versionCode: 1002003, minSdk: '24', targetSdk: '35', debuggable: true,
    permissions: ['android.permission.CAMERA', 'android.permission.INTERNET', 'android.permission.POST_NOTIFICATIONS'],
    impliedPermissions: ['android.permission.READ_EXTERNAL_STORAGE'],
  })
  assert.equal(parseApkBadging("package: name='com.example.app' versionCode='' versionName=''\nsdkVersion:'21'").versionCode, null)
  assert.equal(parseApkBadging("package: name='com.example.app'\nsdkVersion:'21'").minSdk, '21')
  assert.throws(() => parseApkBadging('ERROR: dump failed'), /did not report an application package/u)
})

test('android inspect runs aapt2 from the newest build tools and prints text or JSON', async () => {
  const f = await project({ version: 1 })
  await f.file('out/app.apk', 'apk')
  f.stdout = badging
  await f.run('android', 'inspect', '--artifact', 'out/app.apk', '--format', 'json')
  assert.deepEqual(JSON.parse(f.logs.at(-1)), parseApkBadging(badging))
  assert.deepEqual(f.calls[0].args, ['dump', 'badging', join(f.root, 'out/app.apk')])
  assert.equal(f.calls[0].capture, true)
  await f.run('android', 'inspect', '--artifact', 'out/app.apk')
  assert.match(f.logs.at(-1), /Package: com\.example\.app\nVersion: 1\.2\.3 \(code 1002003\)\nSDK: min 24, target 35\nDebuggable: yes\nPermissions:\n  android\.permission\.CAMERA/u)
  // With the default logger, step lines go to stderr so JSON stdout can be piped.
  const original = [console.log, console.error], stdout = [], stderr = []
  console.log = line => stdout.push(line)
  console.error = line => stderr.push(line)
  try { await main(['android', 'inspect', '--artifact', 'out/app.apk', '--format', 'json', '--cwd', f.root], async () => ({ stdout: badging, stderr: '' })) }
  finally { [console.log, console.error] = original }
  assert.equal(stdout.length, 1)
  assert.equal(JSON.parse(stdout[0]).packageName, 'com.example.app')
  assert.match(stderr.join(' '), /Inspect APK/u)
  await assert.rejects(f.run('android', 'inspect', '--artifact', 'out/app.aab'), /app bundles are not supported/u)
  await assert.rejects(f.run('android', 'inspect', '--artifact', 'out/other.apk'), /APK not found/u)
  await assert.rejects(f.run('android', 'inspect', '--artifact', 'out/app.apk', '--format', 'xml'), /--format/u)

  await f.file('sdk/build-tools/9.0.0/aapt2', '')
  await f.file('sdk/build-tools/35.0.0/aapt2', '')
  await f.file('sdk/build-tools/36.0.0/readme', '')
  assert.equal(findAapt2(join(f.root, 'sdk'), 'linux'), join(f.root, 'sdk/build-tools/35.0.0/aapt2'))
  assert.equal(findAapt2(join(f.root, 'no-sdk'), 'linux'), 'aapt2')
  assert.equal(findAapt2(undefined, 'win32'), 'aapt2')
})

const identities = [
  '  1) 0123456789ABCDEF0123456789ABCDEF01234567 "Apple Development: Someone (AAAAAAAAAA)"',
  '  2) 89ABCDEF0123456789ABCDEF0123456789ABCDEF "Developer ID Application: Example Company (TEAMID1234)"',
  '  3) FEDCBA9876543210FEDCBA9876543210FEDCBA98 "Developer ID Application: Old Company (TEAMID9999)" (CSSMERR_TP_CERT_REVOKED)',
  '     3 valid identities found',
].join('\n')

test('signing identity preflight matches one exact, valid Developer ID identity without printing the keychain', async () => {
  assert.equal(hasSigningIdentity(identities, 'Example Company (TEAMID1234)'), true)
  assert.equal(hasSigningIdentity(identities, 'Example Company'), false)
  assert.equal(hasSigningIdentity(identities, 'Old Company (TEAMID9999)'), false)
  assert.equal(hasSigningIdentity(identities, 'Someone (AAAAAAAAAA)'), false)

  const logs = [], calls = []
  const context = flags => new Context(process.cwd(), { version: 1, electron: {} }, flags, async step => { calls.push(step); return { stdout: identities, stderr: '' } }, line => logs.push(line))
  await checkSigningIdentity(context({ identity: 'Example Company (TEAMID1234)' }), process.cwd(), 'darwin')
  assert.deepEqual([calls[0].command, calls[0].args, calls[0].capture], ['security', ['find-identity', '-v', '-p', 'codesigning'], true])
  assert.doesNotMatch(logs.join('\n'), /Example Company|Old Company|Someone/u)
  await assert.rejects(checkSigningIdentity(context({ identity: 'Absent (TEAMID0000)' }), process.cwd(), 'darwin'), /No valid Developer ID/u)
  await assert.rejects(checkSigningIdentity(context({ identity: 'Developer ID Application: Example Company (TEAMID1234)' }), process.cwd(), 'darwin'), /without the/u)
  await assert.rejects(checkSigningIdentity(context({ identity: 'Example Company (TEAMID1234)' }), process.cwd(), 'win32'), /requires macOS/u)

  const previous = process.env.CSC_NAME
  try {
    process.env.CSC_NAME = 'Example Company (TEAMID1234)'
    await checkSigningIdentity(context({}), process.cwd(), 'darwin')
    delete process.env.CSC_NAME
    await assert.rejects(checkSigningIdentity(context({}), process.cwd(), 'darwin'), /CSC_NAME/u)
  } finally {
    if (previous === undefined) delete process.env.CSC_NAME
    else process.env.CSC_NAME = previous
  }
})

const png = (color, options = {}) => sharp({ create: { width: 8, height: 8, channels: 4, background: color } }).png(options).toBuffer()

test('asset copies are written byte for byte or normalized, and --check reports stale destinations', async () => {
  const assets = { native: false, copies: [{ source: 'art/mark.svg', path: 'public/mark.svg' }, { source: 'art/icon.png', path: 'public/icon.png', normalize: 'png' }, { source: 'art/photo.jpg', path: 'public/photo.png', normalize: 'png' }] }
  const config = { version: 1, capacitor: { assets } }
  const f = await project(config)
  await f.file('art/mark.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>')
  await f.file('art/icon.png', await png('#f00', { compressionLevel: 0 }))
  await f.file('art/photo.jpg', await sharp(await png('#00f')).jpeg().toBuffer())
  await assert.rejects(f.run('capacitor', 'assets', '--check'), /stale/u)
  await f.run('capacitor', 'assets')
  assert.equal(await f.read('public/mark.svg'), await f.read('art/mark.svg'))
  for (const name of ['public/icon.png', 'public/photo.png']) assert.equal((await sharp(join(f.root, name)).metadata()).format, 'png')
  assert.notDeepEqual(await readFile(join(f.root, 'public/icon.png')), await readFile(join(f.root, 'art/icon.png')))
  await f.run('capacitor', 'assets', '--check')
  await f.file('art/mark.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="1"/>')
  await assert.rejects(f.run('capacitor', 'assets', '--check'), /stale/u)
  assert.doesNotMatch(await f.read('public/mark.svg'), /width/u)
})

test('asset copies run after the native generator, so they can reuse its output', async () => {
  const config = { version: 1, capacitor: { platforms: ['ios'], assets: { source: 'art/icon.png', copies: [{ source: 'ios/App/App/Assets.xcassets/AppIcon.appiconset/icon.png', path: 'public/app-icon.png' }] } } }
  const f = await fixture(config)
  await f.file('art/icon.png', await png('#0f0'))
  const generated = await png('#123')
  f.ctx.runner = async () => { await f.file('ios/App/App/Assets.xcassets/AppIcon.appiconset/icon.png', generated); return { stdout: '', stderr: '' } }
  await capacitorAssets(f.ctx)
  assert.deepEqual(await readFile(join(f.root, 'public/app-icon.png')), generated)
  f.ctx.flags.check = true
  await capacitorAssets(f.ctx)
  await f.file('public/app-icon.png', 'edited')
  await assert.rejects(capacitorAssets(f.ctx), /stale/u)
})

test('desktop assets copy generated icons, and unsafe or colliding copies fail before any write', async () => {
  const f = await fixture({ version: 1, electron: { assets: { source: 'icon.png', ico: 'build/icon.ico', copies: [{ source: 'build/icon.ico', path: 'site/favicon.ico' }] } } })
  await f.file('icon.png', await png('#fff'))
  await electron(f.ctx, 'assets')
  assert.deepEqual(await readFile(join(f.root, 'site/favicon.ico')), await readFile(join(f.root, 'build/icon.ico')))

  const bad = [
    [{ source: 'icon.png', path: 'icon.png' }, /collides/u],
    [{ source: 'icon.png', path: 'out/small.png' }, /collides/u],
    [{ source: 'icon.png', path: '../escape.png' }, /inside its project/u],
    [{ source: '../outside.png', path: 'out/a.png' }, /inside its project/u],
    [{ source: 'icon.png', path: 'out/a.jpg', normalize: 'png' }, /\.png destination/u],
  ]
  for (const [copy, expected] of bad) {
    const g = await fixture({ version: 1, capacitor: { assets: { native: false, source: 'icon.png', outputs: [{ path: 'out/small.png', width: 4 }], copies: [copy] } } })
    await g.file('icon.png', await png('#fff'))
    await assert.rejects(capacitorAssets(g.ctx), expected)
    await assert.rejects(readFile(join(g.root, 'out/small.png')), /ENOENT/u)
  }
  const chained = await fixture({ version: 1, capacitor: { assets: { native: false, copies: [{ source: 'a.txt', path: 'b.txt' }, { source: 'b.txt', path: 'c.txt' }] } } })
  await assert.rejects(capacitorAssets(chained.ctx), /another copy destination/u)
  assert.throws(() => validateConfig({ version: 1, capacitor: { assets: { copies: [{ source: 'a', path: 'b', normalize: 'webp' }] } } }), /normalize/u)
  assert.throws(() => validateConfig({ version: 1, electron: { assets: { copies: [{ source: 'a' }] } } }), /source and a destination/u)
  assert.throws(() => validateConfig({ version: 1, capacitor: { assets: { copies: [{ source: 'a', path: 'b', prune: true }] } } }), /Unknown asset copy field/u)
})

test('asset copies may leave the module root for a sibling folder of the same config root', async () => {
  const copies = [{ source: 'art/icon.png', path: '../web/public/icon.png' }, { source: 'art/icon.png', path: 'public/icon.png' }]
  const config = { version: 1, capacitor: { root: 'frontend', assets: { native: false, copies } }, electron: { root: 'desktop', assets: { copies: [{ source: 'mark.txt', path: '../web/public/mark.txt' }] } } }
  const f = await project(config)
  await f.file('frontend/art/icon.png', await png('#f00'))
  await f.file('desktop/mark.txt', 'mark')
  await assert.rejects(f.run('capacitor', 'assets', '--check'), /stale/u)
  await f.run('capacitor', 'assets')
  await f.run('capacitor', 'assets', '--check')
  for (const path of ['web/public/icon.png', 'frontend/public/icon.png']) assert.deepEqual(await readFile(join(f.root, path)), await readFile(join(f.root, 'frontend/art/icon.png')))
  await f.run('electron', 'assets')
  assert.equal(await f.read('web/public/mark.txt'), 'mark')
})

test('asset copies still cannot leave the config root, and sources stay in the module root', async () => {
  const outside = await mkdtemp(join(tmpdir(), 'reusable-dev-scripts-outside-'))
  const bad = [
    [{ source: 'icon.png', path: '../../escape.png' }, /inside its project/u],
    [{ source: 'icon.png', path: join(outside, 'escape.png') }, /inside its project/u],
    [{ source: 'icon.png', path: '../linked/escape.png' }, /through a symlink/u],
    [{ source: 'icon.png', path: 'linked/escape.png' }, /through a symlink/u],
    [{ source: '../web/icon.png', path: 'out.png' }, /inside its project/u],
    [{ source: 'icon.png', path: '..' }, /must not replace/u],
    [{ source: 'icon.png', path: '.' }, /must not replace/u],
    [{ source: 'icon.png', path: '../frontend/icon.png' }, /overwrite their own inputs/u],
  ]
  for (const [copy, expected] of bad) {
    const f = await fixture({ version: 1, capacitor: { root: 'frontend', assets: { native: false, copies: [{ source: 'icon.png', path: '../web/first.png' }, copy] } } })
    await f.file('frontend/icon.png', await png('#fff'))
    await f.file('web/icon.png', await png('#000'))
    // Junctions need no special privilege on Windows; the type is ignored elsewhere.
    for (const link of ['linked', 'frontend/linked']) await symlink(outside, join(f.root, link), 'junction')
    await assert.rejects(capacitorAssets(f.ctx), expected)
    await assert.rejects(readFile(join(f.root, 'web/first.png')), /ENOENT/u)
  }
  await assert.rejects(readFile(join(outside, 'escape.png')), /ENOENT/u)
})
