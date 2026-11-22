import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { Context } from './context.js'
import { loadConfig } from './config.js'
import { requireValue } from './runtime.js'
import { vueBuild } from './vue.js'
import { capacitorSync, capacitorOpen, capacitorPrepare, capacitorLive } from './capacitor.js'
import { versions } from './versions.js'
import { capacitorAssets, locales } from './images.js'
import { androidBuild, androidInstall, androidStartAdb } from './android.js'
import { screenshots } from './screenshots.js'
import { store } from './store.js'
import { vscode, browserPackage } from './extensions.js'
import { cloudflare } from './cloudflare.js'
import { hostinger } from './hostinger.js'
import { hostingReset } from './hosting-reset.js'
import { electron, swift } from './desktop.js'
import { installSkill } from './skill.js'
import { devStart, devTabs } from './dev.js'
import { waitTcp } from './wait.js'
import { env } from './env.js'
import { prisma } from './prisma.js'
import { platformio } from './platformio.js'
import type { Flags, Runner } from './types.js'

type OptionKind = 'boolean' | 'string'
const globalOptions: Record<string, OptionKind> = { cwd: 'string', config: 'string', env: 'string', 'dry-run': 'boolean', 'allow-production': 'boolean', banner: 'boolean', 'no-banner': 'boolean', help: 'boolean' }
const options: Record<string, OptionKind> = Object.fromEntries([
  ...['platform', 'mode', 'bump', 'host', 'port', 'configuration', 'format', 'device', 'artifact', 'action', 'output', 'input', 'name', 'scope', 'version-code', 'text', 'only', 'track', 'status', 'groups', 'registry', 'arch', 'profile', 'target', 'branch', 'timeout', 'with', 'confirm-host', 'confirm-project', 'secrets-file', 'hostinger-target', 'pages-target', 'staple', 'kind'].map(key => [key, 'string'] as const),
  ...['open', 'skip-build', 'skip-typecheck', 'check', 'bump-build', 'https', 'skip-sync', 'clean', 'reveal', 'physical', 'replace', 'force', 'guided', 'strict', 'all-locales', 'include-changelogs', 'testflight-only', 'no-dependencies', 'unsigned', 'preflight', 'yes', 'resume', 'keep-pages'].map(key => [key, 'boolean'] as const),
  ...Object.entries(globalOptions)
])
export const commands: Record<string, string[]> = {
  exec: [], platformio: [],
  'skill install': ['output'],
  'vue build': ['mode', 'skip-typecheck'],
  'capacitor sync': ['platform', 'open', 'skip-build', 'mode', 'skip-typecheck'],
  'capacitor copy': ['platform', 'open', 'skip-build', 'mode', 'skip-typecheck'],
  'capacitor open': ['platform'],
  'capacitor live': ['platform', 'device', 'host', 'port', 'https', 'skip-sync', 'skip-build', 'mode', 'skip-typecheck'],
  'capacitor versions': ['platform', 'check', 'bump', 'bump-build'],
  'capacitor prepare': ['platform', 'bump', 'open', 'mode', 'skip-typecheck'],
  'capacitor assets': ['check', 'platform'],
  'capacitor locales': ['check'],
  'capacitor screenshots': ['platform', 'action', 'device', 'output', 'input', 'name', 'force', 'guided', 'skip-build', 'mode', 'skip-typecheck'],
  'android build': ['configuration', 'format', 'kind', 'clean', 'reveal'],
  'android start-adb': [],
  'android install': ['device', 'physical', 'artifact', 'replace'],
  'store scaffold': [], 'store check': ['platform', 'scope', 'strict', 'all-locales'],
  'store changelog': ['version-code', 'text', 'force'], 'store export': ['platform', 'output', 'format'],
  'store upload-listing': ['platform', 'only', 'include-changelogs', 'all-locales'],
  'store upload-build': ['platform', 'track', 'status', 'groups', 'testflight-only', 'all-locales'],
  'store pull': ['platform'], 'store doctor': ['platform'], 'store verify': ['platform', 'scope', 'version-code'],'store run': [],
  'vscode package': ['output', 'no-dependencies'], 'vscode publish': ['output', 'registry', 'bump', 'no-dependencies'],
  'electron dev': [], 'electron assets': ['check'], 'electron clean': [], 'electron build': ['platform', 'arch', 'format', 'clean', 'unsigned'],
  'electron notarize': ['artifact', 'staple', 'profile', 'preflight'],
  'swift icons': [], 'swift bundle': ['open'],
  'cloudflare setup-pages': ['target', 'yes'],
  'hosting reset': ['hostinger-target', 'pages-target', 'confirm-host', 'confirm-project', 'output', 'check', 'yes', 'resume'],
  'hosting drop': ['hostinger-target', 'pages-target', 'confirm-host', 'confirm-project', 'output', 'check', 'yes', 'resume', 'keep-pages'],
  'hosting recreate': ['hostinger-target', 'pages-target', 'confirm-host', 'confirm-project', 'output', 'check', 'yes', 'resume', 'keep-pages'],
  'hostinger setup': ['target', 'yes'], 'hostinger deploy': ['target', 'yes'],
  'cloudflare deploy-worker': ['target'], 'cloudflare migrate-d1': ['target'], 'cloudflare deploy-pages': ['target', 'branch'], 'cloudflare push-secrets': ['target', 'secrets-file'],
  'browser package': ['output'],
  'dev start': ['with'], 'dev tabs': ['with'], 'wait tcp': ['target', 'timeout'],
  'env template': [], 'env validate': [], 'env generate': [], 'env check': [],
  'prisma migrate': ['confirm-host'], 'prisma status': []
}
const passthroughCommands = ['exec', 'platformio', 'vue build', 'android build', 'store run']
export function parse(argv: string[]) {
  const positional: string[] = [], flags: Flags = {}; let forwarded: string[] = []
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!
    if (arg === '--') { forwarded = argv.slice(index + 1); break }
    if (!arg.startsWith('--')) { requireValue(!arg.startsWith('-'), 'Use long options such as --help'); positional.push(arg); continue }
    const split = arg.indexOf('='), key = arg.slice(2, split < 0 ? undefined : split)
    requireValue(Object.hasOwn(options, key), `Unknown option --${key}`)
    requireValue(!Object.hasOwn(flags, key), `Duplicate option --${key}`)
    if (options[key] === 'boolean') { requireValue(split < 0, `--${key} does not take a value`); flags[key] = true }
    else {
      const value = split < 0 ? argv[++index] : arg.slice(split + 1)
      requireValue(value !== undefined && value.length > 0 && !value.startsWith('--'), `--${key} needs a value`)
      flags[key] = value
    }
  }
  const key = positional.join(' ')
  requireValue(!(flags.banner && flags['no-banner']), 'Use only one of --banner or --no-banner')
  return { key, flags, forwarded }
}
export function help(key = ''): string {
  if (key.startsWith('hosting ') && commands[key]) return `rds ${key}\nOptions: ${[...Object.keys(globalOptions), ...commands[key]!].map(x => `--${x}${options[x] === 'string' ? ' <value>' : ''}`).join(' ')}\n${key === 'hosting reset' ? 'Permanently delete and recreate' : key === 'hosting drop' ? 'Permanently delete (the database is always discarded)' : 'Continue the drop journal and recreate'} the exact hosted resources. Protected environments are forbidden. Temporary domains change automatically. Consumer deployment remains separate.\n`
  if (key && commands[key]) return `rds ${key}\nOptions: ${[...Object.keys(globalOptions), ...commands[key]!].map(x => `--${x}${options[x] === 'string' ? ' <value>' : ''}`).join(' ')}\n${passthroughCommands.includes(key) ? 'Pass literal tool arguments after --.\n' : ''}${['capacitor sync', 'capacitor copy', 'capacitor prepare'].includes(key) ? 'capacitor.afterBuild runs after each web build, before native sync/copy; --skip-build skips it.\n' : ''}${key === 'android build' ? '--reveal is best-effort; file-manager failure only warns after a verified build.\n' : ''}${key === 'android install' ? 'android.appId must match the APK application ID, including any debug suffix. --replace deletes only that configured package and its data.\n' : ''}${key === 'electron notarize' ? 'A ZIP cannot be stapled: --staple names the .app inside it. --artifact/--staple may use * in the last path segment if it matches exactly one item. Profile: --profile, APPLE_NOTARY_PROFILE, then electron.notaryProfile.\n' : ''}${key === 'store upload-build' ? 'store.hooks.afterBuildUpload runs only after the store accepted the build.\n' : ''}`
  return `rds — type-specific development and release scripts\n\n${Object.keys(commands).map(x => `  rds ${x}`).join('\n')}\n\nGlobal: --cwd <directory> --config <file> --env <name> --dry-run --allow-production --banner --no-banner\nResult banners default to on; configure output.banners or RDS_BANNERS=0|1.\nUse rds <module> <command> --help for options. Dry-run redacts argv and secret values.\n`
}
export async function main(argv: string[], runner?: Runner, log: (message: string) => void = console.log, onContext?: (ctx: Context) => void): Promise<Context | undefined> {
  if (argv.length === 1 && argv[0] === '--version') { log(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version); return }
  const parsed = parse(argv), { key, flags, forwarded } = parsed
  if (!key || flags.help) { log(help(key)); return }
  requireValue(Object.hasOwn(commands, key), `Unknown command: ${key}. Use rds --help`)
  for (const name of Object.keys(flags)) requireValue(Object.hasOwn(globalOptions, name) || commands[key]!.includes(name), `--${name} is not supported by ${key}`)
  requireValue(!forwarded.length || passthroughCommands.includes(key), 'This command does not accept passthrough arguments')
  const cwd = resolve(typeof flags.cwd === 'string' ? flags.cwd : process.cwd())
  if (key === 'skill install') {
    requireValue(flags.config === undefined, 'skill install does not load project configuration; use --cwd to select the project')
    const ctx = new Context(cwd, { version: 1 }, flags, runner, log)
    onContext?.(ctx)
    await installSkill(ctx)
    return ctx
  }
  if (typeof flags.config === 'string') flags.config = resolve(cwd, flags.config)
  const loaded = await loadConfig(cwd, typeof flags.config === 'string' ? flags.config : undefined)
  const ctx = new Context(loaded.root, loaded.config, flags, runner, log)
  onContext?.(ctx)
  const [family, action] = key.split(' ')
  switch (family) {
    case 'exec': requireValue(forwarded.length, 'Use rds exec -- <command> [arguments]'); await ctx.run(forwarded[0]!, forwarded.slice(1), { cwd, label: 'Requested command' }); break
    case 'vue': await vueBuild(ctx, undefined, undefined, undefined, forwarded); break
    case 'capacitor':
      if (action === 'sync' || action === 'copy') await capacitorSync(ctx, action)
      else if (action === 'open') await capacitorOpen(ctx)
      else if (action === 'live') await capacitorLive(ctx)
      else if (action === 'versions') { if (!ctx.boolean('check')) await ctx.guard(ctx.moduleRoot('capacitor')); await versions(ctx) }
      else if (action === 'prepare') await capacitorPrepare(ctx)
      else if (action === 'assets') await capacitorAssets(ctx)
      else if (action === 'locales') await locales(ctx)
      else await screenshots(ctx)
      break
    case 'android': if (action === 'build') await androidBuild(ctx, forwarded); else if (action === 'start-adb') await androidStartAdb(ctx); else await androidInstall(ctx); break
    case 'store': requireValue(!flags.format || flags.format === 'csv', 'Only CSV store export is implemented'); await store(ctx, action!, forwarded); break
    case 'vscode': await vscode(ctx, action!); break
    case 'electron': await electron(ctx, action!); break
    case 'swift': await swift(ctx, action!); break
    case 'cloudflare': await cloudflare(ctx, action!); break
    case 'hosting': await hostingReset(ctx, undefined, undefined, action as 'reset' | 'drop' | 'recreate'); break
    case 'hostinger': await hostinger(ctx, action!); break
    case 'browser': await browserPackage(ctx); break
    case 'dev': if (action === 'tabs') await devTabs(ctx); else await devStart(ctx); break
    case 'wait': await waitTcp(ctx); break
    case 'env': await env(ctx, action!); break
    case 'prisma': await prisma(ctx, action!); break
    case 'platformio':
      // The tool's stdout is often parsed by the caller, so the step line goes to stderr unless the caller supplied a logger.
      if (log === console.log) ctx.log = message => console.error(message)
      await platformio(ctx, forwarded); break
  }
  return ctx
}
