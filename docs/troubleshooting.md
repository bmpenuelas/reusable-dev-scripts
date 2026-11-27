# Troubleshooting

Start with `npm exec -- rds <module> <command> --help`. The [command registry](../src/cli.ts) and [configuration types](../src/types.ts) show what the installed implementation actually supports.

| Symptom | Check / resolution |
| --- | --- |
| `rds` or its compiled entry point cannot be found | Install `reusable-dev-scripts` as a development dependency from npm. Build a local tooling checkout with `npm ci` before linking; see [local toolkit development](../README.md#local-toolkit-development). Use an npm alias or `npm exec -- rds ...` to expose the local bin. |
| Edits in a linked toolkit have no effect | Keep `npm run build -- --watch` running in the toolkit; the CLI executes `dist/`, not TypeScript source. Tarball installations are snapshots and must be repacked/reinstalled. |
| A JavaScript tool cannot be located | Install the relevant tool in the consuming project/workspace. `rds` resolves consumer dependencies, not a global copy or a download-on-demand replacement. |
| Config/flag is rejected | Check spelling and use the installed command's `--help`. Unknown fields and flags are deliberately rejected. Keep `version: 1` in config. |
| A workspace changes the wrong package | Set `capacitor.packageJson` relative to config root. Confirm the owning manifest and lockfile before bumping. Module roots are not automatically overridden by `--cwd`. |
| A shared npm lockfile does not change on a version bump | Keep the RDS config at or above the npm workspace root. RDS only updates existing lockfiles with an entry for the package; it does not generate or regenerate the dependency graph. |
| Generated assets are stale | Generate once to establish the native snapshot, then use `--check`. Regenerate from the correct source after intended edits; do not bypass a stale check by manually changing hashes. |
| `check-locales` lists missing or stale languages | Generate the string files first (`rds capacitor locales` or your generator), then run `rds capacitor register-locales` and review the diff, or make the listed changes in Xcode. Confirm the configured targets, directories and files match the project. |
| `register-locales` says a group, target or build phase is missing | It only maintains localizations. Add the target, group or Copy Bundle Resources phase in Xcode, or set the target's `directory`, then rerun. Nothing was written. |
| `app-links generate` refuses to overwrite a file | The file declares something rds does not manage, or is not valid JSON. Keep maintaining it yourself, or move the extra declarations out deliberately. |
| `android inspect` cannot run `aapt2` | Install Android SDK build-tools and set `ANDROID_HOME`/`ANDROID_SDK_ROOT` or `android.sdkRoot`, or put `aapt2` on PATH. |
| Production action is blocked | Confirm the destination/environment and operator approval, then use `--allow-production`. Retain configured verification hooks; do not delete a stronger gate just to make the command succeed. |
| More than one Android device or iOS simulator is available | Select an authorized/booted target with `--device`. For physical Android installation, `--physical` filters emulators. |
| Android install has a signature mismatch | Decide whether local data must be preserved. `--replace` explicitly uninstalls and clears data; it is not an automatic fallback. |
| APK installs but package verification fails | Match `android.appId` to the APK application ID, including any debug suffix. With an `applicationIdSuffix` of `.debug`, verifying the unsuffixed release ID is wrong. Check Gradle's APK `output-metadata.json` or inspect the APK; keep release/store identity separate. Do not weaken verification or uninstall the store app. |
| Gradle succeeded but `Reveal artifact` failed or warned | The artifact is already built at the printed path. Current RDS requests a visible Explorer window and accepts its normal handoff statuses 0 and 1 without warning; actual launch/other-exit failures remain warning-only for this optional action. Other commands retain strict exit handling. Update an older toolkit, open the artifact manually, or omit `--reveal`. Do not rerun a version-bumping release recipe solely to open its output folder. |
| Swift/Electron cleanup rejects an existing output | Choose a fresh output location. The toolkit refuses to recursively remove directories it did not mark as owned; do not point output at an important folder. |
| Live reload cannot reach the frontend | Check host/port, strict-port conflicts, device forwarding, Vite HTTPS configuration and CA trust. Public hosts require HTTPS. Do not disable certificate verification. |
| Ruby/Bundler is unavailable | Install Ruby >=3.3 and Bundler separately. `STORE_RUBY` can select the Ruby executable. Credentials and gems are not installed globally by this tool. |
| `No Google Play service account key` or `No App Store Connect API key` | Set `store.playKey`/`store.appleKey` or `SUPPLY_JSON_KEY`/`APP_STORE_CONNECT_API_KEY_PATH`, or put the file at the path the message names. A path outside the project also needs `store.allowExternalCredentials`. |
| `store doctor` fails with `The caller does not have permission` (Google Play) | The service account is not invited to this app. In Play Console → Users and permissions, add it with the app permissions *View app information*, *Manage store presence* and *Release apps to testing tracks*. See [store account access](configuration.md#store-account-access). |
| Tests skip a filesystem/platform feature | Read the explicit skip reason and rerun in a suitable environment when that feature must be validated. Report a skip as a skip, not a passing check. |

Keep diagnostics safe: avoid copying credential files, full environment dumps, or unredacted invocation plans. A dry-run can validate the plan without proving that a native build, signature, remote account, or deployment will succeed.

[Command reference](commands.md) · [Configuration patterns](configuration.md) · [Safety model](safety.md)
