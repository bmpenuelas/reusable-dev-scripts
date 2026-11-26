import test from 'node:test'
import assert from 'node:assert/strict'
import { cloudflare } from '../dist/cloudflare.js'
import { fixture } from './helpers.mjs'

const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const account = 'a'.repeat(32), otherAccount = 'b'.repeat(32)
const activeId = uuid(1), oldId = uuid(2), newId = uuid(3), currentDeploy = uuid(4), nextDeploy = uuid(5), database = uuid(6)
const apiRoot = `https://api.cloudflare.com/client/v4/accounts/${account}`
const worker = `${apiRoot}/workers/scripts/fixture-preview`
const deployment = (id, ...pairs) => ({ id, versions: pairs.map(([version_id, percentage]) => ({ version_id, percentage })), author_email: 'PRIVATE_AUTHOR', annotations: { 'workers/message': 'PRIVATE_MESSAGE' } })
const current = deployment(currentDeploy, [activeId, 90], [oldId, 10])
const body = result => Response.json({ success: true, result })
const history = (...deployments) => body({ deployments })
const noNetwork = () => assert.fail('Unexpected network call')

async function workerFixture(flags = {}, binding = { binding: 'DB', database_name: 'stage-db', database_id: database }) {
  const config = {
    version: 1, production: { environments: ['live'], verify: [['verify-fixture']] },
    cloudflare: { credentialsFile: 'provider.env', targets: { worker: { kind: 'worker', root: 'worker', config: 'wrangler.jsonc', prepare: [['wrong-hook']], accountId: otherAccount, environments: {
      staging: { wranglerEnv: 'preview', d1Database: 'stage-db' },
      live: { wranglerEnv: 'preview', d1Database: 'stage-db' },
    } } } },
  }
  const f = await fixture(config, { env: 'staging', ...flags })
  await f.file('provider.env', 'CLOUDFLARE_API_TOKEN=FIXTURE_TOKEN')
  const path = await f.file('worker/wrangler.jsonc', '{}')
  await f.file('node_modules/wrangler/package.json', '{"name":"wrangler","main":"index.cjs"}')
  await f.file('node_modules/wrangler/index.cjs', `
    exports.unstable_readConfig = (args, options) => {
      if (args.config !== ${JSON.stringify(path)} || args.env !== 'preview' || options.hideWarnings !== true) throw Error('wrong fixture config')
      return { configPath: args.config, account_id: '${account}', name: 'fixture-preview', d1_databases: ${JSON.stringify([binding])} }
    }
  `)
  return f
}

test('Worker status resolves the effective config and prints only the active deployment and split', async () => {
  const f = await workerFixture({ env: 'live' })
  await cloudflare(f.ctx, 'status', async (url, init) => {
    assert.equal(url, `${worker}/deployments`)
    assert.equal(init.method, 'GET')
    return history(current, deployment(uuid(8), [oldId, 100]))
  })
  assert.equal(f.calls.length, 0)
  assert.match(f.messages.join('\n'), new RegExp(`${currentDeploy}: ${activeId} at 90%, ${oldId} at 10%`))
  assert.doesNotMatch(f.messages.join('\n'), /PRIVATE_|FIXTURE_TOKEN/)
})

test('Worker promotion guards before any requests, writes once without force, and checks exact read-back', async () => {
  const request = { env: 'live', 'version-id': newId, yes: true }
  const denied = await workerFixture(request)
  await assert.rejects(cloudflare(denied.ctx, 'promote', noNetwork), /--allow-production/)
  assert.equal(denied.calls.length, 0)
  const f = await workerFixture({ ...request, 'allow-production': true })
  const seen = []
  await cloudflare(f.ctx, 'promote', async (url, init) => {
    assert.deepEqual(f.calls.map(call => call.command), ['verify-fixture'])
    seen.push([init.method, url])
    if (url === `${worker}/versions/${newId}`) return body({ id: newId, resources: { private: 'NEVER_SHOW' } })
    assert.equal(url, `${worker}/deployments`)
    const updated = deployment(nextDeploy, [newId, 100])
    if (init.method === 'GET') return seen.length < 5 ? history(current) : history(updated)
    assert.deepEqual(JSON.parse(init.body), { strategy: 'percentage', versions: [{ version_id: newId, percentage: 100 }], annotations: { 'workers/message': 'RDS promotion' } })
    return body(updated)
  })
  assert.deepEqual(seen.map(([method]) => method), ['GET', 'GET', 'POST', 'GET', 'GET'])
  assert.match(f.messages.at(-1), /100% \(application health not checked\)/)
  assert.doesNotMatch(f.messages.join('\n'), /NEVER_SHOW|PRIVATE_/)
})

test('Worker rollback requires previous traffic and refuses repeat writes on uncertain state', async () => {
  const f = await workerFixture({ 'version-id': newId, yes: true })
  await assert.rejects(cloudflare(f.ctx, 'rollback', async (_, init) => {
    assert.equal(init.method, 'GET')
    return history(current)
  }), /served traffic/)
  f.ctx.flags['version-id'] = oldId
  let writes = 0
  await assert.rejects(cloudflare(f.ctx, 'rollback', async (url, init) => {
    assert.equal(url, `${worker}/deployments`)
    if (init.method === 'GET') return history(current)
    writes++
    assert.equal(JSON.parse(init.body).versions[0].version_id, oldId)
    return body(deployment(nextDeploy, [oldId, 100]))
  }), /run cloudflare status/)
  assert.equal(writes, 1)
  let reads = 0
  await cloudflare(f.ctx, 'rollback', async (_, init) => {
    assert.equal(init.method, 'GET')
    reads++
    return history(deployment(nextDeploy, [oldId, 100]))
  })
  assert.equal(reads, 1)
})

test('release mutations validate confirmations before provider calls or config reads', async () => {
  const f = await workerFixture({ 'version-id': newId })
  await assert.rejects(cloudflare(f.ctx, 'promote', noNetwork), /--yes/)
  f.ctx.flags['version-id'] = '../other'
  await assert.rejects(cloudflare(f.ctx, 'promote', noNetwork), /version UUID/)
  const neutral = await fixture({ version: 1, cloudflare: { targets: { worker: { kind: 'worker', config: 'missing.toml' } } } }, { 'dry-run': true, 'version-id': newId })
  await assert.rejects(cloudflare(neutral.ctx, 'promote', noNetwork), /need an explicit --env/)
  neutral.ctx.flags.env = 'staging'
  await cloudflare(neutral.ctx, 'promote', noNetwork)
})

const productionPage = uuid(15), oldPage = uuid(16), previewPage = uuid(17), projectPath = `${apiRoot}/pages/projects/fixture-web`
const page = (id, branch, environment, stage = 'success', date = '2026-01-20T12:00:00Z') => ({
  id, project_name: 'fixture-web', deployment_trigger: { metadata: { branch, commit_message: 'PRIVATE_MESSAGE' } },
  environment, latest_stage: { name: 'deploy', status: stage }, created_on: date, env_vars: { PRIVATE_VALUE: 'private' },
})
const mainPage = page(productionPage, 'main', 'production')
const project = canonical => body({ name: 'fixture-web', production_branch: 'main', canonical_deployment: canonical, latest_deployment: page(previewPage, 'feature/one', 'preview') })
async function pagesFixture(flags) {
  const f = await fixture({ version: 1, cloudflare: { credentialsFile: 'provider.env', targets: {
    web: { kind: 'pages', projectName: 'fixture-web', accountId: account, environments: { staging: { branch: 'feature/one' } } },
  } } }, flags)
  await f.file('provider.env', 'CLOUDFLARE_API_TOKEN=FIXTURE_TOKEN')
  return f
}

test('Pages production reports the canonical deployment; preview finds the exact branch across pages', async () => {
  const prod = await pagesFixture({ env: 'production' })
  await cloudflare(prod.ctx, 'status', async (url, init) => {
    assert.equal(url, projectPath)
    assert.equal(init.method, 'GET')
    return project(mainPage)
  })
  assert.match(prod.messages.join('\n'), new RegExp(`active production deployment ${productionPage}`))
  const preview = await pagesFixture({ env: 'staging' })
  await cloudflare(preview.ctx, 'status', async (url, init) => {
    assert.equal(init.method, 'GET')
    if (url === projectPath) return project(mainPage)
    assert.ok(url.startsWith(`${projectPath}/deployments?env=preview&`))
    const first = new URL(url).searchParams.get('page') === '1'
    const result = first ? [page(uuid(35), 'feature-one', 'preview'), page(uuid(36), 'feature/one', 'preview', 'failure')] : [page(previewPage, 'feature/one', 'preview')]
    return Response.json({ success: true, result, result_info: { total_pages: 2 } })
  })
  assert.match(preview.messages.join('\n'), new RegExp(`latest successful preview deployment ${previewPage}`))
  assert.doesNotMatch([...prod.messages, ...preview.messages].join('\n'), /PRIVATE_/)
})

test('Pages rollback refuses preview or foreign deployments and only verifies via canonical state', async () => {
  const preview = await pagesFixture({ env: 'staging', 'deployment-id': oldPage, yes: true })
  await assert.rejects(cloudflare(preview.ctx, 'rollback', async (url, init) => {
    assert.equal(url, projectPath)
    assert.equal(init.method, 'GET')
    return project(mainPage)
  }), /not this project’s production branch/)
  const f = await pagesFixture({ env: 'production', 'deployment-id': oldPage, yes: true, 'allow-production': true })
  await assert.rejects(cloudflare(f.ctx, 'rollback', async (url, init) => {
    assert.equal(init.method, 'GET')
    return url === projectPath ? project(mainPage) : body({ ...page(oldPage, 'main', 'production'), project_name: 'another-project' })
  }), /successful production deployment/)
  let rolled = false
  await cloudflare(f.ctx, 'rollback', async (url, init) => {
    const selected = page(oldPage, 'main', 'production')
    if (url === projectPath) return project(rolled ? selected : mainPage)
    if (init.method === 'GET') {
      assert.equal(url, `${projectPath}/deployments/${oldPage}`)
      return body(selected)
    }
    assert.equal(url, `${projectPath}/deployments/${oldPage}/rollback`)
    assert.equal(init.method, 'POST')
    assert.equal(rolled, false)
    rolled = true
    return body(selected)
  })
  assert.equal(rolled, true)
  assert.match(f.messages.at(-1), new RegExp(`at deployment ${oldPage}`))
})

test('D1 status matches configured nested migration files and sends only SELECT queries', async () => {
  const binding = { binding: 'DB', database_name: 'stage-db', database_id: database, migrations_dir: 'db', migrations_pattern: 'db/*/migration.sql', migrations_table: 'version_history' }
  const f = await workerFixture({ env: 'live' }, binding)
  await f.file('worker/db/0001_init/migration.sql', 'SQL BODY MUST NOT BE SENT')
  await f.file('worker/db/0002_next/migration.sql', 'SQL BODY MUST NOT BE SENT')
  await f.file('worker/db/ignore.sql', 'SQL BODY MUST NOT BE SENT')
  const sent = []
  await cloudflare(f.ctx, 'd1-status', async (url, init) => {
    assert.equal(url, `${apiRoot}/d1/database/${database}/query`)
    assert.equal(init.method, 'POST')
    const query = JSON.parse(init.body)
    sent.push(query)
    return body([{ success: true, results: [{ name: sent.length === 1 ? 'version_history' : '0001_init/migration.sql' }] }])
  })
  assert.deepEqual(sent, [{ sql: "SELECT name FROM sqlite_schema WHERE type = 'table' AND name = ? COLLATE NOCASE", params: ['version_history'] }, { sql: 'SELECT name FROM "version_history"' }])
  assert.deepEqual(f.calls, [])
  assert.match(f.messages.join('\n'), /1 pending migration\(s\)[\s\S]*0002_next\/migration\.sql/)
  assert.doesNotMatch(f.messages.join('\n'), /0001_init|ignore\.sql/)
})

test('D1 status does not create a missing table and refuses an implicit remote database', async () => {
  const notExplicit = await workerFixture({}, { binding: 'DB', database_name: 'stage-db' })
  await assert.rejects(cloudflare(notExplicit.ctx, 'd1-status', noNetwork), /explicit remote database_id/)
  const f = await workerFixture()
  await f.file('worker/migrations/001_init.sql')
  let calls = 0
  await cloudflare(f.ctx, 'd1-status', async (_, init) => {
    calls++
    assert.match(JSON.parse(init.body).sql, /^SELECT /)
    return body([{ success: true, results: [] }])
  })
  assert.equal(calls, 1)
  assert.match(f.messages.join('\n'), /1 pending migration\(s\) \(migration table not yet created\)/)
})
