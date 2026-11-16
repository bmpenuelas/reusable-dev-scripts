import { defineConfig } from 'reusable-dev-scripts'
export default defineConfig({
  version: 1,
  vue: { root: 'frontend', typecheck: 'noEmit' },
  capacitor: { root: 'frontend', packageJson: 'frontend/package.json', platforms: ['android', 'ios'] },
  android: { root: 'frontend/android', appId: 'com.example.app' },
  cloudflare: { targets: {
    backend: { kind: 'worker', root: 'backend', config: 'wrangler.toml' },
    landing: { kind: 'pages', directory: 'web', projectName: 'example-landing' },
  } },
  browser: { root: 'extension', directory: 'dist', output: 'release/extension.zip', prepare: [['npm', 'run', 'build']] },
})
