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

Version files default to `android/app/build.gradle` and `ios/App/App.xcodeproj/project.pbxproj`, relative to Capacitor root; override with `androidProject` / `iosProject`. `packageJson` is relative to **config root**. The native build formula is `major*1_000_000 + minor*1_000 + patch`, minimum 1; minor/patch must be <=999 and Android's integer bound is enforced. iOS's existing integer build numbers are never decreased. Gradle settings already derived from package.json remain expressions. Unsupported version settings fail before bumping.

### Assets

`capacitor.assets` accepts `source`, optional `background`, `native` (default true), and `outputs: [{ path, width, height? }]` for PNG/JPEG/WebP outputs. Source artwork composition remains local. rds stages a PNG logo for the consumer's `@capacitor/assets` CLI. `--platform` can restrict native generation. `--check` compares web outputs and checks the native input/output hash snapshot; generate once after adoption before using check mode. Changing or deleting a recorded native asset makes the check fail. No stale/unknown resource directories are automatically removed.

### Locales

`capacitor.locales` is a normalized catalogue with `defaultLocale`, `locales: { en: { app_name: 'Example' }, ... }`, and output `targets`:

```js
targets: [
  { format: 'android', directory: 'android/app/src/main/res' },
  { format: 'apple', directory: 'ios/App/App' },
]
```

A target can map native keys to catalogue keys using `keys: { native_key: 'catalogue.key' }`. Additional targets can emit widget/watch/Wear resources. Generation checks translated placeholders, escapes XML/Apple strings, and emits BCP47 Android qualifiers. It does not patch Xcode membership, plist declarations, or app-specific translated data. Those transformations stay local. `--check` never writes and fails if a generated file differs.

### Screenshots

`screenshots --action open|capture|resize --platform android|ios` uses ADB or one booted iOS simulator. `open` syncs and launches via Capacitor. `capture` uses `--name`, `--output`, optional `--device` / `--guided`; `--force` permits replacing a named capture. `resize --input <directory>` uses configured `screenshots.sizes` and writes separate, non-cropped variants, leaving captures untouched. The output defaults to `screenshots.output` or `store/captures` relative to Capacitor root. This is capture/output mechanics, not a marketing screenshot designer.

## Android

`android.root` defaults to `<capacitor.root>/android`; optional `module` defaults to `app`. Optional `javaHome` and `sdkRoot` override standard environment variables. Otherwise Android Studio's bundled JDK is discovered. `appId` is the installed APK's application ID for verification and explicit replacement; include any Gradle `applicationIdSuffix` (for example, `com.example.app.debug`). It need not equal the release/Capacitor/store ID and does not change those identities. `apk`, `aab`, `mapping` can override artifact paths relative to Android root.

- `build --configuration debug|release --format apk|aab [--clean] [--reveal]`: runs Gradle and verifies the expected artifact. Defaults to release AAB. `--reveal` is a best-effort file-manager action after verification. Windows Explorer launches visibly and its normal shell-handoff exit codes 0 and 1 are accepted without a warning; a genuine launch/other-exit failure logs a warning and leaves the successful build successful. Other tools still require exit code 0. Gradle failures and missing artifacts still fail the command. Custom Gradle tasks can follow `--`; artifact inference and reveal are skipped for them. After a verified release build, the R8 mapping (`android.mapping`, default `<module>/build/outputs/mapping/release/mapping.txt`) and native debug symbols (`<module>/build/outputs/native-debug-symbols/release/native-debug-symbols.zip`) are logged when they exist, ready for upload to the Play Console.
- `install [--artifact <config-root-relative-apk>] [--device <serial>] [--physical] [--replace]`: installs an **already built** debug/custom APK and verifies it against `android.appId`. Device selection, existing-install lookup, explicit removal, APK installation and package verification have distinct step labels. No build, sync, uninstall, launch, or version bump is implicit. If installation reports success but final verification fails, compare the APK's actual application ID with `android.appId`; do not uninstall an unrelated release package to address a debug-ID mismatch.
- `start-adb`: starts the ADB server using the configured SDK or consumer PATH and Android environment. No device, app ID or native project is required. It does not select/install/uninstall an app. Dry-run plans the operation; protected environments still require authorization.

## Stores

`store.root` defaults to config root; normally set it to `store`. The existing Fastlane metadata tree lives at `<store.root>/fastlane`. Required `locales` are strings or `{ app, android, ios }` mappings. `defaultLocale` / `defaultLocales` choose primary folders, `appLocales` can check catalogue coverage, and `iosDevices` selects required iPhone/iPad/watch screenshot groups (default iPhone).

Credentials and identities: `androidId`, `iosId`, `playKey`, `appleKey`; key paths are relative to **config root**, never shipped or generated here. By default they must stay inside the project. Explicit `allowExternalCredentials: true` also permits **absolute** external filenames for these two fields only. Relative traversal remains rejected. No key content is read/copied during config loading or dry-run; real Fastlane operations read the referenced files. This opt-in does not affect outputs, native artifacts, gem caches or other paths. `versionPackage` is also config-root-relative. Optional `iosProject` and `iosScheme` configure the TestFlight archive. Android artifact settings use the Android module.

- `scaffold`: creates missing directories/text placeholders without overwriting.
- `check --platform android|ios|all --scope text|media|all [--strict] [--all-locales]`: text limits, required fields, locale layout, image sizes, screenshot sets, preview codecs/durations, etc. Preview probing requires ffprobe. Requirements are a versioned snapshot tied to the shipped Fastlane lockfile.
- `changelog [--version-code N] [--text <notes>] [--force]`: copies localized iOS release notes into Play changelogs, enforcing length and keeping existing copy.
- `export --platform android|ios [--output <store-relative-csv>]`: UTF-8 BOM CSV.
- `upload-listing --platform ... --only ...`: text (default), Android images, iOS screenshots/previews, or all. Strict scoped checks always run first.
- `upload-build --platform ...`: Android internal AAB or macOS-only TestFlight archive/upload. The Play release defaults to `completed`, so internal testers get the build as soon as Play processes it; `--status draft` leaves it as a draft instead (needed while the app has never been published). TestFlight builds go to internal testers (automatic-distribution groups, plus any `--groups`) and never to external testers. These two are the only lanes that make anything available to testers: all listing uploads only fill the store drafts. Public tracks, partial rollouts and review submission are not supported. `--groups` selects TestFlight internal groups. These uploads do not require a finished marketing listing; `hooks.beforeUpload` can add app readiness checks. `store.hooks.afterBuildUpload` (argv hooks, project root, `{platform}` substituted) runs once the internal lane has succeeded, and only then: not for listings, not for a failed upload, and not when `commit:false` or `validate:true` is passed through `store run`. It is the place for project-owned follow-ups such as committing the bumped version files; `rds` itself never touches Git. `hooks.beforeUpload` runs before every upload as before.
- `pull` downloads metadata into `fastlane/downloaded`, not the source listing.
- `doctor` verifies authentication and the app/tracks/editable version.
- `verify [--platform android|ios|all] [--scope text|media|all]`: read-only comparison of the local listing files with the draft in each store, so you can tell whether an upload is needed. Defaults to every configured store (`all`) and all content. Android compares title, short/full description and video per language plus every graphic by SHA-256 (the Play edit is always aborted). iOS compares the editable version's description, keywords, promotional text, What's New and support/marketing URLs, the name, subtitle and privacy URL, and every screenshot and preview by MD5, and lists media still processing. Only items that have a non-empty local file are compared, and What's New is skipped on an app's first version, as in the upload. It prints a per-store summary plus each difference and exits non-zero on any difference, missing locale or extra store media, so it can serve as a `production.verify` step. It never uploads or submits.
- `run -- lanes` or `run -- <platform> <shared-lane> [key:value ...]`: controlled access to shared lanes only. Cannot skip checks, commit, run arbitrary actions, or submit for review. TestFlight has no validation-only upload; use dry-run.

Set `STORE_RUBY` if Ruby >=3.3 isn't on PATH. macOS Homebrew installations are discovered. Bundler must already be installed. rds checks/installs the shipped locked gems under `.rds/gems` and generates only a one-line local import shim. Use `--dry-run` to preview; it is not a store-side validation API.

## VS Code and browser extensions

`vscode: { root?, prepare?, output?, noDependencies? }`: `package` builds one VSIX; `publish --registry marketplace|openvsx|all` publishes that exact file. `--bump` explicitly changes the version first. Registry defaults to both. Leave compilation/tests local and supply `prepare` argv commands if needed. Keep `vscode:prepublish` pointing to compilation, **not** `rds vscode package`, to avoid VSCE lifecycle recursion. Provide `VSCE_PAT` / `OVSX_PAT` via environment.

`browser: { root?, directory, output, prepare? }`: `browser package` checks the manifest and archives its built directory as a ZIP. Symlinks, an output inside the input tree, and inputs exceeding 256 MiB are rejected. It neither signs CRX files nor uploads to a browser store.

## Electron

`electron: { root?, url?, start?, assets?, output?, builderConfig?, prepare?, notaryProfile? }`. Assets use the same image output shape as Capacitor's web outputs, plus `assets.ico` / `assets.icns` output paths for genuine multi-resolution Windows/macOS containers. `assets.windowsCornerRadius` optionally rounds ICO artwork (0–0.5). AppX tile composition remains an app-owned recipe. `prepare` contains the actual frontend build prerequisites.

- `dev` owns a local frontend server, waits for it, launches Electron, and stops its server when the app exits. `start` defaults to Vite; `url` must be loopback.
- `clean`: cleans only `electron.output` (default `release/desktop`), then recreates its ownership marker. An existing unmarked directory is rejected, including in dry-run. Never mark or delete old output automatically to bypass this check; an operator must choose a fresh output or handle legacy files.
- `build --platform mac|windows|linux --arch arm64|x64|all --format <format>` runs electron-builder with `--publish never`. `--unsigned` explicitly disables identity discovery. `--clean` only cleans a rds-owned output directory.
- `notarize --artifact <file> [--staple <path>] [--profile <keychain-profile>] [--preflight]`: uses macOS notarytool, waits, then staples and validates. The profile comes from `--profile`, then `APPLE_NOTARY_PROFILE`, then `electron.notaryProfile`; Apple ID passwords are never accepted. A DMG or PKG is stapled itself. A ZIP cannot be stapled, so `--staple` names the contained `.app` (stapling a DMG or PKG other than the artifact also works). The staple target is resolved before submission, so a typo cannot waste a notarization. `--artifact` and `--staple` may use one `*` wildcard in the last path segment, which must match exactly one item (for example `release/desktop/*-mac-Intel.zip`). A full ZIP-then-DMG release is two invocations: the ZIP with `--staple` for the app, then the DMG.

## Swift

`swift: { root?, executable, plist, entitlements, resources?, output?, identity?, icon?, iconOutput? }`. All operations require macOS, except dry-run.

- `icons`: PNG → iconset → ICNS using iconutil, without app-specific web copying.
- `bundle`: SwiftPM release product → `.app` layout → explicit entitlements → signing → codesign verification. Identity defaults to local ad-hoc `-`, not a distribution signature. `--open` launches the actual bundle, not `swift run`. Regenerate Store/direct source trees locally before bundling. Existing output directories must have been created by rds before rds will replace them.

## Cloudflare

`cloudflare.targets` maps names to `{ kind: 'worker'|'pages', root?, config?, directory?, projectName?, prepare?, secretsFile?, secretNames?, commitDirty? }`.

Select `--target` when more than one exists. **Explicit `--env` is required**. Worker `config` and Pages `directory` are target-root-relative. Preparation hooks run in config root. Secrets files are **config-root-relative**.

- `deploy-worker`: explicit Wrangler config + environment.
- `deploy-pages`: built directory + project name + branch; branch defaults to `main` for production or the environment name otherwise. `commitDirty: true` adds `--commit-dirty=true` so Wrangler deploys from a working tree with uncommitted changes without its warning; the default leaves Wrangler's behavior unchanged.
- `push-secrets`: reads dotenv/JSON, checks an explicit name allowlist, sends JSON on stdin to `wrangler secret bulk`. Other variables cannot be uploaded.

No infrastructure provisioning, database wiping, app configuration generation or account inference is performed. Preserve existing security/header/domain policy in the consuming project.

## Local development

These families cover the mechanics most projects rewrite for local work. They hold no application policy: commands, endpoints, defaults and validation rules come from your configuration or your own module.

### Tool resolution

Commands and hooks resolve `pnpm` through the running pnpm when rds was started by it, so `rds exec -- pnpm …` and `dev.processes` work on Windows without a `.cmd` shim. `rds` resolves to the installed toolkit's own CLI, which allows a hook such as `['rds', 'env', 'check', '--env', '{env}']`. On Windows a bare command name is looked up on `PATH` as `.exe`, `.cmd` or `.bat` the way a shell would, and batch files keep the existing argument checks.

### Dev processes

`rds dev start`

`dev: { root?, processes: [{ name, command, root?, environment? }] }`. Every process starts at once with an argv `command`, run in `dev.root` (or the process `root` inside it), and its output is printed line by line with a colored `[name]` prefix. `environment` accepts the same `{env}` / `{root}` placeholders as other environment mappings, and `FORCE_COLOR=1` is set so tools keep their colors in a pipe.

The first process to end ends the session: the others receive SIGTERM and the result is the first process's result. Ctrl+C is a normal stop and exits 0. Dry-run lists the processes without starting them. Names must be unique. Add `--env` to select the value of `{env}`.

### Waiting for a service

`rds wait tcp [--target <name>] [--timeout <seconds>]`

`wait: { targets: { <name>: { host?, port?, url?, variable?, envFile?, timeout?, hint? } } }`. A target is a `host` and `port`, a `url`, or a `variable` holding a URL, read from the process environment first and then from `envFile` (dotenv, relative to the config root). The port falls back to the scheme default for HTTP, MySQL, PostgreSQL, Redis, MongoDB and AMQP. `--target` is optional when there is a single target. The default timeout is 90 seconds, retried every second.

Only the host and port are printed, never the URL or its credentials. `hint` is appended to the failure message. Dry-run does not connect.

### Environment files

`rds env template|validate|generate|check --env <name>`

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

`rds prisma migrate|status --env <name> [--confirm-host <host>]`

`prisma: { root?, envFile, variable? }`. The database URL is read from `variable` (default `DATABASE_URL`) in `envFile`, a dotenv path relative to the config root where `{env}` becomes the environment. Generate that file first, for example with `rds env generate`. `migrate` runs `prisma migrate deploy` and `status` runs `prisma migrate status` from `root`, using the project's own `prisma` package. The URL is handed to Prisma through its environment, never logged; the host is shown.

`migrate` is a mutation guard: a protected environment needs `--allow-production` and passes the production verification hooks. It then needs the database host as confirmation, either typed at the prompt or given as `--confirm-host`; without a terminal the flag is required. A host that does not match stops the command before Prisma starts. Local development databases keep using your own `prisma migrate dev` script. Dry-run plans without reading anything beyond the environment file.

## Hosting resources and API-token deployments

Cloudflare Pages project creation and Hostinger Web/Cloud deployment mechanics are shared commands. See [the hosting guide](hosting.md) for typed targets, credentials, dry-run behavior, provider prerequisites, and safety boundaries. Application seeds, mock/demo policy, database migrations at build time, and content-retention decisions remain in the consuming project.


## Destructive hosting reset

Use `rds hosting reset --env staging --yes --confirm-host api-stage.example.com --confirm-project example-stage` only for explicitly disposable, dedicated targets. `--dry-run` is write/request-free, `--check` is read-only remote preflight, and `--resume` continues the ignored output journal after a partial failure. Protected environments are forbidden. See [hosting resource recreation](hosting.md#destructive-hosted-resource-recreation) for scope, confirmation flags, `--output`, temporary-domain changes and consumer responsibilities.


`rds hosting drop` stops after the destructive half (DB is always discarded); optional `--keep-pages` leaves frontend resources unchanged. `rds hosting recreate` continues that exact journal without repeating deletion. Both use reset's exact confirmations/guards/output and read-only preview modes. No keep-db flag is supported. See [split hosted lifecycle](hosting.md#drop-now-recreate-later).
