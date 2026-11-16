declare module '*.mjs' {
  export function createStoreMetadata(settings: Record<string, unknown>): {
    createPaths(root: string): Record<string, string>;
    runCheck(options: Record<string, unknown>, paths: Record<string, string>): Promise<{ count(level: string): number; print(): void }>;
    scaffold(options: Record<string, unknown>, paths: Record<string, string>): Promise<void>;
    changelog(options: Record<string, unknown>, paths: Record<string, string>): Promise<void>;
  }
}
