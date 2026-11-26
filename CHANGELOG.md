# Changelog

Behavior that consumers can notice. Pin an exact version and read the relevant entry before upgrading.

## 0.10.0

- Added `esp32 check-size --format text|json` (default `text`). With `json`, stdout holds only the measured sizes, also when the binary does not fit its budget (`fits: false`, non-zero exit).
- `assets.copies` (`capacitor` and `electron`) destinations may now be anywhere inside the config root, for example a web app next to the module root (`../web/public/icon.png`). Paths stay relative to the module root, sources must still be inside it, and traversal or symlinks leaving the config root are still rejected. **Behavior change:** a destination outside the module root but inside the config root was an error before.
- Added `bundleLocalizations` to `capacitor.localeRegistration.ios.targets`: the languages `CFBundleLocalizations` lists when an app has more than its string files, such as a web UI. It must include every iOS locale; `check-locales` and `register-locales` keep using the iOS locales for everything else. Without it nothing changes. Tested with synthetic projects; no Xcode build was run.

## 0.9.0

- Added `capacitor check-locales` and `capacitor register-locales` with the `capacitor.localeRegistration` section: the check reads Android's locale config and manifest attribute, Xcode `knownRegions`, localized variant groups and target membership (or synchronized folders), the `.lproj` files and `CFBundleLocalizations` for explicitly listed targets and files, and reports missing and stale languages. `register-locales` is the separate, optional writer for the standard layout: it verifies the complete result before writing anything, preserves line endings, is idempotent and never deletes translation files or creates targets, groups or build phases. Neither runs during `sync`. Tested with synthetic projects; no Xcode or Gradle build was run on registered output.
- Added `file: 'InfoPlist.strings'` to Apple targets of `capacitor.locales`. **Behavior change:** two locale targets that resolve to the same output file are now an error instead of the last one silently winning.
- Added `assets.copies` (`capacitor` and `electron`): explicit source-to-destination copies, optionally `normalize: 'png'`, run after the generators and covered by `--check`. `assets.source` is now only required for resized outputs, desktop icons and native generation, and a `capacitor assets` dry-run no longer reads the source image.
- Added `app-links generate` and `app-links check` with the `appLinks` section for `assetlinks.json` and `apple-app-site-association` from explicit identities, fingerprints and path patterns. `generate` refuses to overwrite declarations it does not manage. Nothing is inferred, signed, deployed or changed in DNS.
- Added `android inspect --artifact <apk>` (package ID, version, SDK levels, debuggable flag and permissions from `aapt2`; `--format json` for project rules).
- Added `electron check-signing-identity`: macOS check that the Developer ID Application identity named by `--identity` or `CSC_NAME` is installed. Signs nothing. Tested against recorded `security` output, not run on a real keychain.
- Added `esp32 check-size`: a built binary against its OTA (or named) app partition and a minimum free-space budget.
- Added `wait http` for bounded, named HTTP readiness checks with an exact response status and optional release header, without printing URLs or response contents.
- Added `hostinger status` for a site's latest or named Node build and `cloudflare status` for Worker traffic or a Pages branch. `cloudflare d1-status` lists pending migrations without initializing a table or running migration SQL.
- Added explicit Cloudflare Worker promotion and Worker/Pages rollback. Release changes require confirmation and keep production guards; read-back verifies provider state, not application health. No automatic rollback or backing-data restore.
- Added the subpath export `reusable-dev-scripts/bunny` for project scripts that manage Bunny.net: a careful API client (reads are retried within bounds, writes never, redirects and response bodies are never followed or surfaced) for Pull Zones, edge rules, certificates, edge scripts and usage; `edgeScriptSource` (one self-contained edge script from ES modules, independent of line endings); `deployEdgeScript` (settings, encrypted secrets, draft and release, each read back, and refused for a script that is not the reviewed one, is linked elsewhere or holds a secret as a variable); and `cloudflareDnsOnlyCname` for one exact DNS-only record. There is no `rds bunny` command: what a zone, its rules and its checks should be is project policy. Tested against in-memory providers only.
- `rds platformio` now runs the PlatformIO home's own `pio` first: when `PLATFORMIO_CORE_DIR` is set or `platformio.coreDir` is configured and that home has a `penv`, its `pio` comes before PATH (`PLATFORMIO_CMD` still wins). An older `pio` on PATH no longer drives a home whose platforms need a newer PlatformIO Core. **Behavior change** for projects with `coreDir` whose home has its own `penv`.

## 0.8.0

- Added `storeLocales(codes, overrides?)`, exported from the package: the Google Play and App Store folder names for common app languages, validated against the fastlane versions the shared lanes pin, ready for `store.locales`. Unknown languages and Traditional Chinese must be given explicitly.
- Added the top-level `buildSettings` section: `NAME=value` settings per platform and build kind. iOS kinds are `all`, `release` and `testflight-only` (Xcode build settings appended to the archive, so a project can compile in diagnostics that must not ship while a normal TestFlight or App Store build stays the exact release binary). Android kinds are `all`, `debug`, `release` and any project-defined name selected with the new `android build --kind <name>` (Gradle project properties `-PNAME=value`). Off unless configured; signing, version and build-configuration settings are rejected when the configuration loads. Tested through the dry-run plan and the Fastfile source; not run against a real Xcode archive or Gradle build.
- Added `store upload-build --platform ios --testflight-only` (lane option `testflight_only:true` on `store run -- ios internal`): the build is exported with Xcode's internal-testing-only option so it cannot be selected for an App Store release or external testing. Off by default, so existing uploads still produce builds that are eligible for release. Verified against the shared Fastfile and lane validation only; not run against a real App Store Connect account.
- Added the `media` family and `media` configuration section for store images: `media list`, `scaffold`, `view`, `capture`, `render`, `check` and `sheet`. rds scaffolds blank, correctly sized base designs (HTML pages, or master images), previews them in a local viewer with store listing mocks and keep-clear guides, captures real app screens through a project capture module, and renders every final image per language into the store tree with the stores' rules enforced (exact sizes, no transparency where forbidden, file size limits, image counts, ordered names). Built-in catalogs cover Google Play, the App Store, the Mac App Store and the Microsoft Store, whose screenshots are copied untouched from captures and never get artwork; `media.custom` adds images the catalog lacks. Rendering is incremental by content hash and `render --check` fails when anything is stale. Browsers come from the project's own Playwright; nothing is bundled and nothing is uploaded. Design pages can link `/_rds/devices.css`, CSS device frames (iPhone, Android phone, tablet, Apple-style and round watches, optional status bar) that every media server serves and that count toward the render fingerprint. The viewer shows each design slide and final image as a separate tile with its own zoom (buttons, Ctrl + wheel around the pointer, drag to pan, reset), adds a whole-view zoom for Design, Store listing and Final images, and keeps a single scroll: design pages no longer scroll inside the viewer. Its *Languages* view shows the chosen asset's final images in every language at once, one row per language, to compare translations side by side.
- Capacitor and VS Code `--bump` commands now update the selected package's version entry in an existing shared npm workspace lockfile inside the config root. Sibling packages and the dependency graph are unchanged; no npm install, lifecycle scripts, commit, or tag are added to the bump.

## 0.7.0

- `cloudflare push-secrets` now reads NAME=value files strictly (new `parseSecretEnv`, also exported as `reusable-dev-scripts/secret-env`): malformed lines, duplicate names and unterminated quoted values are errors instead of being skipped or silently overridden. Names must be upper-case (`[A-Z][A-Z0-9_]*`, the same rule as the allowlist) and an `export ` prefix is rejected. Comments follow Node's dotenv parser (an unquoted value ends at the first `#`; a `#` comment may follow a closing quote). **Behavior change** for projects whose upload file relied on the old forgiving reading.
- Added the Worker target field `secretsModule` and `push-secrets --secrets-file <path>`. The module's `secrets({ environment, target, file, root, values })` adds project rules, may derive values, and throws to stop the upload before the `prepare` hooks run. The production guard now runs before the secrets file is read.
- Added `rds platformio -- <pio arguments>` and the `platformio: { root?, coreDir? }` section: runs the PlatformIO CLI inside `root`. It finds `pio` through `PLATFORMIO_CMD` (authoritative when set), then `pio`/`platformio` on PATH, then the official installer and pip user locations (on Windows the newest Python user Scripts directory, whatever its minor version). `coreDir` becomes `PLATFORMIO_CORE_DIR` unless the environment already sets one. The tool's stdout is left untouched so callers can parse it; rds writes its own step line to stderr for this command. A dry-run needs no PlatformIO installation.
- Added `rds dev tabs`: opens each configured dev process in its own terminal tab (Windows Terminal with Git Bash or PowerShell, macOS Terminal, GNOME Terminal, Konsole, Xfce Terminal, xterm) and returns. The shell stays open after a process ends. `dev start` is unchanged and still runs everything in one terminal with prefixed output.
- Dev processes can be `optional: true` and then start only when named with `--with name[,name]` (for both `dev start` and `dev tabs`).
- Added `capacitor.androidModules: [{ project, versionCodeOffset? }]`: further Gradle modules (for example Wear OS) receive the same version name and the native build number plus their own offset, so each form factor gets a distinct Play version code. `versions --check` covers them and the Android limit applies to the offset total.
- Added `cloudflare migrate-d1` (Worker target `d1Database`): `wrangler d1 migrations apply <name> --remote` with the target's explicit config and environment, behind the production guard.
- `cloudflare setup-pages` can now manage DNS: a Pages target with `zoneId` keeps a proxied CNAME from each `domains` entry to `<projectName>.pages.dev`, and `wwwRedirect: true` (one apex domain, optional `redirectRef`) also adds a proxied `www` CNAME and a Single Redirect rule from www to the apex that keeps path and query. An existing DNS record that does not already point at the project is never re-pointed: the command fails and asks you to change it. Targets without `zoneId` behave as before.
- Added the lightweight subpath export `reusable-dev-scripts/json5` (`parseJson5`, `mergeDefaults`, `isObject`) for scripts that only need to read the editable `.json5` files, without loading the whole toolkit and its image dependencies. The main entry still exports `parseJson5` and `mergeDefaults`.
- Fixed `parseJson5` (used by `env` files): trailing commas inside string values, such as `"a , }"`, were removed. Only commas outside strings are dropped now.
- `Invocation.detached` starts a program in the background and returns once it launched (used for terminal windows).
- The package now exports `formatResultBanner` and `supportsBannerColor` so a project-owned runner can print the same banner as the CLI, plus `tabLaunches` and `unixTabCommand`.

## 0.6.0

- `store verify` (scope `text` or `all`) now also compares Google Play release notes: each language with a local `changelogs/<versionCode>.txt` against every track release that contains that version code. The version code defaults to the one derived from the package version; `--version-code N` overrides it. A build that is on no track yet is reported, not failed. Projects that keep changelog files can now see new differences from `store verify`.

## 0.5.0

- Added top-level `defaultEnvironment` so single-environment projects can run `cloudflare`, `hostinger`, `hosting`, `env` and `prisma` commands without `--env`. `--env` wins when given; other commands never use it, and a default named `production` keeps the production guard.
- Projects that configure no environments at all (no `production` section, no `env` module, no per-environment target overrides) need no `--env` or `defaultEnvironment` for `cloudflare` and `hostinger`: the neutral `default` environment is used, the Pages branch is `main` and Workers get no Wrangler `--env` unless configured. `prisma`, `env` and hosting reset never fall back.
- Added Cloudflare target settings `branch` (Pages) and `wranglerEnv` (Workers: a name, or `false` to omit `--env`).

## 0.4.0

- Added `store.hooks.afterBuildUpload`: project-owned argv hooks that run after the store accepted an internal build upload. Skipped for listings, failed uploads, `validate:true` and `commit:false`. `rds` itself still never commits or pushes.
- `store run` accepts `commit:true|false` to decide whether `afterBuildUpload` runs.
- `electron notarize` gained `--staple <path>` to staple the `.app` inside a notarized ZIP, `*` wildcards in the last path segment of `--artifact` and `--staple`, and `APPLE_NOTARY_PROFILE` as a profile source (precedence: `--profile`, environment, `electron.notaryProfile`). The staple target is validated before submission.
- `android build` logs the R8 mapping and native debug symbols after a verified release build. `RDS_ANDROID_MAPPING` follows `android.module` instead of assuming `app`.
- `cloudflare.targets.<name>.commitDirty` adds `--commit-dirty=true` to `deploy-pages`.
- `rds hosting drop --help` and `hosting recreate --help` now list their own options.

## 0.3.0

- Added `store verify`: a read-only comparison of local listing files with the Google Play and App Store Connect drafts (text, graphics, screenshots and previews). It exits non-zero on any difference and can serve as a `production.verify` step.
- **Changed default:** `store upload-build` for Android now defaults to `status:completed` (internal testers receive the build as soon as Play processes it). Pass `--status draft` to keep the former draft behavior, which is required while an app has never been published.
- `android build --reveal` treats Windows Explorer's normal exit code 1 as success and only warns when revealing genuinely fails.
- Android installation steps have distinct labels.

## 0.2.0

- Added local-development families: `dev start`, `wait tcp`, `env template|validate|generate|check`, and `prisma migrate|status`.
- Added Cloudflare Pages setup, Hostinger setup/deploy and the destructive `hosting reset|drop|recreate` lifecycle for disposable environments.
- Commands resolve `pnpm` and Windows `.cmd`/`.bat` tools without a shell.

## 0.1.2

- Added configurable result banners (`output.banners`, `RDS_BANNERS`, `--banner`/`--no-banner`).
