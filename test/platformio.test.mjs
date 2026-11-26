import test from 'node:test'
import assert from 'node:assert/strict'
import { delimiter, join } from 'node:path'
import { validateConfig } from '../dist/config.js'
import { main } from '../dist/cli.js'
import { platformio, platformioCandidates, resolvePlatformio } from '../dist/platformio.js'
import { fixture } from './helpers.mjs'

const home = join('/', 'user-home'), bin = join('/', 'tools', 'bin'), pioOnPath = join(bin, 'pio')
const installer = join(home, '.platformio', 'penv', 'bin', 'pio'), pipUser = join(home, '.local', 'bin', 'pio')
const host = (platform, files = [], env = {}, listing = {}) => ({ platform, env, home, exists: path => files.includes(path), list: directory => listing[directory] ?? [] })

test('PLATFORMIO_CMD wins and is never silently replaced by another installation', () => {
  assert.equal(resolvePlatformio(host('linux', [installer], { PLATFORMIO_CMD: 'custom-pio' })), 'custom-pio')
  const missing = join('/', 'opt', 'pio', 'missing'), present = join('/', 'opt', 'pio', 'pio')
  assert.equal(resolvePlatformio(host('linux', [installer], { PLATFORMIO_CMD: missing })), undefined)
  assert.equal(resolvePlatformio(host('linux', [present], { PLATFORMIO_CMD: present })), present)
})

test('PlatformIO is found on PATH first, then in the official installer and pip user locations', () => {
  assert.deepEqual(platformioCandidates(host('linux', [pipUser, installer, pioOnPath], { PATH: bin })), [pioOnPath, installer, pipUser])
  assert.equal(resolvePlatformio(host('linux', [], { PATH: bin })), undefined)
})

test('the pio of the PlatformIO home in use comes before PATH, and PLATFORMIO_CMD still wins', () => {
  const core = join('/', 'core-home'), own = join(core, 'penv', 'bin', 'pio')
  assert.deepEqual(platformioCandidates(host('linux', [pioOnPath, own], { PATH: bin }), core), [own, pioOnPath])
  assert.equal(resolvePlatformio(host('linux', [pioOnPath, own], { PATH: bin }), core), own)
  assert.equal(resolvePlatformio(host('linux', [pioOnPath], { PATH: bin }), core), pioOnPath, 'a home without its own pio falls back to PATH')
  assert.equal(resolvePlatformio(host('linux', [own], { PLATFORMIO_CMD: 'custom-pio' }), core), 'custom-pio')
  // The default installer home is listed once even when it is also the home in use.
  assert.deepEqual(platformioCandidates(host('linux', [installer], {}), join(home, '.platformio')), [installer])
})

test('on Windows the newest Python user Scripts directory is used whatever its minor version', () => {
  const local = join('/', 'profile', 'AppData', 'Local'), scripts = version => join(local, 'Python', version, 'Scripts', 'pio.exe')
  const files = [scripts('pythoncore-3.13-64'), scripts('pythoncore-3.14-64')]
  const result = platformioCandidates(host('win32', files, { LOCALAPPDATA: local }, { [join(local, 'Python')]: ['pythoncore-3.13-64', 'pythoncore-3.14-64'] }))
  assert.deepEqual(result, [scripts('pythoncore-3.14-64'), scripts('pythoncore-3.13-64')])
})

test('platformio runs pio in its root with the core directory unless the environment already sets one', async () => {
  const f = await fixture({ version: 1, platformio: { root: 'firmware', coreDir: 'core-cache' } })
  await f.file('firmware/platformio.ini')
  await platformio(f.ctx, ['run', '-e', 'esp32'], host('linux', [pioOnPath], { PATH: bin }))
  assert.equal(f.calls[0].command, pioOnPath); assert.deepEqual(f.calls[0].args, ['run', '-e', 'esp32'])
  assert.equal(f.calls[0].cwd, join(f.root, 'firmware')); assert.equal(f.calls[0].env.PLATFORMIO_CORE_DIR, join(f.root, 'core-cache'))
  const owned = join('/', 'elsewhere')
  await platformio(f.ctx, ['--version'], host('linux', [pioOnPath], { PATH: bin, PLATFORMIO_CORE_DIR: owned }))
  assert.equal(f.calls[1].env.PLATFORMIO_CORE_DIR, process.env.PLATFORMIO_CORE_DIR)
})

test('platformio runs the pio of the configured or inherited core directory', async () => {
  const f = await fixture({ version: 1, platformio: { root: 'firmware', coreDir: 'core-cache' } })
  await f.file('firmware/platformio.ini')
  const own = join(f.root, 'core-cache', 'penv', 'bin', 'pio')
  await platformio(f.ctx, ['--version'], host('linux', [pioOnPath, own], { PATH: bin }))
  assert.equal(f.calls[0].command, own)
  const inherited = join('/', 'inherited-core'), inheritedPio = join(inherited, 'penv', 'bin', 'pio')
  await platformio(f.ctx, ['--version'], host('linux', [pioOnPath, own, inheritedPio], { PATH: bin, PLATFORMIO_CORE_DIR: inherited }))
  assert.equal(f.calls[1].command, inheritedPio, 'an inherited PLATFORMIO_CORE_DIR is the home in use')
})

test('a missing installation or missing arguments fail clearly, and a plan does not need PlatformIO', async () => {
  const f = await fixture({ version: 1 })
  await assert.rejects(platformio(f.ctx, ['run'], host('linux')), /PlatformIO CLI was not found/)
  await assert.rejects(platformio(f.ctx, [], host('linux')), /Use rds platformio/)
  const plan = await fixture({ version: 1 }, { 'dry-run': true })
  await platformio(plan.ctx, ['run'], host('linux'))
  assert.equal(plan.ctx.plan[0].command, 'pio')
})

test('rds platformio takes its arguments after -- and writes its own step line to stderr by default', async () => {
  const f = await fixture({ version: 1 })
  await f.file('reusable-dev-scripts.config.json', '{"version":1}')
  await assert.rejects(main(['platformio', 'run', '--cwd', f.root, '--dry-run'], undefined, () => {}), /Unknown command/)
  const kept = []
  await main(['platformio', '--cwd', f.root, '--dry-run', '--', 'run'], undefined, line => kept.push(line))
  assert.deepEqual(kept, ['[plan] PlatformIO'], 'a caller-supplied logger keeps the step line')
  const written = [], original = console.error
  console.error = message => written.push(message)
  try { await main(['platformio', '--cwd', f.root, '--dry-run', '--', 'run']) } finally { console.error = original }
  assert.deepEqual(written, ['[plan] PlatformIO'])
})

test('platformio configuration is validated', () => {
  assert.doesNotThrow(() => validateConfig({ version: 1, platformio: { root: 'firmware', coreDir: join('/', 'cache') } }))
  assert.throws(() => validateConfig({ version: 1, platformio: { coreDir: '' } }), /non-empty path/)
  assert.throws(() => validateConfig({ version: 1, platformio: { envs: [] } }), /Unknown platformio field/)
})
