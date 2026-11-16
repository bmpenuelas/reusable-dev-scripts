import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { capacitorSync } from '../dist/capacitor.js'
import { validateConfig } from '../dist/config.js'
import { help } from '../dist/cli.js'
import { fixture } from './helpers.mjs'

test('afterBuild is validated as bounded argv hooks, not a shell or new section', () => {
  assert.deepEqual(validateConfig({ version: 1, capacitor: { afterBuild: [['node', 'generate.mjs']] } }).capacitor.afterBuild, [['node', 'generate.mjs']])
  for (const afterBuild of ['node generate.mjs', ['node generate.mjs'], [[]], [['node', '\0']]]) assert.throws(() => validateConfig({ version: 1, capacitor: { afterBuild } }))
  assert.throws(() => validateConfig({ version: 1, vue: { afterBuild: [] } }), /Unknown vue field/)
  assert.match(help('capacitor sync'), /afterBuild.*--skip-build/)
})

test('afterBuild runs after each default build before sync, with module cwd/platform/environment', async () => {
  const f = await fixture({ version: 1, vue: { typecheck: false }, capacitor: {
    root: 'mobile', platforms: ['android', 'ios'], environment: { BUILD_ENV: '{env}' },
    environmentByPlatform: { ios: { TARGET: '{platform}' } },
    afterBuild: [['node', 'generate.mjs', '{platform}', '{env}', '{root}']],
  } }, { env: 'staging' })
  await capacitorSync(f.ctx)
  assert.deepEqual(f.calls.map(step => step.command), ['vite', 'node', 'cap', 'vite', 'node', 'cap'])
  for (const [index, platform] of [[1, 'android'], [4, 'ios']]) {
    const hook = f.calls[index]
    assert.deepEqual(hook.args, ['generate.mjs', platform, 'staging', f.root])
    assert.equal(hook.cwd, join(f.root, 'mobile'))
    assert.equal(hook.env.BUILD_ENV, 'staging')
    assert.equal(hook.env.TARGET, platform === 'ios' ? 'ios' : undefined)
    assert.equal(f.calls[index + 1].args[0], 'sync')
  }
})

test('custom builds and copy use afterBuild, but skip-build omits it and dry-run only plans it', async () => {
  const config = { version: 1, capacitor: { platforms: ['android'], build: ['node', 'build.mjs'], afterBuild: [['node', 'generate.mjs']], afterSync: [['node', 'post.mjs']], verify: [['node', 'verify.mjs']] } }
  const f = await fixture(config)
  await capacitorSync(f.ctx, 'copy')
  assert.deepEqual(f.calls.map(step => step.args[0]), ['build.mjs', 'generate.mjs', 'copy', 'post.mjs', 'verify.mjs'])
  const skipped = await fixture(config, { 'skip-build': true })
  await capacitorSync(skipped.ctx)
  assert.deepEqual(skipped.calls.map(step => step.args[0]), ['sync', 'post.mjs', 'verify.mjs'])
  const plan = await fixture(config, { 'dry-run': true })
  await capacitorSync(plan.ctx)
  assert.equal(plan.calls.length, 0)
  assert.deepEqual(plan.ctx.plan.map(step => step.args[0]), ['build.mjs', 'generate.mjs', 'sync', 'post.mjs', 'verify.mjs'])
})

test('build/hook failures and production authorization stop before native operations', async () => {
  const config = { version: 1, capacitor: { platforms: ['android'], build: ['node', 'build.mjs'], afterBuild: [['node', 'generate.mjs']] } }
  for (const failed of ['build.mjs', 'generate.mjs']) {
    const f = await fixture(config), calls = []
    f.ctx.runner = async step => { calls.push(step); if (step.args[0] === failed) throw new Error('fixture failure'); return { stdout: '', stderr: '' } }
    await assert.rejects(capacitorSync(f.ctx), /fixture failure/)
    assert.ok(!calls.some(step => step.command === 'cap'))
    if (failed === 'build.mjs') assert.equal(calls.length, 1)
  }
  const production = await fixture(config, { env: 'production' })
  await assert.rejects(capacitorSync(production.ctx), /allow-production/)
  assert.equal(production.calls.length, 0)
})
