import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { requireValue } from './runtime.js'
import type { Command } from './types.js'

/** One terminal tab: a title, a working directory, an argv command and its extra environment variables. */
export interface Tab { title: string; cwd: string; command: Command; environment: NodeJS.ProcessEnv }
/** A program that opens terminal windows. `detached` launchers are started in the background and not waited for. */
export interface TabLaunch { command: string; args: string[]; detached: boolean; label: string }
export interface TabHost { platform: NodeJS.Platform; env: NodeJS.ProcessEnv; exists(path: string): boolean; onPath(command: string): boolean }

const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`
const variable = /^[A-Za-z_]\w*$/u

/**
 * The shell line a tab runs: enter the directory, run the argv with its variables, then keep the shell open so output stays readable.
 * Arguments are always quoted individually. No `;` is used because Windows Terminal reads it as a command separator.
 */
export function unixTabCommand(tab: Tab): string {
  const assignments = Object.entries(tab.environment).filter((entry): entry is [string, string] => entry[1] !== undefined).map(([name, value]) => {
    requireValue(variable.test(name), 'Environment variable names must be identifiers')
    return `${name}=${quote(value)}`
  })
  return `cd ${quote(tab.cwd)} && ${[...assignments, ...tab.command.map(quote)].join(' ')} || true && exec bash`
}

function powershellTabCommand(tab: Tab): string {
  const text = (value: string) => `'${value.replaceAll("'", "''")}'`
  const assignments = Object.entries(tab.environment).filter((entry): entry is [string, string] => entry[1] !== undefined).map(([name, value]) => {
    requireValue(variable.test(name), 'Environment variable names must be identifiers')
    return `$env:${name}=${text(value)}`
  })
  return `Set-Location -LiteralPath ${text(tab.cwd)}${assignments.map(assignment => ` ; ${assignment}`).join('')} ; & ${tab.command.map(text).join(' ')}`
}

/** `C:\Work\app` becomes `/c/Work/app` for Git Bash. */
export function gitBashPath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^([A-Za-z]):/u, (_, drive: string) => `/${drive.toLowerCase()}`)
}

function windowsGitBash(host: TabHost): string | undefined {
  const { env } = host
  return [`${env.ProgramFiles ?? 'C:\\Program Files'}\\Git\\bin\\bash.exe`, `${env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'}\\Git\\bin\\bash.exe`, `${env.LocalAppData ?? ''}\\Programs\\Git\\bin\\bash.exe`].find(path => path && host.exists(path))
}

function appleScriptString(value: string): string { return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"` }

/** The launcher programs that open the given tabs on the host's terminal. Pure: nothing is started here. */
export function tabLaunches(tabs: Tab[], host: TabHost): TabLaunch[] {
  requireValue(tabs.length > 0, 'There is nothing to open')
  if (host.platform === 'win32') {
    requireValue(host.onPath('wt'), 'Windows Terminal (wt) was not found on PATH; install it or use rds dev start')
    const bash = windowsGitBash(host)
    const args = ['-w', 'new']
    tabs.forEach((tab, index) => {
      if (index > 0) args.push(';')
      args.push('new-tab', '--title', tab.title, ...(bash
        ? [bash, '-lc', unixTabCommand({ ...tab, cwd: gitBashPath(tab.cwd) })]
        : ['powershell.exe', '-NoExit', '-Command', powershellTabCommand(tab)]))
    })
    return [{ command: 'wt', args, detached: true, label: 'Open Windows Terminal tabs' }]
  }
  if (host.platform === 'darwin') {
    const lines = ['tell application "Terminal"', 'activate', `do script ${appleScriptString(unixTabCommand(tabs[0]!))}`]
    for (const tab of tabs.slice(1)) lines.push('tell application "System Events" to keystroke "t" using command down', `do script ${appleScriptString(unixTabCommand(tab))} in selected tab of the front window`, `set custom title of selected tab of the front window to ${appleScriptString(tab.title)}`)
    lines.push(`set custom title of selected tab of the front window to ${appleScriptString(tabs.at(-1)!.title)}`, 'end tell')
    return [{ command: 'osascript', args: ['-e', lines.join('\n')], detached: false, label: 'Open Terminal tabs' }]
  }
  const shell = (tab: Tab) => ['bash', '-lc', unixTabCommand(tab)]
  if (host.onPath('gnome-terminal')) return [{ command: 'gnome-terminal', args: tabs.flatMap(tab => ['--tab', '--title', tab.title, '--', ...shell(tab)]), detached: true, label: 'Open GNOME Terminal tabs' }]
  if (host.onPath('konsole')) return [{ command: 'konsole', args: tabs.flatMap(tab => ['--new-tab', '-p', `tabtitle=${tab.title}`, '-e', ...shell(tab)]), detached: true, label: 'Open Konsole tabs' }]
  // Without a tabbed terminal each process gets its own window.
  if (host.onPath('xfce4-terminal')) return [{ command: 'xfce4-terminal', args: tabs.flatMap(tab => ['--tab', '--title', tab.title, '--command', `bash -lc ${quote(unixTabCommand(tab))}`]), detached: true, label: 'Open Xfce Terminal tabs' }]
  if (host.onPath('x-terminal-emulator')) return tabs.map(tab => ({ command: 'x-terminal-emulator', args: ['-e', ...shell(tab)], detached: true, label: `Open terminal window ${tab.title}` }))
  if (host.onPath('xterm')) return tabs.map(tab => ({ command: 'xterm', args: ['-T', tab.title, '-e', ...shell(tab)], detached: true, label: `Open terminal window ${tab.title}` }))
  throw new Error('No supported terminal was found (gnome-terminal, konsole, xfce4-terminal, x-terminal-emulator or xterm); use rds dev start')
}

export function realTabHost(): TabHost {
  const lookup = process.platform === 'win32' ? 'where' : 'which'
  return { platform: process.platform, env: process.env, exists: existsSync, onPath: command => spawnSync(lookup, [command], { stdio: 'ignore' }).status === 0 }
}
