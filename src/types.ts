export type Command = readonly [string, ...string[]]
export type Hooks = { prepare?: Command[]; prepareByEnv?: Record<string, Command[]>; build?: Command; buildByPlatform?: Partial<Record<'android' | 'ios', Command>>; environment?: Record<string, string>; environmentByPlatform?: Partial<Record<'android' | 'ios', Record<string, string>>>; afterBuild?: Command[]; afterSync?: Command[]; verify?: Command[] }
export type Flags = Record<string, string | boolean>
/** `prefix` streams each output line with that prefix instead of inheriting stdio (used by concurrent runs). */
export interface Invocation { command: string; args: string[]; cwd: string; env?: NodeJS.ProcessEnv; input?: string; capture?: boolean; label?: string; timeout?: number; signal?: AbortSignal; prefix?: string; /** Start the program in the background and return once it launched; its output and exit status are not observed (used to open terminal windows). */ detached?: boolean; /** Defaults to [0]; only opt into a tool's documented nonzero success convention. */ successExitCodes?: readonly number[]; /** Defaults to true; explicit GUI launches can request a visible window. */ windowsHide?: boolean }
export interface Result { stdout: string; stderr: string }
export type Runner = (invocation: Invocation) => Promise<Result>
export interface AssetCopy { source: string; path: string; normalize?: 'png' }
export interface Images { source?: string; background?: string; outputs?: { path: string; width: number; height?: number }[]; copies?: AssetCopy[] }
export interface NativeLocales { locales: Record<string, Record<string, string>>; defaultLocale: string; targets: NativeLocaleTarget[] }
export type NativeLocaleTarget = { directory: string; keys?: Record<string, string> } & ({ format: 'android'; file?: 'strings.xml' } | { format: 'apple'; file?: 'Localizable.strings' | 'InfoPlist.strings' })
/** One Xcode target whose localized resources `check-locales` verifies and `register-locales` maintains. */
export interface LocaleRegistrationTarget {
  /** Xcode target name, for example App or a widget extension. */
  name: string
  /** Directory with the `<locale>.lproj` folders, relative to the Capacitor root. Default `<project directory>/<name>`. */
  directory?: string
  /** Localized resources that belong to this target, for example InfoPlist.strings and Localizable.strings. */
  files: string[]
  /** Info.plist whose CFBundleLocalizations must list the locales: `true` for `<directory>/Info.plist`, a path, or `false`. Default true for the target named App. */
  infoPlist?: boolean | string
  /** Languages CFBundleLocalizations lists when the app has more than its string files, for example from a web UI. Must include every iOS locale; needs this target's Info.plist. Default: the iOS locales. */
  bundleLocalizations?: string[]
}
/** Native declarations of the app's languages. Paths are relative to the Capacitor root and default to the standard Capacitor layout. */
export interface LocaleRegistration {
  /** Locale codes, as used for `<code>.lproj`. Default: the keys of `capacitor.locales.locales`. */
  locales?: string[]
  android?: { manifest?: string; localeConfig?: string; locales?: string[] }
  ios?: { project?: string; locales?: string[]; targets: LocaleRegistrationTarget[] }
}
/** Explicit identities for `app-links generate|check`. Files go to `<directory>/.well-known`, relative to the config root. */
export interface AppLinks {
  directory: string
  android?: { packageName: string; fingerprints: string[] }[]
  apple?: { teamId: string; bundleId: string; paths: string[] }[]
}
export interface Config {
  version: 1;
  /** Environment used by cloudflare, hostinger, hosting, env and prisma commands when --env is omitted (single-environment projects). */
  defaultEnvironment?: string;
  output?: { banners?: boolean };
  production?: { environments?: string[]; verify?: Command[] };
  vue?: { root?: string; typecheck?: 'build' | 'noEmit' | false; modes?: Record<string, string> };
  capacitor?: Hooks & { root?: string; /** Config-root-relative version source. With --bump it must be the owning package.json. */ packageJson?: string; platforms?: ('android' | 'ios')[]; androidProject?: string; iosProject?: string; assets?: Images & { native?: boolean }; locales?: NativeLocales; localeRegistration?: LocaleRegistration; live?: { host?: string; port?: number; https?: boolean; ca?: string; timeout?: number }; screenshots?: { output?: string; sizes?: { width: number; height: number }[] }; /** More Gradle modules (for example a Wear OS app) that share the package version. `project` is the module's build.gradle relative to the Capacitor root; `versionCodeOffset` is added to the native build number so each form factor gets its own version code. */ androidModules?: { project: string; versionCodeOffset?: number }[] };
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
  appLinks?: AppLinks;
  dev?: { root?: string; processes: DevProcess[] };
  wait?: { targets: Record<string, WaitTarget> };
  env?: { directory?: string; module: string; environments?: string[]; autoCreate?: string[]; hints?: { template?: string; generate?: string } };
  prisma?: { root?: string; envFile: string; variable?: string };
  /** `root` is the directory with platformio.ini. `coreDir` becomes PLATFORMIO_CORE_DIR unless the environment already sets it (absolute, or relative to the config root). */
  platformio?: { root?: string; coreDir?: string };
  media?: MediaConfig;
}
export type MediaPlatform = 'android' | 'ios' | 'mac' | 'windows'
/** One captured app scene. The project's capture module decides how the page reaches it. */
export interface MediaScene { id: string; viewport: { width: number; height: number }; deviceScaleFactor?: number; colorScheme?: 'light' | 'dark'; /** Keep the page background transparent in the PNG. */ transparent?: boolean }
/** A store image rds has no built-in definition for (a site link preview, a promo banner, another store). */
export interface MediaCustomAsset { id: string; platform: string; label?: string; width: number; height: number; format?: 'png' | 'jpeg'; alpha?: 'forbid' | 'keep'; maxBytes?: number; /** Minimum and maximum number of images in the set (default 1 and 1). */ min?: number; max?: number; required?: boolean; localized?: boolean; source?: 'design' | 'capture'; /** Folder below the export root; `{locale}` is the app language code. Default `artwork/<platform>/{locale}`. */ directory?: string; /** File name without extension; sets get a two-digit number appended. Default the id's last segment. */ name?: string }
/**
 * Store media: empty base designs, a live viewer with store mocks, and the commands that render every final image from them.
 * Everything lives below `root`: `base/` (designs), `shared/` (kit, fonts), `copy/<lang>.json` (words), `captures/<lang>/` (app screens), `review/` (contact sheets).
 */
export interface MediaConfig {
  root?: string
  /** Which store catalogs apply. Default android and ios. */
  platforms?: MediaPlatform[]
  /** Only these asset ids (default: every asset of the selected platforms, plus custom ones), and ids to leave out. */
  assets?: string[]; exclude?: string[]
  /** Languages: app code, or { app, android, ios } store folder names. Default `store.locales`. */
  locales?: (string | { app: string; android: string; ios: string })[]
  /** App code of the default language: the only one that must have every image, and the fallback for copy and captures. Default the first locale. */
  defaultLocale?: string
  /** Asset id -> design path below `root`: an `.html` page rendered by a browser, or a `.png`/`.svg`/`.jpg`/`.webp` master resized by sharp. Default `base/<id>.html`. */
  designs?: Record<string, string>
  /** Asset id -> one of the sizes the store accepts for it, when not the catalog's default. */
  sizes?: Record<string, [number, number]>
  /** Asset id -> scene ids, for assets built straight from captures (Microsoft Store screenshots, or any asset whose source is capture). */
  scenes?: Record<string, string[]>
  /** Asset id -> where its images come from (`capture` = copied from captures with no artwork). Must be one the catalog allows. */
  sources?: Record<string, 'design' | 'capture'>
  custom?: MediaCustomAsset[]
  /** Colour that replaces transparency where a store forbids it. Default #ffffff. */
  background?: string
  /** Fixed browser clock (ISO date) so dates and times in designs render the same every time. */
  clock?: string
  /** Block every request that is not to the local media server (deterministic renders, no web fonts from the network). */
  offline?: boolean
  /** Designs rendered at the same time. Default 2. */
  jobs?: number
  /** Extra project directories the media server may serve, besides `root` (for example the app's own artwork). Relative to the config root. */
  serve?: string[]
  /** Hook-driven capture of real app screens, see MediaCaptureModule. */
  capture?: { module: string; baseUrl: string; scenes: MediaScene[]; /** Allow a non-local baseUrl. */ allowRemote?: boolean }
  viewer?: { port?: number }
  hooks?: { beforeRender?: Command[]; afterRender?: Command[] }
}
/** Contract of `media.capture.module`: project code that prepares and drives the page for each scene and language. */
export interface MediaCaptureModule {
  /** Optional: runs once per language before any page opens (route mocks, storage, init scripts). */
  prepare?(input: { context: unknown; locale: string; baseUrl: string }): void | Promise<void>
  /** Opens the scene in `page` and returns when it is ready to be photographed. */
  scene(input: { page: unknown; scene: MediaScene; locale: string; baseUrl: string }): void | Promise<void>
}
/** One long-running process started by `dev start`. `root` is relative to `dev.root`. */
export interface DevProcess { name: string; command: Command; root?: string; environment?: Record<string, string>; /** Only started when named in `--with`. */ optional?: boolean }
/** HTTP takes a `url` or a URL read from `variable` (process environment, then `envFile`); TCP also accepts `host`/`port`. */
export interface WaitTarget { host?: string; port?: number; url?: string; variable?: string; envFile?: string; timeout?: number; hint?: string; /** HTTP only; exact status, default 200. */ status?: number; /** HTTP only; exact response-header match, e.g. an expected release ID. */ marker?: { header: string; value: string } }
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
