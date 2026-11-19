# Configuration examples

Copy the relevant config into your application as `reusable-dev-scripts.config.mjs`, then adapt it. These examples are independent templates, not complete demo apps.

| Example | Starting point / prerequisites |
| --- | --- |
| [capacitor.config.mjs](capacitor.config.mjs) | Existing Vue/Capacitor application with native projects and icon artwork |
| [workspace.config.mjs](workspace.config.mjs) | Frontend/backend/extension roots with explicit version ownership |
| [store.config.mjs](store.config.mjs) | Existing mobile app and application-owned listing/credentials |
| [vscode.config.mjs](vscode.config.mjs) | Existing compile alias and VS Code manifest |
| [electron.config.mjs](electron.config.mjs) | Existing frontend build and Electron entry/builder config |
| [swift.config.mjs](swift.config.mjs) | Existing SwiftPM product with plist, resources and entitlements |
| [hosting.config.mjs](hosting.config.mjs) | Cloudflare Pages and Hostinger targets with API-token credentials in ignored files |
| [services.config.mjs](services.config.mjs) | Backend/frontend monorepo with a database, environment files and Prisma |

- Replace every synthetic ID, project name, source path, profile, and output path.
- Configure only modules you use. Tool dependencies and native SDKs remain yours.
- Commented hooks name scripts you supply; they are not built-in generators.
- Put real credentials in ignored files or the host/CI secret store.
- Preserve application approvals, platform transformations and native policy.
- Run `--help`, dry-run, local checks, artifact checks, and then authorized platform/account acceptance tests before removing old helpers.

[Configuration patterns](../docs/configuration.md) · [Command reference](../docs/commands.md) · [Adoption guide](../docs/adoption.md)
