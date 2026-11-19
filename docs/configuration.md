# Configuration patterns

Use an MJS config for imported catalogues and editor assistance, or JSON for data-only configuration. MJS is trusted executable code. The exported [Config type](../src/types.ts) is authoritative; runtime validation lives in [config.ts](../src/config.ts). `// @ts-check` enables JavaScript editor diagnostics where supported.

For a data-only alternative, save `reusable-dev-scripts.config.json`:

```json
{
  "version": 1,
  "vue": { "root": "frontend", "typecheck": "noEmit" }
}
```

Discovery searches upward from the working directory. Within a directory, MJS takes precedence over JSON. An explicit `--config` selects one file, and its directory becomes the configuration root. `--cwd` does not override module roots.

## Result banner preferences

Completion banners are enabled by default. This optional setting disables them for commands using the project configuration:

```js
export default {
  version: 1,
  output: { banners: false },
}
```

The value must be boolean. Use `--banner` to enable a banner for one invocation, `--no-banner` to suppress it, or `RDS_BANNERS=0` / `RDS_BANNERS=1` in CI. Flags override the environment, which overrides this setting. See [result banners](commands.md#result-banners) for nested commands, startup errors, color support and dry-run behavior. The setting changes presentation only; it does not skip checks or suppress underlying tool diagnostics.

## Single-environment projects

Commands that act on a named environment (`cloudflare`, `hostinger`, `hosting`, `env` and `prisma`) need one chosen on purpose, so a deploy or migration never silently targets the wrong place. A project with only one environment does not have to repeat it on every command: set `defaultEnvironment`, and `--env` becomes optional for exactly those commands. `--env` still wins when given.

```js
export default {
  version: 1,
  defaultEnvironment: 'live',
  cloudflare: {
    targets: {
      web: { kind: 'pages', directory: 'dist', projectName: 'example', branch: 'main' },
      api: { kind: 'worker', config: 'wrangler.toml', wranglerEnv: false },
    },
  },
}
```

Pages deployments use the target's `branch` (otherwise `main` for `production` and the environment name for anything else), and `wranglerEnv` chooses the Wrangler environment of a Worker (a name, or `false` for none). Builds, native commands, Capacitor, Android, stores and the other modules never use `defaultEnvironment`: their environment stays `development` unless `--env` is passed, so the default cannot switch on production guards for a build. Name the default `production` (or list it in `production.environments`) when its commands should keep requiring `--allow-production` and your verification hooks; any other name is unprotected. Hosting reset still refuses protected environments and needs its exact confirmations.

A project that has no notion of environments does not need a name at all. When the configuration has no `production` section, no `env` module and no per-environment target overrides (`environments` on a Cloudflare or Hostinger target), `cloudflare` and `hostinger` commands use the neutral environment `default` without `--env` or `defaultEnvironment`. In that case the Pages branch is `main` unless the target sets `branch`, and Workers get no Wrangler `--env` unless the target sets `wranglerEnv`. `prisma`, `env` and hosting reset never fall back: they touch data or per-environment files, so they always need `--env` or `defaultEnvironment`. As soon as the project configures environments, the fallback stops applying and an explicit environment is required again.

## External store credentials

Keys can remain outside a checkout. Explicitly opt in for the two credential filename fields, using absolute environment-provided paths:

```js
export default {
  version: 1,
  store: {
    root: 'store',
    locales: ['en-US'],
    androidId: 'com.example.app',
    allowExternalCredentials: true,
    playKey: process.env.PLAY_SERVICE_ACCOUNT_KEY,
    appleKey: process.env.APP_STORE_CONNECT_KEY,
  },
}
```

Only `playKey`/`appleKey` accept this exception. Relative filenames still resolve inside the config root; `../` traversal is not enabled. Key contents are not loaded by config import or dry-run, copied into the project, or printed by rds. Fastlane reads them only during the requested real operation. Leave the opt-in off when project-contained keys are sufficient. Outputs and cleanup paths always remain contained. Set the relevant credential environment variables before an authenticated command; undefined fields are not credentials.

## Store account access

A working key is only half of the setup: the account behind it must be allowed to touch the app. The labels below are the Play Console and App Store Connect names at the time of writing, not an official Google or Apple reference, so check the console if one differs.

**Google Play.** Enable the *Google Play Android Developer API* in the Google Cloud project that owns the service account, then invite the service account's email in Play Console → *Users and permissions* → *Invite new users*. Prefer **App permissions** for this one app over account-wide access, and do not make the account an admin. Tick:

| Checkbox (App permissions) | Needed for |
| --- | --- |
| View app information and download bulk reports (read-only) | `store doctor`, `pull`, `verify` (`verify` opens a Play edit and always aborts it) |
| Manage store presence | `upload-listing` (text and graphics) |
| Release apps to testing tracks | `upload-build --platform android` (internal track) |
| Manage testing tracks and edit tester lists | Some setups need it for track uploads; tick it if the build upload is refused |

*Create, edit, and delete draft apps* (an account-level permission) is only needed while the app is still a draft in Play Console. rds never releases to production or other public tracks, so *Release to production, exclude devices, and use Play App Signing* is not needed; add it only if Play itself refuses an operation. The app must already exist with at least one uploaded build, and new permissions can take a while to apply.

`The caller does not have permission` from `store doctor` means the service account has no access to this app yet, for example a key shared with another app of the same developer account that was never invited to this one.

**App Store Connect.** Use a team API key (Users and Access → Integrations → App Store Connect API) with the **App Manager** role, which covers `upload-listing` and TestFlight uploads. A narrower role is not guaranteed to work. The key is saved as Fastlane JSON (`key_id`, `issuer_id`, `key`, `in_house`), and one team key serves every app of that team.

## Minimal Vue application

```js
// @ts-check
import { defineConfig } from 'reusable-dev-scripts'

export default defineConfig({
  version: 1,
  vue: { typecheck: 'noEmit' },
})
```

Run `npm exec -- rds vue build`. Keep normal development servers and simple lint/test aliases direct when they need no shared helper implementation.

## Workspace paths

For APK installation, set `android.appId` to the APK's actual application ID, including a debug suffix when configured in Gradle. For example, an app whose release/Capacitor/store ID is `com.example.app` and whose debug variant adds `.debug` uses `android: { appId: 'com.example.app.debug' }` for its debug install workflow. This setting controls package verification and the target of an explicitly approved `--replace`; it does not rename the native project or store listing.

```js
export default {
  version: 1,
  vue: { root: 'apps/mobile', typecheck: 'build' },
  capacitor: {
    root: 'apps/mobile',
    packageJson: 'apps/mobile/package.json',
    platforms: ['android', 'ios'],
  },
  android: { root: 'apps/mobile/android', appId: 'com.example.app' },
}
```

Module `root` values are relative to the config directory. Module-internal paths are usually relative to that module root; explicitly documented exceptions such as `capacitor.packageJson` and store credential paths are config-root-relative. Paths must remain inside the project. Use `--cwd apps/mobile` to select a working directory while still discovering the root config.

## Environments are not platforms or distribution variants

| Concept | Example | Meaning |
| --- | --- | --- |
| Deployment environment | `--env staging` | Environment label for commands, mappings and protected-operation checks |
| Vite mode | `--mode production` | Vite configuration/env-file mode; not deployment authorization |
| Platform | `--platform ios` | Native target or desktop platform, as supported by the command |
| Distribution variant | generated Store/direct source roots | Application-owned source, entitlements, IDs and distribution policy |

`--env` does not rewrite `NODE_ENV`. Without an explicit mode, a Vue build uses the configured environment-to-mode mapping, then an explicit environment name, or production when neither flag was supplied.

```js
export default {
  version: 1,
  vue: {
    modes: { development: 'development', staging: 'staging', production: 'production' },
  },
  capacitor: {
    platforms: ['android', 'ios'],
    environment: { VITE_DEPLOY_ENV: '{env}' },
    environmentByPlatform: {
      android: { VITE_APP_TARGET: 'android' },
      ios: { VITE_APP_TARGET: 'ios' },
    },
  },
}
```

The variable names above are application conventions, not magic `rds` settings. Your frontend/native config must read them. Default web builds receive the mapping, and native CLI/post-sync steps receive it too.

## Connect bounded hooks

The script/alias names below stand for **your existing application-owned commands**. They are not generated by `rds`:

```js
export default {
  version: 1,
  production: {
    environments: ['production'],
    verify: [['node', 'scripts/verify-release-approval.mjs', '{env}']],
  },
  capacitor: {
    root: 'app',
    platforms: ['android', 'ios'],
    prepareByEnv: {
      staging: [['node', 'scripts/prepare-native-env.mjs', 'staging']],
      production: [['node', 'scripts/prepare-native-env.mjs', 'production']],
    },
    buildByPlatform: {
      android: ['npm', 'run', 'build:native:android'],
      ios: ['npm', 'run', 'build:native:ios'],
    },
    afterBuild: [['node', '{root}/scripts/generate-native-resources.mjs', '{platform}']],
    afterSync: [['node', '{root}/scripts/post-sync.mjs', '{platform}']],
    verify: [['node', '{root}/scripts/verify-native.mjs', '{platform}']],
  },
}
```

Hooks are argv arrays, not shell strings. Only `{root}`, `{env}`, and `{platform}` are substituted. Spaces remain within argument values; shell operators are not executed. Windows batch execution has additional control-character restrictions; prefer Node executables for hooks.

Production verification runs before protected mutations in the config root. Capacitor preparation runs there too. Builds, after-build hooks and post-sync verification run in the Capacitor root. Custom build hooks replace the default Vue build and must include their own typechecking. `--skip-build` does not skip preparation or verification. See [execution order](commands.md#capacitor).

Use `afterBuild` for application-owned resource generation that must follow the web build and precede Capacitor sync/copy. It also works with the default Vue build, so no custom build wrapper is needed just for that ordering. It is skipped with `--skip-build` and runs once per selected platform.

## Normalize native resources at the boundary

Keep catalogue parsing and artwork composition local. Pass normalized inputs rather than making shared tooling understand application-specific source layouts:

```js
export default {
  version: 1,
  capacitor: {
    assets: {
      source: 'assets/icon.png',
      background: '#ffffff',
      outputs: [{ path: 'public/icon-192.png', width: 192 }],
    },
    locales: {
      defaultLocale: 'en',
      locales: {
        en: { title: 'Example', greeting: 'Hello %1$s' },
        es: { title: 'Ejemplo', greeting: 'Hola %1$s' },
      },
      targets: [
        { format: 'android', directory: 'android/app/src/main/res', keys: { app_name: 'title', greeting: 'greeting' } },
        { format: 'apple', directory: 'ios/App/App', keys: { app_name: 'title', greeting: 'greeting' } },
      ],
    },
  },
}
```

An MJS config can import a local catalogue adapter that returns this data shape. Keep resource membership, native declarations, and custom widget data in the application. Add separate targets to emit ordinary watch/widget string files.

## Separate deployment mechanics from application policy

```js
export default {
  version: 1,
  cloudflare: {
    targets: {
      api: {
        kind: 'worker',
        root: 'backend',
        config: 'wrangler.toml',
        secretsFile: '.secrets/worker.env',
        secretNames: ['SESSION_SECRET', 'SERVICE_API_KEY'],
      },
      website: {
        kind: 'pages',
        directory: 'web/dist',
        projectName: 'example-website',
      },
    },
  },
}
```

Select a target and explicit environment when invoking a Cloudflare command. Keep account configuration, domains, header policy and secret generation local. See [Cloudflare commands](commands.md#cloudflare) and the [safety model](safety.md) before deploying.

## Local services, environment files and migrations

A backend/frontend repository can replace its hand-written dev, wait, environment and migration scripts with four small sections. Project policy stays in the module referenced by `env.module`. See [services.config.mjs](../examples/services.config.mjs) and the [local development reference](commands.md#local-development).

```js
export default {
  version: 1,
  env: { module: 'scripts/environments.mjs' },
  dev: { processes: [{ name: 'api', command: ['npm', 'run', 'dev', '--workspace', 'backend'] }] },
  wait: { targets: { database: { variable: 'DATABASE_URL', envFile: 'backend/.env' } } },
  prisma: { root: 'backend', envFile: 'backend/.env.{env}' },
  production: { environments: ['production'], verify: [['rds', 'env', 'check', '--env', '{env}']] },
}
```
