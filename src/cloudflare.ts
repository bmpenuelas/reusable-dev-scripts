import { readFile } from 'node:fs/promises'
import { parseEnv } from 'node:util'
import { inside, requireValue } from './runtime.js'
import type { Context } from './context.js'
import { credentials, payload, record, remoteJson } from './remote.js'

export async function cloudflare(ctx: Context, action: string, fetcher: typeof fetch = fetch) {
  ctx.requireEnvironment('Cloudflare commands')
  const targets = ctx.section('cloudflare').targets
  requireValue(targets && typeof targets === 'object', 'Configure Cloudflare targets')
  const names = Object.keys(targets), name = ctx.string('target', names.length === 1 ? names[0]! : '')
  const base = Object.hasOwn(targets, name) ? targets[name] : undefined
  requireValue(base, 'Select a configured Cloudflare target with --target')
  const target = { ...base, ...base.environments?.[ctx.environment] }
  const root = ctx.path(target.root ?? '.')
  requireValue(['worker', 'pages'].includes(target.kind), 'Cloudflare target kind must be worker or pages')
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
    ctx.log(`[rds] Pages project ready: ${target.projectName}; custom domains still need DNS/certificate validation`)
    return
  }
  if (action === 'deploy-pages') requireValue(target.kind === 'pages' && target.projectName && target.directory, 'Select a Pages target with projectName and directory')
  else requireValue(target.kind === 'worker' && target.config, 'Select a Worker target with an explicit Wrangler config')
  let secretValues: Record<string, string> | undefined
  if (action === 'push-secrets') {
    requireValue(target.secretsFile && target.secretNames?.length, 'Secret upload needs an explicit file and allowlist')
    requireValue(target.secretNames.every(name => /^[A-Z][A-Z0-9_]*$/u.test(name)), 'Invalid secret name')
    if (!ctx.dryRun) {
      const content = await readFile(ctx.path(target.secretsFile), 'utf8')
      const values = target.secretsFile.endsWith('.json') ? JSON.parse(content) : parseEnv(content)
      secretValues = {}
      for (const name of target.secretNames) { requireValue(Object.hasOwn(values, name) && typeof values[name] === 'string' && values[name].length, 'Required secret is missing or empty'); secretValues[name] = values[name] }
    }
  }
  await ctx.guard(root); await ctx.hooks(target.prepare, ctx.root)
  const secrets = !ctx.dryRun && ctx.config.cloudflare?.credentialsFile ? await credentials(ctx, ctx.config.cloudflare.credentialsFile) : {}
  const providerEnv = { ...(secrets.CLOUDFLARE_API_TOKEN ? { CLOUDFLARE_API_TOKEN: secrets.CLOUDFLARE_API_TOKEN } : {}), ...(target.accountId || secrets.CLOUDFLARE_ACCOUNT_ID ? { CLOUDFLARE_ACCOUNT_ID: target.accountId ?? secrets.CLOUDFLARE_ACCOUNT_ID } : {}) }
  if (action === 'deploy-pages') await ctx.run('wrangler', ['pages', 'deploy', inside(root, target.directory!), '--project-name', target.projectName!, '--branch', ctx.string('branch', target.branch ?? (ctx.environment === 'production' ? 'main' : ctx.environment)), ...(target.commitDirty ? ['--commit-dirty=true'] : [])], { cwd: root, env: providerEnv, label: 'Deploy Pages target' })
  else {
    const shared = ['--config', inside(root, target.config!), ...(target.wranglerEnv === false ? [] : ['--env', target.wranglerEnv ?? ctx.environment])]
    if (action === 'push-secrets') await ctx.run('wrangler', ['secret', 'bulk', ...shared], { cwd: root, env: providerEnv, input: JSON.stringify(secretValues ?? {}), label: 'Upload allowlisted Worker secrets' })
    else await ctx.run('wrangler', ['deploy', ...shared], { cwd: root, env: providerEnv, label: 'Deploy Worker target' })
  }
}
