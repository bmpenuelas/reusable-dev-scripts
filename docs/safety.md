# Safety model and operational limits

`reusable-dev-scripts` is a build/release tool, not a sandbox or an authorization service. It executes trusted project configuration and requested external tools with the operator's permissions. The project owns account access and application policy.

## Effects must be intentional

| Operation | Behavior to review before execution |
| --- | --- |
| Vue/native build and sync | Can write build outputs, generated resources and native project files |
| Native version synchronization | Writes version settings; `--bump` also changes package/lockfile versions |
| Android install | Replaces an installed APK with `adb install -r`; `--replace` explicitly uninstalls first and deletes local app data |
| Screenshots | Writes captures/resized files; opening a session can build and install the app |
| Store commands | `check` is local; `doctor` reads remote account state; listing/build uploads and pull perform their documented remote/local effects |
| VS Code publish | Publishes to the requested registries, defaulting to both |
| Electron notarize | Submits an artifact to a remote service, then may staple it |
| Cloudflare commands | Deploy code/files or change allowlisted Worker secrets |
| `exec` and project hooks | Run exactly the requested tool/argv; they are not restricted to the other modules' effects |

## Protected environments

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

No automatic Git mutations, public mobile-store rollout, review submission, or Electron publishing are implemented. Store binary uploads are internal-only. The pinned Fastlane rules are a maintained snapshot: review current store requirements when updating or preparing a release.
