---
name: reusable-dev-scripts
description: Adopt reusable-dev-scripts in an existing project by mapping duplicated build, release, store, desktop, local-development and hosting helpers to type-specific rds commands while retaining application-owned behavior.
---

# Adopt reusable-dev-scripts

Use this skill to integrate the installed npm toolkit, not to replace a project's stack or invent a universal task engine. Work only in the project the user selected.

## Find the installed contract

Run commands from the consuming project. If the dependency is missing, install `reusable-dev-scripts` as an exact, development-only dependency using the project's package manager and lockfile conventions. Do not download an unrelated package named after the `rds` executable.

Locate the installed entry point without executing it:

```sh
node --input-type=module -e "console.log(import.meta.resolve('reusable-dev-scripts'))"
```

The result points to `dist/index.js`; its parent package directory contains the version-matched guides below. For a linked checkout, use the resolved package directory, not a guessed sibling repository. Read these files there:

- `docs/agents.md`: integration procedure and completion report.
- `docs/adoption.md`: module boundaries and migration sequence.
- `docs/configuration.md`, `docs/commands.md`, and the relevant `examples/*.config.mjs`: supported configuration and execution order.
- `docs/hosting.md`: Cloudflare Pages, Hostinger and the destructive `hosting reset|drop|recreate` lifecycle.
- `docs/safety.md`: before any workflow with side effects.
- `docs/troubleshooting.md` and `CHANGELOG.md`: known symptoms and behavior that changed between releases; compare the installed version with the one the project pinned.
- `src/types.ts`, `src/config.ts`, and `src/cli.ts`: when supported fields, validation, or flags need clarification.

Use `npm exec -- rds <module> <command> --help` after installing the dependency. If no toolkit workflow matches, keep the local implementation rather than inventing flags or repository presets.

## Look at every module family

Run `npm exec -- rds --help` and read the command list instead of relying on memory: new releases add families. Today they cover Vue, Capacitor (sync, versions, assets with explicit `copies`, locales, read-only `check-locales` and optional `register-locales` for Android/Xcode language declarations, screenshots, live reload), Android (build, install, read-only APK `inspect`, ADB), per-platform build settings (`buildSettings`: compile-time flags for a build kind such as `android build --kind <name>` or `store upload-build --platform ios --testflight-only`), mobile stores (metadata checks, listing/build uploads, TestFlight internal-only uploads, read-only `store verify` of listing text, graphics and release notes), store media (`media scaffold|view|capture|render|check|sheet`: base designs, a local viewer with store mocks, app captures and every final image for Google Play, the App Store, the Mac App Store and the Microsoft Store), VS Code and browser extensions, Electron (dev, assets, build, notarize, `check-signing-identity`), Swift, app-link association files (`app-links generate|check`), Cloudflare (Worker/Pages deployment, secrets, remote D1 migrations and `d1-status`, release `status`, explicit `promote`/`rollback`, Pages DNS and www redirect) and Hostinger deployment and build `status`, destructive hosting reset, local development (`dev start`, `dev tabs`, `wait tcp`, `wait http`, `env`, `prisma`), PlatformIO (`platformio -- <pio arguments>`) and ESP32 firmware budgets (`esp32 check-size`). The `reusable-dev-scripts/bunny` subpath export serves project-owned Bunny.net scripts. Scan the project's scripts for each family, including ones that look unrelated to releases such as dev-server launchers, readiness loops, environment-file generators and migration runners.

A project with only one environment sets `defaultEnvironment` once instead of passing `--env` to every cloudflare, hostinger, hosting, env and prisma command; do not invent a fake environment per alias. A project that configures no environments at all needs neither: cloudflare and hostinger use the neutral `default` environment (prisma, env and hosting reset still require an explicit one).

Application policy that must run around a shared command belongs in its documented hooks (for example `capacitor.afterBuild`, `store.hooks.beforeUpload` and `afterBuildUpload`, `production.verify`), not in a reimplementation of the command. `rds` never commits, pushes, tags or submits for review; keep those steps in a project hook or script.

## Map behavior before changing aliases

Read the project's instructions, manifests, and actual helper implementations. Record working directories, environment variants, version/lockfile ownership, generators, native transformations, checks, and side effects. Script names alone are not a behavior specification.

Propose a concise old-alias → rds-command mapping, listing retained local hooks and any unsupported behavior. If the user requested analysis only or an approval checkpoint, stop there; otherwise implement within the requested scope, one workflow at a time.

Add the smallest `reusable-dev-scripts.config.mjs` or JSON config, thin npm aliases, and an ignore rule for `.rds/`. Configure only relevant modules. Keep ordinary lint/test/dev-tool aliases direct when no duplicated mechanics need replacing.

Keep product-specific source generation, domain policy, approvals, signing choices, secrets, and native verification in the application. Hooks are argv arrays, not shell strings. Avoid recursion: a hook must not call the alias that invokes it. Version bumps must remain explicit; retrying a build/upload must not silently increment again.

When replacing a native localization script, adopt `check-locales` first and compare its findings with the existing script's output; use `register-locales` only if the user wants rds to edit the native project, and keep translation keys, Xcode target membership and store copy in the application. App-link identities and fingerprints must come from the project's reviewed configuration; never infer or invent them. Do not remove a project's APK or permission rules: `android inspect` only reports.

## Verify and report honestly

Start with help, configuration validation and dry-run, then existing local checks. Keep old helpers until equivalent behavior is demonstrated. Do not turn a plan into a claim that a native artifact or remote workflow succeeded.

Store keys need no config field when they already come from `SUPPLY_JSON_KEY`/`APP_STORE_CONNECT_API_KEY_PATH` or sit at `fastlane/play-service-account.json`/`fastlane/app-store-connect-api-key.json` under the store root; set `store.playKey`/`store.appleKey` only for another location, and check that key files are ignored by Git.

For store commands a working key is not enough: the Play service account must be invited to the specific app, and the App Store Connect key needs the App Manager role. When `store doctor` reports `The caller does not have permission`, point the user to the [store account access](../../docs/configuration.md#store-account-access) checklist (Play Console app permissions *View app information*, *Manage store presence*, *Release apps to testing tracks*) rather than changing code or credentials.

Do not run deployments, store uploads, signing, device replacement/data clearing, release promotion or rollback, or production actions just to verify a migration. Obtain the user's approval for those effects separately. `--allow-production` is acknowledgement, not a substitute for the application's authorization boundary.

Report changed aliases/configuration, local behavior deliberately retained, checks actually run, and remaining native/account acceptance work. Never include credentials or unredacted invocation plans in reports. If the agent does not automatically discover this skill, read this file explicitly; a new session may be needed for automatic discovery.
