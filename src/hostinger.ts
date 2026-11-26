import { stat } from 'node:fs/promises'
import { credentials, environmentFile, isUuid, payload, record, remoteJson, rows } from './remote.js'
import { requireValue } from './runtime.js'
import type { Context } from './context.js'

/** Hostinger Web/Cloud hosting. Website/plan selection is explicit; never buys a plan or deletes data. */
export async function hostinger(ctx: Context, action: string, fetcher: typeof fetch = fetch) {
  ctx.requireEnvironment('Hostinger commands', { implicit: true })
  const config = ctx.section('hostinger'), names = Object.keys(config.targets)
  const name = ctx.string('target', names.length === 1 ? names[0]! : '')
  const base = Object.hasOwn(config.targets, name) ? config.targets[name] : undefined
  requireValue(base, 'Select a configured Hostinger target with --target')
  const target = { ...base, ...base.environments?.[ctx.environment] }
  requireValue(target.domain && /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9-]+$/u.test(target.domain), 'Configure a valid Hostinger target domain')
  requireValue(target.username && /^[a-zA-Z0-9_]+$/u.test(target.username), 'Configure the Hostinger account username')
  const account = `https://developers.hostinger.com/api/hosting/v1/accounts/${encodeURIComponent(target.username)}`
  const website = `${account}/websites/${encodeURIComponent(target.domain)}`
  if (action === 'status') {
    const requested = ctx.string('build-id')
    requireValue(!requested || isUuid(requested), '--build-id must be a build UUID')
    if (ctx.dryRun) { ctx.log(`[plan] Read ${requested ? `build ${requested}` : 'latest Node.js build'} for ${target.domain}; no provider requests`); return }
    const token = (await credentials(ctx, config.credentialsFile)).HOSTINGER_API_TOKEN
    requireValue(token, 'Set HOSTINGER_API_TOKEN in the shell or credentialsFile')
    const builds = `${website}/nodejs/builds`
    const response = await remoteJson(fetcher, requested ? `${builds}/${requested}` : `${builds}?page=1&per_page=1`, token)
    const build = requested ? record(payload(response)) : rows(response)[0]
    if (!build) { ctx.log(`[rds] No Node.js builds found for ${target.domain}`); return }
    requireValue(isUuid(build.uuid) && (!requested || build.uuid.toLowerCase() === requested.toLowerCase()) &&
      typeof build.state === 'string' && ['pending', 'running', 'completed', 'failed'].includes(build.state), 'Hostinger returned an unexpected build status')
    ctx.log(`[rds] Hostinger ${target.domain}: build ${build.uuid} is ${build.state} (application health not checked)`)
    return
  }
  requireValue(ctx.dryRun || ctx.boolean('yes'), 'Hostinger operations require --yes (deployment replaces website contents)')
  requireValue(target.envFile, 'Configure the complete backend envFile')
  const envFile = target.envFile.replaceAll('{env}', ctx.environment)
  const directory = ctx.path((target.directory ?? '.').replaceAll('{env}', ctx.environment))
  if (action === 'deploy' && !ctx.dryRun) {
    requireValue((await stat(directory)).isDirectory(), 'Hostinger directory must be a directory')
    requireValue((await stat(ctx.path(`${target.directory ?? '.'}/package.json`.replaceAll('{env}', ctx.environment)))).isFile(), 'Hostinger directory needs package.json')
  }
  await ctx.guard()
  ctx.log(`${ctx.dryRun ? '[plan]' : '[rds]'} Hostinger ${action}: ${target.domain}`)
  if (ctx.dryRun) {
    ctx.log(action === 'setup' ? '[plan] Ensure named database and cron; never delete existing resources' : '[plan] Replace backend variables from envFile; upload and wait for the Node build')
    return
  }
  const secrets = await credentials(ctx, config.credentialsFile)
  const token = secrets.HOSTINGER_API_TOKEN
  requireValue(token, 'Set HOSTINGER_API_TOKEN in the shell or credentialsFile')
  const values = await environmentFile(ctx, envFile, target.excludeEnv ?? [])
  const api = (path: string, method = 'GET', body?: unknown) => remoteJson(fetcher, path, token, method, body)
  if (action === 'setup') {
    if (target.databaseVariable) {
      const value = values[target.databaseVariable]
      requireValue(value && URL.canParse(value), 'Database variable must contain a valid MySQL URL')
      const url = new URL(value), dbName = url.pathname.slice(1), user = decodeURIComponent(url.username)
      requireValue(['mysql:', 'mariadb:'].includes(url.protocol) && url.hostname === '127.0.0.1' && ['3306', ''].includes(url.port), 'Hostinger database setup needs its server-local MySQL URL (127.0.0.1:3306)')
      requireValue([dbName, user].every(x => /^[a-zA-Z0-9_]+$/u.test(x) && x.startsWith(`${target.username}_`)) && url.password, 'Use full account-prefixed database/user names and a password')
      // Hostinger rejects longer names with HTTP 422 (full name includes the account prefix).
      requireValue(dbName.length <= 25 && user.length <= 25, 'Hostinger database name and user must be at most 25 characters including the account prefix')
      const databases = rows(await api(`${account}/databases?search=${encodeURIComponent(dbName)}&per_page=100`))
      const existing = databases.find(row => row.name === dbName)
      if (existing) {
        requireValue(existing.user === undefined || existing.user === user, 'Existing database belongs to another user; reconcile it manually')
        ctx.log('[rds] Database exists; password and data left unchanged')
      } else {
        await api(`${account}/databases`, 'POST', { name: dbName, user, password: decodeURIComponent(url.password), website_domain: target.domain })
        ctx.log('[rds] Database created')
      }
    }
    if (target.cron) {
      const { command, schedule } = target.cron
      requireValue(command.length <= 255 && !/[\r\n%]/u.test(command), 'Hostinger cron commands must be <=255 characters with no percent/newline')
      requireValue(schedule.trim().split(/\s+/u).length === 5 && !/[\r\n]/u.test(schedule), 'Cron schedule must have five fields')
      const jobs = rows(await api(`${account}/cron-jobs`))
      const existing = jobs.find(row => row.command === command)
      if (existing) {
        requireValue(existing.time === schedule, 'Existing cron has a different schedule; reconcile it manually')
        ctx.log('[rds] Cron already configured')
      } else {
        await api(`${account}/cron-jobs`, 'POST', { command, time: schedule })
        ctx.log('[rds] Cron created')
      }
    }
    return
  }
  requireValue(action === 'deploy', 'Unknown Hostinger operation')
  // Hostinger rejects empty strings. Full replacement removes omitted keys instead of retaining stale values.
  const envVars = Object.entries(values).filter(([, value]) => value !== '').map(([key, value]) => ({ key, value }))
  requireValue(envVars.length > 0 && envVars.length <= 1000, 'Hostinger environment needs 1-1000 nonempty variables; refusing an empty replacement')
  requireValue(envVars.every(({ key }) => key.length <= 255 && /^[A-Z_][A-Z0-9_]*$/u.test(key)), 'Hostinger environment keys must be uppercase variable names of at most 255 characters')
  requireValue(envVars.every(({ value }) => [...value].length <= 8192), 'Hostinger environment values must be at most 8192 characters (values not shown)')
  // Fail before restarting the live app if the external upload CLI is absent or too old.
  const help = await ctx.run('hostinger', ['up', '--help'], { capture: true, label: 'Check Hostinger CLI installation' })
  requireValue(['--entry-file', '--source', '--no-wait', '--output-directory', '--root-directory'].every(flag => help.stdout.includes(flag)), 'Install a current Hostinger CLI with the up command before deploying')
  // The official CLI omits .env from its archive. Replace with the complete desired set before building.
  ctx.log('[rds] Replace Hostinger backend environment (empty values omitted)')
  try {
    await api(`${website}/nodejs/builds/settings/env`, 'PUT', { env_vars: envVars })
  } catch (error) {
    // remoteJson errors are sanitized; never include the provider body or environment values.
    throw new Error(`Hostinger environment sync failed: ${(error as Error).message}`)
  }
  const result = await ctx.run('hostinger', [
    'up', directory, '--domain', target.domain, '--source', 'upload', '--type', 'nodejs',
    '--app-type', 'other', '--entry-file', target.entryFile ?? 'dist/main.js',
    '--build-script', target.buildScript ?? 'build', '--node-version', String(target.nodeVersion ?? 24),
    '--package-manager', 'npm', '--root-directory', '.', '--output-directory', '.',
    '--yes', '--no-input', '--format', 'json',
  ], { cwd: ctx.root, env: { HOSTINGER_API_TOKEN: token, HOSTINGER_NONINTERACTIVE: '1' }, capture: true, timeout: 20 * 60_000, label: 'Upload Hostinger app and wait for build' })
  // Do not echo CLI output: provider diagnostics may contain environment values or signed upload URLs.
  let outcome: Record<string, unknown>
  try { outcome = record(JSON.parse(result.stdout)) } catch { throw new Error('Hostinger CLI did not return a valid deployment result') }
  requireValue(!outcome.error && outcome.success !== false, 'Hostinger deployment failed; inspect build logs in hPanel')
  const data = record(outcome.data ?? payload(outcome))
  requireValue(data.buildState === 'completed', 'Hostinger build did not report completion; inspect build logs in hPanel')
  ctx.log('[rds] Hostinger build completed; run application smoke checks')
}
