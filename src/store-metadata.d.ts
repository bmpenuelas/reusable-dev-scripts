declare module '*.mjs' {
  export function createStoreMetadata(settings: Record<string, unknown>): {
    createPaths(root: string): Record<string, string>;
    runCheck(options: Record<string, unknown>, paths: Record<string, string>): Promise<{ count(level: string): number; print(): void }>;
    scaffold(options: Record<string, unknown>, paths: Record<string, string>): Promise<void>;
    changelog(options: Record<string, unknown>, paths: Record<string, string>): Promise<void>;
  }
  /** Shared store media specs (support/store/specs.mjs). */
  export const ANDROID_MEDIA: Record<string, { maxBytes: number; min?: number; max?: number; minSide?: number; maxSide?: number; maxRatio?: number; width?: number; height?: number }>
  export const IOS_DISPLAY_TYPES: Record<string, { label: string; group: 'iphone' | 'ipad' | 'watch'; sizes: [number, number][] }>
  export const IOS_SCREENSHOT: { min: number; max: number; maxBytes: number }
}
