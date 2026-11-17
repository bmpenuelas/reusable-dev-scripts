import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { main } from '../dist/cli.js'
import { validateConfig } from '../dist/config.js'
import { mergeDefaults, parseJson5, randomSecret } from '../dist/env.js'
import { resolveExecutable, Failure } from '../dist/runtime.js'
import { fixture } from './helpers.mjs'

async function project(config) {
  const f = await fixture(config)
  await f.file('reusable-dev-scripts.config.json', JSON.stringify(config))
  const run = (args, runner) => { const logs = []; return main([...args, '--cwd', f.root], runner, line => logs.push(line)).then(() => logs) }
  return { ...f, run, logs: [] }
}
const environments = `export const defaults = env => ({ api: { url: env === 'development' ? 'http://localhost:3000' : null, secret: 'generated-once' }, list: [] })
export const validate = (env, config) => (env === 'production' && config.api.url?.startsWith('http:') ? ['api.url must use https'] : [])
export const outputs = (env, config) => [{ path: 'out/' + env + '.env', content: 'API_URL=' + config.api.url + '\\n' }]
`

test('json helpers keep existing values and read commented files', () => {
  assert.deepEqual(parseJson5('{\n // note\n "a": "x // not a comment", /* block */ "b": [1, 2,],\n}'), { a: 'x // not a comment', b: [1, 2] })
  assert.deepEqual(mergeDefaults({ a: 1, n: { k: 'mine' } }, { a: 2, b: 3, n: { k: 'default', z: null }, skip: undefined }), { a: 1, b: 3, n: { k: 'mine', z: null } })
  assert.notEqual(randomSecret(), randomSecret())
})

test('env lifecycle creates, validates, generates and detects stale files', async () => {
  const p = await project({ version: 1, env: { module: 'scripts/environments.mjs' } })
  await p.file('scripts/environments.mjs', environments)
  await assert.rejects(p.run(['env', 'validate']), /explicit --env/)
  await assert.rejects(p.run(['env', 'validate', '--env', 'staging']), /Missing .*staging\.json5/)
  // Only configured environments may be auto-created; development is by default.
  await p.run(['env', 'generate', '--env', 'development'])
  assert.equal(await readFile(join(p.root, 'out/development.env'), 'utf8'), 'API_URL=http://localhost:3000\n')
  assert.match(await readFile(join(p.root, '.gitignored/environments/development.json5'), 'utf8'), /^\/\/ development environment configuration\. NEVER commit this file\./u)
  await p.run(['env', 'check', '--env', 'development'])
  await writeFile(join(p.root, 'out/development.env'), 'stale\n')
  await assert.rejects(p.run(['env', 'check', '--env', 'development']), /missing or stale: out[\\/]development\.env.*rds env generate --env development/s)
  // A template for a remote environment lists what a human still has to fill in.
  await p.run(['env', 'template', '--env', 'staging'])
  await assert.rejects(p.run(['env', 'validate', '--env', 'staging']), /api\.url is required/)
  const file = join(p.root, '.gitignored/environments/staging.json5')
  await writeFile(file, (await readFile(file, 'utf8')).replace('"url": null', '"url": "https://api.example.test"'))
  await p.run(['env', 'validate', '--env', 'staging'])
  await assert.rejects(p.run(['env', 'validate', '--env', 'production']), /Missing/)
  await assert.rejects(p.run(['env', 'generate', '--env', 'qa']), /--env must be one of/)
})

test('env dry-run writes nothing and the template keeps a generated secret stable', async () => {
  const p = await project({ version: 1, env: { module: 'scripts/environments.mjs', hints: { generate: 'pnpm {env}:generate' } } })
  await p.file('scripts/environments.mjs', environments)
  const logs = await p.run(['env', 'generate', '--env', 'development', '--dry-run'])
  assert.ok(logs.some(line => line.startsWith('[plan] Create')))
  await assert.rejects(readFile(join(p.root, '.gitignored/environments/development.json5')), /ENOENT/)
  await p.run(['env', 'template', '--env', 'development'])
  const first = await readFile(join(p.root, '.gitignored/environments/development.json5'), 'utf8')
  assert.match(first, /pnpm development:generate/)
  await p.run(['env', 'template', '--env', 'development'])
  assert.equal(await readFile(join(p.root, '.gitignored/environments/development.json5'), 'utf8'), first)
})

test('env module contract is validated', async () => {
  const p = await project({ version: 1, env: { module: 'scripts/environments.mjs' } })
  await p.file('scripts/environments.mjs', 'export const other = 1\n')
  await assert.rejects(p.run(['env', 'template', '--env', 'development']), /defaults/)
  assert.throws(() => validateConfig({ version: 1, env: {} }), /env\.module/)
  assert.throws(() => validateConfig({ version: 1, env: { module: 'm.mjs', environments: ['bad name'] } }), /environment names/)
})

test('wait tcp resolves host and port from several sources and fails with the hint', async () => {
  const server = createServer(socket => socket.destroy()); await new Promise(done => server.listen(0, '127.0.0.1', done))
  const { port } = server.address()
  const p = await project({ version: 1, wait: { targets: { direct: { host: '127.0.0.1', port }, fromFile: { variable: 'RDS_TEST_URL', envFile: '.env', timeout: 1 }, closed: { host: '127.0.0.1', port: 1, timeout: 1, hint: 'Start it first.' } } } })
  try {
    assert.ok((await p.run(['wait', 'tcp', '--target', 'direct'])).some(line => line.includes(`127.0.0.1:${port} is reachable`)))
    await p.file('.env', `RDS_TEST_URL=mysql://user:never-print-this@127.0.0.1:${port}/db\n`)
    const logs = (await p.run(['wait', 'tcp', '--target', 'fromFile'])).join('\n')
    assert.match(logs, /is reachable/); assert.ok(!logs.includes('never-print-this'))
    await assert.rejects(p.run(['wait', 'tcp', '--target', 'closed']), /127\.0\.0\.1:1 is not reachable\. Start it first\./)
    await assert.rejects(p.run(['wait', 'tcp']), /Select a configured wait target/)
    await assert.rejects(p.run(['wait', 'tcp', '--target', 'direct', '--timeout', '0']), /positive/)
  } finally { server.close() }
  const q = await project({ version: 1, wait: { targets: { only: { variable: 'RDS_TEST_UNSET_VARIABLE', timeout: 1 } } } })
  await assert.rejects(q.run(['wait', 'tcp']), /RDS_TEST_UNSET_VARIABLE is not set/)
  assert.throws(() => validateConfig({ version: 1, wait: { targets: { bad: {} } } }), /needs host and port/)
})

test('dev start runs every process with a prefix and stops the rest when one ends', async () => {
  const p = await project({ version: 1, dev: { processes: [{ name: 'api', command: ['node', '-e', ''], environment: { MODE: '{env}' } }, { name: 'web', command: ['node', '-e', ''], root: 'sub' }] } })
  await p.file('sub/.keep')
  const calls = []
  await p.run(['dev', 'start', '--env', 'staging'], async call => { calls.push(call); return { stdout: '', stderr: '' } })
  assert.deepEqual(calls.map(call => call.label), ['Dev process api', 'Dev process web'])
  assert.match(calls[0].prefix, /\[api\]/); assert.equal(calls[0].env.MODE, 'staging'); assert.equal(calls[0].env.FORCE_COLOR, '1')
  assert.ok(calls[1].cwd.endsWith('sub')); assert.ok(calls.every(call => call.signal instanceof AbortSignal))
  assert.ok(!calls[0].prefix.includes('undefined'))
  assert.throws(() => validateConfig({ version: 1, dev: { processes: [] } }), /non-empty/)
  assert.throws(() => validateConfig({ version: 1, dev: { processes: [{ name: 'a', command: ['x'] }, { name: 'a', command: ['x'] }] } }), /unique/)
  assert.throws(() => validateConfig({ version: 1, dev: { processes: [{ name: 'a', command: 'node server.js' }] } }), /argv/)
})

test('dev start reports the first process result and terminates the others for real', async () => {
  const sleeper = ['node', '-e', 'setInterval(() => {}, 1000)']
  const quick = await project({ version: 1, dev: { processes: [{ name: 'sleeper', command: sleeper }, { name: 'done', command: ['node', '-e', 'console.log("ready")'] }] } })
  await quick.run(['dev', 'start'])
  const failing = await project({ version: 1, dev: { processes: [{ name: 'sleeper', command: sleeper }, { name: 'broken', command: ['node', '-e', 'process.exit(3)'] }] } })
  await assert.rejects(failing.run(['dev', 'start']), error => error instanceof Failure && error.exitCode === 3)
})

test('prisma migrate reads the URL from the generated file and guards protected databases', async () => {
  const p = await project({ version: 1, prisma: { root: 'api', envFile: 'api/.env.{env}' } })
  await p.file('api/.env.staging', 'DATABASE_URL=mysql://user:never-print-this@db.example.test:3306/app\n')
  await p.file('api/.env.production', 'DATABASE_URL=mysql://user:never-print-this@prod.example.test:3306/app\n')
  const calls = [], runner = async call => { calls.push(call); return { stdout: '', stderr: '' } }
  const logs = (await p.run(['prisma', 'status', '--env', 'staging'], runner)).join('\n')
  assert.deepEqual([calls[0].command, calls[0].args, calls[0].env.DATABASE_URL.includes('never-print-this')], ['prisma', ['migrate', 'status'], true])
  assert.ok(calls[0].cwd.endsWith('api')); assert.ok(!logs.includes('never-print-this')); assert.match(logs, /host db\.example\.test/)
  await p.run(['prisma', 'migrate', '--env', 'staging'], runner)
  assert.deepEqual(calls[1].args, ['migrate', 'deploy'])
  const before = calls.length
  await assert.rejects(p.run(['prisma', 'migrate', '--env', 'production'], runner), /--allow-production/)
  await assert.rejects(p.run(['prisma', 'migrate', '--env', 'production', '--allow-production', '--confirm-host', 'staging.example.test'], runner), /does not match/)
  assert.equal(calls.length, before)
  await p.run(['prisma', 'migrate', '--env', 'production', '--allow-production', '--confirm-host', 'prod.example.test'], runner)
  assert.deepEqual(calls.at(-1).args, ['migrate', 'deploy'])
  await assert.rejects(p.run(['prisma', 'status', '--env', 'development'], runner), /Missing/)
  await assert.rejects(p.run(['prisma', 'status'], runner), /explicit --env/)
})

test('rds and pnpm resolve to the running Node without a shell', async () => {
  const [rdsCommand, rdsArgs] = resolveExecutable('rds', ['env', 'check'], process.cwd())
  assert.equal(rdsCommand, process.execPath); assert.match(rdsArgs[0], /bin[\\/]rds\.mjs$/u); assert.deepEqual(rdsArgs.slice(1), ['env', 'check'])
  const f = await fixture(); const script = await f.file('pnpm.cjs', '')
  assert.deepEqual(resolveExecutable('pnpm', ['install'], f.root, { npm_execpath: script }), [process.execPath, [script, 'install']])
  // An unrelated npm_execpath (for example when started through npm) is never mistaken for pnpm.
  assert.notEqual(resolveExecutable('pnpm', ['install'], f.root, { npm_execpath: join(f.root, 'npm-cli.js') })[0], process.execPath)
})
