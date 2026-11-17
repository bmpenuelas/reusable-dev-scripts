# reusable-dev-scripts

## 🚀 one generic implementation for the scritps you write over and over

A collection of development and release automations that brings repeatable workflows to all your projects. Install it as a development dependency, describe your project once in the config, and skip rewriting common automation.

🤖 **Agent-friendly** Copy this prompt into your AI coding agent:

> Install `reusable-dev-scripts` as a pinned development dependency using npm, then run `npm exec -- rds skill install` from this project's root. Read `.agents/skills/reusable-dev-scripts/SKILL.md` and use that skill to analyze our existing build and release scripts. Propose which scripts can become `rds` commands, explain what must stay project-specific, and wait for my approval before migrating them. Preserve security checks and version ownership; don't deploy, sign, upload, or clear device data without separate approval.

The [bundled skill](skills/reusable-dev-scripts/SKILL.md) ships in the npm package. Installation is explicit—no postinstall hook changes your agent configuration. For an agent that uses another project-local skills directory, select it with `--output`, as described in [skill installation](#install-the-agent-skill).

- 🧩 **Automations for each framework and platform.** Vue, Capacitor, Android, mobile stores, VS Code extensions, Electron, Swift, Cloudflare, and browser extensions have their own commands. Shared local-development mechanics (concurrent dev processes, service readiness, per-environment files, Prisma migrations) are one command family each.
- 📱 **From web build to native artifact.** Synchronize native projects, manage versions, generate resources, capture screenshots, and build Android packages.
- 📦 **Predictable release mechanics.** Validate store metadata, share Fastlane lanes, and publish the same VSIX to multiple registries.
- 🛡️ **Explicit side effects.** Preview with dry-run, authorize protected environments, and keep credentials and application policy in your project.
- 🤝 **Readable by people and agents.** Typed configuration, focused examples, documented execution order, and a clear boundary between shared mechanics and application-specific behavior.

## Quick start

### 1. Install a pinned development dependency

Requires **Node >=22.18**. From your application's directory, install the published npm package:

```sh
npm install --save-dev --save-exact reusable-dev-scripts
npm exec -- rds --help
```

Commit the application's `package.json` and lockfile. `--save-exact` pins the resolved version; use `reusable-dev-scripts@<version>` when selecting a specific release. CI should use `npm ci`. This installation path requires a published release; before the first publication, use a [local checkout or packed tarball](#local-toolkit-development).

The CLI ships as compiled JavaScript; consumers do not need a TypeScript loader or a checkout of this repository.

### 2. Add only the configuration you need

Create `reusable-dev-scripts.config.mjs` next to your application's root `package.json`:

```js
// @ts-check
import { defineConfig } from 'reusable-dev-scripts'

export default defineConfig({
  version: 1,
  vue: { typecheck: 'noEmit' },
  capacitor: { platforms: ['android', 'ios'] },
  android: { root: 'android', appId: 'com.example.app' },
})
```

The example above assumes an existing Vue/Capacitor app and native projects. Replace example identifiers and paths; `rds` does not create the application. For a web-only project, configure just `vue`.

Start from the [configuration examples](examples/): [Capacitor](examples/capacitor.config.mjs), [workspaces](examples/workspace.config.mjs), [stores](examples/store.config.mjs), [VS Code](examples/vscode.config.mjs), [Electron](examples/electron.config.mjs), or [Swift](examples/swift.config.mjs).

Config is discovered upward from the working directory, so workspace commands can use a root config. A JSON alternative, `reusable-dev-scripts.config.json`, is also supported. `--cwd` and `--config` make working-directory/config selection explicit.

### 3. Keep npm aliases thin

```json
{
  "scripts": {
    "build": "rds vue build",
    "native:sync": "rds capacitor sync",
    "native:prepare": "rds capacitor prepare",
    "android:bundle": "rds android build --configuration release --format aab"
  }
}
```

```sh
# Plan steps without running tools or writing files.
npm run native:sync -- --platform android --env staging --dry-run

# Build web resources, synchronize Android, and open its IDE.
npm run native:sync -- --platform android --env staging --open

# Explicitly bump a new release; omit --bump when refreshing the same version.
npm run native:prepare -- --platform ios --bump patch
```

`android:bundle` builds an artifact; it does **not** silently bump, synchronize, or upload it. Compose those operations explicitly when your workflow needs them. Before running a non-dry command, review its [execution order and prerequisites](docs/commands.md).

### 4. Keep generated state and credentials out of Git

In the consuming project, ignore generated state and local secret material:

```gitignore
.rds/
.secrets/
.env
.env.*
!.env.example
!.env.*.example
```

Use the host or CI secret store for tokens. Do not put credentials in committed configs, hook arguments, or copied example files. Read the [safety model](docs/safety.md) for the limits of dry-run and logging.

## Result banners

Every `rds` command ends with a timestamped success or failure banner by default. A dry-run says **PLAN COMPLETE**, not live success. Banners go to stderr; help and version output stay clean, and nested `rds` calls leave the final banner to their outer command.

Disable them project-wide in `reusable-dev-scripts.config.mjs`:

```js
export default {
  version: 1,
  output: { banners: false },
}
```

Override per command with `--no-banner` or `--banner`:

```sh
npm exec -- rds vue build --no-banner
npm exec -- rds vue build --banner
```

For CI, set `RDS_BANNERS=0` or `RDS_BANNERS=1` in the job environment. CLI flags override that variable, which overrides project config. Step logs and error diagnostics remain enabled. See [result banners](docs/commands.md#result-banners) for color controls and startup-error behavior.

## Install the agent skill

After installing the npm dependency, run from the consuming project's root:

```sh
npm exec -- rds skill install --dry-run
npm exec -- rds skill install
```

This writes `.agents/skills/reusable-dev-scripts/SKILL.md`. It does not change application configuration, run project hooks, or install anything globally. The skill reads the documentation shipped with your installed toolkit version. Ask your agent to use the `reusable-dev-scripts` skill, or explicitly read that file if its client does not automatically discover new skills; some clients may need a new session.

To select a different project-local skill folder:

```sh
npm exec -- rds skill install --output .claude/skills/reusable-dev-scripts
```

`--output` names the complete destination skill directory and must stay within `--cwd` (the current directory by default). Reinstalling identical instructions is a no-op. A differing existing `SKILL.md` is never overwritten: review and move it aside, or choose another directory. After upgrading the npm dependency, rerun installation to check whether the instructions changed. Commit project-shared instructions or ignore the selected folder according to your project's policy.

## Table of contents

| You want to… | Read |
| --- | --- |
| Try a command in an existing project | [Quick start](#quick-start) |
| Edit the toolkit while using it in an app | [Local toolkit development](#local-toolkit-development) |
| Choose modules and migrate existing scripts | [Adoption guide](docs/adoption.md) |
| Configure workspaces, environments, builds, and hooks | [Configuration patterns](docs/configuration.md) |
| Look up a command, default, flag, or path rule | [Command reference](docs/commands.md) |
| Delegate an integration to an AI agent | [Agent integration playbook](docs/agents.md) |
| Install the adoption skill for an agent | [Install the agent skill](#install-the-agent-skill) |
| Resolve a setup or workflow error | [Troubleshooting](docs/troubleshooting.md) |
| Understand side effects and trust boundaries | [Safety model](docs/safety.md) |
| Contribute or prepare a release | [Design and development](docs/design.md) |

## Command families

Each command below starts with `rds`. Configure only the modules you use.

| Family | Available commands |
| --- | --- |
| Runtime | `exec -- <command> [args]` |
| Agent skill | `skill install` |
| Vue/Vite | `vue build` |
| Capacitor | `capacitor sync`, `copy`, `open`, `live`, `versions`, `prepare`, `assets`, `locales`, `screenshots` |
| Android | `android build`, `install`, `start-adb` |
| Mobile stores | `store scaffold`, `check`, `changelog`, `export`, `upload-listing`, `upload-build`, `pull`, `doctor`, `run` |
| VS Code | `vscode package`, `publish` |
| Electron | `electron dev`, `assets`, `clean`, `build`, `notarize` |
| Native Swift | `swift icons`, `bundle` |
| Cloudflare | `cloudflare deploy-worker`, `deploy-pages`, `push-secrets` |
| Browser extensions | `browser package` |
| Local development | `dev start`, `wait tcp`, `env template`, `validate`, `generate`, `check`, `prisma migrate`, `status` |

Get exact supported flags without loading application configuration:

```sh
npm exec -- rds --help
npm exec -- rds capacitor sync --help
npm exec -- rds store upload-listing --help
```

The [command reference](docs/commands.md) explains behavior. The [CLI command registry](src/cli.ts) is the executable source of truth for flags, and the exported [configuration types](src/types.ts) describe the API.

Adoption does not require new wrapper scripts. Use bounded hooks such as `capacitor.afterBuild` for application-owned resource generation. If a small custom recipe is necessary, the exported `runSteps` API sequences rds commands with shared process, signal and exit-code handling; see [app-owned recipes](docs/agents.md#app-owned-recipes).

## Bring your own toolchain

The application owns its tool versions. Install only what its selected module needs; `rds` resolves JavaScript tool executables from the consuming workspace:

| Workflow | Application dependencies / external prerequisites |
| --- | --- |
| Vue build | `vite`, `vue-tsc`, a configured Vue/TypeScript project |
| Capacitor | `@capacitor/cli`, native projects, the applicable platform SDK |
| Native asset generation | `@capacitor/assets` and source artwork |
| Android | Gradle wrapper, compatible JDK, Android SDK; ADB for device operations |
| Store tooling | Ruby >=3.3 and Bundler; credentials for remote actions; ffprobe for preview-video checks; macOS/Xcode for TestFlight builds |
| VS Code publishing | `@vscode/vsce`, `ovsx` for Open VSX, registry tokens |
| Electron | `electron`, `electron-builder`, frontend tooling, platform signing prerequisites |
| Swift bundles/icons | macOS, Swift/Xcode command-line tools, explicit plist and entitlements |
| Cloudflare | `wrangler`, existing deployment config, suitable account credentials |
| Browser ZIP / image processing | Provided here; the app supplies built files/artwork |
| Dev processes, TCP waits, environment files | Provided here; the app supplies commands, endpoints and an environment module |
| Prisma migrations | `prisma` in the application, a generated environment file with the database URL |

Fastlane lanes and a locked gem set ship with this package. Store commands use the consumer's `.rds/gems` cache—not global gem installations. Store metadata and credentials remain application-owned.

## Integration principles

- Use separate commands for different stacks, rather than a universal `build`.
- Share duplicated **mechanics**, not domain rules.
- Keep source generation, environment allowlists, approval checks, and tests in the application. Connect them with bounded argv hooks when needed.
- Separate deployment environment, Vite mode, platform, and distribution variant.
- Keep simple aliases such as `eslint`, `vite`, and `swift test` direct when they have no meaningful duplicated implementation to replace.
- Verify one workflow before migrating the next. Dry-run is planning evidence, not proof that a real artifact, signature, device, or remote upload works.

## Local toolkit development

Use a linked checkout when changing shared scripts and testing them in an application. The examples below assume sibling directories named `reusable-dev-scripts/` and `my-app/`; substitute your actual relative paths.

First, in the toolkit checkout:

```sh
npm ci
npm run build -- --watch
```

`npm ci` installs the toolkit's own dependencies and runs its initial build. Leave the watch process running: edits to `src/` must compile into `dist/` before the application sees them. JavaScript support files are used directly.

In another terminal, from the application directory:

```sh
npm install --save-dev --install-links=false ../reusable-dev-scripts
npm exec -- rds --help
npm exec -- rds vue build --dry-run
```

`--install-links=false` explicitly links the local directory instead of copying a package snapshot. Keep application configuration, tool dependencies, credentials, and native SDKs in the application; linking does not transfer that ownership. Do not commit the temporary `file:` dependency or its lockfile changes as the application's published-package setup.

To switch back after publishing your changes, run this from the application directory, then review and commit its manifest and lockfile:

```sh
npm install --save-dev --save-exact reusable-dev-scripts@<version>
```

To test the exact distributable without a link, run `npm pack` in the toolkit checkout, copy the resulting versioned tarball into the application's `vendor/` directory, and install it from the application:

```sh
npm install --save-dev ./vendor/reusable-dev-scripts-0.2.0.tgz
```

A tarball is a snapshot: rebuild, repack, and reinstall after toolkit changes. Use its actual versioned filename. A vendored tarball and lockfile can also provide a reproducible dependency before npm publication. See [design and development](docs/design.md) for the release checklist.

When finished testing a local checkout or tarball, switch the application back to a published release:

```sh
npm install --save-dev --save-exact reusable-dev-scripts
```

Append `@<version>` to select the application's approved release rather than the registry default. Review `package.json` and the lockfile to confirm the local `file:` dependency has been replaced before committing.

## Development and publication

```sh
npm ci
npm run check
npm pack
```

`check` includes TypeScript checking, fixture/integration tests, documentation and portability checks, and a packed-CLI smoke test. CI is configured for Node 22/24 on Windows, macOS, and Linux; configured coverage is not a claim that every native toolchain or remote account has been exercised.

See [design and development](docs/design.md) for module layout and the public release checklist.

## License

[MIT](LICENSE). Dependency licenses remain their respective owners' terms.
