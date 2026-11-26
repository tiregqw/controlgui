/**
 * Real Chrome end-to-end check of HarmonyOS ArkTS structure selection.
 * Never requires DevEco or executes an .ets file.
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import { createProjectPreviewManager } from '../src/project-preview.ts'

const root=resolve(import.meta.dirname,'..')
const bridge=join(root,'assets','page-runtime.js')
const chrome=process.env.CHROME_BIN ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const assert=(condition,text)=>{if(!condition)throw new Error(text)}
const wait=ms=>new Promise(ok=>setTimeout(ok,ms))
const poll=async fn=>{
  const start=Date.now()
  while(Date.now()-start<12000){try{const value=await fn();if(value)return value}catch{}await wait(130)}
  throw new Error('Timed out waiting for Chrome or ArkTS annotation')
}
const availablePort=()=>new Promise((resolve,reject)=>{
  const server=createServer()
  server.on('error',reject)
  server.listen(0,'127.0.0.1',()=>{
    const port=server.address().port
    server.close(()=>resolve(port))
  })
})
const dir=mkdtempSync(join(tmpdir(),'controlgui-harmony-browser-'))
const project=join(dir,'StageDemo')
mkdirSync(join(project,'entry','src','main','ets','pages'),{recursive:true})
writeFileSync(join(project,'build-profile.json5'),'{}')
writeFileSync(join(project,'entry','src','main','module.json5'),'{}')
writeFileSync(join(project,'entry','src','main','ets','pages','Index.ets'),
  "@Entry\n@Component\nstruct Index {\n build() {\n  Column() {\n    Text('hello ArkTS')\n    Button('click')\n  }\n }\n}\n")
const manager=createProjectPreviewManager(bridge)
let child
let ws
try {
  const preview=await manager.open(project)
  assert(preview.mode==='harmony','unexpected preview mode')
  const port=await availablePort()
  child=spawn(chrome,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
    '--no-sandbox','--remote-allow-origins=*','--remote-debugging-port='+port,
    '--user-data-dir='+join(dir,'browser'),'about:blank'],{stdio:'ignore',windowsHide:true})
  const page=await poll(async()=>{
    const response=await fetch('http://127.0.0.1:'+port+'/json/list')
    const tabs=await response.json()
    return tabs.find(tab=>tab.type==='page'&&tab.webSocketDebuggerUrl)
  })
  ws=new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject})
  let next=0
  const waiting=new Map()
  ws.onmessage=event=>{
    const value=JSON.parse(String(event.data))
    const current=waiting.get(value.id)
    if(!current)return
    waiting.delete(value.id)
    if(value.error)current.reject(Error(JSON.stringify(value.error)))
    else current.resolve(value.result)
  }
  const command=(method,params={})=>new Promise((resolve,reject)=>{
    const id=++next
    waiting.set(id,{resolve,reject})
    ws.send(JSON.stringify({id,method,params}))
  })
  const evaluate=async expression=>{
    const result=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})
    if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails))
    return result.result?.value
  }
  await command('Page.enable')
  await command('Runtime.enable')
  await command('Page.navigate',{url:preview.url})
  await poll(async()=>evaluate("Boolean(document.querySelector('.component') && document.querySelector('[data-dsh-codex-gui=host]')?.shadowRoot)"))
  await evaluate(`(() => {
    const root=document.querySelector('[data-dsh-codex-gui=host]').shadowRoot
    window.__harmonyNotes=[]
    addEventListener('message', event=>{if(event.data?.type==='codex.submit')window.__harmonyNotes.push(event.data)})
    postMessage({type:'controlgui.hello',nonce:'e2e-harmony-123456789'},location.origin)
    root.querySelector('.bar button').click()
    document.querySelector('[data-source-file$="Index.ets:7"]').click()
    const text=root.querySelector('.editor textarea')
    text.value='Make this ArkTS button wider'
    text.dispatchEvent(new Event('input',{bubbles:true}))
    root.querySelector('.editor .primary').click()
  })()`)
  await poll(async()=>evaluate("document.querySelector('[data-dsh-codex-gui=host]').shadowRoot.querySelector('.count').textContent.includes('1')"))
  await evaluate("document.querySelector('[data-dsh-codex-gui=host]').shadowRoot.querySelectorAll('.bar button')[1].click()")
  const note=await poll(async()=>evaluate('window.__harmonyNotes[0]?.notes?.[0]'))
  assert(note.comment==='Make this ArkTS button wider','lost user annotation')
  assert(note.element.sourceHint==='entry/src/main/ets/pages/Index.ets:7',
    'wrong ArkTS component source hint '+note.element.sourceHint)
  assert(new URL(preview.url).searchParams.get('mode')==='harmony','missing Harmony mode marker')
  console.log('[PASS] Real Chromium HarmonyOS ArkTS source-structure annotation + file/line location')
} finally {
  if(ws) ws.close()
  if(child){child.kill();await wait(250)}
  await manager.close()
  rmSync(dir,{recursive:true,force:true})
}
