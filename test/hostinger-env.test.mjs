import test from 'node:test'
import assert from 'node:assert/strict'
import { hostinger } from '../dist/hostinger.js'
import { fixture } from './helpers.mjs'

delete process.env.HOSTINGER_API_TOKEN
async function setup(env) {
  const f = await fixture({ version: 1, hostinger: { credentialsFile: 'tokens.env', targets: { api: {
    username: 'u123456789', domain: 'api.example.com', directory: 'bundle', envFile: 'backend.env', excludeEnv: ['PORT'],
  } } } }, { env: 'staging', yes: true })
  await f.file('tokens.env', 'HOSTINGER_API_TOKEN=synthetic-token')
  await f.file('backend.env', env)
  await f.file('bundle/package.json', '{"name":"synthetic-app"}')
  f.ctx.runner = async invocation => {
    f.calls.push(invocation)
    return { stdout: invocation.args.includes('--help') ? '--entry-file --source --no-wait --output-directory --root-directory' : '{"data":{"buildState":"completed"}}', stderr: '' }
  }
  return f
}

test('Hostinger omits blank optional settings and preserves false/zero/nonempty values in full replacement', async () => {
  const f = await setup('APP_ENV=staging\nOPTIONAL_KEY=\nOPTIONAL_URL=""\nPORT=3000\nFEATURE_ENABLED=false\nRETRY_COUNT=0\nSECRET=synthetic-secret\n')
  const requests = []
  await hostinger(f.ctx, 'deploy', async (url, options) => {
    requests.push({url, ...options})
    const entries = JSON.parse(options.body).env_vars
    // Model the provider constraint that the original permissive fixture missed.
    return new Response(JSON.stringify({}), { status: entries.every(entry => entry.value.length > 0) ? 200 : 422 })
  })
  assert.equal(requests.length, 1)
  assert.equal(requests[0].method, 'PUT')
  assert.match(requests[0].url, /\/nodejs\/builds\/settings\/env$/)
  assert.deepEqual(JSON.parse(requests[0].body), {env_vars: [
    {key: 'APP_ENV', value: 'staging'}, {key: 'FEATURE_ENABLED', value: 'false'},
    {key: 'RETRY_COUNT', value: '0'}, {key: 'SECRET', value: 'synthetic-secret'},
  ]})
  assert.equal(f.calls.length, 2)
  assert.ok(!f.messages.join('\n').includes('synthetic-secret'))
})

test('Hostinger rejects all-empty or excluded env before CLI/network, never clearing the live set', async () => {
  const f = await setup('OPTIONAL_KEY=\nPORT=3000\n')
  await assert.rejects(hostinger(f.ctx, 'deploy', async () => { throw Error('must not contact provider') }), /refusing an empty replacement/)
  assert.equal(f.calls.length, 0)
})

test('Hostinger rejects database names above the 25-character limit before any request', async () => {
  const name = 'u123456789_w67_stg_0123abcd'
  const f = await fixture({ version: 1, hostinger: { credentialsFile: 'tokens.env', targets: { api: {
    username: 'u123456789', domain: 'api.example.com', envFile: 'backend.env', databaseVariable: 'DATABASE_URL',
  } } } }, { env: 'staging', yes: true })
  await f.file('tokens.env', 'HOSTINGER_API_TOKEN=synthetic-token')
  await f.file('backend.env', `DATABASE_URL=mysql://${name}:synthetic-password@127.0.0.1:3306/${name}\n`)
  await assert.rejects(hostinger(f.ctx, 'setup', async () => { throw Error('must not contact provider') }), /at most 25 characters/)
})
test('Hostinger validates provider key/value/count limits without exposing values or making requests', async () => {
  for (const [env, expected] of [
    ['lowercase=synthetic-secret', /uppercase/],
    [`${'A'.repeat(256)}=synthetic-secret`, /255/],
    [`VALID_KEY=${'x'.repeat(8193)}`, /8192/],
    [Array.from({length: 1001}, (_, i) => `KEY_${i}=synthetic-secret`).join('\n'), /1-1000/],
  ]) {
    const f = await setup(env)
    await assert.rejects(hostinger(f.ctx, 'deploy', async () => { throw Error('must not contact provider') }), error => expected.test(error.message) && !error.message.includes('synthetic-secret'))
    assert.equal(f.calls.length, 0)
  }
})

test('Hostinger accepts exact key/value limits including Unicode character counts', async () => {
  const f = await setup(`${'A'.repeat(255)}=${'😀'.repeat(8192)}`)
  await hostinger(f.ctx, 'deploy', async () => new Response('{}'))
  assert.equal(f.calls.length, 2)
})

test('Hostinger labels provider environment rejection and stops before upload without echoing body', async () => {
  const f = await setup('APP_ENV=staging\nSECRET=synthetic-secret')
  await assert.rejects(hostinger(f.ctx, 'deploy', async () => new Response('{"error":"synthetic-secret"}', {status: 422})), error => /Hostinger environment sync failed:.*422/.test(error.message) && !error.message.includes('synthetic-secret'))
  assert.equal(f.calls.length, 1)
  assert.ok(f.calls[0].args.includes('--help'))
})
