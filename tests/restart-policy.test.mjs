import test from 'node:test'
import assert from 'node:assert/strict'
import { decideCodexRestore, restoreCodexTabsOnlyOnDshRestart,
  CODEX_HOST_EPOCH_SESSION_KEY } from '../src/client/restart-policy.ts'

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const storage = saved => {
  const map=new Map()
  if(saved!==undefined) map.set(CODEX_HOST_EPOCH_SESSION_KEY,saved)
  return {getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)}
}
function sidebarWithSavedTab() {
  const tabs=[{sessionId:'s1',tabId:'tab1',kind:'codex-gui'}]
  const changes=new Set()
  const mounted={getSnapshot:()=> 's1', subscribe:cb=>{changes.add(cb);return ()=>changes.delete(cb)}}
  const inventory={getSnapshot:()=>tabs,subscribe:cb=>{changes.add(cb);return ()=>changes.delete(cb)}}
  const closed=[]
  const sidebar={
    mounted,openTabs:inventory,
    tabsIn:()=>tabs.map(x=>({id:x.tabId,kind:x.kind})),
    closeIn:(sessionId,tabId)=>{closed.push({sessionId,tabId});const i=tabs.findIndex(t=>t.tabId===tabId);if(i>=0)tabs.splice(i,1)}
  }
  return {sidebar,closed,tabs}
}
test('same DSH host epoch after page refresh retains Codex GUI tabs',async()=>{
  const f=sidebarWithSavedTab()
  const s=storage('same-epoch')
  const stop=restoreCodexTabsOnlyOnDshRestart(f.sidebar,{
    storage:s,getHostEpoch:async()=> 'same-epoch'
  })
  await sleep(30)
  assert.equal(s.getItem(CODEX_HOST_EPOCH_SESSION_KEY),'same-epoch')
  assert.deepEqual(f.closed,[])
  assert.equal(f.tabs.length,1)
  stop()
})
test('a real DSH host epoch change clears only old Codex GUI tabs',async()=>{
  const f=sidebarWithSavedTab()
  const s=storage('old-epoch')
  const stop=restoreCodexTabsOnlyOnDshRestart(f.sidebar,{
    storage:s,getHostEpoch:async()=> 'new-epoch'
  })
  await sleep(30)
  assert.deepEqual(f.closed,[{sessionId:'s1',tabId:'tab1'}])
  assert.equal(s.getItem(CODEX_HOST_EPOCH_SESSION_KEY),'new-epoch')
  stop()
})
test('first launch without an observed host epoch does not resurrect previous previews',async()=>{
  const f=sidebarWithSavedTab()
  const s=storage()
  const stop=restoreCodexTabsOnlyOnDshRestart(f.sidebar,{
    storage:s,getHostEpoch:async()=> 'first-epoch'
  })
  await sleep(30)
  assert.equal(f.closed.length,1)
  stop()
})
test('sidecar fetch unavailable keeps layouts and does not corrupt epoch marker',async()=>{
  const f=sidebarWithSavedTab()
  const s=storage('epoch-one')
  const stop=restoreCodexTabsOnlyOnDshRestart(f.sidebar,{
    storage:s,getHostEpoch:async()=>{throw Error('offline')}
  })
  await sleep(30)
  assert.deepEqual(f.closed,[])
  assert.equal(s.getItem(CODEX_HOST_EPOCH_SESSION_KEY),'epoch-one')
  stop()
})
test('unmount before epoch request resolves does not close any tab',async()=>{
  const f=sidebarWithSavedTab()
  const s=storage('old')
  let resolve
  const promise=new Promise(done=>{resolve=done})
  const stop=restoreCodexTabsOnlyOnDshRestart(f.sidebar,{
    storage:s,getHostEpoch:()=>promise
  })
  stop()
  resolve('new')
  await sleep(15)
  assert.deepEqual(f.closed,[])
  assert.equal(s.getItem(CODEX_HOST_EPOCH_SESSION_KEY),'old')
})
test('pure refresh/restart policy requires exact epoch match',()=>{
  assert.equal(decideCodexRestore('abc','abc'),'retain')
  assert.equal(decideCodexRestore('abc','xyz'),'discard')
  assert.equal(decideCodexRestore(null,'xyz'),'discard')
})
