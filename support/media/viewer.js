// The media viewer. Plain browser code, no build step. It only ever talks to the server that delivered it.
const $ = (selector, root = document) => root.querySelector(selector)
const el = (tag, props = {}, ...children) => {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(props)) { if (key === 'class') node.className = value; else if (key.startsWith('on')) node.addEventListener(key.slice(2), value); else if (value !== undefined) node.setAttribute(key, value) }
  node.append(...children.flat().filter((child) => child !== null && child !== undefined && child !== false))
  return node
}
const get = async (path) => (await fetch(path)).json()
const query = (params) => new URLSearchParams(params).toString()
const mb = (bytes) => (bytes / 2 ** 20).toFixed(2) + ' MB'

let state = await get('/_rds/api/state')
const saved = new URLSearchParams(location.hash.slice(1))
const MODES = ['design', 'listing', 'final', 'languages']
const ui = { asset: saved.get('asset') ?? state.assets[0].id, locale: saved.get('locale') ?? state.default, mode: saved.get('mode') ?? 'design', guides: true, dark: matchMedia('(prefers-color-scheme: dark)').matches, zoom: { design: 1, final: 1, listing: 1, languages: 1 } }
if (!state.assets.some((asset) => asset.id === ui.asset)) ui.asset = state.assets[0].id
if (!state.locales.includes(ui.locale)) ui.locale = state.default
if (!MODES.includes(ui.mode)) ui.mode = 'design'
const current = () => state.assets.find((asset) => asset.id === ui.asset)
const renders = new Map()
/** Live render of an asset (the same pipeline as `rds media render`), cached until a file changes. */
const render = (asset, locale) => {
  const key = `${state.version}:${asset}:${locale}`
  if (!renders.has(key)) renders.set(key, get('/_rds/api/render?' + query({ asset, locale })))
  return renders.get(key)
}
/** Image URLs for an asset: the live render when it works, else the files already rendered to disk. */
async function images(id, locale) {
  const asset = state.assets.find((item) => item.id === id)
  if (!asset) return { urls: [], note: 'not enabled' }
  const result = await render(id, locale)
  if (result.images) return { urls: result.images.map((_, index) => '/_rds/api/shot?' + query({ asset: id, locale, i: index, v: state.version })), meta: result.images, warnings: result.warnings, live: true }
  const count = asset.finals[asset.localized ? locale : state.default] ?? 0
  const urls = Array.from({ length: count }, (_, index) => '/_rds/api/final?' + query({ asset: id, locale, i: index }))
  return { urls, note: result.missing ? 'no design yet' : result.error, live: false }
}

function syncHash() { location.hash = query({ asset: ui.asset, locale: ui.locale, mode: ui.mode }) }
function chrome() {
  document.documentElement.dataset.theme = ui.dark ? 'dark' : 'light'
  const select = $('#asset'); select.replaceChildren()
  for (const platform of [...new Set(state.assets.map((asset) => asset.platform))]) select.append(el('optgroup', { label: platform }, state.assets.filter((asset) => asset.platform === platform).map((asset) => el('option', { value: asset.id, ...(asset.id === ui.asset ? { selected: '' } : {}) }, asset.label))))
  const locale = $('#locale'); locale.replaceChildren(...state.locales.map((code) => el('option', { value: code, ...(code === ui.locale ? { selected: '' } : {}) }, code)))
  // Languages shows every language at once, so the language menu has nothing to choose there.
  locale.disabled = ui.mode === 'languages'
  for (const button of document.querySelectorAll('.modes button')) button.setAttribute('aria-pressed', String(button.dataset.mode === ui.mode))
  const zoom = ui.zoom[ui.mode]
  $('#zoom-level').textContent = ui.mode === 'listing' ? `${Math.round(zoom * 100)}%` : zoom === 1 ? 'Fit' : `Fit × ${zoom}`
  const nav = $('#assets'); nav.replaceChildren()
  for (const platform of [...new Set(state.assets.map((asset) => asset.platform))]) {
    nav.append(el('h4', {}, platform))
    for (const asset of state.assets.filter((item) => item.platform === platform)) {
      const count = asset.finals[asset.localized ? ui.locale : state.default] ?? 0
      nav.append(el('button', { 'aria-current': String(asset.id === ui.asset), onclick: () => { ui.asset = asset.id; go() } }, el('span', { class: `dot ${count >= asset.min ? 'ok' : asset.required ? 'todo' : ''}` }), asset.label.replace(/^(Google Play|App Store|Mac App Store|Microsoft Store) /, '')))
    }
  }
}
function specPanel() {
  const asset = current(), where = asset.localized ? ui.locale : state.default
  const size = asset.range ? `${asset.size[0]}×${asset.size[1]} (any size the store accepts)` : asset.sizes && asset.sizes.length > 1 ? `${asset.size[0]}×${asset.size[1]} (or another of ${asset.sizes.length})` : `${asset.size[0]}×${asset.size[1]}`
  $('#spec').replaceChildren(...[
    el('h3', {}, asset.label),
    el('dl', {}, ...[['Size', size], ['Images', asset.min === asset.max ? asset.max : `${asset.min}–${asset.max}`], ['Format', `${asset.format.toUpperCase()}, ${asset.alpha === 'forbid' ? 'no transparency' : 'transparency allowed'}`], ['Limit', mb(asset.maxBytes)], ['Required', asset.required ? 'yes' : 'optional'], ['Languages', asset.localized ? 'each' : 'default only'], ['Source', asset.source === 'capture' ? `captures: ${asset.scenes.join(', ') || 'none configured'}` : asset.designPath], ['Upload', asset.upload === 'fastlane' ? 'store lanes' : 'by hand'], ['Rendered', `${asset.finals[where] ?? 0} file(s) for ${where}`]].flatMap(([key, value]) => [el('dt', {}, key), el('dd', {}, String(value))])),
    asset.note ? el('p', {}, asset.note) : null,
    asset.guides.length ? el('p', {}, 'Guides: ', asset.guides.map((guide) => guide.label).join('; ')) : null
  ].filter(Boolean))
}
const note = (message, extra) => el('div', { class: 'note' }, el('p', {}, message), extra)
const place = (label, width, height, scale) => el('div', { class: 'ph', style: `height:${height}px;width:${Math.round(width * scale)}px` }, label)

/**
 * One image the viewer shows (a design slide or a final file): it sits at the view's fit size and can be zoomed on its own.
 * Ctrl + wheel zooms around the pointer, dragging pans while zoomed, double-click or Reset returns to the fit. A transparent
 * shield lies over the content, so a design page never scrolls or catches the wheel itself: the stage is the only scroll.
 */
const zoomStates = new Map()
const ROW_GAP = 20, MIN_TILE = 150
const items = new Set()
function zoomItem({ key, width, height, content, caption, row }) {
  const view = zoomStates.get(key) ?? { zoom: 1, x: 0, y: 0 }
  zoomStates.set(key, view)
  const layer = el('div', { class: 'zlayer', style: `width:${width}px;height:${height}px` }, content)
  const shield = el('div', { class: 'zshield', title: 'Ctrl + wheel to zoom, drag to pan, double-click to reset' })
  const box = el('div', { class: 'zbox' }, layer, shield)
  const level = el('span', { class: 'zlevel' })
  const button = (label, title, action) => el('button', { type: 'button', title, 'aria-label': title, onclick: action }, label)
  let base = 1
  const size = () => ({ w: width * base, h: height * base })
  const clamp = () => {
    const { w, h } = size(), scale = view.zoom
    view.x = Math.min(0, Math.max(w - w * scale, view.x)); view.y = Math.min(0, Math.max(h - h * scale, view.y))
  }
  const apply = () => {
    clamp()
    layer.style.transform = `translate(${view.x}px, ${view.y}px) scale(${base * view.zoom})`
    level.textContent = `${Math.round(base * view.zoom * 100)}%`
    box.classList.toggle('zoomed', view.zoom > 1)
  }
  /** Zooms by `factor`, keeping the point (px, py) of the box where it is. Never below the fit, never past 800 % of the pixels. */
  const zoomAt = (factor, px = size().w / 2, py = size().h / 2) => {
    const next = Math.min(Math.max(view.zoom * factor, 1), Math.max(1, 8 / base))
    const ratio = next / view.zoom
    view.x = px - (px - view.x) * ratio; view.y = py - (py - view.y) * ratio; view.zoom = next
    apply()
  }
  const reset = () => { Object.assign(view, { zoom: 1, x: 0, y: 0 }); apply() }
  shield.addEventListener('wheel', (event) => {
    if (!event.ctrlKey && !event.metaKey) return // a plain wheel scrolls the page
    event.preventDefault()
    const rect = box.getBoundingClientRect()
    zoomAt(Math.exp(-event.deltaY * 0.0025), event.clientX - rect.left, event.clientY - rect.top)
  }, { passive: false })
  let drag = null
  shield.addEventListener('pointerdown', (event) => { if (view.zoom <= 1) return; drag = { x: event.clientX - view.x, y: event.clientY - view.y }; shield.setPointerCapture(event.pointerId) })
  shield.addEventListener('pointermove', (event) => { if (!drag) return; view.x = event.clientX - drag.x; view.y = event.clientY - drag.y; apply() })
  const stop = () => { drag = null }
  shield.addEventListener('pointerup', stop); shield.addEventListener('pointercancel', stop)
  shield.addEventListener('dblclick', reset)
  const figure = el('figure', { class: 'zitem' }, box, el('div', { class: 'zbar' }, el('figcaption', {}, caption ?? ''),
    el('div', { class: 'zcontrols', role: 'group', 'aria-label': 'Zoom this image' },
      button('−', 'Zoom out', () => zoomAt(1 / 1.25)), level, button('+', 'Zoom in', () => zoomAt(1.25)), button(row ? '↺' : 'Reset', 'Reset zoom', reset))))
  /** Lays the item out at the view's fit size (the whole image visible in the stage) times the view zoom. */
  figure.fit = () => {
    const stage = $('#stage'), style = getComputedStyle(stage)
    const availableWidth = stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
    // The stage scrolls on its own in a wide window; in a narrow one the page scrolls and an image may take most of the window.
    const narrow = getComputedStyle(stage).overflowY === 'visible'
    const availableHeight = (narrow ? innerHeight * 0.8 : stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)) - 44
    // In a row of `row` images (one language of the Languages view) the whole set fits across, about two rows to a screen,
    // and never so small that the controls under it stop fitting: the row wraps instead.
    const fit = row
      ? Math.min(Math.max(Math.min((availableWidth - ROW_GAP * (row - 1)) / row / width, availableHeight * 0.45 / height), MIN_TILE / width), 1)
      : Math.min(availableWidth / width, availableHeight / height, 1)
    base = fit * ui.zoom[ui.mode]
    box.style.width = `${Math.round(width * base)}px`; box.style.height = `${Math.round(height * base)}px`
    apply()
  }
  items.add(figure)
  figure.fit()
  return figure
}
const fitAll = () => { for (const item of items) if (item.isConnected) item.fit(); else items.delete(item) }
new ResizeObserver(fitAll).observe($('#stage'))
addEventListener('resize', fitAll)

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
/** Waits for a design page to finish (<body data-ready="1">, when it uses it), then shows only its slide `index`. */
async function isolate(iframe, index) {
  const doc = iframe.contentDocument
  for (const started = Date.now(); doc.body?.dataset.ready === '0' && Date.now() - started < 60_000;) await sleep(100)
  const style = doc.createElement('style'); style.id = 'rds-isolate'
  style.textContent = 'html, body { overflow: hidden !important; scrollbar-width: none !important; } ::-webkit-scrollbar { display: none !important; }'
  doc.head.append(style)
  const slides = [...doc.querySelectorAll('[data-slide]')], slide = slides[index], scroller = doc.scrollingElement
  if (slide) { const rect = slide.getBoundingClientRect(); scroller.scrollTo(rect.left + scroller.scrollLeft, rect.top + scroller.scrollTop) }
  return Math.max(1, slides.length)
}

function designView(asset) {
  if (asset.design === 'capture') return note(`${asset.label} are built from captured app screens with no artwork, so there is no design page. Use "Final images" to see them.`)
  if (asset.design === 'missing') return note(`No design yet at ${asset.designPath}. Run rds media scaffold to create one.`)
  if (asset.design === 'image') return note('This asset is a master image resized by rds. See "Final images".')
  const [width, height] = asset.size
  const url = `${asset.designUrl}?${query({ lang: ui.locale, asset: asset.id, width, height })}`
  const grid = el('div', { class: 'zgrid' })
  // One frame per slide, each exactly one image of the set: the first one also tells how many slides the page has.
  const add = (index) => {
    const iframe = el('iframe', { src: url, title: `${asset.label} ${index + 1}`, scrolling: 'no', tabindex: '-1', style: `width:${width}px;height:${height}px` })
    grid.append(zoomItem({ key: `design:${asset.id}:${index}`, width, height, content: iframe, caption: `${index + 1}` }))
    return new Promise((done) => iframe.addEventListener('load', async () => {
      try { const count = await isolate(iframe, index); drawGuides(iframe, asset, index); done(count) } catch { done(1) }
    }, { once: true }))
  }
  void add(0).then((count) => { for (let index = 1; index < count; index++) void add(index) })
  return grid
}
function drawGuides(iframe, asset, index) {
  if (!ui.guides || !asset.guides.length) return
  const doc = iframe.contentDocument
  const slides = [...doc.querySelectorAll('[data-slide]')], targets = slides.length ? [slides[index]].filter(Boolean) : [doc.body]
  for (const slide of targets) for (const guide of asset.guides) {
    const box = doc.createElement('div')
    box.className = guide.bottom ? 'guide-bottom' : 'guide-inset'
    if (guide.bottom) box.style.height = guide.bottom * 100 + '%'; else box.style.inset = guide.inset + 'px'
    box.textContent = guide.label
    slide.append(box)
  }
  if (!doc.getElementById('rds-guides')) { const style = doc.createElement('style'); style.id = 'rds-guides'; style.textContent = [...document.styleSheets].flatMap((sheet) => [...sheet.cssRules]).filter((rule) => /guide-/.test(rule.cssText)).map((rule) => rule.cssText).join('\n'); doc.head.append(style) }
}

async function finalView(asset) {
  const result = await images(asset.id, ui.locale)
  if (!result.urls.length) return note(result.note ? `Nothing to show: ${result.note}` : 'Nothing rendered yet. Run rds media render.')
  const figures = await Promise.all(result.urls.map(async (src, index) => {
    const image = el('img', { src, alt: `${asset.label} ${index + 1}`, draggable: 'false' })
    await image.decode().catch(() => undefined)
    const meta = result.meta?.[index], width = meta?.width ?? (image.naturalWidth || asset.size[0]), height = meta?.height ?? (image.naturalHeight || asset.size[1])
    return zoomItem({ key: `final:${asset.id}:${index}`, width, height, content: image, caption: meta ? `${index + 1}: ${meta.width}×${meta.height}, ${mb(meta.bytes)}` : `${index + 1}: ${width}×${height}` })
  }))
  return el('div', {},
    result.live ? null : el('p', { class: 'tag' }, `Showing files already rendered to disk (${result.note ?? 'live render unavailable'})`),
    el('div', { class: 'zgrid' }, figures),
    (result.warnings ?? []).map((warning) => el('p', { class: 'bad' }, warning)))
}

/**
 * Every language at once: one row per language with that language's final images, rendered live like Final images. Rows fill in
 * one language after another (the default first), so a long set never renders every language at the same time.
 */
function languagesView(asset) {
  const ticket = drawing
  const codes = asset.localized ? [state.default, ...state.locales.filter((code) => code !== state.default)] : [state.default]
  const rows = codes.map((code) => {
    const body = el('div', { class: 'zgrid row' }, el('p', { class: 'tag' }, 'Rendering…'))
    return { code, body, section: el('section', { class: 'lang' }, el('h3', {}, code, code === state.default ? el('span', { class: 'badge' }, 'default') : null), body) }
  })
  void (async () => {
    for (const { code, body, section } of rows) {
      if (ticket !== drawing) return
      const result = await images(asset.id, code)
      if (ticket !== drawing) return
      if (!result.urls.length) { body.replaceChildren(el('p', { class: 'tag' }, result.note ? `Nothing to show: ${result.note}` : 'Nothing rendered yet.')); continue }
      const figures = await Promise.all(result.urls.map(async (src, index) => {
        const image = el('img', { src, alt: `${asset.label} ${code} ${index + 1}`, draggable: 'false' })
        await image.decode().catch(() => undefined)
        const meta = result.meta?.[index], width = meta?.width ?? (image.naturalWidth || asset.size[0]), height = meta?.height ?? (image.naturalHeight || asset.size[1])
        return zoomItem({ key: `languages:${asset.id}:${code}:${index}`, width, height, content: image, caption: `${index + 1}`, row: result.urls.length })
      }))
      body.replaceChildren(...figures)
      section.append(...[result.live ? null : el('p', { class: 'tag' }, `Files already rendered to disk (${result.note ?? 'live render unavailable'})`), ...(result.warnings ?? []).map((warning) => el('p', { class: 'bad' }, warning))].filter(Boolean))
    }
  })()
  return el('div', { class: 'langs' }, asset.localized ? null : el('p', { class: 'tag' }, `${asset.label} is the same in every language: only the default language has its own images.`), rows.map((row) => row.section))
}

/** A strip of screenshots at the height a store shows them. */
async function strip(id, height) {
  const result = await images(id, ui.locale), asset = state.assets.find((item) => item.id === id)
  if (!asset) return null
  const ratio = asset.size[0] / asset.size[1]
  return el('div', { class: 'strip', style: `--h:${height}px` }, result.urls.length ? result.urls.map((src) => el('img', { src, alt: '' })) : [place(`${asset.label}: ${result.note ?? 'nothing yet'}`, height * ratio, height, 1)])
}
async function single(id, cls = 'icon') {
  const result = await images(id, ui.locale), asset = state.assets.find((item) => item.id === id)
  if (!asset) return el('div', { class: cls })
  return result.urls[0] ? el('img', { class: cls, src: result.urls[0], alt: '' }) : el('div', { class: cls })
}
async function listingView(asset) {
  return el('div', { class: 'listing', style: `zoom:${ui.zoom.listing}` }, await listingMock(asset))
}
async function listingMock(asset) {
  const text = state.listing[ui.locale] ?? { android: {}, ios: {} }
  const platform = asset.platform, tag = el('p', { class: 'tag' }, 'An approximation: the layout and scale follow typical store pages, not pixel-exact ones.')
  if (platform === 'android') {
    const banner = await single('android.featureGraphic', 'banner'), icon = await single('android.icon')
    return el('div', {}, tag, el('div', { class: 'row' },
      el('div', { class: 'mock' }, banner, el('div', { class: 'head' }, icon, el('div', {}, el('h3', {}, text.android.title || 'App name'), el('p', {}, 'Developer'))),
        el('div', { class: 'stats' }, el('span', {}, '4.6 ★'), el('span', {}, '10K+'), el('span', {}, '3+')), el('div', { class: 'cta' }, 'Install'),
        await strip(asset.id.startsWith('android.') && ['android.phone', 'android.tablet7', 'android.tablet10', 'android.wear'].includes(asset.id) ? asset.id : 'android.phone', 232), el('div', { class: 'about' }, text.android.short || 'Short description'))))
  }
  if (platform === 'ios') {
    const icon = await single('android.icon').catch(() => null)
    return el('div', {}, tag, el('div', { class: 'row' },
      el('div', { class: 'mock ios' }, el('div', { class: 'head' }, icon, el('div', {}, el('h3', {}, text.ios.name || 'App name'), el('p', {}, text.ios.subtitle || 'Subtitle')), el('div', { class: 'cta' }, 'GET')),
        el('div', { class: 'stats' }, el('span', {}, '4.8 ★'), el('span', {}, '4+'), el('span', {}, '#12')), await strip(asset.id, 368))))
  }
  const hero = asset.id === 'windows.screenshots' ? await single('windows.superHero', 'big').catch(() => null) : null
  const result = await images(asset.id, ui.locale), main = result.urls[0]
  return el('div', {}, tag, el('div', { class: 'mock wide' }, hero, el('div', { class: 'head' }, await single('windows.tile').catch(() => null), el('div', {}, el('h3', {}, text.android.title || text.ios.name || 'App name'), el('p', {}, asset.label))),
    main ? el('img', { class: 'big', src: main, alt: '' }) : el('div', { class: 'ph big', style: 'height:360px' }, result.note ?? 'nothing yet'),
    result.urls.length > 1 ? el('div', { class: 'strip', style: '--h:90px' }, result.urls.slice(1).map((src) => el('img', { src, alt: '' }))) : null))
}

let drawing = 0
async function draw() {
  const ticket = ++drawing, asset = current()
  chrome(); specPanel(); syncHash()
  $('#status').textContent = ui.mode === 'design' ? 'Live design' : 'Rendering…'
  const view = ui.mode === 'design' ? designView(asset) : ui.mode === 'final' ? await finalView(asset) : ui.mode === 'languages' ? languagesView(asset) : await listingView(asset)
  if (ticket !== drawing) return
  $('#stage').replaceChildren(view)
  $('#status').textContent = ui.mode === 'design' ? 'Live design' : ui.mode === 'languages' ? 'Every language, rendered with the same pipeline as rds media render' : 'Rendered with the same pipeline as rds media render'
}
const go = () => draw()
// Following a link or editing the address changes the view without a reload.
addEventListener('hashchange', () => {
  const next = new URLSearchParams(location.hash.slice(1)), asset = next.get('asset') ?? ui.asset, locale = next.get('locale') ?? ui.locale, mode = next.get('mode') ?? ui.mode
  if (!state.assets.some((item) => item.id === asset) || !state.locales.includes(locale) || !MODES.includes(mode) || (asset === ui.asset && locale === ui.locale && mode === ui.mode)) return
  Object.assign(ui, { asset, locale, mode }); go()
})
$('#asset').addEventListener('change', (event) => { ui.asset = event.target.value; go() })
$('#locale').addEventListener('change', (event) => { ui.locale = event.target.value; go() })
for (const button of document.querySelectorAll('.modes button')) button.addEventListener('click', () => { ui.mode = button.dataset.mode; go() })
// The view's zoom: Design and Final images relative to the size that fits the stage, the store listing relative to its own size.
const ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 3, 4]
const setZoom = (value) => {
  ui.zoom[ui.mode] = value
  chrome()
  if (ui.mode === 'listing') { const listing = $('.listing'); if (listing) listing.style.zoom = String(value) } else fitAll()
}
const step = (direction) => {
  const now = ui.zoom[ui.mode], next = direction > 0 ? ZOOMS.find((zoom) => zoom > now + 1e-6) : [...ZOOMS].reverse().find((zoom) => zoom < now - 1e-6)
  if (next) setZoom(next)
}
$('#zoom-in').addEventListener('click', () => step(1))
$('#zoom-out').addEventListener('click', () => step(-1))
$('#zoom-fit').addEventListener('click', () => setZoom(1))
// Ctrl + wheel over the stage outside an image zooms the whole view (over an image it zooms that image).
$('#stage').addEventListener('wheel', (event) => {
  if ((!event.ctrlKey && !event.metaKey) || event.target.closest('.zshield')) return
  event.preventDefault(); step(event.deltaY < 0 ? 1 : -1)
}, { passive: false })
$('#guides').addEventListener('change', (event) => { ui.guides = event.target.checked; go() })
$('#dark').checked = ui.dark
$('#dark').addEventListener('change', (event) => { ui.dark = event.target.checked; chrome() })
new EventSource('/_rds/events').addEventListener('change', async () => { state = await get('/_rds/api/state'); renders.clear(); draw() })
draw()
