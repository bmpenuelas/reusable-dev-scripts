// Read-only APK facts from the Android SDK's aapt2. What is allowed stays the consuming project's decision.
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { androidEnvironment } from './android.js'
import { inside, requireValue } from './runtime.js'
import type { Context } from './context.js'

export interface ApkInfo {
  packageName: string
  versionName: string
  versionCode: number | null
  minSdk: string | null
  targetSdk: string | null
  debuggable: boolean
  /** Declared with uses-permission (including uses-permission-sdk-23). */
  permissions: string[]
  /** Added by the platform because of the target SDK, not written in the manifest. */
  impliedPermissions: string[]
}

export function parseApkBadging(output: string): ApkInfo {
  const lines = output.split(/\r?\n/u)
  const attribute = (line: string, name: string) => new RegExp(`(?:^|\\s)${name}='([^']*)'`, 'u').exec(line)?.[1]
  const header = lines.find(line => line.startsWith('package: '))
  const packageName = header && attribute(header, 'name')
  requireValue(header && packageName, 'aapt2 did not report an application package; is the artifact an APK?')
  const value = (...keys: string[]) => { for (const line of lines) for (const key of keys) if (line.startsWith(`${key}:'`)) return line.slice(key.length + 2, line.indexOf("'", key.length + 2)); return null }
  const names = (...keys: string[]) => [...new Set(lines.filter(line => keys.some(key => line.startsWith(`${key}: `))).flatMap(line => attribute(line, 'name') ?? []))].sort()
  const code = attribute(header, 'versionCode')
  return {
    packageName,
    versionName: attribute(header, 'versionName') ?? '',
    versionCode: code && /^\d+$/u.test(code) ? Number(code) : null,
    minSdk: value('minSdkVersion', 'sdkVersion'),
    targetSdk: value('targetSdkVersion'),
    debuggable: lines.some(line => line.trim() === 'application-debuggable'),
    permissions: names('uses-permission', 'uses-permission-sdk-23'),
    impliedPermissions: names('uses-implied-permission'),
  }
}

/** The newest installed build-tools aapt2, else one on PATH. */
export function findAapt2(sdk: string | undefined, platform: NodeJS.Platform = process.platform): string {
  const name = platform === 'win32' ? 'aapt2.exe' : 'aapt2'
  const tools = sdk ? join(sdk, 'build-tools') : ''
  if (tools && existsSync(tools)) {
    const versions = readdirSync(tools).sort((a, b) => b.localeCompare(a, 'en', { numeric: true }))
    const found = versions.map(version => join(tools, version, name)).find(existsSync)
    if (found) return found
  }
  return 'aapt2'
}

/** `print` receives the report; step lines go to `ctx.log`, so JSON output can stay alone on stdout. */
export async function androidInspect(ctx: Context, print: (message: string) => void = ctx.log) {
  const file = ctx.string('artifact'), format = ctx.choice('format', ['text', 'json'], 'text')
  requireValue(/\.apk$/iu.test(file), 'Provide --artifact <file.apk> (app bundles are not supported)')
  const path = inside(ctx.root, file)
  requireValue(ctx.dryRun || existsSync(path), 'APK not found')
  const env = androidEnvironment(ctx)
  const result = await ctx.run(findAapt2(env.ANDROID_HOME), ['dump', 'badging', path], { env, capture: true, label: 'Inspect APK with aapt2 (Android SDK build-tools)' })
  if (ctx.dryRun) return
  const info = parseApkBadging(result.stdout)
  if (format === 'json') { print(JSON.stringify(info, null, 2)); return }
  const list = (items: string[]) => items.length ? items.map(item => `\n  ${item}`).join('') : ' none'
  print([
    `Package: ${info.packageName}`,
    `Version: ${info.versionName || '(none)'} (code ${info.versionCode ?? 'none'})`,
    `SDK: min ${info.minSdk ?? 'unknown'}, target ${info.targetSdk ?? 'unknown'}`,
    `Debuggable: ${info.debuggable ? 'yes' : 'no'}`,
    `Permissions:${list(info.permissions)}`,
    ...(info.impliedPermissions.length ? [`Implied permissions:${list(info.impliedPermissions)}`] : []),
  ].join('\n'))
}
