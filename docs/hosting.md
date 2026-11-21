# Hosting resources and deployments

## Cloudflare Pages

`rds cloudflare setup-pages --target web --env staging --yes` idempotently creates a Direct Upload project with production branch `main` and adds the configured custom domains. An existing Git-integrated project or another production branch fails rather than being changed. Custom-domain DNS records and certificate activation remain separate unless the target sets `zoneId`: then `setup-pages` also keeps a proxied CNAME from every configured domain to `<projectName>.pages.dev` (created, or made proxied; a record that points anywhere else is never re-pointed and fails the command), and `wwwRedirect: true` with exactly one apex domain adds a proxied `www` CNAME plus a Single Redirect rule (`redirectRef` names the rule, so an existing one can be adopted) that sends www to the apex with a 301, keeping path and query. The API token then also needs DNS Edit and Single Redirect (Rulesets) permissions on that zone. Certificate activation can still take a while; adding the Pages domain is not proof it is live. `deploy-pages` continues to use the consumer's installed Wrangler and the selected branch; existing deployment workflows are preserved.

```js
import { defineConfig } from 'reusable-dev-scripts'

export default defineConfig({
  version: 1,
  cloudflare: {
    credentialsFile: '.secrets/deployment.env',
    targets: {
      web: {
        kind: 'pages', directory: 'web/dist', projectName: 'example-app',
        environments: { production: { projectName: 'example-live' } },
      },
    },
  },
})
```

Provide `CLOUDFLARE_API_TOKEN` with account-scoped Pages Edit permission and `CLOUDFLARE_ACCOUNT_ID` in the shell or ignored credentials file. A target `accountId` overrides the account variable. Shell variables override file credentials. Each target can override settings by deployment environment; unknown fields are rejected. Project creation and domain attachment use the official HTTPS API. Asset upload uses the project's pinned Wrangler. Never pass token values as CLI arguments.

## Hostinger managed Node.js

`rds hostinger setup --target api --env staging --yes` ensures the named MySQL database/user (from `databaseVariable` in the backend env file) and the configured cron job. It does not rotate passwords, drop databases, change existing cron schedules, buy hosting, or provision a website. First create the intended website on a compatible Web/Cloud plan and obtain its exact domain and hosting username. An existing database with another user or a matching cron command with a different schedule fails for operator reconciliation.

`rds hostinger deploy --target api --env staging --yes` replaces the website's entire Node.js environment with the selected backend file, then uploads the prepared directory with the official Hostinger CLI and waits for its Node.js build. This replaces website files. The directory must contain a self-contained npm application; application-specific build/migration/seed commands are owned by that application. The Hostinger CLI skips `.env` and credentials while packing; environment values travel separately through the HTTPS API. Hostinger rejects empty environment values, so empty strings are omitted from its full-replacement payload; this removes any previously configured value for those keys. Applications must supply their own defaults for omitted optional settings. The deploy command locally validates the nonempty payload against the provider limits (1-1000 variables, uppercase names up to 255 characters, values up to 8192 characters) before invoking upload tools or changing the remote environment. Validation errors never print values. Configure exclusions such as `PORT` when the hosting platform owns them. Never use a credentials file as the backend env file.

```js
import { defineConfig } from 'reusable-dev-scripts'

export default defineConfig({
  version: 1,
  hostinger: {
    credentialsFile: '.secrets/deployment.env',
    targets: {
      api: {
        domain: 'api.example.com', username: 'account_example',
        directory: 'deploy/api', envFile: 'backend/.env.{env}',
        excludeEnv: ['PORT'], databaseVariable: 'DATABASE_URL',
        nodeVersion: 24, buildScript: 'build', entryFile: 'dist/main.js',
      },
    },
  },
})
```

Install the official [Hostinger CLI](https://github.com/hostinger/api-cli/releases) separately, ensure `hostinger` is on PATH, and set `HOSTINGER_API_TOKEN` from hPanel's API section in the shell or credentials file. The CLI must support `up`, JSON output, `--source`, `--entry-file`, `--output-directory`, `--root-directory`, and `--no-input`. Only a `completed` build is accepted; queued/failed/unknown results fail. CLI output is captured rather than printed because build failures can include secrets. Use hPanel for detailed diagnostics. A completed build is not an application health check.

Database creation requires a server-local `mysql://` or `mariadb://` URL using `127.0.0.1:3306`, full account-prefixed names, and a password. Existing databases retain their passwords and data; update mismatched credentials manually. Cron commands must fit Hostinger's 255-character limit and cannot contain percent signs or newlines. Cron does not inherit website variables: use its deployed env file explicitly or make the application load its own file. The schedule is UTC. Only the exactly matching command is deduplicated; review obsolete cron entries if paths change.

## Safety and verification

All setup/deploy operations need an environment: an explicit `--env`, or the top-level `defaultEnvironment` of a single-environment project. Resource creation and Hostinger replacement require `--yes`; protected environments additionally require `--allow-production` and execute the project's production verification hooks first. Dry-runs perform no HTTP requests, read no credential files, invoke no upload tools, and do not execute prepare hooks. They describe the selected domain/action, not secret values or request bodies. They are plans, not validation of remote credentials or resources.

Provider requests enforce HTTPS origins, reject redirects, use bounded timeouts, and report sanitized HTTP failures without printing response bodies or fetch errors. The API origins are fixed in the implementation. Credentials stay out of command arguments and backend environment payloads. Setup and uploads are separate, so partial failures are visible; no cross-provider rollback is attempted. Setup can safely be repeated; deployment restarts/replaces the selected application and must be deliberately invoked.

Tests use synthetic directories, fake credentials, injected HTTP responses and stub upload runners. They cover guards, repeated setup, conflicting resources, provider failures, incomplete builds, env/account selection and redaction. No live provider acceptance test is implied.

## Provider references

- [Cloudflare Pages API](https://developers.cloudflare.com/api/resources/pages/subresources/projects/methods/create/)
- [Hostinger CLI operations and API mapping](https://github.com/hostinger/api-cli)
- [Hostinger Node.js cron](https://www.hostinger.com/support/how-to-run-cron-jobs-for-node-js-websites-at-hostinger/)

## Destructive hosted resource recreation

`rds hosting reset --env staging --hostinger-target api --pages-target web --yes --confirm-host api-stage.example.com --confirm-project example-stage --output .rds/hosting-reset-staging.json` deletes the exact Hostinger website and its data, its configured database (including remote connections), cron commands under that site's directory, and the whole Pages project/deployment history, then recreates a website on the same discovered hosting order and a Direct Upload Pages project on main. It initializes a secret-free managed Node placeholder through the official CLI; no manual ZIP or site recreation is needed. The consuming project must rotate application secrets, regenerate URLs/configuration, create its DB/cron, deploy its application and verify it. No subscription purchase, account deletion, DNS-zone deletion, token revocation or OS reimage is performed.

An unprotected hosted environment (`--env`, or `defaultEnvironment`) and exact host/project confirmations are mandatory. Production and configured protected environments are forbidden even with --allow-production. --dry-run performs no provider requests or credential/journal writes; --check reads both providers and checks CLI/inventory without mutation. The implementation preflights both providers before deleting anything, rejects aliases/subdomains, child sites, shared DB users, conflicting database ownership, Git-integrated Pages projects and protected-target collisions. Only site-path cron commands and the configured exact command are removed; other account-level jobs are not inferred to belong to the site.

Hostinger recreation uses its official async website deletion/onboarding APIs and polls boundedly for completion. Provider temporary hostingersite.com domains get a freshly generated domain, as old free names are not generally reusable. The output journal records the replacement domain/username/order and phase but no credentials. Use --resume with the same output and original confirmations after a partial failure; do not remove the journal and start another wipe. A failure has no cross-provider rollback. Custom domains are reattached by normal setup; DNS/cert propagation or DNS pointing to a changed origin may still require attention. The API cannot guarantee an identical Pages subdomain after project recreation: consumers must verify their configured frontend address.

This is resource recreation, not proof of incident eradication. Hostinger's website deletion removes site files/configuration/databases, but account-level hooks, provider-retained backups, other storage, third-party integrations, stolen tokens and browser service workers are outside this command. Rebuild only from trusted fixed code. The managed DB API does not expose independent database-user deletion; recreating the DB with a new generated password rotates the configured user's access, but is not a claim that all possible account-level grants/users were purged.

Provider contracts: [Hostinger website APIs](https://github.com/hostinger/api-python-sdk/blob/main/docs/HostingWebsitesApi.md), [onboarding request](https://github.com/hostinger/api-python-sdk/blob/main/docs/HostingV1OnboardingsStartOnboardingRequest.md), [database deletion](https://github.com/hostinger/api-python-sdk/blob/main/docs/HostingDatabasesApi.md), [Cloudflare Pages project API](https://developers.cloudflare.com/api/resources/pages/subresources/projects/).
### Drop now, recreate later

`rds hosting drop --env staging --yes --confirm-host api-stage.example.com --confirm-project example-stage --output .rds/hosting-reset-staging.json` executes only the destructive half and stops at journal phase 4: the whole API website, configured DB and scoped cron are removed and no Node placeholder, new website, domain reservation, frontend build or deployment is created. The default also removes Pages. `--keep-pages` preserves the exact Pages project/history/domains without any Pages writes; the configured database is still deleted. There is no keep-db option because Hostinger site deletion includes attached DBs. Drop does not require the upload CLI: no upload is performed. It still preflights both provider inventories and requires exact confirmations, and supports request/write-free --dry-run or read-only --check.

`rds hosting recreate --env staging --yes --confirm-host api-stage.example.com --confirm-project example-stage --output .rds/hosting-reset-staging.json` resumes ONLY a completed drop journal (phase 4 or later), automatically inheriting its Pages retention choice. It never repeats deletion. After recreation the consuming project must rotate app secrets, regenerate configuration and deploy. Keep the original confirmations and journal when the API address changes. --resume continues a failed drop; do not start a new reset on an offline environment. Full hosting reset remains the immediate combined workflow. Protected environments remain forbidden for all three operations.

Free Hostinger subdomain allocation is delayed until recreation so a site can remain absent for days without expiring a reserved temporary name. Static frontend retention does not preserve backend functionality: existing JS may keep calling its baked-in old API URL, and deleted/released API names must not be trusted indefinitely. No claim of frontend immutability, complete database isolation or account-level attack prevention is implied.