// Copy into the application as reusable-dev-scripts.config.mjs and adjust identifiers/paths.
import { defineConfig } from 'reusable-dev-scripts'
export default defineConfig({
  version: 1,
  vue: { typecheck: 'noEmit' },
  capacitor: {
    platforms: ['android', 'ios'],
    live: { host: '127.0.0.1', port: 5173 },
    // prepare: [['node', 'scripts/prepare-env.mjs', '--env', '{env}']],
    // afterBuild: [['node', 'scripts/generate-native-resources.mjs', '{platform}']],
    // afterSync: [['node', 'scripts/post-sync.mjs', '{platform}']],
    // verify: [['node', 'scripts/check-native.mjs', '{platform}']],
    // Optional: `rds capacitor check-locales` verifies that Android and Xcode declare these languages; `register-locales` maintains them.
    // localeRegistration: { locales: ['en', 'es'], android: {}, ios: { targets: [{ name: 'App', files: ['InfoPlist.strings'] }] } },
    // App-owned source composition must run before generating these outputs.
    assets: { source: 'assets/icon.png', background: '#ffffff', outputs: [{ path: 'public/icon-192.png', width: 192 }, { path: 'public/icon-512.png', width: 512 }], copies: [{ source: 'assets/icon.png', path: 'public/apple-touch-icon.png', normalize: 'png' }] },
  },
  android: { root: 'android', appId: 'com.example.app' },
  // Optional: `rds app-links generate|check` with your own identities and certificate fingerprints.
  // appLinks: { directory: 'public', apple: [{ teamId: 'TEAMID1234', bundleId: 'com.example.app', paths: ['/open/*'] }] },
})
