import test from 'node:test'
import assert from 'node:assert/strict'
import { CodexAnnotationPort } from '../src/client/provider.ts'

const preview = 'http://127.0.0.1:4377/preview?__dsh_gui=1&workspace=D%3A%5Cproject'
const note = {
  comment: 'Make this button green',
  element: {tag:'button',selector:'#inspect-target',text:'Save',html:'<button>Save</button>',
    page:'/index',sourceHint:'src/App.vue:7'},
}
const tick=()=>new Promise(resolve=>setImmediate(resolve))

function setup(send) {
  const previousWindow=globalThis.window
  const listeners=new Map()
  const messages=[]
  const frame={postMessage:(packet,origin)=>messages.push({packet,origin})}
  globalThis.window={
    addEventListener:(name,fn)=>listeners.set(name,fn),
    removeEventListener:(name)=>listeners.delete(name),
  }
  const iframe={contentWindow:frame}
  let notes=[note]
  const sink={
    send,
    draft:(next)=>{ notes=[...next] },
    restore:()=>notes,
  }
  const port=new CodexAnnotationPort(iframe,preview,sink)
  port.start()
  const nonce=messages[0].packet.nonce
  const emit=(packet,origin=new URL(preview).origin)=>listeners.get('message')?.({
    source:frame,origin,data:{nonce,...packet},
  })
  emit({type:'codex.ready'})
  return {
    emit,
    nonce,
    messages,
    get draft(){return notes},
    dispose:()=>{port.dispose();globalThis.window=previousWindow},
  }
}

test('direct send waits for Host acceptance and ignores duplicate clicks',async()=>{
  let resolveAdmission
  const pending=new Promise(resolve=>{resolveAdmission=resolve})
  let calls=0
  const h=setup((notes,url)=>{calls++;assert.equal(url,preview);assert.equal(notes.length,1);return pending})
  try {
    h.emit({type:'codex.submit',url:preview,notes:[note]})
    h.emit({type:'codex.submit',url:preview,notes:[note]})
    assert.equal(calls,1)
    assert.equal(h.messages.filter(x=>x.packet.type==='codex.sent').length,0)
    resolveAdmission()
    await tick()
    const sent=h.messages.find(x=>x.packet.type==='codex.sent')?.packet
    assert.equal(sent?.ok,true)
    assert.deepEqual(sent?.notes,[note])
    assert.deepEqual(h.draft,[note],'transport must never erase draft on its own')
  } finally {h.dispose()}
})

test('Host refusal reports failure and preserves unsent notes',async()=>{
  const h=setup(()=>Promise.reject(new Error('busy')))
  try {
    h.emit({type:'codex.submit',url:preview,notes:[note]})
    await tick()
    const sent=h.messages.find(x=>x.packet.type==='codex.sent')?.packet
    assert.equal(sent?.ok,false)
    assert.match(sent.reason,/busy/)
    assert.deepEqual(h.draft,[note])
  } finally {h.dispose()}
})

test('wrong origin or nonce cannot trigger DSH Session send',async()=>{
  let calls=0
  const h=setup(async()=>{calls++})
  try {
    h.emit({type:'codex.submit',url:preview,notes:[note]},'http://127.0.0.1:9999')
    h.emit({type:'codex.submit',nonce:'bad-nonce',url:preview,notes:[note]})
    h.emit({type:'codex.submit',url:'http://127.0.0.1:9999/preview',notes:[note]})
    assert.equal(calls,0)
  } finally {h.dispose()}
})
