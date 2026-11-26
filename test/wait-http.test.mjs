import test from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { validateConfig } from '../dist/config.js'
import { waitHttp } from '../dist/wait.js'
import { fixture } from './helpers.mjs'

const target = options => ({ version: 1, wait: { targets: { api: options } } })

test('HTTP readiness retries until the exact status and release header match; never reads or logs a body', async () => {
  const project = await fixture(target({ url: 'https://api.example.test/ready?key=fixture-secret', status: 200, marker: { header: 'X-Release', value: 'fixture-release' }, timeout: 3 }))
  let attempts = 0, cancelled = 0
  await waitHttp(project.ctx, async (url, options) => {
    assert.equal(url.pathname, '/ready')
    assert.equal(options.redirect, 'manual')
    assert.ok(options.signal instanceof AbortSignal)
    const headers = { 'x-release': ++attempts === 1 ? 'old-release' : 'fixture-release' }
    return new Response(new ReadableStream({ cancel() { cancelled++ } }), { headers })
  })
  assert.equal(attempts, 2)
  assert.equal(cancelled, 2)
  assert.match(project.messages.at(-1), /is ready/)
  assert.doesNotMatch(project.messages.join('\n'), /fixture-secret|fixture-release|old-release|api\.example/)
})

test('HTTP timeout aborts the attempt and sanitizes request failures and redirect locations', async () => {
  const project = await fixture(target({ variable: 'FIXTURE_RDS_HTTP_ENDPOINT', envFile: 'fixture.env', timeout: 0.04, hint: 'Start the API.' }))
  await project.file('fixture.env', 'FIXTURE_RDS_HTTP_ENDPOINT=http://127.0.0.1:9/ready\n')
  let aborted
  await assert.rejects(waitHttp(project.ctx, async (_, { signal }) => {
    aborted = signal
    await delay(1000, undefined, { signal })
    throw new Error('DO_NOT_EXPOSE')
  }), /request failed or timed out\. Start the API\./)
  assert.equal(aborted.aborted, true)
  await assert.rejects(waitHttp(project.ctx, async () => new Response(null, { status: 302, headers: { location: 'https://elsewhere.test/DO_NOT_EXPOSE' } })), /last response was HTTP 302/)
  assert.doesNotMatch(project.messages.join('\n'), /DO_NOT_EXPOSE|127\.0\.0\.1/)
})

test('HTTP dry-run does not read the URL or contact a service; unsafe URLs and TLS opt-out fail before fetch', async t => {
  const network = () => assert.fail('Unexpected network call')
  const plan = await fixture(target({ variable: 'FIXTURE_ABSENT_URL', envFile: 'missing.env' }), { 'dry-run': true })
  await waitHttp(plan.ctx, network)
  assert.match(plan.messages.join('\n'), /\[plan\]/)
  for (const url of ['http://user:password@example.test', 'https://example.test/#private', 'mysql://example.test']) {
    const project = await fixture(target({ url }))
    await assert.rejects(waitHttp(project.ctx, network), /must use HTTP\(S\)/)
  }
  const old = process.env.NODE_TLS_REJECT_UNAUTHORIZED
  t.after(() => { if (old === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED; else process.env.NODE_TLS_REJECT_UNAUTHORIZED = old })
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
  const https = await fixture(target({ url: 'https://example.test/health' }))
  await assert.rejects(waitHttp(https.ctx, network), /TLS verification disabled/)
})

test('wait configuration validates status and marker without affecting TCP targets', () => {
  assert.doesNotThrow(() => validateConfig(target({ host: '127.0.0.1', port: 9 })))
  for (const check of [{ status: 199 }, { status: 600 }, { marker: { header: 'bad name', value: 'x' } }, { marker: { header: 'x-release', value: 'x\n' } }, { marker: null }]) {
    assert.throws(() => validateConfig(target({ url: 'https://example.test', ...check })), /wait target/)
  }
  assert.throws(() => validateConfig(target({ host: '127.0.0.1', port: 9, status: 200 })), /needs a URL/)
})
