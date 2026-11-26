import sharp from 'sharp'
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { inside, outputPath, requireValue, writeChanged } from './runtime.js'
import type { Context } from './context.js'
import type { Images, NativeLocales } from './types.js'

export async function images(ctx: Context, root: string, config: Images) {
  if (!config.outputs?.length) return
  requireValue(config.source, 'Configure an image source for resized outputs')
  const input = inside(root, config.source)
  const source = ctx.dryRun ? undefined : await readFile(input)
  for (const output of config.outputs ?? []) {
    requireValue(Number.isInteger(output.width) && output.width > 0 && output.width <= 8192 && (!output.height || Number.isInteger(output.height) && output.height > 0 && output.height <= 8192), 'Invalid image output dimensions')
    const path = outputPath(root, output.path)
    requireValue(/\.(png|webp|jpe?g)$/iu.test(path), 'Image outputs must be PNG, JPEG or WebP; use electron.assets.ico/icns for desktop containers')
    if (!source) continue
    const pipeline = sharp(source).resize(output.width, output.height ?? output.width, { fit: 'contain', background: config.background ?? '#00000000' })
    const bytes = /\.webp$/iu.test(path) ? await pipeline.webp().toBuffer() : /\.(jpe?g)$/iu.test(path) ? await pipeline.flatten({ background: config.background ?? '#ffffff' }).jpeg().toBuffer() : await pipeline.png().toBuffer()
    if (!ctx.dryRun) await writeChanged(path, bytes, ctx.boolean('check'))
  }
}
export function assetCopyPlan(root: string, config: Images, extraOutputs: (string | undefined)[] = []) {
  const key = (path: string) => path.toLowerCase()
  const entries = (config.copies ?? []).map(entry => {
    const source = inside(root, entry.source), path = outputPath(root, entry.path)
    requireValue(!entry.normalize || (entry.normalize === 'png' && /\.png$/iu.test(path)), 'PNG normalization needs a .png destination')
    return { source, path, normalize: entry.normalize }
  })
  const claimed = new Set([...(config.outputs?.map(entry => entry.path) ?? []), ...extraOutputs.filter((path): path is string => !!path)].map(path => key(inside(root, path))))
  if (config.source) claimed.add(key(inside(root, config.source)))
  for (const entry of entries) {
    requireValue(!claimed.has(key(entry.path)), 'Asset copy output collides with another output or the master image')
    claimed.add(key(entry.path))
  }
  const destinations = new Set(entries.map(entry => key(entry.path)))
  requireValue(entries.every(entry => !destinations.has(key(entry.source))), 'Asset copies cannot overwrite their own inputs or use another copy destination as input')
  return entries
}
export async function assetCopies(ctx: Context, plan: ReturnType<typeof assetCopyPlan>) {
  if (!plan.length) return
  ctx.log(`${ctx.dryRun ? '[plan]' : '[rds]'} ${ctx.boolean('check') ? 'Check' : 'Write'} ${plan.length} explicit asset copies`)
  if (ctx.dryRun) return
  const files = await Promise.all(plan.map(async ({ source, path, normalize }) => {
    const bytes = await readFile(source)
    return { path, bytes: normalize ? await sharp(bytes).png({ compressionLevel: 9 }).toBuffer() : bytes }
  }))
  for (const { path, bytes } of files) await writeChanged(path, bytes, ctx.boolean('check'))
}
export function androidText(value: string): string { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('\\', '\\\\').replaceAll("'", "\\'").replaceAll('"', '\\"').replaceAll('\n', '\\n').replace(/^([@?])/u, '\\$1') }
const placeholders = (value: string) => [...value.matchAll(/%(?:\d+\$)?[sdif]|\{[\w.]+\}/gu)].map(x => x[0]).sort().join('|')
export function localeFiles(root: string, config: NativeLocales): Map<string, string> {
  requireValue(config && typeof config.locales === 'object' && Array.isArray(config.targets), 'Configure normalized native locales and targets')
  const baseline = config.locales[config.defaultLocale]; requireValue(baseline, 'Missing default native locale')
  const files = new Map<string, string>()
  for (const [locale, values] of Object.entries(config.locales)) {
    requireValue(/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/u.test(locale), 'Invalid locale code')
    for (const target of config.targets) {
      requireValue(['android', 'apple'].includes(target.format), 'Locale target must be android or apple')
      const pairs = Object.entries(target.keys ?? Object.fromEntries(Object.keys(baseline).map(key => [key, key]))).map(([native, key]) => {
        const value = values[key], reference = baseline[key]
        requireValue(typeof value === 'string' && typeof reference === 'string', `Missing native translation: ${locale}/${key}`)
        requireValue(placeholders(value) === placeholders(reference), `Translation placeholder mismatch: ${locale}/${key}`)
        requireValue(/^[a-zA-Z_][\w.]*$/u.test(native), 'Invalid native string key')
        return [native, value] as const
      })
      const androidLocale = locale.includes('-') ? `b+${locale.replaceAll('-', '+')}` : locale
      const directory = target.format === 'android' ? (locale === config.defaultLocale ? 'values' : `values-${androidLocale}`) : `${locale}.lproj`
      const names = target.format === 'android' ? ['strings.xml'] : ['Localizable.strings', 'InfoPlist.strings']
      const file = target.file ?? names[0]!
      requireValue(names.includes(file), `A ${target.format} locale target file must be ${names.join(' or ')}`)
      const path = outputPath(root, join(target.directory, directory, file))
      requireValue(!files.has(path), 'Native locale targets resolve to the same output file')
      files.set(path, target.format === 'android' ? `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n${pairs.map(([key, value]) => `  <string name="${key}">${androidText(value)}</string>`).join('\n')}\n</resources>\n` : pairs.map(([key, value]) => `${JSON.stringify(key)} = ${JSON.stringify(value)};`).join('\n') + '\n')
    }
  }
  return files
}
export async function locales(ctx: Context) {
  const config = ctx.section('capacitor').locales; requireValue(config, 'Configure capacitor.locales')
  const files = localeFiles(ctx.moduleRoot('capacitor'), config)
  if (!ctx.dryRun) for (const [path, content] of files) await writeChanged(path, content, ctx.boolean('check'))
  ctx.log(`${ctx.dryRun ? '[plan]' : '[rds]'} ${files.size} native locale files`)
}
export async function capacitorAssets(ctx: Context) {
  const root = ctx.moduleRoot('capacitor'), config = ctx.section('capacitor').assets; requireValue(config, 'Configure capacitor.assets')
  requireValue(config.native === false || config.source, 'Configure an image source for native assets')
  const copies = assetCopyPlan(root, config, ['.rds/native-assets.json', '.rds/asset-input/icon.png'])
  await images(ctx, root, config)
  if (config.native !== false) {
    // Fingerprint only the native asset inputs; the platform generator remains the consumer's pinned tool.
    const stamp = outputPath(root, '.rds/native-assets.json')
    const source = ctx.dryRun ? undefined : await readFile(inside(root, config.source!))
    const fingerprint = source ? createHash('sha256').update(source).update(JSON.stringify(config)).digest('hex') + '\n' : ''
    if (ctx.boolean('check')) {
      if (!ctx.dryRun) {
        const snapshot = JSON.parse(await readFile(stamp, 'utf8').catch(() => { throw new Error('Native assets have not been generated by rds') }))
        requireValue(snapshot.input === fingerprint && snapshot.outputs && Object.keys(snapshot.outputs).length, 'Native assets are stale')
        for (const [path, hash] of Object.entries(snapshot.outputs)) requireValue(createHash('sha256').update(await readFile(inside(root, path))).digest('hex') === hash, 'A generated native asset is missing or modified')
      }
    }
    else {
      const staging = outputPath(root, '.rds/asset-input')
      if (source) await writeChanged(outputPath(root, '.rds/asset-input/icon.png'), await sharp(source).png().toBuffer())
      const targets = ctx.flags.platform && ctx.flags.platform !== 'all' ? [ctx.string('platform')] : ctx.section('capacitor').platforms ?? ['android', 'ios']
      const args = ['generate', ...targets.map(target => `--${target}`), '--assetPath', staging]
      if (config.background) args.push('--iconBackgroundColor', config.background, '--splashBackgroundColor', config.background)
      await ctx.run('capacitor-assets', args, { cwd: root, label: 'Generate native icons and splash assets' })
      await assetCopies(ctx, copies)
      if (!ctx.dryRun) {
        const outputs: Record<string, string> = {}
        const walk = async (directory: string) => {
          const entries = await readdir(inside(root, directory), { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; return [] })
          for (const entry of entries) {
            requireValue(!entry.isSymbolicLink(), 'Generated asset directories must not contain symlinks')
            const path = join(directory, entry.name)
            if (entry.isDirectory()) await walk(path)
            else if (/\.(png|webp|json|xml)$/iu.test(entry.name)) outputs[path] = createHash('sha256').update(await readFile(inside(root, path))).digest('hex')
          }
        }
        if (targets.includes('android')) {
          const res = 'android/app/src/main/res'
          for (const entry of await readdir(inside(root, res), { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; return [] })) if (entry.isDirectory() && /^(mipmap|drawable)/u.test(entry.name)) await walk(join(res, entry.name))
        }
        if (targets.includes('ios')) { await walk('ios/App/App/Assets.xcassets/AppIcon.appiconset'); await walk('ios/App/App/Assets.xcassets/Splash.imageset') }
        requireValue(Object.keys(outputs).length, 'Asset generator did not produce native outputs')
        await writeChanged(stamp, JSON.stringify({ input: fingerprint, outputs }, null, 2) + '\n')
      }
      return
    }
  }
  await assetCopies(ctx, copies)
}
