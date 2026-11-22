import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { join } from 'node:path'
import sharp from 'sharp'
import { validateConfig } from '../dist/config.js'
import { media } from '../dist/media.js'
import { startViewer } from '../dist/media-viewer.js'
import { mediaEnvironment } from '../dist/media.js'
import { builtinMediaSpecs, resolveMedia, sizeProblem } from '../dist/media-catalog.js'
import { startMediaServer } from '../dist/media-render.js'
import { fixture } from './helpers.mjs'

const png = (width, height, { alpha = false, color = '#3366ff' } = {}) => sharp({ create: { width, height, channels: 4, background: alpha ? { r: 51, g: 102, b: 255, alpha: 0.5 } : color } }).png().toBuffer()
/** A browser that photographs nothing: it returns generated PNGs of the size the page was opened at. */
function fakeHost(options = {}) {
  const calls = [], captures = []
  return {
    calls, captures,
    async launch() {
      return {
        async renderPage(call) {
          calls.push(call)
          const asset = new URL(call.url).searchParams.get('asset'), count = options.slides?.[asset] ?? 1
          const wrong = options.wrongSize?.[asset]
          return { slides: await Promise.all(Array.from({ length: count }, () => png(wrong?.[0] ?? call.width, wrong?.[1] ?? call.height, { alpha: options.alpha !== false }))), warnings: options.warnings ?? [] }
        },
        async capture({ scene, locale, baseUrl, module }) {
          captures.push({ scene: scene.id, locale, baseUrl })
          if (options.failScene === scene.id) throw new Error('page crashed')
          const context = {}; await module.prepare?.({ context, locale, baseUrl }); await module.scene({ page: {}, scene, locale, baseUrl })
          return png(scene.viewport.width, scene.viewport.height)
        },
        async close() {}
      }
    }
  }
}
const locales = [{ app: 'en', android: 'en-US', ios: 'en-US' }, { app: 'es', android: 'es-ES', ios: 'es-ES' }]
const config = (extra = {}, store = { root: 'store', locales, iosDevices: { iphone: true, ipad: false, watch: false } }) => ({ version: 1, ...(store ? { store } : {}), media: { platforms: ['android', 'ios', 'windows'], ...extra } })
async function project(extra, flags = {}, host = fakeHost(), store) {
  const f = await fixture(config(extra, store), flags)
  f.ctx.mediaHost = host
  return f
}
const names = async (f, path) => (await readdir(join(f.root, path)).catch(() => [])).sort()

test('the catalog follows each store\'s rules and the store configuration', () => {
  const specs = Object.fromEntries(builtinMediaSpecs({ version: 1, store: { locales, iosDevices: { iphone: true, ipad: true, watch: false } } }).map(spec => [spec.id, spec]))
  assert.equal(specs['ios.ipad'].required, true); assert.equal(specs['ios.watch'].required, false)
  assert.deepEqual(specs['android.featureGraphic'].size, [1024, 500]); assert.equal(specs['android.featureGraphic'].alpha, 'forbid')
  assert.deepEqual(specs['windows.screenshots'].sources, ['capture'])
  assert.equal(sizeProblem(specs['android.phone'], 1080, 1920), undefined)
  assert.match(sizeProblem(specs['android.phone'], 300, 600), /short side 320/)
  assert.match(sizeProblem(specs['android.phone'], 1000, 2400), /at most 2×/)
  assert.match(sizeProblem(specs['android.wear'], 400, 500), /square/)
  assert.equal(sizeProblem(specs['ios.iphone'], 1290, 2796), undefined)
  assert.match(sizeProblem(specs['ios.iphone'], 1000, 2000), /is not one of/)
  assert.equal(sizeProblem(specs['windows.screenshots'], 1366, 768), undefined)
  assert.match(sizeProblem(specs['windows.screenshots'], 1280, 720), /short side/)
  assert.match(sizeProblem(specs['windows.screenshots'], 4000, 2000), /long side/)
  assert.match(sizeProblem(specs['mac.screenshots'], 1920, 1200), /is not one of/)
})

test('media configuration is validated when it is loaded', () => {
  const bad = (media, pattern) => assert.throws(() => validateConfig({ version: 1, media }), pattern)
  assert.doesNotThrow(() => validateConfig(config()))
  bad({ platforms: ['palm'] }, /media.platforms/)
  bad({ designs: { 'android.nope': 'base/x.html' } }, /unknown asset/)
  bad({ designs: { 'android.phone': '../x.html' } }, /inside the media root/)
  bad({ sizes: { 'android.phone': [0, 10] } }, /\[width, height\]/)
  bad({ sources: { 'windows.screenshots': 'design' } }, /cannot come from design/)
  bad({ custom: [{ id: 'android.phone', platform: 'android', width: 1, height: 1 }] }, /not a built-in id/)
  bad({ custom: [{ id: 'web.share', platform: 'web', width: 1200, height: 630, directory: '../x' }] }, /inside the export root/)
  bad({ background: 'white' }, /#rrggbb/)
  bad({ jobs: 20 }, /1 to 8/)
  bad({ capture: { module: 'c.mjs', baseUrl: 'https://example.com', scenes: [{ id: 'a', viewport: { width: 1, height: 1 } }] } }, /local address/)
  bad({ capture: { module: 'c.mjs', baseUrl: 'http://localhost:1', scenes: [{ id: 'a', viewport: { width: 1, height: 1 } }], }, scenes: { 'windows.screenshots': ['b'] } }, /unknown scene/)
  bad({ scenes: { 'windows.screenshots': ['a'] } }, /needs media.capture/)
  assert.doesNotThrow(() => validateConfig({ version: 1, media: { capture: { module: 'c.mjs', baseUrl: 'https://staging.example.com', allowRemote: true, scenes: [{ id: 'a', viewport: { width: 1, height: 1 } }] } } }))
})

test('selection honours platforms, assets, exclusions, sizes and the Microsoft Store screenshot rule', () => {
  const resolved = resolveMedia(config({ platforms: ['android', 'ios'], exclude: ['android.wear', 'android.tablet7'], sizes: { 'ios.iphone': [1242, 2688] } }))
  assert.ok(!resolved.specs.some(spec => ['android.wear', 'android.tablet7'].includes(spec.id)) && resolved.specs.some(spec => spec.id === 'android.tablet10'))
  assert.deepEqual(resolved.sizeOf(resolved.specs.find(spec => spec.id === 'ios.iphone')), [1242, 2688])
  assert.throws(() => resolveMedia(config({ sizes: { 'ios.iphone': [100, 100] } })), /ios.iphone: .*not one of/)
  assert.throws(() => resolveMedia(config({ platforms: ['windows'], designs: { 'windows.screenshots': 'base/win.html' } })), /cannot have a design: the store wants screenshots of the app itself/)
  assert.throws(() => resolveMedia({ version: 1, media: {} }), /media.locales/)
  assert.deepEqual(resolveMedia(config({ locales: ['en', 'fr'], defaultLocale: 'fr' }, undefined)).defaultLocale, { app: 'fr', android: 'fr', ios: 'fr' })
})

test('scaffold writes blank, correctly sized designs and never overwrites without --force', async () => {
  const f = await project({ assets: ['android.featureGraphic', 'android.phone', 'windows.screenshots'], capture: { module: 'scripts/capture.mjs', baseUrl: 'http://localhost:5173', scenes: [{ id: 'home', viewport: { width: 1920, height: 1080 } }] }, scenes: { 'windows.screenshots': ['home'] } })
  await media(f.ctx, 'scaffold')
  const feature = await readFile(join(f.root, 'media/base/android.featureGraphic.html'), 'utf8')
  assert.match(feature, /--w: 1024px; --h: 500px/); assert.equal((feature.match(/data-slide/g) ?? []).length, 2)
  const phone = await readFile(join(f.root, 'media/base/android.phone.html'), 'utf8')
  assert.equal((phone.match(/<section class="slide" data-slide>/g) ?? []).length, 3)
  assert.ok(existsSync(join(f.root, 'media/shared/kit.css')) && existsSync(join(f.root, 'media/shared/kit.js')) && existsSync(join(f.root, 'media/copy/en.json')))
  assert.ok(!existsSync(join(f.root, 'media/base/windows.screenshots.html')), 'capture-sourced assets get no design')
  assert.match(await readFile(join(f.root, 'scripts/capture.mjs'), 'utf8'), /export async function scene/)
  await writeFile(join(f.root, 'media/base/android.phone.html'), 'mine')
  await media(f.ctx, 'scaffold')
  assert.equal(await readFile(join(f.root, 'media/base/android.phone.html'), 'utf8'), 'mine')
  assert.ok(f.messages.some(line => line.includes('Kept media/base/android.phone.html')))
  const forced = await project({ assets: ['android.phone'] }, { force: true })
  await forced.file('media/base/android.phone.html', 'mine'); await media(forced.ctx, 'scaffold')
  assert.match(await readFile(join(forced.root, 'media/base/android.phone.html'), 'utf8'), /data-slide/)
  const dry = await project({ assets: ['android.phone'] }, { 'dry-run': true }); await media(dry.ctx, 'scaffold')
  assert.ok(!existsSync(join(dry.root, 'media')) && dry.messages.some(line => line.startsWith('[plan] Wrote')))
})

test('render writes the store layout with ordered names, flattens transparency and keeps the icon on the default language', async () => {
  const host = fakeHost({ slides: { 'android.phone': 3 } })
  const f = await project({ assets: ['android.icon', 'android.featureGraphic', 'android.phone', 'ios.iphone'], designs: { 'android.icon': 'base/icon.html' } }, {}, host)
  for (const id of ['android.featureGraphic', 'android.phone', 'ios.iphone']) await f.file(`media/base/${id}.html`, `<h1>${id}</h1>`)
  await f.file('media/base/icon.html', '<h1>icon</h1>')
  await media(f.ctx, 'render')
  assert.deepEqual(await names(f, 'store/fastlane/metadata/android/en-US/images'), ['featureGraphic.png', 'icon.png', 'phoneScreenshots'])
  assert.deepEqual(await names(f, 'store/fastlane/metadata/android/es-ES/images'), ['featureGraphic.png', 'phoneScreenshots'])
  assert.deepEqual(await names(f, 'store/fastlane/metadata/android/en-US/images/phoneScreenshots'), ['01.png', '02.png', '03.png'])
  assert.deepEqual(await names(f, 'store/fastlane/screenshots/es-ES'), ['iphone-01.png'])
  const feature = sharp(join(f.root, 'store/fastlane/metadata/android/en-US/images/featureGraphic.png'))
  assert.deepEqual([(await feature.metadata()).width, (await feature.metadata()).height], [1024, 500])
  assert.equal((await feature.stats()).isOpaque, true, 'transparency is replaced where Play forbids it')
  assert.equal((await sharp(join(f.root, 'store/fastlane/metadata/android/en-US/images/icon.png')).stats()).isOpaque, false, 'the icon keeps its alpha')
  const opened = host.calls.find(call => call.url.includes('asset=ios.iphone') && call.locale === 'es')
  assert.equal(opened.width, 1290); assert.equal(opened.height, 2796); assert.match(opened.url, /lang=es/); assert.match(opened.url, /^http:\/\/127\.0\.0\.1:\d+\/media\/base\/ios\.iphone\.html\?/)
  assert.equal(host.calls.length, 2 + 2 + 1 + 2, 'featureGraphic and phone in both languages, the icon once, iPhone in both')
})

test('render is incremental, --force redoes it, --check reports stale sets, and a shorter set removes old files', async () => {
  const host = fakeHost({ slides: { 'android.phone': 3 } })
  const f = await project({ assets: ['android.phone'], locales: ['en'] }, {}, host, null)
  await f.file('media/base/android.phone.html', '<h1>v1</h1>')
  await media(f.ctx, 'render')
  const first = host.calls.length
  assert.equal(first, 1)
  await media(f.ctx, 'render')
  assert.equal(host.calls.length, first, 'unchanged inputs are not rendered again')
  assert.ok(f.messages.some(line => line.startsWith('[rds] Up to date: android.phone/en')))
  await media(Object.assign(f.ctx, { flags: { ...f.ctx.flags, check: true } }), 'render')
  await f.file('media/base/android.phone.html', '<h1>v2</h1>')
  await assert.rejects(media(f.ctx, 'render'), /1 image set\(s\) are stale/)
  delete f.ctx.flags.check
  host.slides = undefined
  const shorter = fakeHost({ slides: { 'android.phone': 2 } }); f.ctx.mediaHost = shorter
  await media(f.ctx, 'render')
  assert.deepEqual(await names(f, 'media/out/fastlane/metadata/android/en/images/phoneScreenshots'), ['01.png', '02.png'], 'the third slide is gone')
  f.ctx.flags.force = true; await media(f.ctx, 'render')
  assert.equal(shorter.calls.length, 2)
})

test('rendering reports every problem together and never writes a set that breaks a store rule', async () => {
  const host = fakeHost({ wrongSize: { 'android.featureGraphic': [1000, 500] }, slides: { 'android.phone': 1 } })
  const f = await project({ assets: ['android.featureGraphic', 'android.phone'], locales: ['en'] }, {}, host, null)
  await f.file('media/base/android.featureGraphic.html', 'x'); await f.file('media/base/android.phone.html', 'x')
  await assert.rejects(media(f.ctx, 'render'), error => /android.featureGraphic\/en: image 1 is 1000×500, expected 1024×500/.test(error.message) && /android.phone\/en: produced 1 image\(s\); Google Play phone screenshots takes 2 to 8/.test(error.message))
  assert.ok(!existsSync(join(f.root, 'media/out/fastlane/metadata/android/en/images/featureGraphic.png')))
})

test('a missing design is an error for required assets and a skip for optional ones', async () => {
  const f = await project({ assets: ['android.featureGraphic', 'android.tablet7'], locales: ['en'] }, {}, fakeHost(), null)
  await f.file('media/base/placeholder.txt', '')
  await assert.rejects(media(f.ctx, 'render'), /No design at media\/base\/android.featureGraphic.html: run rds media scaffold/)
  const g = await project({ assets: ['android.tablet7'], locales: ['en'] }, {}, fakeHost(), null)
  await media(g.ctx, 'render')
  assert.ok(g.messages.some(line => line.includes('Skipped android.tablet7/en: optional and has no design')))
})

test('image masters are resized, and the page is offline-capable and clock-fixed when asked', async () => {
  const host = fakeHost()
  const f = await project({ assets: ['android.icon'], locales: ['en'], designs: { 'android.icon': 'base/icon.png' }, clock: '2026-01-02T03:04:05Z', offline: true }, {}, host, null)
  await f.file('media/base/icon.png', await png(1024, 1024))
  await media(f.ctx, 'render')
  const out = sharp(join(f.root, 'media/out/fastlane/metadata/android/en/images/icon.png')), meta = await out.metadata()
  assert.deepEqual([meta.width, meta.height], [512, 512]); assert.equal(host.calls.length, 0, 'no browser for a master image')
  const pages = await project({ assets: ['android.featureGraphic'], locales: ['en'], clock: '2026-01-02T03:04:05Z', offline: true }, {}, host, null)
  await pages.file('media/base/android.featureGraphic.html', 'x'); await media(pages.ctx, 'render')
  assert.equal(host.calls[0].clock, '2026-01-02T03:04:05Z'); assert.equal(host.calls[0].offline, true)
})

test('Microsoft Store screenshots are copied from captures untouched and refused when they are not app screens', async () => {
  const capture = { module: 'capture.mjs', baseUrl: 'http://localhost:5173', scenes: [{ id: 'home', viewport: { width: 1920, height: 1080 } }, { id: 'settings', viewport: { width: 1920, height: 1080 } }] }
  const f = await project({ platforms: ['windows'], assets: ['windows.screenshots'], scenes: { 'windows.screenshots': ['home', 'settings'] }, capture, locales: ['en', 'es'], defaultLocale: 'en' }, {}, fakeHost(), null)
  const home = await png(1920, 1080, { alpha: true })
  await f.file('media/captures/en/home.png', home); await f.file('media/captures/en/settings.png', await png(1920, 1080)); await f.file('media/captures/es/home.png', await png(1920, 1080, { color: '#ff0000' }))
  await media(f.ctx, 'render')
  assert.deepEqual(await names(f, 'media/out/artwork/windows/en'), ['screenshot-01.png', 'screenshot-02.png'])
  assert.deepEqual(await readFile(join(f.root, 'media/out/artwork/windows/en/screenshot-01.png')), home, 'the capture is copied byte for byte')
  const spanish = sharp(join(f.root, 'media/out/artwork/windows/es/screenshot-02.png')), pixel = await spanish.raw().toBuffer()
  assert.deepEqual([...pixel.subarray(0, 3)], [51, 102, 255], 'a language without that capture uses the default language\'s')
  await f.file('media/captures/en/settings.png', await png(1280, 720))
  await assert.rejects(media(f.ctx, 'render'), /image 2 has a size the store does not accept: 1280×720 must have its short side 768/)
  const missing = await project({ platforms: ['windows'], assets: ['windows.screenshots'], scenes: { 'windows.screenshots': ['home'] }, capture, locales: ['en'] }, {}, fakeHost(), null)
  await assert.rejects(media(missing.ctx, 'render'), /Capture home is missing for en: run rds media capture/)
  const none = await project({ platforms: ['windows'], assets: ['windows.screenshots'], locales: ['en'] }, {}, fakeHost(), null)
  await assert.rejects(media(none.ctx, 'render'), /built from captures: list its scenes/)
})

test('check finds missing, wrong-sized, oversized, transparent and over-long sets, and compares the copy files', async () => {
  const missing = await project({ assets: ['android.featureGraphic'], locales: ['en'] }, { strict: true }, fakeHost(), null)
  await assert.rejects(media(missing.ctx, 'check'), /Media is incomplete \(--strict\)/)
  assert.ok(missing.messages.some(line => line.includes('todo android.featureGraphic (en): missing')))
  const lenient = await project({ assets: ['android.featureGraphic'], locales: ['en'] }, {}, fakeHost(), null)
  await media(lenient.ctx, 'check')
  const broken = await project({ assets: ['android.featureGraphic', 'android.phone'], locales: ['en', 'es'] }, { 'all-locales': true }, fakeHost(), null)
  const base = 'media/out/fastlane/metadata/android/en/images'
  await broken.file(`${base}/featureGraphic.png`, await png(1024, 500, { alpha: true }))
  for (const n of [1, 2]) await broken.file(`${base}/phoneScreenshots/0${n}.png`, await png(n === 1 ? 1080 : 1000, n === 1 ? 1920 : 2400))
  await broken.file('media/copy/en.json', JSON.stringify({ title: 'a', nested: { one: 'b' } })); await broken.file('media/copy/es.json', JSON.stringify({ title: 'a', extra: 'c' }))
  await assert.rejects(media(broken.ctx, 'check'), /Media checks failed/)
  const log = broken.messages.join('\n')
  assert.match(log, /error android.featureGraphic \(en\) .*featureGraphic.png: has transparency/)
  assert.match(log, /error android.phone \(en\) .*02.png: 1000×2400: the long side may be at most 2×/)
  assert.match(log, /warn android.phone \(en\): mixes sizes/)
  assert.match(log, /todo android.featureGraphic \(es\): missing/)
  assert.match(log, /todo copy \(es\): lacks "nested.one"/); assert.match(log, /warn copy \(es\): has "extra"/)
})

test('sheet builds one contact sheet per language from the rendered images', async () => {
  const f = await project({ assets: ['android.featureGraphic', 'android.phone'], locales: ['en'] }, {}, fakeHost({ slides: { 'android.phone': 2 } }), null)
  await f.file('media/base/android.featureGraphic.html', 'x'); await f.file('media/base/android.phone.html', 'x')
  await media(f.ctx, 'render'); await media(f.ctx, 'sheet')
  const meta = await sharp(join(f.root, 'media/review/en.png')).metadata()
  assert.ok(meta.width > 1000 && meta.height > 1000)
  const empty = await project({ assets: ['android.phone'], locales: ['en'] }, {}, fakeHost(), null); await media(empty.ctx, 'sheet')
  assert.ok(empty.messages.some(line => line.includes('en: no rendered images yet')))
})

test('capture drives the project module per scene and language, reports failures together, and refuses missing modules', async () => {
  const capture = { module: 'capture.mjs', baseUrl: 'http://localhost:5173', scenes: [{ id: 'home', viewport: { width: 400, height: 800 } }, { id: 'detail', viewport: { width: 400, height: 800 } }] }
  const host = fakeHost()
  const f = await project({ platforms: ['android'], assets: ['android.phone'], capture, locales: ['en', 'es'] }, {}, host, null)
  await assert.rejects(media(f.ctx, 'capture'), /capture module is missing/)
  await f.file('capture.mjs', 'export const scene = async () => {}\nexport const prepare = async () => {}')
  await media(f.ctx, 'capture')
  assert.deepEqual(host.captures.map(item => `${item.scene}:${item.locale}`).sort(), ['detail:en', 'detail:es', 'home:en', 'home:es'])
  assert.deepEqual(await names(f, 'media/captures/es'), ['detail.png', 'home.png'])
  const one = await project({ platforms: ['android'], assets: ['android.phone'], capture, locales: ['en', 'es'], jobs: 1 }, { scenes: 'home', locales: 'es' }, fakeHost(), null)
  await one.file('capture.mjs', 'export const scene = async () => {}'); await media(one.ctx, 'capture')
  assert.deepEqual(await names(one, 'media/captures'), ['es'])
  const failing = await project({ platforms: ['android'], assets: ['android.phone'], capture, locales: ['en'] }, {}, fakeHost({ failScene: 'detail' }), null)
  await failing.file('capture.mjs', 'export const scene = async () => {}')
  await assert.rejects(media(failing.ctx, 'capture'), /Capture failed for 1 scene\(s\):\ndetail \(en\): page crashed/)
  assert.ok(existsSync(join(failing.root, 'media/captures/en/home.png')))
  const unknown = await project({ platforms: ['android'], assets: ['android.phone'], capture, locales: ['en'] }, { scenes: 'nope' }, fakeHost(), null)
  await assert.rejects(media(unknown.ctx, 'capture'), /unknown scene: nope/)
  const dry = await project({ platforms: ['android'], assets: ['android.phone'], capture, locales: ['en'] }, { 'dry-run': true }, fakeHost(), null)
  await media(dry.ctx, 'capture'); assert.ok(!existsSync(join(dry.root, 'media/captures')))
})

test('list and dry-run describe the work without touching anything', async () => {
  const f = await project({ assets: ['android.phone', 'windows.screenshots'], scenes: {}, locales: ['en'] }, {}, fakeHost(), null)
  await media(f.ctx, 'list')
  assert.ok(f.messages.some(line => /android.phone\s+1080×1920 \(any size the store accepts\)\s+2-8 image/.test(line)))
  assert.ok(f.messages.some(line => /windows.screenshots.*from captures \(no scenes\)/.test(line)))
  const dry = await project({ assets: ['android.phone'], locales: ['en', 'es'] }, { 'dry-run': true }, fakeHost(), null)
  await media(dry.ctx, 'render'); await media(dry.ctx, 'check'); await media(dry.ctx, 'view')
  assert.ok(dry.messages.some(line => line.startsWith('[plan] Render android.phone (es)')) && dry.messages.some(line => line.startsWith('[plan] Serve the media viewer')))
  assert.ok(!existsSync(join(dry.root, 'media')) && !existsSync(join(dry.root, '.rds')))
})

test('before and after hooks run around a render that has work to do', async () => {
  const f = await project({ assets: ['android.featureGraphic'], locales: ['en'], hooks: { beforeRender: [['echo', 'before']], afterRender: [['echo', 'after']] } }, {}, fakeHost(), null)
  await f.file('media/base/android.featureGraphic.html', 'x')
  await media(f.ctx, 'render')
  assert.deepEqual(f.calls.map(call => call.args[0]), ['before', 'after'])
  await media(f.ctx, 'render'); assert.equal(f.calls.length, 2, 'nothing to do, no hooks')
})

const get = (url, headers = {}, method = 'GET') => new Promise((resolve, reject) => {
  const target = new URL(url), req = request({ host: target.hostname, port: target.port, path: target.pathname + target.search, method, headers }, res => { const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) })) })
  req.on('error', reject); req.end()
})

test('the static server serves only the allowed directories, read-only, to its own address', async () => {
  const f = await fixture()
  await f.file('media/page.html', '<p>ok</p>'); await f.file('media/.secret', 'no'); await f.file('local-secure/key.pem', 'KEY'); await f.file('extra/font.woff2', 'font'); await f.file('package.json', '{}')
  const server = await startMediaServer(f.root, [join(f.root, 'media'), join(f.root, 'extra')])
  try {
    assert.equal((await get(`${server.origin}/media/page.html`)).status, 200)
    assert.equal((await get(`${server.origin}/extra/font.woff2`)).headers['content-type'], 'font/woff2')
    for (const path of ['/local-secure/key.pem', '/package.json', '/media/.secret', '/media/../package.json', '/%2e%2e/package.json', '/media/', '/media/missing.html']) assert.equal((await get(server.origin + path)).status, 404, path)
    assert.equal((await get(`${server.origin}/media/page.html`, {}, 'POST')).status, 405)
    assert.equal((await get(`${server.origin}/media/page.html`, { host: 'evil.example:80' })).status, 421, 'a rebound DNS name is refused')
    assert.equal((await get(`${server.origin}/media/page.html`, {}, 'HEAD')).status, 200)
    // Built-in device frames are offered to every design page, with the same Host and method rules.
    const frames = await get(`${server.origin}/_rds/devices.css`)
    assert.equal(frames.status, 200)
    assert.match(frames.headers['content-type'], /^text\/css/)
    assert.match(String(frames.body), /\.rds-device\[data-device="iphone"\]/)
    assert.doesNotMatch(String(frames.body), /url\((?!"data:)/, 'frames load nothing from anywhere')
    assert.equal((await get(`${server.origin}/_rds/devices.css`, { host: 'evil.example:80' })).status, 421)
    assert.equal((await get(`${server.origin}/_rds/devices.css`, {}, 'POST')).status, 405)
    assert.equal((await get(`${server.origin}/_rds/other.css`)).status, 404)
  } finally { await server.close() }
  assert.match(server.origin, /^http:\/\/127\.0\.0\.1:/)
})

test('the viewer lists assets, renders them like the real pipeline and keeps its page under a strict policy', async () => {
  const host = fakeHost({ slides: { 'android.phone': 3 } })
  const f = await project({ assets: ['android.icon', 'android.featureGraphic', 'android.phone', 'windows.screenshots'], locales: ['en'], viewer: { port: 0 } }, {}, host, null)
  await f.file('media/base/android.phone.html', 'x'); await f.file('media/base/android.featureGraphic.html', 'x')
  await f.file('media/out/fastlane/metadata/android/en/title.txt', 'Weather')
  const viewer = await startViewer(mediaEnvironment(f.ctx), 0), origin = viewer.server.origin
  try {
    const page = await get(`${origin}/_rds/`)
    assert.equal(page.status, 200); assert.match(page.headers['content-security-policy'], /script-src 'self'/); assert.match(page.body.toString(), /viewer\.js/)
    const script = (await get(`${origin}/_rds/viewer.js`)).body.toString()
    assert.match(script, /EventSource/)
    // Every slide and final image is a zoomable tile; design pages never scroll inside the viewer.
    assert.match(script, /function zoomItem\(/); assert.match(script, /event\.ctrlKey/); assert.match(script, /scrolling: 'no'/)
    for (const id of ['zoom-in', 'zoom-out', 'zoom-fit']) assert.match(page.body.toString(), new RegExp(`id="${id}"`))
    // Languages compares every language of one asset, one row each, rendering one language at a time.
    assert.match(page.body.toString(), /data-mode="languages"/); assert.match(script, /function languagesView\(/); assert.match(script, /for \(const \{ code, body, section \} of rows\)/)
    const state = JSON.parse((await get(`${origin}/_rds/api/state`)).body.toString())
    assert.deepEqual(state.assets.map(asset => asset.id), ['android.icon', 'android.featureGraphic', 'android.phone', 'windows.screenshots'])
    assert.equal(state.assets.find(asset => asset.id === 'android.phone').design, 'page'); assert.equal(state.assets.find(asset => asset.id === 'android.icon').design, 'missing'); assert.equal(state.assets.find(asset => asset.id === 'windows.screenshots').design, 'capture')
    assert.equal(state.assets.find(asset => asset.id === 'android.phone').designUrl, '/media/base/android.phone.html')
    const rendered = JSON.parse((await get(`${origin}/_rds/api/render?asset=android.phone&locale=en`)).body.toString())
    assert.equal(rendered.images.length, 3); assert.equal(rendered.images[0].width, 1080)
    const shot = await get(`${origin}/_rds/api/shot?asset=android.phone&locale=en&i=2`)
    assert.equal(shot.headers['content-type'], 'image/png'); assert.equal((await sharp(shot.body).metadata()).height, 1920)
    assert.equal((await get(`${origin}/_rds/api/shot?asset=android.phone&locale=en&i=9`)).status, 404)
    assert.match(JSON.parse((await get(`${origin}/_rds/api/render?asset=android.icon&locale=en`)).body.toString()).error ?? '', /No design at/)
    assert.equal((await get(`${origin}/_rds/api/render?asset=nope&locale=en`)).status, 400)
    assert.equal((await get(`${origin}/_rds/api/render?asset=android.phone&locale=xx`)).status, 400)
    // The listing mock shows only the store tree's listing text; anything missing is left empty for the page's placeholders.
    assert.equal(state.listing.en.android.title, 'Weather')
    assert.deepEqual([state.listing.en.ios.name, state.listing.en.ios.subtitle], ['', ''])
    assert.equal((await get(`${origin}/_rds/api/state`, { host: 'evil.example' })).status, 421)
    assert.equal((await get(`${origin}/_rds/api/state`, {}, 'POST')).status, 405)
  } finally { await viewer.close() }
})

test('storeLocales maps app languages to the folders both stores use and refuses to guess', async () => {
  const { storeLocales, storeLocaleLanguages } = await import('../dist/store-locales.js')
  assert.deepEqual(storeLocales(['en', 'es', 'pt', 'ru', 'hi', 'zh', 'ar', 'ur'.replace('ur', 'it')]), [
    { app: 'en', android: 'en-US', ios: 'en-US' }, { app: 'es', android: 'es-ES', ios: 'es-ES' }, { app: 'pt', android: 'pt-BR', ios: 'pt-BR' }, { app: 'ru', android: 'ru-RU', ios: 'ru' },
    { app: 'hi', android: 'hi-IN', ios: 'hi' }, { app: 'zh', android: 'zh-CN', ios: 'zh-Hans' }, { app: 'ar', android: 'ar', ios: 'ar-SA' }, { app: 'it', android: 'it-IT', ios: 'it' }])
  assert.deepEqual(storeLocales(['pt-BR', 'zh-Hans'])[1], { app: 'zh-Hans', android: 'zh-CN', ios: 'zh-Hans' })
  assert.throws(() => storeLocales(['zh-Hant']), /No store folders are known for language zh-Hant/)
  assert.deepEqual(storeLocales(['zh-Hant'], { 'zh-Hant': { android: 'zh-TW', ios: 'zh-Hant' } }), [{ app: 'zh-Hant', android: 'zh-TW', ios: 'zh-Hant' }])
  assert.deepEqual(storeLocales(['es'], { es: { android: 'es-419' } })[0], { app: 'es', android: 'es-419', ios: 'es-ES' })
  assert.throws(() => storeLocales(['xx']), /No store folders are known for language xx/)
  assert.throws(() => storeLocales([]), /non-empty list/); assert.throws(() => storeLocales(['../etc']), /non-empty list/)
  assert.ok(storeLocaleLanguages.includes('ja') && storeLocaleLanguages.every(code => /^[a-z]{2}$/u.test(code)))
  const resolved = resolveMedia({ version: 1, media: { locales: storeLocales(['en', 'de']) } })
  assert.deepEqual(resolved.locales.map(locale => locale.android), ['en-US', 'de-DE'])
})
