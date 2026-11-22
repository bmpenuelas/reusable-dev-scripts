export type Command = readonly [string, ...string[]]
export type Hooks = { prepare?: Command[]; prepareByEnv?: Record<string, Command[]>; build?: Command; buildByPlatform?: Partial<Record<'android' | 'ios', Command>>; environment?: Record<string, string>; environmentByPlatform?: Partial<Record<'android' | 'ios', Record<string, string>>>; afterBuild?: Command[]; afterSync?: Command[]; verify?: Command[] }
export type Flags = Record<string, string | boolean>
/** `prefix` streams each output line with that prefix instead of inheriting stdio (used by concurrent runs). */
export interface Invocation { command: string; args: string[]; cwd: string; env?: NodeJS.ProcessEnv; input?: string; capture?: boolean; label?: string; timeout?: number; signal?: AbortSignal; prefix?: string; /** Start the program in the background and return once it launched; its output and exit status are not observed (used to open terminal windows). */ detached?: boolean; /** Defaults to [0]; only opt into a tool's documented nonzero success convention. */ successExitCodes?: readonly number[]; /** Defaults to true; explicit GUI launches can request a visible window. */ windowsHide?: boolean }
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
  capacitor?: Hooks & { root?: string; packageJson?: string; platforms?: ('android' | 'ios')[]; androidProject?: string; iosProject?: string; assets?: Images & { native?: boolean }; locales?: NativeLocales; live?: { host?: string; port?: number; https?: boolean; ca?: string; timeout?: number }; screenshots?: { output?: string; sizes?: { width: number; height: number }[] }; /** More Gradle modules (for example a Wear OS app) that share the package version. `project` is the module's build.gradle relative to the Capacitor root; `versionCodeOffset` is added to the native build number so each form factor gets its own version code. */ androidModules?: { project: string; versionCodeOffset?: number }[] };
  /** Extra build settings (`NAME=value`) per platform and build kind. iOS: Xcode build settings for `release` and `testflight-only` builds. Android: Gradle project properties (`-PNAME=value`) for `debug` and `release` builds and for custom kinds selected with `android build --kind`. `all` applies to every build of the platform. Signing, version and build-configuration settings are rejected. */
  buildSettings?: { android?: Record<string, string[]>; ios?: Partial<Record<'all' | 'release' | 'testflight-only', string[]>> };
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
  /** `root` is the directory with platformio.ini. `coreDir` becomes PLATFORMIO_CORE_DIR unless the environment already sets it (absolute, or relative to the config root). */
  platformio?: { root?: string; coreDir?: string };
}
/** One long-running process started by `dev start`. `root` is relative to `dev.root`. */
export interface DevProcess { name: string; command: Command; root?: string; environment?: Record<string, string>; /** Only started when named in `--with`. */ optional?: boolean }
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

export interface CloudflareSettings { kind: 'worker' | 'pages'; root?: string; config?: string; directory?: string; projectName?: string; accountId?: string; domains?: string[]; secretsFile?: string; secretNames?: string[]; commitDirty?: boolean; branch?: string; wranglerEnv?: string | false; prepare?: Command[]; /** Pages: the zone that hosts `domains`; `setup-pages` then also keeps a proxied CNAME to the project for each domain. */ zoneId?: string; /** Pages: with `zoneId` and one apex domain, `setup-pages` redirects www to it (proxied CNAME plus a Single Redirect rule). */ wwwRedirect?: boolean; /** Identifier of that redirect rule; defaults to rds_www_redirect. Keep an existing rule's ref to adopt it. */ redirectRef?: string; /** Worker: D1 database name for `migrate-d1`. */ d1Database?: string; /** Worker: a project module (path relative to the config root) whose `secrets` function adds project rules to `push-secrets`; see SecretsModule. */ secretsModule?: string }
export interface CloudflareTarget extends CloudflareSettings { environments?: Record<string, Partial<CloudflareSettings>> }
export interface HostingerSettings { domain?: string; username?: string; directory?: string; envFile?: string; excludeEnv?: string[]; databaseVariable?: string; nodeVersion?: 22 | 24; entryFile?: string; buildScript?: string; cron?: { command: string; schedule: string } }
export interface HostingerTarget extends HostingerSettings { environments?: Record<string, Partial<HostingerSettings>> }
/** What `secretsModule.secrets` receives. `values` is the strictly parsed secrets file (a frozen copy); `file` is its absolute path. */
export interface SecretsInput { environment: string; target: string; file: string; root: string; values: Readonly<Record<string, string>> }
/**
 * Contract of the project module named by `cloudflare.targets.<name>.secretsModule`. It runs after the file was parsed and
 * before anything is uploaded or prepared. Throw to stop the upload (never put a secret value in the message). Return the
 * values to upload: the input plus anything the project derives or overrides. Only names in `secretNames` are sent.
 */
export interface SecretsModule { secrets(input: SecretsInput): Record<string, string> | Promise<Record<string, string>> }
