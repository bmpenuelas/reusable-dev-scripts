import { existsSync } from 'node:fs'
import { cp, mkdir, readFile } from 'node:fs/promises'
import { join, basename, relative } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import sharp from 'sharp'
import { inside, outputPath, requireValue, writeChanged } from './runtime.js'
import { ownedDirectory } from './files.js'
import { images } from './images.js'
import type { Context } from './context.js'

export async function electron(ctx: Context, action: string) {
  const config = ctx.section('electron'), root = ctx.moduleRoot('electron')
  if (action === 'assets') return electronAssets(ctx)
  if (action === 'dev') {
    requireValue(ctx.environment !== 'production', 'Desktop development cannot target production')
    const url = config.url ?? 'http://127.0.0.1:5173', parsed = new URL(url)
    requireValue(['http:', 'https:'].includes(parsed.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) && !parsed.username && !parsed.password, 'Electron development server must be local HTTP(S)')
    const command = config.start ?? ['vite', '--host', parsed.hostname, '--port', parsed.port || '5173', '--strictPort']
    const controller = new AbortController(); let failure: unknown
    const server = ctx.run(command[0], command.slice(1), { cwd: root, signal: controller.signal, label: 'Electron frontend server' }).then(() => { if (!ctx.dryRun && !controller.signal.aborted) failure = new Error('Electron frontend exited') }).catch(error => { failure = error })
    try {
      if (!ctx.dryRun) {
        const deadline = Date.now() + 60_000
        while (!(await fetch(url, { signal: AbortSignal.timeout(1500) }).then(x => x.ok).catch(() => false))) { if (failure) throw failure; requireValue(Date.now() < deadline, 'Electron frontend readiness timed out'); await delay(200) }
        if (failure) throw failure
      }
      await ctx.run('electron', ['.'], { cwd: root, env: { ELECTRON_DEV: 'true', VITE_DEV_SERVER_URL: url }, label: 'Electron development app' })
    } finally { controller.abort(); await server }
    return
  }
  await ctx.guard(root)
  if (action === 'clean') {
    await ownedDirectory(ctx, relative(ctx.root, inside(root, config.output ?? 'release/desktop')), true)
    return
  }
  if (action === 'notarize') {
    requireValue(process.platform === 'darwin' || ctx.dryRun, 'Notarization requires macOS')
    const profile = ctx.string('profile', config.notaryProfile ?? '')
    requireValue(profile, 'Use --profile or configure electron.notaryProfile (notarytool keychain profile)')
    await ctx.run('xcrun', ['notarytool', 'history', '--keychain-profile', profile], { cwd: root, label: 'Notarization credential preflight' })
    if (ctx.boolean('preflight')) return
    const artifact = ctx.string('artifact'); requireValue(/\.(dmg|pkg|zip)$/iu.test(artifact), '--artifact must be a DMG, PKG, or ZIP')
    const path = inside(root, artifact); requireValue(ctx.dryRun || existsSync(path), 'Notarization artifact is missing')
    await ctx.run('xcrun', ['notarytool', 'submit', path, '--wait', '--keychain-profile', profile], { cwd: root, label: 'Submit notarization artifact' })
    if (!path.endsWith('.zip')) { await ctx.run('xcrun', ['stapler', 'staple', path], { cwd: root }); await ctx.run('xcrun', ['stapler', 'validate', path], { cwd: root }) }
    return
  }
  const platform = ctx.choice('platform', ['mac', 'windows', 'linux'], process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'windows' : 'linux')
  const arch = ctx.choice('arch', ['arm64', 'x64', 'all'], process.arch === 'arm64' ? 'arm64' : 'x64')
  const format = ctx.string('format'); requireValue(!format || ['dir', 'zip', 'dmg', 'nsis', 'appx', 'mas', 'AppImage', 'deb'].includes(format), 'Unsupported Electron artifact format')
  await ctx.hooks(config.prepare, root)
  if (config.assets) await electronAssets(ctx)
  const output = await ownedDirectory(ctx, relative(ctx.root, inside(root, config.output ?? 'release/desktop')), ctx.boolean('clean'))
  const args = [platform === 'windows' ? '--win' : `--${platform}`]
  if (format) args.push(format)
  args.push(...(arch === 'all' ? ['--arm64', '--x64'] : [`--${arch}`]), '--publish', 'never', `--config.directories.output=${output}`)
  if (config.builderConfig) args.push('--config', inside(root, config.builderConfig))
  await ctx.run('electron-builder', args, { cwd: root, ...(ctx.boolean('unsigned') ? { env: { CSC_IDENTITY_AUTO_DISCOVERY: 'false' } } : {}), label: 'Build Electron distribution' })
}
export async function electronAssets(ctx: Context) {
  const config = ctx.section('electron').assets, root = ctx.moduleRoot('electron')
  requireValue(config, 'Configure electron.assets')
  await images(ctx, root, config)
  if (!config.ico && !config.icns) return
  const source = await readFile(inside(root, config.source))
  const png = async (size: number, rounded = false) => {
    let image = sharp(source).resize(size, size, { fit: 'contain', background: config.background ?? '#00000000' })
    if (rounded && config.windowsCornerRadius) {
      requireValue(config.windowsCornerRadius >= 0 && config.windowsCornerRadius <= 0.5, 'Windows corner radius must be between 0 and 0.5')
      const radius = Math.round(size * config.windowsCornerRadius)
      image = image.composite([{ input: Buffer.from(`<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}" ry="${radius}"/></svg>`), blend: 'dest-in' }])
    }
    return image.png().toBuffer()
  }
  if (config.ico) {
    const sizes = [16, 24, 32, 48, 64, 128, 256], buffers = await Promise.all(sizes.map(size => png(size, true)))
    let offset = 6 + sizes.length * 16
    const header = Buffer.alloc(offset); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4)
    for (const [index, size] of sizes.entries()) {
      const entry = 6 + index * 16, bytes = buffers[index]!
      header[entry] = size === 256 ? 0 : size; header[entry + 1] = header[entry]!
      header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6); header.writeUInt32LE(bytes.length, entry + 8); header.writeUInt32LE(offset, entry + 12)
      offset += bytes.length
    }
    if (!ctx.dryRun) await writeChanged(outputPath(root, config.ico), Buffer.concat([header, ...buffers]), ctx.boolean('check'))
  }
  if (config.icns) {
    const specs: [string, number][] = [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024]]
    const chunks: Buffer[] = []
    for (const [type, size] of specs) { const bytes = await png(size), header = Buffer.alloc(8); header.write(type); header.writeUInt32BE(bytes.length + 8, 4); chunks.push(header, bytes) }
    const header = Buffer.alloc(8); header.write('icns'); header.writeUInt32BE(8 + chunks.reduce((sum, item) => sum + item.length, 0), 4)
    if (!ctx.dryRun) await writeChanged(outputPath(root, config.icns), Buffer.concat([header, ...chunks]), ctx.boolean('check'))
  }
}
export async function swift(ctx: Context, action: string) {
  const config = ctx.section('swift'), root = ctx.moduleRoot('swift')
  requireValue(process.platform === 'darwin' || ctx.dryRun, 'Native Swift macOS tooling requires macOS')
  if (action === 'icons') {
    requireValue(config.icon, 'Configure swift.icon')
    const source = inside(root, config.icon), directory = outputPath(root, '.rds/AppIcon.iconset')
    const output = outputPath(root, config.iconOutput ?? 'AppIcon.icns')
    if (!ctx.dryRun) {
      await mkdir(directory, { recursive: true })
      for (const size of [16, 32, 128, 256, 512]) for (const scale of [1, 2]) {
        const bytes = await sharp(await readFile(source)).resize(size * scale, size * scale, { fit: 'contain' }).png().toBuffer()
        await writeChanged(join(directory, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`), bytes)
      }
      await mkdir(join(output, '..'), { recursive: true })
    }
    await ctx.run('iconutil', ['-c', 'icns', directory, '-o', output], { cwd: root, label: 'Generate macOS ICNS' })
    return
  }
  await ctx.guard(root)
  const executable = config.executable; requireValue(executable && /^[\w.-]+$/u.test(executable), 'Configure the Swift executable product name')
  requireValue(config.plist && config.entitlements, 'Swift bundle requires explicit plist and entitlements')
  const output = config.output ?? `build/${executable}.app`
  requireValue(output.endsWith('.app'), 'Swift output must be an .app bundle')
  const planned = outputPath(root, output)
  const ownershipMarker = 'Contents/Resources/.rds-owned'
  requireValue(!existsSync(planned) || existsSync(join(planned, ownershipMarker)), 'Refusing to replace a Swift bundle not created by rds')
  await ctx.run('swift', ['build', '-c', 'release', '--product', executable], { cwd: root, label: 'Compile Swift product' })
  const result = await ctx.run('swift', ['build', '-c', 'release', '--show-bin-path'], { cwd: root, capture: true })
  const path = await ownedDirectory(ctx, relative(ctx.root, planned), true, ownershipMarker)
  if (!ctx.dryRun) {
    const binary = inside(root, join(relative(root, result.stdout.trim()), executable))
    await mkdir(join(path, 'Contents/MacOS'), { recursive: true }); await mkdir(join(path, 'Contents/Resources'), { recursive: true })
    await cp(binary, join(path, 'Contents/MacOS', executable)); await cp(inside(root, config.plist), join(path, 'Contents/Info.plist'))
    if (config.resources) await cp(inside(root, config.resources), join(path, 'Contents/Resources'), { recursive: true, dereference: false })
  }
  await ctx.run('codesign', ['--force', '--sign', config.identity ?? process.env.CODE_SIGN_IDENTITY ?? '-', '--entitlements', inside(root, config.entitlements), path], { cwd: root, label: 'Sign Swift app bundle' })
  await ctx.run('codesign', ['--verify', '--deep', '--strict', path], { cwd: root, label: 'Verify Swift app signature' })
  if (ctx.boolean('open')) await ctx.run('open', [path], { cwd: root, label: 'Launch bundled macOS app' })
}
