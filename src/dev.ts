import { Failure, inside, requireValue } from './runtime.js'
import type { Context } from './context.js'

const colors = [36, 35, 33, 32, 34, 31]
type Outcome = { failure?: unknown }

/** Runs the configured long-lived processes together with line-prefixed output. The first exit stops the rest. */
export async function devStart(ctx: Context) {
  const config = ctx.section('dev'), root = ctx.moduleRoot('dev')
  requireValue(Array.isArray(config.processes) && config.processes.length > 0, 'Configure dev.processes first')
  const stop = new AbortController()
  let interrupted = false
  const interrupt = () => { interrupted = true }
  process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt)
  try {
    const running = config.processes.map(async (entry, index): Promise<Outcome> => {
      const [command, ...args] = entry.command
      const prefix = ctx.dryRun ? '' : `\u001b[${colors[index % colors.length]}m[${entry.name}]\u001b[0m `
      const env = { FORCE_COLOR: '1', ...ctx.environmentValues(entry.environment) }
      try {
        await ctx.run(command!, args, { cwd: inside(root, entry.root ?? '.'), env, label: `Dev process ${entry.name}`, signal: stop.signal, prefix })
        return {}
      } catch (failure) { return { failure } }
    })
    // Like a terminal multiplexer: whichever process ends first ends the session, and its result is the result.
    const first = await Promise.race(running)
    stop.abort()
    await Promise.all(running)
    if (first.failure && !interrupted) throw first.failure instanceof Failure ? first.failure : new Failure('A dev process failed')
  } finally {
    process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt)
  }
}
