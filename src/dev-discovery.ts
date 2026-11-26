/** Find a running local frontend for an explicit workspace, without starting processes or guessing unrelated ports. */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { platform } from 'node:os'

const exec = promisify(execFile)
export type ListeningProcess = { port: number; commandLine: string }
const DEV_COMMAND = /(?:vite|next(?:\\|\/|\.cmd|\.js|\s)|webpack|react-scripts|astro|nuxt|angular|ng\s+serve|vue-cli-service|parcel|svelte-kit)/i
/** Require an absolute project path in the process command line, never just its basename. */
export function matchingPorts(project: string, rows: readonly ListeningProcess[]): number[] {
  const normalized = resolve(project).toLowerCase().replaceAll('/', '\\').replace(/\\+$/u,'')
  const ports = new Set<number>()
  for (const row of rows) {
    if (!Number.isInteger(row.port) || row.port < 1024 || row.port > 65535) continue
    const command = row.commandLine.toLowerCase().replaceAll('/', '\\')
    const at = command.indexOf(normalized)
    if (at === -1) continue
    const before = at === 0 ? '' : command[at - 1]
    const after = command[at + normalized.length] ?? ''
    if (before && !/[\s"'=]/u.test(before)) continue
    if (after && !/[\s"'\\]/u.test(after)) continue
    if (!DEV_COMMAND.test(command)) continue
    ports.add(row.port)
  }
  return [...ports].sort((a,b) => a-b)
}
/** Extract a framework's explicit --port option (from the actual project process). */
export function parseDevPort(commandLine: string): number | undefined {
  const match = /(?:^|\s)(?:--port(?:=|\s+)|-p\s+)(\d{2,5})(?=\s|$)/iu.exec(commandLine)
  const port = Number(match?.[1])
  return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : undefined
}
const WINDOWS_SCRIPT = `
$ErrorActionPreference='SilentlyContinue'
$commands = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ForEach-Object { [string]$_.CommandLine } | Where-Object { $_ })
ConvertTo-Json -InputObject $commands -Compress
`
/** PowerShell introspection avoids scanning unrelated ports and needs no admin privileges. */
export async function windowsDevProcesses(): Promise<string[]> {
  const encoded = Buffer.from(WINDOWS_SCRIPT,'utf16le').toString('base64')
  try {
    const {stdout} = await exec('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',encoded],{
      windowsHide:true, timeout:5500, maxBuffer:512 * 1024,
    })
    const raw:unknown = JSON.parse(stdout.trim() || '[]')
    const commands = Array.isArray(raw) ? raw : raw ? [raw] : []
    return commands.filter((item):item is string=>typeof item==='string')
  } catch { return [] }
}
export function proposedPorts(project:string, commands:readonly string[]): number[] {
  const known:ListeningProcess[] = []
  const matched = commands.filter(command => matchingPorts(project,[{port:5173,commandLine:command}]).length > 0)
  for (const commandLine of matched) {
    const explicit = parseDevPort(commandLine)
    if (explicit !== undefined) known.push({port:explicit,commandLine})
  }
  if (known.length > 0) return matchingPorts(project,known)
  // Default ports are safe only when a SINGLE development server process exists.
  // Two projects may run side by side; never guess which project owns port 5173.
  const dev = commands.filter(command => DEV_COMMAND.test(command))
  if (dev.length !== 1 || matched.length !== 1) return []
  const command = matched[0]!
  const port = /vite|react-scripts|svelte-kit/i.test(command) ? 5173
    : /next|webpack/i.test(command) ? 3000
    : /astro/i.test(command) ? 4321
    : /angular|ng\s+serve/i.test(command) ? 4200
    : /vue-cli-service/i.test(command) ? 8080
    : /parcel/i.test(command) ? 1234 : undefined
  return port === undefined ? [] : [port]
}
async function isHtmlDevServer(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`, {signal:AbortSignal.timeout(1600),redirect:'manual'})
    if (response.status !== 200 || !String(response.headers.get('content-type')).toLowerCase().includes('text/html')) {
      await response.body?.cancel();return false
    }
    // Use a bounded read; never follow redirects or run third-party JS.
    const reader = response.body?.getReader()
    if (!reader) return false
    const {value} = await reader.read()
    await reader.cancel()
    const html = new TextDecoder().decode(value?.subarray(0,8192) ?? new Uint8Array())
    return /<html|<!doctype html/i.test(html) && !/apple-mobile-web-app-title[\s\S]{0,500}content="DSH"/i.test(html)
  } catch { return false }
}
/**
 * Explicit project-owned preview origin for non-Node web applications.
 * Only a loopback HTTP origin is accepted. Never silently fall back to a
 * broken static snapshot if the declared application server is unavailable.
 */
export function configuredPreviewOrigin(project: string): string | undefined {
  const file = resolve(project, 'controlgui.preview.json')
  if (!existsSync(file)) return undefined
  const raw: unknown = JSON.parse(readFileSync(file, 'utf8'))
  if (!raw || typeof raw !== 'object' || !('dev' in raw) || typeof raw.dev !== 'string')
    throw new Error('controlgui.preview.json 缺少有效的 dev 地址')
  const url = new URL(raw.dev)
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname) ||
      !url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new Error('controlgui.preview.json 只允许本地 HTTP 服务地址（主机和端口）')
  return 'http://127.0.0.1:' + url.port + '/'
}
export async function discoverDevServer(project: string, options: {
  rows?: readonly ListeningProcess[]; probe?: (port:number)=>Promise<boolean>
} = {}): Promise<string | undefined> {
  if (platform() !== 'win32' && options.rows === undefined) return undefined
  const ports = options.rows === undefined ? proposedPorts(project,await windowsDevProcesses()) : matchingPorts(project,options.rows)
  const probe = options.probe ?? isHtmlDevServer
  const found: number[] = []
  for (const port of ports.slice(0,12)) {
    if (await probe(port)) found.push(port)
    if (found.length > 1) return undefined // Multiple matches: require an explicit URL.
  }
  return found.length === 1 ? `http://127.0.0.1:${found[0]}/` : undefined
}
