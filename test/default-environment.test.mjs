import test from 'node:test'
import assert from 'node:assert/strict'
import { cloudflare } from '../dist/cloudflare.js'
import { hostinger } from '../dist/hostinger.js'
import { hostingReset } from '../dist/hosting-reset.js'
import { env } from '../dist/env.js'
import { prisma } from '../dist/prisma.js'
import { validateConfig } from '../dist/config.js'
import { fixture } from './helpers.mjs'

const pages = (extra = {}, top = {}) => ({ version: 1, ...top, cloudflare: { targets: { web: { kind: 'pages', directory: 'dist', projectName: 'fixture', ...extra } } } })
const worker = (extra = {}, top = {}) => ({ version: 1, ...top, cloudflare: { targets: { api: { kind: 'worker', config: 'wrangler.toml', ...extra } } } })

test('a single-environment project deploys Pages without --env through defaultEnvironment and a branch', async () => {
  const f = await fixture(pages({ branch: 'main' }, { defaultEnvironment: 'live' }))
  await cloudflare(f.ctx, 'deploy-pages')
  assert.equal(f.ctx.environment, 'live')
  const args = f.calls[0].args
  assert.equal(args[args.indexOf('--branch') + 1], 'main')
  assert.equal(f.calls[0].env.RDS_ENV, 'live')
})

test('--env still wins over defaultEnvironment, and without either the command asks for one', async () => {
  const chosen = await fixture(pages({}, { defaultEnvironment: 'live' }), { env: 'staging' })
  await cloudflare(chosen.ctx, 'deploy-pages')
  assert.equal(chosen.calls[0].args[chosen.calls[0].args.indexOf('--branch') + 1], 'staging')
  const missing = await fixture(pages())
  await assert.rejects(cloudflare(missing.ctx, 'deploy-pages'), /explicit --env, or defaultEnvironment/)
  assert.equal(missing.calls.length, 0)
})

test('protected defaults keep their production guard and the guard hooks', async () => {
  const f = await fixture(pages({}, { defaultEnvironment: 'production', production: { verify: [['node', 'scripts/verify.mjs', '{env}']] } }))
  await assert.rejects(cloudflare(f.ctx, 'deploy-pages'), /--allow-production/)
  f.ctx.flags['allow-production'] = true
  await cloudflare(f.ctx, 'deploy-pages')
  assert.deepEqual(f.calls[0].args, ['scripts/verify.mjs', 'production'])
})

test('Worker targets can omit or rename the wrangler environment', async () => {
  const plain = await fixture(worker({ wranglerEnv: false }, { defaultEnvironment: 'live' }))
  await cloudflare(plain.ctx, 'deploy-worker')
  assert.ok(!plain.calls[0].args.includes('--env'))
  const renamed = await fixture(worker({ wranglerEnv: 'prod' }, { defaultEnvironment: 'live' }))
  await cloudflare(renamed.ctx, 'deploy-worker')
  assert.equal(renamed.calls[0].args[renamed.calls[0].args.indexOf('--env') + 1], 'prod')
  const inherited = await fixture(worker({}, { defaultEnvironment: 'live' }))
  await cloudflare(inherited.ctx, 'deploy-worker')
  assert.equal(inherited.calls[0].args[inherited.calls[0].args.indexOf('--env') + 1], 'live')
})

test('only commands that act on a named environment use the default', async () => {
  const f = await fixture({ version: 1, defaultEnvironment: 'production' })
  assert.equal(f.ctx.environment, 'development', 'builds and native commands keep their own default and guards')
  f.ctx.requireEnvironment('Fixture commands')
  assert.equal(f.ctx.environment, 'production')
})

test('hostinger, env, prisma and hosting reset accept the default but still fail on their own rules', async () => {
  const commands = [
    ['hostinger', c => hostinger(c, 'setup')],
    ['env', c => env(c, 'validate')],
    ['prisma', c => prisma(c, 'status')],
    ['hosting', c => hostingReset(c)],
  ]
  for (const [name, run] of commands) {
    const without = await fixture({ version: 1, [name === 'hosting' ? 'hostinger' : name]: { targets: {}, module: 'm.mjs', envFile: '.env' } })
    await assert.rejects(run(without.ctx), /explicit --env/, name)
    const withDefault = await fixture({ version: 1, defaultEnvironment: 'staging', [name === 'hosting' ? 'hostinger' : name]: { targets: {}, module: 'm.mjs', envFile: '.env' } })
    await assert.rejects(run(withDefault.ctx), error => !/explicit --env/.test(error.message), `${name} moved past the environment requirement`)
    assert.equal(withDefault.ctx.environment, 'staging')
  }
  const protectedDefault = await fixture({ version: 1, defaultEnvironment: 'production', hostinger: { targets: {} } })
  await assert.rejects(hostingReset(protectedDefault.ctx), /unprotected/)
})

test('defaultEnvironment, branch and wranglerEnv are validated', () => {
  assert.doesNotThrow(() => validateConfig(pages({ branch: 'main', wranglerEnv: false }, { defaultEnvironment: 'live' })))
  assert.throws(() => validateConfig({ version: 1, defaultEnvironment: 'not valid' }), /defaultEnvironment/)
  assert.throws(() => validateConfig({ version: 1, defaultEnvironment: 1 }), /defaultEnvironment/)
  assert.throws(() => validateConfig(pages({ branch: '--oops' })), /branch/)
  assert.throws(() => validateConfig(worker({ wranglerEnv: true })), /wranglerEnv/)
  assert.throws(() => validateConfig(worker({ wranglerEnv: 'bad env' })), /wranglerEnv/)
})
