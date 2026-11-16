import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { main } from '../dist/cli.js'
import { fixture } from './helpers.mjs'

const bundled = await readFile(new URL('../skills/reusable-dev-scripts/SKILL.md', import.meta.url), 'utf8')

test('skill installation is project-local, identical on retry, and never loads project config', async () => {
  const f = await fixture()
  await f.file('reusable-dev-scripts.config.mjs', "throw new Error('Project config must not execute')")
  const args = ['skill', 'install', '--cwd', f.root]
  const ctx = await main(args, f.ctx.runner, () => {})
  const target = join(f.root, '.agents/skills/reusable-dev-scripts/SKILL.md')
  assert.equal(await readFile(target, 'utf8'), bundled)
  assert.equal(ctx.root, f.root)
  assert.deepEqual(ctx.plan, [])
  assert.equal(f.calls.length, 0)
  const before = await stat(target)
  await main(args, f.ctx.runner, () => {})
  assert.equal((await stat(target)).mtimeMs, before.mtimeMs)
})

test('skill dry-run writes nothing and custom output preserves neighboring files', async () => {
  const f = await fixture(), output = '.claude/skills/reusable-dev-scripts'
  await main(['skill', 'install', '--cwd', f.root, '--output', output, '--dry-run'], f.ctx.runner, () => {})
  assert.equal(existsSync(join(f.root, '.claude')), false)
  const neighbor = await f.file('.claude/skills/other-skill/SKILL.md', 'Existing instructions')
  await main(['skill', 'install', '--cwd', f.root, '--output', output], f.ctx.runner, () => {})
  assert.equal(await readFile(join(f.root, output, 'SKILL.md'), 'utf8'), bundled)
  assert.equal(await readFile(neighbor, 'utf8'), 'Existing instructions')
})

test('skill installer rejects conflicting instructions, escaping paths and config flags', async () => {
  const f = await fixture(), target = await f.file('.agents/skills/reusable-dev-scripts/SKILL.md', 'Custom skill')
  for (const suffix of [[], ['--dry-run']]) {
    await assert.rejects(main(['skill', 'install', '--cwd', f.root, ...suffix]), /Existing SKILL.md differs/)
    assert.equal(await readFile(target, 'utf8'), 'Custom skill')
  }
  for (const output of ['../escape', '.']) await assert.rejects(main(['skill', 'install', '--cwd', f.root, '--output', output]), /inside|replace/)
  await assert.rejects(main(['skill', 'install', '--cwd', f.root, '--config', 'other.json']), /does not load project configuration/)
  await assert.rejects(main(['skill', 'install', '--cwd', f.root, '--force']), /not supported/)
})
