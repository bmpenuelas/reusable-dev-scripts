import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { requireValue } from './runtime.js'
import { validateBuildSettings } from './build-settings.js'
import type { Config, Command } from './types.js'

export function defineConfig(config: Config): Config { return validateConfig(config) }
export function validateConfig(value: unknown): Config {
  requireValue(value && typeof value === 'object' && !Array.isArray(value), 'Configuration must be an object')
  const data = value as Record<string, unknown>
  requireValue(data.version === 1, 'Configuration version must be 1')
  const allowed = ['version', 'output', 'production', 'vue', 'capacitor', 'android', 'store', 'electron', 'swift', 'vscode', 'cloudflare', 'browser', 'dev', 'wait', 'env', 'prisma', 'platformio', 'buildSettings', 'hostinger', 'defaultEnvironment']
  for (const [key, section] of Object.entries(data)) {
    requireValue(allowed.includes(key), `Unknown configuration section: ${key}`)
    if (key !== 'version' && key !== 'defaultEnvironment') requireValue(section && typeof section === 'object' && !Array.isArray(section), `Invalid ${key} configuration`)
  }
  const fields: Record<string, string[]> = {
    output: ['banners'],
    production: ['environments', 'verify'], vue: ['root', 'typecheck', 'modes'],
    capacitor: ['root', 'packageJson', 'platforms', 'androidProject', 'iosProject', 'assets', 'locales', 'live', 'screenshots', 'prepare', 'prepareByEnv', 'build', 'buildByPlatform', 'environment', 'environmentByPlatform', 'afterBuild', 'afterSync', 'verify', 'androidModules'],
    android: ['root', 'appId', 'module', 'apk', 'aab', 'mapping', 'javaHome', 'sdkRoot'],
    store: ['root', 'locales', 'appLocales', 'defaultLocale', 'defaultLocales', 'iosDevices', 'androidId', 'iosId', 'appleKey', 'playKey', 'allowExternalCredentials', 'iosProject', 'iosScheme', 'hooks', 'versionPackage'],
    electron: ['root', 'url', 'start', 'assets', 'output', 'builderConfig', 'notaryProfile', 'prepare'],
    swift: ['root', 'executable', 'plist', 'resources', 'entitlements', 'output', 'identity', 'icon', 'iconOutput'],
    vscode: ['root', 'prepare', 'noDependencies', 'output'], cloudflare: ['targets', 'credentialsFile'], hostinger: ['targets', 'credentialsFile'], browser: ['root', 'directory', 'output', 'prepare'],
    dev: ['root', 'processes'], wait: ['targets'], env: ['directory', 'module', 'environments', 'autoCreate', 'hints'], prisma: ['root', 'envFile', 'variable'], platformio: ['root', 'coreDir'], buildSettings: ['android', 'ios']
  }
  if (data.defaultEnvironment !== undefined) requireValue(typeof data.defaultEnvironment === 'string' && /^[a-zA-Z][\w-]*$/u.test(data.defaultEnvironment), 'defaultEnvironment must be an environment name')
  const keys = (entry: unknown, allowed: string[], label: string) => {
    if (entry === undefined) return
    requireValue(entry !== null && typeof entry === 'object' && !Array.isArray(entry), `${label} must be an object`)
    for (const key of Object.keys(entry)) requireValue(allowed.includes(key), `Unknown ${label} field: ${key}`)
  }
  for (const [key, allowed] of Object.entries(fields)) keys(data[key], allowed, key)
  const hookList = (value: unknown) => { if (value === undefined) return; requireValue(Array.isArray(value), 'Hooks must be arrays of argv commands'); value.forEach(validateCommand) }
  for (const section of Object.values(data)) if (section && typeof section === 'object' && 'root' in section) requireValue(typeof section.root === 'string' && !!section.root, 'Module root must be a non-empty string')
  const config = data as unknown as Config
  if (config.store?.allowExternalCredentials !== undefined) requireValue(typeof config.store.allowExternalCredentials === 'boolean', 'store.allowExternalCredentials must be a boolean')
  for (const name of ['playKey', 'appleKey'] as const) {
    const value = config.store?.[name]
    if (value !== undefined) requireValue(typeof value === 'string' && value.length > 0 && !value.includes('\0'), `store.${name} must be a non-empty filename`)
  }
  if (config.output?.banners !== undefined) requireValue(typeof config.output.banners === 'boolean', 'output.banners must be a boolean')
  keys(config.capacitor?.buildByPlatform, ['android', 'ios'], 'buildByPlatform')
  keys(config.capacitor?.environmentByPlatform, ['android', 'ios'], 'environmentByPlatform')
  keys(config.capacitor?.live, ['host', 'port', 'https', 'ca', 'timeout'], 'capacitor.live')
  keys(config.capacitor?.screenshots, ['output', 'sizes'], 'capacitor.screenshots')
  if (config.capacitor?.androidModules !== undefined) {
    requireValue(Array.isArray(config.capacitor.androidModules) && config.capacitor.androidModules.length > 0, 'capacitor.androidModules must be a non-empty array')
    for (const module of config.capacitor.androidModules) {
      keys(module, ['project', 'versionCodeOffset'], 'capacitor.androidModules entry')
      requireValue(typeof module.project === 'string' && module.project.length > 0 && !module.project.includes('\0'), 'capacitor.androidModules project must be a non-empty build.gradle path')
      if (module.versionCodeOffset !== undefined) requireValue(Number.isSafeInteger(module.versionCodeOffset) && module.versionCodeOffset >= 0, 'capacitor.androidModules versionCodeOffset must be a non-negative integer')
    }
  }
  keys(config.store?.hooks, ['beforeUpload', 'afterBuildUpload'], 'store.hooks')
  validateBuildSettings(config.buildSettings)
  keys(config.store?.iosDevices, ['iphone', 'ipad', 'watch'], 'store.iosDevices')
  if (config.production?.environments) requireValue(Array.isArray(config.production.environments) && config.production.environments.length > 0 && config.production.environments.every(x => typeof x === 'string' && x.length), 'production.environments must be a non-empty string array')
  const cloudflareFields = ['kind', 'root', 'config', 'directory', 'projectName', 'accountId', 'domains', 'secretsFile', 'secretNames', 'commitDirty', 'branch', 'wranglerEnv', 'prepare', 'zoneId', 'wwwRedirect', 'redirectRef', 'd1Database', 'secretsModule']
  const hostingerFields = ['domain', 'username', 'directory', 'envFile', 'excludeEnv', 'databaseVariable', 'nodeVersion', 'entryFile', 'buildScript', 'cron']
  for (const [provider, fields] of [[config.cloudflare, cloudflareFields], [config.hostinger, hostingerFields]] as const) {
    if (!provider) continue
    requireValue(provider.targets && typeof provider.targets === 'object' && !Array.isArray(provider.targets), 'Provider targets must be an object')
    if (provider.credentialsFile !== undefined) requireValue(typeof provider.credentialsFile === 'string' && provider.credentialsFile.length > 0, 'credentialsFile must be a non-empty filename')
    for (const target of Object.values(provider.targets)) {
      keys(target, [...fields, 'environments'], 'provider target')
      if (target.environments !== undefined) requireValue(target.environments && typeof target.environments === 'object' && !Array.isArray(target.environments), 'Target environments must be an object')
      for (const [environment, override] of Object.entries(target.environments ?? {})) {
        requireValue(/^[a-zA-Z][\w-]*$/u.test(environment), 'Invalid target environment')
        keys(override, [...fields], 'provider environment')
      }
      for (const settings of [target, ...Object.values(target.environments ?? {})]) {
        for (const [key, value] of Object.entries(settings)) {
          if (key === 'environments') continue
          if (key === 'prepare') { hookList(value); continue }
          if (key === 'branch') { requireValue(typeof value === 'string' && /^[\w][\w./-]*$/u.test(value), 'Pages branch must be a branch name'); continue }
          if (key === 'wranglerEnv') { requireValue(value === false || (typeof value === 'string' && /^[a-zA-Z][\w-]*$/u.test(value)), 'wranglerEnv must be an environment name or false'); continue }
          if (key === 'commitDirty') { requireValue(typeof value === 'boolean', 'commitDirty must be a boolean'); continue }
          if (key === 'wwwRedirect') { requireValue(typeof value === 'boolean', 'wwwRedirect must be a boolean'); continue }
          if (key === 'zoneId') { requireValue(typeof value === 'string' && /^[a-fA-F0-9]{32}$/u.test(value), 'zoneId must be a 32-character hexadecimal zone ID'); continue }
          if (key === 'redirectRef') { requireValue(typeof value === 'string' && /^[A-Za-z0-9_]{1,50}$/u.test(value), 'redirectRef must be letters, digits and underscores'); continue }
          if (key === 'd1Database') { requireValue(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(value), 'd1Database must be a database name'); continue }
          if (['domains', 'excludeEnv', 'secretNames'].includes(key)) { requireValue(Array.isArray(value) && value.every(x => typeof x === 'string' && x.length), key + ' must be a string array'); continue }
          if (key === 'nodeVersion') { requireValue([22, 24].includes(value as number), 'Hostinger nodeVersion must be 22 or 24'); continue }
          if (key === 'cron') {
            keys(value, ['command', 'schedule'], 'Hostinger cron')
            const cron = value as { command?: unknown; schedule?: unknown }
            requireValue(typeof cron?.command === 'string' && cron.command.length > 0 && typeof cron.schedule === 'string' && cron.schedule.length > 0, 'Hostinger cron needs command and schedule')
            continue
          }
          requireValue(typeof value === 'string' && value.length > 0 && !value.includes('\0'), key + ' must be a non-empty string')
        }
      }
    }
  }
  keys(config.env?.hints, ['template', 'generate'], 'env.hints')
  if (config.dev) {
    requireValue(Array.isArray(config.dev.processes) && config.dev.processes.length > 0, 'dev.processes must be a non-empty array')
    const names = new Set<string>()
    for (const entry of config.dev.processes) {
      keys(entry, ['name', 'command', 'root', 'environment', 'optional'], 'dev process')
      requireValue(typeof entry.name === 'string' && /^[\w.-]+$/u.test(entry.name) && !names.has(entry.name), 'dev process names must be unique and use letters, digits, dot, dash or underscore')
      names.add(entry.name); validateCommand(entry.command)
      if (entry.root !== undefined) requireValue(typeof entry.root === 'string' && entry.root.length > 0, 'dev process root must be a non-empty string')
      if (entry.optional !== undefined) requireValue(typeof entry.optional === 'boolean', 'dev process optional must be a boolean')
    }
  }
  if (config.wait) requireValue(config.wait.targets && typeof config.wait.targets === 'object' && !Array.isArray(config.wait.targets), 'wait.targets must be an object')
  for (const target of Object.values(config.wait?.targets ?? {})) {
    keys(target, ['host', 'port', 'url', 'variable', 'envFile', 'timeout', 'hint'], 'wait target')
    requireValue(!!(target.url || target.variable || (target.host && target.port)), 'A wait target needs host and port, a url, or a variable')
    for (const field of ['port', 'timeout'] as const) if (target[field] !== undefined) requireValue(typeof target[field] === 'number' && target[field] > 0, `wait target ${field} must be a positive number`)
    for (const field of ['host', 'url', 'variable', 'envFile', 'hint'] as const) if (target[field] !== undefined) requireValue(typeof target[field] === 'string' && target[field].length > 0, `wait target ${field} must be a non-empty string`)
  }
  if (config.env) {
    requireValue(typeof config.env.module === 'string' && config.env.module.length > 0, 'env.module must be a non-empty string')
    for (const field of ['environments', 'autoCreate'] as const) if (config.env[field] !== undefined) requireValue(Array.isArray(config.env[field]) && config.env[field].every(x => typeof x === 'string' && /^[a-zA-Z][\w-]*$/u.test(x)), `env.${field} must be an array of environment names`)
  }
  if (config.prisma) requireValue(typeof config.prisma.envFile === 'string' && config.prisma.envFile.length > 0, 'prisma.envFile must be a non-empty string')
  if (config.prisma?.variable !== undefined) requireValue(typeof config.prisma.variable === 'string' && /^[A-Za-z_]\w*$/u.test(config.prisma.variable), 'prisma.variable must be an environment variable name')
  if (config.platformio?.coreDir !== undefined) requireValue(typeof config.platformio.coreDir === 'string' && config.platformio.coreDir.length > 0 && !config.platformio.coreDir.includes('\0'), 'platformio.coreDir must be a non-empty path')
  hookList(config.production?.verify)
  for (const section of [config.capacitor, config.electron, config.vscode, config.browser]) hookList(section?.prepare)
  hookList(config.capacitor?.afterBuild); hookList(config.capacitor?.afterSync); hookList(config.capacitor?.verify); hookList(config.store?.hooks?.beforeUpload); hookList(config.store?.hooks?.afterBuildUpload)
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
