import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { parse, main, commands, help } from '../dist/cli.js'
import { validateConfig } from '../dist/config.js'
import { inside, outputPath, resolveExecutable, batchInvocation, runProcess, Failure } from '../dist/runtime.js'
import { fixture } from './helpers.mjs'

test('strict CLI parsing preserves literal passthrough and inline equals', () => {
  assert.deepEqual(parse(['exec', '--dry-run', '--', 'node', '-e', 'a=1; b="hello world"']), { key: 'exec', flags: { 'dry-run': true }, forwarded: ['node', '-e', 'a=1; b="hello world"'] })
  assert.equal(parse(['store', 'changelog', '--text=a=b']).flags.text, 'a=b')
  for (const args of [['--unknown'], ['--env'], ['--dry-run=false'], ['--env', 'dev', '--env', 'prod']]) assert.throws(() => parse(args))
})
test('all commands have help without loading consumer config', async () => {
  for (const key of Object.keys(commands)) { const lines = []; await main([...key.split(' '), '--help'], undefined, x => lines.push(x)); assert.ok(lines[0].startsWith(`rds ${key}\n`)); assert.match(lines[0], /Options:/) }
  for (const key of ['capacitor versions', 'capacitor prepare', 'vscode publish']) assert.match(help(key), /workspace lockfile/)
  await assert.rejects(main(['vue', 'build', '--registry', 'all']), /not supported/)
  await assert.rejects(main(['capacitor', 'sync', '--', 'surprise']), /passthrough/)
})
test('validates hook argv without interpreting translation names as hooks', () => {
  assert.throws(() => validateConfig({ version: 1, capacitor: { prepare: ['npm run build'] } }), /argv/)
  assert.throws(() => validateConfig({ version: 1, unexpected: {} }), /Unknown/)
  assert.throws(() => validateConfig({ version: 1, production: { verfy: [] } }), /Unknown production field/)
  assert.throws(() => validateConfig({ version: 1, capacitor: { buildByPlatform: { andriod: ['node', 'build.mjs'] } } }), /Unknown buildByPlatform/)
  assert.throws(() => validateConfig({ version: 1, capacitor: { packageJson: 123 } }), /packageJson must be a non-empty path/)
  assert.throws(() => validateConfig({ version: 1, vue: { typecheck: true } }), /typecheck/)
  assert.doesNotThrow(() => validateConfig({ version: 1, capacitor: { locales: { locales: { en: { prepare: 'Ready?' } }, defaultLocale: 'en', targets: [] } } }))
})
test('configuration search resolves project root from a nested workspace', async () => {
  for (const extension of ['json', 'mjs']) {
    const f = await fixture(), config = JSON.stringify({ version: 1, vue: { root: 'frontend' } })
    await f.file(`reusable-dev-scripts.config.${extension}`, extension === 'json' ? config : `export default ${config}`)
    await mkdir(join(f.root, 'frontend'))
    const result = await main(['vue', 'build', '--cwd', join(f.root, 'frontend'), '--dry-run'], undefined, () => {})
    assert.equal(result.root, f.root); assert.equal(result.plan[0].cwd, join(f.root, 'frontend'))
  }
})
test('output and input containment rejects traversal and directory replacement', async t => {
  const f = await fixture(); assert.throws(() => inside(f.root, '../escape'), /inside/); assert.throws(() => outputPath(f.root, '.'), /replace/)
  const other = await fixture()
  try { await symlink(other.root, join(f.root, 'link'), process.platform === 'win32' ? 'junction' : 'dir') }
  catch (error) { if (error.code === 'EPERM') { t.skip('Host sandbox forbids creating test symlinks'); return } throw error }
  assert.throws(() => outputPath(f.root, 'link/escape.txt'), /symlink/)
})
test('local executable resolution works with spaces and workspace parents', async () => {
  const f = await fixture(); await f.file('node_modules/vite/package.json', JSON.stringify({ bin: { vite: 'bin/vite.js' } })); const cli = await f.file('node_modules/vite/bin/vite.js', '')
  await mkdir(join(f.root, 'space workspace')); const [binary, args] = resolveExecutable('vite', ['build', 'argument with spaces'], join(f.root, 'space workspace'))
  assert.equal(binary, process.execPath); assert.deepEqual(args, [cli, 'build', 'argument with spaces'])
  assert.throws(() => resolveExecutable('cap', [], f.root), /Install/)
})
test('Windows batch encoding rejects interpolation and command chaining', () => {
  for (const value of ['x&whoami', '%PATH%', '!PATH!', 'x\ny', 'x"y', '^x', 'x|y']) assert.throws(() => batchInvocation('gradlew.bat', [value]), /Unsafe/)
  const result = batchInvocation('C:\\Program Files\\gradlew.bat', ['assembleRelease', '-Pname=some value'])
  assert.match(result[1].at(-1), /Program Files/)
})
test('real process runner keeps argv literal, redacts errors, and propagates failure', async () => {
  const f = await fixture()
  const result = await runProcess({ command: 'node', args: ['-e', 'process.stdout.write(process.argv[1])', 'space & quote " = secret'], cwd: f.root, capture: true })
  assert.equal(result.stdout, 'space & quote " = secret')
  await assert.rejects(runProcess({ command: 'node', args: ['-e', 'process.exit(7)'], cwd: f.root, capture: true, label: 'Fixture' }), e => e instanceof Failure && e.exitCode === 7)
  await assert.rejects(runProcess({ command: 'missing-secret-executable', args: ['do-not-log-me'], cwd: f.root, capture: true }), e => !e.message.includes('do-not-log-me') && !e.message.includes('missing-secret'))
  await assert.rejects(runProcess({ command: 'node', args: ['-e', 'setTimeout(()=>{},10000)'], cwd: f.root, capture: true, timeout: 30 }), /timed out/)
})
test('dry-run neither spawns nor reveals secret argv', async () => {
  const f = await fixture({ version: 1 }, { 'dry-run': true }); await f.ctx.run('node', ['-e', 'super-secret'], { input: 'private-secret' })
  assert.equal(f.calls.length, 0); assert.ok(!f.messages.join('').includes('secret')); assert.equal(existsSync(join(f.root, '.rds')), false)
})

test('nonzero success conventions are opt-in per invocation and never suppress other failures', async () => {
  const f = await fixture()
  const invocation = { command: 'node', args: ['-e', 'process.exit(1)'], cwd: f.root, capture: true, label: 'Fixture process' }
  await assert.rejects(runProcess(invocation), error => error instanceof Failure && error.exitCode === 1)
  assert.deepEqual(await runProcess({ ...invocation, successExitCodes: [0, 1] }), { stdout: '', stderr: '' })
  // The exception must not leak to the next process, or accept a different failure.
  await assert.rejects(runProcess(invocation), error => error instanceof Failure && error.exitCode === 1)
  await assert.rejects(runProcess({ ...invocation, args: ['-e', 'process.exit(7)'], successExitCodes: [0, 1] }), error => error instanceof Failure && error.exitCode === 7)
  await assert.rejects(runProcess({ ...invocation, command: 'missing-private-fixture-tool', successExitCodes: [0, 1] }), /Cannot start Fixture process/)
  await assert.rejects(runProcess({ ...invocation, args: ['-e', 'setTimeout(()=>{},10000)'], timeout: 30, successExitCodes: [0, 1] }), /timed out/)
  await assert.rejects(runProcess({ ...invocation, args: ['-e', 'process.stdout.write("x".repeat(17 * 1024 * 1024))'], successExitCodes: [0, 1] }), /exceeded output limit/)
  const stop = new AbortController(); stop.abort()
  await assert.rejects(runProcess({ ...invocation, args: ['-e', 'setTimeout(()=>{},10000)'], signal: stop.signal, successExitCodes: [0, 1] }))
})

test('process success/visibility options reject invalid values before starting a tool', async () => {
  const f = await fixture()
  const invocation = { command: 'node', args: ['-e', 'require("node:fs").writeFileSync("unexpected-spawn", "bad")'], cwd: f.root, capture: true }
  for (const value of [null, [], [0, -1], [0, 1.5], [Infinity], ['1'], '0', {}]) {
    await assert.rejects(runProcess({ ...invocation, successExitCodes: value }), /Success exit codes/)
  }
  for (const value of [null, 'false', 0, {}]) {
    await assert.rejects(runProcess({ ...invocation, windowsHide: value }), /windowsHide must be a boolean/)
  }
  assert.equal(existsSync(join(f.root, 'unexpected-spawn')), false)
})
