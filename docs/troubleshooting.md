# Troubleshooting

Start with `npm exec -- rds <module> <command> --help`. The
[command registry](../src/cli.ts) and [configuration types](../src/types.ts) show
what the installed implementation actually supports.

| Symptom | Check / resolution |
| --- | --- |
| `rds` or its compiled entry point cannot be found | Install `reusable-dev-scripts` as a development dependency from npm. Build a local tooling checkout with `npm ci` before linking; see [local toolkit development](../README.md#local-toolkit-development). Use an npm alias or `npm exec -- rds ...` to expose the local bin. |
| Edits in a linked toolkit have no effect | Keep `npm run build -- --watch` running in the toolkit; the CLI executes `dist/`, not TypeScript source. Tarball installations are snapshots and must be repacked/reinstalled. |
| A JavaScript tool cannot be located | Install the relevant tool in the consuming project/workspace. `rds` resolves consumer dependencies, not a global copy or a download-on-demand replacement. |
| Config/flag is rejected | Check spelling and use the installed command's `--help`. Unknown fields and flags are deliberately rejected. Keep `version: 1` in config. |
| A workspace changes the wrong package | Set `capacitor.packageJson` relative to config root. Confirm the owning manifest and lockfile before bumping. Module roots are not automatically overridden by `--cwd`. |
| Generated assets are stale | Generate once to establish the native snapshot, then use `--check`. Regenerate from the correct source after intended edits; do not bypass a stale check by manually changing hashes. |
| Production action is blocked | Confirm the destination/environment and operator approval, then use `--allow-production`. Retain configured verification hooks; do not delete a stronger gate just to make the command succeed. |
| More than one Android device or iOS simulator is available | Select an authorized/booted target with `--device`. For physical Android installation, `--physical` filters emulators. |
| Android install has a signature mismatch | Decide whether local data must be preserved. `--replace` explicitly uninstalls and clears data; it is not an automatic fallback. |
| Swift/Electron cleanup rejects an existing output | Choose a fresh output location. The toolkit refuses to recursively remove directories it did not mark as owned; do not point output at an important folder. |
| Live reload cannot reach the frontend | Check host/port, strict-port conflicts, device forwarding, Vite HTTPS configuration and CA trust. Public hosts require HTTPS. Do not disable certificate verification. |
| Ruby/Bundler is unavailable | Install Ruby >=3.3 and Bundler separately. `STORE_RUBY` can select the Ruby executable. Credentials and gems are not installed globally by this tool. |
| Tests skip a filesystem/platform feature | Read the explicit skip reason and rerun in a suitable environment when that feature must be validated. Report a skip as a skip, not a passing check. |

Keep diagnostics safe: avoid copying credential files, full environment dumps,
or unredacted invocation plans. A dry-run can validate the plan without proving
that a native build, signature, remote account, or deployment will succeed.

[Command reference](commands.md) · [Configuration patterns](configuration.md) ·
[Safety model](safety.md)
