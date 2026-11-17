import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { requireValue, writeChanged } from './runtime.js'
import type { Context } from './context.js'
import type { EnvModule } from './types.js'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => value !== null && typeof value === 'object' && !Array.isArray(value)

/** JSON with line comments, block comments and trailing commas: the editable per-environment file format. */
export function parseJson5(text: string): unknown {
  let out = '', inString = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (inString) {
      out += c
      if (c === '\\') out += text[++i] ?? ''
      else if (c === '"') inString = false
    } else if (c === '"') { inString = true; out += c }
    else if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n' }
    else if (c === '/' && text[i + 1] === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i++ }
    else out += c
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/gu, '$1'))
}
/** Deep-merges `fallback` into `current`; existing values always win and `undefined` defaults are dropped. */
export function mergeDefaults(current: unknown, fallback: unknown): unknown {
  if (fallback === undefined) return current
  if (current === undefined) return fallback
  if (!isObject(fallback) || !isObject(current)) return current
  const result: Json = { ...current }
  for (const [key, value] of Object.entries(fallback)) { const merged = mergeDefaults(current[key], value); if (merged !== undefined) result[key] = merged }
  return result
}
/** A random URL-safe secret for generated defaults. */
export function randomSecret(bytes = 48): string { return randomBytes(bytes).toString('base64url') }
/** Dotted paths of every value still `null`, the marker for "a human must fill this in". */
function missing(value: unknown, path = ''): string[] {
  if (value === null) return [path]
  return isObject(value) ? Object.entries(value).flatMap(([key, child]) => missing(child, path ? `${path}.${key}` : key)) : []
}

async function projectModule(ctx: Context, path: string): Promise<EnvModule> {
  const loaded = await import(pathToFileURL(ctx.path(path)).href) as Partial<EnvModule> & { default?: Partial<EnvModule> }
  const module = typeof loaded.defaults === 'function' ? loaded : loaded.default ?? loaded
  requireValue(typeof module.defaults === 'function', 'The env module must export a defaults(environment) function')
  requireValue([module.validate, module.outputs, module.header].every(x => x === undefined || typeof x === 'function'), 'The env module exports validate, outputs and header as functions only')
  return module as EnvModule
}

/** Per-environment configuration lifecycle: template, validate, generate, check. Project policy lives in `env.module`. */
export async function env(ctx: Context, action: string) {
  const config = ctx.section('env')
  requireValue(typeof config.module === 'string' && config.module.length > 0, 'Configure env.module first')
  requireValue(ctx.flags.env, 'env commands need an explicit --env')
  const name = ctx.environment, allowed = config.environments ?? ['development', 'staging', 'production']
  requireValue(allowed.includes(name), `--env must be one of ${allowed.join(', ')}`)
  const module = await projectModule(ctx, config.module)
  const file = ctx.path(join(config.directory ?? '.gitignored/environments', `${name}.json5`)), shown = relative(ctx.root, file)
  const hint = (kind: 'template' | 'generate') => (config.hints?.[kind] ?? `rds env ${kind} --env {env}`).replaceAll('{env}', name)

  const read = async (): Promise<Json | undefined> => {
    if (!existsSync(file)) return undefined
    const value = parseJson5(await readFile(file, 'utf8'))
    requireValue(isObject(value), `${shown} must contain an object`)
    return value
  }
  const defaults = (): Json => { const value = module.defaults(name); requireValue(isObject(value), 'env defaults must be an object'); return value }
  const template = async (): Promise<Json> => {
    const merged = mergeDefaults(await read() ?? {}, defaults()) as Json
    const header = [...(module.header?.(name) ?? [`${name} environment configuration. NEVER commit this file.`, `Edit values, then run: ${hint('generate')}`]), 'null = required value you must fill in.']
    const body = `${header.map(line => `// ${line}`).join('\n')}\n${JSON.stringify(merged, null, 2)}\n`
    const existed = existsSync(file)
    if (ctx.dryRun) ctx.log(`[plan] ${existed ? 'Update' : 'Create'} ${shown}`)
    else ctx.log(await writeChanged(file, body) ? `${existed ? 'Updated' : 'Created'} ${shown}` : `${shown} is up to date`)
    return merged
  }
  const load = async (autoCreate: boolean): Promise<Json> => {
    const current = await read()
    if (!current) {
      requireValue(autoCreate && (config.autoCreate ?? ['development']).includes(name), `Missing ${shown}. Run: ${hint('template')}`)
      return template()
    }
    return mergeDefaults(current, defaults()) as Json
  }
  const validate = (value: Json) => {
    const problems = [...new Set([...missing(value).map(path => `${path} is required`), ...(module.validate?.(name, value) ?? [])])]
    requireValue(!problems.length, `Invalid ${name} configuration (${shown}):\n${problems.map(problem => `  - ${problem}`).join('\n')}`)
  }
  const outputs = (value: Json) => (module.outputs?.(name, value) ?? []).map(output => {
    requireValue(typeof output?.path === 'string' && typeof output.content === 'string', 'env outputs must be { path, content } strings')
    return { path: ctx.path(output.path), content: output.content }
  })

  if (action === 'template') { await template(); return }
  if (action === 'validate') { validate(await load(false)); ctx.log(`${name} configuration is valid.`); return }
  const value = await load(action === 'generate'); validate(value)
  if (action === 'generate') {
    for (const output of outputs(value)) {
      if (ctx.dryRun) ctx.log(`[plan] Write ${relative(ctx.root, output.path)}`)
      else { await writeChanged(output.path, output.content); ctx.log(`Wrote ${relative(ctx.root, output.path)}`) }
    }
    return
  }
  const stale: string[] = []
  for (const output of outputs(value)) {
    const current = await readFile(output.path, 'utf8').catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; return undefined })
    if (current !== output.content) stale.push(relative(ctx.root, output.path))
  }
  requireValue(!stale.length, `Generated files are missing or stale: ${stale.join(', ')}. Run: ${hint('generate')}`)
  ctx.log(`${name} configuration is valid and generated files are current.`)
}
