import { defineConfig } from '../dist/index.js'

export default defineConfig({
  version: 1,
  cloudflare: {
    credentialsFile: '.secrets/deployment.env',
    targets: { web: { kind: 'pages', directory: 'web/dist', projectName: 'example-app' } },
  },
  hostinger: {
    credentialsFile: '.secrets/deployment.env',
    targets: {
      api: {
        domain: 'api.example.com', username: 'account_example',
        directory: 'deploy/api', envFile: 'backend/.env.{env}',
        excludeEnv: ['PORT'], databaseVariable: 'DATABASE_URL', nodeVersion: 24,
      },
    },
  },
})
