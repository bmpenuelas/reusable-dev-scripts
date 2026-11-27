import { realpathSync } from 'node:fs'
import { glob, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'
import { credentials, isUuid, payload, record, remoteJson, rows } from './remote.js'
import { inside, requireValue } from './runtime.js'
import type { Context } from './context.js'
import type { CloudflareSettings } from './types.js'

type ReleaseAction = 'status' | 'd1-status' | 'promote' | 'rollback'
type ObjectData = Record<string, unknown>
const object = (value: unknown): ObjectData => value && typeof value === 'object' && !Array.isArray(value) ? value as ObjectData : {}
const branchName = /^[\w][\w./-]*$/u
const sameId = (value: unknown, expected: string) => isUuid(value) && value.toLowerCase() === expected.toLowerCase()
const time = (value: unknown) => typeof value === 'string' ? Date.parse(value) : NaN

// Use the same config reader as the local Wrangler, not a second TOML/JSONC parser with different inheritance.
async function workerConfig(ctx: Context, root: string, path: string, env: string | undefined) {
  requireValue((await stat(path).catch(() => undefined))?.isFile(), 'Prepare the selected Wrangler config before checking or changing a release')
  const load = createRequire(join(root, 'package.json'))
  let read: ((args: { config: string; env?: string }, options: { hideWarnings: boolean }) => unknown) | undefined
  try {
    // Node resolves to the physical file, so compare it with the physical root: the project may be reached through a symlink.
    const entry = inside(ctx.root, relative(realpathSync(ctx.root), load.resolve('wrangler')))
    read = load(entry).unstable_readConfig
  } catch { /* No global tool, no emitting module-load details. */ }
  requireValue(typeof read === 'function', 'Install a compatible consumer-local Wrangler with unstable_readConfig')
  try { return record(read({ config: path, ...(env ? { env } : {}) }, { hideWarnings: true })) }
  catch { throw new Error('Could not read the selected Wrangler config and environment') }
}

function workerTraffic(deployment: ObjectData) {
  requireValue(isUuid(deployment.id) && Array.isArray(deployment.versions) && deployment.versions.length > 0, 'Cloudflare returned an invalid Worker deployment')
  const versions = rows(deployment.versions).map(({ version_id, percentage }) => {
    requireValue(isUuid(version_id) && typeof percentage === 'number' && percentage >= 0 && percentage <= 100, 'Cloudflare returned an invalid Worker traffic split')
    return { id: version_id, percentage }
  })
  requireValue(Math.abs(versions.reduce((sum, item) => sum + item.percentage, 0) - 100) < 0.001 &&
    new Set(versions.map(item => item.id.toLowerCase())).size === versions.length, 'Cloudflare returned an invalid Worker traffic split')
  return versions
}

function pagesBranch(deployment: ObjectData) {
  return object(object(deployment.deployment_trigger).metadata).branch
}

function successfulPage(deployment: ObjectData, branch: string, environment: 'preview' | 'production') {
  const stage = object(deployment.latest_stage)
  return deployment.environment === environment && pagesBranch(deployment) === branch && deployment.is_skipped !== true &&
    stage.name === 'deploy' && stage.status === 'success'
}

const notConfirmed = 'Cloudflare did not confirm the requested release is active; run cloudflare status before trying again'
async function confirmRelease(check: () => Promise<boolean>) {
  try {
    for (let i = 0; i < 3; i++) {
      if (i) await pause(250)
      if (await check()) return
    }
  } catch { /* The write already returned; do not obscure the need to inspect state before retrying. */ }
  throw new Error(notConfirmed)
}

export async function cloudflareRelease(ctx: Context, action: ReleaseAction, target: CloudflareSettings, root: string, env: string | undefined, branch: string, fetcher: typeof fetch) {
  const pages = target.kind === 'pages', write = action === 'promote' || action === 'rollback'
  const id = write ? ctx.string(pages ? 'deployment-id' : 'version-id') : ''
  if (pages) {
    requireValue(action === 'status' || action === 'rollback', 'Pages supports status and production rollback; promotion and D1 status require a Worker')
    requireValue(target.projectName && /^[a-z0-9][a-z0-9-]*$/u.test(target.projectName), 'Select a Pages target with a valid projectName')
    requireValue(branchName.test(branch), 'Select a valid Pages branch')
    requireValue(ctx.flags['version-id'] === undefined, 'Pages rollback takes --deployment-id, not --version-id')
  } else {
    requireValue(target.config, 'Select a Worker target with an explicit Wrangler config')
    requireValue(ctx.flags.branch === undefined, '--branch is only for Pages status')
    requireValue(ctx.flags['deployment-id'] === undefined, 'Worker releases take --version-id, not --deployment-id')
    if (action === 'd1-status') requireValue(target.d1Database, 'Select a Worker target with d1Database')
  }
  const configPath = !pages ? inside(root, target.config!) : undefined
  if (write) {
    requireValue(isUuid(id), pages ? 'Pages rollback requires --deployment-id with a deployment UUID' : 'Worker release changes require --version-id with a version UUID')
    requireValue(ctx.dryRun || ctx.boolean('yes'), 'Cloudflare release changes require --yes')
    await ctx.guard()
  }
  const label = pages ? `Pages ${target.projectName} branch ${branch}` : action === 'd1-status' ? `D1 ${target.d1Database}` : `Worker (${env ?? 'top-level'} Wrangler config)`
  if (ctx.dryRun) { ctx.log(`[plan] Cloudflare ${action}: ${label}${write ? ` to ${id}` : ''}; no provider requests`); return }

  const config = configPath ? await workerConfig(ctx, root, configPath, env) : {}
  const secrets = await credentials(ctx, ctx.config.cloudflare?.credentialsFile)
  const token = secrets.CLOUDFLARE_API_TOKEN
  const account = config.account_id ?? target.accountId ?? secrets.CLOUDFLARE_ACCOUNT_ID
  requireValue(token && typeof account === 'string' && /^[a-fA-F0-9]{32}$/u.test(account), 'Set CLOUDFLARE_API_TOKEN and a valid Wrangler account_id, target accountId, or CLOUDFLARE_ACCOUNT_ID')
  const api = (path: string, method = 'GET', body?: unknown) => remoteJson(fetcher, `https://api.cloudflare.com/client/v4/accounts/${account}${path}`, token, method, body)

  if (pages) {
    const name = target.projectName!
    const path = `/pages/projects/${encodeURIComponent(name)}`
    const project = async () => {
      const value = record(payload(await api(path)))
      requireValue(value.name === name && typeof value.production_branch === 'string' && value.production_branch, 'Cloudflare returned an unexpected Pages project')
      return value
    }
    const current = await project()
    if (write) {
      requireValue(current.production_branch === branch, 'The configured Pages branch is not this project’s production branch; preview rollback is not supported')
      const deploymentPath = `${path}/deployments/${id}`
      const selected = record(payload(await api(deploymentPath)))
      requireValue(sameId(selected.id, id) && selected.project_name === name && successfulPage(selected, branch, 'production'), 'Pages rollback requires a successful production deployment of the selected project and branch')
      if (sameId(object(current.canonical_deployment).id, id)) { ctx.log(`[rds] ${label} is already at deployment ${id}`); return }
      await api(`${deploymentPath}/rollback`, 'POST')
      await confirmRelease(async () => {
        const updated = await project()
        return updated.production_branch === branch && sameId(object(updated.canonical_deployment).id, id)
      })
      ctx.log(`[rds] ${label} is at deployment ${id} (application health not checked)`)
    } else {
      let selected: ObjectData | undefined
      if (current.production_branch === branch) {
        if (current.canonical_deployment != null) {
          selected = record(current.canonical_deployment)
          requireValue(successfulPage(selected, branch, 'production'), 'Could not confirm the canonical deployment for the selected Pages branch')
        }
      } else {
        // Preview status is the newest successful deployment for the exact branch, not the newest build attempt.
        for (let page = 1; ; page++) {
          const response = record(await api(`${path}/deployments?env=preview&page=${page}&per_page=25`))
          const deployments = rows(response)
          for (const deployment of deployments) {
            if (!successfulPage(deployment, branch, 'preview')) continue
            const created = time(deployment.created_on)
            requireValue(Number.isFinite(created), 'Cloudflare returned an invalid Pages deployment timestamp')
            if (!selected || created > time(selected.created_on)) selected = deployment
          }
          const total = object(response.result_info).total_pages
          if (typeof total === 'number' ? page >= total : deployments.length < 25) break
          requireValue(page < 10, 'Pages preview history exceeded the search limit; inspect the branch in Cloudflare')
        }
      }
      if (!selected) { ctx.log(`[rds] No successful deployment found for ${label}`); return }
      requireValue(isUuid(selected.id), 'Cloudflare returned an invalid Pages deployment ID')
      ctx.log(`[rds] ${label}: ${current.production_branch === branch ? 'active production' : 'latest successful preview'} deployment ${selected.id} (application health not checked)`)
    }
    return
  }

  if (action === 'd1-status') {
    const effective = typeof config.configPath === 'string' ? inside(root, relative(root, config.configPath)) : configPath!
    await d1Status(ctx, config, dirname(effective), target.d1Database!, api)
    return
  }

  const name = config.name
  requireValue(typeof name === 'string' && /^[a-z0-9][a-z0-9_-]*$/u.test(name) && config.legacy_env !== false, 'An explicit Worker name in a standard Wrangler environment is required')
  const path = `/workers/scripts/${encodeURIComponent(name)}`
  const history = async () => rows(record(payload(await api(`${path}/deployments`))).deployments)
  const deployments = await history(), active = deployments[0]
  if (action === 'status') {
    if (!active) { ctx.log(`[rds] No deployments found for Worker ${name}`); return }
    const versions = workerTraffic(active)
    ctx.log(`[rds] Worker ${name} deployment ${active.id}: ${versions.map(item => `${item.id} at ${item.percentage}%`).join(', ')} (application health not checked)`)
    return
  }

  const fullyActive = (item: ObjectData) => { const traffic = workerTraffic(item); return traffic.length === 1 && sameId(traffic[0]!.id, id) && traffic[0]!.percentage === 100 }
  if (active && fullyActive(active)) { ctx.log(`[rds] Worker ${name} is already at version ${id} (100%)`); return }
  if (action === 'rollback') requireValue(deployments.some(item => workerTraffic(item).some(version => sameId(version.id, id) && version.percentage > 0)), 'Worker rollback requires a version that served traffic in the returned deployment history')
  else requireValue(sameId(record(payload(await api(`${path}/versions/${id}`))).id, id), 'Cloudflare did not confirm the version for the selected Worker')
  // Do not use Wrangler versions deploy (may also sync non-versioned settings) or set the API's force flag.
  const result = record(payload(await api(`${path}/deployments`, 'POST', {
    strategy: 'percentage', versions: [{ version_id: id, percentage: 100 }],
    annotations: { 'workers/message': action === 'rollback' ? 'RDS rollback' : 'RDS promotion' },
  })))
  const deploymentId = result.id
  requireValue(isUuid(deploymentId) && fullyActive(result), notConfirmed)
  await confirmRelease(async () => {
    const [latest] = await history()
    return !!latest && sameId(latest.id, deploymentId) && fullyActive(latest)
  })
  ctx.log(`[rds] Worker ${name} deployment ${deploymentId}: version ${id} at 100% (application health not checked)`)
}

async function d1Status(ctx: Context, config: ObjectData, project: string, database: string, api: (path: string, method?: string, body?: unknown) => Promise<unknown>) {
  const matches = rows(config.d1_databases ?? []).filter(item => item.database_name === database || item.binding === database)
  const binding = matches[0]
  requireValue(matches.length === 1 && binding && isUuid(binding.database_id) && !binding.database_internal_env, 'D1 status requires one matching Wrangler binding with an explicit remote database_id')
  const dir = inside(project, typeof binding.migrations_dir === 'string' ? binding.migrations_dir : 'migrations')
  requireValue((await stat(dir).catch(() => undefined))?.isDirectory(), 'The configured D1 migrations directory does not exist')
  const localDir = relative(project, dir).split('\\').join('/')
  const configuredPattern = binding.migrations_pattern
  let pattern = '*.sql'
  if (configuredPattern !== undefined) {
    requireValue(typeof configuredPattern === 'string' && typeof binding.migrations_dir === 'string', 'D1 migrations_pattern needs an explicit migrations_dir')
    const normalized = configuredPattern.replaceAll('\\', '/').replace(/^\.\//u, '')
    const prefix = localDir ? `${localDir}/` : ''
    requireValue(normalized.startsWith(prefix), 'D1 migrations_pattern must be under migrations_dir')
    pattern = normalized.slice(prefix.length)
    requireValue(pattern && !isAbsolute(pattern) && !/[:\x00-\x1f]/u.test(pattern) && !pattern.split('/').includes('..') && !pattern.startsWith('!'), 'Invalid D1 migrations_pattern')
  }
  const files = new Set<string>()
  for await (const entry of glob(pattern, { cwd: dir, withFileTypes: true })) {
    if (!entry.isFile()) continue
    const file = relative(dir, inside(dir, relative(dir, join(entry.parentPath, entry.name)))).split('\\').join('/')
    if (file.endsWith('.sql')) files.add(file)
  }
  const table = binding.migrations_table || 'd1_migrations'
  requireValue(typeof table === 'string' && !/[\x00-\x1f]/u.test(table), 'Invalid D1 migrations table name')
  // Wrangler's migrations list may initialize the table. Only these fixed SELECTs are sent, with the name parameterized/quoted.
  const path = `/d1/database/${binding.database_id}/query`
  const select = async (sql: string, params?: string[]) => {
    const statements = rows(await api(path, 'POST', { sql, ...(params ? { params } : {}) }))
    requireValue(statements.length === 1 && statements[0]!.success === true, 'Cloudflare did not confirm the read-only D1 query')
    return rows(statements[0]!.results)
  }
  const schema = await select("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = ? COLLATE NOCASE", [table])
  const applied = schema.length ? await select(`SELECT name FROM "${table.replaceAll('"', '""')}"`) : []
  requireValue(applied.every(row => typeof row.name === 'string'), 'Cloudflare returned invalid D1 migration history')
  const names = new Set(applied.map(row => row.name))
  const pending = [...files].filter(file => !names.has(file)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
  ctx.log(`[rds] D1 ${database}: ${pending.length} pending migration(s)${schema.length ? '' : ' (migration table not yet created)'}`)
  for (const file of pending) ctx.log(`[rds]   ${JSON.stringify(file)}`)
}
