/**
 * Codex-style GUI preview tab.
 *
 * The tab type, its body and its prompt-driven auto-open are registered from this
 * module only; the earlier Browser tab and its visual-feedback module stay
 * untouched. The page runtime is served by the local `codex-visual-preview`
 * sidecar, so the host never reaches into the cross-origin preview document.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { GuideArtworkBrowser } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-commands/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { CodexGuiBody } from './CodexGuiBody.tsx'
import { restoreCodexTabsOnlyOnDshRestart } from './restart-policy.ts'

/** Tab kind opened by this implementation. */
export const CODEX_GUI_KIND = 'codex-gui'

/** Implementation identity and keyed slot dispatch key. */
export const CODEX_GUI_ID = '@local/dsh-codex-gui:codex-gui'

import { CODEX_PREVIEW_API } from './endpoints.ts'
import { previewIntentGate } from '../intent-policy.ts'
export { CODEX_PREVIEW_API } from './endpoints.ts'

export interface CodexGuiTarget { readonly project: string; readonly dev?: string }
export interface ResolvedCodexGuiTarget extends CodexGuiTarget { readonly url: string }

declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  interface SidebarRightTabParamsMap {
    /** Optional preview address resolved for this Session, plus the last resolution problem. */
    'codex-gui': { readonly url?: string; readonly project?: string; readonly dev?: string; readonly problem?: string; readonly notice?: string }
  }
}

/** Only an explicit preview command should open a GUI tab; never a general editing request. */
export function wantsCodexGuiPreview(text: string): boolean {
  return previewIntentGate(text) === 'open'
}

/** If the model is offline, fall back only for explicit GUI + open directives. */
export function safePreviewFallback(text: string): boolean {
  const prompt = text.trim().replace(/^(?:请|麻烦|帮我|现在)\s*/u,'')
  if (/^(?:不要|别|为什么|怎么|如何|分析|解释|研究|讨论|是否|能不能)/u.test(prompt)) return false
  return /(?:codex[\s-]*gui|\bGUI\b|右侧).{0,25}(?:打开|预览|展示|显示)(?:.{0,45}(?:项目|页面|网站|网页|前端|[a-z]:\\))/iu.test(prompt)
}

export function codexProjectFromPrompt(prompt: string, _cwd: string): string {
  // Markdown backticks and plain Windows paths are both valid.
  const quoted = /[`"']([A-Z]:\\[^`"'\r\n]+)[`"']/iu.exec(prompt)?.[1]
  const bare = /(?:^|[\s(])([A-Z]:\\[^\s`"'<>\uFF0C\u3002\uFF1B;\uFF09)]+)/iu.exec(prompt)?.[1]
  // Never silently open DSH's own cwd for prompts with no explicit target.
  const selected = (quoted ?? bare ?? '').trim()
  return selected.replace(/[\\/][^\\/]+\.(?:html?|css|js|jsx|ts|tsx|vue|svelte)$/iu, '')
}

async function resolvePreview(project: string, dev?: string): Promise<ResolvedCodexGuiTarget> {
  const api = new URL(CODEX_PREVIEW_API)
  api.searchParams.set('project', project)
  api.searchParams.set('codex', '1')
  if (dev !== undefined) api.searchParams.set('dev', dev)
  const response = await fetch(api, { mode: 'cors', signal: AbortSignal.timeout(7000) })
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: 'No preview endpoint' })) as { error?: string }
    throw new Error(body.error ?? ('Preview resolver HTTP ' + String(response.status)))
  }
  const body = await response.json() as { url?: string; project?: string; dev?: string }
  if (body.url === undefined) throw new Error('Preview resolver returned no address')
  const url = new URL(body.url)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.searchParams.get('__dsh_gui') !== '1') {
    throw new Error('Refusing unexpected preview address')
  }
  return { url: url.href, project: body.project ?? project, ...((dev ?? body.dev) === undefined ? {} : { dev: (dev ?? body.dev)! }) }
}

/**
 * Register the ControlGUI tab type, its body and prompt-driven auto-open.
 * @param ctx - the plugin context.
 */
export function installCodexGui(ctx: Context): void {
  const definition: SidebarRightTabDefinition = {
    id: CODEX_GUI_ID,
    kind: CODEX_GUI_KIND,
    multiple: true,
    priority: 'builtin',
    title: () => 'ControlGUI',
    guide: [{
      id: 'new',
      order: 31,
      title: () => 'ControlGUI',
      description: () => '网页元素批注预览（Shadow DOM 版）',
      icon: GuideArtworkBrowser,
    }],
  }
  ctx.effect(() => ctx.sidebarRightTabs.register(definition), 'codex-gui: type')

  // Preserve right Sidebar preview tabs across ordinary browser refreshes.
  // Only discard old ControlGUI tabs if the DSH *host process* restarted.
  ctx.inject(['sidebarRight'], scope => {
    scope.effect(() => restoreCodexTabsOnlyOnDshRestart(scope.sidebarRight),
      'codex-gui: preserve refresh, discard DSH-restart previews')
  })

  // Codex-like preview ownership: invoking /codexgui is a pure browser action.
  // It does not emit user/message or start an Agent turn. Only confirmed
  // annotations in CodexGuiBody intentionally submit a coding request.
  ctx.inject(['commandUi', 'sidebarRight', 'sessions'], (scope) => {
    scope.effect(() => scope.commandUi.register({
      name: 'codexgui',
      label: () => 'ControlGUI · 打开网页预览',
      description: () => '打开可视化批注面板，不启动 Agent',
      icon: GuideArtworkBrowser,
      available: session => scope.sessions.binding(session.sessionId) !== undefined,
      ui: {
        kind: 'action',
        run: session => {
          scope.sidebarRight.openTabIn(session.sessionId, CODEX_GUI_KIND, { params: {} })
        },
      },
    }), 'codex-gui: client-only preview command')
  })

  // Natural-language requests are ordinary Agent messages. The model calls
  // open_codex_gui_preview; its successful tool result drives the browser UI.
  // There is deliberately no pre-send interception or persistent composer notice.

  ctx.inject(['sessions', 'sidebarRightTabs', 'sidebarRight', 'conversation'], (scope) => {
    type Binding = NonNullable<ReturnType<typeof scope.sessions.binding>>
    type SessionId = Binding['sessionId']

    const openPreviewFor = async (_sessionId: SessionId, target?: CodexGuiTarget): Promise<ResolvedCodexGuiTarget> => {
      const project = target?.project?.trim()
      if (!project) throw new Error('请先输入要预览的项目绝对路径（手动打开时不默认使用 DSH 工作区）')
      return resolvePreview(project, target?.dev)
    }

    scope.effect(() => scope.slots.inject('sidebar.right.pane.tab', () => scope.slots.register({
      name: 'sidebar.right.pane.tab',
      key: CODEX_GUI_ID,
      inject: sessionId => ({
        openPreview: (target?: CodexGuiTarget) => openPreviewFor(sessionId, target),
        sendAnnotation: async (prompt: string): Promise<void> => {
          // Scope the send to the same Session as this preview tab. This bypasses
          // the composer and uses DSH's normal queued user-message transport.
          if (!scope.sessions.binding(sessionId)) throw new Error('当前 DSH 会话已关闭')
          const conversation = scope.sessions.scope(sessionId)?.get('conversation')
          if (!conversation) throw new Error('当前 DSH 会话不可发送消息')
          await conversation.send(prompt)
        },
      }),
    }, CodexGuiBody)), 'codex-gui: body')

    const bound = new Map<SessionId, { readonly binding: Binding; readonly stop: () => void }>()
    // Match terminal tool results against their own call IDs; never react to
    // a user/message alone. The DSH model must decide to call the tool.
    const boundCalls = new Map<SessionId, Map<string, CodexGuiTarget & { readonly name?: string }>>()

    const attach = (binding: Binding): void => {
      const id = binding.sessionId
      const previous = bound.get(id)
      if (previous?.binding === binding) return
      previous?.stop()
      const calls = new Map<string, CodexGuiTarget & { readonly name?: string }>()
      boundCalls.set(id, calls)
      const stop = binding.eventSource.subscribe(() => {
        if (scope.sessions.binding(id) !== binding) return
        const change = binding.eventSource.getSnapshot().change
        if (change.kind !== 'append') return
        for (const { event } of change.entries) {
          if (event.type === 'tool/call' && event.data.name === 'open_codex_gui_preview') {
            let raw: unknown
            try { raw = JSON.parse(event.data.arguments) } catch { raw = null }
            const values = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {}
            const project = typeof values.project === 'string' ? values.project.trim() : ''
            const dev = typeof values.dev === 'string' ? values.dev.trim() : undefined
            const name = typeof values.name === 'string' ? values.name.trim() : undefined
            calls.set(String(event.data.callId), {
              project, ...(dev === undefined || !dev ? {} : { dev }),
              ...(name ? { name } : {}),
            })
            if (calls.size > 20) calls.delete(calls.keys().next().value!)
            continue
          }
          if (event.type !== 'tool/result') continue
          const callId = String(event.data.message.toolCallId)
          const target = calls.get(callId)
          if (target === undefined) continue
          calls.delete(callId)
          // Only a committed successful tool call is allowed to open the pane.
          if (event.data.message.isError) continue
          if ((scope.sessions.list.getSnapshot().byId[id]?.retainedBy.mainView ?? 0) <= 0) continue
          // The Host resolves names and starts local dev servers BEFORE concluding
          // the Agent turn. Do not fall back to the previous page for a failed
          // named lookup: that would silently show the wrong project.
          let prepared: { project: string; dev?: string } | undefined
          const content = event.data.message.content
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type !== 'text' || typeof block.text !== 'string') continue
              const prefix = 'CONTROLGUI_TARGET='
              const at = block.text.indexOf(prefix)
              if (at < 0) continue
              try {
                const value = JSON.parse(block.text.slice(at + prefix.length).split('\n')[0]!)
                if (value && typeof value.project === 'string' && value.project.trim()) {
                  prepared = { project: value.project, ...(typeof value.dev === 'string' ? { dev: value.dev } : {}) }
                }
              } catch { /* Malformed tool output is never a reason to guess a target. */ }
            }
          }
          // Only the Host's verified target marker can trigger an Agent-driven preview.
          // A missing target is handled by the Agent asking for a project name/path;
          // never infer it from the browser's global last-used page.
          if (!prepared) continue
          const { project, dev } = prepared
          // Browser UI resolution happens independently of Agent execution.
          // The Agent turn is already concluded by exec.concludeTurn().
          void resolvePreview(project, dev).then(
            resolved => {
              if (scope.sessions.binding(id) !== binding) return
              scope.sidebarRight.openTabIn(id, CODEX_GUI_KIND, { params: {
                ...resolved, notice: '网页已打开，可以开始批注。本轮 Agent 已结束。',
              } })
            },
            (error: unknown) => {
              if (scope.sessions.binding(id) !== binding) return
              scope.sidebarRight.openTabIn(id, CODEX_GUI_KIND, {
                params: {
                  project,
                  problem: '网页预览打开失败：' + (error instanceof Error ? error.message : String(error)),
                },
              })
            },
          )
        }
      })
      bound.set(id, { binding, stop })
    }

    const reconcile = (): void => {
      const active = new Set(Object.values(scope.sessions.list.getSnapshot().byId).map(summary => summary.id))
      for (const id of active) {
        const binding = scope.sessions.binding(id)
        if (binding !== undefined) attach(binding)
      }
      for (const [id, entry] of bound) {
        if (active.has(id) && scope.sessions.binding(id) === entry.binding) continue
        entry.stop()
        bound.delete(id)
        boundCalls.delete(id)
      }
    }

    scope.effect(() => {
      const stop = scope.sessions.list.subscribe(reconcile)
      reconcile()
      return () => {
        stop()
        for (const entry of bound.values()) entry.stop()
        bound.clear()
        boundCalls.clear()
      }
    }, 'codex-gui: Agent tool preview')
  })
}
