import { setTimeout as sleep } from 'node:timers/promises'
import { requireValue } from './runtime.js'

/*
 * Bunny.net mechanics for project scripts: a careful API client, self-contained edge script sources and a verified edge
 * script deployment. Which zone, rules, secrets and checks a project wants is its own policy and stays in the project.
 */

type Json = Record<string, unknown>
export type ProviderFetch = (url: string, init: RequestInit) => Promise<Response>
export interface ProviderOptions { fetcher?: ProviderFetch; pause?: (milliseconds: number) => Promise<unknown>; timeout?: number }
export interface ProviderCall { method?: string; body?: unknown; readOnly?: boolean; discard?: boolean }
export type ProviderRequest = (operation: string, path: string, options?: ProviderCall) => Promise<unknown>

/** Carries the provider, the operation and the HTTP status only. Provider bodies and network errors can contain secrets. */
export class ProviderError extends Error {
  readonly status: number | undefined
  constructor(provider: string, operation: string, status?: number) {
    const known: Record<number, string> = { 401: 'check credentials', 402: 'check balance/billing', 403: 'check token scope/account status', 404: 'resource not found', 409: 'conflict', 429: 'rate limited' }
    const reason = (status && known[status]) ?? (status === undefined ? 'network, timeout or invalid response' : status >= 500 ? 'provider unavailable' : 'request rejected')
    super(`${provider} ${operation}: ${status ? `HTTP ${status}, ` : ''}${reason}.`)
    this.name = 'ProviderError'
    this.status = status
  }
}

/** JSON over HTTPS without redirects. Only reads are retried: a write whose answer was lost is left for the operator to inspect. */
export function providerRequest(provider: string, base: string, headers: Record<string, string>, { fetcher = fetch as ProviderFetch, pause = sleep, timeout = 10_000 }: ProviderOptions = {}): ProviderRequest {
  return async (operation, path, { method = 'GET', body, readOnly = method === 'GET', discard = false } = {}) => {
    for (let attempt = 0; ; attempt++) {
      let response: Response | undefined
      try {
        response = await fetcher(base + path, {
          method, redirect: 'error', signal: AbortSignal.timeout(timeout),
          headers: { Accept: 'application/json', ...headers, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
        if (response.ok) {
          if (discard) { await response.body?.cancel(); return null }
          const text = await response.text()
          return text.trim() ? JSON.parse(text) : null
        }
        await response.body?.cancel()
      } catch { /* never surface the exception or the body */ }
      const status = response && !response.ok ? response.status : undefined
      const retryAfter = response?.headers.get('retry-after')
      const delay = retryAfter ? (/^\d+$/u.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now()) : 0
      if (!readOnly || attempt >= 2 || (status !== undefined && status !== 429 && status < 500) || delay > 4000) throw new ProviderError(provider, operation, status)
      await pause(Math.max(250 * 2 ** attempt + Math.floor(Math.random() * 150), delay || 0))
    }
  }
}

const validId = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0
const zonePath = (id: unknown) => { requireValue(validId(id), 'Invalid Bunny Pull Zone ID'); return `/pullzone/${id}` }

export interface BunnyScript {
  readonly id: number
  metadata(): Promise<unknown>
  secrets(): Promise<unknown>
  draft(): Promise<unknown>
  release(): Promise<unknown>
  writeVariable(name: string, value: string): Promise<unknown>
  writeSecret(name: string, value: string): Promise<unknown>
  writeDraft(code: string): Promise<unknown>
  publish(note: string): Promise<unknown>
}

/** Pull Zone, edge rule, certificate, edge script and usage calls. Nothing here decides what a zone should look like. */
export function bunnyClient(accessKey: string, options: ProviderOptions = {}) {
  const call = providerRequest('Bunny', 'https://api.bunny.net', { AccessKey: accessKey }, options)
  return {
    async listZones() {
      // Without a page parameter the documented response is the whole account.
      const zones = await call('list zones', '/pullzone')
      requireValue(Array.isArray(zones) && zones.every((zone: Json | null) => validId(zone?.Id) && Array.isArray(zone?.Hostnames)), 'Bunny returned an invalid Pull Zone list')
      return zones as Json[]
    },
    zone: (id: number) => call('read zone', zonePath(id)),
    create: (body: Json) => call('create zone', '/pullzone', { method: 'POST', body }),
    update: (id: number, body: Json) => call('update zone', zonePath(id), { method: 'POST', body, discard: true }),
    hostname: (id: number, Hostname: string) => call('add hostname', `${zonePath(id)}/addHostname`, { method: 'POST', body: { Hostname }, discard: true }),
    forceTls: (id: number, Hostname: string) => call('force TLS', `${zonePath(id)}/setForceSSL`, { method: 'POST', body: { Hostname, ForceSSL: true }, discard: true }),
    // This GET issues a certificate, so it is never retried as a read.
    cert: (hostname: string) => call('issue certificate', `/pullzone/loadFreeCertificate?${new URLSearchParams({ hostname })}`, { readOnly: false, discard: true }),
    rule: (id: number, body: Json) => call('write edge rule', `${zonePath(id)}/edgerules/addOrUpdate`, { method: 'POST', body, discard: true }),
    purge: (id: number) => call('purge zone cache', `${zonePath(id)}/purgeCache`, { method: 'POST', discard: true }),
    statistics: (id: number) => call('read usage', `/statistics?${new URLSearchParams({ pullZone: String(id), loadBandwidthUsed: 'true', loadRequestsServed: 'true' })}`),
    billing: () => call('read billing summary', '/billing/summary'),
    script(id: number, label = 'edge script'): BunnyScript {
      requireValue(validId(id), 'Invalid Bunny edge script ID')
      const base = `/compute/script/${id}`
      return {
        id,
        metadata: () => call(`read ${label} metadata`, base),
        secrets: () => call(`read ${label} secret names`, `${base}/secrets`),
        draft: () => call(`read ${label} draft`, `${base}/code`),
        release: () => call(`read published ${label}`, `${base}/releases/active`),
        writeVariable: (Name, DefaultValue) => call(`write ${label} setting`, `${base}/variables`, { method: 'PUT', body: { Name, DefaultValue, Required: true }, discard: true }),
        writeSecret: (Name, Secret) => call(`write encrypted ${label} secret`, `${base}/secrets`, { method: 'PUT', body: { Name, Secret }, discard: true }),
        writeDraft: Code => call(`upload ${label} draft`, `${base}/code`, { method: 'POST', body: { Code }, discard: true }),
        publish: Note => call(`publish ${label}`, `${base}/publish`, { method: 'POST', body: { Note }, discard: true }),
      }
    },
  }
}

const canonical = (code: unknown) => (typeof code === 'string' ? code.replace(/\r\n/gu, '\n').trimEnd() : null)
/** Whether a published release (or a draft, with `published: false`) is exactly this source. */
export function edgeScriptMatches(value: unknown, source: string, { published = true } = {}): boolean {
  const release = value as Json | null
  return canonical(release?.Code) === canonical(source) && (!published || (Boolean(release?.DatePublished) && release?.Deleted === false))
}

/**
 * One self-contained edge script from ES modules, in order: relative imports between them are dropped and exports become
 * plain declarations. The result does not depend on the checkout's line endings. Anything it cannot inline is an error.
 */
export function edgeScriptSource(modules: string[], { imports = '', main = '' }: { imports?: string; main?: string } = {}): string {
  const body = modules.map(module => module.replace(/\r\n?/gu, '\n')
    .replace(/^import\s[^;'"]*?from\s*(['"])\.{1,2}\/[^'"\n]+\1[ \t]*;?[ \t]*(?:\n|$)/gmu, '')
    .replace(/^export\s+(?=(?:async\s+function|function|const|let|class)\b)/gmu, '')).join('\n')
  requireValue(!/^\s*(?:import|export)\b/mu.test(body), 'An edge script module contains an import or export that cannot be inlined')
  return [imports, body, main].map(part => part.replace(/\r\n?/gu, '\n').trim()).filter(Boolean).join('\n') + '\n'
}

const rows = (value: unknown) => (Array.isArray(value) ? value as (Json | null)[] : [])
/** Every name is stored exactly once as an encrypted secret. */
export const hasEdgeSecrets = (metadata: unknown, names: string[]) => names.every(name => rows((metadata as Json | null)?.Secrets).filter(item => item?.Name === name).length === 1)

export interface EdgeScriptTarget {
  name: string
  /** Bunny script type: 1 standalone, 2 middleware. */
  type: number
  /** The only Pull Zone that may use the script; a script linked anywhere else is refused. */
  zoneId?: number
  secretNames: string[]
}

/** Refuses a script that is not the reviewed one, is linked elsewhere, or holds a secret as a readable variable. */
export async function assertEdgeScript(script: BunnyScript, target: EdgeScriptTarget): Promise<Json> {
  const metadata = await script.metadata() as Json | null
  const links = metadata?.LinkedPullZones
  requireValue(metadata && metadata.Id === script.id && metadata.Name === target.name && metadata.ScriptType === target.type && metadata.Deleted === false &&
    Array.isArray(links) && links.every(link => target.zoneId !== undefined && (link === target.zoneId || (link as Json | null)?.Id === target.zoneId)) &&
    Array.isArray(metadata.EdgeScriptVariables) && !rows(metadata.EdgeScriptVariables).some(item => target.secretNames.includes(String(item?.Name))),
  `Bunny edge script ${target.name} is not the reviewed script, is linked to another Pull Zone, or stores a secret as a variable`)
  return metadata
}

export interface EdgeScriptDeployment extends EdgeScriptTarget {
  source: string
  variables: Record<string, string>
  secrets: Record<string, string>
  note: string
  poll?: (check: () => Promise<boolean>) => Promise<boolean>
}

/** Settings, encrypted secrets, draft and release, each read back before the next step. Safe to repeat on a live script. */
export async function deployEdgeScript(script: BunnyScript, { source, variables, secrets, note, poll, ...target }: EdgeScriptDeployment) {
  requireValue(source.trim() && !Object.values(secrets).some(value => !value || source.includes(value)), 'An edge script source must not contain its secrets')
  await assertEdgeScript(script, target)
  for (const [name, value] of Object.entries(variables)) await script.writeVariable(name, value)
  const stored = rows((await assertEdgeScript(script, target)).EdgeScriptVariables)
  for (const [name, value] of Object.entries(variables)) {
    const found = stored.filter(item => item?.Name === name)
    requireValue(found.length === 1 && found[0]!.DefaultValue === value && found[0]!.Required === true, `Bunny did not confirm the ${target.name} settings; nothing was published`)
  }
  for (const [name, value] of Object.entries(secrets)) await script.writeSecret(name, value)
  requireValue(hasEdgeSecrets(await script.secrets(), Object.keys(secrets)), `Bunny did not confirm the ${target.name} secrets; nothing was published`)
  await script.writeDraft(source)
  requireValue(edgeScriptMatches(await script.draft(), source, { published: false }), `Bunny did not confirm the ${target.name} draft; nothing was published`)
  await assertEdgeScript(script, target)
  await script.publish(note)
  const released = async () => edgeScriptMatches(await script.release().catch((error: unknown) => {
    if (error instanceof ProviderError && error.status === 404) return null
    throw error
  }), source)
  requireValue(await (poll ?? defaultPoll)(released), `Bunny did not confirm the published ${target.name} release`)
}

async function defaultPoll(check: () => Promise<boolean>) {
  for (let attempt = 0; attempt < 6; attempt++) {
    if (await check()) return true
    if (attempt < 5) await sleep(2000)
  }
  return false
}

const cloudflareId = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{32}$/u.test(value)
const dnsName = (value: unknown) => String(value ?? '').toLowerCase().replace(/\.$/u, '')
export interface DnsOnlyCname { type: 'CNAME'; name: string; content: string; proxied: false; ttl: number }

/** One DNS-only CNAME in a Cloudflare zone, matched by exact name. Records of any other name are never read or written. */
export function cloudflareDnsOnlyCname({ zoneId, zoneName, hostname, target, token }: { zoneId: string; zoneName: string; hostname: string; target: string; token: string }, options: ProviderOptions = {}) {
  const call = providerRequest('Cloudflare', 'https://api.cloudflare.com/client/v4', { Authorization: `Bearer ${token}` }, options)
  const result = async (operation: string, path: string, init?: ProviderCall) => {
    const value = await call(operation, path, init) as Json | null
    requireValue(value?.success === true && Object.hasOwn(value, 'result'), `Cloudflare ${operation}: invalid API envelope`)
    return value as Json & { result: unknown }
  }
  const base = () => { requireValue(cloudflareId(zoneId), 'Invalid Cloudflare zone ID'); return `/zones/${zoneId}/dns_records` }
  return {
    async records() {
      const zone = (await result('read zone', `/zones/${zoneId}`)).result as Json | null
      requireValue(zone?.id === zoneId && dnsName(zone.name) === zoneName, 'The Cloudflare zone ID does not match the configured zone name')
      const value = await result('list DNS records', `${base()}?${new URLSearchParams({ 'name.exact': hostname, per_page: '100', page: '1' })}`)
      const info = value.result_info as Json | undefined
      requireValue(Array.isArray(value.result) && value.result.length < 100 && !(Number(info?.total_pages) > 1) &&
        value.result.every((record: Json | null) => dnsName(record?.name) === hostname && cloudflareId(record?.id)), 'Cloudflare returned an unexpected exact-name DNS record list')
      return value.result as Json[]
    },
    async write(record: DnsOnlyCname, id?: string) {
      requireValue(record.name === hostname && record.proxied === false && record.type === 'CNAME' && record.content === target && (!id || cloudflareId(id)), 'Unsafe DNS write refused')
      return (await result('write DNS-only CNAME', id ? `${base()}/${id}` : base(), { method: id ? 'PATCH' : 'POST', body: record })).result as Json
    },
  }
}
