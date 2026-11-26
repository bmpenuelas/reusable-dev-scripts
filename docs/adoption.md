# Adopting reusable-dev-scripts

Migrate one workflow at a time. Keep the original implementation until equivalent behavior has been demonstrated, and keep application-specific policy local.

## 1. Inventory behavior—not just script names

For each candidate alias, record its working directory, prerequisites, generated files, environment inputs, version ownership, verification steps, and side effects. Include behavior on retries and failures.

An alias named `lint` might only run a typechecker. A script named `bundle` might also bump a version or upload a release. Do not infer behavior from names.

## 2. Choose a module boundary

| Project component | Use | Leave in the application |
| --- | --- | --- |
| Vue frontend | `vue build` | Vite config, source generation, lint/test rules |
| Capacitor application | `capacitor`, `android` | Artwork composition, catalogue adapters, platform cleanup, native security checks |
| Mobile listing/release | `store` | Listing copy, screenshots, credentials, application readiness policy |
| VS Code extension | `vscode` | Compilation/bundling entry points, tests, mocks, benchmarks |
| Electron desktop application | `electron` | Frontend build recipe, builder config, signing identities and policy |
| Swift macOS application | `swift` | Product/source variants, IDs, plist, entitlements |
| Cloudflare deployment | `cloudflare` | Infrastructure and application configuration, domains, account policy |
| Hostinger deployment and disposable-environment reset | `hostinger`, `hosting` | Application seeds, retention decisions, which environments are disposable |
| Browser extension | `browser` | Build/copy recipe, manifest, browser-store submission |
| Local development loop | `dev`, `wait` | Which processes exist, their commands, and what "ready" means for the application |
| Per-environment settings | `env` | Defaults, validation rules and generated file formats, kept in one project module |
| Prisma migrations on remote databases | `prisma` | Where the database URL comes from and any stronger production approval |
| PlatformIO firmware builds and tool calls | `platformio` | The firmware directory, environments to build and any flashing or signing policy |

One repository can use several modules. There is no single project preset to select, and optional modules do not need configuration until used.

## 3. Install and establish configuration ownership

Follow the [quick start](../README.md#quick-start). Pin the dependency, commit the consumer's lockfile, and ignore `.rds/` plus local credentials.

The default is the published npm package:

```sh
npm install --save-dev --save-exact reusable-dev-scripts
```

When editing the toolkit, follow [local toolkit development](../README.md#local-toolkit-development) for linked checkouts, watch builds, tarballs, and switching back to a registry release.

Choose the package that owns your app's version. For a workspace application:

```js
capacitor: {
  root: 'apps/mobile',                    // native/frontend working directory
  packageJson: 'apps/mobile/package.json', // relative to the config root
  platforms: ['android', 'ios'],
}
```

Use [configuration patterns](configuration.md), [examples](../examples/), and the [command reference](commands.md) for path rules and defaults. Replace example IDs, filenames, and signing settings; they are not inferred from the app.

## 4. Preserve the complete pipeline

Prefer thin aliases or explicit compositions:

```json
{
  "scripts": {
    "native:sync": "rds capacitor sync",
    "android:debug": "rds capacitor sync --platform android && rds android build --configuration debug --format apk",
    "android:install": "npm run android:debug && rds android install",
    "native:prepare": "rds capacitor prepare",
    "store:check": "rds store check --strict"
  }
}
```

The install command installs an **existing** APK; the explicit build is intentional. Likewise, an AAB build does not silently sync resources, bump a version, commit files, or upload a release.

Keep special transformations local and connect them through documented hooks. A custom web-build hook owns its typechecking. Native string generation does not automatically register resources in Xcode or patch platform declarations.

**Avoid recursion:** an alias replaced by `rds` must not be called by a hook that the same command executes. Keep `vscode:prepublish` pointing at compilation, not `rds vscode package`.

## 5. Verify in increasing order of effect

1. Read per-command `--help` and validate configuration imports.
2. Run `--dry-run`; inspect command order and working-directory choices. Its logs intentionally omit argument values. Programmatic contexts expose a `plan`, but plans can contain argv, environment, and stdin values: inspect them only with synthetic data, and never publish them as sanitized logs.
3. Run read-only checks: `capacitor versions --check`, generated-resource checks, and scoped store validation. Generate a native-asset snapshot once before relying on `capacitor assets --check`.
4. Build local artifacts. Compare versions, resources, package contents, identifiers, and retained verification gates.
5. Install on an explicitly selected test device or simulator.
6. With operator approval, test staging/internal remote workflows and native signing/notarization on the appropriate host.
7. Remove the old helper only after equivalent behavior is demonstrated.

Keep an acceptance record of commands and artifact checks, without credentials or full invocation plans. Dry-run is not platform/account acceptance testing.

## Common replacements

| Existing behavior | Shared implementation |
| --- | --- |
| Typecheck Vue, then build | `rds vue build` |
| Build/sync Android and open its IDE | `rds capacitor sync --platform android --open` |
| Staging iOS synchronization | `rds capacitor sync --platform ios --env staging` |
| Prepare a new native patch release | `rds capacitor prepare --platform android --bump patch` |
| Refresh an existing release | Same preparation command without `--bump` |
| Increment only the iOS build | `rds capacitor versions --platform ios --bump-build` |
| Build a release AAB | `rds android build --configuration release --format aab` |
| Install an existing debug APK | `rds android install --device <serial>` |
| Validate a completed listing | `rds store check --strict` |
| Compare local listing files and Play release notes with the stores | `rds store verify` (read-only) |
| Commit version files after a build upload | `store.hooks.afterBuildUpload` running your own script |
| Notarize a macOS ZIP and staple the app inside | `rds electron notarize --artifact "release/*-mac.zip" --staple "release/mac/*.app"` |
| Run the frontend and Electron together | `rds electron dev` |
| Run a Pages deployment from a dirty tree | `cloudflare.targets.<name>.commitDirty: true` |
| Export localized iOS text | `rds store export --platform ios` |
| Package a VS Code extension | `rds vscode package` |
| Publish the same VSIX to both registries | `rds vscode publish --registry all` |
| Start API and frontend together | `rds dev start` (one terminal) or `rds dev tabs` (one terminal tab per process) |
| Start the services plus a phone live-reload session on demand | `dev.processes` with an `optional: true` entry and `rds dev tabs --with <name>` |
| Give a Wear OS module its own version-code range | `capacitor.androidModules: [{ project, versionCodeOffset }]` |
| Wait for a database before migrating | `rds wait tcp --target database` |
| Wait for an API to answer with a given release | `rds wait http --target api` |
| Check that Xcode and Android declare every language | `rds capacitor check-locales` |
| Patch the Xcode project, plist and manifest after adding a language | `rds capacitor register-locales` |
| Copy generated icons to web, watch or store folders | `capacitor.assets.copies` / `electron.assets.copies` |
| Hand-write `assetlinks.json` and `apple-app-site-association` | `rds app-links generate` / `check` |
| Call `aapt` to read an APK's permissions | `rds android inspect --artifact <apk> --format json`, with your own rules on the output |
| Check a Developer ID certificate before a macOS build | `rds electron check-signing-identity` |
| Fail CI when firmware no longer fits its OTA slot | `rds esp32 check-size --artifact <bin> --partitions <csv> --min-free-bytes <n>` |
| Template, validate and generate environment files | `rds env template|validate|generate|check --env <name>` |
| Migrate a staging or production database | `rds prisma migrate --env staging` |

See the [agent playbook](agents.md) for automated integration and the [safety model](safety.md) before side-effecting operations.
