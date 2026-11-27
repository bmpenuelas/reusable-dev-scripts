# Contributor guide for agents

This file governs changes to this toolkit. For adopting it in another project, start with [the integration playbook](docs/agents.md).

## Read first

- [README.md](README.md): purpose, installation and module boundaries.
- [docs/design.md](docs/design.md): architecture, testing and publication.
- [docs/commands.md](docs/commands.md): supported behavior and defaults.
- [src/types.ts](src/types.ts), [src/config.ts](src/config.ts), and [src/cli.ts](src/cli.ts): configuration/CLI source of truth.

## Constraints

- Keep all Markdown prose unwrapped, with one natural-length line per paragraph; do not insert line breaks to meet a character limit. Preserve structural Markdown and code blocks.
- Preserve type-specific commands; do not add repository-name detection, hidden project presets, or a universal shell/task engine.
- Keep credentials, personal identities/paths, private application names, workspace notes, and local machine configuration out of versioned content. Examples and fixtures must be synthetic and self-contained.
- Keep domain/security policy in consuming projects. Never weaken an approval, verification, TLS, signing, or secret-isolation boundary to make a test pass.
- Use argv arrays, consumer-local tools, contained paths and explicit effects. Preserve dry-run, production guards, version ownership and monotonic numbering.
- Do not run real native builds, installs, signing, uploads, deployments, Git mutations, or operations on unrelated repositories as test fixtures.
- Update types, runtime validation, command help, docs and tests together, following the checklist below.

## Files to update with a change

Go through this list for every change, in the same change. Skip a file only when nothing in it is affected.

| File | Update when |
| --- | --- |
| `src/types.ts`, `src/config.ts` | A config field, its validation or its fallback changes |
| `src/cli.ts` | A command, flag or help text changes |
| `src/index.ts`, `package.json` `exports` | The public API changes |
| `test/` | Always for a behavior change; a fix gets a test that fails without it |
| `CHANGELOG.md` | A consumer can notice the change: add it under `## Unreleased`, mark a **Behavior change**, and say what was not tested |
| `README.md` | Features, the command table, requirements or setup change |
| `docs/commands.md` | Behavior, execution order or defaults change |
| `docs/configuration.md` | Fields, fallbacks, config examples or account setup change |
| `docs/safety.md` | Side effects, credentials, path containment or guards change |
| `docs/troubleshooting.md` | An error message or known symptom is added or changes |
| `docs/hosting.md` | Cloudflare, Hostinger or hosting reset behavior changes |
| `docs/adoption.md`, `docs/agents.md` | Module boundaries, migration steps or what an integrator must check change |
| `docs/design.md` | A source file, support folder or publication step is added or moved |
| `skills/reusable-dev-scripts/SKILL.md` | An adopting agent needs to know it, or a module family or command is added |
| `examples/*.config.mjs`, `examples/README.md` | An example should show or explain the new configuration |
| `scripts/smoke-package.mjs` | A packed runtime file, command or export is added |
| `support/` | Shared lanes or assets change; keep their defaults and variables in step with `src/` |
| `AGENTS.md` | A file that belongs in this table is added |

## Prepare a version

1. Compare everything since the previous release commit with the table above and fill any gap.
2. Choose the number. Before 1.0, a new feature or a behavior change is a minor release and fixes alone are a patch.
3. In `CHANGELOG.md`, rename `## Unreleased` to `## <version>`.
4. Run `npm version <version> --no-git-tag-version`, which updates `package.json` and `package-lock.json`.
5. Run `npm run check` and follow the publication checklist in [docs/design.md](docs/design.md#before-publishing).
6. Commit, tag, push or publish only when asked. A release commit uses the version number as its subject and summarizes the changes in its body.

## Validate and report

Run `npm run check`; inspect the packed artifact when distribution changes. Read the publication checklist in [docs/design.md](docs/design.md). Report tests actually run, skipped/untested platform/account behavior, and any remaining work. Do not present a dry-run or configured CI matrix as a successful live operation.
