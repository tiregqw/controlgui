/* DSH host adapter for the BitFun browser-annotation-v1 script ABI.
 * The actual picker/editor/markers are supplied by the imported package.
 * No Tauri APIs are exposed to the preview page.
 */
(function mountDshAnnotationPackage(meta, createHandlers) {
  if (window.__dshCodexGui) return
  window.__dshCodexGui = true
  const label = 'dsh-controlgui'
  const state = { enabled: false, notes: [], selected: null, editing: null, sending: false, pinsVisible: true, collapsed: true, listOpen: false }
  let parentOrigin = null, nonce = null, ready = false
  const pageKey = () => (location.pathname + location.search + location.hash).slice(0, 500)
  const host = document.createElement('div')
  host.setAttribute('data-dsh-codex-gui', 'host')
  // The shared picker ignores its own UI, including the DSH toolbar.
  host.setAttribute('data-openbitfun-controlgui-editor', '')
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647'
  const shadow = host.attachShadow({mode:'open'})
  const bar = document.createElement('div')
  bar.className = 'bar';bar.setAttribute('role','group');bar.setAttribute('aria-label','批注工具栏')
  bar.style.cssText = 'position:fixed;right:8px;bottom:8px;display:flex;flex-wrap:wrap;justify-content:flex-end;align-items:center;gap:5px;padding:6px 7px;max-width:calc(100vw - 16px);border:1px solid #414141;border-radius:12px;background:#292929;color:#f5f5f5;pointer-events:auto;font:500 14px/1.4 system-ui,sans-serif;box-shadow:0 2px 9px #0003;box-sizing:border-box'
  bar.style.setProperty('position','fixed');bar.style.setProperty('right','8px');bar.style.setProperty('bottom','8px')
  const button = (text, title) => {
    const b = document.createElement('button');b.type='button';b.textContent=text;b.title=title||text;b.setAttribute('aria-label',title||text)
    b.style.cssText='border:0;border-radius:7px;padding:5px 9px;min-height:34px;min-width:34px;background:transparent;color:inherit;font:inherit;cursor:pointer;white-space:nowrap;box-sizing:border-box'
    return b
  }
  const icons = {
    select:'<circle cx="12" cy="12" r="8"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/>',
    hide:'<path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.7 5.2A11 11 0 0 1 12 5c5 0 9 7 9 7a16 16 0 0 1-2.7 3.4M6.4 6.4C4.2 8 3 12 3 12s4 7 9 7a9 9 0 0 0 3.5-.7"/>',
    show:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    trash:'<path d="M3 6h18M8 6V4h8v2M5 6l1 14h12l1-14M10 10v6m4-6v6"/>',
    close:'<path d="m6 6 12 12M18 6 6 18"/>'
  }
  const icon=(b,name)=>{b.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+icons[name]+'</svg>'}
  const toggle=button('批注','开启批注'), send=button('发送','发送给 Agent'), count=button('','查看已保存批注'), hide=button('','隐藏批注标记'), clear=button('','清空全部批注'), dismiss=button('','关闭批注工具栏'), status=document.createElement('span')
  count.className='count';count.style.fontWeight='650';send.style.cssText+=';background:#2c70d5;color:white;font-weight:650;padding-inline:10px'
  icon(hide,'hide');icon(clear,'trash');icon(dismiss,'close')
  status.className='status';status.setAttribute('role','status');status.style.cssText='max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#d1d5db;font-size:11px;order:9'
  const list=document.createElement('div');list.style.cssText='position:fixed;right:8px;bottom:66px;width:min(340px,calc(100vw - 16px));max-height:180px;overflow:auto;background:#292929;color:#f5f5f5;padding:8px;border:1px solid #414141;border-radius:10px;box-sizing:border-box;pointer-events:auto;font:12px/1.5 system-ui,sans-serif';list.hidden=true
  // Preserve legacy first/second button ordering for existing tests and consumers.
  count.style.order='-1';send.style.order='3';dismiss.style.order='4'
  bar.append(toggle,send,count,hide,clear,dismiss,status);shadow.append(list,bar);document.documentElement.append(host)
  const notice = (s) => {status.textContent=s;status.hidden=!s}
  const update = () => {
    toggle.setAttribute('aria-pressed',String(state.enabled))
    if(state.collapsed){toggle.textContent='批注';toggle.title='开启批注';toggle.setAttribute('aria-label','开启批注')}
    else {icon(toggle,'select');toggle.title=state.enabled?'暂停选取':'继续选取';toggle.setAttribute('aria-label',toggle.title)}
    toggle.style.background=state.enabled?'#414141':'transparent'
    toggle.style.color=state.enabled?'#b3d1ff':'inherit'
    count.textContent=(state.enabled?'正在批注':'批注')+' · '+state.notes.length
    count.setAttribute('aria-expanded',String(state.listOpen))
    hide.title=state.pinsVisible?'隐藏批注标记':'显示批注标记';hide.setAttribute('aria-label',hide.title);hide.setAttribute('aria-pressed',String(!state.pinsVisible));icon(hide,state.pinsVisible?'hide':'show')
    send.textContent=state.sending?'发送中…':'发送'
    send.disabled=!ready||!state.notes.length||state.sending
    clear.disabled=!state.notes.length||state.sending
    for(const b of [send,count,hide,clear,dismiss,status]) b.style.display=state.collapsed?'none':''
    for(const b of [send,clear]){b.style.opacity=b.disabled?'.38':'1';b.style.cursor=b.disabled?'not-allowed':'pointer'}
    list.hidden=state.collapsed||!state.listOpen||!state.notes.length
    list.replaceChildren()
    if(!list.hidden)state.notes.forEach((n,i)=>{const row=document.createElement('div');row.style.cssText='display:flex;align-items:center;gap:6px;padding:4px 0';const text=document.createElement('span');text.textContent=(i+1)+'. '+n.comment;text.style.cssText='flex:1;min-width:0;overflow-wrap:anywhere';const edit=button('编辑');edit.onclick=()=>{state.listOpen=false;state.pinsVisible=true;pins();select(n.element,i,n.comment);update()};row.append(text,edit);list.append(row)})
  }
  const post = (type, extra={}) => {if(nonce&&parentOrigin) window.parent.postMessage({type,nonce,...extra},parentOrigin)}
  const sync = () => post('codex.draft',{url:location.href,notes:state.notes})
  const sourceHint = (el) => {
    for(let n=el, depth=0;n&&depth<12;n=n.parentElement,depth++){
      for(const attr of ['data-source-file','data-component-file']){const v=n.getAttribute(attr);if(v&&!/[\r\n]/.test(v))return v.slice(0,500)}
      const vue=n.__vueParentComponent||n.__vnode?.component;const file=vue?.type?.__file||vue?.vnode?.type?.__file
      if(typeof file==='string')return file.slice(0,500)
      for(const key of Object.keys(n).filter(k=>k.startsWith('__reactFiber$'))){let f=n[key];for(let i=0;f&&i<30;f=f.return,i++){const v=f._debugSource?.fileName||f.type?.__source?.fileName;if(typeof v==='string')return v.slice(0,500)}}
    }
    return ''
  }
  const resolve = (path) => {try{return document.querySelector(path)}catch{return null}}
  const equalRange = (a,b) => JSON.stringify(a??null)===JSON.stringify(b??null)
  const validAnchor = (e) => {
    const node=resolve(e.selector);if(!node||node.tagName.toLowerCase()!==e.tag.toLowerCase())return false
    if(e.textRange){const child=node.childNodes[e.textRange.nodeIndex];return child?.nodeType===3&&child.textContent.trim()===e.textRange.text}
    return true
  }
  const toMarker = (note,index) => ({index,path:note.element.selector,sourceUrl:new URL(note.element.page,location.origin).href,comment:note.comment,...(note.element.textRange?{textRange:note.element.textRange}:{})})
  const pins = () => handlers.markers({label,expectedUrl:location.href,notes:(state.pinsVisible?state.notes:[]).filter(n=>typeof n.element.page==='string'&&n.element.page.startsWith('/')&&!n.element.page.startsWith('//')).map((n)=>toMarker(n,state.notes.indexOf(n)))})
  const close = (resume=true) => {handlers.editorClose();state.selected=null;state.editing=null;if(resume&&state.enabled)handlers.inspector(label)}
  const select = (element,index,comment) => {
    if(!validAnchor(element)||element.page!==pageKey())return
    state.selected=element;state.editing=index
    if(index!==null)handlers.pause()
    handlers.editorOpen({label,target:{path:element.selector,tagName:element.tag,pageUrl:location.href,textContent:element.text,...(element.textRange?{textRange:element.textRange}:{})},index,comment})
  }
  const onEvent = (event,p) => {
    if(event==='browser-inspector-cancelled-'+label){state.enabled=false;close(false);update();return}
    if(event==='browser-inspector-element-selected-'+label){
      if(!state.enabled||state.editing!==null||!p||p.pageUrl!==location.href)return
      const el=resolve(p.path);if(!el)return
      const element={tag:String(p.tagName).toLowerCase(),selector:String(p.path).slice(0,600),text:String(p.textContent||'').slice(0,700),html:String(p.outerHTML||'').slice(0,2400),page:pageKey(),sourceHint:sourceHint(el),...(p.textRange?{textRange:p.textRange}:{})}
      select(element,null,typeof p.draftComment==='string'?p.draftComment:'');return
    }
    if(event===meta.markerEventPrefix+label){
      const note=state.notes[p?.index];if(note&&p.pageUrl===location.href)select(note.element,p.index,note.comment);return
    }
    if(event!==meta.editorEventPrefix+label||!p||!state.selected||p.pageUrl!==location.href||
       p.path!==state.selected.selector||p.index!==state.editing||!equalRange(p.textRange,state.selected.textRange))return
    if(p.action==='cancel'){close();return}
    if(p.action==='delete'&&state.editing!==null){state.notes.splice(state.editing,1);close();pins();update();sync();return}
    if(p.action!=='save')return
    const comment=typeof p.comment==='string'?p.comment.trim().slice(0,3000):''
    if(comment.length<2||!validAnchor(state.selected)||state.selected.page!==pageKey()){handlers.editorStatus('批注目标已改变，请重新选择');return}
    if(state.editing===null&&state.notes.length>=meta.maxNotes){handlers.editorStatus('一次最多保存 '+meta.maxNotes+' 条批注');return}
    const note={element:state.selected,comment}
    if(state.editing===null)state.notes.push(note);else state.notes[state.editing]=note
    close();pins();update();sync();notice('已保存')
  }
  // Only the package's event emitter is adapted; the iframe has no Tauri access.
  const handlers=createHandlers({invoke(command,args){
    if(command==='plugin:event|emit'&&typeof args?.event==='string')onEvent(args.event,args.payload)
    return Promise.resolve()
  }})
  const setEnabled = value => {state.enabled=value;if(value)handlers.inspector(label);else{handlers.pause();close(false)}update()}
  toggle.onclick=()=>{if(state.collapsed){state.collapsed=false;setEnabled(true)}else setEnabled(!state.enabled)}
  count.onclick=()=>{state.listOpen=!state.listOpen;update()}
  hide.onclick=()=>{state.pinsVisible=!state.pinsVisible;pins();update()}
  dismiss.onclick=()=>{state.collapsed=true;state.listOpen=false;setEnabled(false)}
  clear.onclick=()=>{if(state.sending)return;state.notes=[];state.listOpen=false;close();pins();sync();update();notice('已清空批注')}
  send.onclick=()=>{if(!ready||!state.notes.length||state.sending)return;state.sending=true;update();post('codex.submit',{url:location.href,notes:state.notes});notice('正在发送…')}
  const sameBatch=(notes)=>Array.isArray(notes)&&notes.length===state.notes.length&&notes.every((n,i)=>n.comment===state.notes[i].comment&&n.element?.selector===state.notes[i].element.selector&&n.element?.page===state.notes[i].element.page&&n.element?.tag===state.notes[i].element.tag&&equalRange(n.element?.textRange,state.notes[i].element.textRange))
  window.addEventListener('message',e=>{
    if(e.source!==window.parent||!e.data||typeof e.data!=='object')return
    const d=e.data
    if(d.type==='controlgui.hello'&&typeof d.nonce==='string'&&d.nonce.length>=12){
      try{const u=new URL(e.origin);if(u.protocol!=='http:'||!['127.0.0.1','localhost'].includes(u.hostname))return}catch{return}
      nonce=d.nonce;parentOrigin=e.origin;ready=true;post('codex.ready');update();return
    }
    if(!ready||e.origin!==parentOrigin||d.nonce!==nonce)return
    if(d.type==='codex.restore'&&Array.isArray(d.notes)&&d.notes.length<=meta.maxNotes){
      if(!d.notes.every(n=>n&&typeof n.comment==='string'&&typeof n.element?.selector==='string'&&typeof n.element?.tag==='string'&&typeof n.element?.page==='string'))return
      state.notes=d.notes;state.sending=false;if(d.notes.length)state.collapsed=false;pins();update();return
    }
    if(d.type==='codex.sent'){state.sending=false;if(d.ok===true&&sameBatch(d.notes)){state.notes=[];close();pins();sync();notice('批注已发送给 Agent')}else notice(d.ok?'新编辑的批注仍保留':'发送失败，批注已保留');update()}
    if(d.type==='codex.clear'){state.notes=[];close();pins();update()}
  })
  let lastPage=pageKey()
  const routeTimer=setInterval(()=>{if(pageKey()!==lastPage){lastPage=pageKey();close();pins()}},350)
  window.addEventListener('pagehide',()=>{clearInterval(routeTimer);handlers.cleanup();host.remove()},{once:true})
  update()
})
