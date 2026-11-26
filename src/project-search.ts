/**
 * Read-only, bounded local discovery for ControlGUI.
 * The Agent can ask for candidates before the terminal preview tool.
 * Nothing here executes commands or imports project code.
 */
import { existsSync, readFileSync, realpathSync, readdirSync, statSync } from 'node:fs'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { ProjectCatalog } from './project-launcher.ts'
import { inspectHarmonyProject } from './harmony-preview.ts'

export interface ProjectHit {
  readonly project: string
  readonly title: string
  readonly framework: string
  readonly reason: string
  readonly score: number
  readonly startup: 'vite' | 'static' | 'manual' | 'harmony'
}
type Indexed = ProjectHit & { readonly terms: readonly string[] }

const ignore = new Set([
  'node_modules', '.git', '.svn', '.hg', '.pnpm-store', '.pnpm-cache', '.pnpm-state',
  'dist', 'build', '.next', '.nuxt', '.cache', '.vscode', '.idea', '.tox', '.venv',
  'venv', '__pycache__', 'vendor', 'target', 'coverage', 'tmp', 'temp', 'AppData',
  '.agentdock', '.codex', '.pytest_cache', 'site-packages', 'program files',
  'windows', 'system volume information', '$recycle.bin',
])
const norm = (s: string): string => s.toLocaleLowerCase().replace(/[\s_\-.'"\u2013\u2014·,，。!?！？()（）:/\\]+/gu, '')
const stripIntent = (s: string): string => norm(s
  .replace(/(请|帮我|给我|我想|我之前|我曾经|之前写的|以前写的|曾经写的|刚才那个|那个|这个|本地|电脑上|打开|启动|运行|预览|找到|寻找|查找|项目|工程|系统|网页|网站|一下|看看)/gu, ''))
const safeDir = (s: string): string | undefined => {
  if (!isAbsolute(s) || !existsSync(s)) return undefined
  try { const path = realpathSync(s); return statSync(path).isDirectory() ? path : undefined } catch { return undefined }
}
const within = (root: string, file: string): boolean => {
  const r = relative(root, file)
  return r === '' || (r !== '..' && !r.startsWith('..' + sep) && !isAbsolute(r))
}
function readJson(file: string): Record<string, unknown> | undefined {
  if (!existsSync(file)) return undefined
  try {
    if (statSync(file).size > 256_000) return undefined
    const obj: unknown = JSON.parse(readFileSync(file, 'utf8'))
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj as Record<string, unknown> : undefined
  } catch { return undefined }
}
function readHeadings(dir: string): string[] {
  for (const name of ['README.md','readme.md','README.MD','README.txt','readme.txt']) {
    const file = join(dir, name)
    try {
      if (!existsSync(file) || statSync(file).size > 256_000) continue
      const text = readFileSync(file, 'utf8').slice(0, 12_000)
      const headers = [...text.matchAll(/^#{1,2}\s+(.+)$/gmu)].slice(0, 4).map(x => x[1]!.trim().slice(0, 100))
      if (headers.length) return headers
    } catch { /* unreadable project metadata is not fatal */ }
  }
  return []
}
function getProjectInfo(path: string): Omit<Indexed,'score'|'reason'> | undefined {
  const pkg = readJson(join(path, 'package.json'))
  const python = existsSync(join(path, 'pyproject.toml')) || existsSync(join(path, 'requirements.txt'))
  const staticHtml = existsSync(join(path,'index.html'))
  const flask = python && (existsSync(join(path, 'app.py')) || existsSync(join(path, 'main.py')))
  const vite = pkg && ((typeof pkg.dependencies === 'object' && pkg.dependencies !== null && 'vite' in pkg.dependencies) ||
    (typeof pkg.devDependencies === 'object' && pkg.devDependencies !== null && 'vite' in pkg.devDependencies))
  const vue = pkg && ((typeof pkg.dependencies === 'object' && pkg.dependencies !== null && 'vue' in pkg.dependencies) ||
    (typeof pkg.devDependencies === 'object' && pkg.devDependencies !== null && 'vue' in pkg.devDependencies))
  const react = pkg && ((typeof pkg.dependencies === 'object' && pkg.dependencies !== null && 'react' in pkg.dependencies) ||
    (typeof pkg.devDependencies === 'object' && pkg.devDependencies !== null && 'react' in pkg.devDependencies))
  const harmony = (existsSync(join(path,'build-profile.json5')) || existsSync(join(path,'src','main','module.json5')))
    ? inspectHarmonyProject(path) : undefined
  if (!pkg && !python && !staticHtml && !harmony) return undefined
  const name = typeof pkg?.name === 'string' ? pkg.name.slice(0, 120) : ''
  const description = typeof pkg?.description === 'string' ? pkg.description.slice(0, 180) : ''
  const headings = readHeadings(path)
  const title = headings[0] || name || basename(path)
  const framework = harmony ? (harmony.kind === 'arkweb' ? 'HarmonyOS ArkWeb/H5' : 'HarmonyOS ArkUI/ArkTS')
    : vite ? (vue ? 'Vue/Vite' : react ? 'React/Vite' : 'Vite frontend')
    : flask ? 'Python/Flask-like' : python ? 'Python' : staticHtml ? 'Static HTML' : 'Node/other'
  const startup = harmony ? 'harmony' : vite && existsSync(join(path,'node_modules','vite','bin','vite.js'))
    ? 'vite' : staticHtml ? 'static' : 'manual'
  return { project:path, title, framework, startup,
    terms: [basename(path), name, description, ...headings].filter(Boolean) }
}
function tokenize(q: string): string[] {
  const normalized = q.toLocaleLowerCase().replace(/(请|帮我|给我|我想|我之前|我曾经|之前写的|以前写的|曾经写的|刚才那个|那个|这个|本地|电脑上|打开|启动|运行|预览|找到|寻找|查找|项目|工程|系统|网页|网站|一下|看看)/gu, ' ')
  const words = normalized.match(/[\p{Script=Han}]{2,}|[a-z0-9]{2,}/gu) ?? []
  return [...new Set(words.flatMap(w => {
    const xs = [norm(w)]
    if (/^[\p{Script=Han}]+$/u.test(w) && w.length > 3) {
      for (let i = 0; i < w.length - 1; i++) xs.push(w.slice(i,i+2))
    }
    return xs
  }))].filter(x => x.length >= 2)
}
function scoreCandidate(query: string, hit: Indexed): number {
  const q = norm(query)
  const intent = stripIntent(query)
  const directoryName = norm(basename(hit.project))
  const labels = hit.terms.map(norm)
  if (labels.some(x => x === q || (intent.length >= 2 && x === intent))) return 100
  let score = 0
  const meaningful = intent.length >= 2 ? intent : q
  for (const label of labels) {
    if (meaningful.length >= 3 && label.includes(meaningful)) score = Math.max(score, label === directoryName ? 88 : 82)
    else if (label.length >= 6 && meaningful.includes(label) && !['source','sourcecode','package','frontend','backend','website','codex','project'].includes(label)) score = Math.max(score, 72)
  }
  const terms = tokenize(query)
  if (terms.length) {
    let covered = 0
    const all = labels.join(' ')
    for (const word of terms) if (all.includes(word)) covered++
    const fraction = covered / terms.length
    if (fraction >= .25) score = Math.max(score, Math.round(22 + 43 * fraction))
  }
  if (norm(query).includes('vue') && hit.framework.toLowerCase().includes('vue')) score = Math.max(score, 43)
  if (norm(query).includes('react') && hit.framework.toLowerCase().includes('vite')) score = Math.max(score, 28)
  if (/(?:鸿蒙|harmonyos|arkts|arkui|arkweb)/iu.test(query) && hit.framework.includes('HarmonyOS')) score = Math.max(score, 44)
  return score
}
export interface SearchResult { readonly query: string; readonly matches: readonly ProjectHit[]; readonly scanned: number; readonly truncated: boolean; readonly note: string }
export function searchLocalProjects(query: string, catalog: ProjectCatalog, maxResults = 8): SearchResult {
  if (typeof query !== 'string' || query.length < 2 || query.length > 160) throw new Error('项目查询长度应为 2–160 字符')
  const indexed = new Map<string, Indexed>()
  let examined = 0
  let truncated = false
  const add = (dir: string): void => {
    const path = safeDir(dir)
    if (!path) return
    const info = getProjectInfo(path)
    if (!info) return
    const key = path.toLowerCase()
    indexed.set(key, { ...info, score:0, reason:'' })
  }
  for (const entry of (catalog.searchRoots ?? []).slice(0, 8)) {
    if (typeof entry !== 'string') continue
    const root = safeDir(entry)
    if (!root) continue
    const pending: Array<{path:string,level:number}> = [{path:root,level:0}]
    let inspectedInRoot = 0
    let rootTruncated = false
    while (pending.length) {
      examined++
      inspectedInRoot++
      if (inspectedInRoot > 3400 || examined > 8000 || indexed.size > 1600) { rootTruncated = true; break }
      const {path,level} = pending.shift()!
      add(path)
      if (level >= 5) continue
      let children
      try {children = readdirSync(path,{withFileTypes:true})} catch {continue}
      for (const child of children) {
        if (!child.isDirectory() || child.isSymbolicLink() || child.name.startsWith('.')
           || ignore.has(child.name.toLowerCase())) continue
        if (pending.length > 6500) {rootTruncated=true;break}
        const childPath = resolve(path,child.name)
        if (within(root,childPath)) pending.push({path:childPath,level:level+1})
      }
      if (rootTruncated) break
    }
    if (rootTruncated) truncated = true
    if (examined > 8000 || indexed.size > 1600) break
  }
  const all = [...indexed.values()]
    .map(x => ({...x, score:scoreCandidate(query,x),reason:'根据本地项目名称、描述和技术栈自动发现'}))
    .filter(x => x.score >= 25)
    .sort((a,b)=>b.score-a.score || a.project.localeCompare(b.project))
  const matches=all.slice(0,Math.min(Math.max(maxResults,1),12)).map(({terms:_,...hit})=>hit)
  return {query,matches,scanned:examined,truncated,
    note:matches.length===0?'未找到明确候选；可提供路径或扩大受控搜索目录。'
      :all.length>1 && (all[0]!.score - all[1]!.score < 18 || /^(vue|react|python|前端|后端|网站|网页|项目)$/iu.test(stripIntent(query)))
        ?'存在相近候选，不要猜测。请将候选路径展示给用户确认后再启动。'
        :'请核实最匹配候选的名称/目录，确信是用户要的项目后，使用 open_codex_gui_preview(project=绝对路径)；无法确定时先询问。'}
}
