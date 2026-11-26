/**
 * Bounded, local-only project discovery and Vite launching for the explicit
 * ControlGUI Agent tool. No shell invocation and no package.json scripts.
 * Unknown/non-Vite projects are never executed as arbitrary commands.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:net'
import { configuredPreviewOrigin, discoverDevServer } from './dev-discovery.ts'
import { parseDevUrl, probeDevServer, selectStaticRoot } from './project-preview.ts'
import { searchLocalProjects } from './project-search.ts'
import { inspectHarmonyProject } from './harmony-preview.ts'

export interface ProjectCatalog {
  readonly searchRoots?: readonly string[]
}
export interface OpenRequest {
  readonly name?: string
  readonly project?: string
  readonly dev?: string
}
export interface ReadyProject {
  readonly project: string
  readonly dev?: string
  readonly started: boolean
  readonly source: 'explicit' | 'discovered'
  readonly previewKind?: 'arkui' | 'arkweb'
}
export class ProjectSelectionError extends Error {
  constructor(message: string) { super(message); this.name = 'ProjectSelectionError' }
}

 const catalogDefault = resolve(dirname(fileURLToPath(import.meta.url)), '../projects.local.json')
 function directory(path: string): string | undefined {
  if (!path || !isAbsolute(path) || !existsSync(path)) return undefined
  try {
    const real = realpathSync(path)
    return statSync(real).isDirectory() ? real : undefined
  } catch { return undefined }
}
function getPackage(project: string): Record<string, unknown> | undefined {
  const file = join(project, 'package.json')
  if (!existsSync(file)) return undefined
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown
    return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : undefined
  } catch { return undefined }
}
function availableForPreview(path: string): boolean {
  return !!inspectHarmonyProject(path) || !!getPackage(path) || !!selectStaticRoot(path)
}
export function readProjectCatalog(file = process.env.CONTROLGUI_PROJECTS_FILE || catalogDefault): ProjectCatalog {
  if (!existsSync(file)) return {searchRoots: process.platform === 'win32' ? ['E:\\', 'D:\\'] : [process.cwd()]}
  const value: unknown = JSON.parse(readFileSync(file, 'utf8'))
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ProjectSelectionError('项目配置格式错误')
  const object = value as Record<string, unknown>
  // Project discovery requires no manually registered paths or aliases.
  if (object.searchRoots !== undefined && !Array.isArray(object.searchRoots)) throw new ProjectSelectionError('searchRoots 必须是数组')
  return { searchRoots: Array.isArray(object.searchRoots) && object.searchRoots.length
    ? object.searchRoots.filter((root): root is string => typeof root === 'string' && isAbsolute(root))
    : process.platform === 'win32' ? ['E:\\', 'D:\\'] : [process.cwd()] }
}
/** Resolve a name only from automatically discovered local metadata. Never guess. */
export function resolveProjectByName(name: string, catalog: ProjectCatalog): {project:string;source:'discovered'} {
  const result = searchLocalProjects(name, catalog, 12)
  const [best, runnerUp] = result.matches
  if (!best || best.score < 78) {
    const possibilities = result.matches.slice(0, 4).map(x => x.title + ' (' + x.project + ')').join('；')
    throw new ProjectSelectionError('无法确定“' + name + '”对应的项目。' + (possibilities ? '可能的候选：' + possibilities + '。请指定一个项目。' : '未发现匹配项目，请提供更准确的名称或完整路径。'))
  }
  if ((runnerUp && best.score - runnerUp.score < 24) || (result.truncated && best.score < 90)) {
    const options = result.matches.slice(0, 5).map(x => x.title + ' (' + x.project + ')').join('；')
    throw new ProjectSelectionError('“' + name + '”存在多个可能的项目或搜索不完整，不会自动启动。请确认一个路径：' + options)
  }
  return {project:best.project,source:'discovered'}
}
function viteBinary(project: string): string | undefined {
  const pkg = getPackage(project)
  if (!pkg) return undefined
  const dependencies = { ...(typeof pkg.dependencies === 'object' && pkg.dependencies ? pkg.dependencies : {}),
    ...(typeof pkg.devDependencies === 'object' && pkg.devDependencies ? pkg.devDependencies : {}) }
  if (!Object.hasOwn(dependencies, 'vite')) return undefined
  const binary = join(project, 'node_modules', 'vite', 'bin', 'vite.js')
  return existsSync(binary) ? binary : undefined
}
function listenAvailable(port: number): Promise<boolean> {
  return new Promise(resolvePromise => {
    const server = createServer()
    server.once('error', () => resolvePromise(false))
    server.listen(port, '127.0.0.1', () => server.close(() => resolvePromise(true)))
  })
}
async function pickPort(preferred?: number): Promise<number> {
  if (preferred !== undefined) {
    if (!await listenAvailable(preferred)) throw new ProjectSelectionError('端口 ' + preferred + ' 已被占用，不能安全地启动指定项目')
    return preferred
  }
  for (let port = 5173; port <= 5200; port++) if (await listenAvailable(port)) return port
  throw new ProjectSelectionError('没有可用的本地开发端口（5173–5200）')
}
async function waitForReady(url: string, child: ChildProcess, signal: AbortSignal, getError: () => Error | undefined): Promise<void> {
  const until = Date.now() + 20_000
  while (Date.now() < until) {
    signal.throwIfAborted()
    if (getError()) throw new ProjectSelectionError('Vite 启动失败：' + getError()!.message)
    if (child.exitCode !== null || child.signalCode !== null) throw new ProjectSelectionError('Vite 开发服务器提前退出，可能是依赖或配置错误')
    if (await probeDevServer(url)) return
    await new Promise<void>((done, reject) => {
      const timer = setTimeout(() => { signal.removeEventListener('abort', abort); done() }, 350)
      const abort = () => { clearTimeout(timer); reject(signal.reason ?? new Error('Cancelled')) }
      signal.addEventListener('abort', abort, { once: true })
    })
  }
  throw new ProjectSelectionError('Vite 启动超时（20 秒），请检查项目依赖和配置')
}
export function createProjectLauncher(configFile?: string) {
  const owned = new Map<string, ChildProcess>()
  return {
    async prepare(request: OpenRequest, signal: AbortSignal): Promise<ReadyProject> {
      signal.throwIfAborted()
      const explicit = request.project?.trim()
      const requestedName = request.name?.trim()
      if (!explicit && !requestedName) throw new ProjectSelectionError('没有指定项目')
      let project: string
      let source: ReadyProject['source'] = 'explicit'
      if (explicit) {
        const chosen = directory(explicit)
        if (!chosen) throw new ProjectSelectionError('项目路径不存在或不是文件夹：' + explicit)
        project = chosen
      } else {
        const matched = resolveProjectByName(requestedName!, readProjectCatalog(configFile))
        project = matched.project
        source = matched.source
      }
      if (!availableForPreview(project)) throw new ProjectSelectionError('项目没有可识别的 Web 或 HarmonyOS Stage 入口：' + project)
      const harmony = inspectHarmonyProject(project)
      if (harmony?.kind === 'arkui' && !request.dev?.trim()) {
        return { project, started: false, source, previewKind: 'arkui' }
      }
      if (harmony?.kind === 'arkweb' && !request.dev?.trim()) {
        return { project, started: false, source, previewKind: 'arkweb' }
      }
      const configured = !request.dev?.trim() && !harmony ? configuredPreviewOrigin(project) : undefined
      if (configured && !await probeDevServer(configured)) throw new ProjectSelectionError('项目配置的 Web 服务尚未启动：' + configured + '，请先启动项目服务。')
      const selectedDev = request.dev?.trim() || configured
      if (selectedDev) {
        const parsed = parseDevUrl(selectedDev)
        if (!parsed) throw new ProjectSelectionError('开发服务器地址格式错误')
        if (await probeDevServer(parsed.href)) return { project, dev: parsed.href, started: false, source }
      } else {
        const running = await discoverDevServer(project)
        if (running && await probeDevServer(running)) return { project, dev: running, started: false, source }
      }
      const binary = viteBinary(project)
      if (!binary) {
        if (harmony?.webRoot || selectStaticRoot(project)) return { project, started: false, source }
        throw new ProjectSelectionError('找到项目，但它不是已安装依赖的 Vite 项目，也没有可预览的静态文件。请先配置启动方式：' + project)
      }
      const devPort = selectedDev ? Number(parseDevUrl(selectedDev)!.port) : await pickPort()
      if (selectedDev && !await listenAvailable(devPort)) throw new ProjectSelectionError('指定端口已被其他程序占用：' + devPort)
      const url = 'http://127.0.0.1:' + devPort + '/'
      const processChild = spawn(process.execPath, [binary, '--host', '127.0.0.1', '--port', String(devPort), '--strictPort'], {
        cwd: project, env: { ...process.env, NO_COLOR: '1' }, stdio: 'ignore', windowsHide: true,
      })
      let spawnError: Error | undefined
      processChild.once('error', error => { spawnError = error })
      owned.set(project, processChild)
      try {
        await waitForReady(url, processChild, signal, () => spawnError)
        return { project, dev: url, started: true, source }
      } catch (error) {
        processChild.kill()
        owned.delete(project)
        throw error
      }
    },
    dispose(): void {
      for (const child of owned.values()) if (child.exitCode === null) child.kill()
      owned.clear()
    },
  }
}
