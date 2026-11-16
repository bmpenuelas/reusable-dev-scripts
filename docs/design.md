# Design, development and publication

## Architecture

The CLI separates workflows by project kind. A change for a Swift bundle should
not create switches in an Electron builder; browser ZIP packaging is separate
from VSIX publication. Compose a few explicit commands instead of introducing a
universal workflow language.

| Location | Responsibility |
| --- | --- |
| [src/cli.ts](../src/cli.ts) | Command registry, strict flag parsing, help and dispatch |
| [skills/reusable-dev-scripts/SKILL.md](../skills/reusable-dev-scripts/SKILL.md) / [src/skill.ts](../src/skill.ts) | Npm-distributed adoption skill and explicit, contained project installation |
| [src/types.ts](../src/types.ts) / [src/config.ts](../src/config.ts) | Public config contract, validation and discovery |
| [src/context.ts](../src/context.ts) | Environment selection, bounded hooks, guards and dry-run |
| [src/runtime.ts](../src/runtime.ts) | Consumer tool resolution, argv execution, signals, paths and safe writes |
| [src/result.ts](../src/result.ts) | Executable-only result banners, output preferences and exit-code preservation |
| [src/capacitor.ts](../src/capacitor.ts) / [src/android.ts](../src/android.ts) | Native workflow mechanics |
| [src/versions.ts](../src/versions.ts) | Version preflight and monotonic native numbering |
| [src/images.ts](../src/images.ts) / [src/screenshots.ts](../src/screenshots.ts) | Normalized assets, locale outputs, capture and resizing |
| [src/store.ts](../src/store.ts) / [support/store](../support/store/) | Metadata checks, locked shared Fastlane lanes and Ruby invocation |
| [src/desktop.ts](../src/desktop.ts) | Separate Electron and Swift operations |
| [src/extensions.ts](../src/extensions.ts) / [src/cloudflare.ts](../src/cloudflare.ts) | Extension publication and explicit deployment targets |
| `test/` (repository checkout) | Synthetic consumer fixtures and regression tests |
| `scripts/smoke-package.mjs` (repository checkout) | Packed distribution/API/CLI consumer checks |

Source is TypeScript; `npm run build` emits JavaScript and declarations to ignored
`dist/`. The npm file allowlist ships the executable, compiled modules, shared
support files, reference source, agent guidance, examples and docs—not development
caches or private configuration. Consumers execute `dist/`; shipped source is for
inspection, not an additional compilation requirement.

## Make a change

```sh
npm ci
npm run typecheck
npm test
npm run test:package
npm run check
```

The test suite exercises fixture projects, fake external build/upload tools,
native version edits, filesystem containment, real Node/npm process behavior,
and Windows batch argument handling. It must not act on real application repos
or remote accounts. Tests requiring unsupported host features may report an
explicit skip; do not describe a skipped check as passed.

Update the command registry, types/runtime validation, documentation, examples,
and relevant tests together. Example configs should be importable and generic.
The [command reference](commands.md) describes behavior; do not rely on CLI names
alone when changing sequencing or defaults.

## Shared store support

The metadata validator takes application locale/device/path data through an
explicit adapter. It does not import application source or embed app identities.
Shared Ruby lanes use a consumer-local import shim and gem cache. The
[lockfile](../support/store/Gemfile.lock) pins Fastlane; store field/media rules
in [specs.mjs](../support/store/specs.mjs) are a versioned snapshot, not permanently
current store policy. Review both when upgrading.

Relevant external interfaces:

- [Node child processes](https://nodejs.org/api/child_process.html)
- [Capacitor Assets](https://github.com/ionic-team/capacitor-assets)
- [Fastlane shared Fastfiles](https://docs.fastlane.tools/advanced/Fastfile/)
- [VSCE](https://github.com/microsoft/vscode-vsce)

## Before publishing

1. Run `npm run check`; review failures and explicit skips. CI is configured in
   `.github/workflows/ci.yml` in the repository checkout, not a substitute for native/account
   acceptance testing.
2. Validate the relevant native artifacts and remote behavior separately, with
   appropriate operator approval. Never use a real deployment as a fixture test.
3. Inspect staged/tracked source and `npm pack --dry-run --json` for credentials,
   personal identities, absolute home/workspace paths, private project references,
   notes, caches, and accidental release files. Automated portability checks
   help, but do not prove a repository is free of every secret or personal name.
4. If private material was previously committed, inspect Git history before
   making a remote public. Removing a working-tree file does not erase history;
   coordinate any history rewrite with collaborators instead of doing it silently.
5. Confirm the intended package name and hosting metadata. The project uses the
   [MIT license](../LICENSE); preserve its notice when distributing the package.
   Verify registry availability and publish permissions before announcing a release;
   documenting npm installation is not evidence that publication has happened.
6. Build the versioned tarball with `npm pack`, inspect its contents, and install
   it in an isolated consumer. Commit lockfile/config changes as appropriate;
   `rds` never commits or publishes the toolkit for you.

Keep machine-specific paths and credentials in ignored local files or CI secret
stores. Public fixtures and examples must use synthetic names and relative paths.
