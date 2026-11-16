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
    capacitor: { platforms: ['android'], assets: { source: 'icon.png' }, locales: { defaultLocale: 'en', locales: { en: { title: 'Example' } }, targets: [{ format: 'android', directory: 'android/app/src/main/res' }] } },
    android: { appId: 'app.fixture' },
    store: { root: 'store', locales: ['en-US'], androidId: 'app.fixture', playKey: 'never-read-credentials.json' },
    vscode: {}, electron: { assets: { source: 'icon.png', outputs: [{ path: 'desktop/icon.png', width: 16 }] } }, swift: { executable: 'Example', plist: 'Info.plist', entitlements: 'app.entitlements', icon: 'icon.png' },
    cloudflare: { targets: { worker: { kind: 'worker', config: 'wrangler.toml', secretsFile: 'never-read-credentials.json', secretNames: ['SESSION_SECRET'] }, pages: { kind: 'pages', directory: 'web', projectName: 'fixture' } } },
    browser: { directory: 'extension/dist', output: 'extension.zip' }
  }
  const f = await fixture(config); await f.file('reusable-dev-scripts.config.json', JSON.stringify(config)); await f.file('package.json', '{"name":"fixture","version":"1.0.0"}'); await f.file('icon.png', await sharp({ create: { width: 32, height: 32, channels: 4, background: '#fff' } }).png().toBuffer()); await f.file('android/app/build.gradle', 'versionCode 1000000\nversionName "1.0.0"')
  const before = await snapshot(f.root)
  for (const command of Object.keys(commands)) {
    const args = [...command.split(' '), '--cwd', f.root, '--dry-run']
    if (command.startsWith('cloudflare')) args.push('--env', 'staging', '--target', command.includes('pages') ? 'pages' : 'worker')
    if (command === 'electron notarize') args.push('--profile', 'fixture-profile', '--preflight')
    if (command === 'exec') args.push('--', 'node', '-e', 'NEVER_EXECUTE_OR_LOG_SECRET')
    if (command === 'store run') args.push('--', 'lanes')
    const logs = []
    await main(args, () => { throw new Error(`Unexpected process execution for ${command}`) }, line => logs.push(line))
    assert.ok(!logs.join('').includes('NEVER_EXECUTE_OR_LOG_SECRET'))
  }
  assert.deepEqual(await snapshot(f.root), before)
})
