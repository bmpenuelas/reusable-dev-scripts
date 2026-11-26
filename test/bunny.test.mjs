import test from 'node:test'
import assert from 'node:assert/strict'
import { ProviderError, assertEdgeScript, bunnyClient, cloudflareDnsOnlyCname, deployEdgeScript, edgeScriptMatches, edgeScriptSource, providerRequest } from '../dist/bunny.js'

const key = 'fixture-access-key', secret = 'fixture-secret-value'

test('only reads are retried, waits are bounded, and errors never carry provider data', async () => {
  let attempts = 0
  const delays = []
  const client = bunnyClient(key, { pause: async time => { delays.push(time) }, timeout: 10, fetcher: async () => {
    attempts++
    if (attempts === 1) return new Response(key, { status: 429, headers: { 'Retry-After': '1' } })
    if (attempts === 2) throw new Error(`timeout ${key}`)
    return new Response(key, { status: 403 })
  } })
  await assert.rejects(client.listZones(), error => error instanceof ProviderError && error.status === 403 && !error.message.includes(key))
  assert.equal(attempts, 3)
  assert.equal(delays[0], 1000)
  await assert.rejects(client.cert('www.example.com'), /HTTP 403/u)
  await assert.rejects(client.update(1, {}), /HTTP 403/u)
  assert.equal(attempts, 5)
  const limited = bunnyClient(key, { pause: () => assert.fail('an excessive wait must be refused'), fetcher: async () => new Response('', { status: 429, headers: { 'Retry-After': '3600' } }) })
  await assert.rejects(limited.listZones(), /HTTP 429/u)
  assert.throws(() => client.zone(0), /Invalid Bunny Pull Zone/u)
  assert.throws(() => client.script(-1), /Invalid Bunny edge script/u)
})

test('requests never follow redirects and send the credential only as a header', async () => {
  const calls = []
  const request = providerRequest('Example', 'https://api.example.com', { AccessKey: key }, { fetcher: async (url, init) => { calls.push([url, init]); return Response.json({ ok: 1 }) } })
  assert.deepEqual(await request('read', '/a'), { ok: 1 })
  assert.equal(await request('write', '/b', { method: 'POST', body: { a: 1 }, discard: true }), null)
  for (const [url, init] of calls) { assert.equal(init.redirect, 'error'); assert.ok(init.signal); assert.ok(!url.includes(key)); assert.equal(init.headers.AccessKey, key) }
})

test('an edge script source is identical for LF and CRLF checkouts and inlines multi-line imports', async () => {
  const shared = 'export const one = 1\nexport function two() { return 2 }\n'
  const main = "import {\n  one,\n  two,\n} from './shared.mjs'\nimport { one as again } from \"../shared.mjs\";\nconst text = 'import this'\nexport async function run() { return one + two() }\n"
  const options = { imports: "import * as SDK from 'npm:@example/sdk@1.0.0';", main: 'SDK.serve(run)' }
  const lf = edgeScriptSource([shared, main], options)
  assert.equal(edgeScriptSource([shared, main].map(code => code.replaceAll('\n', '\r\n')), options), lf)
  assert.doesNotMatch(lf, /\r|shared\.mjs|^export /mu)
  assert.match(lf, /^import \* as SDK from/u)
  assert.match(lf, /async function run\(\) \{ return one \+ two\(\) \}/u)
  for (const unsupported of ["import fs from 'node:fs'\n", 'export default 1\n', "export { a } from './b.mjs'\n"]) assert.throws(() => edgeScriptSource([unsupported]), /cannot be inlined/u)
})

function fakeScript({ links = [], variables = [], name = 'edge', type = 1 } = {}) {
  const state = { variables: [...variables], secrets: [], draft: null, release: null, events: [] }
  return { state, id: 7,
    metadata: async () => ({ Id: 7, Name: name, ScriptType: type, Deleted: false, LinkedPullZones: links, EdgeScriptVariables: state.variables }),
    secrets: async () => ({ Secrets: state.secrets }), draft: async () => ({ Code: state.draft }),
    release: async () => { if (!state.release) throw new ProviderError('Bunny', 'read release', 404); return state.release },
    writeVariable: async (Name, DefaultValue) => { state.events.push(Name); state.variables = [...state.variables.filter(v => v.Name !== Name), { Name, DefaultValue, Required: true }] },
    writeSecret: async Name => { state.events.push(Name); state.secrets = [...state.secrets.filter(v => v.Name !== Name), { Name }] },
    writeDraft: async code => { state.events.push('draft'); state.draft = code },
    publish: async () => { state.events.push('publish'); state.release = { Code: state.draft, Deleted: false, DatePublished: 'now' } },
  }
}
const target = { name: 'edge', type: 1, zoneId: 43, secretNames: ['KEYS'] }
const deployment = { ...target, source: 'code()\n', variables: { HOST: 'www.example.com' }, secrets: { KEYS: secret }, note: 'test', poll: async check => check() }

test('a deployment writes settings, secrets, draft and release in order and reads each back', async () => {
  const script = fakeScript({ links: [43] })
  await deployEdgeScript(script, deployment)
  assert.deepEqual(script.state.events, ['HOST', 'KEYS', 'draft', 'publish'])
  await deployEdgeScript(script, deployment)
  assert.equal(edgeScriptMatches(await script.release(), deployment.source.replaceAll('\n', '\r\n')), true)
  assert.equal(edgeScriptMatches({ Code: deployment.source, Deleted: true, DatePublished: 'x' }, deployment.source), false)
})

test('a deployment refuses the wrong script, a foreign link, readable secrets and unconfirmed steps', async () => {
  for (const script of [fakeScript({ name: 'other' }), fakeScript({ type: 2 }), fakeScript({ links: [99] }), fakeScript({ variables: [{ Name: 'KEYS', DefaultValue: 'x' }] })]) {
    await assert.rejects(deployEdgeScript(script, deployment), /not the reviewed script/u)
    assert.deepEqual(script.state.events, [])
  }
  await assert.rejects(assertEdgeScript(fakeScript({ links: [43] }), { ...target, zoneId: undefined }), /not the reviewed/u)
  await assert.rejects(deployEdgeScript(fakeScript(), { ...deployment, source: `const k = "${secret}"` }), /must not contain its secrets/u)
  const ignored = fakeScript(); ignored.writeVariable = async () => {}
  await assert.rejects(deployEdgeScript(ignored, deployment), /did not confirm the edge settings/u)
  const lost = fakeScript(); lost.writeSecret = async () => {}
  await assert.rejects(deployEdgeScript(lost, deployment), /did not confirm the edge secrets/u)
  const stale = fakeScript(); stale.writeDraft = async () => {}
  await assert.rejects(deployEdgeScript(stale, deployment), /draft; nothing was published/u)
  assert.ok(!stale.state.events.includes('publish'))
  const unpublished = fakeScript(); unpublished.publish = async () => {}
  await assert.rejects(deployEdgeScript(unpublished, deployment), /published edge release/u)
})

test('the DNS helper reads and writes one exact DNS-only name', async () => {
  const zoneId = 'b'.repeat(32), calls = []
  const dns = (zoneName = 'example.com') => cloudflareDnsOnlyCname({ zoneId, zoneName, hostname: 'cdn.example.com', target: 'site.b-cdn.net', token: key }, { fetcher: async (url, init) => {
    const parsed = new URL(url); calls.push([init.method, parsed])
    assert.equal(init.headers.Authorization, `Bearer ${key}`)
    if (parsed.pathname.endsWith('/dns_records')) return Response.json({ success: true, result: init.method === 'POST' ? { id: 'c'.repeat(32) } : [] })
    return Response.json({ success: true, result: { id: zoneId, name: 'example.com' } })
  } })
  assert.deepEqual(await dns().records(), [])
  assert.equal(calls.at(-1)[1].searchParams.get('name.exact'), 'cdn.example.com')
  const record = { type: 'CNAME', name: 'cdn.example.com', content: 'site.b-cdn.net', proxied: false, ttl: 1 }
  await dns().write(record)
  for (const bad of [{ proxied: true }, { name: 'www.example.com' }, { content: 'elsewhere.example.com' }, { type: 'A' }]) await assert.rejects(dns().write({ ...record, ...bad }), /Unsafe DNS write/u)
  await assert.rejects(dns('other.example.com').records(), /does not match/u)
})
