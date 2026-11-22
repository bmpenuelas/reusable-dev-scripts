import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname, join, relative, sep } from 'node:path'
import { Failure, requireValue, writeChanged } from './runtime.js'
import type { Context } from './context.js'

const lockNames = ['package-lock.json', 'npm-shrinkwrap.json']
function parseJson(source: string, label: string) {
  try { return JSON.parse(source.replace(/^\uFEFF/u, '')) }
  catch { throw new Failure(`Invalid JSON in ${label}`) }
}

async function workspaceLocks(ctx: Context, directory: string) {
  const root = ctx.path()
  for (let owner = directory; relative(root, owner) !== '';) {
    owner = dirname(owner)
    const manifest = join(owner, 'package.json')
    const files = lockNames.map(name => join(owner, name)).filter(file => existsSync(file))
    if (!files.length || !existsSync(manifest)) continue
    const ancestor = parseJson(await readFile(ctx.path(manifest), 'utf8'), 'ancestor package.json')
    const workspaces = ancestor?.workspaces
    const patterns = Array.isArray(workspaces) ? workspaces : workspaces?.packages
    if (!Array.isArray(patterns) || !patterns.length) continue
    const key = relative(owner, directory).split(sep).join('/')
    const matches = []
    for (const file of files) {
      const path = ctx.path(file)
      const source = await readFile(path, 'utf8'), data = parseJson(source, `workspace ${basename(file)}`)
      // The lockfile already maps package locations; do not resolve workspace globs or dependencies.
      const entry = data?.packages && Object.hasOwn(data.packages, key) ? data.packages[key] : undefined
      if (entry && typeof entry === 'object' && !Array.isArray(entry) && !entry.link) matches.push({ path, source, data, entry })
    }
    if (matches.length) return matches
  }
  return []
}

export async function bumpNpmVersion(ctx: Context, manifest: string, bump: string, label: string) {
  const path = ctx.path(manifest), directory = dirname(path)
  requireValue(basename(path) === 'package.json', '--bump requires an owning package.json')
  for (const name of lockNames) ctx.path(join(directory, name))
  const locks = await workspaceLocks(ctx, directory)
  // npm updates the selected manifest and colocated locks. Keep workspace reify disabled.
  await ctx.run('npm', ['--prefix', directory, '--workspaces=false', 'version', bump, '--no-git-tag-version', '--ignore-scripts'], { cwd: directory, label })
  if (!locks.length) return
  ctx.log(`${ctx.dryRun ? '[plan]' : '[rds]'} Sync npm workspace lockfile version`)
  if (ctx.dryRun) return
  const { version } = parseJson(await readFile(path, 'utf8'), 'bumped package.json')
  requireValue(typeof version === 'string' && version.length, 'The bumped package.json must have a version')
  for (const { path, source, data, entry } of locks) {
    if (entry.version === version) continue
    entry.version = version
    const indent = /\r?\n([ \t]+)"/u.exec(source)?.[1]
    const newline = source.includes('\r\n') ? '\r\n' : '\n'
    const bom = source.startsWith('\uFEFF') ? '\uFEFF' : ''
    const trailing = /[ \t\r\n]*$/u.exec(source)![0]
    await writeChanged(path, bom + JSON.stringify(data, null, indent).replaceAll('\n', newline) + trailing)
  }
}
