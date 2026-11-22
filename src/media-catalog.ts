import { ANDROID_MEDIA, IOS_DISPLAY_TYPES, IOS_SCREENSHOT } from '../support/store/specs.mjs'
import { requireValue } from './runtime.js'
import type { Config, MediaConfig, MediaCustomAsset, MediaPlatform } from './types.js'

const MiB = 2 ** 20
export const mediaPlatforms: readonly MediaPlatform[] = ['android', 'ios', 'mac', 'windows']
export type MediaSource = 'design' | 'capture'
/** Sides are compared orientation-free: `short` is the smaller side, `long` the larger. */
export interface MediaRange { shortMin: number; shortMax?: number; longMin?: number; longMax: number; maxRatio?: number; square?: boolean }
/** A rectangle to keep clear of important content, drawn over a design in the viewer. */
export interface MediaGuide { label: string; /** Fraction of the height measured from the bottom, or pixels inset from every edge. */ bottom?: number; inset?: number }
export interface MediaSpec {
  id: string; platform: string; label: string
  /** The size rendered unless `media.sizes` picks another of `sizes`. */
  size: [number, number]; sizes?: [number, number][]; range?: MediaRange
  format: 'png' | 'jpeg'; alpha: 'forbid' | 'keep'; maxBytes: number
  min: number; max: number; required: boolean
  /** False: one image set for the default language only (an icon, a text-free graphic). */
  localized: boolean
  /** Origins the store allows. The first is the default. `capture` means the app's own screenshots, with no artwork. */
  sources: MediaSource[]
  /** Which language code names the folder: Google Play, App Store, or the app's own; `none` has no language folder. */
  folder: 'android' | 'ios' | 'app' | 'none'
  /** Below the export root; `{locale}` becomes the language folder. */
  directory: string
  /** Single image: its name; set: the prefix before the two-digit number. */
  file: string
  upload: 'fastlane' | 'manual'
  guides: MediaGuide[]; note?: string; custom?: boolean
}
export interface MediaLocale { app: string; android: string; ios: string }

const both = (sizes: [number, number][]): [number, number][] => sizes.flatMap(([w, h]) => [[w, h], [h, w]] as [number, number][])
const unique = (sizes: [number, number][]) => sizes.filter(([w, h], i) => sizes.findIndex(([a, b]) => a === w && b === h) === i)
const iosSizes = (group: string) => unique(Object.values(IOS_DISPLAY_TYPES).filter(type => type.group === group).flatMap(type => type.sizes))
const play = ANDROID_MEDIA.phoneScreenshots!
const playRange: MediaRange = { shortMin: play.minSide!, longMax: play.maxSide!, maxRatio: play.maxRatio }
const playSet: Pick<MediaSpec, 'format' | 'alpha' | 'maxBytes' | 'localized' | 'sources' | 'folder' | 'upload' | 'guides'> = { format: 'png', alpha: 'forbid', maxBytes: play.maxBytes, localized: true, sources: ['design', 'capture'], folder: 'android', upload: 'fastlane', guides: [] }
const iosSet: Pick<MediaSpec, 'format' | 'alpha' | 'maxBytes' | 'min' | 'max' | 'localized' | 'sources' | 'folder' | 'directory' | 'upload' | 'guides'> = { format: 'png', alpha: 'forbid', maxBytes: IOS_SCREENSHOT.maxBytes, min: 1, max: IOS_SCREENSHOT.max, localized: true, sources: ['design', 'capture'], folder: 'ios', directory: 'fastlane/screenshots/{locale}', upload: 'fastlane', guides: [] }

/**
 * Built-in catalog. Sizes and limits come from the stores' published specifications (Google Play Console preview assets, App Store Connect
 * screenshot specifications, Partner Center) and, for Play and the App Store, from the same table the store checker uses.
 * Whether a store reads the image from the fastlane tree (`upload: fastlane`) or it is kept for a manual upload is part of each entry.
 */
export function builtinMediaSpecs(config: Config): MediaSpec[] {
  const devices = config.store?.iosDevices
  const specs: MediaSpec[] = [
    { id: 'android.icon', platform: 'android', label: 'Google Play icon', size: [512, 512], format: 'png', alpha: 'keep', maxBytes: ANDROID_MEDIA.icon!.maxBytes, min: 1, max: 1, required: true, localized: false, sources: ['design'], folder: 'android', directory: 'fastlane/metadata/android/{locale}/images', file: 'icon', upload: 'fastlane', guides: [], note: 'Set once, on the default language.' },
    { id: 'android.featureGraphic', platform: 'android', label: 'Google Play feature graphic', size: [1024, 500], format: 'png', alpha: 'forbid', maxBytes: ANDROID_MEDIA.featureGraphic!.maxBytes, min: 1, max: 1, required: true, localized: true, sources: ['design'], folder: 'android', directory: 'fastlane/metadata/android/{locale}/images', file: 'featureGraphic', upload: 'fastlane', guides: [{ label: 'Keep text inside the 50 px convention', inset: 50 }] },
    { id: 'android.phone', platform: 'android', label: 'Google Play phone screenshots', size: [1080, 1920], range: playRange, min: play.min!, max: play.max!, required: true, directory: 'fastlane/metadata/android/{locale}/images/phoneScreenshots', file: '', ...playSet },
    { id: 'android.tablet7', platform: 'android', label: 'Google Play 7-inch tablet screenshots', size: [1200, 1920], range: playRange, min: 1, max: play.max!, required: false, directory: 'fastlane/metadata/android/{locale}/images/sevenInchScreenshots', file: '', ...playSet },
    { id: 'android.tablet10', platform: 'android', label: 'Google Play 10-inch tablet screenshots', size: [1600, 2560], range: playRange, min: 1, max: play.max!, required: false, directory: 'fastlane/metadata/android/{locale}/images/tenInchScreenshots', file: '', ...playSet },
    { id: 'android.wear', platform: 'android', label: 'Google Play Wear OS screenshots', size: [512, 512], range: { shortMin: 384, longMax: 3840, square: true }, min: 1, max: 8, required: false, directory: 'fastlane/metadata/android/{locale}/images/wearScreenshots', file: '', ...playSet, note: 'Square, no watch frame, no added text or transparency.' },
    { id: 'ios.iphone', platform: 'ios', label: 'App Store iPhone screenshots', size: [1290, 2796], sizes: iosSizes('iphone'), required: true, file: 'iphone-', ...iosSet },
    { id: 'ios.ipad', platform: 'ios', label: 'App Store iPad screenshots', size: [2064, 2752], sizes: iosSizes('ipad'), required: devices?.ipad === true, file: 'ipad-', ...iosSet },
    { id: 'ios.watch', platform: 'ios', label: 'App Store Apple Watch screenshots', size: [422, 514], sizes: iosSizes('watch'), required: devices?.watch === true, file: 'watch-', ...iosSet },
    { id: 'mac.screenshots', platform: 'mac', label: 'Mac App Store screenshots', size: [2880, 1800], sizes: [[1280, 800], [1440, 900], [2560, 1600], [2880, 1800]], format: 'png', alpha: 'forbid', maxBytes: IOS_SCREENSHOT.maxBytes, min: 1, max: 10, required: true, localized: true, sources: ['design', 'capture'], folder: 'ios', directory: 'artwork/mac/{locale}', file: 'mac-', upload: 'manual', guides: [], note: 'App Store Connect, Mac app, screenshots. Not uploaded by the store lanes.' },
    { id: 'windows.screenshots', platform: 'windows', label: 'Microsoft Store screenshots', size: [1920, 1080], range: { shortMin: 768, longMin: 1366, shortMax: 2160, longMax: 3840 }, format: 'png', alpha: 'keep', maxBytes: 50 * MiB, min: 1, max: 10, required: true, localized: true, sources: ['capture'], folder: 'app', directory: 'artwork/windows/{locale}', file: 'screenshot-', upload: 'manual', guides: [{ label: 'Store text overlays may cover the bottom third', bottom: 1 / 3 }], note: 'Must be screenshots of the app itself: rds copies captures untouched and never adds artwork, frames or text.' },
    { id: 'windows.tile', platform: 'windows', label: 'Microsoft Store app tile icon', size: [300, 300], format: 'png', alpha: 'keep', maxBytes: 50 * MiB, min: 1, max: 1, required: false, localized: false, sources: ['design'], folder: 'none', directory: 'artwork/windows', file: 'tile', upload: 'manual', guides: [] },
    { id: 'windows.boxArt', platform: 'windows', label: 'Microsoft Store 1:1 box art', size: [1080, 1080], sizes: [[1080, 1080], [2160, 2160]], format: 'png', alpha: 'keep', maxBytes: 50 * MiB, min: 1, max: 1, required: false, localized: true, sources: ['design'], folder: 'app', directory: 'artwork/windows/{locale}', file: 'box-art', upload: 'manual', guides: [], note: 'Listed as required by the MSI/EXE page and as games-only by the MSIX page: check Partner Center.' },
    { id: 'windows.poster', platform: 'windows', label: 'Microsoft Store 2:3 poster art', size: [720, 1080], sizes: [[720, 1080], [1440, 2160]], format: 'png', alpha: 'keep', maxBytes: 50 * MiB, min: 1, max: 1, required: false, localized: true, sources: ['design'], folder: 'app', directory: 'artwork/windows/{locale}', file: 'poster', upload: 'manual', guides: [] },
    { id: 'windows.superHero', platform: 'windows', label: 'Microsoft Store 16:9 super hero art', size: [1920, 1080], sizes: [[1920, 1080], [3840, 2160]], format: 'png', alpha: 'keep', maxBytes: 50 * MiB, min: 1, max: 1, required: false, localized: false, sources: ['design'], folder: 'none', directory: 'artwork/windows', file: 'super-hero', upload: 'manual', guides: [{ label: 'Keep key content out of the bottom third', bottom: 1 / 3 }], note: 'No title or other text, and avoid showing the app UI.' }
  ]
  return specs
}
function customSpec(entry: MediaCustomAsset): MediaSpec {
  const name = entry.name ?? entry.id.split('.').at(-1)!, max = entry.max ?? 1
  return {
    id: entry.id, platform: entry.platform, label: entry.label ?? entry.id, size: [entry.width, entry.height], format: entry.format ?? 'png', alpha: entry.alpha ?? 'forbid',
    maxBytes: entry.maxBytes ?? 10 * MiB, min: entry.min ?? 1, max, required: entry.required ?? false, localized: entry.localized ?? true, sources: entry.source ? [entry.source] : ['design', 'capture'],
    folder: 'app', directory: entry.directory ?? `artwork/${entry.platform}/{locale}`, file: max > 1 ? `${name}-` : name, upload: 'manual', guides: [], custom: true
  }
}
const identifier = /^[a-z][a-z0-9]*(?:[.-][a-zA-Z0-9]+)*$/u
const dimension = (value: unknown) => Number.isInteger(value) && (value as number) > 0 && (value as number) <= 8192

/** Structural checks that need no project context. Asset ids are checked against the catalog here so a typo fails at load time. */
export function validateMedia(config: Config): void {
  const media = config.media
  if (!media) return
  const keys = (entry: unknown, allowed: string[], label: string) => { requireValue(entry !== null && typeof entry === 'object' && !Array.isArray(entry), `${label} must be an object`); for (const key of Object.keys(entry as object)) requireValue(allowed.includes(key), `Unknown ${label} field: ${key}`) }
  keys(media, ['root', 'platforms', 'assets', 'exclude', 'locales', 'defaultLocale', 'designs', 'sizes', 'scenes', 'sources', 'custom', 'background', 'clock', 'offline', 'jobs', 'serve', 'capture', 'viewer', 'hooks'], 'media')
  const text = (value: unknown, label: string) => requireValue(typeof value === 'string' && value.length > 0 && !value.includes('\0'), `${label} must be a non-empty string`)
  if (media.root !== undefined) text(media.root, 'media.root')
  if (media.platforms !== undefined) requireValue(Array.isArray(media.platforms) && media.platforms.length > 0 && media.platforms.every(p => mediaPlatforms.includes(p)), `media.platforms must be a non-empty list of ${mediaPlatforms.join(', ')}`)
  const custom = media.custom ?? []
  requireValue(Array.isArray(custom), 'media.custom must be an array')
  const known = new Set(builtinMediaSpecs(config).map(spec => spec.id))
  for (const entry of custom) {
    keys(entry, ['id', 'platform', 'label', 'width', 'height', 'format', 'alpha', 'maxBytes', 'min', 'max', 'required', 'localized', 'source', 'directory', 'name'], 'media.custom entry')
    requireValue(typeof entry.id === 'string' && identifier.test(entry.id) && !known.has(entry.id), 'media.custom ids must be unique, lower-case and not a built-in id')
    known.add(entry.id)
    requireValue(typeof entry.platform === 'string' && /^[a-z][a-z0-9-]*$/u.test(entry.platform), 'media.custom platform must be a lower-case name')
    requireValue(dimension(entry.width) && dimension(entry.height), 'media.custom width and height must be integers from 1 to 8192')
    if (entry.format !== undefined) requireValue(['png', 'jpeg'].includes(entry.format), 'media.custom format must be png or jpeg')
    if (entry.alpha !== undefined) requireValue(['forbid', 'keep'].includes(entry.alpha), 'media.custom alpha must be forbid or keep')
    if (entry.source !== undefined) requireValue(['design', 'capture'].includes(entry.source), 'media.custom source must be design or capture')
    for (const field of ['maxBytes', 'min', 'max'] as const) if (entry[field] !== undefined) requireValue(Number.isSafeInteger(entry[field]) && entry[field]! > 0, `media.custom ${field} must be a positive integer`)
    requireValue((entry.min ?? 1) <= (entry.max ?? 1), 'media.custom min must not exceed max')
    for (const field of ['directory', 'name'] as const) if (entry[field] !== undefined) text(entry[field], `media.custom ${field}`)
    if (entry.directory !== undefined) requireValue(!/^(?:[/\\]|[a-zA-Z]:)/u.test(entry.directory) && !entry.directory.split(/[\\/]/u).includes('..'), 'media.custom directory must stay inside the export root')
    if (entry.name !== undefined) requireValue(/^[\w.-]+$/u.test(entry.name), 'media.custom name must be a file name without folders')
  }
  const knownList = (list: unknown, label: string) => { requireValue(Array.isArray(list) && list.every(id => typeof id === 'string' && known.has(id)), `${label} must list known asset ids`) }
  if (media.assets !== undefined) knownList(media.assets, 'media.assets')
  if (media.exclude !== undefined) knownList(media.exclude, 'media.exclude')
  for (const field of ['designs', 'sizes', 'scenes', 'sources'] as const) {
    const map = media[field]
    if (map === undefined) continue
    requireValue(map && typeof map === 'object' && !Array.isArray(map), `media.${field} must be an object`)
    for (const [id, value] of Object.entries(map)) {
      requireValue(known.has(id), `media.${field} names an unknown asset: ${id}`)
      if (field === 'designs') requireValue(typeof value === 'string' && /\.(html?|png|svg|jpe?g|webp)$/iu.test(value) && !value.includes('\0') && !/^(?:[/\\]|[a-zA-Z]:)/u.test(value) && !value.split(/[\\/]/u).includes('..'), 'media.designs entries must be .html, .png, .svg, .jpg or .webp paths inside the media root')
      if (field === 'sizes') requireValue(Array.isArray(value) && value.length === 2 && dimension(value[0]) && dimension(value[1]), 'media.sizes entries must be [width, height]')
      if (field === 'scenes') requireValue(Array.isArray(value) && value.length > 0 && value.every(scene => typeof scene === 'string' && /^[\w-]+$/u.test(scene)), 'media.scenes entries must be lists of scene ids')
      if (field === 'sources') requireValue(value === 'design' || value === 'capture', 'media.sources entries must be design or capture')
    }
  }
  if (media.background !== undefined) requireValue(typeof media.background === 'string' && /^#[0-9a-fA-F]{6}$/u.test(media.background), 'media.background must be a #rrggbb colour')
  if (media.clock !== undefined) requireValue(typeof media.clock === 'string' && !Number.isNaN(Date.parse(media.clock)), 'media.clock must be an ISO date')
  if (media.offline !== undefined) requireValue(typeof media.offline === 'boolean', 'media.offline must be a boolean')
  if (media.jobs !== undefined) requireValue(Number.isInteger(media.jobs) && media.jobs >= 1 && media.jobs <= 8, 'media.jobs must be an integer from 1 to 8')
  if (media.serve !== undefined) requireValue(Array.isArray(media.serve) && media.serve.every(path => typeof path === 'string' && path.length > 0 && !path.includes('\0')), 'media.serve must list directories')
  if (media.locales !== undefined) requireValue(Array.isArray(media.locales) && media.locales.length > 0, 'media.locales must be a non-empty list')
  if (media.viewer !== undefined) { keys(media.viewer, ['port'], 'media.viewer'); if (media.viewer.port !== undefined) requireValue(Number.isInteger(media.viewer.port) && media.viewer.port >= 0 && media.viewer.port < 65536, 'media.viewer.port must be a port number') }
  if (media.hooks !== undefined) keys(media.hooks, ['beforeRender', 'afterRender'], 'media.hooks')
  if (media.capture !== undefined) {
    keys(media.capture, ['module', 'baseUrl', 'scenes', 'allowRemote'], 'media.capture')
    text(media.capture.module, 'media.capture.module')
    let url: URL | undefined
    try { url = new URL(media.capture.baseUrl) } catch { /* reported below */ }
    requireValue(url && /^https?:$/u.test(url.protocol), 'media.capture.baseUrl must be an http(s) URL')
    if (media.capture.allowRemote !== undefined) requireValue(typeof media.capture.allowRemote === 'boolean', 'media.capture.allowRemote must be a boolean')
    requireValue(media.capture.allowRemote === true || ['localhost', '127.0.0.1', '[::1]'].includes(url!.hostname), 'media.capture.baseUrl must be a local address unless media.capture.allowRemote is true')
    requireValue(Array.isArray(media.capture.scenes) && media.capture.scenes.length > 0, 'media.capture.scenes must be a non-empty array')
    const ids = new Set<string>()
    for (const scene of media.capture.scenes) {
      keys(scene, ['id', 'viewport', 'deviceScaleFactor', 'colorScheme', 'transparent'], 'media.capture scene')
      requireValue(typeof scene.id === 'string' && /^[\w-]+$/u.test(scene.id) && !ids.has(scene.id), 'media.capture scene ids must be unique and use letters, digits, underscore and dash')
      ids.add(scene.id)
      requireValue(scene.viewport && dimension(scene.viewport.width) && dimension(scene.viewport.height), 'media.capture scene viewport needs integer width and height')
      if (scene.deviceScaleFactor !== undefined) requireValue(typeof scene.deviceScaleFactor === 'number' && scene.deviceScaleFactor >= 1 && scene.deviceScaleFactor <= 4, 'media.capture deviceScaleFactor must be from 1 to 4')
      if (scene.colorScheme !== undefined) requireValue(['light', 'dark'].includes(scene.colorScheme), 'media.capture colorScheme must be light or dark')
    }
    for (const [id, list] of Object.entries(media.scenes ?? {})) for (const scene of list) requireValue(ids.has(scene), `media.scenes.${id} names an unknown scene: ${scene}`)
  } else for (const id of Object.keys(media.scenes ?? {})) requireValue(false, `media.scenes.${id} needs media.capture scenes`)
  for (const spec of builtinMediaSpecs(config)) {
    const source = media.sources?.[spec.id]
    if (source !== undefined) requireValue(spec.sources.includes(source), `${spec.id} cannot come from ${source}: the store allows ${spec.sources.join(', ')}`)
  }
}

/** Does this exact size meet the spec? Returns the reason it does not. */
export function sizeProblem(spec: MediaSpec, width: number, height: number): string | undefined {
  if (spec.sizes) return spec.sizes.some(([w, h]) => w === width && h === height) ? undefined : `${width}×${height} is not one of ${spec.sizes.map(([w, h]) => `${w}×${h}`).join(', ')}`
  if (spec.range) {
    const [short, long] = [Math.min(width, height), Math.max(width, height)], range = spec.range
    if (range.square && width !== height) return `${width}×${height} must be square`
    if (short < range.shortMin || long > range.longMax || (range.longMin !== undefined && long < range.longMin) || (range.shortMax !== undefined && short > range.shortMax)) {
      return `${width}×${height} must have its short side ${range.shortMin}${range.shortMax ? `–${range.shortMax}` : '+'} px and its long side ${range.longMin ? `${range.longMin}–` : 'up to '}${range.longMax} px`
    }
    if (range.maxRatio && long > short * range.maxRatio) return `${width}×${height}: the long side may be at most ${range.maxRatio}× the short side`
    return undefined
  }
  return width === spec.size[0] && height === spec.size[1] ? undefined : `${width}×${height} must be exactly ${spec.size[0]}×${spec.size[1]}`
}
export interface ResolvedMedia { specs: MediaSpec[]; locales: MediaLocale[]; defaultLocale: MediaLocale; sizeOf(spec: MediaSpec): [number, number]; sourceOf(spec: MediaSpec): MediaSource }
/** The enabled specs and languages for a project. Throws on anything inconsistent, such as a size the store does not accept. */
export function resolveMedia(config: Config): ResolvedMedia {
  const media = config.media
  requireValue(media, 'Configure media in reusable-dev-scripts.config.mjs first')
  const raw = media.locales ?? config.store?.locales
  requireValue(raw?.length, 'Configure media.locales, or store.locales to reuse the store languages')
  const locales: MediaLocale[] = raw.map(entry => typeof entry === 'string' ? { app: entry, android: entry, ios: entry } : { app: entry.app, android: entry.android, ios: entry.ios })
  for (const locale of locales) for (const code of Object.values(locale)) requireValue(/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/u.test(code), `Invalid language code: ${code}`)
  for (const key of ['app', 'android', 'ios'] as const) requireValue(new Set(locales.map(locale => locale[key])).size === locales.length, `Duplicate ${key} language folder`)
  const defaultLocale = media.defaultLocale ? locales.find(locale => locale.app === media.defaultLocale) : locales[0]
  requireValue(defaultLocale, 'media.defaultLocale must be one of the configured languages')
  const platforms = media.platforms ?? ['android', 'ios']
  const all = [...builtinMediaSpecs(config).filter(spec => platforms.includes(spec.platform as MediaPlatform)), ...(media.custom ?? []).map(customSpec)]
  const exclude = new Set(media.exclude ?? [])
  const specs = all.filter(spec => (!media.assets || media.assets.includes(spec.id)) && !exclude.has(spec.id))
  requireValue(specs.length > 0, 'No media assets are selected: check media.platforms, media.assets and media.exclude')
  const sizeOf = (spec: MediaSpec): [number, number] => media.sizes?.[spec.id] ?? spec.size
  const sourceOf = (spec: MediaSpec): MediaSource => media.sources?.[spec.id] ?? spec.sources[0]!
  for (const spec of specs) {
    const [width, height] = sizeOf(spec)
    const problem = sizeProblem(spec, width, height)
    requireValue(!problem, `media.sizes for ${spec.id}: ${problem}`)
    if (media.designs?.[spec.id] !== undefined) requireValue(sourceOf(spec) === 'design', `${spec.id} comes from captures and cannot have a design${spec.sources.length === 1 ? ': the store wants screenshots of the app itself, without artwork' : ''}`)
  }
  return { specs, locales, defaultLocale, sizeOf, sourceOf }
}
/** Path below the export root, for image number `n` (1-based) of a set. */
export function mediaTarget(spec: MediaSpec, locale: MediaLocale, n: number, extension: string): string {
  const folder = spec.folder === 'none' ? '' : spec.folder === 'app' ? locale.app : locale[spec.folder]
  const directory = spec.directory.replaceAll('{locale}', folder)
  return `${directory}/${spec.max > 1 ? `${spec.file}${String(n).padStart(2, '0')}` : spec.file}.${extension}`
}
