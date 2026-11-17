import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

test('package smoke isolates builds and creates its tarball under inherited npm dry-run', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const script = fileURLToPath(new URL('../scripts/smoke-package.mjs', import.meta.url))
  // npm 10 can run prepare despite --ignore-scripts. Even byte-identical tsc
  // rewrites can expose empty/partial modules to concurrently importing tests.
  const snapshot = async () => {
    const paths = ['bin/rds.mjs', ...(await readdir(join(root, 'dist'))).map(name => `dist/${name}`)]
    return Promise.all(paths.map(async path => {
      const info = await stat(join(root, path), { bigint: true })
      return [path, String(info.mtimeNs), String(info.size)]
    }))
  }
  const before = await snapshot()
  const result = spawnSync(process.execPath, [script], {
    cwd: root,
    env: { ...process.env, npm_config_dry_run: 'true' },
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 120_000,
  })
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Package smoke passed:/)
  assert.deepEqual(await snapshot(), before, 'Packing must not rewrite the live executable or compiled modules')
})
