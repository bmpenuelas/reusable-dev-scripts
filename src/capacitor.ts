import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { request } from 'node:https'
import { isIP } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { requireValue } from './runtime.js'
import { vueBuild } from './vue.js'
import { versions } from './versions.js'
import { locales, capacitorAssets } from './images.js'
import { androidEnvironment } from './android.js'
import type { Context } from './context.js'

export function platforms(ctx: Context): ('android' | 'ios')[] {
  const config = ctx.section('capacitor'), root = ctx.moduleRoot('capacitor')
  const configured = config.platforms ?? (['android', 'ios'] as const).filter(p => existsSync(join(root, p)))
  const selected = ctx.choice('platform', ['android', 'ios', 'all'], 'all')
  const result = selected === 'all' ? configured : [selected as 'android' | 'ios']
  requireValue(result.length > 0 && result.every(p => configured.includes(p)), 'Selected platform is not configured or present')
  return result
}
export async function capacitorSync(ctx: Context, action: 'sync' | 'copy' = 'sync', prepared = false) {
  const config = ctx.section('capacitor'), root = ctx.moduleRoot('capacitor'), targets = platforms(ctx)
  if (!prepared) {
    for (const platform of targets) await ctx.guard(root, platform)
    await ctx.hooks(config.prepare, ctx.root)
    await ctx.hooks(config.prepareByEnv?.[ctx.environment], ctx.root)
  }
  if (!ctx.boolean('skip-build')) {
    if (config.assets) await capacitorAssets(ctx)
    if (config.locales) await locales(ctx)
  }
  for (const platform of targets) {
    const env = ctx.environmentValues({ ...config.environment, ...config.environmentByPlatform?.[platform] }, platform)
    if (!ctx.boolean('skip-build')) {
      const build = config.buildByPlatform?.[platform] ?? config.build
      if (build) await ctx.hooks([build], root, platform, env)
      else await vueBuild(ctx, root, ctx.config.vue?.typecheck ?? 'noEmit', env)
    }
    await ctx.run('cap', [action, platform], { cwd: root, env: { ...androidEnvironment(ctx), ...env }, label: `Capacitor ${action} ${platform}` })
    await ctx.hooks(config.afterSync, root, platform, env)
    await ctx.hooks(config.verify, root, platform, env)
    if (ctx.boolean('open')) await capacitorOpen(ctx, platform)
  }
}
export async function capacitorOpen(ctx: Context, selected?: string) {
  const root = ctx.moduleRoot('capacitor')
  for (const platform of selected ? [selected] : platforms(ctx)) {
    requireValue(platform !== 'ios' || process.platform === 'darwin' || ctx.dryRun, 'Opening Xcode requires macOS')
    await ctx.run('cap', ['open', platform], { cwd: root, env: ctx.environmentValues({ ...ctx.config.capacitor?.environment, ...ctx.config.capacitor?.environmentByPlatform?.[platform as 'android' | 'ios'] }, platform), label: `Open ${platform} IDE` })
  }
}
export async function capacitorPrepare(ctx: Context) {
  const config = ctx.section('capacitor'), root = ctx.moduleRoot('capacitor')
  const targets = platforms(ctx)
  for (const platform of targets) await ctx.guard(root, platform)
  await ctx.hooks(config.prepare, ctx.root); await ctx.hooks(config.prepareByEnv?.[ctx.environment], ctx.root)
  await versions(ctx)
  await capacitorSync(ctx, 'sync', true)
}
async function ready(url: string, ca?: Buffer): Promise<boolean> {
  if (url.startsWith('http:')) return fetch(url, { signal: AbortSignal.timeout(1500) }).then(r => r.ok).catch(() => false)
  return new Promise(resolve => {
    const req = request(url, { ca, timeout: 1500 }, res => { res.resume(); resolve(!!res.statusCode && res.statusCode < 400) })
    req.on('error', () => resolve(false)); req.on('timeout', () => req.destroy()); req.end()
  })
}
export async function capacitorLive(ctx: Context) {
  requireValue(ctx.environment !== 'production', 'Live reload is not permitted for production')
  const config = ctx.section('capacitor'), root = ctx.moduleRoot('capacitor'), targets = platforms(ctx)
  requireValue(targets.length === 1, 'Live reload requires one --platform')
  const platform = targets[0]!, live = config.live
  const host = ctx.string('host', live?.host ?? '127.0.0.1'), port = Number(ctx.string('port', String(live?.port ?? 5173)))
  requireValue(Number.isInteger(port) && port > 0 && port < 65536 && /^[a-zA-Z0-9.-]+$/u.test(host), 'Invalid live-reload host/port')
  const https = ctx.boolean('https') || live?.https === true
  const local = host === 'localhost' || isIP(host) === 4 && /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/u.test(host)
  requireValue(local || https, 'Public live-reload hosts require HTTPS')
  if (!ctx.boolean('skip-sync')) await capacitorSync(ctx)
  const controller = new AbortController(), url = `${https ? 'https' : 'http'}://${host}:${port}`
  let failure: unknown
  const server = ctx.run('vite', ['--host', host, '--port', String(port), '--strictPort'], { cwd: root, signal: controller.signal, label: 'Live-reload Vite server' }).then(() => { if (!ctx.dryRun && !controller.signal.aborted) failure = new Error('Live-reload server exited') }).catch(error => { failure = error })
  try {
    if (!ctx.dryRun) {
      const ca = live?.ca ? await readFile(ctx.path(live.ca)) : undefined
      const deadline = Date.now() + (live?.timeout ?? 60_000)
      while (!(await ready(url, ca))) { if (failure) throw failure; requireValue(Date.now() < deadline, 'Live-reload server readiness timed out'); await delay(200) }
      if (failure) throw failure
    }
    const args = ['run', platform, '--no-sync', '--live-reload', '--host', host, '--port', String(port)]
    if (ctx.flags.device) args.push('--target', ctx.string('device'))
    if (https) args.push('--https')
    if (platform === 'android' && /^(127\.|localhost$)/u.test(host)) args.push('--forwardPorts', `${port}:${port}`)
    await ctx.run('cap', args, { cwd: root, env: { ...androidEnvironment(ctx), ...ctx.environmentValues({ ...config.environment, ...config.environmentByPlatform?.[platform] }, platform) }, label: `Run ${platform} with live reload` })
    // Capacitor exits after installing. Keep the server alive until it is interrupted.
    await server
    if (failure && !controller.signal.aborted) throw failure
  } finally { controller.abort(); await server }
}
