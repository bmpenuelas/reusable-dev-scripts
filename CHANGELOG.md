# Changelog

Behavior that consumers can notice. Pin an exact version and read the relevant entry before upgrading.

## Unreleased

- Added the top-level `buildSettings` section: `NAME=value` settings per platform and build kind. iOS kinds are `all`, `release` and `testflight-only` (Xcode build settings appended to the archive, so a project can compile in diagnostics that must not ship while a normal TestFlight or App Store build stays the exact release binary). Android kinds are `all`, `debug`, `release` and any project-defined name selected with the new `android build --kind <name>` (Gradle project properties `-PNAME=value`). Off unless configured; signing, version and build-configuration settings are rejected when the configuration loads. Tested through the dry-run plan and the Fastfile source; not run against a real Xcode archive or Gradle build.
- Added `store upload-build --platform ios --testflight-only` (lane option `testflight_only:true` on `store run -- ios internal`): the build is exported with Xcode's internal-testing-only option so it cannot be selected for an App Store release or external testing. Off by default, so existing uploads still produce builds that are eligible for release. Verified against the shared Fastfile and lane validation only; not run against a real App Store Connect account.

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
