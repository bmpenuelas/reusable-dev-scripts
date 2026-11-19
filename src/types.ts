export type Command = readonly [string, ...string[]]
export type Hooks = { prepare?: Command[]; prepareByEnv?: Record<string, Command[]>; build?: Command; buildByPlatform?: Partial<Record<'android' | 'ios', Command>>; environment?: Record<string, string>; environmentByPlatform?: Partial<Record<'android' | 'ios', Record<string, string>>>; afterBuild?: Command[]; afterSync?: Command[]; verify?: Command[] }
export type Flags = Record<string, string | boolean>
/** `prefix` streams each output line with that prefix instead of inheriting stdio (used by concurrent runs). */
export interface Invocation { command: string; args: string[]; cwd: string; env?: NodeJS.ProcessEnv; input?: string; capture?: boolean; label?: string; timeout?: number; signal?: AbortSignal; prefix?: string; /** Defaults to [0]; only opt into a tool's documented nonzero success convention. */ successExitCodes?: readonly number[]; /** Defaults to true; explicit GUI launches can request a visible window. */ windowsHide?: boolean }
export interface Result { stdout: string; stderr: string }
export type Runner = (invocation: Invocation) => Promise<Result>
export interface Images { source: string; background?: string; outputs?: { path: string; width: number; height?: number }[] }
export interface NativeLocales { locales: Record<string, Record<string, string>>; defaultLocale: string; targets: { format: 'android' | 'apple'; directory: string; keys?: Record<string, string> }[] }
export interface Config {
  version: 1;
  /** Environment used by cloudflare, hostinger, hosting, env and prisma commands when --env is omitted (single-environment projects). */
  defaultEnvironment?: string;
  output?: { banners?: boolean };
  production?: { environments?: string[]; verify?: Command[] };
  vue?: { root?: string; typecheck?: 'build' | 'noEmit' | false; modes?: Record<string, string> };
  capacitor?: Hooks & { root?: string; packageJson?: string; platforms?: ('android' | 'ios')[]; androidProject?: string; iosProject?: string; assets?: Images & { native?: boolean }; locales?: NativeLocales; live?: { host?: string; port?: number; https?: boolean; ca?: string; timeout?: number }; screenshots?: { output?: string; sizes?: { width: number; height: number }[] } };
  android?: { root?: string; appId?: string; module?: string; apk?: string; aab?: string; mapping?: string; javaHome?: string; sdkRoot?: string };
  store?: { root?: string; locales?: (string | { app: string; android: string; ios: string })[]; appLocales?: string[]; defaultLocale?: string; defaultLocales?: { android: string; ios: string }; iosDevices?: { iphone: boolean; ipad: boolean; watch: boolean }; androidId?: string; iosId?: string; appleKey?: string; playKey?: string; allowExternalCredentials?: boolean; iosProject?: string; iosScheme?: string; hooks?: { beforeUpload?: Command[]; afterBuildUpload?: Command[] }; versionPackage?: string };
  electron?: { root?: string; url?: string; start?: Command; assets?: Images & { ico?: string; icns?: string; windowsCornerRadius?: number }; output?: string; builderConfig?: string; notaryProfile?: string; prepare?: Command[] };
  swift?: { root?: string; executable?: string; plist?: string; resources?: string; entitlements?: string; output?: string; identity?: string; icon?: string; iconOutput?: string };
  vscode?: { root?: string; prepare?: Command[]; noDependencies?: boolean; output?: string };
  cloudflare?: { credentialsFile?: string; targets: Record<string, CloudflareTarget> };
  hostinger?: { credentialsFile?: string; targets: Record<string, HostingerTarget> };
  browser?: { root?: string; directory: string; output: string; prepare?: Command[] };
  dev?: { root?: string; processes: DevProcess[] };
  wait?: { targets: Record<string, WaitTarget> };
  env?: { directory?: string; module: string; environments?: string[]; autoCreate?: string[]; hints?: { template?: string; generate?: string } };
  prisma?: { root?: string; envFile: string; variable?: string };
}
/** One long-running process started by `dev start`. `root` is relative to `dev.root`. */
export interface DevProcess { name: string; command: Command; root?: string; environment?: Record<string, string> }
/** A TCP endpoint: explicit `host`/`port`, a `url`, or a URL read from `variable` (process environment, then `envFile`). */
export interface WaitTarget { host?: string; port?: number; url?: string; variable?: string; envFile?: string; timeout?: number; hint?: string }
/** Contract of the project module named by `env.module`. Project policy (defaults, rules, file formats) stays in that module. */
export interface EnvModule {
  /** Default configuration for one environment. `null` marks a value a human must supply. */
  defaults(environment: string): Record<string, unknown>;
  /** Extra project rules. Return human-readable problems; an empty list means valid. */
  validate?(environment: string, config: Record<string, unknown>): string[];
  /** Generated files for one environment; `path` is relative to the config root. */
  outputs?(environment: string, config: Record<string, unknown>): { path: string; content: string }[];
  /** Optional first comment lines of the editable file. */
  header?(environment: string): string[];
}

export interface CloudflareSettings { kind: 'worker' | 'pages'; root?: string; config?: string; directory?: string; projectName?: string; accountId?: string; domains?: string[]; secretsFile?: string; secretNames?: string[]; commitDirty?: boolean; branch?: string; wranglerEnv?: string | false; prepare?: Command[] }
export interface CloudflareTarget extends CloudflareSettings { environments?: Record<string, Partial<CloudflareSettings>> }
export interface HostingerSettings { domain?: string; username?: string; directory?: string; envFile?: string; excludeEnv?: string[]; databaseVariable?: string; nodeVersion?: 22 | 24; entryFile?: string; buildScript?: string; cron?: { command: string; schedule: string } }
export interface HostingerTarget extends HostingerSettings { environments?: Record<string, Partial<HostingerSettings>> }
