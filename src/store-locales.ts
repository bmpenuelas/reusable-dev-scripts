import { requireValue } from './runtime.js'

/** One configured language: the app's own code and the folder names Google Play and the App Store use for it. */
export interface StoreLocale { app: string; android: string; ios: string }
/**
 * Google Play and App Store folder names for common app languages, keyed by the language's base code.
 * Every pair is accepted by the fastlane versions the shared lanes pin (supply and deliver). Where a store distinguishes regions the
 * most widely used one is chosen: Spanish is es-ES, Portuguese pt-BR, Chinese is Simplified (zh-CN / zh-Hans). Override a language with
 * `overrides` or write the `{ app, android, ios }` entry yourself when you need another region.
 */
const table: Record<string, readonly [android: string, ios: string]> = {
  en: ['en-US', 'en-US'], es: ['es-ES', 'es-ES'], fr: ['fr-FR', 'fr-FR'], de: ['de-DE', 'de-DE'], pt: ['pt-BR', 'pt-BR'], it: ['it-IT', 'it'], nl: ['nl-NL', 'nl-NL'],
  ru: ['ru-RU', 'ru'], pl: ['pl-PL', 'pl'], tr: ['tr-TR', 'tr'], ja: ['ja-JP', 'ja'], ko: ['ko-KR', 'ko'], zh: ['zh-CN', 'zh-Hans'], hi: ['hi-IN', 'hi'], ar: ['ar', 'ar-SA'],
  bn: ['bn-BD', 'bn-BD'], id: ['id', 'id'], th: ['th', 'th'], vi: ['vi', 'vi'], sv: ['sv-SE', 'sv'], da: ['da-DK', 'da'], fi: ['fi-FI', 'fi'], no: ['no-NO', 'no'],
  cs: ['cs-CZ', 'cs'], el: ['el-GR', 'el'], hu: ['hu-HU', 'hu'], ro: ['ro', 'ro'], uk: ['uk', 'uk'], he: ['iw-IL', 'he'], ms: ['ms', 'ms'], ca: ['ca', 'ca'], hr: ['hr', 'hr'], sk: ['sk', 'sk']
}
/** Only the base languages the table knows, for documentation and tests. */
export const storeLocaleLanguages: readonly string[] = Object.keys(table)
/**
 * `store.locales` entries for a list of app language codes (`'en'`, `'pt'`, `'zh-Hans'`, ...). Only the base language matters, so a
 * Brazilian `pt-BR` and a plain `pt` both map to pt-BR. Use `overrides` for a different region or a language the table lacks.
 */
export function storeLocales(codes: readonly string[], overrides: Record<string, { android?: string; ios?: string }> = {}): StoreLocale[] {
  requireValue(Array.isArray(codes) && codes.length > 0 && codes.every(code => typeof code === 'string' && /^[a-zA-Z]{2,3}(?:[-_][a-zA-Z0-9]{2,8})*$/u.test(code)), 'storeLocales needs a non-empty list of language codes')
  return codes.map(code => {
    const base = code.split(/[-_]/u)[0]!.toLowerCase(), override = overrides[code]
    // Traditional Chinese must never silently become the Simplified folders.
    const entry = base === 'zh' && /[-_](?:hant|tw|hk|mo)/iu.test(code) ? undefined : table[base]
    requireValue(entry || (override?.android && override.ios), `No store folders are known for language ${code}: pass overrides for it or write its { app, android, ios } entry`)
    return { app: code, android: override?.android ?? entry![0], ios: override?.ios ?? entry![1] }
  })
}
