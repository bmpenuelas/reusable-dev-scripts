import { defineConfig } from 'reusable-dev-scripts'
export default defineConfig({
  version: 1,
  store: {
    root: 'store',
    locales: [{ app: 'en', android: 'en-US', ios: 'en-US' }, { app: 'es', android: 'es-ES', ios: 'es-ES' }],
    androidId: 'com.example.app', iosId: 'com.example.app',
  },
  media: {
    // Which stores' images to make. Google Play and App Store images go to the store tree for the store lanes to upload.
    platforms: ['android', 'ios', 'windows'],
    exclude: ['android.wear'],
    // Microsoft Store screenshots are screenshots of the app itself: list the captured scenes to copy, no design.
    scenes: { 'windows.screenshots': ['home'] },
    // Project code that drives the running app, one browser context per scene and language.
    capture: {
      module: 'scripts/media-capture.mjs',
      baseUrl: 'http://localhost:5173',
      scenes: [{ id: 'home', viewport: { width: 1920, height: 1080 } }],
    },
    // Optional: a master image instead of a page for the icon, a fixed clock, and an extra image the catalog lacks.
    designs: { 'android.icon': 'base/icon.svg' },
    clock: '2026-01-01T09:00:00Z',
    custom: [{ id: 'web.share', platform: 'web', width: 1200, height: 630, format: 'jpeg', localized: false, directory: 'artwork/web' }],
  },
})
