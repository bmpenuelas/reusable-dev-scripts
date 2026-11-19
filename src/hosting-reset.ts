import { readFile, mkdir, mkdtemp } from 'node:fs/promises'
import { posix } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { credentials, environmentFile, payload, record, remoteJson, rows } from './remote.js'
import { outputPath, requireValue, writeChanged } from './runtime.js'
import type { Context } from './context.js'

interface ResetState {
  version: 1; environment: string; originalDomain: string; originalUsername: string;
  project: string; account: string; order: number; database: string;
  domain: string; username: string; phase: number; startedAt: string; pagesDomain?: string; keepPages?: boolean;
}
const domainPattern = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9-]+$/u

/** Destructive resource recreation, never a subscription/account reset. No deployment of consumer code here. */
export async function hostingReset(ctx: Context, fetcher: typeof fetch = fetch, sleep = (ms: number) => delay(ms), mode: 'reset' | 'drop' | 'recreate' = 'reset') {
  ctx.requireEnvironment('Hosting reset commands')
  requireValue(!['development', 'test', 'production', ...(ctx.config.production?.environments ?? [])].includes(ctx.environment), 'Hosting reset requires an unprotected hosted environment (--env or defaultEnvironment); production is forbidden')
  const hBase = ctx.section('hostinger').targets[ctx.string('hostinger-target', 'api')]
  const cBase = ctx.section('cloudflare').targets[ctx.string('pages-target', 'web')]
  requireValue(hBase && cBase, 'Select configured Hostinger and Pages targets')
  const h = { ...hBase, ...hBase.environments?.[ctx.environment] }, c = { ...cBase, ...cBase.environments?.[ctx.environment] }
  requireValue(h.domain && domainPattern.test(h.domain) && h.username && /^[a-zA-Z0-9_]+$/u.test(h.username), 'Reset needs an exact Hostinger website domain and username')
  requireValue(c.kind === 'pages' && c.projectName && /^[a-z0-9][a-z0-9-]*$/u.test(c.projectName), 'Reset needs a Pages project')
  for (const protectedEnv of new Set(['production', ...(ctx.config.production?.environments ?? [])])) {
    for (const other of Object.values(ctx.config.hostinger!.targets)) {
      const settings = { ...other, ...other.environments?.[protectedEnv] }
      // A target with no protected override may simply be unconfigured for that environment.
      if (other.environments?.[protectedEnv]) requireValue(settings.domain !== h.domain, 'Hostinger target overlaps a protected environment')
    }
    for (const other of Object.values(ctx.config.cloudflare!.targets)) {
      const settings = { ...other, ...other.environments?.[protectedEnv] }
      if (other.environments?.[protectedEnv]) requireValue(settings.projectName !== c.projectName, 'Pages target overlaps a protected environment')
    }
  }
  requireValue(h.envFile && h.databaseVariable, 'Reset needs backend envFile and databaseVariable')
  const output = outputPath(ctx.root, ctx.string('output', `.rds/hosting-reset-${ctx.environment}.json`))
  if (ctx.dryRun) {
    ctx.log(mode === 'reset' ? `[plan] DELETE and recreate Hostinger website ${h.domain}, its DB, site-path crons and Pages project ${c.projectName}; preserve subscription and DNS` : mode === 'drop' ? `[plan] DROP Hostinger website ${h.domain}, DB and site-path crons; ${ctx.boolean('keep-pages') ? 'KEEP' : 'DELETE'} Pages ${c.projectName}; STOP without recreation or bootstrap` : '[plan] Recreate ONLY from the recorded dropped resources; do not repeat deletion')
    ctx.log('[plan] Recreation allocates a fresh temporary Hostinger domain only when needed. No requests, credential reads or journal writes.')
    return
  }
  const check = ctx.boolean('check')
  requireValue(check || (ctx.boolean('yes') && ctx.string('confirm-host') === h.domain && ctx.string('confirm-project') === c.projectName), 'Reset requires --yes --confirm-host EXACT_DOMAIN --confirm-project EXACT_PROJECT')
  const hs = await credentials(ctx, ctx.config.hostinger?.credentialsFile), cs = await credentials(ctx, ctx.config.cloudflare?.credentialsFile)
  const ht = hs.HOSTINGER_API_TOKEN, ct = cs.CLOUDFLARE_API_TOKEN, account = c.accountId ?? cs.CLOUDFLARE_ACCOUNT_ID
  requireValue(ht && ct && account && /^[a-fA-F0-9]{32}$/u.test(account), 'Reset needs both provider tokens and the Cloudflare account ID')
  const values = await environmentFile(ctx, h.envFile.replaceAll('{env}', ctx.environment), h.excludeEnv)
  const url = new URL(values[h.databaseVariable] ?? 'invalid:')
  const db = url.pathname.slice(1), user = decodeURIComponent(url.username)
  requireValue(['mysql:', 'mariadb:'].includes(url.protocol) && url.hostname === '127.0.0.1' && ['', '3306'].includes(url.port) && [db, user].every(n => /^[a-zA-Z0-9_]+$/u.test(n) && n.startsWith(`${h.username}_`)), 'Reset only supports account-prefixed server-local MySQL databases')
  const api = (path: string, method = 'GET', body?: unknown, missing = false) => remoteJson(fetcher, `https://developers.hostinger.com/api/hosting/v1${path}`, ht, method, body, missing)
  const cfRoot = `https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects`, cfPath = `${cfRoot}/${c.projectName}`
  const cf = (path = cfPath, method = 'GET', body?: unknown, missing = false) => remoteJson(fetcher, path, ct, method, body, missing)
  const oldAccount = `/accounts/${h.username}`
  const websites = async () => {
    const result: Record<string, unknown>[] = []
    for (let page = 1; page <= 100; page++) {
      const list = rows(await api(`/websites?username=${h.username}&per_page=100&page=${page}`))
      result.push(...list)
      if (list.length < 100) return result
    }
    throw new Error('Website inventory exceeded safety limit')
  }
  const databases = async (allowRemovedAccount = false) => {
    const result: Record<string, unknown>[] = []
    for (let page = 1; page <= 100; page++) {
      const value = await api(`${oldAccount}/databases?per_page=100&page=${page}`, 'GET', undefined, allowRemovedAccount)
      if (value === undefined) return result
      const list = rows(value)
      result.push(...list)
      if (list.length < 100) return result
    }
    throw new Error('Database inventory exceeded safety limit')
  }
  const siteDirectory = posix.join('/', 'home', h.username, 'domains', h.domain) + '/'
  const matchingCrons = async () => rows(await api(`${oldAccount}/cron-jobs`)).filter(row => typeof row.command === 'string' && (row.command === h.cron?.command || row.command.includes(siteDirectory)))
  const poll = async (label: string, fn: () => Promise<boolean>) => {
    for (let i = 0; i < 80; i++) { if (await fn()) return; await sleep(15_000) }
    throw new Error(`${label} timed out; use --resume, do not start another reset`)
  }
  let state: ResetState | undefined
  try { state = JSON.parse(await readFile(output, 'utf8')) as ResetState } catch (error) { requireValue((error as NodeJS.ErrnoException).code === 'ENOENT', 'Invalid reset journal; inspect it rather than ignoring it') }
  const resume = ctx.boolean('resume') || mode === 'recreate'
  if (resume) requireValue(state && state.version === 1 && state.environment === ctx.environment && state.originalDomain === h.domain && state.originalUsername === h.username && state.project === c.projectName && state.account === account && state.database === db && Number.isInteger(state.phase) && state.phase >= 0 && state.phase <= 7 && Number.isSafeInteger(state.order) && state.order > 0 && domainPattern.test(state.domain) && /^[a-zA-Z0-9_]+$/u.test(state.username) && Number.isFinite(Date.parse(state.startedAt)), 'Reset journal does not match selected targets')
  else { requireValue(!state || state.phase === 7, 'An interrupted reset exists; use --resume'); state = undefined }
  requireValue(mode !== 'drop' || !state || state.phase <= 4, 'Recreation has already begun; refusing to re-drop resources from this journal')
  requireValue(mode !== 'recreate' || (state && state.phase >= 4), 'Drop must finish before recreation; resume the drop first')
  if (ctx.flags['keep-pages'] !== undefined && state) requireValue(ctx.boolean('keep-pages') === !!state.keepPages, 'Cannot change the Pages retention decision during a lifecycle')
  const keepPages = state?.keepPages ?? ctx.boolean('keep-pages')
  requireValue(mode !== 'reset' || !keepPages, 'Use drop/recreate to preserve Pages; full reset recreates all services')
  if (mode !== 'drop') {
    const help = await ctx.run('hostinger', ['up', '--help'], { capture: true, label: 'Preflight Hostinger CLI before resource recreation' })
    requireValue(['--entry-file', '--source', '--root-directory', '--output-directory'].every(flag => help.stdout.includes(flag)), 'Install a current Hostinger CLI before recreation')
  }
  let crons: Record<string, unknown>[] = []
  if (!state) {
    // Both providers and complete inventory are checked before the first mutation.
    const sites = await websites(), site = sites.find(row => row.domain === h.domain)
    requireValue(site && site.username === h.username && Number.isSafeInteger(site.order_id) && Number(site.order_id) > 0, 'Exact canonical Hostinger website/order not found; preview aliases cannot be reset')
    requireValue(!site.parent_domain || site.parent_domain === h.domain, 'Refusing to delete a subdomain/alias rather than a dedicated website')
    requireValue(!sites.some(row => row.domain !== h.domain && (row.parent_domain === h.domain || String(row.domain).endsWith(`.${h.domain}`))), 'Website has child websites; refusing a potentially shared deletion')
    for (const kind of ['subdomains', 'parked-domains']) requireValue(rows(await api(`${oldAccount}/websites/${h.domain}/${kind}`)).length === 0, 'Website has subdomains/aliases; use a dedicated website for reset')
    const dbs = await databases(), selected = dbs.find(row => row.name === db)
    requireValue(!selected || (selected.user === user && (!selected.domain || selected.domain === h.domain)), 'Database ownership/domain does not match selected website')
    requireValue(!dbs.some(row => row.user === user && row.name !== db), 'Database user is shared with another database; refusing reset')
    crons = await matchingCrons()
    requireValue(crons.every(row => typeof row.uid === 'string' && row.uid.length > 0), 'Cron inventory has no deletable uid')
    const project = await cf()
    const details = record(payload(project))
    requireValue(details.name === c.projectName && !details.source && details.production_branch === 'main', 'Selected Pages project must be the exact Direct Upload project on main')
    // Read deployments/domains before destroying Hostinger, not halfway through a reset.
    // Cloudflare Pages rejects per_page above 25 (error 8000024).
    rows(await cf(`${cfPath}/deployments?per_page=25&page=1`))
    rows(await cf(`${cfPath}/domains`))
    ctx.log(`[rds] Reset preflight passed: ${h.domain}, ${db}, ${crons.length} site-path crons, ${c.projectName}`)
    if (check) return
    state = { version: 1, environment: ctx.environment, originalDomain: h.domain, originalUsername: h.username, project: c.projectName, account, order: Number(site.order_id), database: db, domain: h.domain, username: h.username, phase: 0, startedAt: new Date().toISOString(), keepPages }
  } else if (check) { ctx.log('[rds] Interrupted reset journal validated; use --resume to continue'); return }
  const s = state!
  const save = async (phase: number) => { s.phase = phase; await writeChanged(output, JSON.stringify(s, null, 2) + '\n') }
  await save(s.phase)
  if (s.phase === 0) {
    await save(1)
  }
  if (s.phase === 1) {
    crons = await matchingCrons()
    for (const row of crons) { requireValue(typeof row.uid === 'string', 'Invalid cron uid'); await api(`${oldAccount}/cron-jobs/${encodeURIComponent(row.uid)}`, 'DELETE') }
    // Persist intent before DELETE: a timed-out response may already have removed the site.
    await save(2)
  }
  if (s.phase === 2) {
    const sites = await websites(), site = sites.find(row => row.domain === h.domain)
    if (site) { requireValue(site.username === h.username && site.order_id === s.order, 'Website identity changed during reset'); await api(`/websites/${h.domain}`, 'DELETE') }
    await poll('Website deletion', async () => !(await websites()).some(row => row.domain === h.domain))
    const remaining = (await databases(true)).find(row => row.name === db)
    if (remaining) { requireValue(remaining.user === user && (!remaining.domain || remaining.domain === h.domain), 'Remaining database ownership changed'); await api(`${oldAccount}/databases/${db}`, 'DELETE') }
    await poll('Database deletion', async () => !(await databases(true)).some(row => row.name === db))
    await save(3)
  }
  if (s.phase === 3) {
    if (keepPages) {
      ctx.log(`[rds] Preserved Pages project ${s.project}; no Pages writes performed`)
      await save(4)
    } else {
    // Delete non-live historical deployments first (Pages may reject projects with >100 builds).
    if (await cf(cfPath, 'GET', undefined, true)) {
      for (let round = 0; round < 1000; round++) {
        const deployments = rows(await cf(`${cfPath}/deployments?per_page=25&page=1`))
        const project = record(payload(await cf()))
        const live = project.canonical_deployment && record(project.canonical_deployment).id
        const removable = deployments.filter(row => row.id !== live)
        if (!removable.length) break
        requireValue(round < 999, 'Pages deployment inventory exceeded safety limit')
        for (const row of removable) { requireValue(typeof row.id === 'string', 'Invalid deployment id'); await cf(`${cfPath}/deployments/${encodeURIComponent(row.id)}?force=true`, 'DELETE') }
      }
      for (const row of rows(await cf(`${cfPath}/domains`))) { requireValue(typeof row.name === 'string', 'Invalid Pages domain'); await cf(`${cfPath}/domains/${encodeURIComponent(row.name)}`, 'DELETE') }
      await cf(cfPath, 'DELETE')
    }
    await poll('Pages deletion', async () => !await cf(cfPath, 'GET', undefined, true))
    await save(4)
    }
  }
  if (mode === 'drop') {
    requireValue(s.phase === 4, 'Drop did not reach the offline phase')
    ctx.log(`[rds] DROP COMPLETE: API website, configured DB and scoped cron removed; Pages ${keepPages ? 'preserved' : 'deleted'}. No application, placeholder or replacement website was started.`)
    return s
  }
  if (s.phase === 4) {
    if (s.originalDomain.endsWith('.hostingersite.com') && s.domain === s.originalDomain) {
      s.domain = String(record(payload(await api('/domains/free-subdomains', 'POST'))).domain)
      requireValue(domainPattern.test(s.domain) && s.domain.endsWith('.hostingersite.com') && s.domain !== s.originalDomain, 'Provider did not allocate a new temporary domain')
      // Dropping may precede restore by days: allocate the 24-hour free name NOW, not during drop.
      s.startedAt = new Date().toISOString()
      await save(4)
    }
    // Domain is journalled before POST; on resume inspect onboarding instead of blindly creating twice.
    let setup = rows(await api(`/onboardings?domain=${encodeURIComponent(s.domain)}&order_id=${s.order}`)).find(row => row.domain === s.domain && typeof row.created_at === 'string' && Date.parse(row.created_at) >= Date.parse(s.startedAt))
    if (!setup) setup = record(payload(await api(`/orders/${s.order}/onboardings`, 'POST', { domain: s.domain })))
    requireValue(setup.domain === s.domain && typeof setup.username === 'string' && /^[a-zA-Z0-9_]+$/u.test(setup.username), 'Unexpected recreated website identity')
    s.username = setup.username
    await save(5)
  }
  if (s.phase === 5) {
    await poll('Website setup', async () => {
      const setup = rows(await api(`/onboardings?domain=${encodeURIComponent(s.domain)}&order_id=${s.order}`)).find(row => row.domain === s.domain)
      requireValue(!setup || (setup.username === s.username && setup.status !== 'failed'), 'Recreated website setup failed or identity changed')
      return setup?.status === 'completed'
    })
    // Initialize managed Node through the official CLI, without manual ZIP onboarding or DB dependencies.
    await mkdir(ctx.path('.rds'), { recursive: true })
    const bootstrap = await mkdtemp(outputPath(ctx.root, `.rds/reset-bootstrap-${ctx.environment}-`))
    await writeChanged(`${bootstrap}/package.json`, JSON.stringify({ name: 'hosting-reset-bootstrap', private: true, scripts: { build: 'node --check server.js', start: 'node server.js' } }))
    await writeChanged(`${bootstrap}/server.js`, "require('node:http').createServer((req,res)=>{res.writeHead(req.url==='/'?200:404,{'Content-Type':'text/plain','Cache-Control':'no-store'});res.end('Application reset in progress')}).listen(Number(process.env.PORT||3000),'0.0.0.0')\n")
    const result = await ctx.run('hostinger', ['up', bootstrap, '--domain', s.domain, '--source', 'upload', '--type', 'nodejs', '--app-type', 'other', '--entry-file', 'server.js', '--build-script', 'build', '--node-version', String(h.nodeVersion ?? 24), '--package-manager', 'npm', '--root-directory', '.', '--output-directory', '.', '--yes', '--no-input', '--format', 'json'], { capture: true, env: { HOSTINGER_API_TOKEN: ht, HOSTINGER_NONINTERACTIVE: '1' }, timeout: 20 * 60_000, label: 'Initialize fresh managed Node site automatically' })
    let outcome: Record<string, unknown>
    try { outcome = record(JSON.parse(result.stdout)) } catch { throw new Error('Bootstrap did not return a valid result; inspect provider and resume') }
    requireValue(!outcome.error && outcome.success !== false && record(outcome.data ?? payload(outcome)).buildState === 'completed', 'Reset bootstrap build failed; inspect hPanel and resume')
    const ssl = record(payload(await api(`/accounts/${s.username}/websites/${s.domain}/ssl/status`)))
    if (ssl.status !== 'active' && !s.domain.endsWith('.hostingersite.com')) await api(`/accounts/${s.username}/websites/${s.domain}/ssl/setup`, 'POST')
    await save(6)
  }
  if (s.phase === 6) {
    const existing = await cf(cfPath, 'GET', undefined, true)
    requireValue(!keepPages || existing, 'Preserved Pages project disappeared; inspect it before restoring')
    if (!existing) await cf(cfRoot, 'POST', { name: c.projectName, production_branch: 'main' })
    const recreated = record(payload(await cf()))
    requireValue(recreated.name === c.projectName && !recreated.source && recreated.production_branch === 'main' && typeof recreated.subdomain === 'string' && domainPattern.test(recreated.subdomain) && recreated.subdomain.endsWith('.pages.dev'), 'Recreated Pages project identity/address is invalid')
    s.pagesDomain = recreated.subdomain
    // Custom domains are reattached by the consumer's ordinary setup step.
    await save(7)
  }
  ctx.log(`[rds] Hosted resources recreated: API ${s.domain}; account ${s.username}; Pages ${s.project}. Consumer must rotate secrets, regenerate, deploy and verify.`)
  return s
}
