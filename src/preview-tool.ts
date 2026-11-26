/**
 * Explicit Agent tool for opening ControlGUI. Unlike a pre-send regex gate,
 * this is part of the regular DSH Agent turn: the model chooses to call it.
 *
 * DSH tool execution supports exec.concludeTurn() which is carried through the
 * successful tool/result and closes the current turn without another LLM call.
 * The web client sees the named tool result and opens the preview in that session.
 */
import type { Context } from '@deepseek-ai/cordis'
import { createProjectLauncher, readProjectCatalog, type OpenRequest } from './project-launcher.ts'
import { searchLocalProjects } from './project-search.ts'

export const PREVIEW_TOOL = 'open_codex_gui_preview'
export const SEARCH_PROJECTS_TOOL = 'search_codex_gui_projects'
export const PREVIEW_TARGET_MARKER = 'CONTROLGUI_TARGET='

/** Internal, user-facing result; it describes a request, not a verified browser open. */
export const PREVIEW_TOOL_TARGET_REQUIRED = '当前无法确定要打开哪个网页。请先从当前对话中确认具体项目名称或路径；如果上下文没有明确目标，请询问用户提供项目名称或绝对路径，不要猜测或复用其他会话的项目。'

export function installPreviewTool(ctx: Context): void {
  const launcher = createProjectLauncher()
  ctx.inject(['tools'], scope => {
    scope.effect(() => {
      const stopSearch = scope.tools.register({
        name: SEARCH_PROJECTS_TOOL,
        description: [
          'Search local computer project roots READ-ONLY for a user-described website or application, including HarmonyOS Stage apps.',
          'Use this FIRST for ANY project named or described in natural language, unless the user explicitly asks for the previous preview or provides an absolute directory path.',
        'There is NO manually maintained project alias registration; search inspects only local project metadata inside configured search roots.',
          'Matches folder name, package.json name/description, README headings, Vue/Vite/static/Python and HarmonyOS Stage project markers.',
          'Return candidate absolute paths and technology. Never launch or edit anything; if there are multiple similar candidates, ask the user to select the intended path.',
          'After a uniquely supported match, call open_codex_gui_preview with the exact project path returned here, not a guessed path.',
        ].join(' '),
        parameters: { type: 'object', properties: {
          query: { type: 'string', description: 'Project name or description in natural language, e.g. 之前写的动漫推荐系统 or Vue 工作台.' },
        }, required: ['query'], additionalProperties: false },
        output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
        async execute(args, exec) {
          exec.signal.throwIfAborted()
          const query = typeof args === 'object' && args !== null && 'query' in args && typeof args.query === 'string' ? args.query : ''
          return JSON.stringify(searchLocalProjects(query, readProjectCatalog()))
        },
        presentCall: args => ({ card: 'generic', title: '搜索本地应用项目', kind: 'read', rawInput: args }),
      })
      const stop = scope.tools.register({
      name: PREVIEW_TOOL,
      description: [
        'Open a local Web page or HarmonyOS Stage project in the DSH right-side ControlGUI and return control for visual or source-structure annotations.',
        'Call this tool to open/show/preview a webpage ONLY when its target can be identified from the current conversation or explicitly supplied by the user.',
        'The request must be specifically to view/annotate a page or application UI, not to explain how, edit source code, test, or build.',
        'For “那个网页” / “the previous page”, first resolve the project from the CURRENT conversation context and supply its known path or name. If there is no unambiguous contextual target, ASK the user for a project name or absolute path; do NOT call this tool empty, guess, or reuse another session’s last preview.',
        'If a specific project path is explicitly supplied by the user, set project to its absolute directory path.',
        'For ANY named or described project, FIRST call search_codex_gui_projects with the user wording. Use the exact returned project path only when one candidate is clearly supported.',
        'If the search yields ambiguous candidates, show the options to the user and wait for their selection. No registration or manual alias is required.',
        'The optional name parameter also runs the same automatic search and REFUSES ambiguous or low-confidence matches; never guess paths.',
        'For a Vite/Vue project, discover or start its local Web server. For HarmonyOS ArkWeb with packaged H5 resources, preview local HTML; for ArkUI/ArkTS, open a read-only, source-mapped component-structure view clearly marked NOT native rendering. Never pretend to run DevEco or build an HAP.',
        'Do NOT guess paths, do not use other terminals to launch an app before this tool, and do not invent URLs. Unknown or ambiguous names will be rejected safely.',
        'This tool deliberately ENDS the Agent turn immediately after its tool result. Do not combine it with coding tools in the same model response.',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'Optional absolute project directory explicitly requested by the user. Omit if the user only provided a project name.' },
          name: { type: 'string', description: 'Optional user-given local project name or alias, e.g. Vue 工作台, Arc Studio. Do not invent a directory path.' },
          dev: { type: 'string', description: 'Optional running local frontend origin, e.g. http://localhost:5173. Omit to auto-detect a running dev server.' },
        },
        additionalProperties: false,
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: String(value) }],
      },
      async execute(rawArgs, exec) {
        exec.signal.throwIfAborted()
        const args = typeof rawArgs === 'object' && rawArgs !== null ? rawArgs as OpenRequest : {}
        const project = typeof args.project === 'string' ? args.project.trim() : undefined
        const name = typeof args.name === 'string' ? args.name.trim() : undefined
        if (!project && !name) {
          // Do not end the turn or open an arbitrary remembered page; the Agent can still ask for the target.
          return PREVIEW_TOOL_TARGET_REQUIRED
        }
        try {
          const target = await launcher.prepare(args, exec.signal)
          exec.concludeTurn()
          const label = target.previewKind === 'arkui' ? '鸿蒙 ArkUI 源码结构' : target.previewKind === 'arkweb' ? '鸿蒙 ArkWeb/H5' : '网页'
          const human = (target.started ? '已启动' : '已找到') + label + '项目：' + target.project +
            (target.dev ? '；本地开发服务：' + target.dev : target.previewKind === 'arkui' ? '；仅展示组件结构，非 DevEco 原生预览' : '；静态预览') +
            '。右侧 ControlGUI 将自动打开，可以开始批注。'
          return human + '\n' + PREVIEW_TARGET_MARKER + JSON.stringify({
            project: target.project, ...(target.dev ? { dev: target.dev } : {}),
          })
        } catch (error) {
          if (exec.signal.aborted) throw error
          exec.concludeTurn()
          return 'ControlGUI 无法自动打开项目：' + (error instanceof Error ? error.message : String(error))
        }
      },
      presentCall: args => ({
        card: 'generic', title: '打开 ControlGUI 界面预览', kind: 'read', rawInput: args,
      }),
    })
      return () => { stopSearch(); stop(); launcher.dispose() }
    }, 'codex-gui: Agent preview terminal tool')
  })
}
