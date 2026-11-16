// Copy into the application as reusable-dev-scripts.config.mjs and adjust identifiers/paths.
import { defineConfig } from 'reusable-dev-scripts'
export default defineConfig({
  version: 1,
  vue: { typecheck: 'noEmit' },
  capacitor: {
    platforms: ['android', 'ios'],
    live: { host: '127.0.0.1', port: 5173 },
    // prepare: [['node', 'scripts/prepare-env.mjs', '--env', '{env}']],
    // afterSync: [['node', 'scripts/post-sync.mjs', '{platform}']],
    // verify: [['node', 'scripts/check-native.mjs', '{platform}']],
    // App-owned source composition must run before generating these outputs.
    assets: { source: 'assets/icon.png', background: '#ffffff', outputs: [{ path: 'public/icon-192.png', width: 192 }, { path: 'public/icon-512.png', width: 512 }] },
  },
  android: { root: 'android', appId: 'com.example.app' },
})
