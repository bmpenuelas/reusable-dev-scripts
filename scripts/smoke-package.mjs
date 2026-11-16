import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { gunzipSync } from 'node:zlib'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { outputPath } from '../dist/runtime.js'
import { assertPortableText } from './public-content.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const cache = outputPath(root, '.rds')
await mkdir(cache, { recursive: true })
const temporary = await mkdtemp(join(cache, 'package-smoke-'))
const run = (command, args, cwd) => {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', shell: false, windowsHide: true })
  if (result.error || result.status !== 0) throw new Error(`Package smoke command failed: ${result.stderr || result.error?.message}`)
  return result.stdout
}
try {
  const npm = process.env.npm_execpath ?? join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
  const result = JSON.parse(run(process.execPath, [npm, 'pack', '--ignore-scripts', '--json', '--pack-destination', temporary], root))[0]
  assert.equal(result.name, 'reusable-dev-scripts')
  assert.equal(result.filename, `reusable-dev-scripts-${result.version}.tgz`)
  const files = result.files.map(file => file.path)
  assert.ok(files.includes('skills/reusable-dev-scripts/SKILL.md'), 'Missing bundled adoption skill')
  assert.ok(files.includes('dist/skill.js'), 'Missing skill installer')
  for (const expected of ['bin/rds.mjs', 'dist/cli.js', 'dist/index.js', 'dist/index.d.ts', 'src/types.ts', 'src/cli.ts', 'support/store/Fastfile', 'support/store/Gemfile.lock', 'support/store/metadata.mjs', 'README.md', 'AGENTS.md', 'LICENSE']) assert.ok(files.includes(expected), `Missing packed file: ${expected}`)
  assert.ok(!files.some(path => /^(test|node_modules|\.rds)\//u.test(path)), 'Packed private or generated development files')
  for (const name of files) if (/\.(?:md|mjs|js|json|ts)$/u.test(name)) assertPortableText(await readFile(join(root, name), 'utf8'), name)
  const tar = gunzipSync(await readFile(join(temporary, result.filename)))
  for (let position = 0; position + 512 <= tar.length;) {
    const header = tar.subarray(position, position + 512)
    if (header.every(byte => byte === 0)) break
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/su, '')
    const size = Number.parseInt(header.subarray(124, 136).toString('ascii').replace(/\0.*$/su, '').trim() || '0', 8)
    const type = String.fromCharCode(header[156])
    assert.ok(Number.isSafeInteger(size) && size >= 0 && position + 512 + size <= tar.length, 'Invalid package tar size')
    if (type === '0' || type === '\0') {
      assert.ok(name.startsWith('package/') && !name.split('/').includes('..'), 'Unsafe package path')
      const output = outputPath(temporary, name)
      await mkdir(dirname(output), { recursive: true }); await writeFile(output, tar.subarray(position + 512, position + 512 + size))
    }
    position += 512 + Math.ceil(size / 512) * 512
  }
  for (const name of files.filter(name => name.endsWith('.md'))) {
    const document = join(temporary, 'package', name)
    for (const [, href] of (await readFile(document, 'utf8')).matchAll(/\[[^\]]*\]\(([^\s)]+)\)/gu)) {
      if (/^[a-z][a-z\d+.-]*:/iu.test(href)) continue
      const file = href.split('#')[0]
      if (file) assert.ok(existsSync(resolve(dirname(document), decodeURIComponent(file))), `Broken packed documentation link: ${name} -> ${href}`)
    }
  }
  const entry = join(temporary, 'package/bin/rds.mjs')
  const manifest = JSON.parse(await readFile(join(temporary, 'package/package.json'), 'utf8'))
  assert.equal(manifest.name, 'reusable-dev-scripts')
  assert.deepEqual(manifest.bin, { rds: 'bin/rds.mjs' })
  const help = run(process.execPath, [entry, '--help'], temporary)
  assert.match(help, /^rds /)
  assert.match(help, /rds capacitor sync/)
  const invalid = spawnSync(process.execPath, [entry, 'unknown'], { cwd: temporary, encoding: 'utf8', windowsHide: true })
  assert.equal(invalid.status, 1)
  assert.match(invalid.stderr, /^rds: Unknown command:/)
  const api = await import(pathToFileURL(join(temporary, 'package/dist/index.js')).href)
  assert.equal(api.defineConfig({ version: 1 }).version, 1)
  const consumer = join(temporary, 'consumer')
  await mkdir(join(consumer, 'node_modules/vite/bin'), { recursive: true })
  await writeFile(join(consumer, 'reusable-dev-scripts.config.json'), JSON.stringify({ version: 1, vue: { typecheck: false } }))
  await writeFile(join(consumer, 'node_modules/vite/package.json'), JSON.stringify({ bin: { vite: 'bin/vite.mjs' } }))
  await writeFile(join(consumer, 'node_modules/vite/bin/vite.mjs'), "console.log('PACKED_CONSUMER_OK:' + process.argv.slice(2).join(','))")
  const output = run(process.execPath, [entry, 'vue', 'build', '--env', 'staging'], consumer)
  assert.match(output, /PACKED_CONSUMER_OK:build,--mode,staging/)
  run(process.execPath, [entry, 'skill', 'install', '--dry-run'], consumer)
  assert.equal(existsSync(join(consumer, '.agents')), false)
  run(process.execPath, [entry, 'skill', 'install'], consumer)
  assert.equal(await readFile(join(consumer, '.agents/skills/reusable-dev-scripts/SKILL.md'), 'utf8'), await readFile(join(temporary, 'package/skills/reusable-dev-scripts/SKILL.md'), 'utf8'))
  console.log(`Package smoke passed: ${files.length} files, executable CLI, exported types/API, consumer-local tool resolution`)
} finally {
  // Verify the final absolute target is still inside the intended smoke workspace before removal.
  const target = outputPath(root, temporary)
  assert.equal(dirname(target), resolve(cache))
  await rm(target, { recursive: true, force: true })
}
