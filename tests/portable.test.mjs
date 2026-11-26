import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, copyFileSync, cpSync, existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { runInNewContext } from 'node:vm'

const root = resolve(import.meta.dirname,'..')
const packageJson = JSON.parse(readFileSync(join(root,'package.json'),'utf8'))
const sleep = ms => new Promise(ok => setTimeout(ok,ms))
const availablePort = async () => new Promise((yes,no)=>{
  const s=createServer()
  s.on('error',no)
  s.listen(0,'127.0.0.1',()=>{
    const port=s.address().port
    s.close(()=>yes(port))
  })
})
const poll = async (tryOnce, timeout=8000) => {
  const start=Date.now()
  while(Date.now()-start<timeout){try {const out=await tryOnce(); if(out)return out} catch {} await sleep(100)}
  throw new Error('Timed out waiting for portable sidecar')
}

test('plugin exports a self-contained dual-face manifest and valid client bundle',()=>{
  assert.equal(packageJson.dsh.client.platform,'web')
  assert.equal(packageJson.name,'@local/dsh-codex-gui')
  assert.ok(existsSync(join(root,'src/index.ts')))
  assert.ok(existsSync(join(root,'src/server.ts')))
  assert.equal(packageJson.main,'./src/index.ts')
  const map=JSON.parse(readFileSync(join(root,'lib/client.js.map'),'utf8'))
  assert.equal(map.version,3)
  assert.ok(map.sources.length>0)
  const registrations=[]
  runInNewContext(readFileSync(join(root,'lib/client.js'),'utf8'),{
    window:{__ModuleLoader__:{load:rec=>registrations.push(rec)}},
  })
  assert.equal(registrations.length,1)
  assert.equal(registrations[0].id,packageJson.name)
  const mod=registrations[0].factory(name=>{
    if(name==='react')return {}
    if(name==='react/jsx-runtime')return {}
    if(name==='@deepseek-ai/dsh-client-ui-primitives')return {GuideArtworkBrowser:()=>null}
    throw new Error('Unexpected client external '+name)
  })
  assert.equal(typeof mod.apply,'function')
  assert.ok(Array.isArray(mod.inject))
})

test('copied TypeScript sources and browser bundle run as a local preview package',async()=>{
  const temp=mkdtempSync(join(tmpdir(),'dsh-portable-codex-'))
  let child
  try {
    mkdirSync(join(temp,'lib'))
    copyFileSync(join(root,'package.json'),join(temp,'package.json'))
    cpSync(join(root,'lib'),join(temp,'lib'),{recursive:true,force:true})
    cpSync(join(root,'src'),join(temp,'src'),{recursive:true,force:true})
    cpSync(join(root,'assets'),join(temp,'assets'),{recursive:true,force:true})
    const port=await availablePort()
    child=spawn(process.execPath,['--import','tsx/esm',join(temp,'src/server.ts')],{
      cwd:process.cwd(),windowsHide:true,stdio:'ignore',
      env:{...process.env,CODEX_PREVIEW_PORT:String(port),CONTROLGUI_WEB_PORT:'3080'},
    })
    const base=`http://127.0.0.1:${port}`
    await poll(async()=>{const r=await fetch(base+'/preview/');return r.ok})
    const statusDenied=await fetch(base+'/api/status?codex=1',{headers:{Origin:'http://not-dsh.invalid'}})
    assert.equal(statusDenied.status,403)
    const statusAllowed=await fetch(base+'/api/status?codex=1',{headers:{Origin:'http://127.0.0.1:3080'}})
    assert.equal(statusAllowed.status,200)
    assert.equal(statusAllowed.headers.get('access-control-allow-origin'),'http://127.0.0.1:3080')
    const status=await statusAllowed.json()
    assert.equal(status.healthy,true)
    assert.match(status.instanceId,/^[0-9a-f-]{36}$/u)
    const denied=await fetch(base+'/api/open?codex=1',{headers:{Origin:'http://not-dsh.invalid'}})
    assert.equal(denied.status,403)
    const project=resolve(root,'tests/fixtures/test-projects/04-snake-game')
    const api=new URL('/api/open',base)
    api.searchParams.set('codex','1')
    api.searchParams.set('project',project)
    const opened=await fetch(api,{headers:{Origin:'http://127.0.0.1:3080'}})
    assert.equal(opened.status,200)
    const result=await opened.json()
    assert.ok(result.url.includes('__dsh_gui=1'))
    const document=await(await fetch(result.url)).text()
    assert.match(document,/__dsh_gui__\/bridge\.js/u)
    const bridge=await(await fetch(new URL('/__dsh_gui__/bridge.js',result.url))).text()
    assert.match(bridge,/controlgui\.hello/u)
  }finally{
    if(child && child.exitCode===null){child.kill(); await sleep(350)}
    rmSync(temp,{recursive:true,force:true,maxRetries:4,retryDelay:200})
  }
})


test('host plugin effect starts and stops its sidecar on unload',async()=>{
  const port=await availablePort()
  const previous=process.env.CODEX_PREVIEW_PORT
  let dispose
  try{
    process.env.CODEX_PREVIEW_PORT=String(port)
    const {default:Plugin}=await import(pathToFileURL(join(root,'src/index.ts')).href)
    new Plugin({effect:fn=>{dispose=fn();return ()=>{}},inject:()=>{}})
    await poll(async()=>{const r=await fetch(`http://127.0.0.1:${port}/preview/`);return r.ok})
    assert.equal(typeof dispose,'function')
    dispose()
    await poll(async()=>{
      const server=createServer()
      try{await new Promise((ok,fail)=>server.once('error',fail).listen(port,'127.0.0.1',ok));return true}
      finally{if(server.listening) await new Promise(ok=>server.close(ok))}
    },7000)
  }finally{
    if(dispose)dispose()
    if(previous===undefined) delete process.env.CODEX_PREVIEW_PORT
    else process.env.CODEX_PREVIEW_PORT=previous
  }
})


test('Cordis sidecar restarts after a real child crash, but never after unload', {timeout: 18000}, async () => {
  const port = await availablePort()
  const previous = process.env.CODEX_PREVIEW_PORT
  let dispose
  let host
  try {
    process.env.CODEX_PREVIEW_PORT = String(port)
    const {default: Plugin} = await import(pathToFileURL(join(root, 'src/index.ts')).href)
    host = new Plugin({effect: fn => { dispose = fn(); return () => {} },inject:()=>{}})
    const first = host.child
    assert.ok(first?.pid, 'a real sidecar must have been spawned')
    await poll(async () => (await fetch(`http://127.0.0.1:${port}/preview/`)).ok, 7000)
    const before = await (await fetch(`http://127.0.0.1:${port}/api/status?codex=1`, {headers:{Origin:'http://127.0.0.1:3080'}})).json()
    first.kill()
    await poll(async () => {
      if (!host.child?.pid || host.child.pid === first.pid) return false
      return (await fetch(`http://127.0.0.1:${port}/preview/`)).ok
    }, 9000)
    assert.notEqual(host.child.pid, first.pid, 'unexpected exit should produce a new child PID')
    const after = await (await fetch(`http://127.0.0.1:${port}/api/status?codex=1`, {headers:{Origin:'http://127.0.0.1:3080'}})).json()
    assert.notEqual(after.instanceId,before.instanceId, 'browser should see the replacement sidecar ID')
    dispose()
    await poll(async () => {
      const s = createServer()
      try {await new Promise((ok, fail) => s.once('error',fail).listen(port,'127.0.0.1',ok));return true}
      finally {if(s.listening)await new Promise(ok => s.close(ok))}
    }, 6000)
    await sleep(1000) // Catch accidental post-dispose retry timers.
    assert.equal(host.child, undefined, 'unloaded plugin must not relaunch the sidecar')
  } finally {
    if (dispose) dispose()
    if (previous === undefined) delete process.env.CODEX_PREVIEW_PORT
    else process.env.CODEX_PREVIEW_PORT = previous
  }
})

test('Cordis sidecar retries an occupied preview port and recovers once released', {timeout: 17000}, async () => {
  const blocker = createServer()
  await new Promise((ok, fail) => blocker.once('error', fail).listen(0,'127.0.0.1',ok))
  const port = blocker.address().port
  const previous = process.env.CODEX_PREVIEW_PORT
  let dispose
  try {
    process.env.CODEX_PREVIEW_PORT = String(port)
    const {default: Plugin} = await import(pathToFileURL(join(root, 'src/index.ts')).href)
    const host = new Plugin({effect: fn => {dispose=fn();return () => {}},inject:()=>{}})
    const first = host.child
    await poll(() => first?.exitCode !== null && first?.exitCode !== undefined, 7000)
    await new Promise(ok => blocker.close(ok))
    await poll(async () => {
      if (!host.child?.pid || host.child.pid === first.pid) return false
      return (await fetch(`http://127.0.0.1:${port}/preview/`)).ok
    }, 8000)
    assert.notEqual(host.child.pid, first.pid)
  } finally {
    if (dispose) dispose()
    if (blocker.listening) await new Promise(ok => blocker.close(ok))
    if (previous === undefined) delete process.env.CODEX_PREVIEW_PORT
    else process.env.CODEX_PREVIEW_PORT = previous
  }
})


test('browser intent POST uses guarded IPC and current Session model, but rule-only requests cost no LLM call', {timeout: 16000}, async () => {
  const port = await availablePort()
  const before = process.env.CODEX_PREVIEW_PORT
  let dispose
  const modelCalls = []
  const origin = 'http://127.0.0.1:3080'
  try {
    process.env.CODEX_PREVIEW_PORT = String(port)
    const {default: Plugin} = await import(pathToFileURL(join(root,'src/index.ts')).href)
    new Plugin({
      effect: fn => {dispose = fn();return () => {}},
      inject: (names, use) => {
        // The Agent preview tool now mounts alongside the legacy Host intent judge.
        if (names.length === 1 && names[0] === 'tools') {
          use({
            tools: { register: definition => {
              assert.ok(['search_codex_gui_projects','open_codex_gui_preview'].includes(definition.name))
              return () => {}
            } },
            effect: fn => { fn(); return () => {} },
          })
          return
        }
        assert.deepEqual(names,['llm','agents'])
        use({
          agents:{get:id=>id==='known-session' ? {model:{current:()=>({provider:'mock-provider',model:'mock-model'})}}:undefined},
          llm:{stream:options=>{
            modelCalls.push(options)
            return (async function*(){yield {type:'text-delta',index:0,text:'OPEN'};yield {type:'finish',reason:{kind:'stop'}}})()
          }},
          effect:fn=>{fn();return () => {}},
        })
      },
    })
    const base=`http://127.0.0.1:${port}`
    await poll(async()=>{const response=await fetch(base+'/preview/');return response.ok},6000)
    const endpoint=base+'/api/intent?codex=1'
    const post=(prompt,sessionId='known-session',from=origin)=>fetch(endpoint,{
      method:'POST',headers:{Origin:from,'content-type':'application/json'},
      body:JSON.stringify({sessionId,prompt}),
    })
    const denied=await post('把项目放在右侧给我看','known-session','https://evil.example')
    assert.equal(denied.status,403)
    const preflight=await fetch(endpoint,{method:'OPTIONS',headers:{Origin:origin,'access-control-request-method':'POST','access-control-request-headers':'content-type'}})
    assert.equal(preflight.status,204)
    const direct=await post('请打开 Codex GUI，预览网页')
    assert.equal((await direct.json()).decision,'open')
    assert.equal(modelCalls.length,0)
    const ignored=await post('解释一下 Codex GUI 为什么打不开')
    assert.equal((await ignored.json()).decision,'ignore')
    assert.equal(modelCalls.length,0)
    const semantic=await post('请帮我把这个项目放到旁边显示出来')
    assert.equal((await semantic.json()).decision,'open')
    assert.equal(modelCalls.length,1)
    assert.equal(modelCalls[0].provider,'mock-provider')
    assert.equal(modelCalls[0].model,'mock-model')
    const unavailable=await post('请帮我把这个项目放到旁边显示出来','unknown-session')
    assert.equal((await unavailable.json()).decision,'unavailable')
    assert.equal(modelCalls.length,1)
  } finally {
    if (dispose) dispose()
    if (before === undefined) delete process.env.CODEX_PREVIEW_PORT
    else process.env.CODEX_PREVIEW_PORT = before
  }
})
