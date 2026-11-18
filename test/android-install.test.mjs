import test from 'node:test'
import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { androidInstall } from '../dist/android.js'
import { Failure } from '../dist/runtime.js'
import { help } from '../dist/cli.js'
import { fixture } from './helpers.mjs'

async function installFixture(t, flags = {}) {
  const f = await fixture({ version: 1, android: { appId: 'com.example.app.debug' } }, { physical: true, ...flags })
  t.after(async () => {
    const target = resolve(f.root)
    assert.equal(dirname(target), resolve(tmpdir()))
    await rm(target, { recursive: true, force: true })
  })
  await f.file('android/app/build/outputs/apk/debug/app-debug.apk', 'synthetic APK')
  f.ctx.runner = async step => {
    f.calls.push(step)
    assert.equal(step.successExitCodes, undefined, 'ADB failures must stay strict')
    if (step.args[0] === 'devices') return { stdout: 'fixture-device\tdevice\n', stderr: '' }
    if (step.args.includes('path')) return { stdout: 'package:/fixture/base.apk\n', stderr: '' }
    return { stdout: 'Success\n', stderr: '' }
  }
  return f
}

test('debug installation verifies exactly the configured ID and names each stage', async t => {
  const f = await installFixture(t)
  await androidInstall(f.ctx)
  assert.deepEqual(f.calls.map(step => step.label), ['List Android devices', 'Install Android APK', 'Verify installed Android package'])
  assert.deepEqual(f.calls[2].args, ['-s', 'fixture-device', 'shell', 'pm', 'path', 'com.example.app.debug'])
  assert.ok(!f.calls.some(step => step.args.includes('uninstall') || step.args.includes('com.example.app')))
})

test('explicit replacement addresses only the configured debug package, never a release fallback', async t => {
  const f = await installFixture(t, { replace: true })
  await androidInstall(f.ctx)
  assert.deepEqual(f.calls.map(step => step.label), ['List Android devices', 'Check existing Android installation', 'Remove existing Android installation', 'Install Android APK', 'Verify installed Android package'])
  const packageCalls = f.calls.filter(step => step.args.includes('path') || step.args.includes('uninstall'))
  assert.equal(packageCalls.length, 3)
  assert.ok(packageCalls.every(step => step.args.at(-1) === 'com.example.app.debug'))
  assert.ok(!f.calls.some(step => step.args.includes('com.example.app')))
})

test('an APK install error is fatal at the install stage without removal or verification', async t => {
  const f = await installFixture(t)
  const successful = f.ctx.runner
  f.ctx.runner = async step => {
    if (step.args.includes('install')) { f.calls.push(step); throw new Failure(`${step.label} failed`, 1) }
    return successful(step)
  }
  await assert.rejects(androidInstall(f.ctx), /Install Android APK failed/)
  assert.deepEqual(f.calls.map(step => step.label), ['List Android devices', 'Install Android APK'])
})

test('verification errors stay fatal after successful installation and identify the failing stage', async t => {
  const f = await installFixture(t)
  const successful = f.ctx.runner
  f.ctx.runner = async step => {
    if (step.args.includes('path')) { f.calls.push(step); throw new Failure(`${step.label} failed`, 1) }
    return successful(step)
  }
  await assert.rejects(androidInstall(f.ctx), /Verify installed Android package failed/)
  assert.equal(f.calls.length, 3)
  assert.ok(!f.calls.some(step => step.args.includes('uninstall')))
})

test('empty verification output and missing installation confirmation cannot pass', async t => {
  for (const stage of ['install', 'path']) {
    const f = await installFixture(t)
    const successful = f.ctx.runner
    f.ctx.runner = async step => {
      if (step.args.includes(stage)) { f.calls.push(step); return { stdout: '', stderr: '' } }
      return successful(step)
    }
    await assert.rejects(androidInstall(f.ctx), stage === 'install' ? /did not confirm successful installation/ : /package could not be verified/)
    assert.equal(f.calls.length, stage === 'install' ? 2 : 3)
    assert.ok(!f.calls.some(step => step.args.includes('uninstall')))
  }
})

test('dry-run plans verification of the debug package without touching a device', async t => {
  const f = await installFixture(t, { 'dry-run': true })
  await androidInstall(f.ctx)
  assert.equal(f.calls.length, 0)
  assert.deepEqual(f.ctx.plan.map(step => step.label), ['Install Android APK', 'Verify installed Android package'])
  assert.equal(f.ctx.plan.at(-1).args.at(-1), 'com.example.app.debug')
  assert.match(help('android install'), /including any debug suffix/)
})
