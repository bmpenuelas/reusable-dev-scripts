import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join, dirname, resolve } from 'node:path'
import { outputPath, runProcess } from '../dist/runtime.js'

test('Windows Gradle-style batch wrapper preserves spaces and equals', { skip: process.platform !== 'win32' }, async () => {
  const workspace = resolve('.'), cache = outputPath(workspace, '.rds')
  await mkdir(cache, { recursive: true }); const directory = await mkdtemp(join(cache, 'batch-fixture-'))
  try {
    const command = join(directory, 'wrapper with spaces.bat')
    await writeFile(command, '@echo off\r\necho %~1\r\necho %~2\r\n')
    const result = await runProcess({ command, args: ['hello world', '-Pname=value'], cwd: directory, capture: true })
    assert.match(result.stdout, /hello world/); assert.match(result.stdout, /-Pname=value/)
  } finally { const target = outputPath(workspace, directory); assert.equal(dirname(target), cache); await rm(target, { recursive: true, force: true }) }
})
