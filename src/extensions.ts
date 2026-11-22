import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { archiveDirectory } from './files.js'
import { bumpNpmVersion } from './npm-version.js'
import { inside, outputPath, requireValue, writeChanged } from './runtime.js'
import type { Context } from './context.js'

export async function vscode(ctx: Context, action: string) {
  const config = ctx.section('vscode'), root = ctx.moduleRoot('vscode')
  const registry = ctx.choice('registry', ['marketplace', 'openvsx', 'all'], 'all')
  if (action === 'publish') {
    await ctx.guard(root)
    const bump = ctx.string('bump')
    if (bump) {
      requireValue(['patch', 'minor', 'major'].includes(bump), 'Invalid extension version bump')
      await bumpNpmVersion(ctx, join(root, 'package.json'), bump, 'Bump extension version')
    }
  }
  await ctx.hooks(config.prepare, root)
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  requireValue(typeof manifest.name === 'string' && typeof manifest.version === 'string' && /^[\w.-]+$/u.test(manifest.name) && /^[\w.+-]+$/u.test(manifest.version), 'Invalid extension name/version')
  const path = outputPath(root, ctx.string('output', config.output ?? `${manifest.name}-${manifest.version}.vsix`))
  const args = ['package', '--out', path]
  if (config.noDependencies || ctx.boolean('no-dependencies')) args.push('--no-dependencies')
  await ctx.run('vsce', args, { cwd: root, label: 'Package one VSIX' })
  requireValue(ctx.dryRun || existsSync(path), 'VSCE did not produce the configured VSIX')
  if (action === 'publish') {
    if (registry !== 'openvsx') await ctx.run('vsce', ['publish', '--packagePath', path], { cwd: root, label: 'Publish VSIX to Marketplace' })
    if (registry !== 'marketplace') await ctx.run('ovsx', ['publish', path], { cwd: root, label: 'Publish same VSIX to Open VSX' })
  }
}
export async function browserPackage(ctx: Context) {
  const config = ctx.section('browser'), root = ctx.moduleRoot('browser')
  requireValue(typeof config.directory === 'string' && typeof config.output === 'string', 'Configure browser directory and output')
  const directory = inside(root, config.directory), output = outputPath(root, ctx.string('output', config.output))
  requireValue(!output.startsWith(directory + '/') && !output.startsWith(directory + '\\') && output !== directory, 'Archive output must be outside its input directory')
  await ctx.hooks(config.prepare, root)
  if (!ctx.dryRun) {
    const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'))
    requireValue(manifest.manifest_version === 2 || manifest.manifest_version === 3, 'Browser manifest must be version 2 or 3')
    await writeChanged(output, await archiveDirectory(root, config.directory))
  }
  ctx.log(`${ctx.dryRun ? '[plan]' : '[rds]'} Browser extension ZIP: ${output}`)
}
