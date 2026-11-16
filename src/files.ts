import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { zipSync } from 'fflate'
import { inside, outputPath, requireValue, writeChanged } from './runtime.js'
import type { Context } from './context.js'

export async function ownedDirectory(ctx: Context, path: string, clean = false, markerPath = '.rds-owned') {
  const directory = outputPath(ctx.root, path), marker = join(directory, markerPath)
  if (existsSync(directory) && clean) requireValue(existsSync(marker), 'Refusing to clean a directory not created by rds')
  if (ctx.dryRun) return directory
  if (clean && existsSync(directory)) await rm(directory, { recursive: true })
  await mkdir(directory, { recursive: true }); await writeChanged(marker, 'reusable-dev-scripts generated output\n')
  return directory
}
export async function archiveDirectory(root: string, directory: string): Promise<Uint8Array> {
  const base = inside(root, directory), entries: Record<string, Uint8Array> = Object.create(null); let total = 0
  const walk = async (path: string) => {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      requireValue(!entry.isSymbolicLink(), 'Extension archives must not contain symlinks')
      const child = inside(base, relative(base, join(path, entry.name)))
      if (entry.isDirectory()) await walk(child)
      else if (entry.isFile()) { const bytes = await readFile(child); total += bytes.length; requireValue(total <= 256 * 1024 * 1024, 'Extension archive exceeds the 256 MiB input limit'); entries[relative(base, child).replaceAll('\\', '/')] = bytes }
    }
  }
  await walk(base); requireValue(Object.keys(entries).length > 0, 'Cannot package an empty directory')
  return zipSync(entries, { level: 6 })
}
