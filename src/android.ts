import { existsSync } from 'node:fs'
import { join, delimiter } from 'node:path'
import { inside, requireValue } from './runtime.js'
import type { Context } from './context.js'

export function androidEnvironment(ctx: Context): NodeJS.ProcessEnv {
  const config = ctx.config.android, java = process.platform === 'win32' ? 'java.exe' : 'java'
  const candidates = [config?.javaHome, process.env.JAVA_HOME, process.env.STUDIO_JDK,
    process.platform === 'win32' ? join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Android/Android Studio/jbr') : process.platform === 'darwin' ? '/Applications/Android Studio.app/Contents/jbr/Contents/Home' : '/opt/android-studio/jbr']
  const home = candidates.find(path => path && existsSync(join(path, 'bin', java)))
  if (config?.javaHome) requireValue(home === config.javaHome, 'Configured JDK does not contain Java')
  const sdk = config?.sdkRoot ?? process.env.ANDROID_SDK_ROOT ?? process.env.ANDROID_HOME
  return { ...process.env, ...(home ? { JAVA_HOME: home } : {}), ...(sdk ? { ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk } : {}), PATH: [home && join(home, 'bin'), sdk && join(sdk, 'platform-tools'), process.env.PATH ?? process.env.Path].filter(Boolean).join(delimiter) }
}
export function androidRoot(ctx: Context): string { return ctx.path(ctx.config.android?.root ?? join(ctx.config.capacitor?.root ?? '.', 'android')) }
export function artifacts(ctx: Context, configuration: string, format: string) {
  const root = androidRoot(ctx), module = ctx.config.android?.module ?? 'app'
  requireValue(/^[\w-]+$/u.test(module), 'Invalid Android module name')
  const path = format === 'aab' ? ctx.config.android?.aab ?? `${module}/build/outputs/bundle/${configuration}/${module}-${configuration}.aab` : ctx.config.android?.apk ?? `${module}/build/outputs/apk/${configuration}/${module}-${configuration}.apk`
  return inside(root, path)
}
export async function androidBuild(ctx: Context, tasks: string[] = [], debug = false) {
  await ctx.guard(androidRoot(ctx), 'android')
  const configuration = debug ? 'debug' : ctx.choice('configuration', ['debug', 'release'], 'release')
  const format = debug ? 'apk' : ctx.choice('format', ['apk', 'aab'], 'aab')
  requireValue(!(configuration === 'debug' && format === 'aab'), 'Debug builds must use --format apk')
  const root = androidRoot(ctx)
  requireValue(ctx.dryRun || existsSync(join(root, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew')), 'Gradle wrapper not found in configured Android root')
  const module = ctx.config.android?.module ?? 'app'; requireValue(/^[\w-]+$/u.test(module), 'Invalid Android module')
  const suffix = configuration === 'debug' ? 'Debug' : 'Release'
  const args = [...(ctx.boolean('clean') ? ['clean'] : []), ...(tasks.length ? tasks : [`:${module}:${format === 'apk' ? 'assemble' : 'bundle'}${suffix}`])]
  await ctx.run(process.platform === 'win32' ? join(root, 'gradlew.bat') : './gradlew', args, { cwd: root, env: androidEnvironment(ctx), label: 'Android Gradle build' })
  const artifact = artifacts(ctx, configuration, format)
  if (!tasks.length) {
    requireValue(ctx.dryRun || existsSync(artifact), 'Gradle completed without producing the configured artifact')
    ctx.log(`${ctx.dryRun ? '[plan]' : '[rds]'} Artifact: ${artifact}`)
    if (ctx.boolean('reveal')) {
      // File-manager launch/exit status is not a build verification result.
      // In particular, Explorer can return a nonzero status after handing off.
      try { await reveal(ctx, artifact) }
      catch { ctx.log('[rds] Warning: Artifact is ready, but automatic reveal could not be confirmed. Open the artifact path above manually.') }
    }
  }
  return artifact
}
export async function reveal(ctx: Context, path: string) {
  // Explorer hands the request to the desktop shell and commonly exits 1 even
  // when the file is revealed. Keep this convention local to this invocation.
  if (process.platform === 'win32') await ctx.run('explorer.exe', [`/select,${path}`], { label: 'Reveal artifact', successExitCodes: [0, 1], windowsHide: false })
  else if (process.platform === 'darwin') await ctx.run('open', ['-R', path], { label: 'Reveal artifact' })
  else await ctx.run('xdg-open', [join(path, '..')], { label: 'Reveal artifact' })
}
export async function adb(ctx: Context, args: string[], capture = true, label = 'Run Android Debug Bridge command') {
  const env = androidEnvironment(ctx), sdk = ctx.config.android?.sdkRoot ?? env.ANDROID_SDK_ROOT
  const binary = sdk ? join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb') : 'adb'
  return ctx.run(binary, args, { env, capture, label })
}
export async function androidStartAdb(ctx: Context) {
  await ctx.guard(ctx.root, 'android')
  // Starting the daemon needs neither a native project nor a selected device.
  await adb(ctx, ['start-server'], false, 'Start Android Debug Bridge server')
}
export function selectDevice(output: string, requested: string, physical = false): string {
  const devices = output.split(/\r?\n/u).map(line => line.trim().split(/\s+/u)).filter(parts => parts[1] === 'device').map(parts => parts[0]!).filter(id => !physical || !id.startsWith('emulator-'))
  if (requested) { requireValue(devices.includes(requested), 'Requested Android device is unavailable or unauthorized'); return requested }
  requireValue(devices.length === 1, devices.length ? 'Multiple Android devices; select one with --device' : 'No authorized Android device found')
  return devices[0]!
}
export async function device(ctx: Context): Promise<string> {
  if (ctx.dryRun) return ctx.string('device', '<device>')
  return selectDevice((await adb(ctx, ['devices'], true, 'List Android devices')).stdout, ctx.string('device'), ctx.boolean('physical'))
}
export async function androidInstall(ctx: Context) {
  await ctx.guard(androidRoot(ctx), 'android')
  const id = await device(ctx)
  const apk = ctx.string('artifact') ? inside(ctx.root, ctx.string('artifact')) : artifacts(ctx, 'debug', 'apk')
  requireValue(ctx.dryRun || existsSync(apk), 'APK not found; build first or provide --artifact')
  if (ctx.boolean('replace')) {
    const appId = ctx.config.android?.appId; requireValue(appId && /^[\w.]+$/u.test(appId), 'Configure android.appId before replacing an installation')
    ctx.log('[rds] Explicit replacement removes the installed app and its local data')
    const installed = await adb(ctx, ['-s', id, 'shell', 'pm', 'path', appId], true, 'Check existing Android installation')
    if (ctx.dryRun || /^package:/mu.test(installed.stdout)) await adb(ctx, ['-s', id, 'uninstall', appId], true, 'Remove existing Android installation')
  }
  const result = await adb(ctx, ['-s', id, 'install', '-r', apk], true, 'Install Android APK')
  requireValue(ctx.dryRun || /^Success\s*$/mu.test(result.stdout), 'ADB did not confirm successful installation')
  if (ctx.config.android?.appId) {
    const verified = await adb(ctx, ['-s', id, 'shell', 'pm', 'path', ctx.config.android.appId], true, 'Verify installed Android package')
    requireValue(ctx.dryRun || /^package:/mu.test(verified.stdout), 'Installed Android package could not be verified')
  }
}
