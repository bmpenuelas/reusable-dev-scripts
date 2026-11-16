import { defineConfig } from 'reusable-dev-scripts'
export default defineConfig({
  version: 1,
  // Keep the actual compile/test recipe local; do not call rds vscode package here.
  vscode: { noDependencies: true, prepare: [['npm', 'run', 'compile']] },
})
