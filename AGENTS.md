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
- Update types, runtime validation, command help, docs and tests together.

## Validate and report

Run `npm run check`; inspect the packed artifact when distribution changes. Read the publication checklist in [docs/design.md](docs/design.md). Report tests actually run, skipped/untested platform/account behavior, and any remaining work. Do not present a dry-run or configured CI matrix as a successful live operation.
