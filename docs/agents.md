# Agent integration playbook

This guide is for an agent adopting `reusable-dev-scripts` **inside another project**.
For changes to the toolkit itself, read [AGENTS.md](../AGENTS.md) and
[design and development](design.md).

## Read before editing

For a reusable agent skill, install the npm dependency first and run
`npm exec -- rds skill install` from the target project root. Read
`.agents/skills/reusable-dev-scripts/SKILL.md` explicitly if your client does not
discover it automatically. See [skill installation](../README.md#install-the-agent-skill)
for another project-local destination and existing-file behavior.

1. [README](../README.md): purpose, installation, module/toolchain selection.
2. [Adoption guide](adoption.md): inventory and migration sequence.
3. [Configuration patterns](configuration.md) and the relevant section of the
   [command reference](commands.md).
4. [Safety model](safety.md): authorization, data loss, secrets, and dry-run limits.
5. [Config types](../src/types.ts), [runtime validation](../src/config.ts), and
   [command registry](../src/cli.ts) when precise supported fields/flags matter.

Do not invent missing flags, turn plain strings into executable shell commands,
or infer which package owns an app version from a directory name.

## Required integration procedure

### Inspect

- Read applicable project instructions and root/workspace manifests.
- Read the helper implementations being replaced, not just their names.
- Identify build prerequisites, post-processing, version/lockfile ownership,
  native resource registration, authorization gates, and retry semantics.
- Identify credential sources by **variable/file names only**. Do not print,
  copy, commit, or request secret contents in a normal report.

### Propose the smallest change

State the module, old alias, new command, retained local hooks, and verification
method. Move mechanics, not product behavior. Keep ordinary test/lint/build-tool
commands direct if they need no shared implementation.

### Implement

- Install the published `reusable-dev-scripts` package with `--save-dev --save-exact`
  and update the target application's lockfile. Use a local checkout only when
  developing the toolkit or before publication; follow [local toolkit development](../README.md#local-toolkit-development)
  and do not accidentally commit temporary link dependencies.
- Add the smallest `reusable-dev-scripts.config.mjs` or JSON config and ignore `.rds/` plus
  local secrets. Start from a relevant [example](../examples/README.md).
- Keep required security and approval policy. Never replace it solely with
  `--allow-production`; that flag is acknowledgement, not authentication.
- Preserve environment/backend/frontend allowlists and platform-specific build
  outputs. Do not copy a backend secret into a frontend environment mapping.
- Preserve explicit version increments. Never add a bump to a retry operation.
- Avoid recursive aliases/hooks and avoid duplicate native sync/build steps.

### Verify

Use application-local CLI resolution rather than an unpinned package download:

```sh
npm exec -- rds capacitor sync --help
npm exec -- rds capacitor sync --platform android --env staging --dry-run
npm exec -- rds capacitor versions --platform android --check
```

Run the project's existing tests and compare generated files/artifacts. A
fixture test or dry-run is not evidence that signing, device installation, store
credentials, or deployment succeeded. Get operator approval before remote,
production, signing, certificate-trust, or data-clearing operations.

Full in-memory invocation plans are **not redacted**. They may include stdin and
environment values. Do not upload them or paste them into the final report.

## Completion report

Report:

- files and aliases changed;
- shared commands adopted and local behavior deliberately retained;
- tests/checks actually run and their results;
- version/native/config changes produced;
- platform/account checks not run, and why;
- any remaining migration work.

Do not claim a deployment/upload/install succeeded unless its actual result was
observed. Do not modify unrelated projects or automatically commit/push changes.
