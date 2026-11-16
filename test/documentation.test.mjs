import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { dirname, join, relative, resolve, extname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { assertPortableText } from '../scripts/public-content.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const ignored = new Set(['node_modules', 'dist', '.rds', '.git', 'coverage', '.secrets'])
async function sourceFiles(directory = root) {
  const paths = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name) || entry.name.endsWith('.tgz') || entry.name.startsWith('.env') || entry.name.startsWith('reusable-dev-scripts.config.local.')) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) paths.push(...await sourceFiles(path))
    else if (entry.isFile()) paths.push(path)
  }
  return paths
}

test('public source contains no absolute home paths or private key blocks', async () => {
  for (const path of await sourceFiles()) assertPortableText(await readFile(path, 'utf8'), relative(root, path))
})
test('all relative documentation links resolve inside the repository', async () => {
  for (const path of (await sourceFiles()).filter(path => path.endsWith('.md'))) {
    const text = await readFile(path, 'utf8')
    for (const [, href] of text.matchAll(/\[[^\]]*\]\(([^\s)]+)\)/gu)) {
      if (/^[a-z][a-z\d+.-]*:/iu.test(href)) continue
      const [file, anchor] = href.split('#'), target = file ? resolve(dirname(path), decodeURIComponent(file)) : path
      assert.ok(!relative(root, target).startsWith('..'), `Escaping doc link: ${relative(root, path)}`)
      assert.ok(existsSync(target), `Broken link in ${relative(root, path)}: ${href}`)
      if (anchor && target.endsWith('.md')) {
        const headings = [...(await readFile(target, 'utf8')).matchAll(/^#{1,6}\s+(.+)$/gmu)].map(match => match[1].toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().replace(/\s/gu, '-'))
        assert.ok(headings.includes(anchor), `Missing heading: ${href}`)
      }
    }
  }
})
test('documentation JavaScript and JSON examples are syntactically valid', async () => {
  for (const path of (await sourceFiles()).filter(path => path.endsWith('.md'))) {
    const text = await readFile(path, 'utf8')
    for (const [, language, raw] of text.matchAll(/```(js|json)\r?\n([\s\S]*?)```/gu)) {
      if (language === 'json') { assert.doesNotThrow(() => JSON.parse(raw), relative(root, path)); continue }
      const code = /^\s*[A-Za-z_$][\w$]*\s*:/u.test(raw) ? `({\n${raw}\n})` : raw
      const result = spawnSync(process.execPath, ['--check', '--input-type=module'], { input: code, encoding: 'utf8', windowsHide: true })
      assert.equal(result.status, 0, `Invalid JS in ${relative(root, path)}: ${result.stderr}`)
    }
  }
})
test('standalone example configs import and validate without application files', async () => {
  for (const file of await readdir(join(root, 'examples'))) if (extname(file) === '.mjs') {
    const config = (await import(pathToFileURL(join(root, 'examples', file)).href)).default
    assert.equal(config.version, 1)
  }
})
