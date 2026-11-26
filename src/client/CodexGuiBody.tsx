import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { CodexGuiTarget, ResolvedCodexGuiTarget } from './install.ts'
import { CodexAnnotationPort } from './provider.ts'
import { CODEX_PREVIEW_STATUS } from './endpoints.ts'
import { formatCodexPrompt, readCodexDraft, type CodexNote } from './protocol.ts'


export interface CodexGuiInjected {
  /** Resolve an explicit target (or the active Session workspace on first open). */
  openPreview(target?: CodexGuiTarget): Promise<ResolvedCodexGuiTarget>
  /** Send directly into this tab's DSH Session, without touching the composer. */
  sendAnnotation(prompt: string): Promise<void>
}
export type CodexGuiBodyProps = PropsRuntime<'sidebar.right.pane.tab'> & InjectFace<CodexGuiInjected>


const root: CSSProperties = { position: 'relative', display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: '#f6f7fb' }
const toolbar: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderBottom: '1px solid #e2e6f0', background: '#fff', flex: '0 0 auto' }
const address: CSSProperties = { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', font: '12px/1.6 ui-monospace, SFMono-Regular, Consolas, monospace', color: '#55607a' }
const button: CSSProperties = { border: '1px solid #d7dded', background: '#fff', color: '#2b3550', borderRadius: 7, padding: '4px 9px', font: '12px/1.4 system-ui, sans-serif', cursor: 'pointer' }
const frame: CSSProperties = { flex: 1, width: '100%', minHeight: 0, border: 0, background: '#fff' }
const empty: CSSProperties = { flex: 1, display: 'grid', placeItems: 'center', padding: 24, textAlign: 'center', font: '13px/1.7 system-ui, sans-serif', color: '#5a6580' }
const notice: CSSProperties = { padding: '5px 9px', borderTop: '1px solid #e2e6f0', background: '#fffaf0', color: '#8a5a12', font: '12px/1.5 system-ui, sans-serif', flex: '0 0 auto' }
const overlay: CSSProperties = { position: 'absolute', inset: 0, zIndex: 20, background: 'rgba(9,17,35,.45)', display: 'grid', placeItems: 'center', padding: 12 }
const reviewCard: CSSProperties = { width: '100%', maxWidth: 440, maxHeight: '85%', overflow: 'auto', background: '#fff', color: '#26314b', padding: 18, borderRadius: 13, boxShadow: '0 12px 40px #0004', font: '13px/1.6 system-ui,sans-serif' }

const targetKey = (sessionId: string): string => 'dsh:codex:last-target:v1:' + encodeURIComponent(sessionId)
const globalTargetKey = 'dsh:codex:last-target-global:v1'
const draftKey = (sessionId: string, target: CodexGuiTarget): string =>
  'dsh:codex:draft:v1:' + encodeURIComponent(sessionId) + ':' + encodeURIComponent(target.project) + ':' + encodeURIComponent(target.dev ?? '')

const workspaceOf = (url: string | undefined): string => {
  if (url === undefined) return ''
  try { return new URL(url).searchParams.get('workspace') ?? '' } catch { return '' }
}
const readLastTarget = (sessionId: string): CodexGuiTarget | undefined => {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(targetKey(sessionId)) ?? localStorage.getItem(globalTargetKey) ?? 'null')
    if (typeof data !== 'object' || data === null || !('project' in data) || typeof data.project !== 'string' || data.project.length === 0) return undefined
    const dev = 'dev' in data && typeof data.dev === 'string' ? data.dev : undefined
    return { project: data.project, ...(dev === undefined ? {} : { dev }) }
  } catch { return undefined }
}
const saveLastTarget = (sessionId: string, target: CodexGuiTarget): void => {
  try {
    localStorage.setItem(targetKey(sessionId), JSON.stringify(target))
    localStorage.setItem(globalTargetKey, JSON.stringify(target))
  } catch { /* unavailable storage */ }
}
const restoreDraft = (sessionId: string, target: CodexGuiTarget, url: string): readonly CodexNote[] => {
  if (!target.project) return []
  try {
    const key = draftKey(sessionId, target)
    const raw: unknown = JSON.parse(localStorage.getItem(key) ?? 'null')
    if (typeof raw !== 'object' || raw === null || !('notes' in raw)) return []
    // Old versions persisted sent annotations; do not restore these on refresh.
    if ('sent' in raw && raw.sent === true) {
      localStorage.removeItem(key)
      return []
    }
    const parsed = readCodexDraft({ notes: raw.notes, url })
    return parsed?.notes ?? []
  } catch { return [] }
}
const persistDraft = (sessionId: string, target: CodexGuiTarget, notes: readonly CodexNote[]): void => {
  if (!target.project) return
  try {
    const key = draftKey(sessionId, target)
    if (notes.length === 0) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify({ version: 4, notes }))
  } catch { /* browser storage quota / disabled storage */ }
}

/** The parent page owns confirmation: a preview iframe can suggest notes, never submit them. */
export function CodexGuiBody(props: CodexGuiBodyProps): ReactNode {
  const { useTabInfo } = props
  const { tab } = useTabInfo()
  const sessionId = String(props.sessionId)
  const params: unknown = tab.navigation.params
  const value = typeof params === 'object' && params !== null ? params as Record<string, unknown> : {}
  const paramUrl = typeof value.url === 'string' ? value.url : undefined
  const paramProject = typeof value.project === 'string' ? value.project : workspaceOf(paramUrl)
  const paramDev = typeof value.dev === 'string' ? value.dev : undefined
  const paramProblem = typeof value.problem === 'string' ? value.problem : ''
  const paramNotice = typeof value.notice === 'string' ? value.notice : ''
  const [target, setTarget] = useState<CodexGuiTarget>(() => paramProject
    ? { project: paramProject, ...(paramDev === undefined ? {} : { dev: paramDev }) }
    : { project: '' }) // Previous project is only an input hint; it must not auto-open.
  // Editable target is separate from the active preview; typing must not
  // trigger network requests until the user explicitly opens a project.
  const [projectInput, setProjectInput] = useState(() => paramProject || readLastTarget(sessionId)?.project || '')
  const [devInput, setDevInput] = useState(() => paramDev || readLastTarget(sessionId)?.dev || '')
  const [url, setUrl] = useState<string | undefined>(paramUrl)
  const [revision, setRevision] = useState(0)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState(paramProblem)
  const [statusNotice, setStatusNotice] = useState(paramNotice)
  const [upstreamState, setUpstreamState] = useState<'unknown' | 'online' | 'offline'>('unknown')
  const [retryToken, setRetryToken] = useState(0)
  const [sending, setSending] = useState(false)
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const portRef = useRef<CodexAnnotationPort | null>(null)
  const sendingRef = useRef(false)
  const resolverRef = useRef(props.openPreview)
  resolverRef.current = props.openPreview
  const urlRef = useRef(url)
  urlRef.current = url

  useEffect(() => {
    setUrl(paramUrl)
    setProblem(paramProblem)
    setStatusNotice(paramNotice)
    setUpstreamState('unknown')
    if (paramProject) {
      const next = { project: paramProject, ...(paramDev === undefined ? {} : { dev: paramDev }) }
      setTarget(next)
      setProjectInput(paramProject)
      setDevInput(paramDev ?? '')
      saveLastTarget(sessionId, next)
    } else {
      // A blank panel has no verified active target, even if an older target was saved.
      setTarget({ project: '' })
    }
  }, [paramUrl, paramProject, paramDev, paramProblem, paramNotice, sessionId])

  // After the resolver restarts, every in-memory per-project port changes.
  // Poll its protected instance ID and re-resolve ONLY on startup or change.
  // Never interrupt an in-flight direct annotation submission.
  useEffect(() => {
    if (!target.project || busy) return
    let stopped = false
    let lastInstance: string | undefined
    let connectionLost = false
    let upstreamWasUnavailable = false
    let checking = false
    const check = async (): Promise<void> => {
      if (stopped || checking || sendingRef.current) return
      checking = true
      try {
        const statusUrl = new URL(CODEX_PREVIEW_STATUS)
        if (target.dev) statusUrl.searchParams.set('dev', target.dev)
        const response = await fetch(statusUrl, {
          mode: 'cors', cache: 'no-store', signal: AbortSignal.timeout(4000),
        })
        if (!response.ok) throw new Error('Preview service HTTP ' + String(response.status))
        const state = await response.json() as { healthy?: boolean; instanceId?: string; upstreamHealthy?: boolean }
        if (state.healthy !== true || typeof state.instanceId !== 'string') throw new Error('Invalid preview status')
        if (stopped || sendingRef.current) return
        if (target.dev && state.upstreamHealthy === false) {
          upstreamWasUnavailable = true
          connectionLost = true
          setUpstreamState('offline')
          setProblem('开发服务器暂不可用：' + target.dev + '；恢复后将自动重新连接（每 6 秒检测）')
          return
        }
        const refresh = lastInstance === undefined || lastInstance !== state.instanceId || connectionLost || upstreamWasUnavailable
        lastInstance = state.instanceId
        connectionLost = false
        upstreamWasUnavailable = false
        setUpstreamState('online')
        if (!refresh) return
        try {
          const next = await resolverRef.current(target)
          if (stopped) return
          if (next.url !== urlRef.current) {
            urlRef.current = next.url
            setUrl(next.url)
            // Reuse the preview address; reload below even if it has not changed.
          }
          setRevision(value => value + 1)
          setProblem('')
        } catch (error) {
          if (stopped) return
          connectionLost = true // Retry even if the resolver instance stays the same.
          setProblem('预览重新连接失败：' + (error instanceof Error ? error.message : String(error)))
        }
      } catch {
        if (stopped) return
        connectionLost = true
        setUpstreamState('offline')
        setProblem(previous => previous.startsWith('预览重新连接失败：')
          ? previous : '预览服务暂不可用；恢复后会自动重新连接')
      } finally { checking = false }
    }
    void check()
    const timer = setInterval(() => { void check() }, 6000)
    return () => { stopped = true; clearInterval(timer) }
  }, [target.project, target.dev, busy, retryToken])

  useEffect(() => {
    const element = frameRef.current
    if (element === null || url === undefined) return
    const port = new CodexAnnotationPort(element, url, {
      send: (notes, pageUrl) => sendDirectly(notes, pageUrl),
      draft: notes => { persistDraft(sessionId, target, notes) },
      restore: () => restoreDraft(sessionId, target, url),

    })
    portRef.current = port
    const onLoad = (): void => { port.handshake() }
    element.addEventListener('load', onLoad)
    port.start()
    return () => {
      element.removeEventListener('load', onLoad)
      port.dispose()
      if (portRef.current === port) portRef.current = null
    }
  }, [url, revision, sessionId, target.project, target.dev])

  /** One click sends straight to the owning DSH Session; do not touch the composer. */
  const sendDirectly = async (notes: readonly CodexNote[], pageUrl: string): Promise<void> => {
    if (sendingRef.current || !target.project || !url) throw new Error('预览正在发送或已关闭')
    sendingRef.current = true
    setSending(true)
    setProblem('')
    try {
      await props.sendAnnotation(formatCodexPrompt(notes, pageUrl))
      // The DSH Host accepted this queued message. Remove only the exact batch;
      // an edit made during sending must remain available as an unsent draft.
      if (JSON.stringify(restoreDraft(sessionId, target, url)) === JSON.stringify(notes)) {
        persistDraft(sessionId, target, [])
      }
      setStatusNotice('批注已直接发送到 DSH，网页上对应的批注已清除。')
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      setProblem('发送失败，批注已保留：' + detail)
      throw error
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }

  const resolve = (): void => {
    const project = projectInput.trim()
    if (!project) {
      setProblem('请先填写要预览的项目绝对路径，例如 C:\\path\\to\\my-app')
      return
    }
    const dev = devInput.trim()
    const current = { project, ...(dev ? { dev } : {}) }
    setBusy(true)
    setUpstreamState('unknown')
    setProblem('')
    void props.openPreview(current).then(
      (next) => {
        const updated = { project: next.project, ...(next.dev === undefined ? {} : { dev: next.dev }) }
        setTarget(updated)
        setDevInput(next.dev ?? '')
        saveLastTarget(sessionId, updated)
        setUrl(next.url)
        setProblem('')
        setRevision(value => value + 1)
      },
      (error: unknown) => { setProblem(error instanceof Error ? error.message : String(error)) },
    ).finally(() => { setBusy(false) })
  }

  return <div style={root}>
    <div style={toolbar}>
      <span style={{ font: '600 12px/1.4 system-ui, sans-serif', color: '#2b3550' }}>ControlGUI</span>
      <span style={address} title={target.project || url}>{target.project || url || '未打开预览'}</span>
      <button type="button" style={button} disabled={busy} onClick={resolve}>
        {url === undefined ? '打开预览' : '重新解析'}
      </button>
      {url !== undefined && <button type="button" style={button} onClick={() => {
        if (upstreamState === 'offline') setRetryToken(value => value + 1)
        else setRevision(value => value + 1)
      }}>{upstreamState === 'offline' ? '重试连接' : '刷新'}</button>}
    </div>
    <div style={{ display: 'flex', gap: 5, padding: '5px 8px', background: '#fff', borderBottom: '1px solid #e2e6f0' }}>
      <input aria-label="项目绝对路径" placeholder="D:\\项目路径" value={projectInput}
        onChange={event => setProjectInput(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter') resolve() }}
        style={{ ...button, flex: '2 1 60%', minWidth: 0 }} />
      <input aria-label="本地前端地址（可选，留空自动发现）" placeholder="自动发现（也可填 localhost:5173）" value={devInput}
        onChange={event => setDevInput(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter') resolve() }}
        style={{ ...button, flex: '1 1 40%', minWidth: 0 }} />
    </div>
    {url === undefined
      ? <div style={empty}><div>
        <p>本页可预览指定项目并对页面元素批注。</p>
        <button type="button" style={button} disabled={busy} onClick={resolve}>打开项目预览</button>
      </div></div>
      : <iframe key={url + '#' + String(revision)} ref={frameRef} src={url} title="ControlGUI preview"
        style={frame} sandbox="allow-scripts allow-same-origin allow-forms" referrerPolicy="no-referrer" />}
    {upstreamState === 'offline' && url !== undefined && !sending && <div style={{ ...overlay, background: 'rgba(20, 31, 54, .65)' }}>
      <section style={{ ...reviewCard, textAlign: 'center' }} role="status" aria-live="polite">
        <h3 style={{ marginTop: 0 }}>预览连接已中断</h3>
        <p style={{ overflowWrap: 'anywhere' }}>{target.dev ? '开发服务器暂时无法访问：' + target.dev : 'ControlGUI 预览服务暂时不可用'}</p>
        <p>服务恢复后会自动刷新预览，已保存的批注草稿不会丢失。</p>
        <button type="button" style={button} onClick={() => setRetryToken(value => value + 1)}>立即重试</button>
      </section>
    </div>}
    {statusNotice !== '' && <div style={{ ...notice, background: '#eaf6ee', color: '#20683f', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }} role="status">
      <span>{statusNotice}</span>
      <button type="button" aria-label="关闭预览提示" onClick={() => setStatusNotice('')} style={{ border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 18 }}>×</button>
    </div>}
    {problem !== '' && <div style={{ ...notice, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }} role="alert">
      <span>{problem}</span>
      <button type="button" aria-label="关闭错误提示" onClick={() => setProblem('')} style={{ border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 18 }}>×</button>
    </div>}

  </div>
}
