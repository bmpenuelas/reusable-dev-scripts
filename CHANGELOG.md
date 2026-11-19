# Changelog

Behavior that consumers can notice. Pin an exact version and read the relevant entry before upgrading.

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
