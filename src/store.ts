import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir } from 'node:fs/promises'
import { dirname, join, relative, delimiter, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createStoreMetadata } from '../support/store/metadata.mjs'
import { artifacts, androidRoot } from './android.js'
import { nativeVersion } from './versions.js'
import { inside, outputPath, requireValue, writeChanged } from './runtime.js'
import type { Context } from './context.js'

const support = fileURLToPath(new URL('../support/store/', import.meta.url))
const cli = fileURLToPath(new URL('../bin/rds.mjs', import.meta.url))
export function storeCredentialPath(ctx: Context, filename: string): string {
  // Explicit exception for references passed to Fastlane, never output paths.
  // No key content is opened, copied or logged by configuration/dry-run.
  if (ctx.config.store?.allowExternalCredentials && isAbsolute(filename)) return resolve(filename)
  return ctx.path(filename)
}
export function storeSettings(ctx: Context) {
  const config = ctx.section('store'), root = ctx.moduleRoot('store')
  requireValue(config.locales?.length, 'Configure store.locales explicitly')
  const locales = config.locales.map(locale => typeof locale === 'string' ? { app: locale, play: locale, apple: locale } : { app: locale.app, play: locale.android, apple: locale.ios })
  for (const locale of locales) for (const code of Object.values(locale)) requireValue(/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/u.test(code), 'Invalid store locale')
  const defaults = config.defaultLocales ?? { android: config.defaultLocale ?? locales[0]!.play, ios: config.defaultLocale ?? locales[0]!.apple }
  requireValue(locales.some(x => x.play === defaults.android) && locales.some(x => x.apple === defaults.ios), 'Store defaults must be configured locales')
  requireValue(new Set(locales.map(x => x.play)).size === locales.length && new Set(locales.map(x => x.apple)).size === locales.length, 'Duplicate store locale folder')
  const metadata = createStoreMetadata({ root: ctx.root, locales, defaults, devices: config.iosDevices ?? { iphone: true, ipad: false, watch: false }, appLocales: config.appLocales, versionPackage: ctx.path(config.versionPackage ?? 'package.json'), log: ctx.log, safePath: (path: string) => outputPath(ctx.root, relative(ctx.root, path)) })
  return { config, root, locales, metadata, paths: metadata.createPaths(root) }
}
async function checkStore(ctx: Context, platform: string, scope = ctx.string('scope', 'all'), strict = ctx.boolean('strict')) {
  const settings = storeSettings(ctx)
  const result = await settings.metadata.runCheck({ platform, scope, strict, 'all-locales': ctx.boolean('all-locales') }, settings.paths)
  result.print(); requireValue(!result.count('error'), 'Store metadata checks failed')
}
function rubyBinary(): string {
  if (process.env.STORE_RUBY) return process.env.STORE_RUBY
  if (process.platform === 'darwin') for (const prefix of ['/opt/homebrew', '/usr/local']) for (const formula of ['ruby@3.3', 'ruby']) {
    const path = join(prefix, 'opt', formula, 'bin/ruby'); if (existsSync(path)) return path
  }
  return 'ruby'
}
export async function store(ctx: Context, action: string, forwarded: string[]) {
  const settings = storeSettings(ctx), { config, root, metadata, paths } = settings
  const platform = ctx.choice('platform', ['android', 'ios', 'all'], action === 'check' || action === 'scaffold' || action === 'changelog' || action === 'verify' ? 'all' : 'android')
  if (action === 'check') { if (!ctx.dryRun) await checkStore(ctx, platform); return }
  if (action === 'scaffold' || action === 'changelog') {
    if (!ctx.dryRun) {
      if (action === 'scaffold') await metadata.scaffold({}, paths)
      else {
        const version = nativeVersion(JSON.parse(await readFile(ctx.path(config.versionPackage ?? 'package.json'), 'utf8')).version)
        await metadata.changelog({ 'version-code': ctx.string('version-code', String(version.build)), text: ctx.flags.text, force: ctx.boolean('force') }, paths)
      }
    }
    return
  }
  if (action === 'export') {
    requireValue(platform !== 'all', 'CSV export needs one --platform')
    const columns = platform === 'android' ? ['title', 'short_description', 'full_description'] : ['name', 'subtitle', 'description', 'keywords', 'promotional_text']
    const extras = new Set<string>(), content: { code: string; fields: Record<string, string> }[] = []
    for (const locale of settings.locales) {
      const code = platform === 'android' ? locale.play : locale.apple
      if (!ctx.dryRun) {
        const directory = inside(root, `fastlane/metadata/${platform}/${code}`), fields: Record<string, string> = Object.create(null)
        for (const entry of await readdir(directory, { withFileTypes: true })) if (entry.isFile() && entry.name.endsWith('.txt')) {
          const key = entry.name.slice(0, -4); fields[key] = (await readFile(inside(directory, entry.name), 'utf8')).replace(/^\uFEFF/u, '').replace(/\r?\n$/u, '')
          if (!columns.includes(key)) extras.add(key)
        }
        requireValue(columns.every(key => Object.hasOwn(fields, key)), 'Missing required CSV listing fields')
        content.push({ code, fields })
      }
    }
    columns.push(...[...extras].sort())
    const rows = [['locale', ...columns], ...content.map(({ code, fields }) => [code, ...columns.map(key => fields[key] ?? '')])]
    const csv = '\uFEFF' + rows.map(row => row.map(cell => `"${cell.replaceAll('"', '""')}"`).join(',')).join('\r\n') + '\r\n'
    if (!ctx.dryRun) await writeChanged(outputPath(root, ctx.string('output', `exports/${platform}.csv`)), csv)
    return
  }
  let args: string[], lanes: string[][] | undefined
  let scope = 'all', uploading = false
  if (action === 'run') {
    requireValue(forwarded.length > 0, 'Use store run -- lanes or store run -- <android|ios> <lane>')
    if (forwarded[0] === 'lanes') requireValue(forwarded.length === 1, 'lanes takes no arguments')
    else {
      const lanes = forwarded[0] === 'android' ? ['listing', 'images', 'listing_with_images', 'internal', 'pull', 'doctor', 'verify'] : ['listing', 'screenshots', 'previews', 'listing_with_images', 'internal', 'pull', 'doctor', 'verify']
      requireValue(['android', 'ios'].includes(forwarded[0]!) && lanes.includes(forwarded[1]!), 'Unsupported shared Fastlane lane')
      for (const option of forwarded.slice(2)) requireValue(/^(track|version|version_code|status|groups|notes|age_rating|changelogs|validate|confirm|scope):[^\r\n]+$/u.test(option), 'Unsupported Fastlane option; checks and Git safety cannot be bypassed')
      // Play releases are either a draft or rolled out completely to the internal track; partial rollouts and halts are not offered.
      for (const option of forwarded.slice(2)) requireValue(!option.startsWith('status:') || ['status:draft', 'status:completed'].includes(option), 'status must be draft or completed')
      requireValue(forwarded[1] === 'verify' || !forwarded.slice(2).some(x => x.startsWith('scope:')), 'Only the verify lane takes scope')
      requireValue(!(forwarded[0] === 'ios' && forwarded[1] === 'internal' && forwarded.slice(2).some(x => x.startsWith('validate:'))), 'TestFlight has no validation-only upload; use --dry-run')
      uploading = !['pull', 'doctor', 'verify'].includes(forwarded[1]!)
      scope = forwarded[1] === 'listing' ? 'text' : ['images', 'screenshots', 'previews'].includes(forwarded[1]!) ? 'media' : 'all'
    }
    args = forwarded
  } else if (action === 'verify') {
    // Read-only comparison with the store drafts. The default (--platform all) covers every configured store.
    const only = ctx.choice('scope', ['text', 'media', 'all'], 'all')
    const configured = { android: Boolean(config.androidId && config.playKey), ios: Boolean(config.iosId && config.appleKey) }
    const platforms = platform === 'all' ? (['android', 'ios'] as const).filter(name => configured[name]) : [platform]
    requireValue(platforms.length > 0, 'Configure store.androidId and store.playKey, or store.iosId and store.appleKey')
    if (platform === 'all') for (const name of ['android', 'ios'] as const) if (!configured[name]) ctx.log(`[rds] Skipping ${name}: not configured`)
    lanes = platforms.map(name => [name, 'verify', `scope:${only}`])
    args = lanes[0]!
  } else {
    requireValue(platform !== 'all', 'Select one store platform')
    if (action === 'upload-listing') {
      const only = ctx.choice('only', platform === 'android' ? ['text', 'images', 'all'] : ['text', 'screenshots', 'previews', 'all'], 'text')
      scope = only === 'text' ? 'text' : only === 'all' ? 'all' : 'media'
      const lane = only === 'text' ? 'listing' : only === 'all' ? 'listing_with_images' : only
      args = [platform, lane, ...(ctx.boolean('include-changelogs') ? ['changelogs:true'] : [])]; uploading = true
    } else if (action === 'upload-build') {
      requireValue(ctx.string('track', 'internal') === 'internal', 'Only internal testing uploads are implemented')
      requireValue(platform !== 'ios' || process.platform === 'darwin' || ctx.dryRun, 'Building a TestFlight IPA requires macOS/Xcode')
      args = [platform, 'internal', `status:${ctx.choice('status', ['draft', 'completed'], 'completed')}`]
      if (ctx.flags.groups) args.push(`groups:${ctx.string('groups')}`)
      uploading = true
    } else args = [platform, action]
  }
  const chosen = args[0] === 'lanes' ? platform : args[0]!
  const playKey = config.playKey ? storeCredentialPath(ctx, config.playKey) : undefined
  const appleKey = config.appleKey ? storeCredentialPath(ctx, config.appleKey) : undefined
  if (args[1] === 'internal' && chosen === 'ios') requireValue(process.platform === 'darwin' || ctx.dryRun, 'Building a TestFlight IPA requires macOS/Xcode')
  if (uploading) { await ctx.guard(root); if (!ctx.dryRun && args[1] !== 'internal') await checkStore(ctx, chosen, scope, true); await ctx.hooks(config.hooks?.beforeUpload, ctx.root, chosen) }
  if (chosen === 'ios' && args[0] !== 'lanes') requireValue(config.iosId && config.appleKey, 'Configure store.iosId and store.appleKey')
  if (chosen === 'android' && args[0] !== 'lanes') requireValue(config.androidId && config.playKey, 'Configure store.androidId and store.playKey')
  const cache = outputPath(ctx.root, '.rds/store'), wrapper = outputPath(ctx.root, '.rds/store/fastlane/Fastfile')
  if (!ctx.dryRun) { await mkdir(dirname(wrapper), { recursive: true }); await writeChanged(wrapper, `import ${JSON.stringify(join(support, 'Fastfile'))}\n`) }
  const ruby = rubyBinary(), selected = ruby === 'ruby' ? undefined : dirname(ruby)
  const env: NodeJS.ProcessEnv = {
    BUNDLE_GEMFILE: join(support, 'Gemfile'), BUNDLE_PATH: outputPath(ctx.root, '.rds/gems'), BUNDLE_FROZEN: 'true',
    FASTLANE_SKIP_UPDATE_CHECK: '1', FASTLANE_OPT_OUT_USAGE: '1', FASTLANE_OPT_OUT_CRASH_REPORTING: '1',
    LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8',
    RDS_STORE_ROOT: root, RDS_STORE_SUPPORT: support, RDS_PROJECT_ROOT: ctx.root, RDS_CLI_ENTRY: cli, RDS_NODE: process.execPath,
    RDS_CHECK_ARGS: JSON.stringify(['--cwd', ctx.root, ...(ctx.flags.config ? ['--config', ctx.path(ctx.string('config'))] : [])]),
    RDS_IOS_ID: config.iosId, RDS_IOS_SCHEME: config.iosScheme ?? 'App',
    RDS_DEFAULT_IOS_LOCALE: config.defaultLocales?.ios ?? config.defaultLocale ?? settings.locales[0]!.apple,
    RDS_IOS_PROJECT: ctx.path(config.iosProject ?? join(ctx.config.capacitor?.root ?? '.', 'ios/App/App.xcodeproj')),
    RDS_ANDROID_AAB: artifacts(ctx, 'release', 'aab'), RDS_ANDROID_MAPPING: inside(androidRoot(ctx), ctx.config.android?.mapping ?? 'app/build/outputs/mapping/release/mapping.txt'),
    ...(playKey ? { SUPPLY_JSON_KEY: playKey } : {}), ...(appleKey ? { APP_STORE_CONNECT_API_KEY_PATH: appleKey } : {}),
    ...(config.androidId ? { SUPPLY_PACKAGE_NAME: config.androidId } : {}), ...(selected ? { PATH: selected + delimiter + (process.env.PATH ?? '') } : {})
  }
  const version = await ctx.run(ruby, ['-e', 'print RUBY_VERSION'], { cwd: ctx.root, capture: true, env, label: 'Ruby version preflight' })
  if (!ctx.dryRun) requireValue(/^(?:3\.(?:[3-9]|\d{2,})\.|[4-9]\.)/u.test(version.stdout), 'Fastlane requires Ruby 3.3 or newer; configure STORE_RUBY')
  try { await ctx.run(ruby, ['-S', 'bundle', 'check'], { cwd: cache, env, capture: true, label: 'Check pinned Fastlane gems' }) }
  catch { await ctx.run(ruby, ['-S', 'bundle', 'install'], { cwd: cache, env, label: 'Install pinned Fastlane gems' }) }
  // Several lanes (verify on every store) all run so that one store's difference does not hide the other's.
  const failed: string[] = []
  for (const lane of lanes ?? [args]) {
    try { await ctx.run(ruby, ['-S', 'bundle', 'exec', 'fastlane', ...lane], { cwd: cache, env, label: 'Run shared Fastlane lane' }) }
    catch (error) { if (!lanes || lanes.length === 1) throw error; failed.push(lane[0]!) }
  }
  requireValue(!failed.length, `Store verification failed for: ${failed.join(', ')}`)
}
