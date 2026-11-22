import { existsSync } from 'node:fs'
import { readFile, readdir, rm } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'
import { Failure, inside, outputPath, requireValue, writeChanged } from './runtime.js'
import { mediaTarget, resolveMedia, sizeProblem, type MediaLocale, type MediaSpec, type ResolvedMedia } from './media-catalog.js'
import { builtInsHash, finishImage, hashTree, realMediaHost, sha256, startMediaServer, type MediaBrowser, type MediaHost, type MediaServer } from './media-render.js'
import { captureModuleJs, copyJson, designHtml, iconSvg, kitCss, kitJs } from './media-templates.js'
import type { Context } from './context.js'
import type { MediaCaptureModule, MediaConfig } from './types.js'

const version: string = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version
const reserved = new Set(['out', 'review', '.cache'])
const csv = (value: string) => value.split(',').map(part => part.trim()).filter(Boolean)

/** Everything a media command resolves from the configuration and flags. */
export interface MediaEnv {
  ctx: Context; media: MediaConfig; resolved: ResolvedMedia
  /** The media root (designs, copy, captures, review). */
  root: string
  /** Where final images are written: the store root when `store` is configured, else `<root>/out`. */
  exportRoot: string
  /** The enabled assets after --platform and --assets, and the languages after --locales. */
  specs: MediaSpec[]; locales: MediaLocale[]
  /** Directories the media server may serve. */
  serve: string[]
  host: MediaHost
}
export function mediaEnvironment(ctx: Context): MediaEnv {
  const media = ctx.section('media'), resolved = resolveMedia(ctx.config)
  const root = ctx.path(media.root ?? 'media')
  const platform = ctx.string('platform')
  if (platform) requireValue(resolved.specs.some(spec => spec.platform === platform), `--platform ${platform} matches no enabled asset`)
  const wantedAssets = csv(ctx.string('assets'))
  for (const id of wantedAssets) requireValue(resolved.specs.some(spec => spec.id === id), `--assets names an asset that is not enabled: ${id}`)
  const specs = resolved.specs.filter(spec => (!platform || spec.platform === platform) && (!wantedAssets.length || wantedAssets.includes(spec.id)))
  const wantedLocales = csv(ctx.string('locales'))
  for (const code of wantedLocales) requireValue(resolved.locales.some(locale => locale.app === code), `--locales names a language that is not configured: ${code}`)
  const locales = resolved.locales.filter(locale => !wantedLocales.length || wantedLocales.includes(locale.app))
  const serve = [root, ...(media.serve ?? []).map(path => ctx.path(path))]
  return { ctx, media, resolved, root, exportRoot: ctx.config.store ? ctx.moduleRoot('store') : join(root, 'out'), specs, locales, serve, host: ctx.mediaHost ?? realMediaHost }
}
/** The languages a spec is produced for: every one, or only the default for assets that are set once. */
const localesOf = (env: MediaEnv, spec: MediaSpec) => spec.localized ? env.locales : env.locales.filter(locale => locale.app === env.resolved.defaultLocale.app)
export const designPath = (env: MediaEnv, spec: MediaSpec) => env.media.designs?.[spec.id] ?? `base/${spec.id}.html`
const isPage = (path: string) => /\.html?$/iu.test(path)

async function pool<T>(items: T[], jobs: number, task: (item: T) => Promise<void>) {
  const queue = [...items]
  await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, async () => { for (let item = queue.shift(); item !== undefined; item = queue.shift()) await task(item) }))
}
const numbered = (spec: MediaSpec) => spec.max > 1
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
/** The finished images of one asset and language, in order. */
export async function mediaOutputs(env: MediaEnv, spec: MediaSpec, locale: MediaLocale): Promise<{ n: number; path: string; extension: string }[]> {
  const sample = mediaTarget(spec, locale, 1, 'png'), directory = outputPath(env.exportRoot, dirname(sample))
  const entries = await readdir(directory).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return []; throw error })
  const pattern = numbered(spec) ? new RegExp(`^${escape(spec.file)}(\\d{2})\\.(png|jpe?g)$`, 'u') : new RegExp(`^${escape(spec.file)}()\\.(png|jpe?g)$`, 'u')
  return entries.flatMap(name => { const match = pattern.exec(name); return match ? [{ n: Number(match[1] || 1), path: join(directory, name), extension: match[2]! }] : [] }).sort((a, b) => a.n - b.n)
}

export async function media(ctx: Context, action: string) {
  const env = mediaEnvironment(ctx)
  switch (action) {
    case 'list': return list(env)
    case 'scaffold': return scaffold(env)
    case 'capture': return capture(env)
    case 'render': return render(env)
    case 'check': return check(env)
    case 'sheet': return sheet(env)
    case 'view': return (await import('./media-viewer.js')).mediaView(env)
  }
}

async function list(env: MediaEnv) {
  const { ctx } = env
  ctx.log(`[rds] Languages: ${env.locales.map(locale => locale.app).join(', ')} (default ${env.resolved.defaultLocale.app}); images go to ${relative(ctx.root, env.exportRoot) || '.'}`)
  for (const spec of env.specs) {
    const source = env.resolved.sourceOf(spec), [width, height] = env.resolved.sizeOf(spec)
    const origin = source === 'capture' ? `captures ${(env.media.scenes?.[spec.id] ?? []).join(', ') || '(no scenes)'}` : designPath(env, spec)
    let present = 0
    for (const locale of localesOf(env, spec)) present += (await mediaOutputs(env, spec, locale)).length
    ctx.log(`${spec.id.padEnd(24)} ${spec.range ? `${width}×${height} (any ${spec.range.square ? 'square ' : ''}size the store accepts)` : spec.sizes && spec.sizes.length > 1 ? `${width}×${height} (or ${spec.sizes.length - 1} other sizes)` : `${width}×${height}`}  ${spec.min === spec.max ? spec.max : `${spec.min}-${spec.max}`} image(s)  ${spec.required ? 'required' : 'optional'}  ${spec.upload === 'fastlane' ? 'uploaded by store lanes' : 'manual upload'}  from ${origin}  ${present} file(s) rendered`)
  }
}

async function writeIfMissing(env: MediaEnv, path: string, content: string, force: boolean) {
  const target = outputPath(env.ctx.root, relative(env.ctx.root, path))
  const label = relative(env.ctx.root, target).split(sep).join('/')
  if (existsSync(target) && !force) { env.ctx.log(`[rds] Kept ${label}`); return }
  if (!env.ctx.dryRun) await writeChanged(target, content)
  env.ctx.log(`${env.ctx.dryRun ? '[plan]' : '[rds]'} Wrote ${label}`)
}
async function scaffold(env: MediaEnv) {
  const { ctx } = env, force = ctx.boolean('force'), defaults = env.resolved.defaultLocale.app
  await writeIfMissing(env, join(env.root, 'shared/kit.css'), kitCss, force)
  await writeIfMissing(env, join(env.root, 'shared/kit.js'), kitJs(defaults), force)
  await writeIfMissing(env, join(env.root, `copy/${defaults}.json`), copyJson(), force)
  for (const spec of env.specs) {
    if (env.resolved.sourceOf(spec) === 'capture') { ctx.log(`[rds] ${spec.id}: built from captures, no design to scaffold`); continue }
    const path = designPath(env, spec), size = env.resolved.sizeOf(spec)
    if (isPage(path)) await writeIfMissing(env, inside(env.root, path), designHtml(spec, size, defaults), force)
    else if (/\.svg$/iu.test(path)) await writeIfMissing(env, inside(env.root, path), iconSvg(size), force)
    else ctx.log(`[rds] ${spec.id}: put its master image at ${relative(ctx.root, inside(env.root, path)).split(sep).join('/')}`)
  }
  if (env.media.capture) await writeIfMissing(env, ctx.path(env.media.capture.module), captureModuleJs, force)
}

async function loadCaptureModule(env: MediaEnv): Promise<MediaCaptureModule> {
  const path = env.ctx.path(env.media.capture!.module)
  requireValue(existsSync(path), `The capture module is missing: ${env.media.capture!.module}. Run rds media scaffold to create one`)
  const module = await import(pathToFileURL(path).href) as MediaCaptureModule
  requireValue(typeof module.scene === 'function', 'The capture module must export a scene function')
  return module
}
async function withBrowser<T>(env: MediaEnv, work: (browser: MediaBrowser) => Promise<T>): Promise<T> {
  const browser = await env.host.launch(env.ctx.root)
  try { return await work(browser) } finally { await browser.close() }
}
async function capture(env: MediaEnv) {
  const { ctx } = env, settings = env.media.capture
  requireValue(settings, 'Configure media.capture first')
  const wanted = csv(ctx.string('scenes'))
  for (const id of wanted) requireValue(settings.scenes.some(scene => scene.id === id), `--scenes names an unknown scene: ${id}`)
  const scenes = settings.scenes.filter(scene => !wanted.length || wanted.includes(scene.id))
  const jobs = [...env.locales.flatMap(locale => scenes.map(scene => ({ locale, scene })))]
  if (ctx.dryRun) { for (const { locale, scene } of jobs) ctx.log(`[plan] Capture ${scene.id} (${locale.app}) at ${scene.viewport.width}×${scene.viewport.height}`); return }
  const module = await loadCaptureModule(env), failures: string[] = []
  await withBrowser(env, browser => pool(jobs, env.media.jobs ?? 2, async ({ locale, scene }) => {
    try {
      const png = await browser.capture({ scene, locale: locale.app, baseUrl: settings.baseUrl, module })
      const file = outputPath(env.root, `captures/${locale.app}/${scene.id}.png`)
      ctx.log(`[rds] Captured ${scene.id} (${locale.app})${await writeChanged(file, png) ? '' : ': unchanged'}`)
    } catch (error) { failures.push(`${scene.id} (${locale.app}): ${error instanceof Error ? error.message : String(error)}`) }
  }))
  requireValue(!failures.length, `Capture failed for ${failures.length} scene(s):\n${failures.join('\n')}`)
}

type Manifest = Record<string, { input: string; files: string[] }>
const manifestPath = (env: MediaEnv) => outputPath(env.ctx.root, '.rds/media/manifest.json')
async function readManifest(env: MediaEnv): Promise<Manifest> { try { return JSON.parse(await readFile(manifestPath(env), 'utf8')) as Manifest } catch { return {} } }
async function inputHashes(env: MediaEnv) {
  const cache = new Map<string, string>()
  const shared = sha256((await Promise.all([builtInsHash(), hashTree(env.root, rel => reserved.has(rel.split('/')[0]!) || ['captures', 'copy'].includes(rel.split('/')[0]!), cache), ...env.serve.slice(1).map(path => hashTree(path, () => false, cache))])).join(':'))
  const perLocale = async (locale: MediaLocale) => sha256(await Promise.all([locale.app, env.resolved.defaultLocale.app].map(async code => `${code}:${await hashTree(join(env.root, 'captures', code), () => false, cache)}:${await hashTree(join(env.root, 'copy'), rel => rel !== `${code}.json`, cache)}`)).then(parts => parts.join('|')))
  return { shared, perLocale }
}
const fingerprint = (env: MediaEnv, spec: MediaSpec, shared: string, locale: string) => sha256(JSON.stringify([version, spec.id, spec.size, env.resolved.sizeOf(spec), spec.format, spec.alpha, env.resolved.sourceOf(spec), designPath(env, spec), env.media.scenes?.[spec.id] ?? [], env.media.background, env.media.clock, shared, locale]))

interface Job { spec: MediaSpec; locale: MediaLocale; key: string; input: string }
async function render(env: MediaEnv) {
  const { ctx } = env, force = ctx.boolean('force'), checkOnly = ctx.boolean('check')
  const jobs: Job[] = []
  const hashes = ctx.dryRun ? undefined : await inputHashes(env)
  for (const spec of env.specs) for (const locale of localesOf(env, spec)) jobs.push({ spec, locale, key: `${spec.id}/${locale.app}`, input: hashes ? fingerprint(env, spec, hashes.shared, await hashes.perLocale(locale)) : '' })
  if (ctx.dryRun) { for (const { spec, locale } of jobs) ctx.log(`[plan] Render ${spec.id} (${locale.app}) at ${env.resolved.sizeOf(spec).join('×')} from ${env.resolved.sourceOf(spec) === 'capture' ? 'captures' : designPath(env, spec)}`); return }
  const manifest = await readManifest(env)
  const current = async (job: Job) => manifest[job.key]?.input === job.input && manifest[job.key]!.files.every(file => existsSync(outputPath(env.exportRoot, file)))
  if (checkOnly) {
    const stale: string[] = []
    for (const job of jobs) if (!(await current(job))) stale.push(job.key)
    for (const key of stale) ctx.log(`[rds] Stale: ${key}`)
    requireValue(!stale.length, `${stale.length} image set(s) are stale: run rds media render`)
    ctx.log(`[rds] ${jobs.length} image set(s) are up to date`); return
  }
  const pending: Job[] = []
  for (const job of jobs) { if (!force && await current(job)) ctx.log(`[rds] Up to date: ${job.key}`); else pending.push(job) }
  if (!pending.length) return
  await ctx.hooks(env.media.hooks?.beforeRender, ctx.root)
  const needsBrowser = pending.some(job => env.resolved.sourceOf(job.spec) === 'design' && isPage(designPath(env, job.spec)))
  const server = await startMediaServer(ctx.root, env.serve)
  const failures: string[] = []
  try {
    const run = async (browser: MediaBrowser | undefined) => pool(pending, env.media.jobs ?? 2, async job => {
      try {
        const files = await renderJob(env, job, browser, server)
        if (files) { manifest[job.key] = { input: job.input, files }; ctx.log(`[rds] Rendered ${job.key}: ${files.length} image(s)`) }
      } catch (error) { failures.push(`${job.key}: ${error instanceof Error ? error.message : String(error)}`) }
    })
    if (needsBrowser) await withBrowser(env, run); else await run(undefined)
  } finally { await server.close() }
  await writeChanged(manifestPath(env), JSON.stringify(manifest, null, 2) + '\n')
  requireValue(!failures.length, `Rendering failed for ${failures.length} image set(s):\n${failures.join('\n')}`)
  await ctx.hooks(env.media.hooks?.afterRender, ctx.root)
}

/** Raw slides for one asset and language, before the store's rules are applied. */
export async function slidesFor(env: MediaEnv, spec: MediaSpec, locale: MediaLocale, browser: MediaBrowser | undefined, server: MediaServer): Promise<{ slides: Buffer[]; exact: boolean; warnings: string[] } | undefined> {
  const [width, height] = env.resolved.sizeOf(spec)
  if (env.resolved.sourceOf(spec) === 'capture') {
    const scenes = env.media.scenes?.[spec.id] ?? []
    requireValue(scenes.length > 0, `${spec.id} is built from captures: list its scenes in media.scenes`)
    const slides: Buffer[] = []
    for (const scene of scenes) {
      const file = [locale.app, env.resolved.defaultLocale.app].map(code => join(env.root, 'captures', code, `${scene}.png`)).find(existsSync)
      requireValue(file, `Capture ${scene} is missing for ${locale.app}: run rds media capture`)
      slides.push(await readFile(file))
    }
    return { slides, exact: false, warnings: [] }
  }
  const path = designPath(env, spec), absolute = inside(env.root, path)
  if (!existsSync(absolute)) { requireValue(!spec.required, `No design at ${relative(env.ctx.root, absolute).split(sep).join('/')}: run rds media scaffold`); return undefined }
  if (!isPage(path)) {
    const background = spec.alpha === 'forbid' || spec.format === 'jpeg' ? (env.media.background ?? '#ffffff') : '#00000000'
    return { slides: [await sharp(await readFile(absolute)).resize(width, height, { fit: 'contain', background }).png().toBuffer()], exact: true, warnings: [] }
  }
  const url = `${server.origin}/${relative(env.ctx.root, absolute).split(sep).join('/')}?${new URLSearchParams({ lang: locale.app, asset: spec.id, width: String(width), height: String(height) })}`
  const shot = await browser!.renderPage({ url, width, height, locale: locale.app, origin: server.origin, clock: env.media.clock, offline: env.media.offline })
  return { ...shot, exact: true }
}
/** Everything between a design and the bytes of the final files: photograph, check the size, apply the store's rules. */
export async function renderSlides(env: MediaEnv, spec: MediaSpec, locale: MediaLocale, browser: MediaBrowser | undefined, server: MediaServer): Promise<{ images: { bytes: Buffer; extension: string; width: number; height: number }[]; warnings: string[] } | undefined> {
  const [width, height] = env.resolved.sizeOf(spec)
  const result = await slidesFor(env, spec, locale, browser, server)
  if (!result) return undefined
  requireValue(result.slides.length >= spec.min && result.slides.length <= spec.max, `produced ${result.slides.length} image(s); ${spec.label} takes ${spec.min === spec.max ? spec.max : `${spec.min} to ${spec.max}`}`)
  const images = []
  for (const [index, slide] of result.slides.entries()) {
    try { images.push(await finishImage(spec, slide, result.exact ? { width, height } : undefined, env.media.background ?? '#ffffff', (w, h) => sizeProblem(spec, w, h))) }
    catch (error) { throw new Failure(`image ${index + 1} ${error instanceof Error ? error.message : String(error)}`) }
  }
  return { images, warnings: result.warnings }
}
async function renderJob(env: MediaEnv, job: Job, browser: MediaBrowser | undefined, server: MediaServer): Promise<string[] | undefined> {
  const { spec, locale } = job
  const result = await renderSlides(env, spec, locale, browser, server)
  if (!result) { env.ctx.log(`[rds] Skipped ${job.key}: optional and has no design`); return undefined }
  for (const warning of result.warnings) env.ctx.log(`[rds] ${job.key}: ${warning}`)
  const files: string[] = []
  for (const [index, image] of result.images.entries()) {
    const relativeTarget = mediaTarget(spec, locale, index + 1, image.extension)
    await writeChanged(outputPath(env.exportRoot, relativeTarget), image.bytes); files.push(relativeTarget)
  }
  // Remove images of an earlier, longer set so a slide taken out of a design does not linger in the store folder.
  for (const old of await mediaOutputs(env, spec, locale)) if (!files.some(file => resolve(env.exportRoot, file) === resolve(old.path))) await rm(old.path)
  return files
}

interface Finding { level: 'error' | 'todo' | 'warn'; where: string; message: string }
const flatten = (value: unknown, prefix = ''): string[] => value && typeof value === 'object' ? Object.entries(value).flatMap(([key, item]) => flatten(item, prefix ? `${prefix}.${key}` : key)) : [prefix]
async function check(env: MediaEnv) {
  const { ctx } = env, strict = ctx.boolean('strict'), all = ctx.boolean('all-locales'), findings: Finding[] = []
  if (ctx.dryRun) { ctx.log(`[plan] Check ${env.specs.length} asset(s) in ${env.locales.length} language(s)`); return }
  for (const spec of env.specs) {
    for (const locale of localesOf(env, spec)) {
      const isDefault = locale.app === env.resolved.defaultLocale.app, where = `${spec.id} (${locale.app})`
      // Both stores show the default language's images where a language has none, so only the default must be complete.
      if (!isDefault && !all) continue
      const files = await mediaOutputs(env, spec, locale)
      if (!files.length) { if (spec.required) findings.push({ level: 'todo', where, message: 'missing' }); continue }
      if (files.length < spec.min) findings.push({ level: 'error', where, message: `has ${files.length} image(s), needs at least ${spec.min}` })
      if (files.length > spec.max) findings.push({ level: 'error', where, message: `has ${files.length} images, the store keeps at most ${spec.max}` })
      const sizes = new Set<string>()
      for (const file of files) {
        const name = `${where} ${relative(env.exportRoot, file.path).split(sep).join('/')}`
        try {
          const image = sharp(file.path), meta = await image.metadata(), bytes = (await readFile(file.path)).length
          const problem = sizeProblem(spec, meta.width!, meta.height!)
          if (problem) findings.push({ level: 'error', where: name, message: problem })
          sizes.add(`${meta.width}×${meta.height}`)
          if (bytes > spec.maxBytes) findings.push({ level: 'error', where: name, message: `is ${(bytes / 2 ** 20).toFixed(1)} MB, limit ${(spec.maxBytes / 2 ** 20).toFixed(1)} MB` })
          if ((spec.format === 'jpeg') !== (meta.format === 'jpeg')) findings.push({ level: 'error', where: name, message: `is ${meta.format}, the store wants ${spec.format}` })
          if (spec.alpha === 'forbid' && meta.hasAlpha && !(await image.stats()).isOpaque) findings.push({ level: 'error', where: name, message: 'has transparency, which the store does not accept' })
        } catch { findings.push({ level: 'error', where: name, message: 'cannot be read as an image' }) }
      }
      if (sizes.size > 1) findings.push({ level: 'warn', where, message: `mixes sizes (${[...sizes].join(', ')}); a store groups screenshots by size` })
    }
  }
  // Words: every language should have all the keys of the default language's copy, or a design shows untranslated text.
  const copyDirectory = join(env.root, 'copy'), base = join(copyDirectory, `${env.resolved.defaultLocale.app}.json`)
  if (existsSync(base)) {
    const keys = flatten(JSON.parse(await readFile(base, 'utf8')))
    for (const locale of env.locales) {
      if (locale.app === env.resolved.defaultLocale.app) continue
      const file = join(copyDirectory, `${locale.app}.json`)
      if (!existsSync(file)) { if (all) findings.push({ level: 'todo', where: `copy (${locale.app})`, message: 'has no copy file; designs fall back to the default language' }); continue }
      let theirs: string[]
      try { theirs = flatten(JSON.parse(await readFile(file, 'utf8'))) } catch { findings.push({ level: 'error', where: `copy (${locale.app})`, message: 'is not valid JSON' }); continue }
      for (const key of keys.filter(key => !theirs.includes(key))) findings.push({ level: 'todo', where: `copy (${locale.app})`, message: `lacks "${key}"` })
      for (const key of theirs.filter(key => !keys.includes(key))) findings.push({ level: 'warn', where: `copy (${locale.app})`, message: `has "${key}", which the default language does not` })
    }
  }
  for (const finding of findings) ctx.log(`[rds] ${finding.level} ${finding.where}: ${finding.message}`)
  const errors = findings.filter(finding => finding.level === 'error').length, todos = findings.filter(finding => finding.level === 'todo').length
  ctx.log(`[rds] Media check: ${errors} error(s), ${todos} todo, ${findings.length - errors - todos} warning(s)`)
  requireValue(!errors && !(strict && todos), strict && todos && !errors ? 'Media is incomplete (--strict)' : 'Media checks failed')
}

/** One contact sheet per language, rows by asset, to look over every final image at once. */
async function sheet(env: MediaEnv) {
  const { ctx } = env, gap = 24, height = 560
  for (const locale of env.locales) {
    const rows: { tiles: Buffer[]; widths: number[] }[] = []
    for (const spec of env.specs) {
      const files = await mediaOutputs(env, spec, spec.localized ? locale : env.resolved.defaultLocale)
      if (!files.length) continue
      const tiles = await Promise.all(files.map(file => sharp(file.path).resize({ height: Math.min(height, 560) }).png().toBuffer()))
      rows.push({ tiles, widths: await Promise.all(tiles.map(async tile => (await sharp(tile).metadata()).width!)) })
    }
    if (ctx.dryRun) { ctx.log(`[plan] Sheet for ${locale.app}`); continue }
    if (!rows.length) { ctx.log(`[rds] ${locale.app}: no rendered images yet`); continue }
    const width = Math.max(...rows.map(row => row.widths.reduce((sum, w) => sum + w + gap, gap))), total = rows.length * (height + gap) + gap
    const layers = rows.flatMap((row, index) => { let left = gap; return row.tiles.map((input, tile) => { const layer = { input, left, top: gap + index * (height + gap) }; left += row.widths[tile]! + gap; return layer }) })
    const png = await sharp({ create: { width, height: total, channels: 3, background: '#d9dce1' } }).composite(layers).png().toBuffer()
    await writeChanged(outputPath(env.root, `review/${locale.app}.png`), png)
    ctx.log(`[rds] Wrote ${relative(ctx.root, join(env.root, 'review', `${locale.app}.png`)).split(sep).join('/')}`)
  }
}
