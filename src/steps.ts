import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateCommand } from './config.js'
import { Failure, requireValue, runProcess } from './runtime.js'

export interface RunStepsOptions {
  cwd?: string;
  /** Plan every rds invocation; never pass this flag to a tool after `--`. */
  dryRun?: boolean;
  signal?: AbortSignal;
}

/** Sequential rds CLI calls, not a shell/task engine. Child output is inherited. */
export async function runSteps(steps: readonly (readonly string[])[], options: RunStepsOptions = {}): Promise<number> {
  requireValue(Array.isArray(steps), 'Steps must be an array of rds argv arrays')
  for (const step of steps) validateCommand(Array.isArray(step) ? [...step] : step)
  requireValue(options.cwd === undefined || typeof options.cwd === 'string' && options.cwd.length > 0 && !options.cwd.includes('\0'), 'Step cwd must be a non-empty directory')
  requireValue(options.dryRun === undefined || typeof options.dryRun === 'boolean', 'Step dryRun must be a boolean')
  requireValue(options.signal === undefined || options.signal instanceof AbortSignal, 'Step signal must be an AbortSignal')
  const cwd = resolve(options.cwd ?? process.cwd())
  const cli = fileURLToPath(new URL('../bin/rds.mjs', import.meta.url))
  let interrupted = options.signal?.aborted ? 143 : 0
  const interrupt = () => { interrupted = 130 }, terminate = () => { interrupted = 143 }
  process.on('SIGINT', interrupt); process.on('SIGTERM', terminate)
  options.signal?.addEventListener('abort', terminate, { once: true })
  try {
    for (const step of steps) {
      if (interrupted) return interrupted
      const separator = step.indexOf('--'), end = separator < 0 ? step.length : separator
      const args = options.dryRun && !step.slice(0, end).includes('--dry-run')
        ? [...step.slice(0, end), '--dry-run', ...step.slice(end)] : [...step]
      try {
        await runProcess({ command: process.execPath, args: [cli, ...args], cwd, signal: options.signal, label: 'rds step' })
      } catch (error) {
        if (!(error instanceof Failure)) throw error
        return interrupted || error.exitCode
      }
      // Cancellation is still failure if a child handles the signal and exits 0.
      if (interrupted) return interrupted
    }
    return interrupted
  } finally {
    process.off('SIGINT', interrupt); process.off('SIGTERM', terminate)
    options.signal?.removeEventListener('abort', terminate)
  }
}
