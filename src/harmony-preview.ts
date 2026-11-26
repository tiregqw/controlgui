/**
 * Read-only HarmonyOS project inspection and ArkTS component-structure preview.
 * This is NOT DevEco Previewer or an ArkUI renderer. Never execute project code.
 */
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

export interface ArktsComponent {
  readonly kind: string
  readonly line: number
  readonly label: string
}
export interface ArktsPage {
  readonly file: string
  readonly components: readonly ArktsComponent[]
}
export interface HarmonyInspection {
  readonly kind: 'arkui' | 'arkweb'
  readonly pages: readonly ArktsPage[]
  readonly webRoot?: string
  readonly screenshot?: string
}
const MAX_PAGES = 24
const MAX_SOURCE_BYTES = 256_000
const COMPONENTS = /^(\s*)(Text|Button|Image|Row|Column|Stack|Scroll|List|ListItem|Grid|GridItem|TextInput|TextArea|Search|Checkbox|Toggle|Slider|Progress|Divider|Tabs|TabContent|Navigation|NavDestination|Web|Blank|Flex|RelativeContainer|Swiper|ForEach|LazyForEach)\s*\(/u
const allowedModule = /^[a-zA-Z0-9_-]{1,80}$/
const within = (root: string, file: string): boolean => {
  const path = relative(root, file)
  return path === '' || (path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path))
}
const sourceRoot = (module: string): string[] => [
  join(module, 'src', 'main', 'ets', 'pages'),
  join(module, 'src', 'main', 'ets', 'components'),
]
const safeRead = (file: string): string | undefined => {
  try {
    if (!statSync(file).isFile() || statSync(file).size > MAX_SOURCE_BYTES) return undefined
    return readFileSync(file, 'utf8')
  } catch { return undefined }
}
function readArkts(project: string, module: string): ArktsPage[] {
  const out: ArktsPage[] = []
  for (const folder of sourceRoot(module)) {
    if (!existsSync(folder)) continue
    let entries
    try { entries = readdirSync(folder, { withFileTypes: true }) } catch { continue }
    for (const entry of entries.sort((a,b) => a.name.localeCompare(b.name))) {
      if (out.length >= MAX_PAGES) return out
      if (!entry.isFile() || !/^[a-z0-9_.-]+\.ets$/iu.test(entry.name)) continue
      const raw = join(folder, entry.name)
      let path: string
      try { path = realpathSync(raw) } catch { continue }
      if (!within(project, path)) continue
      const content = safeRead(path)
      if (content === undefined) continue
      const components: ArktsComponent[] = []
      const lines = content.split(/\r?\n/u)
      for (let i = 0; i < lines.length && components.length < 80; i++) {
        const line = lines[i]!
        const hit = COMPONENTS.exec(line)
        if (!hit) continue
        const kind = hit[2]!
        const value = line.slice(hit[0].length).trim()
        components.push({ kind, line: i + 1, label: value.slice(0, 110) })
      }
      out.push({ file: relative(project, path).replaceAll('\\', '/'), components })
    }
  }
  return out
}
export function inspectHarmonyProject(rawProject: string): HarmonyInspection | undefined {
  let project: string
  try { project = realpathSync(resolve(rawProject)) } catch { return undefined }
  if (!existsSync(project) || !statSync(project).isDirectory()) return undefined
  let children
  try { children = readdirSync(project, { withFileTypes: true }) } catch { return undefined }
  const modules = children
    .filter(entry => entry.isDirectory() && !entry.isSymbolicLink() && allowedModule.test(entry.name))
    .slice(0, 16)
    .map(entry => join(project, entry.name))
    .filter(path => existsSync(join(path, 'src', 'main', 'module.json5')))
  if (existsSync(join(project, 'src', 'main', 'module.json5'))) modules.push(project)
  // Require HarmonyOS module metadata. A random .ets file does not make a Stage application.
  if (modules.length === 0) return undefined
  if (!existsSync(join(project, 'build-profile.json5')) &&
      !existsSync(join(project, 'AppScope', 'app.json5')) &&
      !existsSync(join(project, 'src', 'main', 'module.json5'))) return undefined
  const pages = modules.flatMap(module => readArkts(project, module)).slice(0, MAX_PAGES)
  // Optional, explicitly named screenshot exported by the user from DevEco/device.
  let screenshot: string | undefined
  for (const name of [join(project, 'controlgui-preview.png'), join(project, 'screenshots', 'controlgui-preview.png')]) {
    try {
      if (!existsSync(name)) continue
      const resolved = realpathSync(name)
      const size = statSync(resolved)
      if (within(project, resolved) && size.isFile() && size.size <= 8 * 1024 * 1024 && size.size > 0) {
        const header = readFileSync(resolved).subarray(0, 8).toString('hex')
        if (header === '89504e470d0a1a0a') { screenshot = resolved; break }
      }
    } catch { /* Optional screenshots never block preview. */ }
  }
  const webModule = modules.find(module => pages.some(page =>
    page.file.startsWith(relative(project, module).replaceAll('\\', '/') + '/') &&
    page.components.some(component => component.kind === 'Web')))
  if (webModule) {
    for (const dir of [
      join(webModule, 'src', 'main', 'resources', 'rawfile'),
      join(webModule, 'src', 'main', 'resources', 'rawfile', 'web'),
    ]) {
      try {
        if (existsSync(join(dir, 'index.html')) && statSync(join(dir, 'index.html')).isFile() &&
            within(project, realpathSync(dir))) return { kind: 'arkweb', pages, webRoot: realpathSync(dir), ...(screenshot ? { screenshot } : {}) }
      } catch { /* Do not infer H5 if the asset is inaccessible or outside the project. */ }
    }
  }
  return { kind: 'arkui', pages, ...(screenshot ? { screenshot } : {}) }
}
const escapeHtml = (value: string): string => value.replace(/[&<>"']/gu, ch => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[ch]!))
export function renderArktsStructure(project: string, inspected: HarmonyInspection): string {
  const screenshot = inspected.screenshot
    ? '<figure class="shot"><img src="/__dsh_gui__/harmony-shot.png" alt="用户提供的 HarmonyOS 页面截图，非实时渲染"><figcaption>来自项目内 controlgui-preview.png 的用户截图，仅供视觉参考；点击下方源码组件条目进行批注，截图像素不能直接映射到 ArkTS。</figcaption></figure>'
    : ''
  const overview = inspected.pages.length === 0
    ? '<p class="empty">识别为鸿蒙原生工程，但未找到可读取的 ets/pages 或 ets/components 文件。请检查模块目录。</p>'
    : inspected.pages.map(page => {
      const components = page.components.length
        ? page.components.map(component => {
          const fileHint = page.file + ':' + String(component.line)
          return '<button class="component" type="button" data-source-file="' + escapeHtml(fileHint) + '">' +
            '<span class="kind">' + escapeHtml(component.kind) + '</span>' +
            '<span class="info">第 ' + String(component.line) + ' 行 · ' + escapeHtml(component.label || '组件调用') + '</span></button>'
        }).join('')
        : '<p class="empty">此文件没有识别到支持的界面组件调用。</p>'
      return '<section class="page"><h2>' + escapeHtml(basename(page.file)) +
        '</h2><p class="path">' + escapeHtml(page.file) + '</p>' + components + '</section>'
    }).join('')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>HarmonyOS ArkTS 组件结构 · ControlGUI</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f4f6fa;color:#25314a;font:14px/1.6 system-ui,"Microsoft YaHei",sans-serif}
main{max-width:880px;margin:auto;padding:20px 18px 90px}
h1{margin:0 0 9px;font-size:21px}.note{background:#fff7e8;border-left:4px solid #dd9632;padding:12px 16px;border-radius:6px;margin:12px 0 22px}
.page{background:#fff;border:1px solid #dbe2ee;border-radius:12px;padding:15px;margin-bottom:15px}
h2{margin:0;font-size:16px}.path{font:12px/1.6 ui-monospace,monospace;color:#62728a;word-break:break-all;margin:0 0 11px}
.component{display:flex;flex-wrap:wrap;gap:7px;align-items:center;width:100%;text-align:left;margin:7px 0;padding:10px;background:#f8faff;border:1px solid #e0e6f3;border-radius:8px;cursor:pointer}
.component:hover{border-color:#6092fb;background:#f1f6ff}.kind{font-weight:700;color:#2859b4;min-width:90px}.info{color:#52647c;overflow-wrap:anywhere}
.empty{color:#66768a}.shot{margin:0 0 18px;padding:16px;background:white;border:1px solid #dbe2ee;border-radius:12px;text-align:center}.shot img{max-width:100%;max-height:520px;object-fit:contain}.shot figcaption{font-size:12px;color:#67768c;margin-top:9px}
</style><script defer src="/__dsh_gui__/bridge.js"></script></head><body><main>
<h1>HarmonyOS · ArkTS 组件结构</h1>
<div class="note"><strong>注意：这是源码结构检查视图，不是鸿蒙原生渲染截图。</strong>
当前未运行 DevEco Previewer、Hvigor 或设备模拟器；组件顺序与实际布局、尺寸、样式可能不同。
你可以开启右侧 ControlGUI 的批注模式，点击组件条目，批注会包含真实源码相对路径与行号线索，提交前仍需 Agent 核实源码。</div>
<p>项目：<code>${escapeHtml(project)}</code> · 已识别 ${inspected.pages.length} 个 ArkTS 文件</p>
${screenshot}${overview}</main></body></html>`
}
