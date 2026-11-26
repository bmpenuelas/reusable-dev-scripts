// Native locale registration: the declarations that make Android, Xcode and the stores see an app's languages.
// `check-locales` only reads. `register-locales` edits the standard Android and Xcode files, verifies the result in
// memory, and writes nothing unless the whole check then passes. Neither command creates or edits translations.
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname, join, posix, relative, sep } from 'node:path'
import { addObject, appendItem, arrayAt, dictAt, parsePbx, pbxQuote, removeSpan, stringAt, stringsAt, type PbxDict } from './pbxproj.js'
import { inside, outputPath, requireValue, writeChanged } from './runtime.js'
import type { Context } from './context.js'
import type { LocaleRegistration, LocaleRegistrationTarget } from './types.js'

const localeCode = /^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/u
const stringsFile = /^[\w-]+\.strings(?:dict)?$/u
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

function fields(entry: unknown, allowed: string[], label: string): asserts entry is Record<string, unknown> {
  requireValue(isObject(entry), `${label} must be an object`)
  for (const key of Object.keys(entry)) requireValue(allowed.includes(key), `Unknown ${label} field: ${key}`)
}
export function validateLocaleRegistration(value: unknown): asserts value is LocaleRegistration {
  const path = (entry: unknown, label: string) => { if (entry !== undefined) requireValue(typeof entry === 'string' && entry.length > 0 && !entry.includes('\0'), `${label} must be a non-empty path`) }
  const list = (entry: unknown, label: string) => {
    if (entry !== undefined) requireValue(Array.isArray(entry) && entry.length > 0 && entry.every(code => typeof code === 'string' && localeCode.test(code)) && new Set(entry).size === entry.length, `${label} must be a non-empty array of unique locale codes`)
  }
  fields(value, ['locales', 'android', 'ios'], 'capacitor.localeRegistration')
  requireValue(value.android !== undefined || value.ios !== undefined, 'capacitor.localeRegistration needs android or ios')
  list(value.locales, 'capacitor.localeRegistration.locales')
  if (value.android !== undefined) {
    const android = value.android
    fields(android, ['manifest', 'localeConfig', 'locales'], 'capacitor.localeRegistration.android')
    path(android.manifest, 'Android manifest'); path(android.localeConfig, 'Android localeConfig')
    if (android.localeConfig !== undefined) requireValue(/(?:^|\/)res\/xml\/[a-z_][a-z0-9_]*\.xml$/u.test(android.localeConfig as string), 'Android localeConfig must be a res/xml/<name>.xml file')
    list(android.locales, 'capacitor.localeRegistration.android.locales')
  }
  if (value.ios !== undefined) {
    const ios = value.ios
    fields(ios, ['project', 'locales', 'targets'], 'capacitor.localeRegistration.ios')
    path(ios.project, 'Xcode project')
    if (ios.project !== undefined) requireValue(/\.xcodeproj$/u.test(ios.project as string), 'iOS project must be an .xcodeproj directory')
    list(ios.locales, 'capacitor.localeRegistration.ios.locales')
    requireValue(Array.isArray(ios.targets) && ios.targets.length > 0, 'capacitor.localeRegistration.ios.targets must name at least one Xcode target')
    const seen = new Set<string>()
    for (const target of ios.targets as unknown[]) {
      fields(target, ['name', 'directory', 'files', 'infoPlist'], 'localization target')
      requireValue(typeof target.name === 'string' && target.name.length > 0, 'Each localization target needs the Xcode target name')
      path(target.directory, 'Localization target directory')
      requireValue(Array.isArray(target.files) && target.files.length > 0 && target.files.every(file => typeof file === 'string' && stringsFile.test(file)) && new Set(target.files).size === target.files.length, 'Each localization target needs unique .strings or .stringsdict file names')
      if (target.infoPlist !== undefined && typeof target.infoPlist !== 'boolean') path(target.infoPlist, 'Localization target infoPlist')
      for (const file of target.files as string[]) {
        const key = `${target.name}/${target.directory ?? ''}/${file}`
        requireValue(!seen.has(key), 'A localization target file is configured twice'); seen.add(key)
      }
    }
  }
}

interface AndroidPlan { manifest: string; config: string; locales: string[] }
interface TargetPlan { name: string; directory: string; relative: string; files: string[]; infoPlist?: string }
interface IosPlan { project: string; locales: string[]; targets: TargetPlan[] }
export interface RegistrationPlan { root: string; android?: AndroidPlan; ios?: IosPlan }

export function registrationPlan(ctx: Context): RegistrationPlan {
  const capacitor = ctx.section('capacitor'), config = capacitor.localeRegistration
  requireValue(config, 'Configure capacitor.localeRegistration')
  validateLocaleRegistration(config)
  const root = ctx.moduleRoot('capacitor')
  const platform = ctx.choice('platform', ['android', 'ios', 'all'], 'all')
  requireValue(platform === 'all' || config[platform as 'android' | 'ios'], `Configure capacitor.localeRegistration.${platform}`)
  const locales = (own: string[] | undefined) => {
    const codes = own ?? config.locales ?? Object.keys(capacitor.locales?.locales ?? {})
    requireValue(codes.length > 0 && codes.every(code => localeCode.test(code)), 'List the app locales in capacitor.localeRegistration.locales or capacitor.locales')
    return codes
  }
  const plan: RegistrationPlan = { root }
  if (config.android && platform !== 'ios') plan.android = {
    manifest: outputPath(root, config.android.manifest ?? 'android/app/src/main/AndroidManifest.xml'),
    config: outputPath(root, config.android.localeConfig ?? 'android/app/src/main/res/xml/locales_config.xml'),
    locales: locales(config.android.locales),
  }
  if (config.ios && platform !== 'android') {
    const bundle = inside(root, config.ios.project ?? 'ios/App/App.xcodeproj')
    plan.ios = {
      project: outputPath(root, join(relative(root, bundle), 'project.pbxproj')),
      locales: locales(config.ios.locales),
      targets: config.ios.targets.map((target: LocaleRegistrationTarget) => {
        const directory = inside(root, target.directory ?? join(relative(root, dirname(bundle)), target.name))
        const list = target.infoPlist ?? target.name === 'App'
        return {
          name: target.name,
          directory,
          relative: relative(dirname(bundle), directory).split(sep).join('/'),
          files: target.files,
          ...(list ? { infoPlist: outputPath(root, typeof list === 'string' ? list : join(relative(root, directory), 'Info.plist')) } : {}),
        }
      }),
    }
  }
  return plan
}

type Reader = (path: string) => Promise<string | undefined>
const readText: Reader = async path => readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; return undefined })
const maskComments = (xml: string) => xml.replace(/<!--[\s\S]*?-->/gu, comment => comment.replace(/[^\r\n]/gu, ' '))
const applicationTag = /<application(?=[\s/>])(?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*\s*\/?>/u
const localeConfigAttribute = /\sandroid:localeConfig\s*=\s*(?:"([^"]*)"|'([^']*)')/u
const declaredLocales = (xml: string) => [...maskComments(xml).matchAll(/<locale\s[^>]*?android:name\s*=\s*(?:"([^"]*)"|'([^']*)')/gu)].map(match => match[1] ?? match[2]!)
const localeReference = (plan: AndroidPlan) => `@xml/${basename(plan.config, '.xml')}`

function differences(declared: string[], expected: string[], label: string): string[] {
  const missing = expected.filter(code => !declared.includes(code)), stale = declared.filter(code => !expected.includes(code))
  const repeated = declared.filter((code, index) => declared.indexOf(code) !== index)
  return [
    ...(missing.length ? [`${label} is missing ${missing.join(', ')}`] : []),
    ...(stale.length ? [`${label} still lists ${[...new Set(stale)].join(', ')}`] : []),
    ...(repeated.length ? [`${label} repeats ${[...new Set(repeated)].join(', ')}`] : []),
  ]
}

async function checkAndroid(root: string, plan: AndroidPlan, read: Reader): Promise<string[]> {
  const name = (path: string) => relative(root, path).split(sep).join('/')
  const problems: string[] = []
  const config = await read(plan.config)
  if (config === undefined) problems.push(`${name(plan.config)} does not exist`)
  else problems.push(...differences(declaredLocales(config), plan.locales, name(plan.config)))
  const manifest = await read(plan.manifest)
  if (manifest === undefined) return [...problems, `${name(plan.manifest)} does not exist`]
  const tag = applicationTag.exec(maskComments(manifest))?.[0]
  const attribute = tag ? localeConfigAttribute.exec(tag) : undefined
  if (!tag) problems.push(`${name(plan.manifest)} has no <application> element`)
  else if ((attribute?.[1] ?? attribute?.[2]) !== localeReference(plan)) problems.push(`${name(plan.manifest)} <application> needs android:localeConfig="${localeReference(plan)}"`)
  return problems
}

/** The top-level CFBundleLocalizations array of an XML property list. */
function bundleLocalizations(source: string): { rootEnd: number; key: boolean; start?: number; end?: number; values: string[] } {
  const masked = maskComments(source)
  let depth = 0, rootEnd = -1, pending = false, found = false, start: number | undefined, end: number | undefined
  for (const match of masked.matchAll(/<(\/?)(dict|array)\b[^>]*?(\/?)>|<key>([^<]*)<\/key>|<(?!\/)(?:string|integer|real|date|data|true|false)\b[^>]*>/gu)) {
    const [tag, closing, container, empty, key] = match
    if (key !== undefined) { if (depth === 1 && key === 'CFBundleLocalizations') { pending = true; found = true } continue }
    if (pending) {
      requireValue(container === 'array' && !closing, 'CFBundleLocalizations must be an array')
      start = match.index; pending = false
      if (empty) end = match.index + tag.length
    }
    if (!container || empty) continue
    if (!closing) { depth++; continue }
    depth--
    if (container === 'array' && depth === 1 && start !== undefined && end === undefined) end = match.index + tag.length
    if (depth === 0 && container === 'dict') rootEnd = match.index
  }
  requireValue(rootEnd >= 0 && (!found || end !== undefined), 'Info.plist must be an XML property list')
  const values = start === undefined ? [] : [...masked.slice(start, end).matchAll(/<string>([^<]*)<\/string>/gu)].map(match => match[1]!)
  return { rootEnd, key: found, ...(start === undefined ? {} : { start, end: end! }), values }
}

function xcodeProject(text: string) {
  const root = parsePbx(text), objects = dictAt(root, 'objects')
  requireValue(objects, 'The Xcode project has no objects')
  const get = (id: string | undefined): PbxDict | undefined => id ? dictAt(objects, id) : undefined
  const all = [...objects.entries.keys()].flatMap(id => { const object = get(id); return object ? [{ id, object }] : [] })
  const parents = new Map<string, string>()
  for (const { id, object } of all) for (const child of stringsAt(object, 'children')) parents.set(child, id)
  /** Location relative to the directory that holds the .xcodeproj; undefined for SDK or build-product references. */
  const location = (id: string, depth = 0): string | undefined => {
    const object = get(id)
    if (!object || depth > 32) return undefined
    const tree = stringAt(object, 'sourceTree'), own = stringAt(object, 'path') ?? ''
    let base = ''
    if (tree === '<group>') {
      const parent = parents.get(id)
      if (parent) { const found = location(parent, depth + 1); if (found === undefined) return undefined; base = found }
    } else if (tree !== 'SOURCE_ROOT') return undefined
    const joined = posix.normalize(posix.join(base, own))
    return joined === '.' ? '' : joined.replace(/\/$/u, '')
  }
  const project = get(stringAt(root, 'rootObject'))
  requireValue(project, 'The Xcode project has no root object')
  return { get, all, parents, location, project, has: (id: string) => objects.entries.has(id) }
}
type Xcode = ReturnType<typeof xcodeProject>

const under = (directory: string) => directory ? `${directory}/` : ''

/** Everything about one configured file in one target, shared by the check and the registration. */
function membership(xcode: Xcode, target: TargetPlan, file: string) {
  const native = xcode.all.find(({ object }) => stringAt(object, 'isa') === 'PBXNativeTarget' && stringAt(object, 'name') === target.name)
  if (!native) return undefined
  const prefix = under(target.relative)
  const synchronized = stringsAt(native.object, 'fileSystemSynchronizedGroups').find(id => { const path = xcode.location(id); return path !== undefined && (target.relative === path || target.relative.startsWith(under(path))) })
  const excluded = synchronized ? stringsAt(xcode.get(synchronized)!, 'exceptions').some(id => {
    const exception = xcode.get(id)
    return !!exception && stringAt(exception, 'target') === native.id && stringsAt(exception, 'membershipExceptions').some(path => path === file || path.endsWith(`/${file}`))
  }) : false
  const phaseId = stringsAt(native.object, 'buildPhases').find(id => { const phase = xcode.get(id); return !!phase && stringAt(phase, 'isa') === 'PBXResourcesBuildPhase' })
  const resources = phaseId ? stringsAt(xcode.get(phaseId)!, 'files').flatMap(id => { const build = xcode.get(id), ref = build && stringAt(build, 'fileRef'); return ref ? [ref] : [] }) : []
  const isVariant = (id: string) => {
    const object = xcode.get(id)
    if (!object || stringAt(object, 'isa') !== 'PBXVariantGroup' || (stringAt(object, 'name') ?? stringAt(object, 'path')) !== file) return false
    const children = stringsAt(object, 'children')
    return children.length ? children.some(child => xcode.location(child)?.startsWith(prefix)) : xcode.location(id) === target.relative
  }
  const localized = new RegExp(`^(?:[^/]+\\.lproj/)?${file.replaceAll('.', '\\.')}$`, 'u')
  const plain = resources.some(id => {
    const object = xcode.get(id), path = xcode.location(id)
    return !!object && stringAt(object, 'isa') === 'PBXFileReference' && path !== undefined && path.startsWith(prefix) && localized.test(path.slice(prefix.length))
  })
  const group = resources.find(isVariant)
  return { native, phaseId, group, plain, synchronized, excluded, isVariant }
}

/** The languages a variant group references, and any child that does not follow `<locale>.lproj/<file>`. */
function variants(xcode: Xcode, group: string, target: TargetPlan, file: string) {
  const prefix = under(target.relative)
  return stringsAt(xcode.get(group)!, 'children').map(id => {
    const path = xcode.location(id)
    const match = path?.startsWith(prefix) ? /^([^/]+)\.lproj\/([^/]+)$/u.exec(path.slice(prefix.length)) : null
    return { id, locale: match && match[2] === file ? match[1]! : undefined }
  })
}

async function checkIos(root: string, plan: IosPlan, read: Reader): Promise<string[]> {
  const name = (path: string) => relative(root, path).split(sep).join('/')
  const source = await read(plan.project)
  if (source === undefined) return [`${name(plan.project)} does not exist`]
  const xcode = xcodeProject(source.replaceAll('\r\n', '\n'))
  const problems: string[] = []
  const regions = stringsAt(xcode.project, 'knownRegions')
  const missingRegions = plan.locales.filter(code => !regions.includes(code))
  if (missingRegions.length) problems.push(`Xcode knownRegions is missing ${missingRegions.join(', ')}`)
  for (const target of plan.targets) {
    for (const file of target.files) {
      const label = `Xcode target ${target.name}: ${file}`
      const found = membership(xcode, target, file)
      if (!found) { problems.push(`Xcode target ${target.name} does not exist`); break }
      for (const code of plan.locales) {
        const path = join(target.directory, `${code}.lproj`, file)
        if (!existsSync(inside(root, path))) problems.push(`${name(path)} does not exist (generate it first, for example with rds capacitor locales)`)
      }
      if (found.synchronized) { if (found.excluded) problems.push(`${label} is excluded from the target by a synchronized-folder exception`); continue }
      if (found.plain) problems.push(`${label} is referenced directly instead of through a localized variant group`)
      if (!found.group) { problems.push(`${label} is not in the target's Copy Bundle Resources`); continue }
      const children = variants(xcode, found.group, target, file)
      if (children.some(child => child.locale === undefined)) problems.push(`${label} has an entry that is not <locale>.lproj/${file} inside the target directory`)
      problems.push(...differences(children.flatMap(child => child.locale && child.locale !== 'Base' ? [child.locale] : []), plan.locales, label))
    }
    if (target.infoPlist) {
      const plist = await read(target.infoPlist)
      if (plist === undefined) problems.push(`${name(target.infoPlist)} does not exist`)
      else {
        const list = bundleLocalizations(plist)
        problems.push(...differences(list.values, plan.locales, `${name(target.infoPlist)} CFBundleLocalizations`))
      }
    }
  }
  return [...new Set(problems)]
}

export async function localeProblems(plan: RegistrationPlan, read: Reader = readText): Promise<string[]> {
  return [
    ...(plan.android ? await checkAndroid(plan.root, plan.android, read) : []),
    ...(plan.ios ? await checkIos(plan.root, plan.ios, read) : []),
  ]
}

function androidChanges(plan: AndroidPlan, config: string | undefined, manifest: string): [string, string][] {
  const changes: [string, string][] = []
  const entries = (indent: string, eol: string) => plan.locales.map(code => `${indent}<locale android:name="${code}" />${eol}`).join('')
  if (config === undefined) changes.push([plan.config, `<?xml version="1.0" encoding="utf-8"?>\n<locale-config xmlns:android="http://schemas.android.com/apk/res/android">\n${entries('    ', '\n')}</locale-config>\n`])
  else if (differences(declaredLocales(config), plan.locales, '').length) {
    // Keep the file's own root element (it may carry android:defaultLocale); only the language list is replaced.
    const eol = config.includes('\r\n') ? '\r\n' : '\n', masked = maskComments(config)
    const open = /<locale-config\b[^>]*>/u.exec(masked), close = masked.lastIndexOf('</locale-config>')
    requireValue(open && !open[0].endsWith('/>') && close > open.index, 'Cannot update the existing Android locale config; it has no <locale-config> element')
    changes.push([plan.config, `${config.slice(0, open.index + open[0].length)}${eol}${entries('    ', eol)}${config.slice(close)}`])
  }
  const tag = applicationTag.exec(maskComments(manifest))
  requireValue(tag, 'AndroidManifest.xml has no <application> element')
  const attribute = localeConfigAttribute.exec(tag[0])
  const current = attribute?.[1] ?? attribute?.[2]
  requireValue(current === undefined || current === localeReference(plan), 'AndroidManifest.xml already points android:localeConfig somewhere else; configure that file or change it yourself')
  if (current === undefined) {
    const at = tag.index + '<application'.length
    const next = /^\r?\n[ \t]*/u.exec(manifest.slice(at))?.[0]
    changes.push([plan.manifest, `${manifest.slice(0, at)}${next ?? ' '}android:localeConfig="${localeReference(plan)}"${manifest.slice(at)}`])
  }
  return changes
}

function registerProject(source: string, plan: IosPlan): string {
  let text = source
  const objectId = (seed: string) => {
    const xcode = xcodeProject(text)
    for (let attempt = 0; ; attempt++) {
      const id = createHash('sha256').update(`rds-locale:${seed}:${attempt}`).digest('hex').slice(0, 24).toUpperCase()
      if (!xcode.has(id)) return id
    }
  }
  const append = (id: string, key: string, item: string) => {
    const object = xcodeProject(text).get(id)
    const array = object && arrayAt(object, key)
    requireValue(array, `The Xcode project has no ${key} list where one is expected`)
    text = appendItem(text, array, item)
  }
  for (const code of plan.locales) {
    const xcode = xcodeProject(text)
    if (stringsAt(xcode.project, 'knownRegions').includes(code)) continue
    const array = arrayAt(xcode.project, 'knownRegions')
    requireValue(array, 'The Xcode project has no knownRegions list')
    text = appendItem(text, array, pbxQuote(code))
  }
  for (const target of plan.targets) for (const file of target.files) {
    let xcode = xcodeProject(text), found = membership(xcode, target, file)
    requireValue(found, `Xcode target ${target.name} does not exist`)
    if (found.synchronized) continue
    requireValue(!found.plain, `${file} of ${target.name} is referenced directly; remove that reference in Xcode before registering localizations`)
    requireValue(found.phaseId, `Xcode target ${target.name} has no Copy Bundle Resources phase; add one in Xcode first`)
    let group = found.group
    if (!group) {
      const existing = xcode.all.find(({ id }) => found!.isVariant(id))?.id
      if (existing) group = existing
      else {
        const directory = xcode.all.find(({ id, object }) => stringAt(object, 'isa') === 'PBXGroup' && xcode.location(id) === target.relative)?.id
        requireValue(directory, `The Xcode project has no group for the ${target.name} directory; add the group in Xcode or configure the target's directory`)
        group = objectId(`${target.name}:${target.relative}:${file}`)
        text = addObject(text, 'PBXVariantGroup', `\t\t${group} /* ${file} */ = {\n\t\t\tisa = PBXVariantGroup;\n\t\t\tchildren = (\n\t\t\t);\n\t\t\tname = ${pbxQuote(file)};\n\t\t\tsourceTree = "<group>";\n\t\t};\n`)
        append(directory, 'children', `${group} /* ${file} */`)
      }
      const build = objectId(`${target.name}:${target.relative}:${file}:build`)
      text = addObject(text, 'PBXBuildFile', `\t\t${build} /* ${file} in Resources */ = {isa = PBXBuildFile; fileRef = ${group} /* ${file} */; };\n`)
      append(found.phaseId, 'files', `${build} /* ${file} in Resources */`)
    }
    // Drop languages the app no longer lists. Their .lproj files stay on disk.
    for (;;) {
      xcode = xcodeProject(text)
      const children = variants(xcode, group, target, file)
      requireValue(children.every(child => child.locale !== undefined), `${file} of ${target.name} has an entry outside the target directory; fix it in Xcode before registering`)
      const seen = new Set<string>()
      const stale = children.find(child => {
        const extra = child.locale !== 'Base' && (!plan.locales.includes(child.locale!) || seen.has(child.locale!))
        seen.add(child.locale!)
        return extra
      })
      if (!stale) break
      const item = arrayAt(xcode.get(group)!, 'children')!.items.find(entry => entry.type === 'string' && entry.value === stale.id)!
      text = removeSpan(text, item.start, item.end)
      if (text.split(stale.id).length === 2) {
        const entry = dictAt(parsePbx(text), 'objects')!.entries.get(stale.id)!
        text = removeSpan(text, entry.start, entry.end)
      }
    }
    for (const code of plan.locales) {
      xcode = xcodeProject(text)
      if (variants(xcode, group, target, file).some(child => child.locale === code)) continue
      const base = xcode.location(group)
      requireValue(base !== undefined, `Cannot resolve the location of ${file} in the Xcode project`)
      const path = posix.relative(`/${base}`, `/${under(target.relative)}${code}.lproj/${file}`)
      const reference = objectId(`${target.name}:${target.relative}:${file}:${code}`)
      const type = file.endsWith('.stringsdict') ? 'text.plist.stringsdict' : 'text.plist.strings'
      text = addObject(text, 'PBXFileReference', `\t\t${reference} /* ${code} */ = {isa = PBXFileReference; lastKnownFileType = ${type}; name = ${pbxQuote(code)}; path = ${pbxQuote(path)}; sourceTree = "<group>"; };\n`)
      append(group, 'children', `${reference} /* ${code} */`)
    }
  }
  return text
}

function registerPlist(source: string, locales: string[]): string {
  const list = bundleLocalizations(source)
  if (!differences(list.values, locales, '').length && list.key) return source
  const eol = source.includes('\r\n') ? '\r\n' : '\n'
  const array = (indent: string) => `<array>${eol}${locales.map(code => `${indent}\t<string>${code}</string>${eol}`).join('')}${indent}</array>`
  if (list.start !== undefined) {
    const indent = /(?:^|\n)([ \t]*)[^\n]*$/u.exec(source.slice(0, list.start))?.[1] ?? '\t'
    return source.slice(0, list.start) + array(indent) + source.slice(list.end!)
  }
  return `${source.slice(0, list.rootEnd)}\t<key>CFBundleLocalizations</key>${eol}\t${array('\t')}${eol}${source.slice(list.rootEnd)}`
}

/** The new content of every file that needs a change, verified as a whole before anything is returned. */
export async function localeChanges(plan: RegistrationPlan): Promise<Map<string, string>> {
  const changes = new Map<string, string>()
  const required = async (path: string) => {
    const text = await readText(path)
    requireValue(text !== undefined, `${relative(plan.root, path).split(sep).join('/')} does not exist; register-locales only updates existing native projects`)
    return text
  }
  if (plan.android) for (const [path, content] of androidChanges(plan.android, await readText(plan.android.config), await required(plan.android.manifest))) changes.set(path, content)
  if (plan.ios) {
    const source = await required(plan.ios.project)
    const eol = source.includes('\r\n') ? '\r\n' : '\n'
    const normalized = source.replaceAll('\r\n', '\n')
    const next = registerProject(normalized, plan.ios)
    if (next !== normalized) changes.set(plan.ios.project, next.replaceAll('\n', eol))
    for (const target of plan.ios.targets) {
      if (!target.infoPlist) continue
      const plist = changes.get(target.infoPlist) ?? await required(target.infoPlist)
      const updated = registerPlist(plist, plan.ios.locales)
      if (updated !== plist) changes.set(target.infoPlist, updated)
    }
  }
  const problems = await localeProblems(plan, async path => changes.get(path) ?? readText(path))
  requireValue(!problems.length, `Locale registration cannot be completed safely; nothing was written:\n  ${problems.join('\n  ')}`)
  return changes
}

function describe(plan: RegistrationPlan): string {
  return [
    ...(plan.android ? [`Android (${plan.android.locales.length} locales)`] : []),
    ...(plan.ios ? [`iOS targets ${[...new Set(plan.ios.targets.map(target => target.name))].join(', ')} (${plan.ios.locales.length} locales)`] : []),
  ].join(' and ')
}

export async function checkLocaleRegistration(ctx: Context) {
  const plan = registrationPlan(ctx)
  ctx.log(`${ctx.dryRun ? '[plan]' : '[rds]'} Check locale registration for ${describe(plan)}`)
  if (ctx.dryRun) return
  const problems = await localeProblems(plan)
  requireValue(!problems.length, `Locale registration is incomplete:\n  ${problems.join('\n  ')}`)
  ctx.log('[rds] Locale registration is complete')
}

export async function registerLocales(ctx: Context) {
  const plan = registrationPlan(ctx)
  ctx.log(`${ctx.dryRun ? '[plan]' : '[rds]'} Register locales for ${describe(plan)}`)
  if (ctx.dryRun) return
  const changes = await localeChanges(plan)
  for (const [path, content] of changes) {
    await writeChanged(outputPath(plan.root, path), content)
    ctx.log(`[rds] Updated ${relative(plan.root, path).split(sep).join('/')}`)
  }
  if (!changes.size) ctx.log('[rds] Locale registration was already complete')
}
