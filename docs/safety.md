# Safety model and operational limits

`reusable-dev-scripts` is a build/release tool, not a sandbox or an authorization service. It executes trusted project configuration and requested external tools with the operator's permissions. The project owns account access and application policy.

## Effects must be intentional

| Operation | Behavior to review before execution |
| --- | --- |
| Vue/native build and sync | Can write build outputs, generated resources and native project files |
| Native version synchronization | Writes version settings; `--bump` also changes package/lockfile versions |
| Android install | Replaces an installed APK with `adb install -r`; `--replace` explicitly uninstalls first and deletes local app data |
| Screenshots | Writes captures/resized files; opening a session can build and install the app |
| Store hooks | `store.hooks.beforeUpload` and `afterBuildUpload` run your commands (for example a Git commit) with your permissions; `afterBuildUpload` runs only after the store accepted a build |
| Store commands | `check` is local; `doctor` and `verify` read remote account state (`verify` aborts its Play edit and changes nothing); listing/build uploads and pull perform their documented remote/local effects |
| VS Code publish | Publishes to the requested registries, defaulting to both |
| Electron notarize | Submits an artifact to a remote service, then may staple it |
| Cloudflare commands | Deploy code/files or change allowlisted Worker secrets; `push-secrets` parses its file strictly, runs the project's `secretsModule` rules, and only then prepares and uploads |
| Hostinger and Cloudflare Pages setup | `setup-pages`/`hostinger setup` create or change provider resources and need `--yes`; `deploy` uploads the built files |
| `hosting reset`, `drop`, `recreate` | Permanently delete the configured website, database, cron jobs and (unless `--keep-pages`) the Pages project. Only unprotected environments and exact `--confirm-host`/`--confirm-project` values are accepted; `--dry-run` and `--check` change nothing |
| `wait tcp` | Opens TCP connections to the configured endpoint; it changes nothing |
| Swift bundle | Writes and signs an app bundle, ad-hoc unless an identity is configured |
| `dev start` | Runs the configured processes until one exits; it cannot stop what a process spawns on its own |
| `dev tabs` | Opens terminal windows that run the configured processes with your permissions; the processes outlive the command and are not stopped by it |
| `env generate` | Writes the files the project module returns, including secrets; keep them ignored by Git |
| `prisma migrate` | Changes the schema of the database named by the generated environment file; protected environments need `--allow-production` and the typed or `--confirm-host` host |
| `platformio` | Runs whatever PlatformIO subcommand you pass after `--` (builds, uploads, erase, `pkg exec` tools) with your permissions and the real device attached; rds does not restrict or guard it, so flashing policy belongs in the calling script |
| `exec` and project hooks | Run exactly the requested tool/argv; they are not restricted to the other modules' effects |

## Protected environments

Environment-bound commands (`cloudflare`, `hostinger`, `hosting`, `env`, `prisma`) require `--env` or the project's `defaultEnvironment`. The only exception is a project that configures no environments at all (no `production` section, no `env` module, no per-environment target overrides): `cloudflare` and `hostinger` then use the neutral, unprotected environment `default`, and `prisma`, `env` and hosting reset still refuse to guess. A default named `production` (or listed in `production.environments`) is protected like an explicit one.

Commands with mutation guards require `--allow-production` when their environment is protected. The default protected name is `production`; configure `production.environments` to protect additional names. Vue builds and local resource generators are not a global permission boundary, and neither is `exec`.

Configured production verification hooks execute before protected mutations. Keep stronger approval, identity, readiness and security checks in those hooks and/or post-sync verification. Do not assume an environment label proves which external account or deployment target a credential controls. Verify destination configuration before acting. Live reload is forbidden for the `production` environment.

## Dry-run

`--dry-run` skips subprocess execution and toolkit file writes. It still loads configuration and can read/validate inputs; an MJS config can execute arbitrary code during import. Treat configurations and catalogue imports as trusted code.

Dry-run logs intentionally omit argv, environment values and stdin. The internal `Context.plan` retains those values for programmatic inspection/testing and is **not** a sanitized artifact. Dry-run does not validate native signatures, remote credentials, API availability, account policy, or resulting UI behavior.

## Secrets and logging

- Keep credentials outside committed configuration. Prefer CI/host secret stores and ignored local files; use placeholders in examples.
- Cloudflare secret upload requires a filename and explicit name allowlist. It sends JSON on stdin instead of appending values to process arguments.
- rds's own step logs omit secret values and raw spawn errors. External tools, lifecycle scripts and hooks can emit their own output; review their behavior.
- Never place credentials in hook argv or publish full invocation plans.
- Do not automatically collect `.env` files, key material, caches, local configs, personal workspace notes, or release artifacts into the repository.

## Files and tools

Configured paths must remain inside the project. Output paths cannot replace a project root or escape through a symlink. Recursive cleaning is limited to explicitly configured, toolkit-marked output directories. Ownership markers are not a backup or a guarantee that an artifact is valid; retain important releases elsewhere.

One explicit read-only-reference exception exists: `store.allowExternalCredentials` permits absolute external `playKey`/`appleKey` filenames. It defaults to false, does not permit relative traversal, and never relaxes output/cleanup containment. Keep those files isolated; rds passes their paths to Fastlane rather than copying keys into the checkout. Configuration and dry-run do not read key contents.

JavaScript executables resolve from consumer dependencies. The process runner passes argv without a shell; validated Windows batch wrappers are the exception needed to invoke native batch scripts. An explicit `exec` or hook can still choose a shell—do not treat argv validation as isolation from trusted commands.

No automatic Git mutations, public mobile-store rollout, review submission, or Electron publishing are implemented. Store binary uploads are internal-only: the Play internal track (`completed` by default, `--status draft` to hold it back) and TestFlight internal testers are the only things made available instantly. Listing uploads only fill the drafts and never change a release's status or submit a version for review. (Google Play publishes listing edits straight away when an app has Managed publishing turned off; turn it on in the Play Console if listing changes must wait for review.) The pinned Fastlane rules are a maintained snapshot: review current store requirements when updating or preparing a release.
