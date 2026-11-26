import { readFile } from 'node:fs/promises'
import { parseEnv } from 'node:util'
import { requireValue } from './runtime.js'
import type { Context } from './context.js'

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(value)
}

/** Local credentials never become command arguments, logs, or backend variables. */
export async function credentials(ctx: Context, file?: string): Promise<NodeJS.ProcessEnv> {
  return { ...(file ? parseEnv(await readFile(ctx.path(file), 'utf8')) : {}), ...process.env }
}

export async function environmentFile(ctx: Context, file: string, exclude: readonly string[] = []): Promise<Record<string, string>> {
  const values = parseEnv(await readFile(ctx.path(file), 'utf8'))
  const result = Object.fromEntries(Object.entries(values).filter((entry): entry is [string, string] => entry[1] !== undefined && !exclude.includes(entry[0])))
  requireValue(Object.keys(result).length > 0, 'Refusing to replace a remote environment with an empty file')
  requireValue(!Object.keys(result).some(key => /^(?:HOSTINGER_API_TOKEN|CLOUDFLARE_API_TOKEN)$/u.test(key)), 'Deployment tokens must not be sent to an application')
  return result
}

/** No response bodies or underlying fetch errors are surfaced: either can contain secrets. */
export async function remoteJson(fetcher: typeof fetch, url: string, token: string, method = 'GET', body?: unknown, allowMissing = false): Promise<unknown> {
  let response: Response
  try {
    response = await fetcher(url, {
      method, redirect: 'error', signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  } catch { throw new Error('Provider request failed; check connectivity and credentials') }
  if (allowMissing && response.status === 404) return undefined
  requireValue(response.ok, `Provider request failed (HTTP ${response.status}); inspect the provider dashboard`)
  if (response.status === 204) return null
  let value: unknown
  try { value = await response.json() } catch { throw new Error('Provider returned invalid JSON') }
  requireValue(!value || typeof value !== 'object' || !('success' in value) || value.success !== false, 'Provider rejected the request; inspect the provider dashboard')
  return value
}

export function record(value: unknown): Record<string, unknown> {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), 'Unexpected provider response object')
  return value as Record<string, unknown>
}

export function payload(value: unknown): unknown {
  const object = record(value)
  return object.result ?? object.data ?? object
}

export function rows(value: unknown): Record<string, unknown>[] {
  let current = value
  for (let i = 0; i < 4 && !Array.isArray(current); i++) current = payload(current)
  requireValue(Array.isArray(current) && current.every(row => row !== null && typeof row === 'object' && !Array.isArray(row)), 'Unexpected provider response list')
  return current as Record<string, unknown>[]
}
