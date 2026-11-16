import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { androidStartAdb } from '../dist/android.js'
import { electron } from '../dist/desktop.js'
import { main } from '../dist/cli.js'
import { fixture } from './helpers.mjs'

test('ADB startup uses SDK environment without selecting a device or requiring a project', async () => {
  const f = await fixture({ version: 1, android: { sdkRoot: '/synthetic-sdk' } }, { 'dry-run': true })
  await androidStartAdb(f.ctx)
  assert.equal(f.calls.length, 0)
  assert.equal(f.ctx.plan.length, 1)
  assert.deepEqual(f.ctx.plan[0].args, ['start-server'])
  assert.equal(f.ctx.plan[0].capture, false)
  assert.equal(f.ctx.plan[0].env.ANDROID_SDK_ROOT, '/synthetic-sdk')
  assert.ok(f.ctx.plan[0].command.endsWith(process.platform === 'win32' ? 'adb.exe' : 'adb'))
  const bare = await fixture()
  await main(['android', 'start-adb', '--cwd', bare.root], bare.ctx.runner, () => {})
  assert.deepEqual(bare.calls[0].args, ['start-server'])
})

test('ADB startup respects production authorization before running any tools', async () => {
  const f = await fixture({ version: 1 }, { env: 'production' })
  await assert.rejects(androidStartAdb(f.ctx), /allow-production/)
  assert.equal(f.calls.length, 0)
})

test('Electron clean protects unmanaged files and dry-run never claims ownership', async () => {
  const f = await fixture({ version: 1, electron: { output: 'release/desktop' } })
  await f.file('reusable-dev-scripts.config.json', JSON.stringify(f.ctx.config))
  await f.file('release/desktop/important.txt', 'keep')
  for (const dryRun of [true, false]) {
    await assert.rejects(main(['electron', 'clean', '--cwd', f.root, ...(dryRun ? ['--dry-run'] : [])], f.ctx.runner, () => {}), /not created by rds/)
  }
  assert.equal(await readFile(join(f.root, 'release/desktop/important.txt'), 'utf8'), 'keep')
  const plan = await fixture({ version: 1, electron: {} }, { 'dry-run': true })
  await electron(plan.ctx, 'clean')
  assert.equal(existsSync(join(plan.root, 'release')), false)
  await f.file('release/desktop/.rds-owned', 'owned')
  await electron(f.ctx, 'clean')
  assert.equal(existsSync(join(f.root, 'release/desktop/important.txt')), false)
  assert.equal(existsSync(join(f.root, 'release/desktop/.rds-owned')), true)
})

test('Vue passthrough preserves literal Vite argv after successful typechecking', async () => {
  const f = await fixture()
  await f.file('reusable-dev-scripts.config.json', JSON.stringify({ version: 1, vue: { typecheck: 'build' } }))
  await main(['vue', 'build', '--cwd', f.root, '--', '--base', '/a path/', '--mode=staging'], f.ctx.runner, () => {})
  assert.equal(f.calls[0].command, 'vue-tsc')
  assert.deepEqual(f.calls[0].args, ['--build'])
  assert.deepEqual(f.calls[1].args, ['build', '--base', '/a path/', '--mode=staging'])
  const failure = await fixture()
  let calls = 0
  await assert.rejects(main(['vue', 'build', '--cwd', failure.root], async () => { calls++; throw new Error('Typecheck failed') }, () => {}), /Typecheck failed/)
  assert.equal(calls, 1)
  await assert.rejects(main(['vue', 'build', '--cwd', f.root, '--mode', 'production', '--', '--mode=staging'], f.ctx.runner, () => {}), /not both/)
})
