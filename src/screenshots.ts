import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile } from 'node:fs/promises'
import { join, basename, relative } from 'node:path'
import { createInterface } from 'node:readline/promises'
import sharp from 'sharp'
import { adb, device } from './android.js'
import { capacitorSync } from './capacitor.js'
import { inside, outputPath, requireValue, writeChanged } from './runtime.js'
import type { Context } from './context.js'

export async function simulator(ctx: Context): Promise<string> {
  requireValue(process.platform === 'darwin' || ctx.dryRun, 'iOS screenshots require macOS and a booted simulator')
  if (ctx.dryRun) return ctx.string('device', '<simulator>')
  const result = await ctx.run('xcrun', ['simctl', 'list', 'devices', 'booted', '--json'], { capture: true })
  const data = JSON.parse(result.stdout) as { devices: Record<string, { udid: string; state: string; isAvailable?: boolean }[]> }
  const booted = Object.values(data.devices).flat().filter(x => x.state === 'Booted' && x.isAvailable !== false)
  const id = ctx.string('device'); if (id) requireValue(booted.some(x => x.udid === id), 'Requested iOS simulator is not booted')
  else requireValue(booted.length === 1, 'Boot one simulator or select it with --device')
  return id || booted[0]!.udid
}
export async function screenshots(ctx: Context) {
  const action = ctx.choice('action', ['open', 'capture', 'resize'], 'capture')
  const platform = ctx.choice('platform', ['android', 'ios'], 'android')
  const settings = ctx.section('capacitor').screenshots, root = ctx.moduleRoot('capacitor')
  const output = outputPath(root, ctx.string('output', settings?.output ?? 'store/captures'))
  if (action === 'resize') {
    requireValue(settings?.sizes?.length, 'Configure capacitor.screenshots.sizes')
    const input = inside(root, ctx.string('input')); requireValue(existsSync(input), 'Screenshot input directory not found')
    for (const entry of await readdir(input, { withFileTypes: true })) {
      if (!entry.isFile() || !/\.(png|jpe?g)$/iu.test(entry.name)) continue
      for (const size of settings.sizes) {
        requireValue(Number.isInteger(size.width) && Number.isInteger(size.height) && size.width > 0 && size.height > 0 && size.width <= 8192 && size.height <= 8192, 'Invalid screenshot dimensions')
        const path = outputPath(root, join(relative(root, output), `${size.width}x${size.height}`, `${entry.name.replace(/\.[^.]+$/u, '')}.png`))
        if (!ctx.dryRun) await writeChanged(path, await sharp(await readFile(inside(input, entry.name))).resize(size.width, size.height, { fit: 'contain', background: '#ffffff' }).flatten({ background: '#ffffff' }).png().toBuffer())
      }
    }
    return
  }
  if (action === 'open') {
    await capacitorSync(ctx)
    await ctx.run('cap', ['run', platform, '--no-sync', ...(ctx.flags.device ? ['--target', ctx.string('device')] : [])], { cwd: root, label: 'Open screenshot app' })
    return
  }
  const id = platform === 'android' ? await device(ctx) : await simulator(ctx)
  const capture = async (name: string) => {
    requireValue(/^[\w-]+$/u.test(name), 'Screenshot name may contain only letters, digits, underscores and hyphens')
    const path = outputPath(root, join(ctx.string('output', settings?.output ?? 'store/captures'), `${name}.png`))
    requireValue(ctx.boolean('force') || !existsSync(path), 'Screenshot exists; choose another name or use --force')
    if (!ctx.dryRun) await mkdir(output, { recursive: true })
    if (platform === 'ios') await ctx.run('xcrun', ['simctl', 'io', id, 'screenshot', path], { label: 'Capture iOS screenshot' })
    else {
      const remote = `/sdcard/rds-${process.pid}-${Date.now()}.png`
      try { await adb(ctx, ['-s', id, 'shell', 'screencap', '-p', remote]); await adb(ctx, ['-s', id, 'pull', remote, path]) }
      finally { await adb(ctx, ['-s', id, 'shell', 'rm', remote]) }
    }
    requireValue(ctx.dryRun || existsSync(path), 'Screenshot was not produced')
  }
  if (!ctx.boolean('guided')) return capture(ctx.string('name', 'screenshot'))
  requireValue(process.stdin.isTTY && !ctx.dryRun, '--guided requires an interactive terminal; omit it for dry-run')
  const prompt = createInterface({ input: process.stdin, output: process.stdout })
  try { while (true) { const name = (await prompt.question('Capture name (empty to finish): ')).trim(); if (!name) break; await capture(name) } }
  finally { prompt.close() }
}
