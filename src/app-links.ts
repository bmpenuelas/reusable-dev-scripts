// Android App Links and Apple Universal Links association files, from explicit identities. rds only writes and compares
// the two local files: it never reads signing keys, infers identities, changes DNS or deploys.
import { readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { outputPath, requireValue, writeChanged } from './runtime.js'
import type { Context } from './context.js'
import type { AppLinks } from './types.js'

const androidPackage = /^[A-Za-z]\w*(?:\.[A-Za-z]\w*)+$/u
const appleBundle = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/u
const sha256 = /^(?:[a-f0-9]{2}:){31}[a-f0-9]{2}$/iu
const handleUrls = 'delegate_permission/common.handle_all_urls'
const isObject = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)
const only = (x: unknown, keys: string[]): x is Record<string, unknown> => isObject(x) && Object.keys(x).every(key => keys.includes(key))

export function validateAppLinks(value: unknown): asserts value is AppLinks {
  requireValue(only(value, ['directory', 'android', 'apple']), 'Invalid appLinks fields')
  requireValue(typeof value.directory === 'string' && value.directory.length && !value.directory.includes('\0'), 'appLinks.directory must be a path')
  requireValue(value.android !== undefined || value.apple !== undefined, 'Configure at least one app link platform')
  const ids = new Set<string>()
  for (const kind of ['android', 'apple'] as const) {
    const entries = value[kind]
    if (entries === undefined) continue
    requireValue(Array.isArray(entries) && entries.length, `appLinks.${kind} must be a non-empty array`)
    for (const entry of entries) {
      if (kind === 'android') {
        requireValue(only(entry, ['packageName', 'fingerprints']), 'Invalid Android app link fields')
        requireValue(typeof entry.packageName === 'string' && androidPackage.test(entry.packageName) && !ids.has(entry.packageName), 'Use a unique explicit Android package name')
        requireValue(Array.isArray(entry.fingerprints) && entry.fingerprints.length && entry.fingerprints.every(fp => typeof fp === 'string' && sha256.test(fp)), 'Use explicit colon-delimited SHA-256 fingerprints')
        ids.add(entry.packageName)
      } else {
        requireValue(only(entry, ['teamId', 'bundleId', 'paths']), 'Invalid Apple app link fields')
        requireValue(typeof entry.teamId === 'string' && /^[A-Z0-9]{10}$/u.test(entry.teamId) && typeof entry.bundleId === 'string' && appleBundle.test(entry.bundleId), 'Use an explicit Apple team ID and bundle ID')
        const id = `${entry.teamId}.${entry.bundleId}`
        requireValue(!ids.has(id), 'Apple app link identities must be unique')
        requireValue(Array.isArray(entry.paths) && entry.paths.length && entry.paths.every(path => typeof path === 'string' && (path === '*' || /^\/[!-~]*$/u.test(path) && !/[#\\]/u.test(path))), 'Use explicit Apple URL path patterns that start with / (or "*" for every path)')
        ids.add(id)
      }
    }
  }
}

export function appLinkFiles(config: AppLinks): Record<string, string> {
  validateAppLinks(config)
  const docs: Record<string, unknown> = {}
  if (config.android) docs['assetlinks.json'] = config.android.map(({ packageName, fingerprints }) => ({
    relation: [handleUrls],
    target: { namespace: 'android_app', package_name: packageName, sha256_cert_fingerprints: [...new Set(fingerprints.map(fp => fp.toUpperCase()))] },
  }))
  if (config.apple) docs['apple-app-site-association'] = { applinks: { details: config.apple.map(({ teamId, bundleId, paths }) => ({
    appIDs: [`${teamId}.${bundleId}`], components: [...new Set(paths)].map(path => ({ '/': path })),
  })) } }
  return Object.fromEntries(Object.entries(docs).map(([name, value]) => [name, JSON.stringify(value, null, 2) + '\n']))
}

/**
 * What an association file declares, ignoring formatting, comments and the empty legacy `apps` list.
 * `undefined` means the file holds something rds does not manage (webcredentials, other relations, exclusions…).
 */
export function appLinkDeclarations(name: string, text: string): unknown {
  let data: unknown
  try { data = JSON.parse(text.replace(/^﻿/u, '')) } catch { return undefined }
  if (name === 'assetlinks.json') {
    if (!Array.isArray(data)) return undefined
    const entries = data.map(entry => {
      if (!only(entry, ['relation', 'target']) || !isDeepStrictEqual(entry.relation, [handleUrls])) return undefined
      const target = entry.target
      if (!only(target, ['namespace', 'package_name', 'sha256_cert_fingerprints']) || target.namespace !== 'android_app') return undefined
      const fingerprints = target.sha256_cert_fingerprints
      if (typeof target.package_name !== 'string' || !Array.isArray(fingerprints) || !fingerprints.every(fp => typeof fp === 'string')) return undefined
      return { packageName: target.package_name, fingerprints: fingerprints.map(fp => (fp as string).toUpperCase()) }
    })
    return entries.includes(undefined) ? undefined : entries
  }
  if (!only(data, ['applinks']) || !only(data.applinks, ['apps', 'details'])) return undefined
  const { apps, details } = data.applinks
  if (apps !== undefined && !isDeepStrictEqual(apps, []) || !Array.isArray(details)) return undefined
  const entries = details.map(detail => {
    if (!only(detail, ['appIDs', 'components']) || !Array.isArray(detail.appIDs) || !Array.isArray(detail.components)) return undefined
    const paths = detail.components.map(component => only(component, ['/', 'comment']) && typeof component['/'] === 'string' ? component['/'] : undefined)
    return paths.includes(undefined) ? undefined : { appIDs: detail.appIDs, paths }
  })
  return entries.includes(undefined) ? undefined : entries
}

export async function appLinks(ctx: Context, check: boolean) {
  const config = ctx.section('appLinks')
  const files = Object.entries(appLinkFiles(config)).map(([name, content]) => ({ name, path: outputPath(ctx.root, join(config.directory, '.well-known', name)), content }))
  ctx.log(`${ctx.dryRun ? '[plan]' : '[rds]'} ${check ? 'Check' : 'Generate'} ${files.length} local app-link association files`)
  if (ctx.dryRun) return
  const label = (path: string) => relative(ctx.root, path).split(sep).join('/')
  const pending: typeof files = []
  // Inspect every file before writing any, so a refusal leaves the project untouched.
  for (const file of files) {
    const current = await readFile(file.path, 'utf8').catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; return undefined })
    if (current === undefined) {
      requireValue(!check, `App-link association file is missing: ${label(file.path)}`)
      pending.push(file); continue
    }
    const declared = appLinkDeclarations(file.name, current)
    if (declared !== undefined && isDeepStrictEqual(declared, appLinkDeclarations(file.name, file.content))) continue
    requireValue(!check, `App-link association file does not match the configuration: ${label(file.path)}`)
    requireValue(declared !== undefined, `Refusing to overwrite ${label(file.path)}: it declares something rds does not manage, or is not valid JSON`)
    pending.push(file)
  }
  for (const file of pending) { await writeChanged(file.path, file.content); ctx.log(`[rds] Wrote ${label(file.path)}`) }
  if (check) ctx.log('[rds] App-link association files match the configuration')
}
