import type { MediaSpec } from './media-catalog.js'

const escapeHtml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

export const kitCss = `/* Shared by every design under base/. Edit freely: rds only reads the page that results. */
:root { --ink: #14161a; --paper: #f4f5f7; --accent: #2f6bff; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
html, body { margin: 0; background: #d9dce1; }
/* A slide is one image of the final set. rds photographs each [data-slide] element at exactly --w by --h. */
.slide { position: relative; box-sizing: border-box; width: var(--w); height: var(--h); overflow: hidden; background: var(--paper); color: var(--ink); }
.slide + .slide { margin-top: 24px; }
.slide .placeholder { position: absolute; inset: 0; display: grid; place-content: center; gap: 0.4em; text-align: center; font-size: calc(var(--h) / 22); border: calc(var(--h) / 200) dashed rgba(20, 22, 26, 0.35); margin: calc(var(--h) / 40); }
.slide .placeholder small { font-size: 0.5em; opacity: 0.6; }
[dir="rtl"] .slide { direction: rtl; }
`

export const kitJs = (defaultLanguage: string) => `// Helpers every design can import. Nothing here is required by rds, except that a page may set <body data-ready="1"> when it is finished.
const query = new URLSearchParams(location.search)
export const lang = query.get('lang') ?? ${JSON.stringify(defaultLanguage)}
const rtl = ['ar', 'ur', 'he', 'fa']
document.documentElement.lang = lang
document.documentElement.dir = rtl.includes(lang.split('-')[0]) ? 'rtl' : 'ltr'

/** The words for this language, from ../copy/<lang>.json, falling back to the default language's file. */
export async function copy() {
  for (const code of [lang, ${JSON.stringify(defaultLanguage)}]) {
    const response = await fetch(new URL('../copy/' + code + '.json', import.meta.url))
    if (response.ok) return response.json()
  }
  return {}
}
/** The URL of a captured app screen for this language, or the default language's when it has none. */
export const capture = (scene) => new URL('../captures/' + lang + '/' + scene + '.png', import.meta.url).href
export const ready = () => { document.body.dataset.ready = '1' }
`

export function designHtml(spec: MediaSpec, size: [number, number], defaultLanguage: string): string {
  const slides = spec.max > 1 ? Math.max(spec.min, Math.min(3, spec.max)) : 1
  const note = [spec.note, spec.sources.length === 1 && spec.sources[0] === 'capture' ? 'Store rule: screenshots of the app itself.' : ''].filter(Boolean).join(' ')
  return `<!doctype html>
<html lang="${escapeHtml(defaultLanguage)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(spec.label)}</title>
  <link rel="stylesheet" href="../shared/kit.css">
  <style>:root { --w: ${size[0]}px; --h: ${size[1]}px; }</style>
</head>
<body data-ready="0" data-asset="${escapeHtml(spec.id)}">
  <!-- ${escapeHtml(spec.label)}: ${size[0]}×${size[1]} px${spec.max > 1 ? `, ${spec.min}–${spec.max} images` : ''}. ${escapeHtml(note)}
       Every <section data-slide> becomes one image. Words come from ../copy/<lang>.json. -->
${Array.from({ length: slides }, (_, index) => `  <section class="slide" data-slide>
    <div class="placeholder"><strong data-t="title">Title ${index + 1}</strong><span data-t="subtitle">Subtitle</span><small>${escapeHtml(spec.label)} · ${size[0]}×${size[1]}</small></div>
  </section>`).join('\n')}
  <script type="module">
    import { copy, ready } from '../shared/kit.js'
    const words = await copy()
    document.querySelectorAll('[data-t]').forEach((node) => { node.textContent = words[node.dataset.t] ?? node.textContent })
    ready()
  </script>
</body>
</html>
`
}
export const copyJson = (): string => JSON.stringify({ title: 'Your headline', subtitle: 'One line that says why' }, null, 2) + '\n'
export const iconSvg = (size: [number, number]): string => `<svg xmlns="http://www.w3.org/2000/svg" width="${size[0]}" height="${size[1]}" viewBox="0 0 ${size[0]} ${size[1]}"><rect width="100%" height="100%" fill="#2f6bff"/><circle cx="50%" cy="50%" r="${Math.min(size[0], size[1]) / 4}" fill="#fff"/></svg>\n`
export const captureModuleJs = `// Drives your running app for \`rds media capture\`. This file is project code: it runs with your permissions.
// rds opens one browser context per scene and language, then photographs the page you leave behind.

/** Optional. Runs before the page opens: mock the network, seed storage, add init scripts. */
export async function prepare({ context, locale, baseUrl }) {
  // await context.route('https://api.example.com/**', (route) => route.fulfill({ json: {} }))
}

/** Open the scene and wait until it is ready to be photographed. */
export async function scene({ page, scene, locale, baseUrl }) {
  await page.goto(\`\${baseUrl}/?lang=\${locale}\`)
  // await page.getByRole('button', { name: 'Settings' }).click()
  await page.waitForLoadState('networkidle')
}
`
