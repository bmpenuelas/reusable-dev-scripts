import { requireValue } from './runtime.js'
import type { Config } from './types.js'

/**
 * Project-chosen build settings per platform and build kind. They are `NAME=value` strings:
 * Xcode build settings on iOS (`xcodebuild NAME=value`) and Gradle project properties on Android (`-PNAME=value`).
 * A build receives the `all` list of its platform, then the list of its own kind, so a build kind that is not
 * configured changes nothing.
 *
 * iOS kinds: `release` (a normal App Store / TestFlight archive) and `testflight-only` (`--testflight-only`).
 * Android kinds: `debug` and `release` (`--configuration`) and any name the project defines and selects with `--kind`.
 */
export const IOS_KINDS = ['release', 'testflight-only'] as const
export const ANDROID_CONFIGURATIONS = ['debug', 'release'] as const
export type BuildSettingsPlatform = 'android' | 'ios'

// Signing, versioning and the build configuration stay owned by the platform toolchain and by rds itself.
const RESERVED: Record<BuildSettingsPlatform, RegExp> = {
  ios: /^(?:CODE_SIGN|DEVELOPMENT_TEAM|PROVISIONING_PROFILE|PRODUCT_BUNDLE_IDENTIFIER|MARKETING_VERSION|CURRENT_PROJECT_VERSION|CONFIGURATION|SDKROOT|ARCHS|ONLY_ACTIVE_ARCH)/u,
  android: /^(?:android\.injected\.|.*(?:signing|keystore|storepass|keypass|keyalias|versioncode|versionname))/iu
}
const SYNTAX: Record<BuildSettingsPlatform, RegExp> = { ios: /^[A-Z][A-Z0-9_]*=[^\r\n]*$/u, android: /^[A-Za-z_][\w.]*=[^\r\n]*$/u }
const ANDROID_CUSTOM_KIND = /^[a-z][a-z0-9-]*$/u

function list(value: unknown, label: string, platform: BuildSettingsPlatform): string[] {
  requireValue(Array.isArray(value) && value.every(entry => typeof entry === 'string'), `${label} must be an array of NAME=value strings`)
  for (const entry of value as string[]) {
    requireValue(SYNTAX[platform].test(entry), `${label} entry must look like NAME=value: ${entry}`)
    requireValue(!RESERVED[platform].test(entry), `${label} cannot change signing, version or build-configuration settings: ${entry.split('=')[0]}`)
  }
  return value as string[]
}

export function validateBuildSettings(value: Config['buildSettings']): void {
  if (value === undefined) return
  for (const platform of Object.keys(value)) requireValue(platform === 'android' || platform === 'ios', `Unknown buildSettings platform: ${platform}`)
  for (const platform of ['android', 'ios'] as const) {
    const kinds = value[platform]
    if (kinds === undefined) continue
    requireValue(kinds !== null && typeof kinds === 'object' && !Array.isArray(kinds), `buildSettings.${platform} must be an object`)
    for (const [kind, entries] of Object.entries(kinds)) {
      const known = kind === 'all' || (platform === 'ios' ? (IOS_KINDS as readonly string[]).includes(kind) : ANDROID_CONFIGURATIONS.includes(kind as 'debug') || ANDROID_CUSTOM_KIND.test(kind))
      requireValue(known, platform === 'ios' ? `Unknown iOS build kind: ${kind} (use all, ${IOS_KINDS.join(' or ')})` : `Invalid Android build kind name: ${kind} (lowercase letters, digits and dashes)`)
      list(entries, `buildSettings.${platform}.${kind}`, platform)
    }
  }
}

/** The settings for one build: the platform's `all` list followed by each requested kind's list, in that order. */
export function resolveBuildSettings(config: Config, platform: BuildSettingsPlatform, kinds: string[]): string[] {
  const configured = config.buildSettings?.[platform] as Record<string, string[] | undefined> | undefined
  return ['all', ...kinds].flatMap(kind => configured?.[kind] ?? [])
}

/** Android custom kinds exist only when the project defines them; naming an unknown one is an error rather than a silent no-op. */
export function requireAndroidKind(config: Config, kind: string): void {
  requireValue(ANDROID_CUSTOM_KIND.test(kind) && !(ANDROID_CONFIGURATIONS as readonly string[]).includes(kind) && kind !== 'all', `Invalid --kind: ${kind}`)
  requireValue(Object.hasOwn(config.buildSettings?.android ?? {}, kind), `Unknown Android build kind: ${kind}; define buildSettings.android.${kind} in the configuration`)
}
