import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

test('package smoke creates its disposable tarball under inherited npm dry-run', () => {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const script = fileURLToPath(new URL('../scripts/smoke-package.mjs', import.meta.url))
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
})
