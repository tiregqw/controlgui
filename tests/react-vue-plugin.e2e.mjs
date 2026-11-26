/**
 * Real Chromium + real React 18 / Vue 3 runtime smoke test of the injected GUI.
 * Also checks the dev-server POST/JSON proxy and source-file evidence in notes.
 * Run: node --import tsx/esm plugins/codex-visual-preview/tests/react-vue-plugin.e2e.mjs
 */
import http from 'node:http'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createProjectPreviewManager } from '../src/project-preview.ts'

const repo = resolve(process.env.DSH_CHECKOUT ?? process.cwd()) // DSH checkout is not the plugin's parent
const pluginRoot = resolve(import.meta.dirname, '..')
const clientRoot = resolve(repo, 'packages/client/ui-sidebar-browser/node_modules')
const chrome = process.env.CHROME_BIN ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const wait = ms => new Promise(ok => setTimeout(ok, ms))
const assert = (value, message) => { if (!value) throw new Error(message) }

const vueDist = (() => {
  const store = resolve(repo, 'node_modules/.pnpm')
  for (const entry of readdirSync(store)) {
    if (!entry.startsWith('vue@3.')) continue
    const file = resolve(store, entry, 'node_modules/vue/dist/vue.global.prod.js')
    if (existsSync(file)) return file
  }
  throw new Error('No Vue 3 runtime available in the local pnpm store')
})()

const frameworks = [
  { name: 'React', project: resolve(pluginRoot,'tests/fixtures/test-projects/05-react-codex'),
    frameworkFile: resolve(clientRoot,'react/umd/react.development.js'),
    extraFile: resolve(clientRoot,'react-dom/umd/react-dom.development.js'),
    expectedSource: 'src/ReactApp.tsx' },
  { name: 'Vue', project: resolve(pluginRoot,'tests/fixtures/test-projects/06-vue-codex'),
    frameworkFile: vueDist, extraFile: undefined, expectedSource: 'src/VueApp.vue' },
]

async function listen(server) {
  await new Promise((ok, fail) => server.once('error',fail).listen(0,'127.0.0.1',ok))
  return server.address().port
}
async function stop(server) { if (server.listening) await new Promise(ok=>server.close(ok)) }

function makeAppServer(item) {
  const logs = []
  const server = http.createServer(async (req,res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname
    if (path === '/api/save') {
      let body = ''
      for await (const chunk of req) body += String(chunk)
      logs.push({ method:req.method, body, origin:req.headers.origin })
      res.writeHead(200,{'content-type':'application/json'})
      res.end(JSON.stringify({saved:true,framework:item.name,method:req.method,body:JSON.parse(body)}))
      return
    }
    const asset = path === '/' ? resolve(item.project,'index.html')
      : path === '/framework.js' ? item.frameworkFile
      : path === '/react-dom.js' ? item.extraFile : undefined
    if (asset === undefined) { res.writeHead(404);res.end();return }
    res.writeHead(200,{'content-type':asset.endsWith('.html')?'text/html; charset=utf-8':'text/javascript; charset=utf-8'})
    res.end(readFileSync(asset))
  })
  return {server,logs}
}

async function randomPort() {const server=http.createServer();const port=await listen(server);await stop(server);return port}

async function main() {
  assert(existsSync(chrome), 'Chrome executable not found: '+chrome)
  const runtimeFile = resolve(pluginRoot,'assets/page-runtime.js')
  const manager=createProjectPreviewManager(runtimeFile)
  const apps=[]
  const dir=mkdtempSync(join(tmpdir(),'dsh-codex-e2e-'))
  let processChrome
  let socket
  try {
    for (const item of frameworks) {
      const app=makeAppServer(item)
      const port=await listen(app.server)
      apps.push(app.server)
      item.preview=await manager.open(item.project,'http://127.0.0.1:'+port+'/')
      item.logs=app.logs
    }
    const debugPort=await randomPort()
    processChrome=spawn(chrome,[
      '--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
      '--no-sandbox','--remote-allow-origins=*','--remote-debugging-port='+debugPort,
      '--user-data-dir='+join(dir,'chrome'),'about:blank',
    ],{stdio:'ignore',windowsHide:true})
    const target=await poll(async()=>{
      const response=await fetch('http://127.0.0.1:'+debugPort+'/json/list')
      const pages=await response.json()
      return pages.find(page=>page.type==='page'&&page.webSocketDebuggerUrl)
    },12000)
    socket=new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((ok,fail)=>{socket.onopen=ok;socket.onerror=fail})
    let nextId=0
    const pending=new Map()
    socket.onmessage=event=>{
      const data=JSON.parse(String(event.data))
      if(data.id === undefined)return
      const active=pending.get(data.id)
      if(!active)return
      pending.delete(data.id)
      if(data.error)active.reject(new Error(JSON.stringify(data.error)))
      else active.resolve(data.result)
    }
    const command=(method,params={})=>new Promise((resolve,reject)=>{
      const id=++nextId
      pending.set(id,{resolve,reject})
      socket.send(JSON.stringify({id,method,params}))
    })
    const evaluate=async(expression)=>{
      const result=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})
      if(result.exceptionDetails)throw new Error('Browser JS: '+JSON.stringify(result.exceptionDetails))
      return result.result?.value
    }
    await command('Page.enable')
    await command('Runtime.enable')
    for(const item of frameworks) {
      await command('Page.navigate',{url:item.preview.url})
      await poll(async()=>await evaluate("Boolean(document.querySelector('#inspect-target') && document.querySelector('[data-dsh-codex-gui=host]')?.shadowRoot)"),15000)
      const postResult=await evaluate(`fetch('/api/save',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({framework:${JSON.stringify(item.name)}})}).then(r=>r.json())`)
      assert(postResult?.saved && postResult.method==='POST',item.name+' dev proxy failed POST')
      assert(item.logs.length===1&&item.logs[0].body.includes(item.name),item.name+' dev backend did not receive POST body')
      const selected=await evaluate(`(() => {
        const root=document.querySelector('[data-dsh-codex-gui=host]').shadowRoot
        window.__codexSubmissions=[]
        window.addEventListener('message',e=>{if(e.data?.type==='codex.submit')window.__codexSubmissions.push(e.data)})
        window.postMessage({type:'controlgui.hello',nonce:'e2e-nonce-123456789'},location.origin)
        root.querySelector('.bar button').click()
        document.querySelector('#inspect-target').click()
        const input=root.querySelector('.editor textarea')
        input.value='Change button background'
        input.dispatchEvent(new Event('input',{bubbles:true}))
        root.querySelector('.editor .primary').click()
        const count=root.querySelector('.bar .count').textContent
        return {count,clicked:document.querySelector('#count').textContent}
      })()`)
      assert(selected.count.includes('1') && selected.clicked==='0',item.name+' annotation UI failed or click leaked to app')
      // A delegated card with pointer-events:none children must still allow
      // hovering/clicking the inner label. A native blue border must not double.
      const nested = await evaluate(`(() => {
        const card=document.createElement('div');card.id='__picker_card';
        card.style.cssText='position:fixed;left:12px;top:80px;width:260px;height:104px;z-index:999;border:4px solid rgb(47,107,255);background:white';
        const label=document.createElement('span');label.id='__picker_inner_label';
        label.textContent='Inner task label';label.style.cssText='pointer-events:none;display:inline-block;margin:24px 0 0 18px;padding:4px';
        card.appendChild(label);document.body.appendChild(card);
        const r=label.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};
      })()`)
      await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:nested.x,y:nested.y})
      await poll(async()=>await evaluate("document.querySelector('[data-dsh-codex-gui=host]').shadowRoot.querySelector('.tip span').textContent.includes('#__picker_inner_label')"),3000)
      await command('Input.dispatchMouseEvent',{type:'mousePressed',x:nested.x,y:nested.y,button:'left',clickCount:1})
      await command('Input.dispatchMouseEvent',{type:'mouseReleased',x:nested.x,y:nested.y,button:'left',clickCount:1})
      assert(await poll(async()=>await evaluate("document.querySelector('[data-dsh-codex-gui=host]').shadowRoot.querySelector('.editor header span').textContent.includes('#__picker_inner_label')"),3000),item.name+' cannot select nested pointer-events:none label')
      // Regression: clicking the outer card must not freeze selection at the
      // card level. A new draft may be refined to a child without losing text.
      await evaluate("(() => { const root=document.querySelector('[data-dsh-codex-gui=host]').shadowRoot;root.querySelector('.editor textarea').value='Keep my draft while selecting children' })()")
      await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:18,y:90})
      await command('Input.dispatchMouseEvent',{type:'mousePressed',x:18,y:90,button:'left',clickCount:1})
      await command('Input.dispatchMouseEvent',{type:'mouseReleased',x:18,y:90,button:'left',clickCount:1})
      assert(await poll(async()=>await evaluate("document.querySelector('[data-dsh-codex-gui=host]').shadowRoot.querySelector('.editor header span').textContent.includes('#__picker_card')"),3000),item.name+' could not select outer card during draft')
      await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:nested.x,y:nested.y})
      assert(await poll(async()=>await evaluate("document.querySelector('[data-dsh-codex-gui=host]').shadowRoot.querySelector('.tip span').textContent.includes('#__picker_inner_label')"),3000),item.name+' hovering inner label stayed locked on outer card')
      await command('Input.dispatchMouseEvent',{type:'mousePressed',x:nested.x,y:nested.y,button:'left',clickCount:1})
      await command('Input.dispatchMouseEvent',{type:'mouseReleased',x:nested.x,y:nested.y,button:'left',clickCount:1})
      assert(await poll(async()=>await evaluate("(() => {const root=document.querySelector('[data-dsh-codex-gui=host]').shadowRoot;return root.querySelector('.editor header span').textContent.includes('#__picker_inner_label') && root.querySelector('.editor textarea').value==='Keep my draft while selecting children'})()"),3000),item.name+' child retarget lost draft or selected wrong element')
      await evaluate("document.querySelector('[data-dsh-codex-gui=host]').shadowRoot.querySelector('.editor header button').click()")
      await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:18,y:90})
      assert(await poll(async()=>await evaluate("document.querySelector('[data-dsh-codex-gui=host]').shadowRoot.querySelector('.spot rect[stroke]').getAttribute('stroke')==='none'"),3000),item.name+' duplicate blue outline on card')
      // A component's blue box-shadow is also already an outline, even if
      // border/outline styles report none.
      await evaluate("(() => { const card=document.querySelector('#__picker_card');card.style.border='none';card.style.boxShadow='0 0 0 3px rgb(47, 107, 255)' })()")
      await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:nested.x,y:nested.y})
      await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:18,y:90})
      assert(await poll(async()=>await evaluate("document.querySelector('[data-dsh-codex-gui=host]').shadowRoot.querySelector('.spot rect[stroke]').getAttribute('stroke')==='none'"),3000),item.name+' duplicate blue box-shadow frame')
      await evaluate("(() => { const label=document.querySelector('#__picker_inner_label');const selection=getSelection();selection.removeAllRanges();const range=document.createRange();range.selectNodeContents(label);selection.addRange(range); })()")
      await command('Input.dispatchMouseEvent',{type:'mousePressed',x:18,y:90,button:'left',clickCount:1})
      assert(await evaluate("getSelection().rangeCount === 0"),item.name+' stale text selection was not cleared')
      await command('Input.dispatchMouseEvent',{type:'mouseReleased',x:18,y:90,button:'left',clickCount:1})
      await evaluate("document.querySelector('[data-dsh-codex-gui=host]').shadowRoot.querySelector('.editor header button').click()")
      await evaluate("document.querySelector('#__picker_card').remove()")
      await wait(150) // Allow the asynchronous postMessage nonce handshake to settle.
      await evaluate("document.querySelector('[data-dsh-codex-gui=host]').shadowRoot.querySelectorAll('.bar button')[1].click()")
      const packet=await poll(async()=>await evaluate('window.__codexSubmissions?.[0] ?? null'),3000)
      assert(packet?.notes?.length===1,item.name+' note packet missing')
      assert(packet.notes[0].element.sourceHint===item.expectedSource,item.name+' source hint mismatch: '+JSON.stringify(packet.notes[0].element))
      // The initial send was refused; the note remains editable for source-hint checks.
      await evaluate("window.postMessage({type:'codex.sent',nonce:'e2e-nonce-123456789',ok:false,reason:'mock offline'},location.origin)")
      await poll(async()=>await evaluate("!document.querySelector('[data-dsh-codex-gui=host]').shadowRoot.querySelectorAll('.bar button')[1].disabled"),3000)
      // Verify framework-specific source hints even without opt-in data attributes.
      const fallbackSource = item.name === 'React' ? 'src/ReactFiberFallback.tsx' : 'src/VueComponentFallback.vue'
      const debugKey = item.name === 'React'
        ? `button['__reactFiber$e2e']={_debugSource:{fileName:${JSON.stringify(fallbackSource)}},return:null}`
        : `button.__vueParentComponent={type:{__file:${JSON.stringify(fallbackSource)}}}`
      await evaluate(`(() => {
        const root=document.querySelector('[data-dsh-codex-gui=host]').shadowRoot
        root.querySelector('.pin').click()
        root.querySelector('.editor .danger').click()
        const button=document.querySelector('#inspect-target')
        button.removeAttribute('data-source-file')
        ${debugKey}
        window.__codexSubmissions=[]
        button.click()
        const input=root.querySelector('.editor textarea')
        input.value='Update component source'
        input.dispatchEvent(new Event('input',{bubbles:true}))
        root.querySelector('.editor .primary').click()
        root.querySelectorAll('.bar button')[1].click()
      })()`)
      const inferred=await poll(async()=>await evaluate('window.__codexSubmissions?.[0] ?? null'),3000)
      assert(inferred?.notes?.[0]?.element?.sourceHint===fallbackSource,item.name+' framework source fallback failed')
      // The fallback locator check is not a real send; release the pending send for later tests.
      await evaluate("window.postMessage({type:'codex.sent',nonce:'e2e-nonce-123456789',ok:false,reason:'mock offline'},location.origin)")
      await poll(async()=>await evaluate("!document.querySelector('[data-dsh-codex-gui=host]').shadowRoot.querySelectorAll('.bar button')[1].disabled"),3000)
      await evaluate(`(() => {
        const root=document.querySelector('[data-dsh-codex-gui=host]').shadowRoot
        root.querySelector('.bar button').click()
        document.querySelector('#inspect-target').click()
      })()`)
      await poll(async()=> (await evaluate("document.querySelector('#count')?.textContent"))==='1',3000)
      // Start a fresh annotation before replacing its DOM target.
      const editorOpened = await evaluate(`(() => {
        const root = document.querySelector('[data-dsh-codex-gui=host]').shadowRoot
        root.querySelector('.bar button').click()
        document.querySelector('#inspect-target').click()
        return root.querySelector('.editor').style.display === 'block'
      })()`)
      assert(editorOpened,item.name+' failed to open annotation editor for HMR test')
      // HMR-style node removal and replacement must not discard an in-progress note.
      const removed = await evaluate(`(() => {
        const root = document.querySelector('[data-dsh-codex-gui=host]').shadowRoot
        const input = root.querySelector('.editor textarea')
        input.value = 'Keep this unsaved note during HMR'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        const old = document.querySelector('#inspect-target')
        const parent = old.parentElement
        const next = old.cloneNode(true)
        next.textContent = 'HMR REPLACEMENT BUTTON'
        window.__hmrReplacement = { parent, next }
        old.remove()
        return !old.isConnected && !next.isConnected
      })()`)
      assert(removed,item.name+' simulated removal failed')
      const editingWhileMissing = await evaluate(`(() => {
        const root = document.querySelector('[data-dsh-codex-gui=host]').shadowRoot
        return root.querySelector('.editor').style.display === 'block' &&
          root.querySelector('.editor textarea').value === 'Keep this unsaved note during HMR'
      })()`)
      assert(editingWhileMissing,item.name+' HMR removal discarded the unsaved note')
      await evaluate(`(() => {
        const { parent, next } = window.__hmrReplacement
        parent.appendChild(next)
      })()`)
      await poll(async()=> await evaluate(`(() => {
        const root = document.querySelector('[data-dsh-codex-gui=host]').shadowRoot
        return root.querySelector('.editor').style.display === 'block' &&
          root.querySelector('.editor textarea').value === 'Keep this unsaved note during HMR'
      })()`),3000)
      const recoveredNote = await evaluate(`(() => {
        const root = document.querySelector('[data-dsh-codex-gui=host]').shadowRoot
        root.querySelector('.editor .primary').click()
        return {
          count: root.querySelector('.bar .count').textContent,
          pinCount: root.querySelectorAll('.pin').length,
        }
      })()`)
      assert(recoveredNote.count.includes('2'),item.name+' did not save draft to replacement node')
      // The next replacement must still be captured by document-level delegation.
      const delegated = await evaluate(`(() => {
        const root = document.querySelector('[data-dsh-codex-gui=host]').shadowRoot
        const old = document.querySelector('#inspect-target')
        const next = old.cloneNode(true)
        old.replaceWith(next)
        next.click()
        return !old.isConnected && next.isConnected && root.querySelector('.editor').style.display === 'block'
      })()`)
      assert(delegated,item.name+' delegated click listener failed after HMR replacement')
      await evaluate("document.querySelector('[data-dsh-codex-gui=host]').shadowRoot.querySelector('.editor header button').click()")
      // Regression: SPA navigation with the same DOM elements must not reuse another page's notes.
      const beforeRoute = await evaluate('location.href')
      await evaluate("history.pushState({}, '', '/__codex_other_route__' + location.search + location.hash)")
      await poll(async () => await evaluate(`Array.from(document.querySelector('[data-dsh-codex-gui=host]').shadowRoot.querySelectorAll('.pin')).every(pin => pin.style.display === 'none')`), 3000)
      await evaluate('history.pushState({}, "", ' + JSON.stringify(beforeRoute) + ')')
      await poll(async () => await evaluate(`Array.from(document.querySelector('[data-dsh-codex-gui=host]').shadowRoot.querySelectorAll('.pin')).some(pin => pin.style.display === 'grid')`), 3000)
      // One click sends directly. There is no composer insertion or confirmation dialog.
      await evaluate(`(() => {
        window.__codexSubmissions = []
        document.querySelector('[data-dsh-codex-gui=host]').shadowRoot.querySelectorAll('.bar button')[1].click()
      })()`)
      await poll(async () => await evaluate('window.__codexSubmissions?.[0]?.notes?.length === 2'), 3000)
      assert(await evaluate(`(() => {
        const root=document.querySelector('[data-dsh-codex-gui=host]').shadowRoot
        return root.querySelector('.bar .count').textContent.includes('2')
          && root.querySelectorAll('.bar button')[1].disabled
          && root.querySelectorAll('.bar button')[1].textContent.includes('发送中')
      })()`), item.name+' notes were not preserved while sending')
      // DSH refused admission: the notes must remain, including after an iframe refresh restore.
      await evaluate("window.postMessage({type:'codex.sent',nonce:'e2e-nonce-123456789',ok:false,reason:'mock rejection'},location.origin)")
      await poll(async () => await evaluate(`(() => {
        const root=document.querySelector('[data-dsh-codex-gui=host]').shadowRoot
        return root.querySelector('.bar .count').textContent.includes('2')
          && !root.querySelectorAll('.bar button')[1].disabled
          && root.querySelector('.bar .status').textContent.includes('发送失败')
      })()`), 3000)
      await evaluate("window.postMessage({type:'codex.restore',nonce:'e2e-nonce-123456789',notes:window.__codexSubmissions[0].notes},location.origin)")
      assert(await evaluate(`(() => {
        const root=document.querySelector('[data-dsh-codex-gui=host]').shadowRoot
        return root.querySelectorAll('.pin').length === 2 && root.querySelectorAll('.bar button')[1].textContent.includes('发送给 Agent')
      })()`), item.name+' refresh lost unsent annotations')
      // Retry; a mismatched response must not erase newer annotations.
      await evaluate("document.querySelector('[data-dsh-codex-gui=host]').shadowRoot.querySelectorAll('.bar button')[1].click()")
      await poll(async () => await evaluate('window.__codexSubmissions?.length === 2'), 3000)
      await evaluate("window.postMessage({type:'codex.sent',nonce:'e2e-nonce-123456789',ok:true,notes:window.__codexSubmissions[1].notes.slice(0,1)},location.origin)")
      assert(await evaluate("document.querySelector('[data-dsh-codex-gui=host]').shadowRoot.querySelector('.bar .count').textContent.includes('2')"),item.name+' wrong batch was cleared')
      // Retry again and simulate a successful DSH Host admission for this exact batch.
      await evaluate("document.querySelector('[data-dsh-codex-gui=host]').shadowRoot.querySelectorAll('.bar button')[1].click()")
      await poll(async () => await evaluate('window.__codexSubmissions?.length === 3'), 3000)
      await evaluate("window.postMessage({type:'codex.sent',nonce:'e2e-nonce-123456789',ok:true,notes:window.__codexSubmissions[2].notes},location.origin)")
      await poll(async () => await evaluate(`(() => {
        const root=document.querySelector('[data-dsh-codex-gui=host]').shadowRoot
        return root.querySelector('.bar .count').textContent.includes('0')
          && root.querySelectorAll('.pin').length === 0
          && root.querySelectorAll('.bar button')[2].style.display === 'none'
      })()`), 3000)
      await evaluate("window.postMessage({type:'codex.restore',nonce:'e2e-nonce-123456789',notes:[]},location.origin)")
      assert(await evaluate("document.querySelector('[data-dsh-codex-gui=host]').shadowRoot.querySelector('.bar .count').textContent.includes('0')"),item.name+' delivered notes came back')
      // Full Vite reload replaces document itself: the HTML injection must reinstall delegation.
      await command('Page.reload', { ignoreCache: true })
      await poll(async()=> await evaluate("Boolean(document.querySelector('#inspect-target') && document.querySelector('[data-dsh-codex-gui=host]')?.shadowRoot)"),15000)
      const reloaded = await evaluate(`(() => {
        const root = document.querySelector('[data-dsh-codex-gui=host]').shadowRoot
        root.querySelector('.bar button').click()
        document.querySelector('#inspect-target').click()
        return root.querySelector('.editor').style.display === 'block'
      })()`)
      assert(reloaded,item.name+' full reload failed to re-inject event delegation')
      console.log('[PASS]',item.name,'runtime, annotations, HMR DOM replacement and full-reload injection')
    }
    console.log('[PASS] Real Chromium React+Vue E2E complete')
  } finally {
    if(socket)socket.close()
    if(processChrome){ processChrome.kill(); await wait(300) }
    await manager.close()
    await Promise.all(apps.map(stop))
    try{rmSync(dir,{recursive:true,force:true})}catch{}
  }
}

async function poll(attempt,timeout) {
  const started=Date.now()
  let lastError
  while(Date.now()-started<timeout) {
    try{const value=await attempt();if(value)return value}catch(error){lastError=error}
    await wait(120)
  }
  throw new Error('Timed out after '+timeout+'ms'+(lastError?': '+String(lastError):''))
}

main().catch(error=>{console.error(error);process.exitCode=1})
