/**
 * ControlGUI editor inside the actual native browser page, anchored beside
 * the selected DOM element. The host keeps the authoritative draft; this page
 * script is only a UI and emits actions over the existing Tauri event bridge.
 *
 * The function is stringified and run inside a separate WebView; do not import
 * or reference outer variables in its body.
 */

import type { FloatingEditorTarget, FloatingEditorAction } from './contracts.ts';
export type { FloatingEditorTarget, FloatingEditorEvent, FloatingEditorAction } from './contracts.ts';

export const controlGuiEditorEvent = (label: string): string =>
  `browser-controlgui-editor-${label}`;

/** Confirms that the native page actually mounted an interactive editor.
 * A successful eval IPC call alone does not mean the page script ran. */
export const controlGuiEditorOpenedEvent = (label: string): string =>
  `browser-controlgui-editor-opened-${label}`;

interface EditorInput {
  label: string;
  target: FloatingEditorTarget;
  index: number | null;
  comment: string;
}

function runFloatingEditor(input: EditorInput | null, mode: 'open' | 'close' | 'status', status: string): void {
  type Page = Window & {
    __openbitfunControlGuiFloatingEditor?: {
      owner: string;
      close(): void;
      status(message: string): void;
      draftText(): string;
    };
    __openbitfun_inspector_instance?: { overlay?: HTMLElement };
    __TAURI_INTERNALS__?: {
      invoke?: (command: string, args: unknown) => Promise<unknown>;
    };
  };
  const page = window as Page;
  const previous = page.__openbitfunControlGuiFloatingEditor;
  if (mode === 'status') { previous?.status(status); return; }
  previous?.close();
  if (mode !== 'open' || !input) return;

  const samePage = (a: string, b: string): boolean => {
    try {
      const left = new URL(a);
      const right = new URL(b);
      left.hash = '';
      right.hash = '';
      return left.href === right.href;
    } catch { return false; }
  };
  if (!samePage(window.location.href, input.target.pageUrl)) return;

  const findTarget = (): Element | null => {
    try { return document.querySelector(input.target.path); }
    catch { return null; }
  };
  let previewTextNode: Text | null = null;
  let previewTextExpected: string | null = null;
  const targetRect = (element: Element): DOMRect | null => {
    const fragment = input.target.textRange;
    if (!fragment) return element.getBoundingClientRect();
    const node = element.childNodes[fragment.nodeIndex];
    if (!node || node.nodeType !== Node.TEXT_NODE || (node.textContent?.trim() !== fragment.text && !(node === previewTextNode && node.textContent === previewTextExpected))) return null;
    const content = node.textContent;
    const start = content.length - content.trimStart().length;
    const end = content.trimEnd().length;
    if (start >= end) return node === previewTextNode ? element.getBoundingClientRect() : null;
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    const rect = range.getBoundingClientRect();
    return rect.width > 1 && rect.height > 1 ? rect : null;
  };
  const selected = findTarget();
  if (!selected || selected.tagName.toLowerCase() !== input.target.tagName.toLowerCase() ||
    !targetRect(selected)) return;

  const host = document.createElement('div');
  host.setAttribute('data-openbitfun-controlgui-editor', '');
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483646;';
  const shadow = host.attachShadow({ mode: 'closed' });
  // Browser engines and CSP policies can reject cssText or injected style
  // blocks wholesale. Write every critical property through CSSOM instead.
  const styleEach = (node: HTMLElement, declarations: Record<string, string>): void => {
    for (const [property, value] of Object.entries(declarations)) {
      node.style.setProperty(property, value);
    }
  };
  const css = [
    ':host{all:initial;color-scheme:dark}',
    '*{box-sizing:border-box}',
    'textarea::placeholder{color:#85858b}',
    'textarea:focus{border-color:#4b96f6!important;outline:none}',
    'button:focus-visible{outline:2px solid #60a5fa;outline-offset:2px}',
    'button:hover{filter:brightness(1.12)}',
  ].join('');
  // Sites with a restrictive style-src CSP (e.g. the local the preview application
  // preview) silently reject <style> injected by eval. Use a constructable
  // stylesheet if allowed, with inline CSSOM styles below as a hard fallback.
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    shadow.adoptedStyleSheets = [...shadow.adoptedStyleSheets, sheet];
  } catch { /* Critical rendering also uses CSSOM inline styles below. */ }
  const highlight = document.createElement('div');
  highlight.setAttribute('data-controlgui-selected-outline', '');
  highlight.style.cssText = [
    'position:fixed', 'display:none', 'pointer-events:none',
    'box-sizing:border-box', 'border:2px solid #3979ff',
    'border-radius:8px', 'background:rgba(47,107,255,.09)',
    'z-index:1',
  ].join(';');
  styleEach(highlight, {
    position: 'fixed', display: 'none', 'pointer-events': 'none',
    'box-sizing': 'border-box', border: '2px solid #3979ff',
    'border-radius': '8px', background: 'transparent',
    'box-shadow': 'none', 'z-index': '1',
  });
  const editor = document.createElement('div');
  editor.className = 'editor';
  editor.setAttribute('role', 'dialog');
  editor.setAttribute('aria-label', 'ControlGUI 网页元素批注');
  styleEach(editor, {
    position: 'fixed', display: 'flex', 'flex-direction': 'column',
    gap: '10px', 'box-sizing': 'border-box', width: '340px',
    'max-width': 'calc(100vw - 16px)', 'max-height': 'calc(100vh - 16px)',
    'overflow-y': 'auto', padding: '14px',
    'border-radius': '16px', background: '#1b1b1d', color: '#ededf0',
    border: '1px solid #333337',
    'box-shadow': '0 18px 48px rgba(0,0,0,.35),0 3px 10px rgba(0,0,0,.18)',
    'pointer-events': 'auto', 'font-family': 'system-ui,sans-serif',
    'font-size': '13px', 'line-height': '1.5', 'z-index': '2',
    'color-scheme': 'dark',
  });
  const heading = document.createElement('header');
  styleEach(heading, { display: 'flex', 'align-items': 'center', 'justify-content': 'space-between', gap: '8px', 'min-width': '0' });
  const title = document.createElement('button');
  title.type = 'button';
  title.setAttribute('aria-expanded', 'true');
  title.title = '展开或收起元素 CSS 属性';
  styleEach(title, { display: 'flex', 'align-items': 'center', gap: '7px',
    color: '#d0d0d4', background: 'transparent', border: '0', padding: '0',
    'font-weight': '500', 'font-size': '13px', 'min-width': '0', cursor: 'pointer',
    'text-align': 'left', flex: '1', 'font-family': 'system-ui,sans-serif' });
  const chevron = document.createElement('span');
  chevron.textContent = '⌄';
  chevron.setAttribute('aria-hidden', 'true');
  styleEach(chevron, { color: '#a0a0a8', flex: '0 0 auto', 'font-size': '16px' });
  const titleText = document.createElement('span');
  styleEach(titleText, { 'min-width': '0', overflow: 'hidden', 'white-space': 'nowrap', 'text-overflow': 'ellipsis' });
  const friendlyName = (input.target.textContent || selected.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 48);
  titleText.textContent = input.target.tagName.toLowerCase() + (friendlyName ? ' "' + friendlyName + '"' : '');
  title.append(chevron, titleText);
  const close = document.createElement('button');
  close.className = 'close';
  close.type = 'button';
  close.title = '取消批注';
  close.setAttribute('aria-label', '取消批注');
  close.textContent = '×';
  styleEach(close, { flex: '0 0 auto', border: '0', 'border-radius': '7px', padding: '0 4px', background: 'transparent', color: '#a0a0a8', 'font-size': '20px', cursor: 'pointer' });
  const grip = document.createElement('button');
  grip.type = 'button'; grip.textContent = '⠿'; grip.title = '拖动面板'; grip.setAttribute('aria-label', '拖动面板');
  styleEach(grip, { border:'0',background:'transparent',color:'#a0a0a8',cursor:'grab','touch-action':'none','font-size':'19px',padding:'0 3px','flex-shrink':'0' });
  const peek = document.createElement('button');
  peek.type = 'button'; peek.textContent = '查看效果'; peek.setAttribute('aria-label','查看效果');
  styleEach(peek,{border:'1px solid #48484f','border-radius':'6px',background:'#28282b',color:'#ededf0',padding:'3px 6px','font-size':'11px',cursor:'pointer','white-space':'nowrap'});
  heading.append(grip, title, peek, close);
  const properties = document.createElement('div');
  properties.setAttribute('data-controlgui-computed-styles', '');
  properties.setAttribute('aria-label', '当前元素 CSS 属性');
  styleEach(properties, {
    background: '#28282b', 'border-radius': '8px', padding: '9px 11px',
    'font-family': 'ui-monospace,Consolas,monospace', 'font-size': '12px',
    'line-height': '1.6', color: '#dedee4', 'overflow-wrap': 'anywhere',
    'flex-shrink': '0',
  });
  // This preview is temporary. Restore original inline style on editor close.
  const styled = selected instanceof HTMLElement || selected instanceof SVGElement ? selected : null;
  const originalAttr = styled?.getAttribute('style') ?? null;
  let expectedAttr = originalAttr;
  let stale = false;
  const initial = new Map<string,string>();
  const computed = window.getComputedStyle(selected);
  for (let i=0;i<computed.length;i++) {
    const name=computed.item(i);
    initial.set(name,computed.getPropertyValue(name).trim());
  }
  const fragmentNode = input.target.textRange
    ? selected.childNodes[input.target.textRange.nodeIndex]
    : selected.childNodes.length === 1 ? selected.firstChild : null;
  const textNode = fragmentNode?.nodeType === Node.TEXT_NODE &&
    !['SCRIPT','STYLE','TEXTAREA','TITLE','OPTION'].includes(selected.tagName.toUpperCase())
    ? fragmentNode as Text : null;
  previewTextNode = textNode;
  const originalText = textNode?.data ?? '';
  let expectedText = originalText;
  previewTextExpected = originalText;
  let textChanged = false;
  let textPreviewSuspended = false;
  const restoreText = () => {
    if (textNode && textChanged && textNode.data === previewTextExpected) textNode.data = originalText;
  };
  const changes=new Map<string,string>();
  const fields=new Map<string,HTMLInputElement>();
  const invalidFields=new Set<string>();
  const colors=new Map<string,HTMLInputElement>();
  const declarations=(style:CSSStyleDeclaration)=>{
    const result=new Map<string,[string,string]>();
    for(let i=0;i<style.length;i++){
      const name=style.item(i);
      result.set(name,[style.getPropertyValue(name),style.getPropertyPriority(name)]);
    }
    return result;
  };
  const originalInline=styled?declarations(styled.style):new Map<string,[string,string]>();
  const owned=new Map<string,[string,string]|undefined>();
  const samePair=(a:[string,string]|undefined,b:[string,string]|undefined)=>a?.[0]===b?.[0]&&a?.[1]===b?.[1];
  const restorePreview=()=>{
    if(!styled||!owned.size)return;
    if(styled.getAttribute('style')===expectedAttr){
      if(originalAttr===null)styled.removeAttribute('style');else styled.setAttribute('style',originalAttr);
    }else{
      const current=declarations(styled.style);
      for(const [name,pair] of owned){
        if(!samePair(current.get(name),pair))continue;
        const old=originalInline.get(name);
        if(old)styled.style.setProperty(name,old[0],old[1]);else styled.style.removeProperty(name);
      }
    }
    owned.clear();expectedAttr=styled.getAttribute('style');
  };
  const rebuild=()=>{
    if(stale||!styled||!selected.isConnected||findTarget()!==selected)return false;
    if(styled.getAttribute('style')!==expectedAttr){
      restorePreview();stale=true;showNotice('页面样式已更新，请重新选择元素。');return false;
    }
    restorePreview();
    for(const [name,value] of changes)styled.style.setProperty(name,value,'important');
    expectedAttr=styled.getAttribute('style');
    const current=declarations(styled.style);
    for(const name of new Set([...originalInline.keys(),...current.keys()]))if(!samePair(originalInline.get(name),current.get(name)))owned.set(name,current.get(name));
    schedule();return true;
  };
  const validName=(n:string)=>/^-?[a-z][a-z0-9-]*$/.test(n)&&n.length<=80&&!['behavior','-moz-binding'].includes(n);
  const validValue=(n:string,v:string)=>{
    if(!validName(n)||!v||v.length>350||/[;{}!\\]|url\s*\(|(?:-webkit-)?image-set\s*\(|\bimage\s*\(|\bcross-fade\s*\(|\bsrc\s*\(|expression\s*\(|@import|\bvar\s*\(|\battr\s*\(/i.test(v))return false;
    try{
      if(typeof CSS!=='undefined'&&CSS.supports)return CSS.supports(n,v);
      const probe=document.createElement('div').style;probe.setProperty(n,v);return !!probe.getPropertyValue(n);
    }catch{return false;}
  };
  const originalValue=(name:string)=>initial.get(name)??'';
  const changeCount=document.createElement('div');
  const refreshCount=()=>{changeCount.textContent='已调整 '+(changes.size+(textChanged?1:0))+' 项 · 临时预览';};
  const update=(name:string,raw:string)=>{
    const v=raw.trim();
    if(!validValue(name,v)){invalidFields.add(name);showNotice('无效或暂不支持的 CSS 值：'+name);return false;}
    invalidFields.delete(name);
    if(!styled||stale)return false;
    const previous=changes.get(name);
    if(v===originalValue(name))changes.delete(name);else changes.set(name,v);
    if(!rebuild()){
      if(previous===undefined)changes.delete(name);else changes.set(name,previous);
      return false;
    }
    showNotice('');refreshCount();return true;
  };
  const hex=(v:string)=>{
    if(/^#[a-f0-9]{6}$/i.test(v))return v;
    const m=v.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
    return m?'#'+m.slice(1,4).map(n=>Math.min(255,Number(n)).toString(16).padStart(2,'0')).join(''):null;
  };
  const reset=(name?:string)=>{
    if(name){changes.delete(name);invalidFields.delete(name);}else{changes.clear();invalidFields.clear();}
    for(const [key,field] of fields)if(!name||name===key){
      field.value=originalValue(key);const c=colors.get(key);if(c)c.value=hex(field.value)||'#000000';
    }
    if(!name && textField) { if(textNode?.data!==previewTextExpected){stale=true;showNotice('页面文本已更新，请重新选择。');} else {restoreText(); expectedText=originalText; previewTextExpected=originalText; textChanged=false; textField.value=originalText;} }
    rebuild();refreshCount();
  };
  styleEach(properties,{'font-family':'system-ui,sans-serif','max-height':'min(320px, 45vh)','overflow-y':'auto',display:'block',padding:'8px 10px'});
  const controlStyle=(node:HTMLElement)=>styleEach(node,{'box-sizing':'border-box','min-width':'0',color:'#ededf0',background:'#202023',border:'1px solid #48484f','border-radius':'7px',padding:'5px 7px','font-size':'12px','font-family':'system-ui,sans-serif'});
  const intro=document.createElement('div');
  styleEach(intro,{display:'flex','justify-content':'space-between','align-items':'center',gap:'4px','margin-bottom':'6px'});
  const resetAll=document.createElement('button');resetAll.type='button';resetAll.textContent='恢复原样';controlStyle(resetAll);
  resetAll.addEventListener('click',()=>reset());
  styleEach(changeCount,{color:'#a7bfff','font-size':'11px'});refreshCount();intro.append(changeCount,resetAll);properties.append(intro);
  if(input.target.textRange){const hint=document.createElement('div');hint.textContent='CSS 预览作用于所选文字的父元素。';properties.append(hint);}
  let textField: HTMLInputElement | null = null;
  if (textNode) {
    const row = document.createElement('div');
    styleEach(row,{display:'flex','align-items':'center',gap:'5px',margin:'5px 0'});
    const label = document.createElement('label');label.textContent='文本';
    styleEach(label,{flex:'0 0 36%',color:'#c6c6ce','font-size':'12px'});
    const field = document.createElement('input');textField=field;field.type='text';field.value=originalText;field.maxLength=500;
    field.setAttribute('aria-label','元素文本');controlStyle(field);styleEach(field,{flex:'1',width:'0'});
    field.addEventListener('input',()=>{
      if(!selected.isConnected||findTarget()!==selected||textNode.parentNode!==selected||textNode.data!==previewTextExpected){stale=true;showNotice('页面文本已更新，请重新选择。');return;}
      expectedText=field.value;textPreviewSuspended=false;previewTextExpected=expectedText;textChanged=expectedText!==originalText;textNode.data=expectedText;refreshCount();schedule();
    });
    row.append(label,field);properties.append(row);
  }
  const labels:Record<string,string>={
    color:'文本颜色','background-color':'背景颜色',opacity:'Opacity','font-family':'字体','font-size':'字号','font-weight':'字重','line-height':'行高','text-align':'文本对齐','letter-spacing':'字间距',width:'宽度',height:'高度','min-width':'最小宽度','min-height':'最小高度',padding:'内边距',margin:'外边距',gap:'间距','border-radius':'圆角','border-width':'边框宽度','border-style':'边框样式','border-color':'边框颜色','box-shadow':'阴影','text-shadow':'文字阴影',display:'Display',position:'定位','flex-direction':'方向','justify-content':'主轴对齐','align-items':'交叉轴对齐','flex-wrap':'换行','grid-template-columns':'Grid 列',overflow:'溢出',cursor:'光标','text-decoration':'文字装饰','max-width':'最大宽度','max-height':'最大高度'
  };
  const makeRow=(name:string,parent:HTMLElement)=>{
    if(fields.has(name))return;
    if(!initial.has(name))initial.set(name,computed.getPropertyValue(name).trim());
    const value=originalValue(name);
    const row=document.createElement('div');row.setAttribute('data-css-property',name);
    styleEach(row,{display:'flex','align-items':'center',gap:'5px',margin:'5px 0'});
    const key=document.createElement('label');key.textContent=labels[name]||name;key.title=name;
    styleEach(key,{color:'#c6c6ce',flex:'0 0 36%','min-width':'0','overflow-wrap':'anywhere','font-size':'12px'});
    const field=document.createElement('input');field.type='text';field.value=value;field.placeholder='CSS 值';field.spellcheck=false;
    field.setAttribute('aria-label',name);field.maxLength=350;controlStyle(field);styleEach(field,{flex:'1',width:'0'});fields.set(name,field);
    row.append(key);
    if(name==='color'||name.endsWith('-color')){
      const c=document.createElement('input');c.type='color';c.value=hex(value)||'#000000';c.title='选择颜色';c.setAttribute('aria-label',name+' 拾色器');
      styleEach(c,{width:'27px',height:'29px',padding:'1px',border:'0',background:'transparent','flex-shrink':'0',cursor:'pointer'});
      colors.set(name,c);c.addEventListener('input',()=>{field.value=c.value;update(name,field.value);});row.append(c);
    }
    const apply=()=>{if(update(name,field.value)){const c=colors.get(name);if(c)c.value=hex(field.value)||c.value;}};
    field.addEventListener('input',()=>{if(validValue(name,field.value.trim()))apply();else invalidFields.add(name);});
    field.addEventListener('change',apply);
    field.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();apply();}});
    const undo=document.createElement('button');undo.type='button';undo.textContent='↶';undo.title='恢复 '+name;undo.setAttribute('aria-label','恢复 '+name);controlStyle(undo);styleEach(undo,{padding:'4px 5px','flex-shrink':'0',cursor:'pointer'});
    undo.addEventListener('click',()=>reset(name));row.append(field,undo);parent.append(row);
  };
  for(const name of ['color','background-color','opacity','font-family','font-size','font-weight','width','height','padding','margin','border-radius'])makeRow(name,properties);
  const more=document.createElement('details');const summary=document.createElement('summary');summary.textContent='更多样式 · 布局 / 边框 / 阴影';
  styleEach(summary,{cursor:'pointer',color:'#a7bfff',margin:'8px 0'});more.append(summary);
  for(const name of Object.keys(labels))if(!fields.has(name))makeRow(name,more);
  properties.append(more);
  const advanced=document.createElement('details');const advancedTitle=document.createElement('summary');advancedTitle.textContent='高级 CSS · 搜索属性';
  styleEach(advancedTitle,{cursor:'pointer',color:'#a7bfff',margin:'8px 0'});
  const search=document.createElement('input');search.type='text';search.placeholder='如 transform / padding-top';search.setAttribute('aria-label','自定义 CSS 属性');controlStyle(search);styleEach(search,{width:'100%'});
  const choices=document.createElement('div');styleEach(choices,{display:'flex','flex-wrap':'wrap',gap:'3px',margin:'5px 0'});
  const advancedRows=document.createElement('div');
  const addProperty=(raw:string)=>{
    const n=raw.trim().toLowerCase();if(!validName(n)){showNotice('请输入标准 CSS 属性名。');return;}
    if(typeof CSS!=='undefined'&&CSS.supports&&!CSS.supports(n,'initial')){showNotice('浏览器不支持此 CSS 属性。');return;}
    if(fields.has(n)){if(more.contains(fields.get(n)!))more.open=true;fields.get(n)?.focus();}else makeRow(n,advancedRows);
    schedule();
  };
  search.addEventListener('input',()=>{
    choices.replaceChildren();const q=search.value.trim().toLowerCase();if(!q)return;
    for(const n of [...initial.keys()].filter(n=>n.includes(q)&&validName(n)).slice(0,10)){
      const item=document.createElement('button');item.type='button';item.textContent=n;controlStyle(item);item.addEventListener('click',()=>addProperty(n));choices.append(item);
    }
  });
  const add=document.createElement('button');add.type='button';add.textContent='添加 CSS 属性';controlStyle(add);add.addEventListener('click',()=>addProperty(search.value));
  search.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();addProperty(search.value);}});
  advanced.append(advancedTitle,search,choices,add,advancedRows);properties.append(advanced);
  const cssComment=()=>changes.size?'CSS 修改要求（临时预览，需落实到源码）：\n'+[...changes].map(([n,v])=>'- '+n+': '+(originalValue(n)||'(未设置)')+' → '+v).join('\n'):'';
  const finalComment=()=>[textarea.value.trim(),textChanged?'文本修改：'+JSON.stringify(originalText)+' → '+JSON.stringify(expectedText):'',cssComment()].filter(Boolean).join('\n\n');
  title.addEventListener('click', () => {
    const expanded = title.getAttribute('aria-expanded') === 'true';
    title.setAttribute('aria-expanded', String(!expanded));
    properties.hidden = expanded;
    properties.style.display = expanded ? 'none' : 'block';
    chevron.textContent = expanded ? '›' : '⌄';
    schedule();
  });
  const textarea = document.createElement('textarea');
  textarea.setAttribute('aria-label', '网页元素批注内容');
  textarea.placeholder = '描述希望怎样修改这个元素…';
  textarea.maxLength = 3000;
  textarea.value = input.comment;
  styleEach(textarea, {
    'box-sizing': 'border-box', display: 'block', width: '100%',
    height: '76px', 'min-height': '76px', 'max-height': '180px',
    'flex-shrink': '0', resize: 'vertical', padding: '10px 11px', margin: '0',
    border: '1px solid #49494e', 'border-radius': '9px',
    background: '#262628', color: '#f2f2f4', outline: 'none',
    'font-family': 'system-ui,sans-serif', 'font-size': '13px', 'line-height': '1.5',
  });
  const notice = document.createElement('div');
  notice.className = 'notice';
  notice.setAttribute('role', 'status');
  notice.style.display = 'none';
  notice.style.cssText = 'font:11px/1.4 system-ui,sans-serif;color:#fca5a5;white-space:pre-wrap;';
  styleEach(notice, { 'font-size': '11px', color: '#fca5a5', 'white-space': 'pre-wrap' });
  notice.style.display = 'none';
  const showNotice = (message: string): void => {
    notice.textContent = message;
    notice.style.display = message && !peeking ? 'block' : 'none';
    schedule();
  };
  const actions = document.createElement('div');
  actions.className = 'row';
  actions.style.cssText = 'display:flex;align-items:center;justify-content:flex-end;gap:8px;';
  styleEach(actions, { display: 'flex', 'align-items': 'center', 'justify-content': 'flex-end', gap: '8px' });
  const remove = document.createElement('button');
  remove.className = 'danger';
  remove.type = 'button';
  remove.textContent = '删除';
  remove.style.cssText = 'margin-right:auto;border:0;background:transparent;color:#b42318;border-radius:8px;padding:6px 8px;font:600 12px/1.4 system-ui,sans-serif;cursor:pointer;';
  styleEach(remove, { 'margin-right': 'auto', border: '0', background: 'transparent', color: '#fca5a5', 'border-radius': '8px', padding: '6px 8px', 'font-size': '12px', 'font-weight': '600', cursor: 'pointer' });
  if (input.index === null) remove.style.display = 'none';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = '取消';
  cancel.style.cssText = 'border:1px solid #d7e0ed;background:#fff;color:#374151;border-radius:8px;padding:6px 12px;font:600 12px/1.4 system-ui,sans-serif;cursor:pointer;';
  styleEach(cancel, { border: '1px solid transparent', background: 'transparent', color: '#b8b8be', 'border-radius': '8px', padding: '6px 12px', 'font-size': '12px', 'font-weight': '600', cursor: 'pointer' });
  const save = document.createElement('button');
  save.className = 'primary';
  save.type = 'button';
  save.textContent = input.index === null ? '保存批注' : '更新批注';
  save.style.cssText = 'border:1px solid #2f6bff;background:#2f6bff;color:white;border-radius:8px;padding:6px 13px;font:600 12px/1.4 system-ui,sans-serif;cursor:pointer;';
  styleEach(save, { border: '1px solid #2f6bff', background: '#2f6bff', color: '#fff', 'border-radius': '20px', padding: '7px 15px', 'font-size': '12px', 'font-weight': '600', cursor: 'pointer' });
  actions.append(remove, cancel, save);
  editor.append(heading, textarea, properties, notice, actions);
  shadow.append(highlight, editor);
  document.documentElement.appendChild(host);

  // Report after mounting, not merely after the host submitted the eval
  // command. This prevents a toolbar that says "annotation active" while an
  // invalid DOM selector or an unavailable page bridge leaves no editor.
  try {
    const ready = page.__TAURI_INTERNALS__?.invoke?.('plugin:event|emit', {
      event: 'browser-controlgui-editor-opened-' + input.label,
      payload: { path: input.target.path, index: input.index, pageUrl: location.href,
        ...(input.target.textRange ? { textRange: input.target.textRange } : {}) },
    });
    if (ready) void ready.catch(() => {});
  } catch { /* The host-side timeout will offer a safe retry. */ }

  let closed = false;
  let frame = 0;
  let peeking = false;
  let manualPosition: { left: number; top: number } | null = null;
  let drag: { x:number; y:number; left:number; top:number; id:number } | null = null;
  const place = (): void => {
    if (closed) return;
    const element = findTarget();
    if (!element || !samePage(location.href, input.target.pageUrl)) {
      restorePreview(); restoreText();
      editor.style.display = 'none';
      highlight.style.display = 'none';
      return;
    }
    if (element !== selected && (changes.size || textChanged)) { restorePreview(); restoreText(); stale = true; }
    const rect = targetRect(element);
    if (!rect) {
      highlight.style.display = 'none';
      editor.style.display = 'none';
      return;
    }
    // A live annotation Inspector already owns the one visible blue frame.
    // Keep the selected editor visible, but do not stack its own border over
    // that hover frame while a new note can still be retargeted.
    const pickerVisible = page.__openbitfun_inspector_instance?.overlay?.isConnected === true;
    highlight.style.display = rect.width > 0 && rect.height > 0 && !pickerVisible ? 'block' : 'none';
    // Match the selected DOM box exactly: padding an extra 3px and drawing a
    // shadow created an apparent second blue frame beside the page's border.
    highlight.style.top = rect.top + 'px';
    highlight.style.left = rect.left + 'px';
    highlight.style.width = Math.max(0, rect.width) + 'px';
    highlight.style.height = Math.max(0, rect.height) + 'px';
    const style = getComputedStyle(element);
    const blue = (value: string): boolean => {
      const colors = String(value || '').matchAll(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s\/]+([\d.]+))?\s*\)/gi);
      for (const parts of colors) {
        const r = Number(parts[1]), g = Number(parts[2]), b = Number(parts[3]);
        const alpha = parts[4] === undefined ? 1 : Number(parts[4]);
        if (alpha >= .35 && b >= 145 && b > r + 60 && b > g + 30) return true;
      }
      return false;
    };
    const nativeBlue = blue(style.boxShadow) ||
      (parseFloat(style.outlineWidth) >= 1 && style.outlineStyle !== 'none' && blue(style.outlineColor)) ||
      ['Top', 'Right', 'Bottom', 'Left'].some(side =>
        parseFloat(style.getPropertyValue('border-' + side.toLowerCase() + '-width')) >= 1 &&
        style.getPropertyValue('border-' + side.toLowerCase() + '-style') !== 'none' &&
        blue(style.getPropertyValue('border-' + side.toLowerCase() + '-color')));
    highlight.style.borderColor = nativeBlue ? 'transparent' : '#3979ff';
    editor.style.display = 'flex';
    const avoid = element.getBoundingClientRect();
    const edge = 8, gap = 12;
    const vw = Math.max(0, innerWidth), vh = Math.max(0, innerHeight);
    const availableWidth = Math.max(0,vw-edge*2), availableHeight=Math.max(0,vh-edge*2);
    const width = Math.min(peeking?148:340, availableWidth);
    const clamp = (value:number, low:number, high:number) => Math.max(low,Math.min(Math.max(low,high),value));
    // Measure natural height before choosing a slot. A tall editor in a narrow
    // WebView must shrink into the available space, not cover the selection.
    editor.style.width=width+'px';
    editor.style.maxHeight=availableHeight+'px';
    editor.style.maxWidth=availableWidth+'px';
    const naturalHeight=Math.min(availableHeight,editor.scrollHeight||editor.offsetHeight||(peeking?40:properties.hidden?180:300));
    const x=clamp(avoid.left,edge,vw-width-edge), y=clamp(avoid.top,edge,vh-naturalHeight-edge);
    const slots = [
      {left:x,top:Math.max(edge,avoid.bottom+gap),w:width,h:Math.max(0,vh-edge-Math.max(edge,avoid.bottom+gap)),side:'below'},
      {left:x,top:edge,w:width,h:Math.max(0,Math.min(vh-edge,avoid.top-gap)-edge),side:'above'},
      {left:Math.max(edge,avoid.right+gap),top:y,w:Math.max(0,Math.min(width,vw-edge-Math.max(edge,avoid.right+gap))),h:availableHeight,side:'right'},
      {left:edge,top:y,w:Math.max(0,Math.min(width,avoid.left-gap-edge)),h:availableHeight,side:'left'}
    ];
    const fits=slots.find(slot=>slot.w>=width&&slot.h>=naturalHeight);
    const useful=slots.filter(slot=>slot.w>=Math.min(240,width)&&slot.h>=Math.min(150,naturalHeight))
      .sort((a,b)=>Math.min(b.w,width)*Math.min(b.h,naturalHeight)-Math.min(a.w,width)*Math.min(a.h,naturalHeight));
    const slot=fits??useful[0];
    if(manualPosition){
      editor.style.left=clamp(manualPosition.left,edge,vw-width-edge)+'px';
      editor.style.top=clamp(manualPosition.top,edge,vh-naturalHeight-edge)+'px';
    }else if(slot){
      const w=Math.min(slot.w,width);
      editor.style.width=w+'px';editor.style.maxHeight=slot.h+'px';
      const h=Math.min(slot.h,editor.offsetHeight||naturalHeight);
      editor.style.left=(slot.side==='left'?clamp(avoid.left-gap-w,edge,vw-w-edge):clamp(slot.left,edge,vw-w-edge))+'px';
      editor.style.top=(slot.side==='above'?clamp(avoid.top-gap-h,edge,vh-h-edge):clamp(slot.top,edge,vh-h-edge))+'px';
    }else{
      // Full-screen elements may leave no free rectangle. Peek collapses
      // the panel without losing changes, and the handle permits relocation.
      editor.style.left=x+'px';editor.style.top=clamp(avoid.top-naturalHeight-gap,edge,vh-naturalHeight-edge)+'px';
    }

  };
  const schedule = (): void => {
    if (closed || frame) return;
    frame = window.requestAnimationFrame(() => { frame = 0; place(); });
  };
  const togglePeek = () => {
    peeking=!peeking;
    peek.textContent=peeking?'继续编辑':'查看效果';
    peek.setAttribute('aria-label',peek.textContent);
    peek.setAttribute('aria-pressed',String(peeking));
    textarea.style.display=peeking?'none':'block';
    properties.style.display=peeking||properties.hidden?'none':'block';
    actions.style.display=peeking?'none':'flex';
    notice.style.display=peeking?'none':notice.textContent?'block':'none';
    title.style.display=peeking?'none':'flex';
    editor.style.padding=peeking?'6px 8px':'14px';
    manualPosition=null;
    place();
  };
  peek.addEventListener('click',togglePeek);
  grip.addEventListener('pointerdown',event=>{
    if(event.button!==0)return;
    event.preventDefault();
    const rect=editor.getBoundingClientRect();
    drag={x:event.clientX,y:event.clientY,left:rect.left,top:rect.top,id:event.pointerId};
    grip.setPointerCapture?.(event.pointerId);grip.style.cursor='grabbing';
  });
  grip.addEventListener('pointermove',event=>{
    if(!drag||event.pointerId!==drag.id)return;
    manualPosition={left:drag.left+event.clientX-drag.x,top:drag.top+event.clientY-drag.y};
    place();
  });
  const endDrag=()=>{drag=null;grip.style.cursor='grab';};
  grip.addEventListener('pointerup',endDrag);grip.addEventListener('pointercancel',endDrag);grip.addEventListener('lostpointercapture',endDrag);
  grip.addEventListener('dblclick',()=>{manualPosition=null;place();});
  const report = (action: FloatingEditorAction): void => {
    if (closed) return;
    const invoke = page.__TAURI_INTERNALS__?.invoke;
    if (typeof invoke !== 'function') {
      showNotice('无法连接 BitFun 批注服务。');
      return;
    }
    // Never run DOM content as code. The host validates this action and URL.
    void invoke('plugin:event|emit', {
      event: 'browser-controlgui-editor-' + input.label,
      payload: {
        action,
        pageUrl: location.href,
        path: input.target.path,
        index: input.index,
        comment: action === 'save' ? finalComment() : textarea.value,
        ...(input.target.textRange ? { textRange: input.target.textRange } : {}),
      },
    }).catch(() => { showNotice('未能发送批注指令，请重试。'); });
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') { event.stopPropagation(); report('cancel'); }
  };
  const onView = (): void => { schedule(); };
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('scroll', onView, true);
  window.addEventListener('resize', onView);
  shadow.addEventListener('pointerdown', event => event.stopPropagation());
  shadow.addEventListener('click', event => event.stopPropagation());
  shadow.addEventListener('keydown', event => event.stopPropagation());
  shadow.addEventListener('keydown', onKey);
  close.addEventListener('click', () => report('cancel'));
  cancel.addEventListener('click', () => report('cancel'));
  remove.addEventListener('click', () => report('delete'));
  save.addEventListener('click', () => {
    if (invalidFields.size) { showNotice('请修正或恢复无效 CSS 属性：' + [...invalidFields].join(', ')); return; }
    if (stale || (textNode && textNode.data !== previewTextExpected) || (styled && styled.getAttribute('style') !== expectedAttr)) { showNotice('页面样式已更新，请重新选择。'); return; }
    if (finalComment().length > 3000) { showNotice('批注与 CSS 差异超过 3000 字符，请减少修改项。'); return; }
    if (finalComment().length < 2) {
      showNotice('批注至少需要两个字符。');
      return;
    }
    const currentTarget = findTarget();
    if (!currentTarget || currentTarget !== selected || !targetRect(currentTarget)) {
      showNotice('页面已更新，无法找到原来的元素，请重新选择。');
      return;
    }
    // Host validates the original text-range identity before accepting a note.
    // Restore only the text temporarily; finalComment retains the desired value.
    if (textChanged && textNode && input.target.textRange) {
      restoreText(); previewTextExpected=originalText; textPreviewSuspended=true;
    }
    report('save');
  });
  const current = {
    owner: input.label,
    status(message: string) {
      if (textPreviewSuspended && textNode && textNode.data===originalText && findTarget()===selected) {
        textNode.data=expectedText; previewTextExpected=expectedText; textPreviewSuspended=false;
      }
      showNotice(message);
    },
    draftText() { return textarea.value; },
    close() {
      if (closed) return;
      closed = true;
      restorePreview(); restoreText();
      observer.disconnect();
      window.removeEventListener('scroll', onView, true);
      window.removeEventListener('resize', onView);
      if (frame) window.cancelAnimationFrame(frame);
      host.remove();
      if (page.__openbitfunControlGuiFloatingEditor === current) delete page.__openbitfunControlGuiFloatingEditor;
    },
  };
  page.__openbitfunControlGuiFloatingEditor = current;
  place();
  textarea.focus({ preventScroll: true });
}

export function createControlGuiEditorOpenScript(
  label: string,
  target: FloatingEditorTarget,
  index: number | null,
  comment = '',
): string {
  return `(${runFloatingEditor.toString()})(
    ${JSON.stringify({ label, target, index, comment })}, 'open', '');`;
}

export function createControlGuiEditorCloseScript(): string {
  return `(${runFloatingEditor.toString()})(null, 'close', '');`;
}

export function createControlGuiEditorStatusScript(message: string): string {
  return `(${runFloatingEditor.toString()})(null, 'status', ${JSON.stringify(message)});`;
}
