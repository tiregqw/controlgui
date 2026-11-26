/** Two-stage, non-executing intent gate for the Codex GUI preview tab.
 *
 * Regexes keep obvious commands cheap and guard against unwanted model calls.
 * Ambiguous UI requests may be judged by the current DSH session model.
 * No file paths or commands from a model are ever executed.
 */
export type PreviewIntentGate = 'open' | 'ignore' | 'judge'

export function previewIntentGate(text: string): PreviewIntentGate {
  const prompt = text.trim().slice(0, 5000)
  if (!prompt || prompt.length > 4200) return 'ignore'
  const compact = prompt.replace(/^(?:请|麻烦|帮我|帮忙|现在|直接|能否请你)\s*/u, '').trim()
  // A question about how to use the feature, a refusal, or a quoted example
  // must never silently open tabs.
  if (/^(?:不要|不必|无需|无须|先别|暂时别|别|禁止|取消|停止|为什么|为何|怎么|如何|解释|分析|讨论|研究|讲讲|告诉我|什么是|有没有)/u.test(compact)) return 'ignore'
  if (/^(?:why|how|explain|analy[sz]e|what|do not|don't|stop|cancel)\b/iu.test(compact)) return 'ignore'
  const relevant = /(?:codex[\s-]*gui|gui|右侧|侧栏|侧边栏|旁边|浏览器|网页|网站|前端|页面|预览|preview|webpage|website|browser|可视化|批注)/iu
  if (!relevant.test(compact)) return 'ignore'
  // Standalone, explicit directives can be answered without another model call.
  if (/^(?:(?:在|于).{0,28}(?:codex[\s-]*gui|gui|右侧|侧栏).{0,24}(?:预览|展示|显示)|(?:打开|预览|展示|显示|启动).{0,42}(?:codex[\s-]*gui|gui|网页|网站|页面|前端|预览)|(?:preview|open|show)\s+(?:the\s+)?(?:gui|webpage|website|html|project))/iu.test(compact)) return 'open'
  // All unclear yet relevant requests use semantic reasoning; never classify
  // generic coding work as an implicit preview request.
  if (/(?:打开|预览|展示|显示|放到|放在|看看|看下|看一眼|呈现|调出|调起来|给我看|呈给我|侧边|旁边|可视化|批注|show|open|preview|display|sidebar)/iu.test(compact)) return 'judge'
  return 'ignore'
}

/** Only the exact words are accepted from the LLM, never free-form JSON, paths or code. */
export function parseModelPreviewIntent(raw: string): 'open' | 'ignore' | 'unknown' {
  const value = raw.trim().toUpperCase()
  if (value === 'OPEN') return 'open'
  if (value === 'IGNORE') return 'ignore'
  return 'unknown'
}
