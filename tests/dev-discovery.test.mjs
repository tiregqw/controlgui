import test from 'node:test'
import assert from 'node:assert/strict'
import {matchingPorts,discoverDevServer,parseDevPort,windowsDevProcesses} from '../src/dev-discovery.ts'
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createProjectPreviewManager} from '../src/project-preview.ts'
import {spawn} from 'node:child_process'
import {createServer} from 'node:net'
const project = 'E:\\workspace\\my-app'
const vite = 'node.exe E:\\workspace\\my-app\\node_modules\\vite\\bin\\vite.js --host 127.0.0.1'
test('detect only process whose command refers to exact project',()=>{
  const ports=matchingPorts(project,[
    {port:5173,commandLine:vite},
    {port:3000,commandLine:'node E:\\workspace\\other-app\\node_modules\\vite\\bin\\vite.js'},
    {port:5174,commandLine:'node E:\\workspace\\my-app-old\\node_modules\\vite\\bin\\vite.js'},
    {port:8080,commandLine:'node E:\\workspace\\my-app\\node_modules\\random\\index.js'},
    {port:5173,commandLine:vite},
  ])
  assert.deepEqual(ports,[5173])
})
test('one live HTML dev server is selected',async()=>{
  assert.equal(await discoverDevServer(project,{rows:[{port:5173,commandLine:vite}],probe:async()=>true}),'http://127.0.0.1:5173/')
})
test('never choose offline or multiple matching server candidates',async()=>{
  assert.equal(await discoverDevServer(project,{rows:[{port:5173,commandLine:vite}],probe:async()=>false}),undefined)
  assert.equal(await discoverDevServer(project,{rows:[{port:5173,commandLine:vite},{port:5174,commandLine:vite}],probe:async()=>true}),undefined)
})

test('Windows finds a real listening server belonging to the exact project', {skip:process.platform!=='win32'}, async()=>{
  const root=mkdtempSync(join(tmpdir(),'codex-discovery-project-'))
  let child
  try {
    const path=join(root,'vite.js')
    writeFileSync(path,"require('http').createServer((req,res)=>{res.writeHead(200,{'content-type':'text/html'});res.end('<!doctype html><html><body>test</body></html>')}).listen(Number(process.argv[3]),'127.0.0.1')")
    const port=await new Promise((resolve,reject)=>{const server=createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port))})})
    child=spawn(process.execPath,[path,'--port',String(port)],{windowsHide:true,stdio:'ignore'})
    // Wait for the real Node child to finish binding before enumerating ports.
    let ready = false
    for (let attempt=0;attempt<45;attempt++) {
      try { const response=await fetch(`http://127.0.0.1:${port}/`);if(response.status===200){ready=true;break} }
      catch {}
      await new Promise(resolve=>setTimeout(resolve,120))
    }
    assert.equal(ready,true,'The fixture dev server did not start')
    const processes=await windowsDevProcesses()
    const relevant=processes.filter(item=>item.includes(root))
    assert.ok(relevant.length>0,'Windows did not report the project process')
    const detected=await discoverDevServer(root)
    assert.equal(detected,`http://127.0.0.1:${port}/`)
    const manager = createProjectPreviewManager(join(import.meta.dirname,'../assets/page-runtime.js'))
    try {
      const preview=await manager.open(root)
      assert.equal(preview.mode,'dev')
      assert.equal(preview.dev,`http://127.0.0.1:${port}/`)
      const html=await (await fetch(preview.url)).text()
      assert.match(html,/__dsh_gui__\/bridge\.js/)
    } finally { await manager.close() }
  } finally {
    if(child && child.exitCode===null){child.kill();await new Promise(resolve=>setTimeout(resolve,400))}
    rmSync(root,{recursive:true,force:true,maxRetries:4,retryDelay:180})
  }
})

test('parse dev server port options safely',()=>{
  assert.equal(parseDevPort('vite --port 5178'),5178)
  assert.equal(parseDevPort('next dev -p 3002'),3002)
  assert.equal(parseDevPort('vite --port=99999'),undefined)
})
