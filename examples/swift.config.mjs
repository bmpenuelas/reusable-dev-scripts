import { defineConfig } from 'reusable-dev-scripts'
export default defineConfig({
  version: 1,
  // Supply a SwiftPM product, plist, resources and explicit entitlements first.
  swift: {
    root: 'macos', executable: 'ExampleApp',
    plist: 'Info.plist', entitlements: 'ExampleApp.entitlements',
    resources: 'Resources', output: 'build/ExampleApp.app',
    icon: 'Resources/AppIcon.png', iconOutput: 'Resources/AppIcon.icns',
    identity: '-', // local ad-hoc signing, NOT an App Store distribution identity
  },
})
