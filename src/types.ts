export type Command = readonly [string, ...string[]]
export type Hooks = { prepare?: Command[]; prepareByEnv?: Record<string, Command[]>; build?: Command; buildByPlatform?: Partial<Record<'android' | 'ios', Command>>; environment?: Record<string, string>; environmentByPlatform?: Partial<Record<'android' | 'ios', Record<string, string>>>; afterBuild?: Command[]; afterSync?: Command[]; verify?: Command[] }
export type Flags = Record<string, string | boolean>
export interface Invocation { command: string; args: string[]; cwd: string; env?: NodeJS.ProcessEnv; input?: string; capture?: boolean; label?: string; timeout?: number; signal?: AbortSignal }
export interface Result { stdout: string; stderr: string }
export type Runner = (invocation: Invocation) => Promise<Result>
export interface Images { source: string; background?: string; outputs?: { path: string; width: number; height?: number }[] }
export interface NativeLocales { locales: Record<string, Record<string, string>>; defaultLocale: string; targets: { format: 'android' | 'apple'; directory: string; keys?: Record<string, string> }[] }
export interface Config {
  version: 1;
  output?: { banners?: boolean };
  production?: { environments?: string[]; verify?: Command[] };
  vue?: { root?: string; typecheck?: 'build' | 'noEmit' | false; modes?: Record<string, string> };
  capacitor?: Hooks & { root?: string; packageJson?: string; platforms?: ('android' | 'ios')[]; androidProject?: string; iosProject?: string; assets?: Images & { native?: boolean }; locales?: NativeLocales; live?: { host?: string; port?: number; https?: boolean; ca?: string; timeout?: number }; screenshots?: { output?: string; sizes?: { width: number; height: number }[] } };
  android?: { root?: string; appId?: string; module?: string; apk?: string; aab?: string; mapping?: string; javaHome?: string; sdkRoot?: string };
  store?: { root?: string; locales?: (string | { app: string; android: string; ios: string })[]; appLocales?: string[]; defaultLocale?: string; defaultLocales?: { android: string; ios: string }; iosDevices?: { iphone: boolean; ipad: boolean; watch: boolean }; androidId?: string; iosId?: string; appleKey?: string; playKey?: string; allowExternalCredentials?: boolean; iosProject?: string; iosScheme?: string; hooks?: { beforeUpload?: Command[] }; versionPackage?: string };
  electron?: { root?: string; url?: string; start?: Command; assets?: Images & { ico?: string; icns?: string; windowsCornerRadius?: number }; output?: string; builderConfig?: string; notaryProfile?: string; prepare?: Command[] };
  swift?: { root?: string; executable?: string; plist?: string; resources?: string; entitlements?: string; output?: string; identity?: string; icon?: string; iconOutput?: string };
  vscode?: { root?: string; prepare?: Command[]; noDependencies?: boolean; output?: string };
  cloudflare?: { targets: Record<string, { kind: 'worker' | 'pages'; root?: string; config?: string; directory?: string; projectName?: string; secretsFile?: string; secretNames?: string[]; prepare?: Command[] }> };
  browser?: { root?: string; directory: string; output: string; prepare?: Command[] };
}
