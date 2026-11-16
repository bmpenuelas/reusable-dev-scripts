import { resolve } from 'node:path'
import { inside, requireValue, runProcess } from './runtime.js'
import { validateCommand } from './config.js'
import type { Command, Config, Flags, Invocation, Runner } from './types.js'

export class Context {
  readonly environment: string
  readonly dryRun: boolean
  readonly plan: Invocation[] = []
  constructor(public root: string, public config: Config, public flags: Flags, public runner: Runner = runProcess, public log: (message: string) => void = console.log) {
    this.environment = this.string('env', 'development'); this.dryRun = flags['dry-run'] === true
    requireValue(/^[a-zA-Z][\w-]*$/u.test(this.environment), 'Invalid environment name')
  }
  string(name: string, fallback = ''): string { const value = this.flags[name]; requireValue(value === undefined || typeof value === 'string', `--${name} needs a value`); return value ?? fallback }
  boolean(name: string): boolean { const value = this.flags[name]; requireValue(value === undefined || typeof value === 'boolean', `--${name} does not take a value`); return value === true }
  choice(name: string, choices: readonly string[], fallback: string): string { const value = this.string(name, fallback); requireValue(choices.includes(value), `--${name} must be ${choices.join(', ')}`); return value }
  path(path = '.'): string { return inside(this.root, path) }
  section<T extends keyof Config>(key: T): NonNullable<Config[T]> { const value = this.config[key]; requireValue(value, `Configure ${key} in reusable-dev-scripts.config.mjs first`); return value as NonNullable<Config[T]> }
  async run(command: string, args: string[], options: Partial<Omit<Invocation, 'command' | 'args'>> = {}) {
    const invocation = { command, args, cwd: options.cwd ?? this.root, ...options, env: { ...process.env, ...options.env, RDS_ENV: this.environment } }
    this.plan.push(invocation)
    // Never log argv, stdin, environment values or child error objects: they can contain credentials.
    this.log(`${this.dryRun ? '[plan]' : '[rds]'} ${options.label ?? command}`)
    return this.dryRun ? { stdout: '', stderr: '' } : this.runner(invocation)
  }
  environmentValues(values: Record<string, string> | undefined, platform = ''): NodeJS.ProcessEnv {
    return Object.fromEntries(Object.entries(values ?? {}).map(([key, value]) => {
      requireValue(/^[A-Za-z_][\w]*$/u.test(key) && typeof value === 'string', 'Environment mappings must have variable names and string values')
      return [key, value.replaceAll('{env}', this.environment).replaceAll('{platform}', platform).replaceAll('{root}', this.root)]
    }))
  }
  async hooks(commands: Command[] | undefined, cwd: string, platform = '', env: NodeJS.ProcessEnv = {}) {
    for (const command of commands ?? []) {
      validateCommand(command)
      const expanded = command.map(value => value.replaceAll('{env}', this.environment).replaceAll('{platform}', platform).replaceAll('{root}', this.root))
      await this.run(expanded[0]!, expanded.slice(1), { cwd, env, label: 'Project hook' })
    }
  }
  async guard(cwd = this.root, platform = '') {
    if (!(this.config.production?.environments ?? ['production']).includes(this.environment)) return
    requireValue(this.dryRun || this.boolean('allow-production'), 'Production operation requires --allow-production')
    await this.hooks(this.config.production?.verify, this.root, platform)
  }
  moduleRoot(key: 'vue' | 'capacitor' | 'android' | 'store' | 'electron' | 'swift' | 'vscode' | 'browser'): string {
    return this.path(this.config[key]?.root ?? '.')
  }
}
