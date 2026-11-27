# Commands and configuration

The exported `Config` TypeScript type and `defineConfig` provide editor checks; runtime validation rejects invalid sections, hook shapes, and command flags. An optional module is not required until its commands are used.

For a first integration, start with [adoption](adoption.md) and the complete [configuration patterns](configuration.md). Read the [safety model](safety.md) before signing, installing, uploading or deploying.

## Result banners

The executable prints one timestamped result banner to **stderr** after a command: `SUCCESS` on exit 0, `FAILED` on failure, or `PLAN COMPLETE` for a successful dry-run. The timestamp is ISO 8601 UTC. A banner describes this rds invocation, not an entire npm `&&` chain, and dry-run is not proof of a live operation. Help, version output and programmatic `main()`/`Context` use have no banners.

Banners default to on. Set `output: { banners: false }` in project configuration to disable them. Override with `--banner` or `--no-banner` on any command, or set `RDS_BANNERS=1` / `RDS_BANNERS=0` in the shell or CI environment. Precedence: CLI flag, environment variable, config, enabled default. Combining both flags is an error. Configuration only takes effect after it loads successfully; use the flag or environment variable to silence startup errors. The config-free `skill install` utility uses only flags/environment/defaults.

Nested rds processes inherit `RDS_BANNER_OWNER=1`, so only the outer invocation prints a banner (including when the outer banner is disabled). Ownership suppression takes precedence over `--banner`; do not set this internal variable as an application setting. Ordinary step logs and diagnostics remain enabled.

TTY output uses green/red/cyan when color is supported; redirected output is plain text unless `FORCE_COLOR` is set. `NO_COLOR`, `TERM=dumb`, and `FORCE_COLOR=0` disable color, not banners. Summaries contain the known rds command name and exit status, never forwarded argv, credentials, or unredacted invocation plans.

## Paths, environments and hooks

Each module has an optional `root`, relative to the config file. File paths within the module (such as an image source or Swift plist) are relative to that module root. Explicit exceptions are documented below. Paths must stay inside their project; output paths must not be the project root.

Hooks are **argv arrays**, not strings interpreted by a shell:

```js
prepare: [['node', 'scripts/prepare-env.mjs', '--env', '{env}']]
```

Only `{env}`, `{platform}`, and `{root}` are substituted, inside individual argv elements. No interpolation into a shell takes place. Batch wrappers on Windows reject shell interpolation/control characters. Hooks cannot be disabled with `--skip-build` if they are preparation/verification hooks.

`production: { environments: ['production'], verify: [...] }` defines the authorization gate. It runs in the config root before production mutations. The default protected environment is `production`; custom protected names must be listed explicitly. The consumer still owns its security policy.

## Agent skill

`rds skill install [--output <directory>] [--dry-run]`

Installs the npm-bundled `reusable-dev-scripts` adoption skill. The complete destination skill directory defaults to `.agents/skills/reusable-dev-scripts`, relative to `--cwd` or the current directory, not a discovered config root. No config section is needed; this utility does not load project config or run hooks. `--config` is rejected. The output must remain inside the selected project.

Only `SKILL.md` is written. Identical content is a no-op; differing content is rejected without overwriting. There is no force/global installation mode. Dry-run validates paths and existing content but writes nothing. Other environment/production flags do not trigger hooks or authorize extra effects. For a different agent client, choose its project-local skill folder explicitly and ask it to read the installed file if automatic discovery is unavailable.

## Vue

`rds vue build [--mode <mode>] [--skip-typecheck] [-- <Vite arguments>]`

`vue.root` selects the frontend. `typecheck` is `noEmit` (default), `build`, or `false`. `modes` can map an environment to a Vite mode. Without a mapping/flag, an explicit `--env` supplies the mode; with neither flag, Vite builds production. No `NODE_ENV` rewriting is performed. Development servers, lint and tests can remain direct npm aliases.

Literal arguments after `--` are passed to Vite, never to the typechecker or a shell. A forwarded `--mode` replaces the default; do not also specify the rds `--mode` option. Typechecking completes successfully before bundling begins.

## Capacitor

`capacitor.root` selects the native frontend. Set `platforms: ['android', 'ios']` explicitly, or let rds detect native project directories.

- `sync` / `copy`: preparation → assets/locales → **web build per platform** → after-build hooks → Capacitor → post-sync hooks → verification → optional IDE open.
- `--skip-build` skips assets/locales/web compilation and after-build hooks, not preparation, post-sync handling or verification. Use existing prebuilt resources intentionally.
- `open`: IDE only; opening iOS requires macOS.
- `prepare`: authorization/preparation → version synchronization (optional `--bump patch|minor|major`) → sync, optionally `--open`.
- `versions`: native version synchronization without building. Supports `--check`, `--bump patch|minor|major`, or `--platform ios --bump-build`. Check mode cannot bump and does not require production mutation authorization.
- `live`: one platform; owns a strict-port Vite server and waits for readiness, runs Capacitor with live reload, and cleans up its server on failure/termination. `--skip-sync` skips the initial sync. Host/port come from flags or `live` config; loopback Android uses forwarded ports. Public hosts require HTTPS. HTTPS requires the project's Vite HTTPS configuration; `live.ca` supplies a trusted PEM bundle for readiness checks. TLS verification is never disabled.

Bounded customization:

| Field | Purpose / working directory |
| --- | --- |
| `prepare`, `prepareByEnv` | argv lists before syncing, in config root |
| `build` | one build argv command, in Capacitor root |
| `buildByPlatform` | optional Android/iOS overrides of that build command |
| `afterBuild` | argv list after each successful default/custom build, before sync/copy, in Capacitor root |
| `environment` | literal environment mapping with argv-style placeholders, for the build and native CLI |
| `environmentByPlatform` | overrides for a platform's web build, native CLI and post-sync steps |
| `afterSync` | argv list for fonts/pruning/SPM normalization, in Capacitor root |
| `verify` | argv list after each sync/copy, in Capacitor root |

Default web builds use the Vue module. A custom build hook owns its own typechecking. Do not point a build hook back at an npm alias being replaced by `rds capacitor sync` (that would recurse).

`afterBuild` receives the same platform environment and `{env}`, `{platform}`, `{root}` argv substitutions as the build. It runs once per platform, also in `prepare` and the sync phase of `live`, but not for standalone `vue build`. A failed build or hook stops the pipeline before Capacitor; dry-run only plans it.

`capacitor.androidModules: [{ project, versionCodeOffset? }]` lists further Gradle modules, such as a Wear OS app, that share the package version. `project` is the module's `build.gradle` relative to the Capacitor root and must exist; it receives the same version name and the native build number plus `versionCodeOffset` (default 0), so each form factor can use its own version-code range. The Android limit applies to the number including the offset, `--check` covers these files, and they are only touched for Android or `all` platforms.

Version files default to `android/app/build.gradle` and `ios/App/App.xcodeproj/project.pbxproj`, relative to Capacitor root; override with `androidProject` / `iosProject`. `packageJson` is relative to **config root**. The native build formula is `major*1_000_000 + minor*1_000 + patch`, minimum 1; minor/patch must be <=999 and Android's integer bound is enforced. iOS's existing integer build numbers are never decreased. Gradle settings already derived from package.json remain expressions. Unsupported version settings fail before bumping.

With `--bump`, the version source must be the owning `package.json`. RDS also updates existing npm locks beside that manifest and the matching package entry in the nearest ancestor's npm workspace lockfiles (`package-lock.json` or `npm-shrinkwrap.json`) inside the config root. It does not create a lockfile, refresh the dependency graph, install packages, run npm version lifecycle scripts, or commit or tag changes. Keep the RDS config at or above the npm workspace root for shared lockfile updates.

### Assets

`capacitor.assets` accepts `source`, optional `background`, `native` (default true), and `outputs: [{ path, width, height? }]` for PNG/JPEG/WebP outputs. Source artwork composition remains local. rds stages a PNG logo for the consumer's `@capacitor/assets` CLI. `--platform` can restrict native generation. `--check` compares web outputs and checks the native input/output hash snapshot; generate once after adoption before using check mode. Changing or deleting a recorded native asset makes the check fail; a recorded `.json`, `.xml` or SVG source that differs only because Git checked it out with CRLF does not. No stale/unknown resource directories are automatically removed.

`assets.copies: [{ source, path, normalize? }]` copies one file to one destination, both relative to the module root, for icons and artwork the generators do not place themselves (a web favicon, a watch icon, a store listing icon). The source must be inside the module root; the destination may be anywhere inside the config root, so a monorepo module can feed a sibling app (`../web/public/favicon.png` from `capacitor.root: 'frontend'`). Traversal and symlinks that leave those boundaries are rejected. Resized `outputs` stay inside the module root. Copies are byte for byte; `normalize: 'png'` instead re-encodes the input (any format Sharp reads) as a maximum-compression PNG, which needs a `.png` destination. They run after the resized outputs and the native generator, so a copy can reuse a generated file, and `--check` compares every destination with its source byte for byte (line endings included) without writing. Each destination must be unique, differ from the master image and the other outputs, and not be the input of another copy; there are no globs, directory copies or pruning. `source` is only needed for `outputs` and native generation, so `native: false` with only `copies` is valid. Normalized bytes come from the installed Sharp version: regenerate after upgrading it.

### Locales

`capacitor.locales` is a normalized catalogue with `defaultLocale`, `locales: { en: { app_name: 'Example' }, ... }`, and output `targets`:

```js
targets: [
  { format: 'android', directory: 'android/app/src/main/res' },
  { format: 'apple', directory: 'ios/App/App' },
]
```

A target can map native keys to catalogue keys using `keys: { native_key: 'catalogue.key' }`. Additional targets can emit widget/watch/Wear resources. An Apple target writes `Localizable.strings` unless it sets `file: 'InfoPlist.strings'`, so a second target can translate `CFBundleDisplayName` and usage descriptions. Two targets that resolve to the same file are an error. Generation checks translated placeholders, escapes XML/Apple strings, and emits BCP47 Android qualifiers. `capacitor locales` only writes string files; declaring the languages to Android and Xcode is the separate, optional [locale registration](#locale-registration). App-specific translated data and store copy stay local. `--check` never writes and fails if a generated file differs. CRLF versus LF alone is not a difference, so a checkout that converts line endings (Git `core.autocrlf`) still passes.

### Locale registration

Translated files are not enough: Android's per-app language list, the Xcode project and `CFBundleLocalizations` must declare each language, and the stores read those declarations. Configure `capacitor.localeRegistration` to check them, and optionally to maintain them:

```js
localeRegistration: {
  locales: ['en', 'es', 'pt-BR'],
  android: {},
  ios: {
    targets: [
      { name: 'App', files: ['InfoPlist.strings', 'Localizable.strings'], bundleLocalizations: ['en', 'es', 'pt-BR', 'fr', 'de'] },
      { name: 'WidgetExtension', files: ['Localizable.strings'] },
    ],
  },
}
```

`locales` defaults to the keys of `capacitor.locales.locales`; `android.locales` and `ios.locales` override it when the platforms use different codes. Only the listed platforms are checked, and only the listed Xcode targets and files: target membership is your decision. Paths are relative to the Capacitor root and default to the standard layout: `android.manifest` is `android/app/src/main/AndroidManifest.xml`, `android.localeConfig` is `android/app/src/main/res/xml/locales_config.xml`, `ios.project` is `ios/App/App.xcodeproj`, a target's `directory` is `ios/App/<name>`, and `infoPlist` (`true`, a path or `false`) defaults to `<directory>/Info.plist` for the target named `App` and to `false` for the others.

`CFBundleLocalizations` lists the iOS locales unless a target sets `bundleLocalizations`. Use it when the app speaks more languages than its string files, typically because the web UI has its own translations (`fr` and `de` above); leave it out otherwise. It replaces the list for that target's `Info.plist` only, so it needs `infoPlist` to be enabled, and it must include every iOS locale. It does not add `.lproj` files, known regions or variant groups. Android's locale config has no string-file requirement: list those languages in `android.locales`.

- `capacitor check-locales [--platform android|ios|all]`: read-only. Android needs the locale config listing exactly the configured languages and `<application android:localeConfig="@xml/...">`. Xcode needs each language in `knownRegions`, each configured file as a localized variant group in the target's Copy Bundle Resources (or inside a synchronized folder of that target without a membership exception), exactly the configured `<locale>.lproj` entries (`Base` is ignored), the files on disk, and a `CFBundleLocalizations` that matches exactly (the target's `bundleLocalizations` when set, else the iOS locales). Every difference is listed and the command exits non-zero, so it can run in CI or as a verification hook. Two things only report missing languages, never extra ones: `knownRegions`, which is shared by the whole project, and synchronized folders, where Xcode includes whatever is on disk.
- `capacitor register-locales [--platform android|ios|all]`: writes those declarations. It creates or updates the locale config (keeping the root element's attributes), adds the manifest attribute, adds known regions, variant groups, file references and build files, removes variant group and locale config entries for languages you no longer list (`.lproj` files and `knownRegions` stay) and sets `CFBundleLocalizations` (from `bundleLocalizations` when set). The result is checked in memory first: if anything cannot be completed, nothing is written. It never creates string files (run `capacitor locales` or your own generator first), never creates Xcode targets, groups or build phases, and refuses a directly referenced strings file or a manifest that points `localeConfig` elsewhere. Running it again changes nothing, line endings are preserved, and `sync` never runs it for you.

The edits assume Xcode's own text format for `project.pbxproj` and an XML `Info.plist`. Projects that generate the project file (XcodeGen, Tuist) should declare languages in that generator, and projects using Gradle's `generateLocaleConfig` should not also register an Android locale config. Review the diff and build once in Xcode after the first registration: a passing check is not a native build.

### Screenshots

`screenshots --action open|capture|resize --platform android|ios` uses ADB or one booted iOS simulator. `open` syncs and launches via Capacitor. `capture` uses `--name`, `--output`, optional `--device` / `--guided`; `--force` permits replacing a named capture. `resize --input <directory>` uses configured `screenshots.sizes` and writes separate, non-cropped variants, leaving captures untouched. The output defaults to `screenshots.output` or `store/captures` relative to Capacitor root. This is capture/output mechanics, not a marketing screenshot designer.

## Android

`android.root` defaults to `<capacitor.root>/android`; optional `module` defaults to `app`. Optional `javaHome` and `sdkRoot` override standard environment variables. Otherwise Android Studio's bundled JDK is discovered. `appId` is the installed APK's application ID for verification and explicit replacement; include any Gradle `applicationIdSuffix` (for example, `com.example.app.debug`). It need not equal the release/Capacitor/store ID and does not change those identities. `apk`, `aab`, `mapping` can override artifact paths relative to Android root.

- `build --configuration debug|release --format apk|aab [--kind <name>] [--clean] [--reveal]`: runs Gradle and verifies the expected artifact. Defaults to release AAB. The `buildSettings.android` lists for `all`, the configuration and the optional `--kind` are passed as `-PNAME=value` Gradle properties (see Build settings). `--reveal` is a best-effort file-manager action after verification. Windows Explorer launches visibly and its normal shell-handoff exit codes 0 and 1 are accepted without a warning; a genuine launch/other-exit failure logs a warning and leaves the successful build successful. Other tools still require exit code 0. Gradle failures and missing artifacts still fail the command. Custom Gradle tasks can follow `--`; artifact inference and reveal are skipped for them. After a verified release build, the R8 mapping (`android.mapping`, default `<module>/build/outputs/mapping/release/mapping.txt`) and native debug symbols (`<module>/build/outputs/native-debug-symbols/release/native-debug-symbols.zip`) are logged when they exist, ready for upload to the Play Console.
- `install [--artifact <config-root-relative-apk>] [--device <serial>] [--physical] [--replace]`: installs an **already built** debug/custom APK and verifies it against `android.appId`. Device selection, existing-install lookup, explicit removal, APK installation and package verification have distinct step labels. No build, sync, uninstall, launch, or version bump is implicit. If installation reports success but final verification fails, compare the APK's actual application ID with `android.appId`; do not uninstall an unrelated release package to address a debug-ID mismatch.
- `start-adb`: starts the ADB server using the configured SDK or consumer PATH and Android environment. No device, app ID or native project is required. It does not select/install/uninstall an app. Dry-run plans the operation; protected environments still require authorization.
- `inspect --artifact <config-root-relative.apk> [--format text|json]`: read-only report of an existing APK from the Android SDK's `aapt2 dump badging`: package ID, version name and code, minimum and target SDK, whether it is debuggable, declared permissions and the permissions the platform implies. `aapt2` comes from the newest installed `build-tools` of `android.sdkRoot`, `ANDROID_SDK_ROOT` or `ANDROID_HOME`, else from PATH. With `--format json` stdout holds only the JSON object (`packageName`, `versionName`, `versionCode`, `minSdk`, `targetSdk`, `debuggable`, `permissions`, `impliedPermissions`; step lines and the banner go to stderr). It decides nothing: which permissions or versions are acceptable is a check in your project. App bundles are not supported, and it does not verify the signature.

## Stores

`store.root` defaults to config root; normally set it to `store`. The existing Fastlane metadata tree lives at `<store.root>/fastlane`. Required `locales` are strings or `{ app, android, ios }` mappings. `defaultLocale` / `defaultLocales` choose primary folders, `appLocales` can check catalogue coverage, and `iosDevices` selects required iPhone/iPad/watch screenshot groups (default iPhone).

`storeLocales(['en', 'es', 'zh'])` (exported by `reusable-dev-scripts`) turns app language codes into `{ app, android, ios }` entries with the Google Play and App Store folder names, so a project does not keep its own table. It maps the base language to the most widely used region (Spanish es-ES, Portuguese pt-BR, Chinese Simplified zh-CN and zh-Hans), accepts `overrides` for another region, and refuses Traditional Chinese or an unknown language instead of guessing.

Credentials and identities: `androidId`, `iosId`, `playKey`, `appleKey`; key paths are relative to **config root**, never shipped or generated here. By default they must stay inside the project. Explicit `allowExternalCredentials: true` also permits **absolute** external filenames for these two fields only. Relative traversal remains rejected. No key content is read/copied during config loading or dry-run; real Fastlane operations read the referenced files. This opt-in does not affect outputs, native artifacts, gem caches or other paths. `versionPackage` is also config-root-relative. Optional `iosProject` and `iosScheme` configure the TestFlight archive. Build-kind specific settings live in the top-level `buildSettings` section (see Build settings below). Android artifact settings use the Android module.

- `scaffold`: creates missing directories/text placeholders without overwriting.
- `check --platform android|ios|all --scope text|media|all [--strict] [--all-locales]`: text limits, required fields, locale layout, image sizes, screenshot sets, preview codecs/durations, etc. Preview probing requires ffprobe. Requirements are a versioned snapshot tied to the shipped Fastlane lockfile.
- `changelog [--version-code N] [--text <notes>] [--force]`: copies localized iOS release notes into Play changelogs, enforcing length and keeping existing copy.
- `export --platform android|ios [--output <store-relative-csv>]`: UTF-8 BOM CSV.
- `upload-listing --platform ... --only ...`: text (default), Android images, iOS screenshots/previews, or all. Strict scoped checks always run first.
- `upload-build --platform ... [--testflight-only]`: Android internal AAB or macOS-only TestFlight archive/upload. A normal TestFlight build is an App Store archive that can also be chosen for a public release in App Store Connect. `--testflight-only` (iOS only; the lane option `testflight_only:true` does the same) exports it with Xcode's TestFlight internal-testing-only option (`testFlightInternalTestingOnly`), so App Store Connect never offers that build for an App Store version or external testing. It is opt-in and changes nothing by default. Apple reports that the setting is not applied in every setup, so confirm after the first upload that the build is marked internal and is absent from the version's build picker. The Play release defaults to `completed`, so internal testers get the build as soon as Play processes it; `--status draft` leaves it as a draft instead (needed while the app has never been published). TestFlight builds go to internal testers (automatic-distribution groups, plus any `--groups`) and never to external testers. These two are the only lanes that make anything available to testers: all listing uploads only fill the store drafts. Public tracks, partial rollouts and review submission are not supported. `--groups` selects TestFlight internal groups. These uploads do not require a finished marketing listing; `hooks.beforeUpload` can add app readiness checks. `store.hooks.afterBuildUpload` (argv hooks, project root, `{platform}` substituted) runs once the internal lane has succeeded, and only then: not for listings, not for a failed upload, and not when `commit:false` or `validate:true` is passed through `store run`. It is the place for project-owned follow-ups such as committing the bumped version files; `rds` itself never touches Git. `hooks.beforeUpload` runs before every upload as before.
- `pull` downloads metadata into `fastlane/downloaded`, not the source listing.
- `doctor` verifies authentication and the app/tracks/editable version.
- `verify [--platform android|ios|all] [--scope text|media|all] [--version-code N]`: read-only comparison of the local listing files with the draft in each store, so you can tell whether an upload is needed. Defaults to every configured store (`all`) and all content. Android compares title, short/full description and video per language plus every graphic by SHA-256 (the Play edit is always aborted). The `text` scope also compares the Play release notes: every language that has a non-empty `<locale>/changelogs/<versionCode>.txt` is compared with the notes of each track release (production, internal, ...) that contains that version code. The version code is `--version-code`, else the one derived from the package version as in `changelog`; when the build is on no track yet this is reported without failing, and a language missing from the release is a difference. iOS compares the editable version's description, keywords, promotional text, What's New and support/marketing URLs, the name, subtitle and privacy URL, and every screenshot and preview by MD5, and lists media still processing. Only items that have a non-empty local file are compared, and What's New is skipped on an app's first version, as in the upload. It prints a per-store summary plus each difference and exits non-zero on any difference, missing locale or extra store media, so it can serve as a `production.verify` step. It never uploads or submits.
- `run -- lanes` or `run -- <platform> <shared-lane> [key:value ...]`: controlled access to shared lanes only. Cannot skip checks, commit, run arbitrary actions, or submit for review. TestFlight has no validation-only upload; use dry-run.

Set `STORE_RUBY` if Ruby >=3.3 isn't on PATH. macOS Homebrew installations are discovered. Bundler must already be installed. rds checks/installs the shipped locked gems under `.rds/gems` and generates only a one-line local import shim. Use `--dry-run` to preview; it is not a store-side validation API.

## Store media

`media` makes, previews, checks and renders every store image from base designs you own. Configure `media` (see [Store media](configuration.md#store-media)); everything lives below `media.root` (default `media`): `base/` designs, `shared/` kit, `copy/<lang>.json` words, `captures/<lang>/` app screens, `review/` contact sheets. Final images go to the store tree when `store` is configured (`<store.root>/fastlane/...` for Google Play and App Store, `<store.root>/artwork/<platform>/...` for images uploaded by hand) and to `<media.root>/out` otherwise. The workflow is `scaffold`, then `view` while you design, `capture` when screens change, `render`, `check`, `sheet`, and finally the existing `store upload-listing`.

The built-in catalog covers Google Play (`android.icon`, `featureGraphic`, `phone`, `tablet7`, `tablet10`, `wear`), the App Store (`ios.iphone`, `ipad`, `watch`), the Mac App Store (`mac.screenshots`) and the Microsoft Store (`windows.screenshots`, `tile`, `boxArt`, `poster`, `superHero`). Sizes and limits come from the stores' published specifications and, for Google Play and the App Store, from the table `store check` uses. `media.platforms` chooses catalogs (default android and ios), `media.assets` and `media.exclude` narrow them, `media.sizes` picks another accepted size, and `media.custom` adds images the catalog lacks (a site link preview, a promo banner). Google Play and App Store images are uploaded by the store lanes; the Mac and Microsoft Store images are written for a manual upload in App Store Connect and Partner Center.

A design is an HTML page at `base/<asset id>.html` (or another path in `media.designs`), or a `.png`/`.svg`/`.jpg`/`.webp` master that rds resizes. A page receives `?lang=<app code>&asset=<id>&width=&height=`, and every `[data-slide]` element on it becomes one image of the set (the whole page when it has none). A page that sets `<body data-ready="0">` and later `data-ready="1"` tells rds when it is finished; any other page is ready once it, its fonts and its images have loaded. Every media server also offers `/_rds/devices.css`, device frames for app screens (`<div class="rds-device" data-device="iphone|android|tablet|watch|watch-round" style="--device-width: 900px"><img class="rds-screen" src="…"></div>`, optionally with `<span class="rds-status" data-time="9:41"></span>` for a status bar): pure CSS that loads nothing, sized by `--device-width`, and part of the render fingerprint. Pages are rendered by headless Chromium through the project's own Playwright (`npm install --save-dev playwright`, `npx playwright install chromium`); rds bundles no browser.

Microsoft Store screenshots must be screenshots of the app itself, so `windows.screenshots` never has a design: `media.scenes` lists captures that are copied untouched (no frames, text, padding or scaling) and refused when their size is outside the Store's range. Assets for which a store allows both can opt into captures with `media.sources`.

- `list [--platform p] [--assets a,b]`: the enabled assets, their sizes, counts, origin and how many files are rendered.
- `scaffold [--platform p] [--assets a,b] [--force]`: writes the shared kit, the default language's `copy/<lang>.json`, a blank correctly sized design for every design-sourced asset, and a documented `media.capture.module` skeleton. Nothing existing is overwritten without `--force`.
- `view [--port n] [--locales a,b]`: serves a local viewer on `127.0.0.1` (default port 5177, `media.viewer.port`) and prints its address. Choose an asset and a language, see the live design with the store's keep-clear guides, the exact final images, and a store listing mock (Google Play, App Store, Mac App Store, Microsoft Store) built from those renders and the listing text found under the store tree, and *Languages*: the asset's final images in every language at once, one row per language with the whole set side by side (the default language first, rendering one language after another). Every slide of a design and every final image is its own tile, so only the page scrolls: a header control zooms the whole view (relative to the size that fits the window; the listing mock relative to its own size, Ctrl + wheel outside an image does the same), and each tile has its own zoom under it (−, level, +, Reset), Ctrl + wheel over it zooms around the pointer, dragging pans and double-click resets. It refreshes when a file under `media.root` or `media.serve` changes and writes nothing.
- `capture [--locales a,b] [--scenes a,b]`: runs `media.capture.module` for every scene and language in its own browser context and writes `captures/<lang>/<scene>.png`. The module is project code, so it can mock the network, seed storage and drive the app; rds only supplies the browser and takes the picture. `baseUrl` must be a local address unless `capture.allowRemote` is true.
- `render [--platform p] [--assets a,b] [--locales a,b] [--force] [--check]`: renders every selected asset and language, applies the store's rules (exact size, no transparency where forbidden, file size limit, image count, ordered two-digit names), writes the files and removes numbered files left from an earlier, longer set. Work is incremental: a set is skipped while the content of its inputs (everything under `media.root` and `media.serve`, that language's copy and captures, the asset's settings and the rds version) is unchanged and its files exist; `--force` renders anyway. `--check` renders nothing and exits non-zero when any set is stale, for CI. All problems are reported together, and a set that breaks a rule is never written. Assets set once (the Play icon, text-free Microsoft Store art) are produced for the default language only.
- `check [--platform p] [--assets a,b] [--locales a,b] [--strict] [--all-locales]`: verifies finished images against the specifications (count, size, format, file size, transparency, mixed sizes) and compares each `copy/<lang>.json` with the default language's keys. Only the default language must be complete, because both stores show its images where a language has none; `--all-locales` requires every language, and `--strict` fails on anything still missing.
- `sheet [--platform p] [--assets a,b] [--locales a,b]`: one contact sheet per language, `review/<lang>.png`, with a row per asset.

`media.hooks.beforeRender` and `afterRender` run argv hooks around a render that has work to do. `media.clock` fixes the page's date and time, `media.offline` blocks every request except to rds's own local server, and `media.jobs` (default 2) sets how many sets render at once. The server behind `view` and `render` serves only `media.root` and the directories in `media.serve`, answers GET and HEAD only, and refuses requests whose Host is not its own loopback address. Preview video checks stay in `store check`; uploading stays in `store upload-listing`.

## VS Code and browser extensions

`vscode: { root?, prepare?, output?, noDependencies? }`: `package` builds one VSIX; `publish --registry marketplace|openvsx|all` publishes that exact file. `--bump` explicitly changes the version first, with the same npm lockfile behavior described under [Capacitor](#capacitor). Registry defaults to both. Leave compilation/tests local and supply `prepare` argv commands if needed. Keep `vscode:prepublish` pointing to compilation, **not** `rds vscode package`, to avoid VSCE lifecycle recursion. Provide `VSCE_PAT` / `OVSX_PAT` via environment.

`browser: { root?, directory, output, prepare? }`: `browser package` checks the manifest and archives its built directory as a ZIP. Symlinks, an output inside the input tree, and inputs exceeding 256 MiB are rejected. It neither signs CRX files nor uploads to a browser store.

## Electron

`electron: { root?, url?, start?, assets?, output?, builderConfig?, prepare?, notaryProfile? }`. Assets use the same image output shape as Capacitor's web outputs, plus `assets.ico` / `assets.icns` output paths for genuine multi-resolution Windows/macOS containers. `assets.windowsCornerRadius` optionally rounds ICO artwork (0–0.5). AppX tile composition remains an app-owned recipe. `prepare` contains the actual frontend build prerequisites.

- `dev` owns a local frontend server, waits for it, launches Electron, and stops its server when the app exits. `start` defaults to Vite; `url` must be loopback.
- `clean`: cleans only `electron.output` (default `release/desktop`), then recreates its ownership marker. An existing unmarked directory is rejected, including in dry-run. Never mark or delete old output automatically to bypass this check; an operator must choose a fresh output or handle legacy files.
- `build --platform mac|windows|linux --arch arm64|x64|all --format <format>` runs electron-builder with `--publish never`. `--unsigned` explicitly disables identity discovery. `--clean` only cleans a rds-owned output directory.
- `notarize --artifact <file> [--staple <path>] [--profile <keychain-profile>] [--preflight]`: uses macOS notarytool, waits, then staples and validates. The profile comes from `--profile`, then `APPLE_NOTARY_PROFILE`, then `electron.notaryProfile`; Apple ID passwords are never accepted. A DMG or PKG is stapled itself. A ZIP cannot be stapled, so `--staple` names the contained `.app` (stapling a DMG or PKG other than the artifact also works). The staple target is resolved before submission, so a typo cannot waste a notarization. `--artifact` and `--staple` may use one `*` wildcard in the last path segment, which must match exactly one item (for example `release/desktop/*-mac-Intel.zip`). A full ZIP-then-DMG release is two invocations: the ZIP with `--staple` for the app, then the DMG.
- `check-signing-identity [--identity <name>]`: optional macOS preflight before a signed build. Takes the certificate name from `--identity`, else `CSC_NAME`, without the `Developer ID Application:` prefix (for example `Example Company (TEAMID1234)`), and fails unless `security find-identity -v -p codesigning` lists exactly that valid identity. It signs nothing, does not print the keychain's identities, and is separate from `notarize --preflight`, which checks notarization credentials. It does not apply when the certificate is supplied to electron-builder as a file (`CSC_LINK`), and it covers Developer ID only, not Mac App Store certificates.

`electron assets` also accepts `assets.copies` as described under [Assets](#assets), relative to `electron.root`; a copy may take a generated `ico` or `icns` as its input.

## Swift

`swift: { root?, executable, plist, entitlements, resources?, output?, identity?, icon?, iconOutput? }`. All operations require macOS, except dry-run.

- `icons`: PNG → iconset → ICNS using iconutil, without app-specific web copying.
- `bundle`: SwiftPM release product → `.app` layout → explicit entitlements → signing → codesign verification. Identity defaults to local ad-hoc `-`, not a distribution signature. `--open` launches the actual bundle, not `swift run`. Regenerate Store/direct source trees locally before bundling. Existing output directories must have been created by rds before rds will replace them.

## Cloudflare

`cloudflare.targets` maps names to `{ kind: 'worker'|'pages', root?, config?, directory?, projectName?, prepare?, secretsFile?, secretNames?, secretsModule?, commitDirty?, zoneId?, wwwRedirect?, redirectRef?, d1Database? }`.

Select `--target` when more than one exists. **An environment is required** (pass `--env`, or set the top-level `defaultEnvironment` for a project with only one) unless the project configures no environments at all, in which case the neutral `default` is used (see [single-environment projects](configuration.md#single-environment-projects)). Worker `config` and Pages `directory` are target-root-relative. Preparation hooks run in config root. Secrets files are **config-root-relative**.

- `deploy-worker`: explicit Wrangler config + environment. The environment is passed to Wrangler as `--env`; set the target's `wranglerEnv` to another name, or to `false` when the Worker only has top-level configuration.
- `deploy-pages`: built directory + project name + branch; branch is the target's `branch`, else `main` for production, else the environment name. `commitDirty: true` adds `--commit-dirty=true` so Wrangler deploys from a working tree with uncommitted changes without its warning; the default leaves Wrangler's behavior unchanged.
- `migrate-d1`: `wrangler d1 migrations apply <d1Database> --remote` with the Worker target's explicit config and environment (`--env`, `wranglerEnv`), behind the same production guard and `prepare` hooks as `deploy-worker`. `d1Database` is the database name.
- `d1-status`: lists migration files not recorded in the selected remote database. Uses the same target, Wrangler config and environment resolution as `migrate-d1`, but requires an explicit `database_id` on the matching binding. Reads only the schema and migration table; it does not initialize the table, apply SQL files, or run hooks. If the table is absent, every matching local file is pending.
- `status [--branch <name>]`: shows the active Worker deployment and its version percentages, or the canonical production deployment / newest successful preview for the exact Pages branch. The optional branch override is only for Pages. Status makes no updates and does not run hooks.
- `promote --version-id <uuid> --yes`: sends 100% of the selected Worker's traffic to an existing version without building or uploading it. `rollback --version-id <uuid> --yes` does the same for a version that served traffic in that Worker's recent deployment history. For Pages, use `rollback --deployment-id <uuid> --yes` on the configured production branch; preview deployments cannot be rolled back or promoted. See [release inspection and control](hosting.md#release-inspection-and-control) for guards and prerequisites.
- `setup-pages`: creates the Direct Upload project and its custom domains (needs `--yes`). With `zoneId` it also keeps a proxied CNAME from each domain to `<projectName>.pages.dev`: a missing record is created, an unproxied one is made proxied, and a record that points anywhere else fails the command instead of being re-pointed. `wwwRedirect: true` (requires `zoneId` and exactly one domain, which must be the zone apex or the step is skipped) additionally keeps a proxied `www` CNAME to the apex and a Single Redirect rule identified by `redirectRef` (default `rds_www_redirect`): 301, path and query kept. Other redirect rules in the zone are never changed. A pre-existing `www` record that is not exactly that CNAME fails the command.
- `push-secrets [--secrets-file <path>]`: reads the secrets file, optionally applies the project's own rules, checks an explicit name allowlist and sends JSON on stdin to `wrangler secret bulk`. Other variables cannot be uploaded. The order is: production guard, read and parse the file, `secretsModule`, then the `prepare` hooks, then the upload, so a rejected file causes no side effects. `--secrets-file` replaces `secretsFile` for one run and must stay inside the project.

  The file is `.json` (an object) or NAME=value lines read **strictly**: a line that is not `NAME=value`, a repeated name and an unterminated quoted value are errors (naming the line or variable, never a value); names are upper-case letters, digits and underscore; a value may be quoted with `"`, `'` or a backtick and then continues over lines until one ends with that quote; `
` becomes a newline; an unquoted value ends at the first `#`, as in Node's own dotenv parser. `parseSecretEnv` is exported from the package and from `reusable-dev-scripts/secret-env` so project scripts read the same file the same way.

  `secretsModule` names a project module (config-root-relative) that holds the rules rds cannot know. It exports `secrets({ environment, target, file, root, values })`, where `values` is the parsed file (a frozen copy) and `file` its absolute path. It throws to stop the upload (the message must not contain a value) and returns the values to upload: the input plus anything the project derives or overrides, for example a credential read from another reviewed file. Only names in `secretNames` are sent; every one must be present and non-empty. Typical rules: the file must declare which environment it belongs to, a development file is refused, strength and uniqueness checks, cross-environment reuse, and validity checks such as a PEM parse. A dry-run reads no file and loads no module.

Bunny.net has no command family: `reusable-dev-scripts/bunny` exports the mechanics (API client, edge script bundling, verified script deployment, DNS-only CNAME) for a project script that owns the zone, rule and check policy. See [verifying a published Bunny script](hosting.md#verifying-a-published-bunny-script).

No infrastructure provisioning, database wiping, app configuration generation or account inference is performed. Preserve existing security/header/domain policy in the consuming project.

## Local development

These families cover the mechanics most projects rewrite for local work. They hold no application policy: commands, endpoints, defaults and validation rules come from your configuration or your own module.

### Tool resolution

Commands and hooks resolve `pnpm` through the running pnpm when rds was started by it, so `rds exec -- pnpm …` and `dev.processes` work on Windows without a `.cmd` shim. `rds` resolves to the installed toolkit's own CLI, which allows a hook such as `['rds', 'env', 'check', '--env', '{env}']`. On Windows a bare command name is looked up on `PATH` as `.exe`, `.cmd` or `.bat` the way a shell would, and batch files keep the existing argument checks.

### Dev processes

`rds dev start`

`dev: { root?, processes: [{ name, command, root?, environment?, optional? }] }`. Every process starts at once with an argv `command`, run in `dev.root` (or the process `root` inside it), and its output is printed line by line with a colored `[name]` prefix. `environment` accepts the same `{env}` / `{root}` placeholders as other environment mappings, and `FORCE_COLOR=1` is set so tools keep their colors in a pipe.

The first process to end ends the session: the others receive SIGTERM and the result is the first process's result. Ctrl+C is a normal stop and exits 0. Dry-run lists the processes without starting them. Names must be unique. Add `--env` to select the value of `{env}`.

An entry with `optional: true` is skipped unless `--with name[,name]` names it; an unknown or non-optional name is an error.

`rds dev tabs` opens each selected process in its own terminal tab and returns instead of supervising them: `{env}`/`{root}` substitution, working directories, environment values and `--with` work as for `dev start`. Each tab runs a shell line built from the argv (every argument quoted individually) and keeps the shell open when the process ends. Windows needs Windows Terminal (`wt`) and uses Git Bash when installed, otherwise PowerShell; macOS drives Terminal.app (it needs automation permission); Linux uses the first of gnome-terminal, konsole, xfce4-terminal (tabs), then x-terminal-emulator or xterm (one window per process). The launched processes are not stopped by rds. Dry-run plans the launch without opening anything.

### Waiting for a service

`rds wait tcp [--target <name>] [--timeout <seconds>]`

`wait: { targets: { <name>: { host?, port?, url?, variable?, envFile?, timeout?, hint? } } }`. A target is a `host` and `port`, a `url`, or a `variable` holding a URL, read from the process environment first and then from `envFile` (dotenv, relative to the config root). The port falls back to the scheme default for HTTP, MySQL, PostgreSQL, Redis, MongoDB and AMQP. `--target` is optional when there is a single target. The default timeout is 90 seconds, retried every second.

Only the host and port are printed, never the URL or its credentials. `hint` is appended to the failure message. Dry-run does not connect.

`rds wait http [--target <name>] [--timeout <seconds>]`

Uses a configured `url` or `variable` with optional `envFile` (same precedence as TCP), not a bare host and port. Sends GET, expects the exact `status` (default 200), and optionally checks an exact response-header value with `marker: { header: 'x-release', value: '2026-01' }`. Set the header in the application you want to check; the command does not interpret the body. It uses the first response without following redirects, always verifies HTTPS certificates, and rejects URL userinfo and fragments. URL contents, headers, response bodies and marker values are not printed. Each attempt is limited to five seconds within the overall timeout (default 90 seconds), with up to a second between attempts. Dry-run neither reads the URL variable/file nor makes a request.

### Environment files

`rds env template|validate|generate|check --env <name>` (`--env` may be omitted when `defaultEnvironment` is configured)

`env: { module, directory?, environments?, autoCreate?, hints? }`. Each environment has an editable, uncommitted file at `<directory>/<name>.json5` (default `.gitignored/environments`; comments and trailing commas are allowed) and one or more generated files. `--env` is mandatory and must be one of `environments` (default `development`, `staging`, `production`).

The project owns policy in the module named by `module`, an ES module relative to the config root:

```js
import { randomSecret } from 'reusable-dev-scripts'

export const defaults = (env) => ({
  apiUrl: env === 'development' ? 'http://localhost:3000' : null,
  jwtSecret: randomSecret(),
})
export const validate = (env, config) => (config.jwtSecret.length < 32 ? ['jwtSecret must be at least 32 characters'] : [])
export const outputs = (env, config) => [{ path: `.env.${env}`, content: `API_URL=${config.apiUrl}\n` }]
```

- `template` creates or extends the file: existing values always win, new defaults are merged in, and a `null` marks a value a human must supply. Comments are not preserved when the file is rewritten.
- `validate` fails for every remaining `null` and for each problem returned by `validate`.
- `generate` validates, then writes the files returned by `outputs`. Only environments listed in `autoCreate` (default `development`) create a missing editable file; others stop with the command from `hints.template`.
- `check` validates and fails if a generated file is missing or differs, naming the command from `hints.generate`. It never writes, so it is suitable for `production.verify`.

`hints` customizes the commands shown in messages, for example `{ generate: 'pnpm {env}:generate' }`. `parseJson5`, `mergeDefaults` and `randomSecret` are exported for modules and scripts that read the same files. Generated files contain secrets: keep them and the editable files ignored by Git. Dry-run plans writes without performing them.

### Prisma migrations

`rds prisma migrate|status --env <name> [--confirm-host <host>]` (`--env` may be omitted when `defaultEnvironment` is configured)

`prisma: { root?, envFile, variable? }`. The database URL is read from `variable` (default `DATABASE_URL`) in `envFile`, a dotenv path relative to the config root where `{env}` becomes the environment. Generate that file first, for example with `rds env generate`. `migrate` runs `prisma migrate deploy` and `status` runs `prisma migrate status` from `root`, using the project's own `prisma` package. The URL is handed to Prisma through its environment, never logged; the host is shown.

`migrate` is a mutation guard: a protected environment needs `--allow-production` and passes the production verification hooks. It then needs the database host as confirmation, either typed at the prompt or given as `--confirm-host`; without a terminal the flag is required. A host that does not match stops the command before Prisma starts. Local development databases keep using your own `prisma migrate dev` script. Dry-run plans without reading anything beyond the environment file.

### PlatformIO

`rds platformio -- <pio arguments>`

`platformio: { root?, coreDir? }`. Runs the PlatformIO CLI from `root` (default: the config root) with exactly the arguments after `--`, for example `rds platformio -- run -e esp32` or `rds platformio -- pkg exec -p tool-esptoolpy -- esptool chip-id`. The executable is `PLATFORMIO_CMD` when set (an unusable value fails; it is never replaced by another installation), otherwise the `pio` in the `penv` of the PlatformIO home in use (`PLATFORMIO_CORE_DIR`, or `coreDir`) when it has one, then `pio` or `platformio` on PATH, the official installer's `~/.platformio/penv`, `~/.local/bin`, and on Windows the user Python Scripts folders. `coreDir` (absolute, or relative to the config root) is exported as `PLATFORMIO_CORE_DIR` unless it is already set, which is how a project keeps the toolchain cache outside the default location.

The tool's standard output is passed through unchanged so callers can parse it (for example JSON from `espefuse`); rds reports its own step line on standard error for this command, and result banners also go to standard error. The exit status is the tool's. The command has no environment, production guard or hooks: it is a launcher, and projects that flash or sign devices put their policy in the script that calls it. Dry-run plans without requiring PlatformIO to be installed.

### ESP32 firmware size

`rds esp32 check-size --artifact <firmware.bin> --partitions <partitions.csv> [--slot <name>] [--min-free-bytes <n>] [--format text|json]`

Read-only check of an already built binary against its partition table, for CI or before a release; it needs no configuration, PlatformIO installation or device. The budget is the smallest OTA app partition (`ota_0`…`ota_15`), or the app partition named by `--slot` for a layout without OTA. It fails when the binary leaves fewer than `--min-free-bytes` (default 0, plain bytes) in that budget. Both paths are relative to the config root (or the working directory without a config). Sizes may be decimal, hexadecimal or use `K`/`M`. It does not build, flash, sign or validate offsets, and does not know whether the table is the one the build used.

`--format text` (default) prints one line for people. With `--format json` stdout holds only a JSON object, so a script does not parse text (step lines, errors and the banner go to stderr):

```json
{ "artifactBytes": 912384, "budgetBytes": 1310720, "freeBytes": 398336, "minFreeBytes": 0, "fits": true, "slots": [{ "name": "ota_0", "bytes": 1310720 }, { "name": "ota_1", "bytes": 1310720 }] }
```

`slots` are the partitions that were considered and `budgetBytes` is the smallest of them. A binary that does not fit still prints the object, with `fits: false` and a possibly negative `freeBytes`, and the command exits non-zero. Invalid arguments, missing files and unusable partition tables print no JSON.

## App links

`rds app-links generate` writes, and `rds app-links check` compares, the two files Android App Links and Apple Universal Links fetch from a website:

```js
appLinks: {
  directory: 'web/public',
  android: [{ packageName: 'com.example.app', fingerprints: ['00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF'] }],
  apple: [{ teamId: 'TEAMID1234', bundleId: 'com.example.app', paths: ['/open/*'] }],
}
```

Files go to `<directory>/.well-known/assetlinks.json` and `apple-app-site-association`, relative to the config root. Every identity, SHA-256 certificate fingerprint and path pattern is explicit: nothing is read from signing keys or native projects. Configure only the platforms you publish. `check` compares what the files declare, so formatting, line endings, component comments and an empty legacy `apps` list do not matter; order does, because Apple uses the first matching component. `generate` leaves an equivalent file untouched and refuses, before writing anything, to overwrite a file that declares something it does not manage (`webcredentials`, `appclips`, exclusions or query components, other Android relations or targets) or is not valid JSON; keep maintaining such a file yourself. Neither command changes DNS, headers, entitlements, manifests or signing, deploys, or verifies the hosted URL. Serve both files over HTTPS without redirects, with a JSON content type.

## Hosting resources and API-token deployments

Cloudflare Pages project creation and Hostinger Web/Cloud deployment mechanics are shared commands. See [the hosting guide](hosting.md) for typed targets, credentials, dry-run behavior, provider prerequisites, and safety boundaries. Application seeds, mock/demo policy, database migrations at build time, and content-retention decisions remain in the consuming project.

`rds hostinger status [--target <name>] [--build-id <uuid>]` reads the latest Node.js build or the specified build for the configured site and account. It prints only the site, ID and provider state (pending, running, completed or failed), or reports no builds. A failed build is a reported state, not a failed status lookup. No `envFile`, deployment CLI, build logs, hooks or production-write approval are needed; a completed build is not an application health check.

## Destructive hosting reset

Use `rds hosting reset --env staging --yes --confirm-host api-stage.example.com --confirm-project example-stage` only for explicitly disposable, dedicated targets. `--dry-run` is write/request-free, `--check` is read-only remote preflight, and `--resume` continues the ignored output journal after a partial failure. Protected environments are forbidden. See [hosting resource recreation](hosting.md#destructive-hosted-resource-recreation) for scope, confirmation flags, `--output`, temporary-domain changes and consumer responsibilities.


`rds hosting drop` stops after the destructive half (DB is always discarded); optional `--keep-pages` leaves frontend resources unchanged. `rds hosting recreate` continues that exact journal without repeating deletion. Both use reset's exact confirmations/guards/output and read-only preview modes. No keep-db flag is supported. See [split hosted lifecycle](hosting.md#drop-now-recreate-later).

## Build settings

The top-level `buildSettings` section lets a project change what is compiled per platform and kind of build, for example to include diagnostics in a build that can never be released while every other build stays the exact release binary. Entries are `NAME=value` strings, and nothing is applied unless configured.

```js
buildSettings: {
  android: {
    all: [],                                // every Android build
    debug: [],                              // --configuration debug
    release: [],                            // --configuration release
    'internal-only': ['diagnostics=true']  // any other lowercase name; selected with `android build --kind internal-only`
  },
  ios: {
    all: [],                                // every iOS archive
    release: [],                            // a normal App Store / TestFlight archive
    'testflight-only': ['SWIFT_ACTIVE_COMPILATION_CONDITIONS=$(inherited) DIAGNOSTICS'] // `store upload-build --testflight-only`
  }
}
```

- A build receives the platform's `all` list followed by the list of its own kind. Android applies the configuration list (`debug` or `release`) and then the `--kind` list; naming a kind that is not defined is an error. A kind that is not configured changes nothing.
- Android entries become Gradle project properties (`-PNAME=value`), read in `build.gradle` with `project.findProperty('NAME')`, for example to set a `BuildConfig` field or a manifest placeholder. iOS entries are appended to the Xcode archive arguments, shell-escaped so `$(inherited)` reaches Xcode literally.
- Signing, version and build-configuration settings (iOS `CODE_SIGN*`, `DEVELOPMENT_TEAM`, `PROVISIONING_PROFILE*`, `PRODUCT_BUNDLE_IDENTIFIER`, `MARKETING_VERSION`, `CURRENT_PROJECT_VERSION`, `CONFIGURATION`, `SDKROOT`, `ARCHS`; Android `android.injected.*` and names containing signing, keystore, password, alias or version code/name) are rejected when the configuration loads.
- iOS can enforce that a `testflight-only` build never ships: Xcode exports it as internal-testing-only. Android has no such enforcement; Google Play lets any internal-track build be promoted, so keep a custom Android kind out of production by process (never promote it) or distribute it outside Play.
