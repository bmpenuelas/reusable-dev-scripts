import test from 'node:test'
import assert from 'node:assert/strict'
import { hostinger } from '../dist/hostinger.js'
import { cloudflare } from '../dist/cloudflare.js'
import { validateConfig } from '../dist/config.js'
import { remoteJson } from '../dist/remote.js'
import { main } from '../dist/cli.js'
import { fixture } from './helpers.mjs'

// Node runs test files in isolated processes. Never let an operator's real tokens enter fixtures/assertions.
for (const key of ['HOSTINGER_API_TOKEN', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']) delete process.env[key]

const account = 'a'.repeat(32)
const target = {
  username: 'u123456789', domain: 'api.example.com', directory: 'bundle', envFile: 'backend.env',
  excludeEnv: ['PORT'], databaseVariable: 'DATABASE_URL',
  cron: { command: '/opt/node24/bin/node /srv/site/dist/jobs.js', schedule: '* * * * *' },
}
const config = { version: 1, hostinger: { credentialsFile: 'credentials.env', targets: { api: target } } }
const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
async function hosting(flags = { env: 'staging', yes: true }) {
  const f = await fixture(config, flags)
  await f.file('credentials.env', 'HOSTINGER_API_TOKEN=fake-host-token\nCLOUDFLARE_API_TOKEN=fake-cf-token\n')
  await f.file('backend.env', 'APP_ENV=staging\nPORT=3000\nDATABASE_URL=mysql://u123456789_app:fake-password@127.0.0.1:3306/u123456789_app\nJWT_SECRET=fake-backend-secret\n')
  await f.file('bundle/package.json', '{"name":"fixture","scripts":{"build":"node build.js"}}')
  return f
}

test('Hostinger setup creates only the named database and cron and is repeatable', async () => {
  const f = await hosting(), calls = []; let db = false, cron = false
  const fetcher = async (url, options) => {
    calls.push({ url, ...options })
    if (url.includes('/databases?')) return response({ data: db ? [{ name: 'u123456789_app', user: 'u123456789_app' }] : [] })
    if (url.endsWith('/databases')) { db = true; return response({ data: {} }, 201) }
    if (options.method === 'GET') return response({ data: cron ? [{ command: target.cron.command, time: target.cron.schedule }] : [] })
    cron = true; return response({ data: {} }, 201)
  }
  await hostinger(f.ctx, 'setup', fetcher)
  await hostinger(f.ctx, 'setup', fetcher)
  assert.equal(calls.filter(call => call.method === 'POST').length, 2)
  const create = calls.find(call => call.url.endsWith('/databases'))
  assert.deepEqual(JSON.parse(create.body), { name: 'u123456789_app', user: 'u123456789_app', password: 'fake-password', website_domain: 'api.example.com' })
  assert.ok(!f.messages.join('\n').includes('fake-password'))
})

test('Hostinger setup preserves existing resources with conflicting ownership or schedule', async () => {
  const f = await hosting()
  await assert.rejects(hostinger(f.ctx, 'setup', async () => response({ data: [{ name: 'u123456789_app', user: 'somebody_else' }] })), /another user/)
  await assert.rejects(hostinger(f.ctx, 'setup', async url => response({ data: url.includes('databases') ? [{ name: 'u123456789_app' }] : [{ command: target.cron.command, time: '0 * * * *' }] })), /different schedule/)
})

test('Hostinger deploy syncs complete backend env through HTTPS, then uploads using token env, not argv', async () => {
  const f = await hosting(), calls = []
  f.ctx.runner = async invocation => {
    if (invocation.args.includes('--help')) return { stdout: '--entry-file --source --no-wait --output-directory --root-directory', stderr: '' }
    calls.push(invocation); return { stdout: JSON.stringify({ data: { buildState: 'completed' } }), stderr: '' }
  }
  const requests = []
  await hostinger(f.ctx, 'deploy', async (url, options) => { requests.push({ url, ...options }); return response({ data: {} }) })
  const values = JSON.parse(requests[0].body).env_vars
  assert.equal(values.length, 3)
  assert.ok(!values.some(value => value.key === 'PORT' || value.key.endsWith('API_TOKEN')))
  assert.equal(calls[0].command, 'hostinger')
  assert.ok(calls[0].args.includes('--yes') && calls[0].args.includes('--entry-file'))
  assert.ok(!calls[0].args.join(' ').includes('fake-host-token'))
  assert.equal(calls[0].env.HOSTINGER_API_TOKEN, 'fake-host-token')
  assert.ok(!f.messages.join('\n').includes('fake-backend-secret'))
})

test('Hostinger fails closed on queued builds and provider errors without printing secrets', async () => {
  const f = await hosting()
  f.ctx.runner = async invocation => ({ stdout: invocation.args.includes('--help') ? '--entry-file --source --no-wait --output-directory --root-directory' : JSON.stringify({ data: { buildState: 'queued' } }), stderr: '' })
  await assert.rejects(hostinger(f.ctx, 'deploy', async () => response({})), /did not report completion/)
  await assert.rejects(hostinger(f.ctx, 'deploy', async () => response({ error: 'fake-backend-secret' }, 403)), error => !error.message.includes('fake-backend-secret') && error.message.includes('403'))
})

test('missing upload CLI fails before remote environment replacement', async () => {
  const f = await hosting()
  f.ctx.runner = async () => { throw new Error('Install hostinger') }
  await assert.rejects(hostinger(f.ctx, 'deploy', async () => { throw new Error('must not replace remote env') }), /Install hostinger/)
})

test('remote APIs do not follow redirects, leak errors, or ignore failure envelopes', async () => {
  await assert.rejects(remoteJson(async (_url, options) => { assert.equal(options.redirect, 'error'); throw new Error('token-value') }, 'https://example.com', 'token'), error => !error.message.includes('token-value'))
  await assert.rejects(remoteJson(async () => response({ success: false }), 'https://example.com', 'token'), /rejected/)
})

test('Hostinger dry-run needs no credentials, env files, upload tools, or provider requests', async () => {
  const f = await fixture(config, { env: 'production', 'dry-run': true })
  const forbidden = async () => { throw new Error('must not contact provider') }
  await hostinger(f.ctx, 'setup', forbidden)
  await hostinger(f.ctx, 'deploy', forbidden)
  assert.equal(f.calls.length, 0)
  assert.match(f.messages.join('\n'), /api.example.com/)
})

test('remote mutations require explicit environment, confirmation, and production authorization', async () => {
  for (const [flags, message] of [[{}, /explicit --env/], [{ env: 'staging' }, /--yes/], [{ env: 'production', yes: true }, /--allow-production/]]) {
    const f = await hosting(flags)
    await assert.rejects(hostinger(f.ctx, 'setup', async () => { throw new Error('must not request') }), message)
  }
})

test('Pages setup creates project/custom domain once and rejects incompatible existing projects', async () => {
  const f = await fixture({ version: 1, cloudflare: { credentialsFile: 'credentials.env', targets: { web: { kind: 'pages', projectName: 'fixture', accountId: account, domains: ['app.example.com'] } } } }, { env: 'staging', yes: true })
  await f.file('credentials.env', 'CLOUDFLARE_API_TOKEN=fake-cf-token')
  const calls = []; let project = false, domain = false
  const fetcher = async (url, options) => {
    calls.push({ url, ...options })
    if (url.endsWith('/domains') && options.method === 'POST') { domain = true; return response({ result: {} }) }
    if (url.includes('/domains/')) return domain ? response({ result: {} }) : response({}, 404)
    if (options.method === 'POST') { project = true; return response({ result: { production_branch: 'main' } }) }
    return project ? response({ result: { production_branch: 'main' } }) : response({}, 404)
  }
  await cloudflare(f.ctx, 'setup-pages', fetcher)
  await cloudflare(f.ctx, 'setup-pages', fetcher)
  assert.equal(calls.filter(call => call.method === 'POST').length, 2)
  await assert.rejects(cloudflare(f.ctx, 'setup-pages', async () => response({ result: { production_branch: 'main', source: { type: 'github' } } })), /Direct Upload/)
  await assert.rejects(cloudflare(f.ctx, 'setup-pages', async () => response({}, 403)), /403/)
})

test('Pages config resolves environment-specific names and credentials without leaking them', async () => {
  const f = await fixture({ version: 1, cloudflare: { credentialsFile: 'credentials.env', targets: { web: { kind: 'pages', directory: 'dist', projectName: 'base', environments: { production: { projectName: 'prod-fixture', accountId: account } } } } } }, { env: 'production', 'allow-production': true })
  await f.file('credentials.env', 'CLOUDFLARE_API_TOKEN=fake-cf-token')
  await cloudflare(f.ctx, 'deploy-pages')
  assert.ok(f.calls[0].args.includes('prod-fixture'))
  assert.equal(f.calls[0].env.CLOUDFLARE_ACCOUNT_ID, account)
  assert.equal(f.calls[0].env.CLOUDFLARE_API_TOKEN, 'fake-cf-token')
  assert.ok(!f.messages.join('\n').includes('fake-cf-token'))
})

test('hosting config and CLI reject invalid fields before effects', async () => {
  assert.throws(() => validateConfig({ version: 1, hostinger: { targets: { api: { unknown: true } } } }), /Unknown/)
  assert.throws(() => validateConfig({ version: 1, hostinger: { targets: { api: { nodeVersion: 18 } } } }), /22 or 24/)
  assert.throws(() => validateConfig({ version: 1, cloudflare: { targets: { web: { kind: 'pages', environments: { staging: { domains: 'invalid' } } } } } }), /string array/)
  for (const argv of [['hostinger', 'setup'], ['hostinger', 'deploy'], ['cloudflare', 'setup-pages']]) {
    const messages = []
    await main([...argv, '--help'], undefined, line => messages.push(line))
    assert.match(messages.join('\n'), /--yes/)
  }
})
