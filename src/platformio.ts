import { existsSync, readdirSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { requireValue } from './runtime.js'
import type { Context } from './context.js'

/** What the PlatformIO lookup needs from the machine; replaceable in tests. */
export interface PlatformioHost { platform: string; env: NodeJS.ProcessEnv; home: string; exists(path: string): boolean; list(directory: string): string[] }
export function realPlatformioHost(): PlatformioHost {
  return { platform: platform(), env: process.env, home: homedir(), exists: existsSync, list: directory => { try { return readdirSync(directory) } catch { return [] } } }
}

/**
 * Where the PlatformIO CLI may be, most explicit first: `PLATFORMIO_CMD`, then the `pio` of the PlatformIO home this
 * run uses (`coreDir`: its own `penv`, which matches the platforms and packages installed there), then `pio` /
 * `platformio` on PATH, then the locations the official installers and `pip install --user` use. Only existing files
 * are returned.
 */
export function platformioCandidates(host: PlatformioHost = realPlatformioHost(), coreDir?: string): string[] {
  const windows = host.platform === 'win32', extensions = windows ? ['.exe', '.cmd', '.bat'] : [''], names = ['pio', 'platformio']
  const found: string[] = []
  const explicit = host.env.PLATFORMIO_CMD
  if (explicit) found.push(explicit)
  const pathKey = Object.keys(host.env).find(key => key.toUpperCase() === 'PATH') ?? 'PATH'
  const scripts = windows ? 'Scripts' : 'bin'
  const directories = coreDir ? [join(coreDir, 'penv', scripts)] : []
  directories.push(...(host.env[pathKey] ?? '').split(delimiter).filter(Boolean))
  directories.push(join(host.home, '.platformio', 'penv', scripts))
  if (windows) {
    const local = host.env.LOCALAPPDATA, roaming = host.env.APPDATA
    // `py` installs of Python 3.x place user scripts here, whatever the minor version is.
    if (local) for (const entry of host.list(join(local, 'Python')).sort().reverse()) directories.push(join(local, 'Python', entry, 'Scripts'))
    if (roaming) for (const entry of host.list(join(roaming, 'Python')).sort().reverse()) directories.push(join(roaming, 'Python', entry, 'Scripts'))
  } else directories.push(join(host.home, '.local', 'bin'))
  for (const directory of directories) for (const name of names) for (const extension of extensions) {
    const candidate = join(directory, name + extension)
    if (host.exists(candidate) && !found.includes(candidate)) found.push(candidate)
  }
  return found
}

/** The PlatformIO executable to run: `PLATFORMIO_CMD` is authoritative when set (it is never silently replaced). */
export function resolvePlatformio(host: PlatformioHost = realPlatformioHost(), coreDir?: string): string | undefined {
  const explicit = host.env.PLATFORMIO_CMD
  if (explicit) return /[\\/]/u.test(explicit) ? (host.exists(explicit) ? explicit : undefined) : explicit
  return platformioCandidates(host, coreDir)[0]
}

/**
 * Runs the PlatformIO CLI in `platformio.root` with the arguments given after `--`. The tool's stdout stays untouched
 * (callers parse it), so rds reports its own step on stderr.
 */
export async function platformio(ctx: Context, forwarded: string[], host: PlatformioHost = realPlatformioHost()) {
  requireValue(forwarded.length > 0, 'Use rds platformio -- <pio arguments>')
  const config = ctx.config.platformio, root = ctx.moduleRoot('platformio')
  requireValue(existsSync(root) || ctx.dryRun, 'The PlatformIO project directory does not exist')
  const env: NodeJS.ProcessEnv = {}
  if (config?.coreDir && !host.env.PLATFORMIO_CORE_DIR) env.PLATFORMIO_CORE_DIR = resolve(ctx.root, config.coreDir)
  // The home this run uses supplies its own pio first. A plan must work on a machine without PlatformIO.
  const coreDir = host.env.PLATFORMIO_CORE_DIR || env.PLATFORMIO_CORE_DIR
  const command = resolvePlatformio(host, coreDir) ?? (ctx.dryRun ? 'pio' : undefined)
  requireValue(command, 'PlatformIO CLI was not found. Install PlatformIO or set PLATFORMIO_CMD to the pio executable path.')
  await ctx.run(command, forwarded, { cwd: root, env, label: 'PlatformIO' })
}
