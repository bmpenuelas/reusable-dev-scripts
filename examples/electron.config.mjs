import { defineConfig } from 'reusable-dev-scripts'
export default defineConfig({
  version: 1,
  vue: { typecheck: 'build' },
  electron: {
    url: 'http://127.0.0.1:5173',
    prepare: [['npm', 'run', 'build']],
    output: 'release/desktop',
    // assets: { source: 'assets/icon.png', ico: 'build/icon.ico', icns: 'build/icon.icns' },
    // `rds electron check-signing-identity` (macOS) checks CSC_NAME against the keychain before a signed build.
    // Keychain profile for `rds electron notarize`; --profile or APPLE_NOTARY_PROFILE override it.
    notaryProfile: 'example-notary-profile',
  },
})
