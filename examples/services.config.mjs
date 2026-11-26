// @ts-check
import { defineConfig } from 'reusable-dev-scripts'

// Backend/frontend monorepo with a local database, per-environment settings and Prisma migrations.
export default defineConfig({
  version: 1,
  // `rds env <template|validate|generate|check> --env <name>` drives this project-owned module.
  // It exports defaults(env), and optionally validate(env, config), outputs(env, config) and header(env).
  env: { module: 'scripts/environments.mjs', hints: { generate: 'npm run {env}:generate' } },
  // `rds dev start` runs these together with prefixed output; the first exit stops the others.
  dev: {
    processes: [
      { name: 'api', command: ['npm', 'run', 'dev', '--workspace', 'backend'] },
      { name: 'web', command: ['npm', 'run', 'dev', '--workspace', 'frontend'], environment: { VITE_MODE: '{env}' } },
    ],
  },
  // `rds wait tcp --target database` blocks until the generated DATABASE_URL accepts connections.
  wait: {
    targets: {
      database: { variable: 'DATABASE_URL', envFile: 'backend/.env', timeout: 90, hint: 'Start it with the project database script.' },
      // `rds wait http --target api` checks the application, not just the listening port.
      api: { url: 'http://127.0.0.1:3000/health', status: 200, marker: { header: 'x-release', value: 'development' }, timeout: 30 },
    },
  },
  // `rds prisma migrate --env staging` applies migrations using backend/.env.staging.
  prisma: { root: 'backend', envFile: 'backend/.env.{env}' },
  production: {
    environments: ['production'],
    verify: [['rds', 'env', 'check', '--env', '{env}']],
  },
})
