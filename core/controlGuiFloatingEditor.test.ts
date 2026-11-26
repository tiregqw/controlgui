// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost:5173/demo"}
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  createControlGuiEditorOpenScript, createControlGuiEditorCloseScript,
  createControlGuiEditorStatusScript, controlGuiEditorEvent, controlGuiEditorOpenedEvent,
} from './controlGuiFloatingEditor.ts';

const pageUrl = 'http://localhost:5173/demo';
const label = 'test-native-browser';
const target = { tagName: 'button', path: '#submit', pageUrl };
let shadow: ShadowRoot;
let invoke: ReturnType<typeof vi.fn>;

function execute(script: string): void { new Function(script)(); }
function buttons(): HTMLButtonElement[] { return Array.from(shadow.querySelectorAll('button')); }
function button(text: string): HTMLButtonElement {
  const found = buttons().find(item => item.textContent === text);
  if (!found) throw Error('Missing button: ' + text);
  return found;
}

beforeEach(() => {
  document.documentElement.replaceChildren(document.createElement('head'), document.createElement('body'));
  window.history.replaceState({}, '', pageUrl);
  invoke = vi.fn(async () => {});
  Object.assign(window, { __TAURI_INTERNALS__: { invoke } });
  const original = Element.prototype.attachShadow;
  vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (options) {
    shadow = original.call(this, options);
    return shadow;
  });
  const selected = document.createElement('button');
  selected.id = 'submit';
  selected.textContent = '提交';
  selected.getBoundingClientRect = vi.fn(() => ({
    x: 115, y: 90, left: 115, top: 90, right: 240, bottom: 125,
    width: 125, height: 35, toJSON: () => ({}),
  }));
  document.body.append(selected);
});
afterEach(() => {
  execute(createControlGuiEditorCloseScript());
  delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  vi.restoreAllMocks();
});

it('displays an editable floating dialog beside selected page element, not a browser-host header', () => {
  execute(createControlGuiEditorOpenScript(label, target, null));
  expect(invoke).toHaveBeenCalledWith('plugin:event|emit', {
    event: controlGuiEditorOpenedEvent(label),
    payload: { path: '#submit', pageUrl, index: null },
  });
  expect(document.querySelectorAll('[data-openbitfun-controlgui-editor]')).toHaveLength(1);
  const editor = shadow.querySelector<HTMLElement>('[role=dialog]')!;
  expect(editor).toBeTruthy();
  expect(editor.style.left).toBe('115px');
  expect(editor.style.top).toBe('137px');
  expect(editor.style.borderRadius).toBe('16px');
  expect(editor.style.boxShadow).toContain('rgba');
  expect(shadow.querySelector('textarea')?.placeholder).toContain('描述希望怎样修改');
  expect(shadow.querySelector<HTMLElement>('[data-controlgui-selected-outline]')?.style.borderWidth).toBe('2px');
  expect(shadow.textContent).not.toContain('#submit');
  expect(button('保存批注')).toBeTruthy();
  expect(button('保存批注').style.backgroundColor).toBe('rgb(47, 107, 255)');
  expect(shadow.querySelector('.danger')?.getAttribute('style')).toContain('display: none');
  expect(document.body.querySelector('textarea')).toBeNull();
});

it('keeps the styled card and selected outline when page CSP blocks stylesheet injection', () => {
  const original = globalThis.CSSStyleSheet;
  vi.stubGlobal('CSSStyleSheet', class {
    constructor() { throw new Error('style-src blocked'); }
  });
  try {
    execute(createControlGuiEditorOpenScript(label, { ...target, textContent: '＋ 新建开发任务' }, null));
    const card = shadow.querySelector<HTMLElement>('[role=dialog]')!;
    const border = shadow.querySelector<HTMLElement>('[data-controlgui-selected-outline]')!;
    expect(card.style.display).toBe('flex');
    expect(card.style.flexDirection).toBe('column');
    expect(card.style.backgroundColor).toBe('rgb(27, 27, 29)');
    expect(card.style.borderRadius).toBe('16px');
    expect(border.style.display).toBe('block');
    expect(border.style.width).toBe('125px');
    expect(border.style.height).toBe('35px');
    expect(border.style.boxShadow).toBe('none');
    expect(shadow.textContent).toContain('新建开发任务');
    expect(shadow.textContent).not.toContain('#submit');
    expect(button('保存批注').style.backgroundColor).toBe('rgb(47, 107, 255)');
    expect(button('取消').style.borderRadius).toBe('8px');
    expect(shadow.querySelector('textarea')?.style.width).toBe('100%');
  } finally {
    vi.stubGlobal('CSSStyleSheet', original);
  }
});

it('keeps the editor draft accessible for live retargeting without stacking a second selection frame', () => {
  const liveOverlay = document.createElement('div');
  document.body.append(liveOverlay);
  Object.assign(window, { __openbitfun_inspector_instance: { overlay: liveOverlay } });
  try {
    execute(createControlGuiEditorOpenScript(label, target, null));
    const outline = shadow.querySelector<HTMLElement>('[data-controlgui-selected-outline]')!;
    expect(outline.style.display).toBe('none');
    const input = shadow.querySelector('textarea')!;
    input.value = '卡片里面的标题需要修改';
    const current = (window as Window & {
      __openbitfunControlGuiFloatingEditor?: { draftText(): string };
    }).__openbitfunControlGuiFloatingEditor;
    expect(current?.draftText()).toBe('卡片里面的标题需要修改');
    expect(shadow.querySelector<HTMLElement>('[role=dialog]')?.style.display).toBe('flex');
  } finally {
    delete (window as Window & { __openbitfun_inspector_instance?: unknown }).__openbitfun_inspector_instance;
  }
});

it('anchors the editor to a breadcrumb text node and preserves its identity in save events', () => {
  const crumb = document.createElement('span');
  crumb.id = 'breadcrumb';
  crumb.append(document.createTextNode('工作空间 '),
    Object.assign(document.createElement('span'), { textContent: '/' }),
    document.createTextNode(' 开发工作台'));
  document.body.append(crumb);
  const create = document.createRange.bind(document);
  vi.spyOn(document, 'createRange').mockImplementation(() => {
    const range = create();
    range.getBoundingClientRect = vi.fn(() => {
      const index = Array.from(crumb.childNodes).indexOf(range.startContainer);
      const left = index === 0 ? 30 : 115;
      const width = index === 0 ? 55 : 72;
      return { x: left, y: 90, left, top: 90, right: left + width,
        bottom: 110, width, height: 20, toJSON: () => ({}) } as DOMRect;
    });
    return range;
  });
  const left = {
    tagName: 'span', path: '#breadcrumb', pageUrl, textContent: '工作空间',
    textRange: { nodeIndex: 0, text: '工作空间' },
  };
  const right = {
    ...left, textContent: '开发工作台', textRange: { nodeIndex: 2, text: '开发工作台' },
  };
  execute(createControlGuiEditorOpenScript(label, left, null, '改左边'));
  const outline = () => shadow.querySelector<HTMLElement>('[data-controlgui-selected-outline]')!;
  expect(outline().style.left).toBe('30px');
  expect(outline().style.width).toBe('55px');
  button('保存批注').click();
  expect(invoke).toHaveBeenCalledWith('plugin:event|emit', {
    event: controlGuiEditorEvent(label),
    payload: { action: 'save', path: '#breadcrumb', pageUrl, index: null,
      comment: '改左边', textRange: { nodeIndex: 0, text: '工作空间' } },
  });
  execute(createControlGuiEditorOpenScript(label, right, null, '改右边'));
  expect(outline().style.left).toBe('115px');
  expect(outline().style.width).toBe('72px');
  crumb.childNodes[2].textContent = ' 工作区';
  execute(createControlGuiEditorOpenScript(label, right, null, '不能错挂'));
  expect(document.querySelector('[data-openbitfun-controlgui-editor]')).toBeNull();
});

it('sends save and cancel actions to BitFun without inserting user text as executable code', () => {
  execute(createControlGuiEditorOpenScript(label, target, null));
  const textarea = shadow.querySelector('textarea')!;
  textarea.value = '让按钮改为蓝色';
  button('保存批注').click();
  expect(invoke).toHaveBeenCalledWith('plugin:event|emit', {
    event: controlGuiEditorEvent(label),
    payload: { action: 'save', pageUrl, path: '#submit', index: null, comment: '让按钮改为蓝色' },
  });
  button('取消').click();
  expect(invoke).toHaveBeenCalledWith('plugin:event|emit', {
    event: controlGuiEditorEvent(label),
    payload: { action: 'cancel', pageUrl, path: '#submit', index: null, comment: '让按钮改为蓝色' },
  });
});

it('opens update and delete for numbered pins, without stacking dialogs', () => {
  execute(createControlGuiEditorOpenScript(label, target, null));
  execute(createControlGuiEditorOpenScript(label, target, 0, '原批注'));
  expect(document.querySelectorAll('[data-openbitfun-controlgui-editor]')).toHaveLength(1);
  expect(shadow.querySelector('textarea')?.value).toBe('原批注');
  expect(button('更新批注')).toBeTruthy();
  button('删除').click();
  expect(invoke).toHaveBeenCalledWith('plugin:event|emit', {
    event: controlGuiEditorEvent(label),
    payload: { action: 'delete', pageUrl, path: '#submit', index: 0, comment: '原批注' },
  });
  execute(createControlGuiEditorStatusScript('网络错误，批注已保留'));
  expect(shadow.querySelector('[role=status]')?.textContent).toContain('批注已保留');
  execute(createControlGuiEditorCloseScript());
  expect(document.querySelector('[data-openbitfun-controlgui-editor]')).toBeNull();
});

it('does not open an editor if the element cannot be resolved or the page address changed', () => {
  execute(createControlGuiEditorOpenScript(label, { ...target, path: '#missing' }, null));
  expect(document.querySelector('[data-openbitfun-controlgui-editor]')).toBeNull();
  execute(createControlGuiEditorOpenScript(label, { ...target, pageUrl: 'https://other.example' }, null));
  expect(document.querySelector('[data-openbitfun-controlgui-editor]')).toBeNull();
  expect(invoke).not.toHaveBeenCalledWith('plugin:event|emit', {
    event: controlGuiEditorOpenedEvent(label), payload: expect.anything(),
  });
});

it('rejects too-short comments in page before tool event is sent', () => {
  execute(createControlGuiEditorOpenScript(label, target, null));
  shadow.querySelector('textarea')!.value = 'a';
  button('保存批注').click();
  expect(invoke).not.toHaveBeenCalledWith('plugin:event|emit', {
    event: controlGuiEditorEvent(label), payload: expect.anything(),
  });
  expect(shadow.querySelector('[role=status]')?.textContent).toContain('两个字符');
});

it('shows real computed CSS properties and allows collapsing them without losing the draft', () => {
  const el = document.querySelector<HTMLElement>('#submit')!;
  Object.assign(el.style, { backgroundColor: 'rgb(17, 17, 17)', color: 'rgb(255, 255, 255)',
    padding: '8px 14px', borderRadius: '6px', fontSize: '13px' });
  execute(createControlGuiEditorOpenScript(label, { ...target, textContent: 'Primary' }, null, '原始批注'));
  const info = shadow.querySelector<HTMLElement>('[data-controlgui-computed-styles]')!;
  expect(info.querySelector<HTMLInputElement>('[aria-label="background-color"]')?.value).toBe('rgb(17, 17, 17)');
  expect(info.querySelector<HTMLInputElement>('[aria-label="padding"]')?.value).toBe('8px 14px');
  expect(info.querySelector<HTMLInputElement>('[aria-label="border-radius"]')?.value).toBe('6px');
  expect(info.querySelector<HTMLInputElement>('[aria-label="font-size"]')?.value).toBe('13px');
  const toggle = shadow.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
  expect(toggle.textContent).toContain('button "Primary"');
  toggle.click();
  expect(info.hidden).toBe(true);
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(shadow.querySelector('textarea')?.value).toBe('原始批注');
  toggle.click();
  expect(info.hidden).toBe(false);
  expect(el.style.backgroundColor).toBe('rgb(17, 17, 17)');
});


const field=(name:string)=>shadow.querySelector<HTMLInputElement>('[aria-label="'+name+'"]')!;
function change(name:string,value:string) {
  const f=field(name);f.value=value;f.dispatchEvent(new Event('input',{bubbles:true}));f.dispatchEvent(new Event('change',{bubbles:true}));
}
it('previews color, size and spacing, records a CSS-only note, then restores exact inline declarations on close',()=>{
  const el=document.querySelector<HTMLElement>('#submit')!;
  el.setAttribute('style','color: white !important; padding: 8px;');
  const original=el.getAttribute('style');
  execute(createControlGuiEditorOpenScript(label,target,null));
  change('color','#242020');change('padding','12px 20px');change('border-radius','10px');
  expect(el.style.color).toBe('rgb(36, 32, 32)');
  expect(el.style.padding).toBe('12px 20px');
  expect(el.style.getPropertyPriority('color')).toBe('important');
  button('保存批注').click();
  const event=invoke.mock.calls.find((c:any)=>c[1].event===controlGuiEditorEvent(label)) as any;
  expect(event[1].payload.comment).toContain('CSS 修改要求');
  expect(event[1].payload.comment).toContain('→ #242020');
  expect(event[1].payload.comment).toContain('padding: 8px → 12px 20px');
  execute(createControlGuiEditorCloseScript());
  expect(el.getAttribute('style')).toBe(original);
});
it('supports advanced standard CSS, rejects invalid and URL values, and resets individual properties',()=>{
  const el=document.querySelector<HTMLElement>('#submit')!;
  execute(createControlGuiEditorOpenScript(label,target,null));
  change('background-color','#0088ff');
  change('font-size','20px');
  field('自定义 CSS 属性').value='transform';button('添加 CSS 属性').click();
  change('transform','rotate(10deg)');
  expect(el.style.transform).toBe('rotate(10deg)');
  field('自定义 CSS 属性').value='background-image';button('添加 CSS 属性').click();
  change('background-image','url(https://example.com/a.png)');
  expect(el.style.backgroundImage).toBe('');
  change('font-size','nonsense');expect(el.style.fontSize).toBe('20px');
  shadow.querySelector<HTMLButtonElement>('[aria-label="恢复 font-size"]')!.click();
  expect(el.style.fontSize).toBe('');
  button('恢复原样').click();
  expect(el.getAttribute('style')).toBeNull();
});
it('color swatch previews immediately, cancelling and switching targets restores style',()=>{
  const el=document.querySelector<HTMLElement>('#submit')!;
  execute(createControlGuiEditorOpenScript(label,target,null));
  field('background-color 拾色器').value='#ff0000';
  field('background-color 拾色器').dispatchEvent(new Event('input'));
  expect(el.style.backgroundColor).toBe('rgb(255, 0, 0)');
  button('取消').click();
  execute(createControlGuiEditorCloseScript());
  expect(el.getAttribute('style')).toBeNull();
  execute(createControlGuiEditorOpenScript(label,target,null));
  change('opacity','0.5');expect(el.style.opacity).toBe('0.5');
  execute(createControlGuiEditorOpenScript(label,target,null));
  expect(el.getAttribute('style')).toBeNull();
});
it('preserves unrelated concurrent app style changes on close',()=>{
  const el=document.querySelector<HTMLElement>('#submit')!;
  el.style.color='blue';
  execute(createControlGuiEditorOpenScript(label,target,null));
  change('color','red');
  el.style.margin='10px';
  execute(createControlGuiEditorCloseScript());
  expect(el.style.color).toBe('blue');
  expect(el.style.margin).toBe('10px');
});

it('does not save a stale valid value when the user leaves an invalid field',()=>{
  execute(createControlGuiEditorOpenScript(label,target,null));
  change('font-size','20px');change('font-size','invalid');
  button('保存批注').click();
  expect(invoke).not.toHaveBeenCalledWith('plugin:event|emit',{event:controlGuiEditorEvent(label),payload:expect.anything()});
  expect(shadow.querySelector('[role=status]')?.textContent).toContain('无效 CSS 属性');
  change('font-size','22px');button('保存批注').click();
  expect(invoke).toHaveBeenCalledWith('plugin:event|emit',expect.objectContaining({event:controlGuiEditorEvent(label)}));
});

it('fits a scrollable editor above a wide element in a narrow viewport instead of covering it',()=>{
  vi.stubGlobal('innerWidth',374);vi.stubGlobal('innerHeight',520);
  const el=document.querySelector<HTMLElement>('#submit')!;
  el.getBoundingClientRect=vi.fn(()=>({x:20,y:235,left:20,top:235,right:340,bottom:280,width:320,height:45,toJSON:()=>({})}));
  try {
    execute(createControlGuiEditorOpenScript(label,target,null));
    const editor=shadow.querySelector<HTMLElement>('[role=dialog]')!;
    const top=parseFloat(editor.style.top), maxHeight=parseFloat(editor.style.maxHeight);
    expect(top+maxHeight<=235 || top>=280).toBe(true);
    button('查看效果').click();
    expect(shadow.querySelector('textarea')!.style.display).toBe('none');
    expect(button('继续编辑')).toBeTruthy();
    button('继续编辑').click();
    expect(shadow.querySelector('textarea')!.style.display).toBe('block');
  } finally {vi.unstubAllGlobals();}
});
it('previews leaf text, includes text and CSS in the note, and restores text when closed',()=>{
  const el=document.querySelector<HTMLElement>('#submit')!;
  const original=el.firstChild;
  execute(createControlGuiEditorOpenScript(label,target,null));
  change('元素文本','立即保存');
  expect(el.textContent).toBe('立即保存');
  expect(el.firstChild).toBe(original);
  change('color','red');
  button('保存批注').click();
  const call=invoke.mock.calls.find((c:any)=>c[1].event===controlGuiEditorEvent(label)) as any;
  expect(call[1].payload.comment).toContain('文本修改："提交" → "立即保存"');
  expect(call[1].payload.comment).toContain('→ red');
  execute(createControlGuiEditorCloseScript());
  expect(el.textContent).toBe('提交');
  expect(el.firstChild).toBe(original);
});
it('keeps style and text preview while inspecting the effect',()=>{
  const el=document.querySelector<HTMLElement>('#submit')!;
  execute(createControlGuiEditorOpenScript(label,target,null));
  change('元素文本','保存记录');change('background-color','#ff0000');
  button('查看效果').click();
  expect(el.textContent).toBe('保存记录');
  expect(el.style.backgroundColor).toBe('rgb(255, 0, 0)');
  button('继续编辑').click();
  expect(field('元素文本').value).toBe('保存记录');
  button('恢复原样').click();
  expect(el.textContent).toBe('提交');
  expect(el.getAttribute('style')).toBeNull();
});
