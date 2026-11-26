import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { main, commands } from '../dist/cli.js'
import { fixture } from './helpers.mjs'

async function snapshot(root) {
  const files = []
  async function walk(directory) { for (const entry of await readdir(directory, { withFileTypes: true })) { const path = join(directory, entry.name); if (entry.isDirectory()) await walk(path); else files.push([relative(root, path), createHash('sha256').update(await readFile(path)).digest('hex')]) } }
  await walk(root); return files.sort((a, b) => a[0].localeCompare(b[0]))
}
test('every public command can plan without writes, subprocesses or credential values', async () => {
  const config = {
    version: 1, vue: { typecheck: 'noEmit' },
    capacitor: { platforms: ['android'], assets: { source: 'icon.png' }, locales: { defaultLocale: 'en', locales: { en: { title: 'Example' } }, targets: [{ format: 'android', directory: 'android/app/src/main/res' }] }, localeRegistration: { android: {}, ios: { targets: [{ name: 'App', files: ['InfoPlist.strings'] }] } } },
    appLinks: { directory: 'web/public', apple: [{ teamId: 'ABCDE12345', bundleId: 'app.fixture', paths: ['/open/*'] }] },
    android: { appId: 'app.fixture' },
    store: { root: 'store', locales: ['en-US'], androidId: 'app.fixture', playKey: 'never-read-credentials.json' },
    vscode: {}, electron: { assets: { source: 'icon.png', outputs: [{ path: 'desktop/icon.png', width: 16 }] } }, swift: { executable: 'Example', plist: 'Info.plist', entitlements: 'app.entitlements', icon: 'icon.png' },
    cloudflare: { targets: { worker: { kind: 'worker', config: 'wrangler.toml', d1Database: 'fixture-db', secretsFile: 'never-read-credentials.json', secretNames: ['SESSION_SECRET'] }, pages: { kind: 'pages', directory: 'web', projectName: 'fixture' } } },
    hostinger: { targets: { api: { domain: 'api.example.com', username: 'account_example', directory: 'bundle', envFile: 'never-read.env', databaseVariable: 'DATABASE_URL' } } },
    browser: { directory: 'extension/dist', output: 'extension.zip' },
    dev: { processes: [{ name: 'one', command: ['node', '-e', 'NEVER_EXECUTE_OR_LOG_SECRET'] }, { name: 'two', command: ['node', '-e', ''] }] },
    wait: { targets: { database: { host: '127.0.0.1', port: 9 }, api: { variable: 'URL_NOT_SET', envFile: 'never-read.env', status: 204, marker: { header: 'x-release', value: 'NEVER_EXECUTE_OR_LOG_SECRET' } } } },
    env: { module: 'scripts/environments.mjs' },
    prisma: { envFile: '.env.{env}' },
    platformio: { root: '.' },
    media: { platforms: ['android'], locales: ['en'], capture: { module: 'scripts/never-loaded.mjs', baseUrl: 'http://localhost:5173', scenes: [{ id: 'home', viewport: { width: 400, height: 800 } }] } }
  }
  const f = await fixture(config); await f.file('reusable-dev-scripts.config.json', JSON.stringify(config))
  await f.file('scripts/environments.mjs', "export const defaults = () => ({ greeting: 'hello' })\nexport const outputs = (env, config) => [{ path: 'generated.env', content: `GREETING=${config.greeting}\\n` }]\n")
  await f.file('.gitignored/environments/staging.json5', '{ "greeting": "hello" }'); await f.file('generated.env', 'GREETING=hello\n'); await f.file('.env.staging', 'DATABASE_URL=mysql://user:never-log-this@db.example.test:3306/app\n'); await f.file('package.json', '{"name":"fixture","version":"1.0.0"}'); await f.file('icon.png', await sharp({ create: { width: 32, height: 32, channels: 4, background: '#fff' } }).png().toBuffer()); await f.file('android/app/build.gradle', 'versionCode 1000000\nversionName "1.0.0"')
  const before = await snapshot(f.root)
  for (const command of Object.keys(commands)) {
    const args = [...command.split(' '), '--cwd', f.root, '--dry-run']
    if (command.startsWith('cloudflare')) args.push('--env', 'staging', '--target', command.includes('pages') ? 'pages' : 'worker')
    if (['cloudflare promote', 'cloudflare rollback'].includes(command)) args.push('--version-id', '00000000-0000-4000-8000-000000000001')
    if (command.startsWith('hosting ')) args.push('--env', 'staging', '--pages-target', 'pages')
    if (command.startsWith('hostinger')) args.push('--env', 'staging')
    if (command === 'electron notarize') args.push('--profile', 'fixture-profile', '--preflight')
    if (command.startsWith('env ') || command.startsWith('prisma ')) args.push('--env', 'staging')
    if (command === 'exec') args.push('--', 'node', '-e', 'NEVER_EXECUTE_OR_LOG_SECRET')
    if (command === 'store run') args.push('--', 'lanes')
    if (command === 'android inspect') args.push('--artifact', 'never-built.apk')
    if (command === 'electron check-signing-identity') args.push('--identity', 'Example Company (TEAMID1234)')
    if (command === 'esp32 check-size') args.push('--artifact', 'never-built.bin', '--partitions', 'never-read.csv')
    if (command === 'platformio') args.push('--', 'run', '-e', 'NEVER_EXECUTE_OR_LOG_SECRET')
    if (command.startsWith('wait ')) args.push('--target', command === 'wait http' ? 'api' : 'database')
    const logs = []
    await main(args, () => { throw new Error(`Unexpected process execution for ${command}`) }, line => logs.push(line))
    assert.ok(!logs.join('').includes('NEVER_EXECUTE_OR_LOG_SECRET'))
    assert.ok(!logs.join('').includes('never-log-this'))
  }
  assert.deepEqual(await snapshot(f.root), before)
})
