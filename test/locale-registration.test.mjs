import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { main } from '../dist/cli.js'
import { validateConfig } from '../dist/config.js'
import { locales as writeLocales } from '../dist/images.js'
import { parsePbx, dictAt, stringAt, stringsAt, arrayAt, appendItem } from '../dist/pbxproj.js'
import { fixture } from './helpers.mjs'

const PROJECT = 'ios/App/App.xcodeproj/project.pbxproj'
const MANIFEST = 'android/app/src/main/AndroidManifest.xml'
const LOCALE_CONFIG = 'android/app/src/main/res/xml/locales_config.xml'
const PLIST = 'ios/App/App/Info.plist'

const target = (id, name, phase, extra = '') => `\t\t${id} /* ${name} */ = {
\t\t\tisa = PBXNativeTarget;
\t\t\tbuildPhases = (
\t\t\t\t${phase} /* Resources */,
\t\t\t);
\t\t\tname = ${name};
${extra}\t\t\tproductType = "com.apple.product-type.application";
\t\t};
`
const phase = id => `\t\t${id} /* Resources */ = {
\t\t\tisa = PBXResourcesBuildPhase;
\t\t\tfiles = (
\t\t\t);
\t\t};
`
const group = (id, name, path, children = []) => `\t\t${id} /* ${name} */ = {
\t\t\tisa = PBXGroup;
\t\t\tchildren = (
${children.map(child => `\t\t\t\t${child},\n`).join('')}\t\t\t);
${path ? `\t\t\tpath = ${path};\n` : ''}\t\t\tsourceTree = "<group>";
\t\t};
`
/** A minimal project in Xcode's own formatting: an App target and a widget extension, no localizations yet. */
const project = ({ regions = ['en', 'Base'], extraTarget = '', extraObjects = '', rootChildren = [] } = {}) => `// !$*UTF8*$!
{
\tarchiveVersion = 1;
\tclasses = {
\t};
\tobjectVersion = 60;
\tobjects = {

/* Begin PBXFileReference section */
\t\tAA0000000000000000000001 /* Info.plist */ = {isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = Info.plist; sourceTree = "<group>"; };
/* End PBXFileReference section */

/* Begin PBXGroup section */
\t\tAA0000000000000000000010 = {
\t\t\tisa = PBXGroup;
\t\t\tchildren = (
\t\t\t\tAA0000000000000000000011 /* App */,
\t\t\t\tAA0000000000000000000012 /* Widget */,
${rootChildren.map(child => `\t\t\t\t${child},\n`).join('')}\t\t\t);
\t\t\tsourceTree = "<group>";
\t\t};
${group('AA0000000000000000000011', 'App', 'App', ['AA0000000000000000000001 /* Info.plist */'])}${group('AA0000000000000000000012', 'Widget', 'Widget')}/* End PBXGroup section */

/* Begin PBXNativeTarget section */
${target('AA0000000000000000000020', 'App', 'AA0000000000000000000030')}${target('AA0000000000000000000021', 'Widget', 'AA0000000000000000000031')}${extraTarget}/* End PBXNativeTarget section */

/* Begin PBXProject section */
\t\tAA0000000000000000000040 /* Project object */ = {
\t\t\tisa = PBXProject;
\t\t\tdevelopmentRegion = en;
\t\t\tknownRegions = (
${regions.map(region => `\t\t\t\t${region},\n`).join('')}\t\t\t);
\t\t\tmainGroup = AA0000000000000000000010;
\t\t};
/* End PBXProject section */

/* Begin PBXResourcesBuildPhase section */
${phase('AA0000000000000000000030')}${phase('AA0000000000000000000031')}/* End PBXResourcesBuildPhase section */
${extraObjects}\t};
\trootObject = AA0000000000000000000040 /* Project object */;
}
`
const manifest = '<?xml version="1.0" encoding="utf-8"?>\n<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n    <!-- <application android:localeConfig="@xml/commented_out"> -->\n    <application\n        android:label="Example">\n    </application>\n</manifest>\n'
const plist = '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n\t<key>CFBundleDevelopmentRegion</key>\n\t<string>en</string>\n\t<key>NSExtension</key>\n\t<dict>\n\t\t<key>CFBundleLocalizations</key>\n\t\t<array>\n\t\t\t<string>nested</string>\n\t\t</array>\n\t</dict>\n</dict>\n</plist>\n'

const codes = ['en', 'es', 'pt-BR']
const config = {
  version: 1,
  capacitor: {
    locales: {
      defaultLocale: 'en',
      locales: Object.fromEntries(codes.map(code => [code, { title: `Title ${code}` }])),
      targets: [
        { format: 'apple', directory: 'ios/App/App', file: 'InfoPlist.strings', keys: { CFBundleDisplayName: 'title' } },
        { format: 'apple', directory: 'ios/App/App' },
        { format: 'apple', directory: 'ios/App/Widget' },
      ],
    },
    localeRegistration: {
      android: {},
      ios: { targets: [{ name: 'App', files: ['InfoPlist.strings', 'Localizable.strings'] }, { name: 'Widget', files: ['Localizable.strings'] }] },
    },
  },
}

async function native({ config: used = config, pbx = project(), crlf = false, strings = true } = {}) {
  const f = await fixture(used)
  const convert = text => crlf ? text.replaceAll('\n', '\r\n') : text
  await f.file('reusable-dev-scripts.config.json', JSON.stringify(used))
  await f.file(PROJECT, convert(pbx))
  await f.file(MANIFEST, convert(manifest))
  await f.file(PLIST, convert(plist))
  if (strings) await writeLocales(f.ctx)
  const logs = []
  const run = (...args) => main([...args, '--cwd', f.root], () => { throw new Error('No process expected') }, line => logs.push(line))
  const read = path => readFile(join(f.root, path), 'utf8')
  return { ...f, logs, run, read }
}
const snapshot = async f => Promise.all([PROJECT, MANIFEST, PLIST].map(f.read))
const failure = async promise => promise.then(() => assert.fail('Expected the command to fail'), error => error.message)

function objectsOf(text) {
  const objects = dictAt(parsePbx(text), 'objects')
  return [...objects.entries.keys()].map(id => ({ id, object: dictAt(objects, id) }))
}

test('check-locales reports every missing registration and changes nothing', async () => {
  const f = await native()
  const before = await snapshot(f)
  const message = await failure(f.run('capacitor', 'check-locales'))
  assert.match(message, /locales_config\.xml does not exist/u)
  assert.match(message, /needs android:localeConfig="@xml\/locales_config"/u)
  assert.match(message, /knownRegions is missing es, pt-BR/u)
  assert.match(message, /Xcode target App: InfoPlist\.strings is not in the target's Copy Bundle Resources/u)
  assert.match(message, /Xcode target Widget: Localizable\.strings is not in the target's Copy Bundle Resources/u)
  assert.match(message, /App\/Info\.plist CFBundleLocalizations is missing en, es, pt-BR/u)
  assert.doesNotMatch(message, /nested/u)
  assert.deepEqual(await snapshot(f), before)
})

test('register-locales completes the standard Android and Xcode declarations once and then does nothing', async () => {
  const f = await native()
  await f.run('capacitor', 'register-locales')
  await f.run('capacitor', 'check-locales')
  const [pbx, androidManifest, info] = await snapshot(f)
  assert.match(androidManifest, /<application\n        android:localeConfig="@xml\/locales_config"\n        android:label="Example">/u)
  assert.match(androidManifest, /<!-- <application android:localeConfig="@xml\/commented_out"> -->/u)
  assert.match(await f.read(LOCALE_CONFIG), /<locale android:name="en" \/>\n    <locale android:name="es" \/>\n    <locale android:name="pt-BR" \/>/u)
  assert.match(info, /\t<key>CFBundleLocalizations<\/key>\n\t<array>\n\t\t<string>en<\/string>\n\t\t<string>es<\/string>\n\t\t<string>pt-BR<\/string>\n\t<\/array>\n<\/dict>\n<\/plist>\n$/u)
  assert.match(info, /<string>nested<\/string>/u)
  assert.match(pbx, /name = "pt-BR"; path = "pt-BR\.lproj\/InfoPlist\.strings"; sourceTree = "<group>";/u)
  assert.match(pbx, /\/\* Begin PBXVariantGroup section \*\/[\s\S]*\/\* End PBXVariantGroup section \*\//u)
  assert.match(pbx, /\/\* Begin PBXBuildFile section \*\/[\s\S]*\/\* End PBXBuildFile section \*\//u)
  const objects = objectsOf(pbx), of = isa => objects.filter(({ object }) => stringAt(object, 'isa') === isa)
  assert.equal(of('PBXVariantGroup').length, 3)
  assert.equal(of('PBXBuildFile').length, 3)
  assert.equal(of('PBXFileReference').length, 1 + 3 * codes.length)
  for (const { object } of of('PBXVariantGroup')) assert.equal(stringsAt(object, 'children').length, codes.length)
  assert.equal(stringsAt(objects.find(({ id }) => id === 'AA0000000000000000000030').object, 'files').length, 2)
  assert.equal(stringsAt(objects.find(({ id }) => id === 'AA0000000000000000000031').object, 'files').length, 1)
  assert.deepEqual(stringsAt(objects.find(({ id }) => id === 'AA0000000000000000000040').object, 'knownRegions'), ['en', 'Base', 'es', 'pt-BR'])

  const registered = await snapshot(f)
  await f.run('capacitor', 'register-locales')
  assert.deepEqual(await snapshot(f), registered)
  assert.match(f.logs.join('\n'), /already complete/u)

  // Registration is deterministic, so two checkouts produce the same project file.
  const twin = await native()
  await twin.run('capacitor', 'register-locales')
  assert.equal(await twin.read(PROJECT), pbx)
})

test('removing a language makes the registration stale and register-locales prunes it without deleting files', async () => {
  const f = await native()
  await f.run('capacitor', 'register-locales')
  const reduced = structuredClone(config)
  reduced.capacitor.localeRegistration.locales = ['en', 'es']
  await f.file('reusable-dev-scripts.config.json', JSON.stringify(reduced))
  const message = await failure(f.run('capacitor', 'check-locales'))
  assert.match(message, /Localizable\.strings still lists pt-BR/u)
  assert.match(message, /locales_config\.xml still lists pt-BR/u)
  assert.match(message, /CFBundleLocalizations still lists pt-BR/u)
  await f.run('capacitor', 'register-locales')
  await f.run('capacitor', 'check-locales')
  const pbx = await f.read(PROJECT)
  assert.doesNotMatch(pbx, /pt-BR\.lproj/u)
  assert.equal(objectsOf(pbx).filter(({ object }) => stringAt(object, 'isa') === 'PBXFileReference').length, 1 + 3 * 2)
  assert.match(await f.read('ios/App/App/pt-BR.lproj/InfoPlist.strings'), /Title pt-BR/u)
})

test('CRLF native files keep their line endings and --platform limits what is touched', async () => {
  const f = await native({ crlf: true })
  const before = await snapshot(f)
  await f.run('capacitor', 'register-locales', '--platform', 'android')
  const [pbx, androidManifest, info] = await snapshot(f)
  assert.deepEqual([pbx, info], [before[0], before[2]])
  assert.match(androidManifest, /<application\r\n        android:localeConfig/u)
  await f.run('capacitor', 'check-locales', '--platform', 'android')
  await assert.rejects(f.run('capacitor', 'check-locales'), /knownRegions/u)
  await f.run('capacitor', 'register-locales', '--platform', 'ios')
  await f.run('capacitor', 'check-locales')
  for (const text of await snapshot(f)) assert.doesNotMatch(text, /(?<!\r)\n/u)
})

test('an existing Android locale config keeps its root attributes', async () => {
  const f = await native()
  await f.file(LOCALE_CONFIG, '<?xml version="1.0" encoding="utf-8"?>\n<locale-config xmlns:android="http://schemas.android.com/apk/res/android"\n    android:defaultLocale="en">\n    <locale android:name="en"/>\n</locale-config>\n')
  await f.run('capacitor', 'register-locales', '--platform', 'android')
  const updated = await f.read(LOCALE_CONFIG)
  assert.match(updated, /android:defaultLocale="en">/u)
  assert.equal(updated.match(/<locale android:name/gu).length, 3)
})

test('register-locales writes nothing when any part of the project cannot be registered safely', async () => {
  const cases = [
    [{ strings: false }, /InfoPlist\.strings does not exist \(generate it first/u],
    [{ pbx: project().replace('/* End PBXNativeTarget section */', '').replace(/\t\tAA0000000000000000000021 \/\* Widget \*\/ = \{[\s\S]*?\n\t\t\};\n/u, '/* End PBXNativeTarget section */\n') }, /target Widget does not exist/u],
    [{ pbx: project().replace('\t\t\tpath = Widget;\n', '\t\t\tpath = Elsewhere;\n') }, /no group for the Widget directory/u],
    [{ pbx: project().replace('\t\t\t\tAA0000000000000000000031 /* Resources */,\n', '') }, /no Copy Bundle Resources phase/u],
  ]
  for (const [options, expected] of cases) {
    const f = await native(options)
    const before = await snapshot(f)
    await assert.rejects(f.run('capacitor', 'register-locales'), expected)
    assert.deepEqual(await snapshot(f), before)
    await assert.rejects(f.read(LOCALE_CONFIG), /ENOENT/u)
  }
  const other = await native()
  await other.file(MANIFEST, manifest.replace('android:label', 'android:localeConfig="@xml/mine"\n        android:label'))
  const before = await snapshot(other)
  await assert.rejects(other.run('capacitor', 'register-locales'), /somewhere else/u)
  assert.deepEqual(await snapshot(other), before)
})

test('a synchronized folder needs only the project languages, and exclusions are reported', async () => {
  const single = { version: 1, capacitor: { localeRegistration: { locales: ['en', 'es'], ios: { targets: [{ name: 'Share', files: ['Localizable.strings'], infoPlist: false }] } } } }
  const options = exception => ({
    config: single,
    strings: false,
    pbx: project({
      rootChildren: ['AA0000000000000000000050 /* Share */'],
      extraTarget: target('AA0000000000000000000022', 'Share', 'AA0000000000000000000030', '\t\t\tfileSystemSynchronizedGroups = (\n\t\t\t\tAA0000000000000000000050 /* Share */,\n\t\t\t);\n'),
      extraObjects: `\n/* Begin PBXFileSystemSynchronizedRootGroup section */\n\t\tAA0000000000000000000050 /* Share */ = {isa = PBXFileSystemSynchronizedRootGroup; ${exception ? 'exceptions = (AA0000000000000000000051, ); ' : ''}path = Share; sourceTree = "<group>"; };\n\t\tAA0000000000000000000051 = {isa = PBXFileSystemSynchronizedBuildFileExceptionSet; membershipExceptions = (es.lproj/Localizable.strings, ); target = AA0000000000000000000022; };\n/* End PBXFileSystemSynchronizedRootGroup section */\n`,
    }),
  })
  const f = await native(options(false))
  for (const code of ['en', 'es']) await f.file(`ios/App/Share/${code}.lproj/Localizable.strings`, '')
  await assert.rejects(f.run('capacitor', 'check-locales'), /knownRegions is missing es/u)
  await f.run('capacitor', 'register-locales')
  assert.doesNotMatch(await f.read(PROJECT), /PBXVariantGroup/u)

  const excluded = await native(options(true))
  for (const code of ['en', 'es']) await excluded.file(`ios/App/Share/${code}.lproj/Localizable.strings`, '')
  await assert.rejects(excluded.run('capacitor', 'register-locales'), /excluded from the target/u)
})

test('a directly referenced strings file is reported instead of duplicated', async () => {
  const pbx = project()
    .replace('/* End PBXFileReference section */', '\t\tAA0000000000000000000060 /* Localizable.strings */ = {isa = PBXFileReference; path = en.lproj/Localizable.strings; sourceTree = "<group>"; };\n/* End PBXFileReference section */')
    .replace('\t\t\tpath = Widget;', '\t\t\tpath = Widget;')
    .replace(/(AA0000000000000000000012 \/\* Widget \*\/ = \{\n\t\t\tisa = PBXGroup;\n\t\t\tchildren = \(\n)/u, '$1\t\t\t\tAA0000000000000000000060,\n')
    .replace('/* Begin PBXResourcesBuildPhase section */\n', '\t\tAA0000000000000000000061 = {isa = PBXBuildFile; fileRef = AA0000000000000000000060; };\n/* Begin PBXResourcesBuildPhase section */\n')
    .replace(/(AA0000000000000000000031 \/\* Resources \*\/ = \{\n\t\t\tisa = PBXResourcesBuildPhase;\n\t\t\tfiles = \(\n)/u, '$1\t\t\t\tAA0000000000000000000061,\n')
  const f = await native({ pbx })
  await assert.rejects(f.run('capacitor', 'register-locales'), /referenced directly/u)
  assert.equal(await f.read(PROJECT), pbx)
})

test('registration configuration is explicit and validated', () => {
  const registration = value => () => validateConfig({ version: 1, capacitor: { localeRegistration: value } })
  assert.throws(registration({}), /android or ios/u)
  assert.throws(registration({ ios: {} }), /at least one Xcode target/u)
  assert.throws(registration({ ios: { targets: [{ name: 'App' }] } }), /\.strings/u)
  assert.throws(registration({ ios: { targets: [{ name: 'App', files: ['../x.strings'] }] } }), /\.strings/u)
  assert.throws(registration({ android: { localeConfig: 'res/values/x.xml' } }), /res\/xml/u)
  assert.throws(registration({ android: {}, locales: ['en', 'en'] }), /unique/u)
  assert.throws(registration({ android: { enabled: true } }), /Unknown/u)
  assert.throws(() => validateConfig({ version: 1, capacitor: { localeRegistrations: {} } }), /Unknown capacitor field/u)
})

test('registration paths stay inside the Capacitor project', async () => {
  const escaping = { version: 1, capacitor: { localeRegistration: { locales: ['en'], android: { manifest: '../AndroidManifest.xml' } } } }
  const f = await native({ config: escaping, strings: false })
  await assert.rejects(f.run('capacitor', 'check-locales'), /inside its project/u)
})

test('Apple locale targets can write InfoPlist.strings, and only the known file names', async () => {
  const f = await native()
  assert.match(await f.read('ios/App/App/es.lproj/InfoPlist.strings'), /"CFBundleDisplayName" = "Title es";/u)
  assert.match(await f.read('ios/App/App/es.lproj/Localizable.strings'), /"title" = "Title es";/u)
  const bad = await fixture({ version: 1, capacitor: { locales: { defaultLocale: 'en', locales: { en: { a: 'b' } }, targets: [{ format: 'apple', directory: 'ios', file: '../Info.plist' }] } } })
  await assert.rejects(writeLocales(bad.ctx), /Localizable\.strings or InfoPlist\.strings/u)
})

test('project edits tolerate a list without a trailing comma', () => {
  const text = '{\n\titems = (\n\t\tone /* One */\n\t);\n}\n'
  const result = appendItem(text, arrayAt(parsePbx(text), 'items'), 'two')
  assert.equal(result, '{\n\titems = (\n\t\tone /* One */,\n\t\ttwo,\n\t);\n}\n')
  const inline = '{ items = (one); }'
  assert.deepEqual(stringsAt(parsePbx(appendItem(inline, arrayAt(parsePbx(inline), 'items'), 'two')), 'items'), ['one', 'two'])
  assert.throws(() => parsePbx('{ a = ( b; }'), /Cannot parse/u)
})

test('bundleLocalizations lets CFBundleLocalizations list more languages than the string files', async () => {
  const web = [...codes, 'de', 'fr']
  const withBundle = bundleLocalizations => {
    const used = structuredClone(config)
    used.capacitor.localeRegistration.ios.targets[0].bundleLocalizations = bundleLocalizations
    return used
  }
  const f = await native({ config: withBundle(web) })
  assert.match(await failure(f.run('capacitor', 'check-locales')), /App\/Info\.plist CFBundleLocalizations is missing en, es, pt-BR, de, fr/u)
  await f.run('capacitor', 'register-locales')
  await f.run('capacitor', 'check-locales')
  const info = await f.read(PLIST)
  assert.match(info, /<array>\n\t\t<string>en<\/string>\n\t\t<string>es<\/string>\n\t\t<string>pt-BR<\/string>\n\t\t<string>de<\/string>\n\t\t<string>fr<\/string>\n\t<\/array>/u)
  // The extra languages are declared in the plist only: Xcode gets no regions or variants without string files.
  const xcode = await f.read(PROJECT)
  assert.doesNotMatch(xcode, /\bfr\b|fr\.lproj/u)
  const before = await snapshot(f)
  await f.run('capacitor', 'register-locales')
  assert.deepEqual(await snapshot(f), before)

  // The explicit list is exact too: a plist with only the native languages, or with an extra one, is reported.
  await f.file(PLIST, info.replace('\t\t<string>fr</string>\n', '\t\t<string>it</string>\n'))
  const message = await failure(f.run('capacitor', 'check-locales'))
  assert.match(message, /CFBundleLocalizations is missing fr/u)
  assert.match(message, /CFBundleLocalizations still lists it/u)
})

test('bundleLocalizations must cover the iOS locales and belong to a checked Info.plist', async () => {
  const short = structuredClone(config)
  short.capacitor.localeRegistration.ios.targets[0].bundleLocalizations = ['en', 'fr']
  const f = await native({ config: short })
  const before = await snapshot(f)
  for (const command of ['check-locales', 'register-locales']) await assert.rejects(f.run('capacitor', command), /must include every iOS locale; add es, pt-BR/u)
  assert.deepEqual(await snapshot(f), before)

  const target = value => () => validateConfig({ version: 1, capacitor: { localeRegistration: { ios: { targets: [{ files: ['Localizable.strings'], ...value }] } } } })
  assert.throws(target({ name: 'Widget', bundleLocalizations: ['en'] }), /needs an Info\.plist/u)
  assert.throws(target({ name: 'App', infoPlist: false, bundleLocalizations: ['en'] }), /needs an Info\.plist/u)
  assert.throws(target({ name: 'App', bundleLocalizations: [] }), /unique locale codes/u)
  assert.throws(target({ name: 'App', bundleLocalizations: ['en', 'en'] }), /unique locale codes/u)
  assert.doesNotThrow(target({ name: 'Widget', infoPlist: true, bundleLocalizations: ['en'] }))
  assert.doesNotThrow(target({ name: 'App', bundleLocalizations: ['en'] }))
})
