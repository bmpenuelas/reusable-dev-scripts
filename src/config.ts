import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { requireValue } from './runtime.js'
import type { Config, Command } from './types.js'

export function defineConfig(config: Config): Config { return validateConfig(config) }
export function validateConfig(value: unknown): Config {
  requireValue(value && typeof value === 'object' && !Array.isArray(value), 'Configuration must be an object')
  const data = value as Record<string, unknown>
  requireValue(data.version === 1, 'Configuration version must be 1')
  const allowed = ['version', 'production', 'vue', 'capacitor', 'android', 'store', 'electron', 'swift', 'vscode', 'cloudflare', 'browser']
  for (const [key, section] of Object.entries(data)) {
    requireValue(allowed.includes(key), `Unknown configuration section: ${key}`)
    if (key !== 'version') requireValue(section && typeof section === 'object' && !Array.isArray(section), `Invalid ${key} configuration`)
  }
  const fields: Record<string, string[]> = {
    production: ['environments', 'verify'], vue: ['root', 'typecheck', 'modes'],
    capacitor: ['root', 'packageJson', 'platforms', 'androidProject', 'iosProject', 'assets', 'locales', 'live', 'screenshots', 'prepare', 'prepareByEnv', 'build', 'buildByPlatform', 'environment', 'environmentByPlatform', 'afterSync', 'verify'],
    android: ['root', 'appId', 'module', 'apk', 'aab', 'mapping', 'javaHome', 'sdkRoot'],
    store: ['root', 'locales', 'appLocales', 'defaultLocale', 'defaultLocales', 'iosDevices', 'androidId', 'iosId', 'appleKey', 'playKey', 'iosProject', 'iosScheme', 'hooks', 'versionPackage'],
    electron: ['root', 'url', 'start', 'assets', 'output', 'builderConfig', 'notaryProfile', 'prepare'],
    swift: ['root', 'executable', 'plist', 'resources', 'entitlements', 'output', 'identity', 'icon', 'iconOutput'],
    vscode: ['root', 'prepare', 'noDependencies', 'output'], cloudflare: ['targets'], browser: ['root', 'directory', 'output', 'prepare']
  }
  const keys = (entry: unknown, allowed: string[], label: string) => {
    if (entry === undefined) return
    requireValue(entry !== null && typeof entry === 'object' && !Array.isArray(entry), `${label} must be an object`)
    for (const key of Object.keys(entry)) requireValue(allowed.includes(key), `Unknown ${label} field: ${key}`)
  }
  for (const [key, allowed] of Object.entries(fields)) keys(data[key], allowed, key)
  const hookList = (value: unknown) => { if (value === undefined) return; requireValue(Array.isArray(value), 'Hooks must be arrays of argv commands'); value.forEach(validateCommand) }
  for (const section of Object.values(data)) if (section && typeof section === 'object' && 'root' in section) requireValue(typeof section.root === 'string' && !!section.root, 'Module root must be a non-empty string')
  const config = data as unknown as Config
  keys(config.capacitor?.buildByPlatform, ['android', 'ios'], 'buildByPlatform')
  keys(config.capacitor?.environmentByPlatform, ['android', 'ios'], 'environmentByPlatform')
  keys(config.capacitor?.live, ['host', 'port', 'https', 'ca', 'timeout'], 'capacitor.live')
  keys(config.capacitor?.screenshots, ['output', 'sizes'], 'capacitor.screenshots')
  keys(config.store?.hooks, ['beforeUpload'], 'store.hooks')
  keys(config.store?.iosDevices, ['iphone', 'ipad', 'watch'], 'store.iosDevices')
  if (config.production?.environments) requireValue(Array.isArray(config.production.environments) && config.production.environments.length > 0 && config.production.environments.every(x => typeof x === 'string' && x.length), 'production.environments must be a non-empty string array')
  for (const target of Object.values(config.cloudflare?.targets ?? {})) keys(target, ['kind', 'root', 'config', 'directory', 'projectName', 'secretsFile', 'secretNames', 'prepare'], 'Cloudflare target')
  hookList(config.production?.verify)
  for (const section of [config.capacitor, config.electron, config.vscode, config.browser]) hookList(section?.prepare)
  hookList(config.capacitor?.afterSync); hookList(config.capacitor?.verify); hookList(config.store?.hooks?.beforeUpload)
  if (config.capacitor?.build) validateCommand(config.capacitor.build)
  for (const command of Object.values(config.capacitor?.buildByPlatform ?? {})) validateCommand(command)
  for (const commands of Object.values(config.capacitor?.prepareByEnv ?? {})) hookList(commands)
  for (const target of Object.values(config.cloudflare?.targets ?? {})) hookList(target.prepare)
  if (config.electron?.start) validateCommand(config.electron.start)
  if (config.vue?.typecheck !== undefined) requireValue([false, 'build', 'noEmit'].includes(config.vue.typecheck), 'vue.typecheck must be build, noEmit, or false')
  if (config.capacitor?.platforms) requireValue(config.capacitor.platforms.length > 0 && config.capacitor.platforms.every(p => ['android', 'ios'].includes(p)), 'Invalid Capacitor platforms')
  return config
}
export function validateCommand(value: unknown): asserts value is Command { requireValue(Array.isArray(value) && value.length > 0 && value.every(x => typeof x === 'string' && !x.includes('\0')), 'A hook must be a non-empty argv array, not a shell string') }
export async function loadConfig(cwd: string, explicit?: string): Promise<{ root: string; config: Config }> {
  let directory = resolve(cwd)
  while (true) {
    for (const name of explicit ? [resolve(cwd, explicit)] : ['reusable-dev-scripts.config.mjs', 'reusable-dev-scripts.config.json'].map(name => join(directory, name))) {
      if (existsSync(name)) {
        const value = name.endsWith('.json') ? JSON.parse(await readFile(name, 'utf8')) : (await import(pathToFileURL(name).href)).default
        return { root: dirname(name), config: validateConfig(value) }
      }
    }
    if (explicit) throw new Error('Specified configuration was not found')
    const parent = dirname(directory); if (parent === directory) break; directory = parent
  }
  return { root: resolve(cwd), config: { version: 1 } }
}
