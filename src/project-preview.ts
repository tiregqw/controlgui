/** Loopback-only per-project HTML preview and dev-server proxy. No project scripts are executed. */
import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { AddressInfo } from 'node:net'
import type { Duplex } from 'node:stream'
import { configuredPreviewOrigin, discoverDevServer } from './dev-discovery.ts'
import { inspectHarmonyProject, renderArktsStructure } from './harmony-preview.ts'

type ProjectSite = { readonly mode: 'static' | 'dev' | 'setup' | 'harmony'; readonly root?: string; readonly url: string; readonly server: http.Server; readonly upgrades: Set<Duplex> }

/** Peer cancellation and dev-server restarts are ordinary proxy events. */
const logSocketError = (error: unknown): void => {
  const code = error instanceof Error && 'code' in error ? String(error.code) : ''
  if (['ECONNRESET', 'EPIPE', 'ECONNABORTED', 'ERR_STREAM_PREMATURE_CLOSE'].includes(code)) return
  console.warn('[codex-visual-preview] preview connection error:', error)
}
const mime: Record<string,string> = {'.html':'text/html','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json',
 '.png':'image/png','.jpg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.svg':'image/svg+xml','.ico':'image/x-icon',
 '.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.map':'application/json','.txt':'text/plain','.wasm':'application/wasm'}
const allowed = new Set(Object.keys(mime))
const skip = new Set(['.git','.env','.ssh','node_modules','.next','.nuxt','.output','.DS_Store','pnpm-lock.yaml','yarn.lock','package-lock.json'])
const head = (res:ServerResponse, status:number, type:string, extra:Record<string,string>={}) => res.writeHead(status, {
  'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff',
  'content-security-policy':"frame-ancestors 'self' http://127.0.0.1:* http://localhost:*",...extra,
})
const isInside = (root:string, path:string) => {const r=relative(root,path);return r==='' || (r!=='..'&&!r.startsWith('..'+sep)&&!isAbsolute(r))}
const previewHtml = (data:Buffer) => {
 const insertion = '<script defer src="/__dsh_gui__/bridge.js"></script>'
 const html=data.toString('utf8')
 return Buffer.from(/<\/head>/i.test(html)?html.replace(/<\/head>/i,insertion+'</head>'):insertion+html)
}
export function selectStaticRoot(project:string): string | undefined {
  // Never guess a nested app in a monorepo: use an explicit project path.
  const candidates = ['dist', 'build', 'out', '', 'public', 'web', 'frontend', 'client', 'app']
  for(const sub of candidates){
    const dir=resolve(project,sub)
    if(!isInside(project,dir) || !existsSync(join(dir,'index.html')))continue
    if(!statSync(join(dir,'index.html')).isFile())continue
    return realpathSync(dir)
  }
  return undefined
}
export function parseDevUrl(text: string | undefined): URL | undefined {
  if (!text) return undefined
  const url = new URL(text)
  if(url.protocol!=='http:' || !['localhost','127.0.0.1'].includes(url.hostname)
    || !url.port || url.username || url.password || url.pathname!=='/' || url.search || url.hash) throw new Error('Only local HTTP dev servers (host + port) are allowed')
  return new URL('http://127.0.0.1:'+url.port+'/')
}
/** Probe the selected localhost development server, independently of the preview sidecar. */
export async function probeDevServer(rawDevUrl: string): Promise<boolean> {
  const dev = parseDevUrl(rawDevUrl)
  if (dev === undefined) return false
  try {
    const response = await fetch(dev, {
      method: 'HEAD', redirect: 'manual', cache: 'no-store',
      signal: AbortSignal.timeout(2000),
    })
    if (response.ok) return true
    // Some ASGI routes expose GET but do not implement HEAD.
    if (response.status !== 405 && response.status !== 501) return false
    await response.body?.cancel()
    const fallback = await fetch(dev, {
      method: 'GET', redirect: 'manual', cache: 'no-store',
      signal: AbortSignal.timeout(2000),
    })
    const healthy = fallback.ok && String(fallback.headers.get('content-type')).includes('text/html')
    await fallback.body?.cancel()
    return healthy
  } catch { return false }
}

export function createProjectPreviewManager(bridgeFile:string) {
  const sites=new Map<string,ProjectSite>()
  const makeStaticHandler=(root:string) => (req:IncomingMessage,res:ServerResponse):void => {
    if(req.method!=='GET' && req.method!=='HEAD'){head(res,405,'text/plain');res.end();return}
    let pathname:string
    try {pathname=decodeURIComponent(new URL(req.url??'/','http://localhost').pathname)}catch {head(res,400,'text/plain');res.end();return}
    const pieces=pathname.split(/[\\/]/).filter(Boolean)
    if(pieces.some(x=>x.startsWith('.')||skip.has(x))){head(res,404,'text/plain');res.end();return}
    const asset=pathname==='/__dsh_gui__/bridge.js'
    if(asset){const data=readFileSync(bridgeFile);head(res,200,'text/javascript; charset=utf-8');res.end(req.method==='HEAD'?undefined:data);return}
    let file=resolve(root,'.'+(pathname==='/'?'/index.html':pathname))
    if(!isInside(root,file)){head(res,404,'text/plain');res.end();return}
    if(!existsSync(file) && !extname(file))file=resolve(root,'index.html')
    if(!existsSync(file) || !statSync(file).isFile()){head(res,404,'text/plain');res.end();return}
    file=realpathSync(file)
    const ext=extname(file).toLowerCase()
    if(!isInside(root,file)||!allowed.has(ext)){head(res,404,'text/plain');res.end();return}
    try {
      let data=readFileSync(file)
      if(ext==='.html')data=previewHtml(data)
      head(res,200,(mime[ext]??'application/octet-stream')+(ext==='.html'||ext==='.css'||ext==='.js'?'; charset=utf-8':''));res.end(req.method==='HEAD'?undefined:data)
    }catch{head(res,500,'text/plain');res.end()}
  }
  const makeDevHandler=(dev:URL) => {
    const handle=(req:IncomingMessage,res:ServerResponse):void => {
      if(!['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'].includes(req.method??'')){
        head(res,405,'text/plain');res.end();return
      }
      // Always pin the upstream host, even if the incoming URL begins with //other-host.
      let inbound:URL
      try{inbound=new URL(req.url??'/','http://127.0.0.1')}catch{head(res,400,'text/plain');res.end();return}
      if(inbound.pathname==='/__dsh_gui__/bridge.js'){
        if(req.method!=='GET'&&req.method!=='HEAD'){head(res,405,'text/plain');res.end();return}
        head(res,200,'text/javascript; charset=utf-8');res.end(req.method==='HEAD'?undefined:readFileSync(bridgeFile));return
      }
      const target=new URL(inbound.pathname+inbound.search,dev)
      const headers:Record<string,string|string[]|undefined>={...req.headers,host:dev.host,'accept-encoding':'identity'}
      const previewOrigin='http://'+String(req.headers.host??'')
      if(req.headers.origin===previewOrigin)headers.origin=dev.origin
      if(typeof req.headers.referer==='string'&&req.headers.referer.startsWith(previewOrigin+'/'))
        headers.referer=dev.origin+req.headers.referer.slice(previewOrigin.length)
      delete headers['proxy-connection']
      const proxyFailed = (message: string): void => {
        if (res.destroyed || res.writableEnded) return
        if (!res.headersSent) { head(res, 502, 'text/plain; charset=utf-8'); res.end(message) }
        else res.destroy()
      }
      const proxy=http.request(target,{method:req.method,headers,timeout:12000},upstream=>{
        // IncomingMessage can emit 'error' independently from ClientRequest.
        // Without this handler a reset from Vite crashes the entire sidecar.
        upstream.on('error',error=>{ logSocketError(error); proxyFailed('Dev server disconnected') })
        upstream.on('aborted',()=>proxyFailed('Dev server disconnected'))
        upstream.on('close',()=>{ if(!upstream.complete)proxyFailed('Dev server disconnected') })
        const type=String(upstream.headers['content-type']??'')
        const html=type.includes('text/html')
        const outgoing:Record<string,string>={}
        for(const [k,v] of Object.entries(upstream.headers)){
          if(v===undefined||['content-length','content-encoding','x-frame-options','content-security-policy','transfer-encoding','connection'].includes(k))continue
          outgoing[k]=Array.isArray(v)?v.join(', '):String(v)
        }
        outgoing['cache-control']='no-store'
        outgoing['content-security-policy']="frame-ancestors 'self' http://127.0.0.1:* http://localhost:*"
        if(!html){res.writeHead(upstream.statusCode??502,outgoing);upstream.pipe(res);return}
        const chunks:Buffer[]=[]
        let size=0
        upstream.on('data',chunk=>{
          const part=Buffer.from(chunk)
          size+=part.length
          if(size>12*1024*1024){upstream.destroy(new Error('HTML preview exceeds 12 MiB'));return}
          chunks.push(part)
        })
        upstream.on('end',()=>{
          if(res.destroyed || res.writableEnded)return
          const out=previewHtml(Buffer.concat(chunks))
          res.writeHead(upstream.statusCode??200,outgoing)
          res.end(req.method==='HEAD'?undefined:out)
        })
      })
      proxy.on('timeout',()=>proxy.destroy(new Error('Dev server timeout')))
      proxy.on('error',error=>{
        logSocketError(error)
        proxyFailed('Dev server unavailable. Start its development command and retry.')
      })
      req.on('aborted',()=>proxy.destroy())
      req.on('error',error=>{ logSocketError(error); proxy.destroy() })
      res.on('error',error=>{ logSocketError(error); proxy.destroy() })
      res.on('close',()=>{ if(!res.writableEnded)proxy.destroy() })
      req.pipe(proxy)
    }

    return handle
  }
  return {
    async open(rawProject:string, rawDevUrl?:string):Promise<{url:string;project:string;mode:'static'|'dev'|'setup'|'harmony';webRoot?:string;dev?:string}>{
      if(!rawProject||rawProject.length>2000||!isAbsolute(rawProject))throw new Error('An absolute existing workspace path is required')
      const project=realpathSync(resolve(rawProject))
      if(!statSync(project).isDirectory())throw new Error('The workspace must be a directory')
      const harmony = inspectHarmonyProject(project)
      // An ArkUI Stage app is not an HTML dev server. Never guess one from another project.
      const configured = rawDevUrl === undefined && !harmony ? configuredPreviewOrigin(project) : undefined
      if (configured && !await probeDevServer(configured)) throw new Error('项目配置的 Web 服务尚未启动：' + configured)
      const discovered = rawDevUrl === undefined && !configured && harmony?.kind !== 'arkui' ? await discoverDevServer(project) : undefined
      const dev=parseDevUrl(rawDevUrl ?? configured ?? discovered)
      const root=dev === undefined
        ? harmony?.kind === 'arkweb' ? harmony.webRoot : harmony ? undefined : selectStaticRoot(project)
        : undefined
      const native = harmony?.kind === 'arkui' && dev === undefined
      // A workspace without a built HTML entry gets a clear setup page, never an unrelated demo.
      const key=project+'\\0'+(dev?.href ?? root ?? (native ? 'harmony-arkui' : 'setup'))
      const prior=sites.get(key)
      if(prior?.server.listening)return {url:prior.url,project,mode:prior.mode,...dev?{dev:dev.href}:{},...prior.root?{webRoot:prior.root}:{}}
      if(prior)sites.delete(key)
      const setup=(req:IncomingMessage,res:ServerResponse):void=>{
        if(req.method!=='GET'&&req.method!=='HEAD'){head(res,405,'text/plain');res.end();return}
        const escaped=project.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')
        const html='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>DSH GUI Preview</title>'+
          '<style>body{font:15px system-ui;background:#f6f7fb;color:#28314a;padding:45px;line-height:1.7}main{max-width:680px;margin:auto;background:white;border:1px solid #e0e4f0;padding:32px;border-radius:18px}code{background:#eef1ff;padding:3px 6px;border-radius:5px}</style>'+
          '<main><h2>该项目尚无可直接显示的前端页面</h2><p>已定位 Session 工作区：</p><code>'+escaped+
          '</code><p>如果是 React/Vue/Vite/Next 项目，请让 DSH Agent 启动该项目的开发服务器，再明确告诉它预览地址，例如 <code>http://localhost:5173</code>。</p>'+
          '<p>例如：请启动这个项目的前端开发服务，并在 GUI 中预览 http://localhost:5173 。</p>'+
          '<p>如果是静态网站，请在项目目录放置 <code>index.html</code> 或构建到 <code>dist/</code>。</p></main></html>'
        head(res,200,'text/html; charset=utf-8')
        res.end(req.method==='HEAD'?undefined:html)
      }
      const nativeHandler = (req:IncomingMessage,res:ServerResponse):void => {
        if (req.method !== 'GET' && req.method !== 'HEAD') { head(res,405,'text/plain');res.end();return }
        const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
        // Re-scan on each request, so ordinary refresh picks up newly edited .ets files
        // and screenshots without restarting the sidecar.
        const currentHarmony = inspectHarmonyProject(project)
        if (!currentHarmony || currentHarmony.kind !== 'arkui') { head(res,409,'text/plain');res.end();return }
        if (pathname === '/__dsh_gui__/bridge.js') {
          head(res,200,'text/javascript; charset=utf-8')
          res.end(req.method === 'HEAD' ? undefined : readFileSync(bridgeFile));return
        }
        if (pathname === '/__dsh_gui__/harmony-shot.png' && currentHarmony.screenshot) {
          try {
            const data = readFileSync(currentHarmony.screenshot)
            if (data.length > 8 * 1024 * 1024) { head(res,413,'text/plain');res.end();return }
            head(res,200,'image/png')
            res.end(req.method === 'HEAD' ? undefined : data)
          } catch { head(res,404,'text/plain');res.end() }
          return
        }
        if (pathname !== '/') { head(res,404,'text/plain');res.end();return }
        const page = renderArktsStructure(project, currentHarmony)
        head(res,200,'text/html; charset=utf-8')
        res.end(req.method === 'HEAD' ? undefined : page)
      }
      const server=http.createServer(dev?makeDevHandler(dev):root?makeStaticHandler(root):native?nativeHandler:setup)
      // A peer may reset the TCP connection before or after HTTP/WebSocket upgrade.
      server.on('connection', socket=>socket.on('error',logSocketError))
      const upgrades=new Set<Duplex>()
      // Dev server WebSocket forwarding (Vite/Next HMR). Both halves must
      // handle errors, close and premature HTTP responses independently.
      if(dev)server.on('upgrade',(req,socket,headBytes)=>{
        upgrades.add(socket)
        let proxy:http.ClientRequest|undefined
        let upstream:Duplex|undefined
        let finished=false
        const cleanup=():void=>{
          if(finished)return
          finished=true
          upgrades.delete(socket)
          proxy?.destroy()
          upstream?.destroy()
          socket.destroy()
        }
        socket.on('error',error=>{logSocketError(error);cleanup()})
        socket.on('close',cleanup)
        try {
          const raw=new URL(req.url??'/','http://127.0.0.1')
          proxy=http.request(new URL(raw.pathname+raw.search,dev),{
            headers:{...req.headers,host:dev.host},method:'GET',timeout:12000,
          })
          proxy.on('upgrade',(response,upstreamSocket,upHead)=>{
            if(finished){upstreamSocket.destroy();return}
            upstream=upstreamSocket
            upstream.on('error',error=>{logSocketError(error);cleanup()})
            upstream.on('close',cleanup)
            try {
              socket.write('HTTP/1.1 101 Switching Protocols\r\n'+Object.entries(response.headers).map(([k,v])=>k+': '+v+'\r\n').join('')+'\r\n')
              if(headBytes.length)upstream.write(headBytes)
              if(upHead.length)socket.write(upHead)
              socket.pipe(upstream).pipe(socket)
            } catch(error) {logSocketError(error);cleanup()}
          })
          // A dev server can refuse the upgrade (e.g. 404) without emitting
          // the ClientRequest 'upgrade' event. Never leave the client hanging.
          proxy.on('response',response=>{
            response.on('error',error=>{logSocketError(error);cleanup()})
            response.resume()
            // Allow the 502 response to flush before closing the client socket.
            // Its 'close' event then releases the upstream request.
            if(!socket.destroyed)socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
            else cleanup()
          })
          proxy.on('timeout',()=>proxy?.destroy(new Error('WebSocket upstream timeout')))
          proxy.on('error',error=>{
            logSocketError(error)
            // Refused HMR connections should fail fast rather than hang in the browser.
            if (!finished && !upstream && !socket.destroyed) {
              socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
            } else cleanup()
          })
          proxy.end()
        } catch(error) {logSocketError(error);cleanup()}
      })
      await new Promise<void>((ok,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',()=>{server.off('error',fail);ok()})})
      const address=server.address() as AddressInfo
      const url='http://127.0.0.1:'+address.port+'/?__dsh_gui=1&workspace='+encodeURIComponent(project) + (native ? '&mode=harmony' : '')
      const site:ProjectSite={mode:dev?'dev':root?'static':native?'harmony':'setup',...root?{root}:{},url,server,upgrades}
      sites.set(key,site)
      return {url,project,mode:site.mode,...dev?{dev:dev.href}:{},...root?{webRoot:root}:{}}
    },
    close:async()=>{
      await Promise.all([...sites.values()].map(site=>new Promise<void>(ok=>{
        for (const socket of site.upgrades)socket.destroy()
        site.server.close(()=>ok())
        site.server.closeAllConnections() // does not include upgraded WebSockets
      })))
      sites.clear()
    },
  }
}
