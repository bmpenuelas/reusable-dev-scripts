import { existsSync, readFileSync } from 'node:fs'
import { connect } from 'node:net'
import { parseEnv } from 'node:util'
import { requireValue } from './runtime.js'
import type { Context } from './context.js'
import type { WaitTarget } from './types.js'

const defaultPorts: Record<string, number> = { 'http:': 80, 'https:': 443, 'mysql:': 3306, 'mariadb:': 3306, 'postgres:': 5432, 'postgresql:': 5432, 'redis:': 6379, 'rediss:': 6379, 'mongodb:': 27017, 'amqp:': 5672 }

function endpoint(ctx: Context, target: WaitTarget): { host: string; port: number } {
  let url = target.url
  if (!url && target.variable) {
    url = process.env[target.variable]
    if (!url && target.envFile) {
      const file = ctx.path(target.envFile)
      if (existsSync(file)) url = parseEnv(readFileSync(file, 'utf8'))[target.variable]
    }
    requireValue(url, `${target.variable} is not set${target.envFile ? ` in the environment or ${target.envFile}` : ''}`)
  }
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
export async function waitTcp(ctx: Context) {
  const targets = ctx.section('wait').targets
  requireValue(targets && typeof targets === 'object', 'Configure wait targets')
  const names = Object.keys(targets), name = ctx.string('target', names.length === 1 ? names[0]! : '')
  const target = Object.hasOwn(targets, name) ? targets[name] : undefined
  requireValue(target, 'Select a configured wait target with --target')
  const seconds = Number(ctx.string('timeout', String(target.timeout ?? 90)))
  requireValue(Number.isFinite(seconds) && seconds > 0, '--timeout must be a positive number of seconds')
  if (ctx.dryRun) { ctx.log(`[plan] Wait for TCP target ${name} (up to ${seconds}s)`); return }
  const { host, port } = endpoint(ctx, target), deadline = Date.now() + seconds * 1000
  ctx.log(`[rds] Waiting for ${host}:${port} (up to ${seconds}s)`)
  while (!(await attempt(host, port))) {
    requireValue(Date.now() <= deadline, `${host}:${port} is not reachable.${target.hint ? ` ${target.hint}` : ''}`)
    await new Promise(resume => setTimeout(resume, 1000))
  }
  ctx.log(`[rds] ${host}:${port} is reachable`)
}
