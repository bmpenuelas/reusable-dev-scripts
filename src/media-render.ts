import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createHash } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { Failure, inside, loadConsumerModule, requireValue } from './runtime.js'
import type { MediaCaptureModule, MediaScene } from './types.js'
import type { MediaSpec } from './media-catalog.js'

/** What the media commands need from a browser. The real one drives Chromium through the project's own Playwright; tests inject a fake. */
export interface MediaBrowser {
  /** Opens a design page and photographs each `[data-slide]` element (the whole page when it has none). */
  renderPage(options: { url: string; width: number; height: number; locale: string; origin: string; clock?: string; offline?: boolean }): Promise<{ slides: Buffer[]; warnings: string[] }>
  /** Runs the project's capture module for one scene and returns the PNG. */
  capture(options: { scene: MediaScene; locale: string; baseUrl: string; module: MediaCaptureModule }): Promise<Buffer>
  close(): Promise<void>
}
export interface MediaHost { launch(root: string): Promise<MediaBrowser> }

interface PwPage { goto(url: string, options?: object): Promise<unknown>; evaluate<T>(fn: string | (() => T | Promise<T>)): Promise<T>; waitForFunction(fn: string | (() => unknown), arg?: unknown, options?: object): Promise<unknown>; $$(selector: string): Promise<{ screenshot(options?: object): Promise<Buffer> }[]>; screenshot(options?: object): Promise<Buffer>; on(event: string, handler: (value: never) => void): void; clock?: { setFixedTime(time: Date): Promise<void> } }
interface PwContext { newPage(): Promise<PwPage>; route(pattern: string, handler: (route: { request(): { url(): string }; continue(): Promise<void>; abort(): Promise<void> }) => unknown): Promise<void>; close(): Promise<void> }
interface PwBrowser { newContext(options: object): Promise<PwContext>; close(): Promise<void> }
interface Playwright { chromium: { launch(options: object): Promise<PwBrowser> } }

function loadPlaywright(root: string): Playwright {
  for (const name of ['playwright', '@playwright/test', 'playwright-core']) {
    try { const module = loadConsumerModule(root, name) as Playwright; if (module?.chromium) return module } catch { /* try the next package */ }
  }
  throw new Failure('Media rendering needs Playwright in the project: npm install --save-dev playwright, then npx playwright install chromium')
}
const READY_TIMEOUT = 60_000
export const realMediaHost: MediaHost = {
  async launch(root) {
    const playwright = loadPlaywright(root)
    let browser: PwBrowser
    try { browser = await playwright.chromium.launch({ args: ['--ignore-gpu-blocklist', '--force-color-profile=srgb'] }) }
    catch { throw new Failure('Cannot start Chromium for Playwright; run npx playwright install chromium in the project') }
    return {
      async renderPage({ url, width, height, locale, origin, clock, offline }) {
        const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, locale, reducedMotion: 'reduce', colorScheme: 'light' })
        try {
          // Offline: only the media server itself is reachable, so a render never depends on the network.
          if (offline) await context.route('**/*', route => { const target = route.request().url(); return target.startsWith(origin) || /^(?:data|blob):/u.test(target) ? route.continue() : route.abort() })
          const page = await context.newPage()
          if (clock && page.clock) await page.clock.setFixedTime(new Date(clock))
          const errors: string[] = [], warnings: string[] = []
          page.on('pageerror', ((error: Error) => errors.push(error.message)) as never)
          page.on('console', ((message: { type(): string; text(): string }) => { if (message.type() === 'error') warnings.push(message.text().slice(0, 200)) }) as never)
          page.on('requestfailed', ((request: { url(): string }) => { if (request.url().startsWith(origin)) warnings.push(`Could not load ${request.url().slice(origin.length)}`) }) as never)
          await page.goto(url, { waitUntil: 'load', timeout: READY_TIMEOUT })
          await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(image => image.decode().catch(() => undefined))) })
          // A page that sets data-ready on <body> says when it is finished (data-ready="1"); others are ready once loaded.
          if (await page.evaluate(() => document.body?.hasAttribute('data-ready') ?? false)) await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: READY_TIMEOUT })
          if (errors.length) throw new Failure(`The page raised an error: ${errors[0]!.slice(0, 200)}`)
          const elements = await page.$$('[data-slide]')
          const slides = elements.length ? await Promise.all(elements.map(element => element.screenshot({ type: 'png', animations: 'disabled' }))) : [await page.screenshot({ type: 'png', animations: 'disabled' })]
          return { slides, warnings }
        } finally { await context.close() }
      },
      async capture({ scene, locale, baseUrl, module }) {
        const context = await browser.newContext({ viewport: scene.viewport, deviceScaleFactor: scene.deviceScaleFactor ?? 1, locale, reducedMotion: 'reduce', colorScheme: scene.colorScheme ?? 'light' })
        try {
          await module.prepare?.({ context, locale, baseUrl })
          const page = await context.newPage()
          await module.scene({ page, scene, locale, baseUrl })
          return await page.screenshot({ type: 'png', animations: 'disabled', omitBackground: scene.transparent === true })
        } finally { await context.close() }
      },
      close: () => browser.close()
    }
  }
}

const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.txt': 'text/plain; charset=utf-8', '.mp4': 'video/mp4', '.webm': 'video/webm', '.ico': 'image/x-icon' }
/** Built-in files every media server offers under /_rds/, for any design page (device frames). */
const builtIns: Record<string, string> = { 'devices.css': fileURLToPath(new URL('../support/media/devices.css', import.meta.url)) }
/** The content hash of the built-in files, part of every render fingerprint. */
export const builtInsHash = async () => sha256((await Promise.all(Object.entries(builtIns).map(async ([name, path]) => `${name}:${sha256(await readFile(path))}`))).join('|'))
export interface MediaServer { origin: string; port: number; close(): Promise<void> }
export type MediaRoute = (request: IncomingMessage, response: ServerResponse, url: URL) => boolean | Promise<boolean>
/**
 * A read-only static server for design pages: loopback only, GET/HEAD only, and only the directories it was given. A request whose Host
 * header is not the server's own address is refused, so a web page elsewhere cannot reach it through DNS rebinding. Paths are the files'
 * locations relative to the project root, so a page refers to its neighbours the way it does on disk.
 */
export async function startMediaServer(project: string, allowed: string[], port = 0, route?: MediaRoute): Promise<MediaServer> {
  const directories = allowed.map(directory => resolve(directory))
  let origin = ''
  const server: Server = createServer((request, response) => {
    void (async () => {
      try {
        const host = request.headers.host ?? ''
        if (!origin || !['127.0.0.1', 'localhost'].some(name => host === `${name}:${port || (server.address() as AddressInfo).port}`)) { response.writeHead(421).end(); return }
        if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405, { allow: 'GET, HEAD' }).end(); return }
        const url = new URL(request.url ?? '/', origin)
        const builtIn = url.pathname.startsWith('/_rds/') ? builtIns[url.pathname.slice('/_rds/'.length)] : undefined
        if (builtIn) {
          response.writeHead(200, { 'content-type': types[extname(builtIn)] ?? 'application/octet-stream', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
          response.end(request.method === 'HEAD' ? undefined : await readFile(builtIn)); return
        }
        if (route && await route(request, response, url)) return
        const relativePath = decodeURIComponent(url.pathname).replace(/^\/+/u, '')
        const target = resolve(project, relativePath)
        if (relativePath.split(/[\\/]/u).some(part => part === '' || part.startsWith('.')) && relativePath !== '') { response.writeHead(404).end(); return }
        const directory = directories.find(item => target === item || target.startsWith(item + sep))
        if (!directory) { response.writeHead(404).end(); return }
        const file = inside(directory, relative(directory, target))
        if (!(await stat(file)).isFile()) { response.writeHead(404).end(); return }
        const body = await readFile(file)
        response.writeHead(200, { 'content-type': types[extname(file).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
        response.end(request.method === 'HEAD' ? undefined : body)
      } catch { if (!response.headersSent) response.writeHead(404); response.end() }
    })()
  })
  await new Promise<void>((done, fail) => { server.once('error', () => fail(new Failure(port ? `Cannot listen on 127.0.0.1:${port}; choose another port with --port` : 'Cannot start the media server'))); server.listen(port, '127.0.0.1', done) })
  const bound = (server.address() as AddressInfo).port
  origin = `http://127.0.0.1:${bound}`
  port = bound
  return { origin, port: bound, close: () => new Promise<void>(done => { server.closeAllConnections?.(); server.close(() => done()) }) }
}

/** Final encoding of one slide: checks the size, removes transparency where the store forbids it, and enforces the file size limit. */
export async function finishImage(spec: MediaSpec, bytes: Buffer, expected: { width: number; height: number } | undefined, background: string, problem: (width: number, height: number) => string | undefined): Promise<{ bytes: Buffer; extension: string; width: number; height: number }> {
  let image = sharp(bytes)
  const meta = await image.metadata()
  requireValue(meta.width && meta.height, 'The image cannot be read')
  if (expected) requireValue(meta.width === expected.width && meta.height === expected.height, `is ${meta.width}×${meta.height}, expected ${expected.width}×${expected.height}`)
  const wrong = problem(meta.width, meta.height)
  requireValue(!wrong, `has a size the store does not accept: ${wrong}`)
  const extension = spec.format === 'jpeg' ? 'jpg' : 'png'
  let output: Buffer
  if (spec.format === 'jpeg') output = await image.flatten({ background }).jpeg({ quality: 90, mozjpeg: true, chromaSubsampling: '4:4:4' }).toBuffer()
  else if (spec.alpha === 'forbid') output = await (image = image.flatten({ background }).removeAlpha()).png({ compressionLevel: 9, effort: 10 }).toBuffer()
  else output = meta.format === 'png' && !expected ? bytes : await image.png({ compressionLevel: 9, effort: 10 }).toBuffer()
  requireValue(output.length <= spec.maxBytes, `is ${(output.length / 2 ** 20).toFixed(1)} MB; the limit is ${(spec.maxBytes / 2 ** 20).toFixed(1)} MB`)
  return { bytes: output, extension, width: meta.width, height: meta.height }
}

/** A tree's content hash, ignoring the named top-level directories. */
export async function hashTree(directory: string, skip: (path: string) => boolean = () => false, cache = new Map<string, string>()): Promise<string> {
  const hash = createHash('sha256')
  const walk = async (current: string) => {
    const entries = (await readdir(current, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return []; throw error })).sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      const path = join(current, entry.name), rel = relative(directory, path).split(sep).join('/')
      if (skip(rel)) continue
      if (entry.isDirectory()) { hash.update(`d:${rel}\n`); await walk(path) }
      else if (entry.isFile()) {
        let digest = cache.get(path)
        if (!digest) { digest = createHash('sha256').update(await readFile(path)).digest('hex'); cache.set(path, digest) }
        hash.update(`f:${rel}:${digest}\n`)
      }
    }
  }
  await walk(directory)
  return hash.digest('hex')
}
export const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
