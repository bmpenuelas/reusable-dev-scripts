import { existsSync, readFileSync } from 'node:fs'
import { connect } from 'node:net'
import { setTimeout as pause } from 'node:timers/promises'
import { parseEnv } from 'node:util'
import { requireValue } from './runtime.js'
import type { Context } from './context.js'
import type { WaitTarget } from './types.js'

const defaultPorts: Record<string, number> = { 'http:': 80, 'https:': 443, 'mysql:': 3306, 'mariadb:': 3306, 'postgres:': 5432, 'postgresql:': 5432, 'redis:': 6379, 'rediss:': 6379, 'mongodb:': 27017, 'amqp:': 5672 }

function targetUrl(ctx: Context, target: WaitTarget): string | undefined {
  let url = target.url
  if (!url && target.variable) {
    url = process.env[target.variable]
    if (!url && target.envFile) {
      const file = ctx.path(target.envFile)
      if (existsSync(file)) url = parseEnv(readFileSync(file, 'utf8'))[target.variable]
    }
    requireValue(url, `${target.variable} is not set${target.envFile ? ` in the environment or ${target.envFile}` : ''}`)
  }
  return url
}
function endpoint(ctx: Context, target: WaitTarget): { host: string; port: number } {
  const url = targetUrl(ctx, target)
  if (url) {
    const parsed = URL.canParse(url) ? new URL(url) : undefined
    requireValue(parsed, 'The wait target URL is not valid')
    const port = parsed.port ? Number(parsed.port) : defaultPorts[parsed.protocol]
    requireValue(parsed.hostname && port, 'The wait target URL needs a host and a port')
    return { host: parsed.hostname.replace(/^\[|\]$/gu, ''), port }
  }
  requireValue(target.host && target.port, 'A wait target needs host and port, a url, or a variable')
  return { host: target.host, port: target.port }
}
const attempt = (host: string, port: number) => new Promise<boolean>(done => {
  const socket = connect({ host, port })
  socket.setTimeout(2000)
  socket.once('connect', () => { socket.destroy(); done(true) })
  socket.once('timeout', () => { socket.destroy(); done(false) })
  socket.once('error', () => done(false))
})

/** Blocks until a TCP endpoint accepts connections. Only host and port are ever printed, never the URL. */
function selectWaitTarget(ctx: Context) {
  const targets = ctx.section('wait').targets
  requireValue(targets && typeof targets === 'object', 'Configure wait targets')
  const names = Object.keys(targets), name = ctx.string('target', names.length === 1 ? names[0]! : '')
  const target = Object.hasOwn(targets, name) ? targets[name] : undefined
  requireValue(target, 'Select a configured wait target with --target')
  const seconds = Number(ctx.string('timeout', String(target.timeout ?? 90)))
  requireValue(Number.isFinite(seconds) && seconds > 0, '--timeout must be a positive number of seconds')
  return { name, target, seconds }
}

export async function waitTcp(ctx: Context) {
  const { name, target, seconds } = selectWaitTarget(ctx)
  if (ctx.dryRun) { ctx.log(`[plan] Wait for TCP target ${name} (up to ${seconds}s)`); return }
  const { host, port } = endpoint(ctx, target), deadline = Date.now() + seconds * 1000
  ctx.log(`[rds] Waiting for ${host}:${port} (up to ${seconds}s)`)
  while (!(await attempt(host, port))) {
    requireValue(Date.now() <= deadline, `${host}:${port} is not reachable.${target.hint ? ` ${target.hint}` : ''}`)
    await new Promise(resume => setTimeout(resume, 1000))
  }
  ctx.log(`[rds] ${host}:${port} is reachable`)
}

/** Checks the status and optional release header, not the body. The request has no credentials or redirect hops. */
export async function waitHttp(ctx: Context, fetcher: typeof fetch = fetch) {
  const { name, target, seconds } = selectWaitTarget(ctx)
  requireValue(target.url || target.variable, 'An HTTP wait target needs a URL or URL variable')
  requireValue(seconds <= 2147483, 'HTTP wait timeout is too large')
  const status = target.status ?? 200
  const label = `HTTP target ${JSON.stringify(name)} (expecting ${status}${target.marker ? ' and the configured response marker' : ''}, up to ${seconds}s)`
  if (ctx.dryRun) { ctx.log(`[plan] Wait for ${label}`); return }
  const value = targetUrl(ctx, target)
  const url = value && URL.canParse(value) ? new URL(value) : undefined
  requireValue(url && ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.hash, 'HTTP wait URL must use HTTP(S) without user credentials or a fragment')
  requireValue(url.protocol !== 'https:' || process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0', 'HTTP wait refuses to run with TLS verification disabled')
  const deadline = performance.now() + seconds * 1000
  ctx.log(`[rds] Waiting for ${label}`)
  let failure = 'no HTTP response'
  for (let remaining = deadline - performance.now(); remaining > 0; remaining = deadline - performance.now()) {
    try {
      const response = await fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(Math.max(1, Math.ceil(Math.min(remaining, 5000)))) })
      // Neither consume the body nor let cancellation delay the overall deadline.
      void response.body?.cancel().catch(() => {})
      if (response.status !== status) failure = `last response was HTTP ${response.status}`
      else if (target.marker && response.headers.get(target.marker.header) !== target.marker.value) failure = 'response marker did not match'
      else if (performance.now() <= deadline) { ctx.log(`[rds] HTTP target ${JSON.stringify(name)} is ready`); return }
      else failure = 'matching response arrived after the deadline'
    } catch { failure = 'request failed or timed out' }
    const delay = Math.min(1000, deadline - performance.now())
    if (delay > 0) await pause(delay)
  }
  throw new Error(`HTTP target ${JSON.stringify(name)} is not ready: ${failure}.${target.hint ? ` ${target.hint}` : ''}`)
}
