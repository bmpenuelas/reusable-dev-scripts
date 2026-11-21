import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { validateConfig } from '../dist/config.js'
import { versions } from '../dist/versions.js'
import { devTabs, selectedProcesses } from '../dist/dev.js'
import { gitBashPath, tabLaunches, unixTabCommand } from '../dist/tabs.js'
import { runProcess } from '../dist/runtime.js'
import { fixture } from './helpers.mjs'

const tab = (overrides = {}) => ({ title: 'api', cwd: '/work/app', command: ['npm', 'run', 'dev'], environment: {}, ...overrides })
const host = (platform, available = [], files = [], env = {}) => ({ platform, env, exists: path => files.includes(path), onPath: command => available.includes(command) })

test('extra Android modules receive the shared version with their own version code offset', async () => {
  const f = await fixture({ version: 1, capacitor: { root: 'frontend', platforms: ['android'], androidModules: [{ project: 'android/wear/build.gradle', versionCodeOffset: 1_000_000_000 }] } }, { platform: 'android' })
  await f.file('frontend/package.json', '{"name":"app","version":"1.2.3"}')
  const main = await f.file('frontend/android/app/build.gradle', 'versionCode 1\nversionName "0.0.1"')
  const wear = await f.file('frontend/android/wear/build.gradle', 'versionCode 5\nversionName "0.0.1"')
  await versions(f.ctx)
  assert.match(await readFile(main, 'utf8'), /versionCode 1002003\nversionName "1\.2\.3"/)
  assert.match(await readFile(wear, 'utf8'), /versionCode 1001002003\nversionName "1\.2\.3"/)
})

test('extra Android modules are checked read-only and must exist and fit the Android limit', async () => {
  const f = await fixture({ version: 1, capacitor: { platforms: ['android'], androidModules: [{ project: 'wear/build.gradle', versionCodeOffset: 1_000_000_000 }] } }, { platform: 'android', check: true })
  await f.file('package.json', '{"version":"1.2.3"}'); await f.file('android/app/build.gradle', 'versionCode 1002003\nversionName "1.2.3"')
  await assert.rejects(versions(f.ctx), /module build file was not found/)
  await f.file('wear/build.gradle', 'versionCode 1\nversionName "0.0.1"')
  await assert.rejects(versions(f.ctx), /stale/)
  const big = await fixture({ version: 1, capacitor: { platforms: ['android'], androidModules: [{ project: 'wear/build.gradle', versionCodeOffset: 2_100_000_000 }] } }, { platform: 'android' })
  await big.file('package.json', '{"version":"1.2.3"}'); await big.file('android/app/build.gradle', 'versionCode 1\nversionName "0.0.1"'); await big.file('wear/build.gradle', 'versionCode 1\nversionName "0.0.1"')
  await assert.rejects(versions(big.ctx), /exceeds the Android limit/)
  assert.throws(() => validateConfig({ version: 1, capacitor: { androidModules: [] } }), /non-empty array/)
  assert.throws(() => validateConfig({ version: 1, capacitor: { androidModules: [{ project: '' }] } }), /build\.gradle path/)
  assert.throws(() => validateConfig({ version: 1, capacitor: { androidModules: [{ project: 'a', versionCodeOffset: -1 }] } }), /non-negative integer/)
  assert.throws(() => validateConfig({ version: 1, capacitor: { androidModules: [{ project: 'a', extra: 1 }] } }), /Unknown capacitor\.androidModules entry field/)
})

test('optional dev processes start only when named with --with', async () => {
  const config = { version: 1, dev: { processes: [{ name: 'api', command: ['node'] }, { name: 'phone', command: ['node'], optional: true }] } }
  assert.deepEqual(selectedProcesses((await fixture(config, {})).ctx).map(entry => entry.name), ['api'])
  assert.deepEqual(selectedProcesses((await fixture(config, { with: 'phone' })).ctx).map(entry => entry.name), ['api', 'phone'])
  assert.throws(() => selectedProcesses({ ...(null), section: () => config.dev, string: () => 'api' }), /optional dev process/)
  assert.throws(() => validateConfig({ version: 1, dev: { processes: [{ name: 'a', command: ['x'], optional: 'yes' }] } }), /optional must be a boolean/)
})

test('tab commands quote every argument and never use a command separator', () => {
  const line = unixTabCommand(tab({ cwd: "/work/it's", command: ['npm', 'run', 'dev', "a b;c'd"], environment: { MODE: 'x y' } }))
  assert.equal(line, "cd '/work/it'\\''s' && MODE='x y' 'npm' 'run' 'dev' 'a b;c'\\''d' || true && exec bash")
  assert.ok(!line.includes(';') || line.includes("'a b;c"))
  assert.throws(() => unixTabCommand(tab({ environment: { 'BAD NAME': '1' } })), /identifiers/)
  assert.equal(gitBashPath('C:\\work\\app'), '/c/work/app')
})

test('Windows Terminal gets one tab per process, with Git Bash when installed and PowerShell otherwise', () => {
  const bash = 'C:\\Program Files\\Git\\bin\\bash.exe'
  const withBash = tabLaunches([tab(), tab({ title: 'web', cwd: 'C:\\work\\web' })], host('win32', ['wt'], [bash], { ProgramFiles: 'C:\\Program Files' }))
  assert.equal(withBash.length, 1); assert.equal(withBash[0].command, 'wt'); assert.equal(withBash[0].detached, true)
  assert.deepEqual(withBash[0].args.slice(0, 7), ['-w', 'new', 'new-tab', '--title', 'api', bash, '-lc'])
  assert.ok(withBash[0].args.includes(';')); assert.match(withBash[0].args.join('\n'), /cd '\/c\/work\/web'/)
  const powershell = tabLaunches([tab({ environment: { A: "it's" } })], host('win32', ['wt'])), text = powershell[0].args.join('\n')
  assert.match(text, /powershell\.exe\n-NoExit\n-Command/); assert.match(text, /\$env:A='it''s'/)
  assert.throws(() => tabLaunches([tab()], host('win32')), /Windows Terminal/)
})

test('macOS and Linux terminals are chosen in order and fail clearly when none exists', () => {
  const [mac] = tabLaunches([tab(), tab({ title: 'web' })], host('darwin'))
  assert.equal(mac.command, 'osascript'); assert.equal(mac.detached, false); assert.match(mac.args[1], /do script "cd '\/work\/app'/)
  assert.equal(tabLaunches([tab(), tab({ title: 'web' })], host('linux', ['gnome-terminal', 'konsole']))[0].command, 'gnome-terminal')
  assert.equal(tabLaunches([tab()], host('linux', ['konsole']))[0].command, 'konsole')
  const windows = tabLaunches([tab(), tab({ title: 'web' })], host('linux', ['xterm']))
  assert.deepEqual(windows.map(launch => launch.command), ['xterm', 'xterm']); assert.deepEqual(windows[1].args.slice(0, 2), ['-T', 'web'])
  assert.throws(() => tabLaunches([tab()], host('linux')), /No supported terminal/)
  assert.throws(() => tabLaunches([], host('linux', ['xterm'])), /nothing to open/)
})

test('dev tabs plans one detached launch and never runs the processes itself', async () => {
  const f = await fixture({ version: 1, dev: { processes: [{ name: 'api', command: ['npm', 'run', 'dev'], environment: { MODE: '{env}' } }, { name: 'web', command: ['npm', 'run', 'web'], root: 'sub' }] } }, { env: 'staging' })
  await f.file('sub/.keep')
  await devTabs(f.ctx, host('linux', ['gnome-terminal']))
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].command, 'gnome-terminal'); assert.equal(f.calls[0].detached, true)
  assert.match(f.calls[0].args.join('\n'), /MODE='staging'/); assert.match(f.calls[0].args.join('\n'), /sub'/)
})

test('a detached invocation returns as soon as the program has started', async () => {
  const started = await runProcess({ command: process.execPath, args: ['-e', 'setTimeout(() => {}, 50)'], cwd: process.cwd(), detached: true, windowsHide: true })
  assert.deepEqual(started, { stdout: '', stderr: '' })
  await assert.rejects(runProcess({ command: join(process.cwd(), 'definitely-missing-program'), args: [], cwd: process.cwd(), detached: true, label: 'Missing' }), /Cannot start Missing/)
})
