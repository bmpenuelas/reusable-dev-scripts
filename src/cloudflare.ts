import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { inside, requireValue } from './runtime.js'
import { parseSecretEnv } from './secret-env.js'
import type { Context } from './context.js'
import type { SecretsModule } from './types.js'
import { credentials, payload, record, remoteJson, rows } from './remote.js'
import { cloudflareRelease } from './cloudflare-releases.js'

const api = 'https://api.cloudflare.com/client/v4'
type Fetcher = typeof fetch
const zonePath = (zone: string, path: string) => `${api}/zones/${zone}${path}`
const text = (value: unknown) => (typeof value === 'string' ? value : '')

/** A proxied CNAME for `host`. An existing record that already points elsewhere is never re-pointed. */
async function ensureCname(fetcher: Fetcher, token: string, zone: string, host: string, content: string): Promise<'created' | 'current' | 'updated'> {
  const found = rows(await remoteJson(fetcher, zonePath(zone, `/dns_records?name=${encodeURIComponent(host)}`), token))
  const body = { type: 'CNAME', name: host, content, ttl: 1, proxied: true }
  if (!found.length) { await remoteJson(fetcher, zonePath(zone, '/dns_records'), token, 'POST', body); return 'created' }
  const [existing] = found
  requireValue(found.length === 1 && existing!.type === 'CNAME' && text(existing!.content).toLowerCase() === content.toLowerCase(), 'A DNS record already exists for a configured domain and does not point at the Pages project; change or remove it yourself, then re-run')
  if (existing!.proxied === true) return 'current'
  await remoteJson(fetcher, zonePath(zone, `/dns_records/${encodeURIComponent(text(existing!.id))}`), token, 'PATCH', body)
  return 'updated'
}

/** www.<apex> becomes a proxied CNAME to the apex plus a Single Redirect rule that keeps path and query. Other rules are left alone. */
async function ensureWwwRedirect(fetcher: Fetcher, token: string, zone: string, domain: string, ref: string, log: (message: string) => void) {
  const apex = text(record(payload(await remoteJson(fetcher, zonePath(zone, ''), token))).name).toLowerCase()
  requireValue(apex.length > 0, 'Unexpected provider response for the zone')
  if (domain.toLowerCase() !== apex) { log('[rds] www redirect skipped: the domain is not the zone apex'); return }
  const www = `www.${apex}`
  const existing = rows(await remoteJson(fetcher, zonePath(zone, `/dns_records?name=${encodeURIComponent(www)}`), token))
  if (!existing.length) await remoteJson(fetcher, zonePath(zone, '/dns_records'), token, 'POST', { type: 'CNAME', name: www, content: apex, ttl: 1, proxied: true })
  else requireValue(existing.length === 1 && existing[0]!.type === 'CNAME' && text(existing[0]!.content).toLowerCase() === apex && existing[0]!.proxied === true, 'www already has DNS records; remove them or make them one proxied CNAME to the apex, then re-run')
  const rule = {
    ref, description: `${www} to ${apex}`, expression: `(http.host eq "${www}")`, action: 'redirect', enabled: true,
    action_parameters: { from_value: { status_code: 301, target_url: { expression: `concat("https://${apex}", http.request.uri.path)` }, preserve_query_string: true } },
  }
  const phase = zonePath(zone, '/rulesets/phases/http_request_dynamic_redirect/entrypoint')
  const ruleset = await remoteJson(fetcher, phase, token, 'GET', undefined, true)
  if (!ruleset) { await remoteJson(fetcher, phase, token, 'PUT', { rules: [rule] }); log('[rds] www redirect rule created'); return }
  const set = record(payload(ruleset)), current = (Array.isArray(set.rules) ? set.rules : []).map(record).find(item => item.ref === ref)
  const same = current && current.expression === rule.expression && current.enabled === true && JSON.stringify(current.action_parameters) === JSON.stringify(rule.action_parameters)
  if (same) log('[rds] www redirect rule already configured')
  else if (current) { await remoteJson(fetcher, zonePath(zone, `/rulesets/${encodeURIComponent(text(set.id))}/rules/${encodeURIComponent(text(current.id))}`), token, 'PATCH', rule); log('[rds] www redirect rule updated') }
  else { await remoteJson(fetcher, zonePath(zone, `/rulesets/${encodeURIComponent(text(set.id))}/rules`), token, 'POST', rule); log('[rds] www redirect rule created') }
}

/**
 * Reads the secrets file strictly (JSON object or NAME=value lines), lets the project's `secretsModule` apply its own rules and
 * derive values, then keeps exactly the allowlisted names. Nothing here logs a value.
 */
async function loadSecrets(ctx: Context, target: string, names: string[], file: string, modulePath: string | undefined): Promise<Record<string, string>> {
  const content = await readFile(file, 'utf8')
  let parsed: Record<string, unknown>
  if (file.endsWith('.json')) {
    const json: unknown = JSON.parse(content)
    requireValue(json !== null && typeof json === 'object' && !Array.isArray(json), 'The secrets JSON file must contain an object')
    parsed = json as Record<string, unknown>
  } else parsed = parseSecretEnv(content)
  const values = Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  let final: Record<string, string> = values
  if (modulePath) {
    const loaded = await import(pathToFileURL(ctx.path(modulePath)).href) as Partial<SecretsModule> & { default?: Partial<SecretsModule> }
    const module = typeof loaded.secrets === 'function' ? loaded : loaded.default ?? loaded
    requireValue(typeof module.secrets === 'function', 'The secrets module must export a secrets(input) function')
    const result: unknown = await module.secrets({ environment: ctx.environment, target, file, root: ctx.root, values: Object.freeze({ ...values }) })
    requireValue(result !== null && typeof result === 'object' && !Array.isArray(result), 'The secrets module must return an object of name/value strings')
    final = result as Record<string, string>
  }
  const selected: Record<string, string> = {}
  for (const name of names) {
    requireValue(Object.hasOwn(final, name) && typeof final[name] === 'string' && final[name].length > 0, `Required secret is missing or empty: ${name}`)
    selected[name] = final[name]
  }
  return selected
}

export async function cloudflare(ctx: Context, action: string, fetcher: typeof fetch = fetch) {
  ctx.requireEnvironment('Cloudflare commands', { implicit: action !== 'promote' && action !== 'rollback' })
  const targets = ctx.section('cloudflare').targets
  requireValue(targets && typeof targets === 'object', 'Configure Cloudflare targets')
  const names = Object.keys(targets), name = ctx.string('target', names.length === 1 ? names[0]! : '')
  const base = Object.hasOwn(targets, name) ? targets[name] : undefined
  requireValue(base, 'Select a configured Cloudflare target with --target')
  const target = { ...base, ...base.environments?.[ctx.environment] }
  const root = ctx.path(target.root ?? '.')
  requireValue(['worker', 'pages'].includes(target.kind), 'Cloudflare target kind must be worker or pages')
  const wranglerEnv = target.wranglerEnv === false || (target.wranglerEnv === undefined && ctx.implicitEnvironment) ? undefined : target.wranglerEnv ?? ctx.environment
  const branch = ctx.string('branch', target.branch ?? (ctx.environment === 'production' || ctx.implicitEnvironment ? 'main' : ctx.environment))
  if (action === 'status' || action === 'd1-status' || action === 'promote' || action === 'rollback') {
    await cloudflareRelease(ctx, action, target, root, wranglerEnv, branch, fetcher)
    return
  }
  if (action === 'setup-pages') {
    requireValue(target.kind === 'pages' && target.projectName && /^[a-z0-9][a-z0-9-]*$/u.test(target.projectName), 'Select a Pages target with a valid projectName')
    requireValue(ctx.dryRun || ctx.boolean('yes'), 'Pages resource creation requires --yes')
    await ctx.guard(root)
    if (ctx.dryRun) { ctx.log('[plan] Ensure Pages project and configured custom domains; no provider requests'); return }
    const secrets = await credentials(ctx, ctx.config.cloudflare?.credentialsFile)
    const token = secrets.CLOUDFLARE_API_TOKEN, account = target.accountId ?? secrets.CLOUDFLARE_ACCOUNT_ID
    requireValue(token && account && /^[a-fA-F0-9]{32}$/u.test(account), 'Set CLOUDFLARE_API_TOKEN and a valid target accountId or CLOUDFLARE_ACCOUNT_ID')
    const collection = `https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects`
    const projectPath = `${collection}/${encodeURIComponent(target.projectName)}`
    let project = await remoteJson(fetcher, projectPath, token, 'GET', undefined, true)
    if (!project) project = await remoteJson(fetcher, collection, token, 'POST', { name: target.projectName, production_branch: 'main' })
    const details = record(payload(project))
    requireValue(details.production_branch === 'main' && !details.source, 'Existing Pages project must be Direct Upload with production branch main; it was not changed')
    for (const domain of target.domains ?? []) {
      requireValue(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9-]+$/u.test(domain), 'Pages domains must be plain hostnames')
      const domainPath = `${projectPath}/domains/${encodeURIComponent(domain)}`
      if (!await remoteJson(fetcher, domainPath, token, 'GET', undefined, true)) await remoteJson(fetcher, `${projectPath}/domains`, token, 'POST', { name: domain })
    }
    if (target.zoneId) {
      requireValue(/^[a-fA-F0-9]{32}$/u.test(target.zoneId), 'zoneId must be a 32-character hexadecimal zone ID')
      for (const domain of target.domains ?? []) ctx.log(`[rds] DNS record for ${domain}: ${await ensureCname(fetcher, token, target.zoneId, domain, `${target.projectName}.pages.dev`)}`)
    }
    if (target.wwwRedirect) {
      requireValue(target.zoneId && target.domains?.length === 1, 'wwwRedirect needs zoneId and exactly one domain (the zone apex)')
      await ensureWwwRedirect(fetcher, token, target.zoneId, target.domains[0]!, target.redirectRef ?? 'rds_www_redirect', ctx.log)
    }
    ctx.log(`[rds] Pages project ready: ${target.projectName}; ${target.zoneId ? 'DNS records are managed here, certificate activation can still take a while' : 'custom domains still need DNS/certificate validation'}`)
    return
  }
  if (action === 'deploy-pages') requireValue(target.kind === 'pages' && target.projectName && target.directory, 'Select a Pages target with projectName and directory')
  else requireValue(target.kind === 'worker' && target.config, 'Select a Worker target with an explicit Wrangler config')
  if (action === 'migrate-d1') requireValue(target.d1Database, 'Select a Worker target with d1Database')
  let secretValues: Record<string, string> | undefined
  // The guard comes first so secrets are not even read for an operation that is not permitted.
  await ctx.guard(root)
  if (action === 'push-secrets') {
    requireValue(target.secretsFile && target.secretNames?.length, 'Secret upload needs an explicit file and allowlist')
    requireValue(target.secretNames.every(name => /^[A-Z][A-Z0-9_]*$/u.test(name)), 'Invalid secret name')
    if (!ctx.dryRun) {
      const file = ctx.path(ctx.string('secrets-file', target.secretsFile))
      secretValues = await loadSecrets(ctx, name, target.secretNames, file, target.secretsModule)
    }
  }
  await ctx.hooks(target.prepare, ctx.root)
  const secrets = !ctx.dryRun && ctx.config.cloudflare?.credentialsFile ? await credentials(ctx, ctx.config.cloudflare.credentialsFile) : {}
  const providerEnv = { ...(secrets.CLOUDFLARE_API_TOKEN ? { CLOUDFLARE_API_TOKEN: secrets.CLOUDFLARE_API_TOKEN } : {}), ...(target.accountId || secrets.CLOUDFLARE_ACCOUNT_ID ? { CLOUDFLARE_ACCOUNT_ID: target.accountId ?? secrets.CLOUDFLARE_ACCOUNT_ID } : {}) }
  if (action === 'deploy-pages') await ctx.run('wrangler', ['pages', 'deploy', inside(root, target.directory!), '--project-name', target.projectName!, '--branch', branch, ...(target.commitDirty ? ['--commit-dirty=true'] : [])], { cwd: root, env: providerEnv, label: 'Deploy Pages target' })
  else {
    const shared = ['--config', inside(root, target.config!), ...(wranglerEnv ? ['--env', wranglerEnv] : [])]
    if (action === 'push-secrets') await ctx.run('wrangler', ['secret', 'bulk', ...shared], { cwd: root, env: providerEnv, input: JSON.stringify(secretValues ?? {}), label: 'Upload allowlisted Worker secrets' })
    else if (action === 'migrate-d1') await ctx.run('wrangler', ['d1', 'migrations', 'apply', target.d1Database!, '--remote', ...shared], { cwd: root, env: providerEnv, label: 'Apply remote D1 migrations' })
    else await ctx.run('wrangler', ['deploy', ...shared], { cwd: root, env: providerEnv, label: 'Deploy Worker target' })
  }
}
