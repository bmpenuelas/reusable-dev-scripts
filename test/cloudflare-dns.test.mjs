import test from 'node:test'
import assert from 'node:assert/strict'
import { cloudflare } from '../dist/cloudflare.js'
import { validateConfig } from '../dist/config.js'
import { fixture } from './helpers.mjs'

// Node runs test files in isolated processes. Never let an operator's real tokens enter fixtures/assertions.
for (const key of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']) delete process.env[key]

const account = 'a'.repeat(32), zone = 'b'.repeat(32)
const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
const pages = (overrides = {}) => ({ kind: 'pages', projectName: 'site', accountId: account, domains: ['example.com'], zoneId: zone, ...overrides })

/** A tiny in-memory zone: DNS records, one redirect ruleset and the Pages project/domain endpoints. */
function provider({ records = [], ruleset, zoneName = 'example.com' } = {}) {
  const state = { records: [...records], ruleset, calls: [] }
  let nextId = 1
  const fetcher = async (url, options) => {
    const path = new URL(url).pathname, query = new URL(url).searchParams, method = options.method, body = options.body ? JSON.parse(options.body) : undefined
    state.calls.push({ method, path, body })
    if (path.includes('/pages/projects')) {
      if (path.endsWith('/domains') && method === 'POST') return response({ result: {} })
      if (path.includes('/domains/')) return response({ result: {} })
      return response({ result: { production_branch: 'main' } })
    }
    if (path === `/client/v4/zones/${zone}`) return response({ result: { name: zoneName } })
    if (path.endsWith('/dns_records') && method === 'GET') return response({ result: state.records.filter(record => record.name === query.get('name')) })
    if (path.endsWith('/dns_records') && method === 'POST') { state.records.push({ id: `r${nextId++}`, ...body }); return response({ result: body }) }
    if (path.includes('/dns_records/') && method === 'PATCH') { Object.assign(state.records.find(record => path.endsWith(record.id)), body); return response({ result: body }) }
    if (path.endsWith('/entrypoint')) {
      if (method === 'GET') return state.ruleset ? response({ result: state.ruleset }) : response({}, 404)
      state.ruleset = { id: 'set1', rules: body.rules.map((rule, index) => ({ id: `rule${index}`, ...rule })) }; return response({ result: state.ruleset })
    }
    if (path.endsWith('/rules') && method === 'POST') { state.ruleset.rules.push({ id: 'new', ...body }); return response({ result: {} }) }
    if (path.includes('/rules/') && method === 'PATCH') { Object.assign(state.ruleset.rules.find(rule => path.endsWith(rule.id)), body); return response({ result: {} }) }
    return response({}, 500)
  }
  return { state, fetcher }
}
async function setup(target, flags = { env: 'staging', yes: true }) {
  const f = await fixture({ version: 1, cloudflare: { credentialsFile: 'credentials.env', targets: { site: target } } }, flags)
  await f.file('credentials.env', 'CLOUDFLARE_API_TOKEN=fake-cf-token')
  return f
}

test('Pages setup keeps a proxied CNAME to the project for each domain and is repeatable', async () => {
  const f = await setup(pages({ domains: ['example.com', 'app.example.com'] })), p = provider()
  await cloudflare(f.ctx, 'setup-pages', p.fetcher)
  assert.deepEqual(p.state.records.map(record => [record.name, record.content, record.proxied]), [['example.com', 'site.pages.dev', true], ['app.example.com', 'site.pages.dev', true]])
  const writes = p.state.calls.filter(call => call.path.endsWith('/dns_records') && call.method === 'POST').length
  await cloudflare(f.ctx, 'setup-pages', p.fetcher)
  assert.equal(p.state.calls.filter(call => call.path.endsWith('/dns_records') && call.method === 'POST').length, writes)
  assert.ok(f.messages.some(line => /DNS record for example\.com: current/.test(line)))
  assert.ok(!f.messages.join('\n').includes('fake-cf-token'))
})

test('Pages setup repairs an unproxied record but never re-points a record that goes elsewhere', async () => {
  const unproxied = provider({ records: [{ id: 'r0', type: 'CNAME', name: 'example.com', content: 'site.pages.dev', proxied: false }] })
  await cloudflare((await setup(pages())).ctx, 'setup-pages', unproxied.fetcher)
  assert.equal(unproxied.state.records[0].proxied, true)
  for (const record of [{ type: 'CNAME', content: 'other.pages.dev' }, { type: 'A', content: '192.0.2.1' }]) {
    const elsewhere = provider({ records: [{ id: 'r0', name: 'example.com', proxied: true, ...record }] })
    await assert.rejects(cloudflare((await setup(pages())).ctx, 'setup-pages', elsewhere.fetcher), /does not point at the Pages project/)
    assert.equal(elsewhere.state.calls.some(call => call.method === 'PATCH' || (call.method === 'POST' && call.path.endsWith('/dns_records'))), false)
  }
})

test('www redirect creates the record and rule, adopts an existing ref, and updates only its own rule', async () => {
  const target = pages({ wwwRedirect: true, redirectRef: 'legacy_www' })
  const fresh = provider()
  await cloudflare((await setup(target)).ctx, 'setup-pages', fresh.fetcher)
  assert.ok(fresh.state.records.some(record => record.name === 'www.example.com' && record.content === 'example.com' && record.proxied))
  assert.equal(fresh.state.ruleset.rules.length, 1); assert.equal(fresh.state.ruleset.rules[0].ref, 'legacy_www')
  assert.equal(fresh.state.ruleset.rules[0].expression, '(http.host eq "www.example.com")')
  assert.equal(fresh.state.ruleset.rules[0].action_parameters.from_value.status_code, 301)
  const again = fresh.state.calls.length
  await cloudflare((await setup(target)).ctx, 'setup-pages', fresh.fetcher)
  assert.equal(fresh.state.calls.slice(again).some(call => ['PUT', 'PATCH'].includes(call.method) || (call.method === 'POST' && /rules|dns_records/.test(call.path))), false)
  const other = { id: 'unrelated', ref: 'other_rule', expression: '(true)' }
  const shared = provider({ ruleset: { id: 'set1', rules: [other, { id: 'rule0', ref: 'legacy_www', expression: '(old)', enabled: true, action_parameters: {} }] } })
  await cloudflare((await setup(target)).ctx, 'setup-pages', shared.fetcher)
  assert.equal(shared.state.ruleset.rules[0].expression, '(true)'); assert.equal(shared.state.ruleset.rules[1].expression, '(http.host eq "www.example.com")')
  const added = provider({ ruleset: { id: 'set1', rules: [other] } })
  await cloudflare((await setup(target)).ctx, 'setup-pages', added.fetcher)
  assert.deepEqual(added.state.ruleset.rules.map(rule => rule.ref), ['other_rule', 'legacy_www'])
})

test('www redirect is skipped away from the apex and refuses a conflicting www record', async () => {
  const sub = provider({ zoneName: 'example.org' }), f = await setup(pages({ wwwRedirect: true }))
  await cloudflare(f.ctx, 'setup-pages', sub.fetcher)
  assert.ok(f.messages.some(line => /www redirect skipped/.test(line))); assert.equal(sub.state.ruleset, undefined)
  const conflict = provider({ records: [{ id: 'r9', type: 'A', name: 'www.example.com', content: '192.0.2.1', proxied: true }] })
  await assert.rejects(cloudflare((await setup(pages({ wwwRedirect: true }))).ctx, 'setup-pages', conflict.fetcher), /www already has DNS records/)
  assert.equal(conflict.state.ruleset, undefined)
  await assert.rejects(cloudflare((await setup(pages({ wwwRedirect: true, domains: ['a.example.com', 'b.example.com'] }))).ctx, 'setup-pages', provider().fetcher), /exactly one domain/)
  await assert.rejects(cloudflare((await setup(pages({ wwwRedirect: true, zoneId: undefined }))).ctx, 'setup-pages', provider().fetcher), /needs zoneId/)
})

test('DNS settings are validated and dry-run makes no provider request', async () => {
  assert.throws(() => validateConfig({ version: 1, cloudflare: { targets: { a: pages({ zoneId: 'short' }) } } }), /zoneId must be/)
  assert.throws(() => validateConfig({ version: 1, cloudflare: { targets: { a: pages({ wwwRedirect: 'yes' }) } } }), /wwwRedirect must be a boolean/)
  assert.throws(() => validateConfig({ version: 1, cloudflare: { targets: { a: pages({ redirectRef: 'bad ref' }) } } }), /redirectRef/)
  assert.throws(() => validateConfig({ version: 1, cloudflare: { targets: { a: { kind: 'worker', d1Database: '../x' } } } }), /d1Database/)
  const f = await setup(pages({ wwwRedirect: true }), { env: 'staging', 'dry-run': true })
  await cloudflare(f.ctx, 'setup-pages', async () => { throw new Error('must not request') })
})

test('migrate-d1 applies remote migrations with the generated config and the selected environment', async () => {
  const f = await setup({ kind: 'worker', root: 'api', config: 'wrangler.generated.toml', d1Database: 'app-db-staging', accountId: account, prepare: [['node', 'prepare.mjs', '{env}']] })
  await f.file('api/wrangler.generated.toml', '')
  await cloudflare(f.ctx, 'migrate-d1')
  assert.deepEqual(f.calls.map(call => call.label), ['Project hook', 'Apply remote D1 migrations'])
  const args = f.calls[1].args
  assert.deepEqual(args.slice(0, 5), ['d1', 'migrations', 'apply', 'app-db-staging', '--remote'])
  assert.ok(args.includes('--config') && args[args.indexOf('--env') + 1] === 'staging')
  assert.equal(f.calls[1].env.CLOUDFLARE_API_TOKEN, 'fake-cf-token')
  const noDatabase = await setup({ kind: 'worker', config: 'wrangler.toml' })
  await assert.rejects(cloudflare(noDatabase.ctx, 'migrate-d1'), /d1Database/)
  const production = await setup({ kind: 'worker', config: 'wrangler.toml', d1Database: 'db' }, { env: 'production' })
  await assert.rejects(cloudflare(production.ctx, 'migrate-d1'), /--allow-production/)
})
