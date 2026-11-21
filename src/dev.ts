import { Failure, inside, requireValue } from './runtime.js'
import type { Context } from './context.js'
import { realTabHost, tabLaunches, type TabHost } from './tabs.js'

const colors = [36, 35, 33, 32, 34, 31]
type Outcome = { failure?: unknown }

/** The processes to start: every non-optional one plus the optional ones named in `--with a,b`. */
export function selectedProcesses(ctx: Context) {
  const processes = ctx.section('dev').processes
  const wanted = ctx.string('with').split(',').map(name => name.trim()).filter(Boolean)
  const optional = new Set(processes.filter(entry => entry.optional).map(entry => entry.name))
  for (const name of wanted) requireValue(optional.has(name), `--with must name an optional dev process; not found: ${name}`)
  const chosen = processes.filter(entry => !entry.optional || wanted.includes(entry.name))
  requireValue(chosen.length > 0, 'No dev process selected')
  return chosen
}

/** Runs the configured long-lived processes together with line-prefixed output. The first exit stops the rest. */
export async function devStart(ctx: Context) {
  const config = ctx.section('dev'), root = ctx.moduleRoot('dev')
  requireValue(Array.isArray(config.processes) && config.processes.length > 0, 'Configure dev.processes first')
  const stop = new AbortController()
  let interrupted = false
  const interrupt = () => { interrupted = true }
  process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt)
  try {
    const running = selectedProcesses(ctx).map(async (entry, index): Promise<Outcome> => {
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

/** Opens each selected process in its own terminal tab (or window) and returns; the processes keep running in the terminal. */
export async function devTabs(ctx: Context, host: TabHost = realTabHost()) {
  const root = ctx.moduleRoot('dev')
  const tabs = selectedProcesses(ctx).map(entry => ({ title: entry.name, cwd: inside(root, entry.root ?? '.'), command: entry.command, environment: ctx.environmentValues(entry.environment) }))
  let launches
  try { launches = tabLaunches(tabs, host) } catch (error) {
    // A plan must work on any host (CI has no terminal); a real run needs one.
    if (!ctx.dryRun) throw error
    ctx.log('[plan] Open terminal tabs (no supported terminal was found on this host)'); return
  }
  for (const launch of launches) await ctx.run(launch.command, launch.args, { cwd: root, label: launch.label, detached: launch.detached })
}
