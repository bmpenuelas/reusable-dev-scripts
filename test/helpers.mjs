import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { Context } from '../dist/context.js'
export async function fixture(config = { version: 1 }, flags = {}) {
  const root = await mkdtemp(join(tmpdir(), 'reusable-dev-scripts-'))
  const calls = [], messages = []
  const runner = async step => { calls.push(step); return { stdout: '', stderr: '' } }
  const ctx = new Context(root, config, flags, runner, line => messages.push(line))
  return { root, ctx, calls, messages, async file(path, content = '') { const target = join(root, path); await mkdir(dirname(target), { recursive: true }); await writeFile(target, content); return target } }
}
