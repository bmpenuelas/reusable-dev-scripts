import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { outputPath, requireValue } from './runtime.js'
import type { Context } from './context.js'

/** Install only the bundled instructions, never project config or executable hooks. */
export async function installSkill(ctx: Context): Promise<void> {
  const directory = outputPath(ctx.root, ctx.string('output', '.agents/skills/reusable-dev-scripts'))
  const target = outputPath(ctx.root, join(directory, 'SKILL.md'))
  const content = await readFile(new URL('../skills/reusable-dev-scripts/SKILL.md', import.meta.url), 'utf8')
  const current = await readFile(target, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
  requireValue(current === undefined || current === content, 'Existing SKILL.md differs; review it and choose another --output or move it aside before installing')
  if (current === content) { ctx.log('[rds] Skill already matches the installed package'); return }
  ctx.log(`${ctx.dryRun ? '[plan]' : '[rds]'} Install reusable-dev-scripts skill`)
  if (ctx.dryRun) return
  await mkdir(directory, { recursive: true })
  // Exclusive creation also protects a file introduced between preflight and write.
  outputPath(ctx.root, target)
  await writeFile(target, content, { flag: 'wx' })
}
