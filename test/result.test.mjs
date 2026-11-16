import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { runCli, formatResultBanner, bannersEnabled, supportsBannerColor } from '../dist/result.js'
import { validateConfig } from '../dist/config.js'
import { Failure } from '../dist/runtime.js'
import { fixture } from './helpers.mjs'

const now = () => new Date('2026-01-02T03:04:05.000Z')
const capture = (extra = {}) => {
  const errors = [], logs = []
  return { errors, logs, options: { env: {}, color: false, now, error: text => errors.push(text), log: text => logs.push(text), ...extra } }
}

test('result banner formatting is timestamped, plain by default and strips terminal controls', () => {
  const text = formatResultBanner('success', '\u001b[31mExample\u001b[0m\0', now())
  assert.match(text, /✅  SUCCESS\n2026-01-02T03:04:05.000Z/)
  assert.ok(text.includes('Example')); assert.ok(!text.includes('\u001b')); assert.ok(!text.includes('\0'))
  assert.match(formatResultBanner('failure', 'Failure', now(), true), /\u001b\[1;31m/)
  assert.equal(supportsBannerColor({ isTTY: false }, {}), false)
  assert.equal(supportsBannerColor({ isTTY: true, hasColors: () => true }, {}), true)
  for (const env of [{ NO_COLOR: '', FORCE_COLOR: '1' }, { TERM: 'dumb', FORCE_COLOR: '1' }, { FORCE_COLOR: '0' }]) assert.equal(supportsBannerColor({ isTTY: true }, env), false)
})

test('banner configuration validates and follows CLI, environment, config precedence', () => {
  const config = { version: 1, output: { banners: false } }
  assert.doesNotThrow(() => validateConfig(config))
  for (const value of ['false', 0, null]) assert.throws(() => validateConfig({ version: 1, output: { banners: value } }), /boolean/)
  assert.throws(() => validateConfig({ version: 1, output: { banner: false } }), /Unknown output field/)
  assert.equal(bannersEnabled({}, { version: 1 }, {}), true)
  assert.equal(bannersEnabled({}, config, {}), false)
  assert.equal(bannersEnabled({}, config, { RDS_BANNERS: '1' }), true)
  assert.equal(bannersEnabled({ banner: true }, config, { RDS_BANNERS: '0' }), true)
  assert.equal(bannersEnabled({ 'no-banner': true }, { version: 1 }, { RDS_BANNERS: '1' }), false)
  assert.equal(bannersEnabled({ banner: true }, config, { RDS_BANNER_OWNER: '1' }), false)
  assert.throws(() => bannersEnabled({}, config, { RDS_BANNERS: 'invalid' }), /0 or 1/)
})

test('outer CLI reports success once, owns child output, and leaves programmatic callers unchanged', async () => {
  const f = await fixture(), output = capture({ runner: f.ctx.runner })
  assert.equal(await runCli(['exec', '--cwd', f.root, '--', 'node', '-e', 'SECRET_ARG', '--no-banner'], output.options), 0)
  assert.equal(output.errors.length, 1)
  assert.match(output.errors[0], /SUCCESS/)
  assert.ok(!output.errors.join('').includes('SECRET_ARG'))
  assert.equal(f.calls[0].env.RDS_BANNER_OWNER, '1')
  assert.equal(f.ctx.resultBannerOwner, false)
})

test('CLI config and overrides apply to success and failure without hiding diagnostics', async () => {
  const f = await fixture()
  await f.file('reusable-dev-scripts.config.json', JSON.stringify({ version: 1, output: { banners: false } }))
  for (const suffix of [[], ['--banner'], ['--no-banner']]) {
    const output = capture({ runner: async () => { throw new Failure('Fixture failed', 7) } })
    assert.equal(await runCli(['exec', '--cwd', f.root, ...suffix, '--', 'node'], output.options), 7)
    assert.match(output.errors[0], /Fixture failed/)
    assert.equal(output.errors.some(text => text.includes('FAILED')), suffix.includes('--banner'))
  }
})

test('dry-run reports a plan, help/version stay clean, and startup failures honor suppression', async () => {
  const f = await fixture(), output = capture()
  assert.equal(await runCli(['exec', '--cwd', f.root, '--dry-run', '--', 'node'], output.options), 0)
  assert.match(output.errors[0], /PLAN COMPLETE/); assert.ok(!output.errors[0].includes('SUCCESS'))
  for (const args of [[], ['--help'], ['vue', 'build', '--help'], ['--version']]) {
    const info = capture({ env: { RDS_BANNERS: 'invalid' } })
    assert.equal(await runCli(args, info.options), 0); assert.equal(info.errors.length, 0)
  }
  const invalid = capture()
  assert.equal(await runCli(['unknown', '--no-banner'], invalid.options), 1)
  assert.equal(invalid.errors.length, 1)
  const syntax = capture()
  assert.equal(await runCli(['--no-banner', '--unknown'], syntax.options), 1)
  assert.equal(syntax.errors.length, 1)
  const conflict = capture()
  assert.equal(await runCli(['exec', '--banner', '--no-banner'], conflict.options), 1)
  assert.match(conflict.errors[0], /only one/)
})

test('nested CLI invocations suppress banners, exit codes survive output failure', async () => {
  const f = await fixture()
  const nested = capture({ env: { RDS_BANNER_OWNER: '1' }, runner: f.ctx.runner })
  assert.equal(await runCli(['exec', '--banner', '--cwd', f.root, '--', 'node'], nested.options), 0)
  assert.equal(nested.errors.length, 0)
  const broken = capture({ runner: async () => { throw new Failure('Fixture interrupted', 143) }, error: () => { throw new Error('Closed output') } })
  assert.equal(await runCli(['exec', '--cwd', f.root, '--', 'node'], broken.options), 143)
})

test('real CLI emits UTF-8 banners on stderr, preserves exits and suppresses nested results', async () => {
  const f = await fixture(), entry = fileURLToPath(new URL('../bin/rds.mjs', import.meta.url))
  const env = { ...process.env, RDS_BANNERS: '1', NO_COLOR: '1' }
  delete env.RDS_BANNER_OWNER
  const execute = args => spawnSync(process.execPath, [entry, ...args], { cwd: f.root, env, encoding: 'utf8', windowsHide: true })
  const ok = execute(['exec', '--', 'node', '-e', 'console.log("CHILD_OK")'])
  assert.equal(ok.status, 0); assert.match(ok.stdout, /CHILD_OK/)
  assert.ok(!ok.stdout.includes('SUCCESS')); assert.match(ok.stderr, /✅  SUCCESS/)
  const failed = execute(['exec', '--', 'node', '-e', 'process.exit(9)'])
  assert.equal(failed.status, 9); assert.match(failed.stderr, /FAILED/); assert.ok(!failed.stderr.includes('SUCCESS'))
  const nested = execute(['exec', '--', 'node', entry, 'exec', '--', 'node', '-e', 'console.log("NESTED_OK")'])
  assert.equal(nested.status, 0); assert.match(nested.stdout, /NESTED_OK/)
  assert.equal(nested.stderr.match(/SUCCESS/gu)?.length, 1)
})
