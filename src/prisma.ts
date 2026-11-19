import { existsSync, readFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { parseEnv } from 'node:util'
import { requireValue } from './runtime.js'
import type { Context } from './context.js'

/** Applies or inspects Prisma migrations using a database URL from a generated environment file. */
export async function prisma(ctx: Context, action: string) {
  const config = ctx.section('prisma'), root = ctx.moduleRoot('prisma')
  requireValue(typeof config.envFile === 'string' && config.envFile.length > 0, 'Configure prisma.envFile first')
  ctx.requireEnvironment('prisma commands')
  const variable = config.variable ?? 'DATABASE_URL', envFile = ctx.path(config.envFile.replaceAll('{env}', ctx.environment))
  requireValue(existsSync(envFile), `Missing ${config.envFile.replaceAll('{env}', ctx.environment)}; generate the environment files first`)
  const url = parseEnv(readFileSync(envFile, 'utf8'))[variable]
  requireValue(url, `${variable} is not set in the environment file`)
  const host = URL.canParse(url) ? new URL(url).hostname : ''
  requireValue(host, `${variable} is not a valid URL`)
  const migrate = action === 'migrate'
  if (migrate) {
    await ctx.guard(root)
    if ((ctx.config.production?.environments ?? ['production']).includes(ctx.environment) && !ctx.dryRun) await confirmHost(ctx, host)
  }
  await ctx.run('prisma', ['migrate', migrate ? 'deploy' : 'status'], { cwd: root, env: { [variable]: url }, label: `Prisma migrate ${migrate ? 'deploy' : 'status'} (${ctx.environment}, host ${host})` })
}

// A protected database is only changed after the operator types its host, so the wrong environment file cannot slip through.
async function confirmHost(ctx: Context, host: string) {
  const given = ctx.string('confirm-host')
  if (given) { requireValue(given === host, `--confirm-host does not match the database host ${host}`); return }
  requireValue(process.stdin.isTTY, `Confirm by passing --confirm-host ${host} when there is no terminal`)
  const terminal = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await terminal.question(`Apply migrations to the ${ctx.environment} database at ${host}? Type the host to confirm: `)
  terminal.close()
  requireValue(answer.trim() === host, 'Not confirmed; nothing was changed')
}
