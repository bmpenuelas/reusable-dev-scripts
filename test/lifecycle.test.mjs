import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { capacitorLive } from '../dist/capacitor.js'
import { electron } from '../dist/desktop.js'
import { fixture } from './helpers.mjs'

for (const family of ['capacitor', 'electron']) {
  test(`${family} development cleans up its own server when app launch fails`, async t => {
    t.mock.method(globalThis, 'fetch', async () => ({ ok: true }))
    const server = createServer((_request, response) => response.end('ready'))
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const port = server.address().port
    const config = family === 'capacitor' ? { version: 1, capacitor: { platforms: ['android'], live: { port, timeout: 1000 } } } : { version: 1, electron: { url: `http://127.0.0.1:${port}` } }
    const f = await fixture(config, { platform: 'android', 'skip-sync': true })
    let aborted = false
    f.ctx.runner = step => {
      if (step.command === 'vite') return new Promise(resolve => {
        step.signal.addEventListener('abort', () => { aborted = true; server.close(() => resolve({ stdout: '', stderr: '' })) }, { once: true })
      })
      throw new Error('Simulated app launch failure')
    }
    await assert.rejects(family === 'capacitor' ? capacitorLive(f.ctx) : electron(f.ctx, 'dev'), /Simulated/)
    assert.equal(aborted, true); assert.equal(server.listening, false)
  })
}
