import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { requireValue, writeChanged, inside } from './runtime.js'
import type { Context } from './context.js'

export function nativeVersion(raw: string) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[\da-zA-Z.-]+)?(?:\+[\da-zA-Z.-]+)?$/u.exec(raw)
  requireValue(match, 'Package version must be valid semver')
  const [major, minor, patch] = match.slice(1, 4).map(Number) as [number, number, number]
  requireValue(minor <= 999 && patch <= 999, 'Native version minor and patch must not exceed 999')
  const build = Math.max(1, major * 1_000_000 + minor * 1_000 + patch)
  requireValue(Number.isSafeInteger(build) && build <= 2_100_000_000, 'Native build number exceeds the Android limit')
  return { version: `${major}.${minor}.${patch}`, build }
}
export function syncIos(source: string, version: string, build: number, bump = false): string {
  const values = [...source.matchAll(/CURRENT_PROJECT_VERSION = ([^;]+);/gu)].map(x => x[1]!.trim())
  requireValue(values.length && values.every(x => /^\d+$/u.test(x)), 'Expected integer iOS CURRENT_PROJECT_VERSION settings')
  requireValue(/MARKETING_VERSION = [^;]+;/u.test(source), 'Missing iOS MARKETING_VERSION settings')
  const next = Math.max(build, ...values.map(Number)) + (bump ? 1 : 0)
  requireValue(Number.isSafeInteger(next), 'iOS build number exceeds integer range')
  return source.replace(/CURRENT_PROJECT_VERSION = [^;]+;/gu, `CURRENT_PROJECT_VERSION = ${next};`).replace(/MARKETING_VERSION = [^;]+;/gu, `MARKETING_VERSION = ${version};`)
}
export function syncAndroid(source: string, version: string, build: number): string {
  // Gradle can derive these directly from package.json; leave expressions alone.
  requireValue(/versionCode\s+\S+/u.test(source) && /versionName\s+\S+/u.test(source), 'Missing Android version settings')
  return source.replace(/versionCode\s+\d+/u, `versionCode ${build}`).replace(/versionName\s+"[^"]+"/u, `versionName "${version}"`)
}
export async function versions(ctx: Context) {
  const config = ctx.section('capacitor'), root = ctx.moduleRoot('capacitor')
  const path = inside(ctx.root, config.packageJson ?? join(config.root ?? '.', 'package.json'))
  const bump = ctx.string('bump')
  const data = JSON.parse(await readFile(path, 'utf8'))
  let requestedVersion = data.version
  if (bump) {
    requireValue(['patch', 'minor', 'major'].includes(bump), '--bump must be patch, minor, or major')
    requireValue(!ctx.boolean('check'), '--check cannot bump versions')
    const current = nativeVersion(data.version).version.split('.').map(Number), prerelease = data.version.split('+')[0].includes('-')
    requestedVersion = bump === 'major' ? `${current[0]! + (prerelease && current[1] === 0 && current[2] === 0 ? 0 : 1)}.0.0` : bump === 'minor' ? `${current[0]}.${current[1]! + (prerelease && current[2] === 0 ? 0 : 1)}.0` : `${current[0]}.${current[1]}.${current[2]! + (prerelease ? 0 : 1)}`
  }
  const { version, build } = nativeVersion(requestedVersion)
  const platform = ctx.choice('platform', ['android', 'ios', 'all'], 'all')
  const bumpBuild = ctx.boolean('bump-build')
  requireValue(!bumpBuild || platform === 'ios', '--bump-build requires --platform ios')
  requireValue(!bumpBuild || !ctx.boolean('check'), '--check cannot bump a build')
  const outputs: [string, string][] = []
  if (platform !== 'ios') {
    const android = inside(root, config.androidProject ?? 'android/app/build.gradle')
    if (existsSync(android)) outputs.push([android, syncAndroid(await readFile(android, 'utf8'), version, build)])
    for (const module of config.androidModules ?? []) {
      const path = inside(root, module.project), offsetBuild = build + (module.versionCodeOffset ?? 0)
      requireValue(existsSync(path), 'A configured Android module build file was not found')
      requireValue(Number.isSafeInteger(offsetBuild) && offsetBuild <= 2_100_000_000, 'Native build number with the module offset exceeds the Android limit')
      outputs.push([path, syncAndroid(await readFile(path, 'utf8'), version, offsetBuild)])
    }
  }
  if (platform !== 'android') {
    const ios = inside(root, config.iosProject ?? 'ios/App/App.xcodeproj/project.pbxproj')
    if (existsSync(ios)) outputs.push([ios, syncIos(await readFile(ios, 'utf8'), version, build, bumpBuild)])
  }
  requireValue(outputs.length, 'No selected native version files found')
  if (bump) await ctx.run('npm', ['--prefix', dirname(path), '--workspaces=false', 'version', requestedVersion, '--no-git-tag-version', '--ignore-scripts'], { cwd: dirname(path), label: 'Bump package version' })
  if (!ctx.dryRun) for (const [file, content] of outputs) await writeChanged(file, content, ctx.boolean('check'))
  ctx.log(`${ctx.dryRun ? '[plan]' : '[rds]'} Native versions ${version}, base build ${build}`)
}
