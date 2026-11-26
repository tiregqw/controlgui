// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost:5173/demo"}
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createControlGuiMarkerScript, controlGuiMarkerClickEvent } from './controlGuiMarkers.ts';
import { makeControlGuiNote } from './controlGuiAnnotations.ts';

const pageUrl = 'http://localhost:5173/demo';
const label = 'embedded-browser-panel-view-marker-test';
const note = makeControlGuiNote({
  tagName: 'BUTTON', path: '#save', textContent: '保存',
  outerHTML: '<button id="save">保存</button>', sourceUrl: pageUrl,
}, '把按钮改成绿色')!;
let shadow: ShadowRoot;
let frames: FrameRequestCallback[];
let originalAttachShadow: typeof Element.prototype.attachShadow;
let invoke: ReturnType<typeof vi.fn>;

function render(script: string) {
  // The production native API evaluates this string in a WebView.
  // JSDOM supplies the same global DOM APIs for the marker runtime.
  new Function(script)();
}
function flush() {
  const pending = frames.splice(0);
  for (const callback of pending) callback(0);
}
function pins() { return Array.from(shadow.querySelectorAll<HTMLButtonElement>('.pin')); }
function addTarget(id = 'save') {
  const button = document.createElement('button');
  button.id = id;
  button.textContent = '保存';
  button.getBoundingClientRect = vi.fn(() => ({
    x: 100, y: 30, top: 30, right: 160, bottom: 65,
    left: 100, width: 60, height: 35, toJSON: () => ({}),
  }));
  document.body.append(button);
  return button;
}

beforeEach(() => {
  document.documentElement.replaceChildren(document.createElement('head'), document.createElement('body'));
  // location must match the virtual document's localhost URL in every test.
  window.history.replaceState(null, '', pageUrl);
  frames = [];
  invoke = vi.fn().mockResolvedValue(undefined);
  Object.assign(window, { __TAURI_INTERNALS__: { invoke } });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback); return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  originalAttachShadow = Element.prototype.attachShadow;
  vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (mode) {
    shadow = originalAttachShadow.call(this, mode);
    return shadow;
  });
  addTarget();
});
afterEach(() => {
  render(createControlGuiMarkerScript(label, pageUrl, []));
  delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ControlGUI original-style numbered pins', () => {
  it('renders a styled blue numbered marker even when stylesheet injection is unavailable', () => {
    vi.stubGlobal('CSSStyleSheet', class {
      constructor() { throw new Error('blocked by CSP'); }
    });
    render(createControlGuiMarkerScript(label, pageUrl, [note]));
    flush();
    expect(pins()).toHaveLength(1);
    expect(pins()[0].style.backgroundColor).toBe('rgb(47, 107, 255)');
    expect(pins()[0].style.borderRadius).toBe('9px 9px 9px 2px');
    expect(pins()[0].style.width).toBe('25px');
    expect(pins()[0].style.height).toBe('25px');
    expect(pins()[0].style.pointerEvents).toBe('auto');
  });

  it('attaches a blue numbered pin to an element and sends a click event', async () => {
    render(createControlGuiMarkerScript(label, pageUrl, [note]));
    flush();
    expect(pins()).toHaveLength(1);
    expect(pins()[0].textContent).toBe('1');
    expect(pins()[0].style.display).toBe('grid');
    expect(pins()[0].style.left).toBe('148px');
    expect(pins()[0].style.top).toBe('18px');
    expect(pins()[0].title).toContain('把按钮改成绿色');
    pins()[0].click();
    expect(invoke).toHaveBeenCalledWith('plugin:event|emit', {
      event: controlGuiMarkerClickEvent(label),
      payload: { index: 0, pageUrl },
    });
  });

  it('updates existing pins without duplicates and clears on delete or submit', () => {
    render(createControlGuiMarkerScript(label, pageUrl, [note]));
    flush();
    const firstHost = document.querySelector('[data-openbitfun-controlgui-pins]');
    const changed = { ...note, comment: '按钮改成深绿色' };
    render(createControlGuiMarkerScript(label, pageUrl, [changed]));
    flush();
    expect(document.querySelectorAll('[data-openbitfun-controlgui-pins]')).toHaveLength(1);
    expect(document.querySelector('[data-openbitfun-controlgui-pins]')).toBe(firstHost);
    expect(pins()[0].title).toContain('深绿色');
    render(createControlGuiMarkerScript(label, pageUrl, []));
    expect(document.querySelector('[data-openbitfun-controlgui-pins]')).toBeNull();
  });

  it('rehomes a numbered marker after HMR replaces its selected element', async () => {
    render(createControlGuiMarkerScript(label, pageUrl, [note]));
    flush();
    document.querySelector('#save')!.remove();
    await Promise.resolve(); // MutationObserver delivery
    flush();
    expect(pins()[0].style.display).toBe('none');
    addTarget();
    await Promise.resolve();
    flush();
    expect(pins()[0].style.display).toBe('grid');
    window.dispatchEvent(new Event('scroll'));
    flush();
    expect(pins()[0].style.left).toBe('148px');
  });

  it('pins left and right breadcrumb text fragments separately and hides stale text', () => {
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
        const left = index === 0 ? 30 : 120;
        const width = index === 0 ? 60 : 95;
        return { x: left, y: 40, left, top: 40, right: left + width,
          bottom: 58, width, height: 18, toJSON: () => ({}) } as DOMRect;
      });
      return range;
    });
    const left = makeControlGuiNote({
      tagName: 'SPAN', path: '#breadcrumb', textContent: '工作空间',
      outerHTML: crumb.outerHTML, sourceUrl: pageUrl,
      textRange: { nodeIndex: 0, text: '工作空间' },
    }, '改左边')!;
    const right = makeControlGuiNote({
      ...left.element, textContent: '开发工作台',
      textRange: { nodeIndex: 2, text: '开发工作台' },
    }, '改右边')!;
    render(createControlGuiMarkerScript(label, pageUrl, [left, right]));
    flush();
    expect(pins().map(pin => pin.style.left)).toEqual(['78px', '203px']);
    crumb.childNodes[0].textContent = '工作区 ';
    window.dispatchEvent(new Event('scroll'));
    flush();
    expect(pins()[0].style.display).toBe('none');
    expect(pins()[1].style.display).toBe('grid');
  });

  it('never renders notes for a different page or a missing selector', () => {
    render(createControlGuiMarkerScript(label, pageUrl, [{ ...note, element: { ...note.element, path: '#missing' } }]));
    flush();
    expect(pins()[0].style.display).toBe('none');
    render(createControlGuiMarkerScript(label, 'https://wrong.example/page', [note]));
    expect(document.querySelector('[data-openbitfun-controlgui-pins]')).toBeNull();
  });

  it('treats CSS and comment content as data, not executable code', () => {
    const malicious = { ...note, comment: '");document.body.remove();//' };
    render(createControlGuiMarkerScript(label, pageUrl, [malicious]));
    flush();
    expect(document.body).not.toBeNull();
    expect(pins()[0].title).toContain('document.body.remove');
  });
});
