import test from 'node:test'
import assert from 'node:assert/strict'
import { parseEnv } from 'node:util'
import { cloudflare } from '../dist/cloudflare.js'
import { validateConfig } from '../dist/config.js'
import { parseSecretEnv } from '../dist/secret-env.js'
import { fixture } from './helpers.mjs'

test('the strict parser accepts plain, quoted, multi-line and escaped values', () => {
  const values = parseSecretEnv(['# comment', '', 'PLAIN=abc=def', 'SPACED=  padded value  ', "JSON='{\"d\":\"x\"}'", 'PEM="-----BEGIN-----\\nabc\\n-----END-----"', 'MULTI="line1', 'line2"', 'EMPTY=', 'QUOTED_EMPTY=""'].join('\r\n'))
  assert.deepEqual(values, { PLAIN: 'abc=def', SPACED: 'padded value', JSON: '{"d":"x"}', PEM: '-----BEGIN-----\nabc\n-----END-----', MULTI: 'line1\nline2', EMPTY: '', QUOTED_EMPTY: '' })
})

test('the strict parser fails closed on anything it would otherwise have to guess', () => {
  assert.throws(() => parseSecretEnv('A=1\nA=2'), /Duplicate secret: A/)
  assert.throws(() => parseSecretEnv('not a line'), /Malformed secrets file at line 1/)
  assert.throws(() => parseSecretEnv('A=1\nexport B=2'), /Malformed secrets file at line 2/)
  assert.throws(() => parseSecretEnv('lower=1'), /Malformed/)
  assert.throws(() => parseSecretEnv('A="never closed\nstill open'), /Unterminated quoted secret: A/)
  assert.throws(() => parseSecretEnv('A="'), /Unterminated quoted secret: A/)
})

test('error messages never contain a secret value', () => {
  for (const text of ['A=hunter2-never-shown\nA=hunter2-never-shown', 'hunter2-never-shown', 'A="hunter2-never-shown']) {
    assert.throws(() => parseSecretEnv(text), error => !String(error.message).includes('hunter2'))
  }
})

test('comments end an unquoted value exactly like Node\'s dotenv parser and never reach a quoted one', () => {
  for (const line of ['A=x#y', 'A=x #y', 'A=#y', 'A= ', 'A="x" #c', "A='x'#c", 'A="a # b"', 'A=  spaced  value  ', 'A=a=b', 'A=`b`']) {
    assert.deepEqual(parseSecretEnv(line), parseEnv(line), line)
  }
})

const target = (extra = {}) => ({ version: 1, cloudflare: { targets: { api: { kind: 'worker', config: 'wrangler.toml', secretsFile: 'secrets.env', secretNames: ['SESSION_SECRET', 'DERIVED'], prepare: [['node', 'prepare.mjs']], ...extra } } } })

test('push-secrets rejects duplicate or malformed lines before anything runs', async () => {
  const f = await fixture(target(), { env: 'staging' })
  await f.file('secrets.env', 'SESSION_SECRET=a\nSESSION_SECRET=b\nDERIVED=c')
  await assert.rejects(cloudflare(f.ctx, 'push-secrets'), /Duplicate secret: SESSION_SECRET/)
  await f.file('secrets.env', 'SESSION_SECRET=a\nDERIVED c')
  await assert.rejects(cloudflare(f.ctx, 'push-secrets'), /Malformed/)
  assert.equal(f.calls.length, 0)
})

test('the secrets module can derive values, sees a frozen copy, and only allowlisted names are uploaded', async () => {
  const f = await fixture(target({ secretsModule: 'rules.mjs' }), { env: 'staging' })
  await f.file('secrets.env', 'SESSION_SECRET=from-file\nEXTRA=not-allowlisted')
  await f.file('rules.mjs', `export function secrets({ environment, target, file, values, root }) {
    if (Object.isFrozen(values) !== true) throw new Error('values must be frozen')
    if (environment !== 'staging' || target !== 'api' || !file.endsWith('secrets.env') || !root) throw new Error('unexpected input')
    return { ...values, DERIVED: 'derived-' + values.SESSION_SECRET, UNLISTED: 'also-ignored' }
  }`)
  await cloudflare(f.ctx, 'push-secrets')
  assert.deepEqual(f.calls.map(call => call.command), ['node', 'wrangler'])
  assert.deepEqual(JSON.parse(f.calls[1].input), { SESSION_SECRET: 'from-file', DERIVED: 'derived-from-file' })
  assert.ok(!f.messages.join('').includes('from-file'))
})

test('a failing secrets module stops the upload before the prepare hooks and wrangler', async () => {
  const f = await fixture(target({ secretsModule: 'rules.mjs' }), { env: 'staging' })
  await f.file('secrets.env', 'SESSION_SECRET=a\nDERIVED=b')
  await f.file('rules.mjs', "export const secrets = () => { throw new Error('project rule violated') }")
  await assert.rejects(cloudflare(f.ctx, 'push-secrets'), /project rule violated/)
  // Modules are cached per path within one process, so each variant uses its own file.
  for (const [name, body, message] of [['returns-number.mjs', 'export const secrets = () => 42', /must return an object/], ['no-function.mjs', 'export const other = 1', /must export a secrets/]]) {
    const again = await fixture(target({ secretsModule: name }), { env: 'staging' })
    await again.file(name, body); await again.file('secrets.env', ['SESSION_SECRET=a', 'DERIVED=b'].join('\n'))
    await assert.rejects(cloudflare(again.ctx, 'push-secrets'), message)
    assert.equal(again.calls.length, 0)
  }
  assert.equal(f.calls.length, 0)
})

test('a missing or empty allowlisted secret names the variable, never a value', async () => {
  const f = await fixture(target(), { env: 'staging' })
  await f.file('secrets.env', 'SESSION_SECRET=a\nDERIVED=')
  await assert.rejects(cloudflare(f.ctx, 'push-secrets'), /missing or empty: DERIVED/)
})

test('the production guard runs before the secrets file is read', async () => {
  const f = await fixture({ version: 1, production: { environments: ['production'] }, cloudflare: { targets: { api: { kind: 'worker', config: 'wrangler.toml', secretsFile: 'never-created.env', secretNames: ['SESSION_SECRET'] } } } }, { env: 'production' })
  await assert.rejects(cloudflare(f.ctx, 'push-secrets'), /--allow-production/)
})

test('--secrets-file selects another file but only inside the project, and the module sees it', async () => {
  const f = await fixture(target({ secretsModule: 'rules.mjs' }), { env: 'staging', 'secrets-file': 'reviewed/other.env' })
  await f.file('reviewed/other.env', 'SESSION_SECRET=a\nDERIVED=b')
  await f.file('rules.mjs', "export const secrets = ({ file, values }) => { if (!file.endsWith('other.env')) throw new Error('wrong file'); return values }")
  await cloudflare(f.ctx, 'push-secrets')
  assert.deepEqual(JSON.parse(f.calls.at(-1).input), { SESSION_SECRET: 'a', DERIVED: 'b' })
  const outside = await fixture(target(), { env: 'staging', 'secrets-file': '../outside.env' })
  await assert.rejects(cloudflare(outside.ctx, 'push-secrets'), /inside its project/)
})

test('a dry-run never reads the secrets file or loads the module', async () => {
  const f = await fixture(target({ secretsModule: 'missing-rules.mjs' }), { env: 'staging', 'dry-run': true })
  await cloudflare(f.ctx, 'push-secrets')
  assert.deepEqual(f.ctx.plan.map(step => step.command), ['node', 'wrangler'])
  assert.equal(f.ctx.plan[1].input, JSON.stringify({}))
})

test('secretsModule is validated as a config field', () => {
  assert.doesNotThrow(() => validateConfig(target({ secretsModule: 'rules.mjs' })))
  assert.throws(() => validateConfig(target({ secretsModule: '' })), /non-empty string/)
})
