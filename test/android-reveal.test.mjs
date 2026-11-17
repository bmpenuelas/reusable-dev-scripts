import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { androidBuild, artifacts } from '../dist/android.js'
import { capacitorOpen } from '../dist/capacitor.js'
import { help } from '../dist/cli.js'
import { runCli } from '../dist/result.js'
import { Failure, runProcess } from '../dist/runtime.js'
import { fixture } from './helpers.mjs'

async function buildFixture(t, flags = { reveal: true }) {
  const f = await fixture({ version: 1, android: { aab: 'app/build/outputs/bundle/release/artifact with spaces & comma,.aab' } }, flags)
  t.after(async () => {
    const target = resolve(f.root)
    assert.equal(dirname(target), resolve(tmpdir()))
    await rm(target, { recursive: true, force: true })
  })
  await f.file('reusable-dev-scripts.config.json', JSON.stringify(f.ctx.config))
  // All build/explorer commands below are mocked; never run a native build or GUI.
  await f.file(process.platform === 'win32' ? 'android/gradlew.bat' : 'android/gradlew', 'unused fixture wrapper')
  return f
}

const successfulResult = { stdout: '', stderr: '' }

test('Explorer handoff exit 1 succeeds without a false warning; other platform errors still warn', async t => {
  const f = await buildFixture(t)
  const artifact = await f.file('android/app/build/outputs/bundle/release/artifact with spaces & comma,.aab', 'fixture AAB')
  const calls = [], logs = [], errors = []
  const code = await runCli(['android', 'build', '--cwd', f.root, '--reveal', '--banner'], {
    env: {}, color: false, log: line => logs.push(line), error: line => errors.push(line),
    runner: async step => {
      calls.push(step)
      if (step.label === 'Reveal artifact') {
        // Reproduce Explorer's problematic exit code using Node, without opening Explorer.
        return runProcess({ ...step, command: 'node', args: ['-e', 'process.exit(1)'], cwd: f.root, capture: true, windowsHide: true })
      }
      return successfulResult
    },
  })
  assert.equal(code, 0)
  assert.deepEqual(calls.map(call => call.label), ['Android Gradle build', 'Reveal artifact'])
  assert.ok(logs.some(line => line.includes(`Artifact: ${artifact}`)))
  assert.equal(logs.filter(line => line.includes('Warning:')).length, process.platform === 'win32' ? 0 : 1)
  assert.match(errors.join('\n'), /SUCCESS/)
  assert.doesNotMatch(errors.join('\n'), /FAILED/)
  assert.equal(await readFile(artifact, 'utf8'), 'fixture AAB')
  const reveal = calls[1]
  if (process.platform === 'win32') {
    assert.equal(reveal.command, 'explorer.exe')
    assert.deepEqual(reveal.args, [`/select,${artifact}`])
    assert.deepEqual(reveal.successExitCodes, [0, 1])
    assert.equal(reveal.windowsHide, false)
  } else if (process.platform === 'darwin') {
    assert.equal(reveal.command, 'open')
    assert.deepEqual(reveal.args, ['-R', artifact])
    assert.equal(reveal.successExitCodes, undefined)
  } else {
    assert.equal(reveal.command, 'xdg-open')
    assert.deepEqual(reveal.args, [dirname(artifact)])
    assert.equal(reveal.successExitCodes, undefined)
  }
})

test('file-manager launch and other reveal failures are warning-only without exposing error details', async t => {
  for (const failure of [new Failure('PRIVATE_REVEAL_DETAILS', 2), new Failure('PRIVATE_REVEAL_DETAILS', 127), new Error('PRIVATE_REVEAL_DETAILS')]) {
    const f = await buildFixture(t)
    const artifact = await f.file('android/app/build/outputs/bundle/release/artifact with spaces & comma,.aab', 'fixture AAB')
    f.ctx.runner = async step => {
      f.calls.push(step)
      if (step.label === 'Reveal artifact') throw failure
      return successfulResult
    }
    assert.equal(await androidBuild(f.ctx), artifact)
    assert.equal(f.calls.length, 2)
    assert.ok(f.messages.some(line => line.includes('Warning:')))
    assert.doesNotMatch(f.messages.join('\n'), /PRIVATE_REVEAL_DETAILS/)
  }
})

test('Gradle failures remain fatal even with a stale artifact and --reveal', async t => {
  const f = await buildFixture(t)
  await f.file('android/app/build/outputs/bundle/release/artifact with spaces & comma,.aab', 'stale fixture AAB')
  f.ctx.runner = async step => { f.calls.push(step); throw new Failure('Fixture Gradle build failed', 7) }
  await assert.rejects(androidBuild(f.ctx), error => error instanceof Failure && error.exitCode === 7)
  assert.deepEqual(f.calls.map(call => call.label), ['Android Gradle build'])
  assert.ok(!f.messages.some(line => line.includes('Warning:') || line.includes('Artifact:')))
})

test('a missing expected artifact still fails before reveal', async t => {
  const f = await buildFixture(t)
  await assert.rejects(androidBuild(f.ctx), /without producing the configured artifact/)
  assert.deepEqual(f.calls.map(call => call.label), ['Android Gradle build'])
  assert.ok(!f.messages.some(line => line.includes('Warning:') || line.includes('Artifact:')))
})

test('successful reveal has no warning and builds without --reveal never launch a file manager', async t => {
  for (const reveal of [true, false]) {
    const f = await buildFixture(t, { reveal })
    await f.file('android/app/build/outputs/bundle/release/artifact with spaces & comma,.aab', 'fixture AAB')
    assert.equal(await androidBuild(f.ctx), artifacts(f.ctx, 'release', 'aab'))
    assert.equal(f.calls.length, reveal ? 2 : 1)
    assert.ok(!f.messages.some(line => line.includes('Warning:')))
    assert.equal(f.calls[0].successExitCodes, undefined)
    assert.equal(f.calls[0].windowsHide, undefined)
  }
})

test('custom tasks skip artifact inference and reveal, and production authorization is still mandatory', async t => {
  const custom = await buildFixture(t)
  await androidBuild(custom.ctx, [':app:customTask'])
  assert.deepEqual(custom.calls.map(call => call.label), ['Android Gradle build'])
  assert.ok(!custom.messages.some(line => line.includes('Artifact:') || line.includes('Warning:')))
  const protectedBuild = await buildFixture(t, { reveal: true, env: 'production' })
  await assert.rejects(androidBuild(protectedBuild.ctx), /requires --allow-production/)
  assert.equal(protectedBuild.calls.length, 0)
})

test('dry-run plans reveal without tools or writes, and help documents its best-effort status', async t => {
  const f = await buildFixture(t, { reveal: true, 'dry-run': true })
  const before = await readdir(f.root, { recursive: true })
  f.ctx.runner = async () => { throw new Error('Dry-run must not execute') }
  await androidBuild(f.ctx)
  assert.equal(f.calls.length, 0)
  assert.deepEqual(f.ctx.plan.map(step => step.label), ['Android Gradle build', 'Reveal artifact'])
  assert.deepEqual(await readdir(f.root, { recursive: true }), before)
  assert.ok(f.messages.some(line => line === '[plan] Reveal artifact'))
  assert.ok(!f.messages.some(line => line.includes('Warning:')))
  assert.match(help('android build'), /--reveal is best-effort/)
})

test('other Android commands keep strict exit handling rather than inheriting Explorer status rules', async t => {
  const f = await buildFixture(t)
  f.ctx.config.capacitor = { platforms: ['android'] }
  f.ctx.runner = async step => {
    f.calls.push(step)
    assert.equal(step.successExitCodes, undefined)
    return runProcess({ command: 'node', args: ['-e', 'process.exit(1)'], cwd: f.root, capture: true, label: step.label })
  }
  await assert.rejects(capacitorOpen(f.ctx, 'android'), error => error instanceof Failure && error.exitCode === 1)
  assert.deepEqual(f.calls[0].args, ['open', 'android'])
  const { androidStartAdb } = await import('../dist/android.js')
  await assert.rejects(androidStartAdb(f.ctx), error => error instanceof Failure && error.exitCode === 1)
  assert.deepEqual(f.calls[1].args, ['start-server'])
})
