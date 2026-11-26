/**
 * Loopback-only preview resolver for the Codex-style annotation tab.
 *
 * Project pages are served by the shared preview manager, which injects the
 * Codex page runtime into every HTML response. Requests without `codex=1` are
 * refused so the older Browser auto-open flow cannot claim these previews.
 */
import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createProjectPreviewManager, parseDevUrl, probeDevServer } from './project-preview.ts'
import { previewIntentGate } from './intent-policy.ts'

const here = dirname(fileURLToPath(import.meta.url))
const runtimeFile = resolve(here, '..', 'assets', 'page-runtime.js')
const manager = createProjectPreviewManager(runtimeFile)
const instanceId = randomUUID() // Changes whenever the sidecar restarts.

const port = Number(process.env.CODEX_PREVIEW_PORT || '4377')
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid Codex preview port')
const webPort = process.env.CONTROLGUI_WEB_PORT || '3080'

const originAllowed = (origin: string | undefined): origin is string => {
  if (origin === undefined) return false
  try {
    const url = new URL(origin)
    return url.protocol === 'http:'
      && ['127.0.0.1', 'localhost'].includes(url.hostname)
      && url.port === webPort
      && url.pathname === '/'
  } catch {
    return false
  }
}

const json = (res: http.ServerResponse, status: number, body: unknown, origin?: string): void => {
  if (res.destroyed || res.writableEnded) return // Browser navigated away during async project resolution.
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...(origin === undefined ? {} : { 'access-control-allow-origin': origin, vary: 'Origin' }),
  })
  res.end(JSON.stringify(body))
}

/**
 * A workspace that resolves to DSH's own frontend build cannot run standalone:
 * its entry expects the host shell's `window.__ModuleLoader__` facade.
 * @param url - the resolved preview address.
 * @returns whether the served document is the DSH app shell.
 */
const looksLikeHostShell = async (url: string): Promise<boolean> => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3000) })
    if (!response.ok) return false
    const html = (await response.text()).slice(0, 20000)
    return html.includes('apple-mobile-web-app-title') && html.includes('content="DSH"')
  } catch {
    return false
  }
}

const helpHtml = [
  '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8">',
  '<meta name="viewport" content="width=device-width,initial-scale=1">',
  '<title>ControlGUI 预览</title><link rel="icon" href="data:,">',
  '<style>body{font-family:system-ui,"Microsoft YaHei",sans-serif;background:#f7f9fe;color:#26314b;margin:0;padding:45px 22px;line-height:1.8}',
  'main{max-width:700px;margin:0 auto;padding:28px 32px;border:1px solid #e0e6f2;border-radius:16px;background:#fff}',
  'h1{font-size:23px}p{font-size:14px;color:#66748e}',
  'blockquote{margin:20px 0;padding:14px 17px;background:#eef2ff;border-left:3px solid #2f6bff;border-radius:5px;font-size:14px}',
  'code{background:#f2f4fa;border-radius:4px;padding:3px 7px}</style></head><body><main>',
  '<h1>ControlGUI 预览</h1>',
  '<p>这是 Codex 式批注实现：页面内 Shadow DOM 覆盖层、原生 SVG 高亮和页面内批注编辑器。</p>',
  '<blockquote>在右侧打开 ControlGUI 标签页，或直接说「预览当前项目的前端页面」。</blockquote>',
  '<p>React / Vue / Vite 项目启动开发服务器后插件将尝试自动发现；未找到时可手动填写 <code>http://localhost:5173</code> 这类地址。</p>',
  '</main></body></html>',
].join('')

type IntentResult = 'open' | 'ignore' | 'unavailable'
const pendingIntent = new Map<string, (result: IntentResult) => void>()
process.on('message', packet => {
  if (!packet || typeof packet !== 'object' || !('type' in packet) || packet.type !== 'codex:intent:response') return
  const response = packet as { id?: unknown; decision?: unknown }
  if (typeof response.id !== 'string') return
  const settle = pendingIntent.get(response.id)
  if (!settle) return
  settle(response.decision === 'open' || response.decision === 'ignore' ? response.decision : 'unavailable')
})
function requestHostIntent(sessionId: string, prompt: string): Promise<IntentResult> {
  if (!process.send || !process.connected || pendingIntent.size >= 3) return Promise.resolve('unavailable')
  const id = randomUUID()
  return new Promise(resolve => {
    let finished = false
    const timer = setTimeout(() => settle('unavailable'), 9500)
    const settle = (decision: IntentResult): void => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      pendingIntent.delete(id)
      resolve(decision)
    }
    pendingIntent.set(id, settle)
    try {
      process.send?.({type:'codex:intent:request', id, sessionId, prompt}, error => {
        if (error) settle('unavailable')
      })
    } catch { settle('unavailable') }
  })
}

async function readIntentBody(req: http.IncomingMessage): Promise<{sessionId:string;prompt:string}> {
  const type = String(req.headers['content-type'] ?? '')
  if (!type.startsWith('application/json')) throw new Error('JSON body expected')
  let text = ''
  for await (const chunk of req) {
    text += String(chunk)
    if (text.length > 6000) throw new Error('Intent request too large')
  }
  const value: unknown = JSON.parse(text)
  if (!value || typeof value !== 'object' || !('sessionId' in value) || !('prompt' in value)
    || typeof value.sessionId !== 'string' || value.sessionId.length < 1 || value.sessionId.length > 150
    || typeof value.prompt !== 'string' || value.prompt.length < 1 || value.prompt.length > 4200) {
    throw new Error('Invalid intent request')
  }
  return {sessionId:value.sessionId, prompt:value.prompt}
}

const server = http.createServer(async (req, res) => {
  if (!['GET', 'HEAD', 'POST', 'OPTIONS'].includes(req.method ?? '')) {
    res.writeHead(405)
    res.end()
    return
  }
  let url: URL
  try {
    url = new URL(req.url ?? '/', 'http://127.0.0.1')
  } catch {
    res.writeHead(400)
    res.end()
    return
  }

  if (url.pathname === '/api/intent') {
    const origin = req.headers.origin
    if (!originAllowed(origin)) {json(res, 403, {error:'Local DSH Web only'});return}
    if (url.searchParams.get('codex') !== '1') {json(res,409,{error:'ControlGUI intent only'},origin);return}
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS',
        'access-control-allow-headers':'content-type','cache-control':'no-store','vary':'Origin'})
      res.end()
      return
    }
    if (req.method !== 'POST') {json(res,405,{error:'POST required'},origin);return}
    try {
      const {sessionId,prompt} = await readIntentBody(req)
      const gate = previewIntentGate(prompt)
      const decision: IntentResult = gate === 'judge' ? await requestHostIntent(sessionId,prompt) : gate
      json(res,200,{decision},origin)
    } catch(error) {json(res,400,{error:error instanceof Error?error.message:'Invalid request'},origin)}
    return
  }

  if (url.pathname === '/api/status') {
    const origin = req.headers.origin
    if (!originAllowed(origin)) {
      json(res, 403, { error: 'Local DSH Web only' })
      return
    }
    if (url.searchParams.get('codex') !== '1') {
      json(res, 409, { error: 'ControlGUI status only' }, origin)
      return
    }
    const rawDev = url.searchParams.get('dev')
    try {
      if (rawDev !== null) parseDevUrl(rawDev)
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : 'Invalid dev URL' }, origin)
      return
    }
    const upstreamHealthy = rawDev === null ? undefined : await probeDevServer(rawDev)
    json(res, 200, { healthy: true, instanceId,
      hostEpoch: process.env.CODEX_DSH_HOST_EPOCH || instanceId,
      ...(upstreamHealthy === undefined ? {} : { upstreamHealthy }) }, origin)
    return
  }

  if (url.pathname === '/api/open') {
    const origin = req.headers.origin
    if (!originAllowed(origin)) {
      json(res, 403, { error: 'ControlGUI preview opens only from local DSH Web' })
      return
    }
    if (url.searchParams.get('codex') !== '1') {
      json(res, 409, { error: 'This resolver is reserved for the ControlGUI tab' }, origin)
      return
    }
    try {
      const project = url.searchParams.get('project') ?? ''
      const dev = url.searchParams.get('dev') ?? undefined
      const result = await manager.open(project, dev)
      if (await looksLikeHostShell(result.url)) {
        json(res, 422, {
          error: '这个工作区解析到了 DSH 自身的前端构建（apps/web/dist），它不能独立打开。'
            + '请提供要预览的项目路径，或先启动该项目的开发服务器并在提示词里给出 http://localhost:<port> 地址。',
        }, origin)
        return
      }
      json(res, 200, result, origin)
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : 'Unable to preview project' }, origin)
    }
    return
  }

  if (url.pathname === '/preview/' || url.pathname === '/preview') {
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    })
    res.end(req.method === 'HEAD' ? undefined : helpHtml)
    return
  }

  res.writeHead(404)
  res.end('Not found')
})

// A browser can reset even the resolver's own TCP connection. The error
// belongs to that connection, not to the whole preview process.
server.on('connection', socket => {
  socket.on('error', error => {
    const code = 'code' in error ? String(error.code) : ''
    if (code !== 'ECONNRESET' && code !== 'EPIPE') console.warn('[codex-visual-preview] resolver socket error:', error)
    socket.destroy()
  })
})
server.on('clientError', (error, socket) => {
  const code = 'code' in error ? String(error.code) : ''
  if (code !== 'ECONNRESET' && code !== 'HPE_INVALID_EOF_STATE') {
    console.warn('[codex-visual-preview] invalid resolver connection:', code)
  }
  socket.destroy()
})

let stopping = false
const shutdown = (): void => {
  if (stopping) return
  stopping = true
  for (const settle of pendingIntent.values()) settle('unavailable')
  // IPC keeps Node alive even after an EADDRINUSE/other listener failure.
  // Closing it is required so the parent supervisor can observe 'close' and retry.
  if (process.connected) process.disconnect()
  server.close()
  server.closeAllConnections()
  void manager.close().catch(error => console.error('[codex-visual-preview] preview shutdown error:', error))
}
server.on('error', error => {
  console.error('[codex-visual-preview] resolver listener error:', error)
  process.exitCode = 1
  shutdown()
})
server.listen(port, '127.0.0.1', () => {
  console.log('[codex-visual-preview] resolver on http://127.0.0.1:' + String(port) + '/api/open')
})
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
