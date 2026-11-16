import { defineConfig } from 'reusable-dev-scripts'
export default defineConfig({
  version: 1,
  capacitor: { platforms: ['android', 'ios'] },
  android: { appId: 'com.example.app' },
  store: {
    root: 'store',
    locales: [{ app: 'en', android: 'en-US', ios: 'en-US' }, { app: 'es', android: 'es-ES', ios: 'es-ES' }],
    appLocales: ['en', 'es'],
    defaultLocale: 'en-US',
    iosDevices: { iphone: true, ipad: false, watch: false },
    androidId: 'com.example.app', iosId: 'com.example.app',
    // Existing, ignored files owned by the consuming app. Never commit their contents.
    playKey: '.secrets/play-service-account.json',
    appleKey: '.secrets/app-store-connect.json',
    iosProject: 'ios/App/App.xcodeproj', iosScheme: 'App',
  },
})
