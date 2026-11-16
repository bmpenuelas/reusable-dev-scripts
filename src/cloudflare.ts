import { readFile } from 'node:fs/promises'
import { parseEnv } from 'node:util'
import { inside, requireValue } from './runtime.js'
import type { Context } from './context.js'

export async function cloudflare(ctx: Context, action: string) {
  const targets = ctx.section('cloudflare').targets
  requireValue(targets && typeof targets === 'object', 'Configure Cloudflare targets')
  const names = Object.keys(targets), name = ctx.string('target', names.length === 1 ? names[0]! : '')
  const target = Object.hasOwn(targets, name) ? targets[name] : undefined
  requireValue(target, 'Select a configured Cloudflare target with --target')
  requireValue(ctx.flags.env, 'Cloudflare mutations require an explicit --env')
  const root = ctx.path(target.root ?? '.')
  requireValue(['worker', 'pages'].includes(target.kind), 'Cloudflare target kind must be worker or pages')
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
  if (action === 'deploy-pages') await ctx.run('wrangler', ['pages', 'deploy', inside(root, target.directory!), '--project-name', target.projectName!, '--branch', ctx.string('branch', ctx.environment === 'production' ? 'main' : ctx.environment)], { cwd: root, label: 'Deploy Pages target' })
  else {
    const shared = ['--config', inside(root, target.config!), '--env', ctx.environment]
    if (action === 'push-secrets') await ctx.run('wrangler', ['secret', 'bulk', ...shared], { cwd: root, input: JSON.stringify(secretValues ?? {}), label: 'Upload allowlisted Worker secrets' })
    else await ctx.run('wrangler', ['deploy', ...shared], { cwd: root, label: 'Deploy Worker target' })
  }
}
