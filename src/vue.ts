import type { Context } from './context.js'
import { requireValue } from './runtime.js'
export async function vueBuild(ctx: Context, root = ctx.moduleRoot('vue'), check = ctx.config.vue?.typecheck ?? 'noEmit', env: NodeJS.ProcessEnv = {}, forwarded: string[] = []) {
  const forwardedMode = forwarded.some(arg => arg === '--mode' || arg.startsWith('--mode='))
  requireValue(!forwardedMode || ctx.flags.mode === undefined, 'Select --mode either as an rds option or in Vite arguments, not both')
  if (!ctx.boolean('skip-typecheck') && check !== false) await ctx.run('vue-tsc', [check === 'build' ? '--build' : '--noEmit'], { cwd: root, label: 'Vue typecheck' })
  const mode = ctx.string('mode', ctx.config.vue?.modes?.[ctx.environment] ?? (ctx.flags.env ? ctx.environment : 'production'))
  await ctx.run('vite', ['build', ...(forwardedMode ? [] : ['--mode', mode]), ...forwarded], { cwd: root, env, label: 'Vite build' })
}
