import test from 'node:test'
import assert from 'node:assert/strict'
import { hostinger } from '../dist/hostinger.js'
import { fixture } from './helpers.mjs'

const id = '00000000-0000-4000-8000-000000000001'
const config = { version: 1, production: { verify: [['must-not-run']] }, hostinger: {
  credentialsFile: 'provider.env', targets: { site: { domain: 'wrong.example.test', username: 'fixture', environments: {
    production: { domain: 'right.example.test', username: 'site_user' },
  } } },
} }

test('Hostinger status reads only scoped build metadata and never needs deploy prerequisites', async () => {
  for (const state of ['pending', 'running', 'completed', 'failed']) {
    const requested = state !== 'pending'
    const f = await fixture(config, { env: 'production', ...(requested ? { 'build-id': id } : {}) })
    await f.file('provider.env', 'HOSTINGER_API_TOKEN=FIXTURE_TOKEN')
    const build = { uuid: id, state, logs: 'PRIVATE_LOG', options: { env: 'PRIVATE_VALUE' } }
    await hostinger(f.ctx, 'status', async (url, init) => {
      const base = 'https://developers.hostinger.com/api/hosting/v1/accounts/site_user/websites/right.example.test/nodejs/builds'
      assert.equal(url, requested ? `${base}/${id}` : `${base}?page=1&per_page=1`)
      assert.equal(init.method, 'GET')
      assert.equal(init.redirect, 'error')
      return Response.json(requested ? build : { data: [build] })
    })
    assert.equal(f.calls.length, 0)
    assert.match(f.messages.join('\n'), new RegExp(`${id} is ${state} \\(application health not checked\\)`))
    assert.doesNotMatch(f.messages.join('\n'), /PRIVATE_|FIXTURE_TOKEN/)
  }
})

test('Hostinger status rejects invalid IDs, mismatches and unknown states, and plans without credentials', async () => {
  const network = () => assert.fail('Unexpected network call')
  const plan = await fixture(config, { env: 'production', 'dry-run': true })
  await hostinger(plan.ctx, 'status', network)
  const invalid = await fixture(config, { env: 'production', 'build-id': '../../other' })
  await assert.rejects(hostinger(invalid.ctx, 'status', network), /--build-id/)
  const f = await fixture(config, { env: 'production', 'build-id': id })
  await f.file('provider.env', 'HOSTINGER_API_TOKEN=FIXTURE_TOKEN')
  await assert.rejects(hostinger(f.ctx, 'status', async () => Response.json({ uuid: '00000000-0000-4000-8000-000000000002', state: 'running' })), /unexpected build status/)
  await assert.rejects(hostinger(f.ctx, 'status', async () => Response.json({ uuid: id, state: 'PRIVATE_VALUE' })), /unexpected build status/)
  const empty = await fixture(config, { env: 'production' })
  await empty.file('provider.env', 'HOSTINGER_API_TOKEN=FIXTURE_TOKEN')
  await hostinger(empty.ctx, 'status', async () => Response.json({ data: [] }))
  assert.match(empty.messages.join('\n'), /No Node\.js builds/)
})
