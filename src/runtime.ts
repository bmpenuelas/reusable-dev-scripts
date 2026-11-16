import { spawn } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { constants, platform } from 'node:os'
import { dirname, join, resolve, relative, isAbsolute } from 'node:path'
import { createRequire } from 'node:module'
import type { Invocation, Result, Runner } from './types.js'

export class Failure extends Error { constructor(message: string, public exitCode = 1) { super(message) } }
export function requireValue(condition: unknown, message: string): asserts condition { if (!condition) throw new Failure(message) }
export function inside(root: string, path: string): string {
  const base = resolve(root), target = resolve(base, path), rel = relative(base, target)
  requireValue(rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(rel), 'Path must stay inside its project')
  let current = target
  while (!existsSync(current)) { const parent = dirname(current); requireValue(parent !== current, 'Cannot resolve output path'); current = parent }
  let existingBase = base
  while (!existsSync(existingBase)) existingBase = dirname(existingBase)
  const physicalBase = resolve(realpathSync(existingBase), relative(existingBase, base))
  const physical = resolve(realpathSync(current), relative(current, target)), physicalRel = relative(physicalBase, physical)
  requireValue(physicalRel !== '..' && !physicalRel.startsWith('..\\') && !physicalRel.startsWith('../') && !isAbsolute(physicalRel), 'Path escapes project through a symlink')
  return target
}
export function outputPath(root: string, path: string): string {
  const target = inside(root, path)
  requireValue(target !== resolve(root), 'An output must not replace the project directory')
  return target
}
const packages: Record<string, string> = { vite: 'vite', 'vue-tsc': 'vue-tsc', tsc: 'typescript', cap: '@capacitor/cli', 'capacitor-assets': '@capacitor/assets', wrangler: 'wrangler', vsce: '@vscode/vsce', ovsx: 'ovsx', electron: 'electron', 'electron-builder': 'electron-builder' }
export function resolveExecutable(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env): [string, string[]] {
  if (command === 'node') return [process.execPath, args]
  if (command === 'npm') {
    const npm = env.npm_execpath?.endsWith('npm-cli.js') ? env.npm_execpath : join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
    requireValue(existsSync(npm), 'Cannot locate npm CLI; run through npm or configure its installation')
    return [process.execPath, [npm, ...args]]
  }
  if (packages[command]) {
    let directory = resolve(cwd)
    while (true) {
      const manifest = join(directory, 'node_modules', packages[command], 'package.json')
      if (existsSync(manifest)) {
        const data = JSON.parse(readFileSync(manifest, 'utf8'))
        const bin = typeof data.bin === 'string' ? data.bin : data.bin?.[command] ?? (command === 'capacitor-assets' ? data.bin?.['capacitor-assets'] : undefined)
        requireValue(typeof bin === 'string', `No local executable for ${command}`)
        return [process.execPath, [resolve(dirname(manifest), bin), ...args]]
      }
      const parent = dirname(directory); if (parent === directory) break; directory = parent
    }
    throw new Failure(`Install ${packages[command]} in the consuming project before running ${command}`)
  }
  return [command, args]
}
export function batchInvocation(command: string, args: string[]): [string, string[]] {
  for (const value of [command, ...args]) requireValue(!/[\r\n"%!^&|<>]/u.test(value), 'Unsafe characters in Windows batch arguments')
  return [process.env.ComSpec || 'cmd.exe', ['/d', '/v:off', '/s', '/c', `"${[command, ...args].map(x => `"${x}"`).join(' ')}"`]]
}
export const runProcess: Runner = async (invocation) => {
  let [command, args] = resolveExecutable(invocation.command, invocation.args, invocation.cwd, invocation.env)
  const batch = platform() === 'win32' && /\.(bat|cmd)$/iu.test(command)
  if (batch) [command, args] = batchInvocation(command, args)
  return new Promise<Result>((resolveResult, reject) => {
    const child = spawn(command, args, { cwd: invocation.cwd, env: invocation.env ?? process.env, shell: false, windowsHide: true, windowsVerbatimArguments: batch, stdio: [invocation.input === undefined ? 'inherit' : 'pipe', invocation.capture ? 'pipe' : 'inherit', invocation.capture ? 'pipe' : 'inherit'] })
    const chunks: Buffer[][] = [[], []]; let bytes = 0, timedOut = false, oversized = false
    const collect = (index: number) => (chunk: Buffer) => { bytes += chunk.length; if (bytes > 16 * 1024 * 1024) { oversized = true; child.kill() } else chunks[index]!.push(chunk) }
    child.stdout?.on('data', collect(0)); child.stderr?.on('data', collect(1))
    child.stdin?.on('error', () => {}); if (invocation.input !== undefined) child.stdin?.end(invocation.input)
    const interrupt = () => child.kill('SIGINT'), terminate = () => child.kill('SIGTERM')
    invocation.signal?.addEventListener('abort', terminate, { once: true })
    if (invocation.signal?.aborted) terminate()
    process.on('SIGINT', interrupt); process.on('SIGTERM', terminate)
    const timer = invocation.timeout ? setTimeout(() => { timedOut = true; child.kill() }, invocation.timeout) : undefined
    const cleanup = () => { clearTimeout(timer); process.off('SIGINT', interrupt); process.off('SIGTERM', terminate); invocation.signal?.removeEventListener('abort', terminate) }
    child.once('error', () => { cleanup(); reject(new Failure(`Cannot start ${invocation.label ?? 'command'}; check tool installation`)) })
    child.once('close', (code, signal) => {
      cleanup()
      if (timedOut || oversized || code !== 0) return reject(new Failure(`${invocation.label ?? 'Command'} ${timedOut ? 'timed out' : oversized ? 'exceeded output limit' : 'failed'}`, code || (signal ? 128 + (constants.signals[signal] || 1) : 1)))
      resolveResult({ stdout: Buffer.concat(chunks[0]!).toString('utf8'), stderr: Buffer.concat(chunks[1]!).toString('utf8') })
    })
  })
}
export async function writeChanged(path: string, content: string | Uint8Array, check = false): Promise<boolean> {
  const before = await readFile(path).catch((e: NodeJS.ErrnoException) => { if (e.code !== 'ENOENT') throw e; return undefined })
  const bytes = Buffer.from(content)
  if (before?.equals(bytes)) return false
  requireValue(!check, `Generated file is stale: ${path}`)
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, bytes); await rename(temporary, path)
  return true
}
export function loadConsumerModule(root: string, name: string): unknown { return createRequire(join(root, 'package.json'))(name) }
