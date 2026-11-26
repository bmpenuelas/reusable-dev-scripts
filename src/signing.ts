// A read-only check that the Developer ID identity a build will ask for exists in this Mac's keychain. Nothing is signed,
// and the keychain's identity list is never printed.
import { requireValue } from './runtime.js'
import type { Context } from './context.js'

const prefix = 'Developer ID Application:'

export function hasSigningIdentity(output: string, name: string): boolean {
  return output.split(/\r?\n/u).some(line => /^\s*\d+\)\s+[0-9A-F]{40}\s+"(.*)"\s*$/iu.exec(line)?.[1] === `${prefix} ${name}`)
}

export async function checkSigningIdentity(ctx: Context, root: string, platform: NodeJS.Platform = process.platform) {
  requireValue(platform === 'darwin' || ctx.dryRun, 'The signing identity preflight requires macOS')
  // The same value electron-builder reads, unless named explicitly.
  const name = ctx.string('identity', process.env.CSC_NAME ?? '').trim()
  requireValue(name, 'Use --identity or set CSC_NAME to the certificate name, for example "Example Company (TEAMID1234)"')
  requireValue(!name.startsWith(prefix), `Give the identity without the "${prefix}" prefix`)
  const result = await ctx.run('security', ['find-identity', '-v', '-p', 'codesigning'], { cwd: root, capture: true, label: 'List code signing identities' })
  if (ctx.dryRun) return
  requireValue(hasSigningIdentity(result.stdout, name), 'No valid Developer ID Application identity with the requested name is installed in the keychain')
  ctx.log('[rds] The requested Developer ID Application identity is installed')
}
