import test from 'node:test'
import assert from 'node:assert/strict'
import { discardRestoredCodexGuiTabs } from '../src/client/startup-tabs.ts'

function store(initial) {
  let value=initial
  const listeners=new Set()
  return {
    getSnapshot:()=>value,
    subscribe(listener){listeners.add(listener);return ()=>listeners.delete(listener)},
    set(next){value=next;for(const listener of [...listeners])listener()},
  }
}
function fixture(saved, liveBySession) {
  const openTabs=store([...saved])
  const mounted=store(undefined)
  const live=new Map(Object.entries(liveBySession))
  const closed=[]
  const sidebar={
    openTabs,mounted,
    tabsIn:sessionId=>live.get(sessionId)??[],
    closeIn(sessionId,tabId) {
      closed.push({sessionId,tabId})
      live.set(sessionId,(live.get(sessionId)??[]).filter(x=>x.id!==tabId))
      // Mirror the real right Sidebar: commit synchronously republishes inventory.
      openTabs.set(openTabs.getSnapshot().filter(x=>!(x.sessionId===sessionId&&x.tabId===tabId)))
    },
  }
  return {sidebar,openTabs,mounted,live,closed}
}
const tab=(sessionId,tabId,kind='codex-gui')=>({sessionId,tabId,kind})
const live=(id,kind='codex-gui')=>({id,kind})

test('boot cleanup closes only Codex GUI tabs restored from localStorage',()=>{
  const f=fixture([
    tab('s1','tab1'),tab('s1','tab2'),tab('s1','tab3','files'),
  ],{s1:[live('tab1'),live('tab2'),live('tab3','files')]})
  const stop=discardRestoredCodexGuiTabs(f.sidebar)
  assert.deepEqual(f.closed.map(x=>x.tabId),['tab1','tab2'])
  assert.deepEqual(f.live.get('s1'),[live('tab3','files')])
  stop()
})
test('background Session gets scrubbed only when later adopted; new tabs survive',()=>{
  const f=fixture([tab('bg','tab4')],{})
  const stop=discardRestoredCodexGuiTabs(f.sidebar)
  assert.deepEqual(f.closed,[])
  f.live.set('bg',[live('tab4'),live('tab5')])
  f.openTabs.set([...f.openTabs.getSnapshot(),tab('bg','tab5')])
  f.mounted.set('bg')
  assert.deepEqual(f.closed.map(x=>x.tabId),['tab4'])
  assert.deepEqual(f.live.get('bg'),[live('tab5')])
  stop()
})
test('once cleaned, explicit previews created later never auto-close',()=>{
  const f=fixture([tab('s1','tab1')],{s1:[live('tab1')]})
  const stop=discardRestoredCodexGuiTabs(f.sidebar)
  assert.equal(f.closed.length,1)
  f.live.set('s1',[live('tab2')])
  f.openTabs.set([tab('s1','tab2')])
  f.mounted.set('s1')
  assert.deepEqual(f.closed.map(x=>x.tabId),['tab1'])
  stop()
})
test('empty startup history never closes a tab opened after boot',()=>{
  const f=fixture([],{})
  const stop=discardRestoredCodexGuiTabs(f.sidebar)
  f.live.set('s1',[live('tab1')])
  f.openTabs.set([tab('s1','tab1')])
  assert.deepEqual(f.closed,[])
  stop()
})

test('startup captures persisted tabs even if Sidebar inventory has not yet published',()=>{
  const f=fixture([],{})
  const oldStorage=globalThis.localStorage
  globalThis.localStorage={
    length:1,
    key:i=>i===0?'dsh.sidebar-right.v1.s1':null,
    getItem:k=>k==='dsh.sidebar-right.v1.s1'?JSON.stringify({
      bySession:{s1:{layout:{tabs:{tab10:{kind:'codex-gui'},tab11:{kind:'files'}}}}}
    }):null,
  }
  try {
    const stop=discardRestoredCodexGuiTabs(f.sidebar)
    f.live.set('s1',[live('tab10'),live('tab11','files')])
    f.mounted.set('s1')
    assert.deepEqual(f.closed.map(x=>x.tabId),['tab10'])
    assert.deepEqual(f.live.get('s1'),[live('tab11','files')])
    stop()
  } finally {
    if(oldStorage===undefined) delete globalThis.localStorage
    else globalThis.localStorage=oldStorage
  }
})


test('late store adoption after mounted notification is retried without requiring inventory change',async()=>{
  const f=fixture([tab('s1','tab1')],{})
  f.mounted.set('s1')
  const stop=discardRestoredCodexGuiTabs(f.sidebar)
  setTimeout(()=>f.live.set('s1',[live('tab1')]),75)
  await new Promise(done=>setTimeout(done,230))
  assert.deepEqual(f.closed.map(x=>x.tabId),['tab1'])
  stop()
})

test('unsubscribing cleanup leaves pending restores untouched',()=>{
  const f=fixture([tab('s1','tab1')],{})
  const stop=discardRestoredCodexGuiTabs(f.sidebar)
  stop()
  f.live.set('s1',[live('tab1')])
  f.openTabs.set([tab('s1','tab1')])
  f.mounted.set('s1')
  assert.deepEqual(f.closed,[])
})
