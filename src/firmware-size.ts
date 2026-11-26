import { existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import type { Context } from './context.js'
import { requireValue } from './runtime.js'

export function esp32AppSlots(csv: string) {
  const seen = new Set<string>()
  return csv.replace(/^\uFEFF/u, '').split(/\r?\n/u).flatMap(line => {
    const content = line.split('#', 1)[0]!.trim()
    if (!content) return []
    const [name, type, subtype, , raw] = content.split(',').map(x => x.trim())
    requireValue(name && type && subtype && raw && !seen.has(name), 'Invalid or duplicate ESP32 partition CSV row')
    seen.add(name)
    if (type !== 'app' && !/^(?:0+|0x0+)$/iu.test(type)) return []
    const size = /^(0x[\da-f]+|\d+)([km]?)$/iu.exec(raw)
    requireValue(size && !(size[1]!.startsWith('0x') && size[2]), 'Invalid ESP32 app partition size')
    const unit = size[2]!.toLowerCase()
    const bytes = Number(size[1]) * (unit === 'm' ? 1048576 : unit === 'k' ? 1024 : 1)
    requireValue(Number.isSafeInteger(bytes) && bytes > 0, 'Invalid ESP32 app partition size')
    const numeric = /^(?:\d+|0x[\da-f]+)$/iu.test(subtype) ? Number(subtype) : NaN
    return [{ name, bytes, ota: /^ota_(?:[0-9]|1[0-5])$/u.test(subtype) || (numeric >= 16 && numeric <= 31) }]
  })
}

export async function firmwareSize(ctx: Context) {
  const file = ctx.string('artifact'), csv = ctx.string('partitions'), slot = ctx.string('slot'), raw = ctx.string('min-free-bytes', '0')
  requireValue(/\.bin$/iu.test(file) && /\.csv$/iu.test(csv), 'Provide --artifact <firmware.bin> and --partitions <partitions.csv>')
  requireValue(/^\d+$/u.test(raw) && Number.isSafeInteger(Number(raw)), '--min-free-bytes must be a non-negative integer')
  const artifact = ctx.path(file), table = ctx.path(csv), minimum = Number(raw)
  if (ctx.dryRun) { ctx.log('[plan] Check existing ESP32 binary against the selected app partition budget'); return }
  requireValue(existsSync(artifact), 'ESP32 firmware artifact not found; build it first')
  requireValue(existsSync(table), 'ESP32 partition table not found')
  const metadata = await stat(artifact)
  requireValue(metadata.isFile() && metadata.size > 0, 'ESP32 firmware artifact must be a non-empty file')
  const slots = esp32AppSlots(await readFile(table, 'utf8')).filter(entry => slot ? entry.name === slot : entry.ota)
  requireValue(slots.length, slot ? 'Selected ESP32 app partition was not found' : 'No ESP32 OTA app partitions found; select a named app partition with --slot')
  const budget = Math.min(...slots.map(entry => entry.bytes)), free = budget - metadata.size
  requireValue(free >= minimum, `ESP32 firmware is ${metadata.size} bytes; slot budget is ${budget} bytes and requires ${minimum} bytes free (available: ${free})`)
  ctx.log(`[rds] ESP32 firmware: ${metadata.size}/${budget} bytes, ${free} bytes free`)
}
