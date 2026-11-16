import type { Context } from './context.js'
export async function vueBuild(ctx: Context, root = ctx.moduleRoot('vue'), check = ctx.config.vue?.typecheck ?? 'noEmit', env: NodeJS.ProcessEnv = {}) {
  if (!ctx.boolean('skip-typecheck') && check !== false) await ctx.run('vue-tsc', [check === 'build' ? '--build' : '--noEmit'], { cwd: root, label: 'Vue typecheck' })
  const mode = ctx.string('mode', ctx.config.vue?.modes?.[ctx.environment] ?? (ctx.flags.env ? ctx.environment : 'production'))
  await ctx.run('vite', ['build', '--mode', mode], { cwd: root, env, label: 'Vite build' })
}
