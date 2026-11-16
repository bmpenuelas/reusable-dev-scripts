import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { runSteps } from '../dist/index.js'
import { fixture } from './helpers.mjs'

const exec = code => ['exec', '--no-banner', '--', 'node', '-e', code]

test('shared step runner preserves sequential literal argv and the consumer cwd', async () => {
  const f = await fixture(), path = join(f.root, 'steps.json')
  const value = 'literal spaces = equals & not a shell'
  const first = [...exec("require('node:fs').writeFileSync('steps.json', JSON.stringify([process.argv[1]]))"), value]
  const second = exec("const fs=require('node:fs');const x=JSON.parse(fs.readFileSync('steps.json'));x.push('second');fs.writeFileSync('steps.json',JSON.stringify(x))")
  assert.equal(await runSteps([first, second], { cwd: f.root }), 0)
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), [value, 'second'])
})

test('shared step runner stops on the original exit code and cleans signal listeners', async () => {
  const f = await fixture(), counts = ['SIGINT', 'SIGTERM'].map(name => process.listenerCount(name))
  assert.equal(await runSteps([exec('process.exit(7)'), exec("require('node:fs').writeFileSync('forbidden', '')")], { cwd: f.root }), 7)
  assert.equal(existsSync(join(f.root, 'forbidden')), false)
  assert.deepEqual(['SIGINT', 'SIGTERM'].map(name => process.listenerCount(name)), counts)
  assert.equal(await runSteps([], { cwd: f.root }), 0)
})

test('shared step dry-run reaches every CLI before passthrough without changing the input', async () => {
  const f = await fixture()
  const steps = [exec("require('node:fs').writeFileSync('forbidden', '')"), ['exec', '--dry-run', '--no-banner', '--', 'node', '-e', 'process.exit(9)', '--dry-run']]
  const before = structuredClone(steps)
  assert.equal(await runSteps(steps, { cwd: f.root, dryRun: true }), 0)
  assert.equal(existsSync(join(f.root, 'forbidden')), false)
  assert.deepEqual(steps, before)
})

test('shared step runner validates all argv shapes/options before the first effect', async () => {
  const f = await fixture(), first = exec("require('node:fs').writeFileSync('forbidden', '')")
  for (const bad of [[], 'shell string', ['exec', '\0']]) await assert.rejects(runSteps([first, bad], { cwd: f.root }), /argv/)
  for (const options of [{ dryRun: 'yes' }, { cwd: '' }, { signal: {} }]) await assert.rejects(runSteps([first], options))
  assert.equal(existsSync(join(f.root, 'forbidden')), false)
})

test('shared step runner honors pre-abort and cancellation without starting later steps', async () => {
  const f = await fixture(), controller = new AbortController()
  controller.abort()
  assert.equal(await runSteps([exec("require('node:fs').writeFileSync('forbidden', '')")], { cwd: f.root, signal: controller.signal }), 143)
  // An isolated caller can receive/forward SIGINT without interrupting node:test.
  for (const abort of [false, true]) {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { runSteps } from ${JSON.stringify(new URL('../dist/index.js', import.meta.url).href)};
      const controller = new AbortController();
      const timer = setTimeout(() => ${abort ? "controller.abort()" : "process.emit('SIGINT')"}, 50);
      try { process.exitCode = await runSteps(${JSON.stringify([exec('setTimeout(() => {}, 300)'), exec("require('node:fs').writeFileSync('forbidden', '')")])}, { cwd: ${JSON.stringify(f.root)}, signal: controller.signal }); }
      finally { clearTimeout(timer); }
    `], { encoding: 'utf8', windowsHide: true, timeout: 10000 })
    assert.ifError(result.error)
    assert.equal(result.status, abort ? 143 : 130, result.stderr)
    assert.equal(existsSync(join(f.root, 'forbidden')), false)
  }
})

test('shared steps retain child result banners without a misleading recipe success', async () => {
  const f = await fixture(), env = { ...process.env, RDS_BANNERS: '1', NO_COLOR: '1' }
  delete env.RDS_BANNER_OWNER
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { runSteps } from ${JSON.stringify(new URL('../dist/index.js', import.meta.url).href)};
    process.exitCode = await runSteps([['exec', '--', 'node', '-e', 'process.exit(7)']], { cwd: ${JSON.stringify(f.root)} });
  `], { env, encoding: 'utf8', windowsHide: true, timeout: 10000 })
  assert.ifError(result.error)
  assert.equal(result.status, 7)
  assert.equal((result.stderr.match(/FAILED/gu) ?? []).length, 1)
  assert.ok(!result.stderr.includes('SUCCESS'))
})
