// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import adapterSource from '../assets/shared-package-adapter.js?raw';

const label='dsh-controlgui';
const meta={maxNotes:20, markerEventPrefix:'marker-',editorEventPrefix:'editor-'};
const nonce='controlgui-test-nonce';
const origin='http://localhost:3080';
let callbacks: any;
let handlers: any;
let post: any;
let shadow: ShadowRoot;
const button=(name:string)=>shadow.querySelector<HTMLButtonElement>('button[aria-label="'+name+'"]')!;
const count=()=>shadow.querySelector('.count')!.textContent;
function message(type:string,extra:Record<string,unknown>={}) {
  window.dispatchEvent(new MessageEvent('message',{source:window.parent,origin,data:{type,nonce,...extra}}));
}
function save() {
  const payload={path:'#target',tagName:'button',pageUrl:location.href,textContent:'保存',outerHTML:'<button id="target">保存</button>'};
  callbacks.invoke('plugin:event|emit',{event:'browser-inspector-element-selected-'+label,payload});
  callbacks.invoke('plugin:event|emit',{event:'editor-'+label,payload:{action:'save',path:'#target',index:null,pageUrl:location.href,comment:'调整保存按钮'}});
}
beforeEach(()=>{
  document.body.innerHTML='<button id="target">保存</button>';
  delete (window as any).__dshCodexGui;
  post=vi.spyOn(window,'postMessage').mockImplementation(()=>{});
  handlers=Object.fromEntries(['inspector','editorOpen','editorClose','editorStatus','markers','cleanup','pause','cancel'].map(k=>[k,vi.fn()]));
  new Function('return ('+adapterSource+'\n)')()(meta,(bridge:any)=>{callbacks=bridge;return handlers});
  shadow=document.querySelector<HTMLElement>('[data-dsh-codex-gui=host]')!.shadowRoot!;
  message('controlgui.hello');
});
afterEach(()=>{
  window.dispatchEvent(new Event('pagehide'));
  post.mockRestore();
  delete (window as any).__dshCodexGui;
});
it('starts collapsed, opens a right-aligned dock, hides pins without deleting, and keeps draft after closing',()=>{
  expect(button('发送给 Agent').style.display).toBe('none');
  button('开启批注').click();
  expect(count()).toContain('正在批注 · 0');
  expect(button('发送给 Agent').disabled).toBe(true);
  save();
  expect(count()).toContain('正在批注 · 1');
  expect(button('发送给 Agent').disabled).toBe(false);
  expect(shadow.querySelector<HTMLElement>('.bar')!.style.right).toBe('8px');
  button('隐藏批注标记').click();
  expect(handlers.markers.mock.lastCall[0].notes).toHaveLength(0);
  expect(count()).toContain('1');
  button('显示批注标记').click();
  expect(handlers.markers.mock.lastCall[0].notes).toHaveLength(1);
  button('查看已保存批注').click();
  expect(shadow.textContent).toContain('调整保存按钮');
  button('关闭批注工具栏').click();
  expect(button('发送给 Agent').style.display).toBe('none');
  button('开启批注').click();
  expect(count()).toContain('1');
  button('清空全部批注').click();
  expect(count()).toContain('0');
  expect(handlers.markers.mock.lastCall[0].notes).toHaveLength(0);
});
it('clears only after acknowledged successful submission, and retains the batch on failure',()=>{
  button('开启批注').click();save();
  button('发送给 Agent').click();
  const sent=post.mock.calls.find(([p]:any)=>p.type==='codex.submit')?.[0];
  expect(sent.notes).toHaveLength(1);
  expect(button('发送给 Agent').disabled).toBe(true);
  expect(count()).toContain('1');
  message('codex.sent',{ok:false,notes:sent.notes});
  expect(button('发送给 Agent').disabled).toBe(false);
  expect(count()).toContain('1');
  button('发送给 Agent').click();
  message('codex.sent',{ok:true,notes:sent.notes});
  expect(count()).toContain('0');
  expect(button('发送给 Agent').disabled).toBe(true);
});
