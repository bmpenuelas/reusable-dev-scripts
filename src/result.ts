import { stripVTControlCharacters } from 'node:util'
import { commands, main, parse } from './cli.js'
import { requireValue } from './runtime.js'
import type { Config, Flags, Runner } from './types.js'

type Outcome = 'success' | 'failure' | 'plan'
export function supportsBannerColor(stream = process.stderr, env = process.env): boolean {
  if (Object.hasOwn(env, 'NO_COLOR') || env.TERM === 'dumb' || env.FORCE_COLOR === '0') return false
  return Boolean(env.FORCE_COLOR || stream.isTTY && (stream.hasColors?.() ?? true))
}

export function formatResultBanner(outcome: Outcome, message: string, now = new Date(), color = false): string {
  const heading = { success: '✅  SUCCESS', failure: '❌  FAILED', plan: '📝  PLAN COMPLETE' }[outcome]
  const body = stripVTControlCharacters(message).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/gu, '')
  const border = '='.repeat(64)
  const text = `${border}\n${heading}\n${now.toISOString()}\n\n${body}\n${border}`
  const code = outcome === 'failure' ? 31 : outcome === 'success' ? 32 : 36
  return `\n${color ? `\u001b[1;${code}m${text}\u001b[0m` : text}\n`
}

export function bannersEnabled(flags: Flags, config: Config, env = process.env): boolean {
  // The outer CLI owns the result even when descendants request --banner.
  if (env.RDS_BANNER_OWNER === '1') return false
  if (flags['no-banner']) return false
  if (flags.banner) return true
  requireValue(env.RDS_BANNERS === undefined || ['0', '1'].includes(env.RDS_BANNERS), 'RDS_BANNERS must be 0 or 1')
  if (env.RDS_BANNERS !== undefined) return env.RDS_BANNERS === '1'
  return config.output?.banners ?? true
}

export interface CliOptions {
  runner?: Runner;
  log?: (message: string) => void;
  error?: (message: string) => void;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  color?: boolean;
}

/** Executable boundary: library main()/Context callers retain their existing logging. */
export async function runCli(argv: string[], options: CliOptions = {}): Promise<number> {
  const env = options.env ?? process.env, now = options.now ?? (() => new Date())
  const write = (message: string) => {
    // A closed/broken output stream must not replace the workflow's exit status.
    try { (options.error ?? console.error)(message) } catch { /* Nothing more can be reported. */ }
  }
  const ownArgs = argv.slice(0, argv.includes('--') ? argv.indexOf('--') : argv.length)
  let enabled = env.RDS_BANNER_OWNER !== '1' && !ownArgs.includes('--no-banner') && (ownArgs.includes('--banner') || env.RDS_BANNERS !== '0')
  let label = 'rds command', plan = false
  const banner = (outcome: Outcome, message: string) => {
    if (enabled) write(formatResultBanner(outcome, message, now(), options.color ?? supportsBannerColor(process.stderr, env)))
  }
  try {
    if (argv.length === 1 && argv[0] === '--version') { await main(argv, options.runner, options.log); return 0 }
    const { key, flags } = parse(argv)
    if (!key || flags.help === true) { await main(argv, options.runner, options.log); return 0 }
    enabled = bannersEnabled(flags, { version: 1 }, env)
    if (Object.hasOwn(commands, key)) label = `rds ${key}`
    plan = flags['dry-run'] === true
    await main(argv, options.runner, options.log, ctx => {
      enabled = bannersEnabled(flags, ctx.config, env)
      ctx.resultBannerOwner = true
    })
    banner(plan ? 'plan' : 'success', plan ? `${label}: plan complete. No command steps were executed.` : `${label} completed with exit code 0.`)
    return 0
  } catch (error) {
    const value = error && typeof error === 'object' && 'exitCode' in error ? error.exitCode : undefined
    const code = typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 255 ? value : 1
    write(`rds: ${error instanceof Error ? error.message : 'Command failed'}`)
    banner('failure', `${label} exited with code ${code}.\nSee the diagnostics above; do not continue until the failure is resolved.`)
    return code
  }
}
