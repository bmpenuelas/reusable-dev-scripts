import { existsSync, watch, type FSWatcher } from 'node:fs'
import { readFile } from 'node:fs/promises'
import type { ServerResponse } from 'node:http'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inside, requireValue } from './runtime.js'
import { designPath, mediaOutputs, renderSlides, type MediaEnv } from './media.js'
import { startMediaServer, type MediaBrowser, type MediaServer } from './media-render.js'
import type { MediaLocale, MediaSpec } from './media-catalog.js'

const support = fileURLToPath(new URL('../support/media/', import.meta.url))
const policy = "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'"
const json = (response: ServerResponse, status: number, value: unknown) => { response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify(value)) }
const text = async (name: string) => (await readFile(join(support, name), 'utf8').catch(() => '')).replace(/^﻿/u, '')

export interface Viewer { server: MediaServer; close(): Promise<void> }
/**
 * The local viewer: design pages live in an iframe, the same pages rendered exactly as the final images, and store listing mocks built from
 * those renders. It listens on 127.0.0.1 only, serves the media root and `media.serve` read-only, and writes nothing.
 */
export async function startViewer(env: MediaEnv, port = env.media.viewer?.port ?? 5177): Promise<Viewer> {
  const { ctx } = env
  const specs = new Map(env.specs.map(spec => [spec.id, spec])), locales = new Map(env.locales.map(locale => [locale.app, locale]))
  const clients = new Set<ServerResponse>()
  let version = Date.now(), browser: MediaBrowser | undefined, launching: Promise<MediaBrowser> | undefined, server: MediaServer | undefined
  const cache = new Map<string, Promise<unknown>>()
  const queue = { tail: Promise.resolve() as Promise<unknown> }
  // One page at a time: renders share a single browser and a design under edit should not be photographed twice at once.
  const serial = <T>(task: () => Promise<T>): Promise<T> => { const next = queue.tail.then(task, task); queue.tail = next.catch(() => undefined); return next }
  const getBrowser = () => launching ??= env.host.launch(ctx.root).then(opened => (browser = opened))
  const renderFor = (spec: MediaSpec, locale: MediaLocale) => {
    const key = `${spec.id}/${locale.app}`
    if (!cache.has(key)) cache.set(key, serial(async () => {
      try {
        const needsPage = env.resolved.sourceOf(spec) === 'design' && /\.html?$/iu.test(designPath(env, spec))
        const result = await renderSlides(env, spec, locale, needsPage ? await getBrowser() : undefined, server!)
        if (!result) return { missing: true }
        return { images: result.images, warnings: result.warnings }
      } catch (error) { return { error: error instanceof Error ? error.message : String(error) } }
    }))
    return cache.get(key) as Promise<{ missing?: boolean; error?: string; warnings?: string[]; images?: { bytes: Buffer; extension: string; width: number; height: number }[] }>
  }
  // The listing text of the store tree (what `store upload-listing` uploads); the mock shows placeholders where there is none.
  const listing = async () => {
    const read = async (path: string) => (await readFile(inside(env.exportRoot, path), 'utf8').catch(() => '')).trim()
    const result: Record<string, { android: { title: string; short: string }; ios: { name: string; subtitle: string } }> = {}
    for (const locale of env.locales) result[locale.app] = {
      android: { title: await read(`fastlane/metadata/android/${locale.android}/title.txt`), short: await read(`fastlane/metadata/android/${locale.android}/short_description.txt`) },
      ios: { name: await read(`fastlane/metadata/ios/${locale.ios}/name.txt`), subtitle: await read(`fastlane/metadata/ios/${locale.ios}/subtitle.txt`) }
    }
    return result
  }
  const state = async () => ({
    version,
    default: env.resolved.defaultLocale.app,
    locales: env.locales.map(locale => locale.app),
    listing: await listing(),
    assets: await Promise.all(env.specs.map(async spec => {
      const source = env.resolved.sourceOf(spec), path = designPath(env, spec), absolute = inside(env.root, path)
      const finals: Record<string, number> = {}
      for (const locale of env.locales) finals[locale.app] = (await mediaOutputs(env, spec, locale)).length
      return {
        id: spec.id, platform: spec.platform, label: spec.label, size: env.resolved.sizeOf(spec), sizes: spec.sizes, range: spec.range, min: spec.min, max: spec.max, required: spec.required,
        format: spec.format, alpha: spec.alpha, maxBytes: spec.maxBytes, localized: spec.localized, upload: spec.upload, source, note: spec.note, guides: spec.guides, scenes: env.media.scenes?.[spec.id] ?? [],
        design: source === 'capture' ? 'capture' : !existsSync(absolute) ? 'missing' : /\.html?$/iu.test(path) ? 'page' : 'image',
        designUrl: source === 'design' && existsSync(absolute) ? `/${relative(ctx.root, absolute).split(sep).join('/')}` : undefined, designPath: source === 'design' ? path : undefined, finals
      }
    }))
  })
  const routes = async (request: import('node:http').IncomingMessage, response: ServerResponse, url: URL): Promise<boolean> => {
    if (!url.pathname.startsWith('/_rds/')) return false
    const name = url.pathname.slice('/_rds/'.length)
    if (name === '' || name === 'index.html') { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': policy, 'cache-control': 'no-store' }).end(await text('viewer.html')); return true }
    if (name === 'viewer.css') { response.writeHead(200, { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'no-store' }).end(await text('viewer.css')); return true }
    if (name === 'viewer.js') { response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' }).end(await text('viewer.js')); return true }
    if (name === 'events') {
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' }); response.write(': ready\n\n')
      clients.add(response); request.on('close', () => clients.delete(response)); return true
    }
    if (name === 'api/state') { json(response, 200, await state()); return true }
    const spec = specs.get(url.searchParams.get('asset') ?? ''), locale = locales.get(url.searchParams.get('locale') ?? '')
    if (name.startsWith('api/') && (!spec || !locale)) { json(response, 400, { error: 'Unknown asset or language' }); return true }
    if (name === 'api/render') {
      const result = await renderFor(spec!, spec!.localized ? locale! : env.resolved.defaultLocale)
      if (!result.images) { json(response, 200, { error: result.error, missing: result.missing === true }); return true }
      json(response, 200, { warnings: result.warnings, images: result.images.map(image => ({ width: image.width, height: image.height, bytes: image.bytes.length })) }); return true
    }
    if (name === 'api/shot') {
      const index = Number(url.searchParams.get('i') ?? 0), result = await renderFor(spec!, spec!.localized ? locale! : env.resolved.defaultLocale), image = result.images?.[index]
      if (!image) { json(response, 404, { error: 'No such image' }); return true }
      response.writeHead(200, { 'content-type': image.extension === 'jpg' ? 'image/jpeg' : 'image/png', 'cache-control': 'no-store' }).end(image.bytes); return true
    }
    if (name === 'api/final') {
      const index = Number(url.searchParams.get('i') ?? 0), files = await mediaOutputs(env, spec!, spec!.localized ? locale! : env.resolved.defaultLocale), file = files[index]
      if (!file) { json(response, 404, { error: 'No such image' }); return true }
      response.writeHead(200, { 'content-type': /jpe?g$/u.test(file.extension) ? 'image/jpeg' : 'image/png', 'cache-control': 'no-store' }).end(await readFile(file.path)); return true
    }
    json(response, 404, { error: 'Not found' }); return true
  }
  server = await startMediaServer(ctx.root, env.serve, port, routes)
  // A change in any served directory invalidates the renders and tells open pages to refresh.
  const watchers: FSWatcher[] = []
  let timer: NodeJS.Timeout | undefined
  const changed = (directory: string) => (_event: string, name: string | Buffer | null) => {
    const rel = String(name ?? '').split(sep)[0]
    if (directory === env.root && ['out', 'review', '.cache'].includes(rel!)) return
    clearTimeout(timer)
    timer = setTimeout(() => { cache.clear(); version = Date.now(); for (const client of clients) client.write(`event: change\ndata: ${version}\n\n`) }, 150)
  }
  for (const directory of env.serve) if (existsSync(directory)) { try { watchers.push(watch(directory, { recursive: true }, changed(directory))) } catch { /* the viewer still works without live refresh */ } }
  return {
    server,
    async close() {
      clearTimeout(timer); for (const watcher of watchers) watcher.close()
      for (const client of clients) client.end()
      await browser?.close().catch(() => undefined)
      await server!.close()
    }
  }
}

export async function mediaView(env: MediaEnv) {
  const { ctx } = env
  const port = ctx.flags.port === undefined ? undefined : Number(ctx.string('port'))
  requireValue(port === undefined || (Number.isInteger(port) && port >= 0 && port < 65536), '--port must be a port number')
  if (ctx.dryRun) { ctx.log(`[plan] Serve the media viewer on 127.0.0.1:${port ?? env.media.viewer?.port ?? 5177}`); return }
  const viewer = await startViewer(env, port)
  ctx.log(`[rds] Media viewer: ${viewer.server.origin}/_rds/ (Ctrl+C to stop)`)
  await new Promise<void>(done => { const stop = () => done(); process.once('SIGINT', stop); process.once('SIGTERM', stop) })
  await viewer.close()
}
