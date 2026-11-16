import { defineConfig } from 'reusable-dev-scripts'
export default defineConfig({
  version: 1,
  vue: { typecheck: 'build' },
  electron: {
    url: 'http://127.0.0.1:5173',
    prepare: [['npm', 'run', 'build']],
    output: 'release/desktop',
    // assets: { source: 'assets/icon.png', ico: 'build/icon.ico', icns: 'build/icon.icns' },
    notaryProfile: 'example-notary-profile',
  },
})
