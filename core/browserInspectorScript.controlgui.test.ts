// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost:5173/"}
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createInspectorScript, PAUSE_INSPECTOR_SCRIPT, CANCEL_INSPECTOR_SCRIPT } from './controlGuiInspector.ts';

let invoke: ReturnType<typeof vi.fn>;
let button: HTMLButtonElement;
let child: HTMLSpanElement;
const run = (script: string) => new Function(script)();

beforeEach(() => {
  document.documentElement.replaceChildren(document.createElement('head'), document.createElement('body'));
  invoke = vi.fn(async () => {});
  Object.assign(window, { __TAURI_INTERNALS__: { invoke } });
  button = document.createElement('button');
  button.id = 'create-new-task';
  button.className = 'button primary';
  child = document.createElement('span');
  child.textContent = '＋ 新建开发任务';
  button.appendChild(child);
  button.getBoundingClientRect = vi.fn(() => ({
    x: 320, y: 100, left: 320, top: 100, right: 485, bottom: 145,
    width: 165, height: 45, toJSON: () => ({}),
  }));
  document.body.appendChild(button);
});
afterEach(() => {
  run(PAUSE_INSPECTOR_SCRIPT);
  delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  vi.restoreAllMocks();
});

it('shows the initial blue outline and dark two-line DOM tooltip without opening an editor', () => {
  run(createInspectorScript('test-immediate', true));
  const overlay = Array.from(document.documentElement.children).find(x =>
    x instanceof HTMLElement && x.style.zIndex === '2147483646') as HTMLElement;
  const tooltip = Array.from(document.documentElement.children).find(x =>
    x instanceof HTMLElement && x.style.zIndex === '2147483647') as HTMLElement;
  expect(overlay.style.display).toBe('block');
  expect(overlay.style.top).toBe('100px');
  expect(overlay.style.width).toBe('165px');
  expect(overlay.style.borderWidth).toBe('2px');
  expect(tooltip.style.display).toBe('block');
  expect(tooltip.children).toHaveLength(2);
  expect(tooltip.textContent).toContain('button');
  expect(tooltip.textContent).toContain('165 × 45');
  expect(tooltip.textContent).toContain('button#create-new-task');
  expect(tooltip.style.pointerEvents).toBe('none');
  expect(document.querySelector('[data-openbitfun-controlgui-hover-preview]')).toBeNull();
  expect(invoke).not.toHaveBeenCalled();
  run(PAUSE_INSPECTOR_SCRIPT);
  expect(tooltip.isConnected).toBe(false);
  // Hover label must remain legible above the preview application's dark sidebar.
  expect(tooltip.style.backgroundColor).toBe('rgb(5, 10, 18)');
  expect(tooltip.style.opacity).toBe('1');
  expect(tooltip.style.getPropertyPriority('background-color')).toBe('important');
  expect(tooltip.children[0].querySelector('span')?.style.color).toBe('rgb(127, 176, 255)');
  expect((tooltip.children[1] as HTMLElement).style.color).toBe('rgb(230, 237, 249)');
  run(createInspectorScript('test-immediate', true));
  const nextBox = Array.from(document.documentElement.children).find(x =>
    x instanceof HTMLElement && x.style.zIndex === '2147483646') as HTMLElement;
  expect(nextBox.style.display).toBe('block');
  expect(document.querySelector('[data-openbitfun-controlgui-hover-preview]')).toBeNull();
});

it('shows a selection instruction immediately when the page has no visible elements', () => {
  button.remove();
  run(createInspectorScript('test-empty', true));
  const tooltip = Array.from(document.documentElement.children).find(x =>
    x instanceof HTMLElement && x.style.zIndex === '2147483647') as HTMLElement;
  expect(tooltip.style.display).toBe('block');
  expect(tooltip.textContent).toContain('移动鼠标选择网页元素');
});

it('shows a blue selection box and compact dark tooltip on hover, then selects the real button', () => {
  run(createInspectorScript('test-continuous', true));
  button.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, cancelable: true }));
  const overlay = Array.from(document.documentElement.children).find(x =>
    x instanceof HTMLElement && x.style.zIndex === '2147483646') as HTMLElement;
  const tooltip = Array.from(document.documentElement.children).find(x =>
    x instanceof HTMLElement && x.style.zIndex === '2147483647') as HTMLElement;
  expect(overlay.style.display).toBe('block');
  expect(overlay.style.borderWidth).toBe('2px');
  expect(overlay.style.width).toBe('165px');
  expect(overlay.style.height).toBe('45px');
  expect(tooltip.style.display).toBe('block');
  expect(tooltip.textContent).toContain('button');
  expect(tooltip.textContent).toContain('165 × 45');
  expect(tooltip.textContent).toContain('button#create-new-task');
  expect(tooltip.style.pointerEvents).toBe('none');
  expect(document.querySelector('[data-openbitfun-controlgui-hover-preview]')).toBeNull();
  expect(invoke).not.toHaveBeenCalled();

  button.getBoundingClientRect = vi.fn(() => ({
    x: 320, y: 170, left: 320, top: 170, right: 485, bottom: 215,
    width: 165, height: 45, toJSON: () => ({}),
  }));
  window.dispatchEvent(new Event('scroll'));
  expect(overlay.style.top).toBe('170px');
  expect(tooltip.style.top).not.toBe('');

  const click = new MouseEvent('click', { bubbles: true, cancelable: true });
  button.dispatchEvent(click);
  expect(click.defaultPrevented).toBe(true);
  expect(invoke).toHaveBeenCalledWith('plugin:event|emit', {
    event: 'browser-inspector-element-selected-test-continuous',
    payload: expect.objectContaining({
      tagName: 'button', path: 'button#create-new-task',
      textContent: '＋ 新建开发任务', pageUrl: location.href,
    }),
  });
  const selection = invoke.mock.calls[0]?.[1] as { payload: { outerHTML: string; attributes: Record<string, string> } };
  expect(selection.payload.outerHTML).not.toContain('box-shadow');
  expect(selection.payload.attributes.style).toBeUndefined();
  run(PAUSE_INSPECTOR_SCRIPT);
  expect(tooltip.isConnected).toBe(false);
  expect(invoke).not.toHaveBeenCalledWith('plugin:event|emit', {
    event: 'browser-inspector-cancelled-test-continuous', payload: null,
  });
  run(createInspectorScript('test-continuous', true));
  child.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }));
  expect(invoke).toHaveBeenCalledTimes(1);
});

it('draws exactly one blue overlay without mutating the inspected DOM styles', () => {
  button.style.setProperty('box-shadow', 'inset 0 0 2px #123456', 'important');
  const oldShadow = button.style.getPropertyValue('box-shadow');
  const oldPriority = button.style.getPropertyPriority('box-shadow');
  const second = document.createElement('button');
  second.textContent = '查看任务';
  second.getBoundingClientRect = vi.fn(() => ({
    x: 500, y: 200, left: 500, top: 200, right: 620, bottom: 240,
    width: 120, height: 40, toJSON: () => ({}),
  }));
  document.body.appendChild(second);
  run(createInspectorScript('test-visible-hover-ring', true));
  const overlay = Array.from(document.documentElement.children).find(x =>
    x instanceof HTMLElement && x.style.zIndex === '2147483646') as HTMLElement;
  expect(overlay.style.borderWidth).toBe('2px');
  expect(overlay.style.getPropertyPriority('border')).toBe('important');
  expect(overlay.style.boxShadow).toBe('none');
  expect(button.style.boxShadow).toBe(oldShadow);
  expect(button.style.boxShadow).toContain('inset');
  expect(button.style.getPropertyPriority('box-shadow')).toBe('important');

  second.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }));
  expect(button.style.getPropertyValue('box-shadow')).toBe(oldShadow);
  expect(button.style.getPropertyPriority('box-shadow')).toBe(oldPriority);
  expect(second.style.boxShadow).toBe('');
  run(PAUSE_INSPECTOR_SCRIPT);
  expect(second.style.boxShadow).toBe('');
  expect(second.hasAttribute('style')).toBe(false);
  expect(overlay.isConnected).toBe(false);
});

it('selects nested task-card title, description, chip and progress instead of their role=button article', () => {
  button.remove();
  const card = document.createElement('article');
  card.className = 'task-card';
  card.setAttribute('role', 'button');
  const title = document.createElement('h3');
  title.textContent = '鸿蒙高风险需求测试';
  const description = document.createElement('p');
  description.textContent = '支持学生信息查询';
  const chip = document.createElement('span');
  chip.className = 'chip';
  chip.textContent = 'HarmonyOS';
  chip.style.pointerEvents = 'none';
  const progress = document.createElement('progress');
  progress.value = .33;
  card.append(title, description, chip, progress);
  document.body.append(card);
  const bounds = (top: number, height: number, width = 240) =>
    ({ x: 20, y: top, left: 20, top, right: 20 + width, bottom: top + height, width, height, toJSON: () => ({}) });
  card.getBoundingClientRect = vi.fn(() => bounds(30, 240, 320));
  title.getBoundingClientRect = vi.fn(() => bounds(75, 22));
  description.getBoundingClientRect = vi.fn(() => bounds(105, 28));
  chip.getBoundingClientRect = vi.fn(() => bounds(150, 24, 75));
  progress.getBoundingClientRect = vi.fn(() => bounds(195, 6));

  run(createInspectorScript('test-task-nested', true));
  const overlay = Array.from(document.documentElement.children).find(x =>
    x instanceof HTMLElement && x.style.zIndex === '2147483646') as HTMLElement;
  for (const [element, y, tag] of [
    [title, 84, 'h3'], [description, 117, 'p'],
    [chip, 160, 'span'], [progress, 198, 'progress'],
  ] as const) {
    // Even if the page delegates pointer events to the outer article, the
    // annotated target must be the innermost visible node at this coordinate.
    const pointer = { bubbles: true, cancelable: true, clientX: 45, clientY: y };
    card.dispatchEvent(new MouseEvent('pointermove', pointer));
    expect(overlay.style.top).toBe(element.getBoundingClientRect().top + 'px');
    card.dispatchEvent(new MouseEvent('click', pointer));
    expect(invoke).toHaveBeenLastCalledWith('plugin:event|emit', {
      event: 'browser-inspector-element-selected-test-task-nested',
      payload: expect.objectContaining({ tagName: tag, textContent: element.textContent || '' }),
    });
  }
  expect(card.hasAttribute('style')).toBe(false);
});

it('selects the icon, direct label, badge and padding of a native sidebar button separately', () => {
  button.replaceChildren();
  const icon = document.createElement('span');
  icon.textContent = '◫';
  const label = document.createTextNode(' 开发工作台 ');
  const badge = document.createElement('span');
  badge.textContent = '3';
  button.append(icon, label, badge);
  const rect = (left: number, width: number) => ({
    x: left, y: 110, left, top: 110, right: left + width, bottom: 130,
    width, height: 20, toJSON: () => ({}),
  } as DOMRect);
  icon.getBoundingClientRect = vi.fn(() => rect(332, 16));
  badge.getBoundingClientRect = vi.fn(() => rect(450, 18));
  const create = document.createRange.bind(document);
  vi.spyOn(document, 'createRange').mockImplementation(() => {
    const range = create();
    range.getBoundingClientRect = vi.fn(() => rect(360, 72));
    return range;
  });
  run(createInspectorScript('test-sidebar-parts', true));
  const overlay = Array.from(document.documentElement.children).find(x =>
    x instanceof HTMLElement && x.style.zIndex === '2147483646') as HTMLElement;
  for (const [x, width, tag, text] of [
    [340, 16, 'span', '◫'],
    [385, 72, 'button', '开发工作台'],
    [458, 18, 'span', '3'],
    [478, 165, 'button', '◫ 开发工作台 3'],
  ] as const) {
    const pointer = { bubbles: true, cancelable: true, clientX: x, clientY: 120 };
    button.dispatchEvent(new MouseEvent('pointermove', pointer));
    expect(overlay.style.width).toBe(width + 'px');
    const click = new MouseEvent('click', pointer);
    button.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    const payload = (invoke.mock.calls.at(-1)?.[1] as { payload: Record<string, unknown> }).payload;
    expect(payload.tagName).toBe(tag);
    expect(payload.textContent).toBe(text);
    if (x === 385) expect(payload.textRange).toEqual({ nodeIndex: 1, text: '开发工作台' });
    else expect(payload.textRange).toBeUndefined();
    expect(document.querySelector(String(payload.path))).toBe(x === 340 ? icon : x === 458 ? badge : button);
  }
});

it('independently selects the left/right text nodes inside one breadcrumb span', () => {
  const crumb = document.createElement('span');
  crumb.id = 'breadcrumb';
  crumb.append(document.createTextNode('工作空间 '),
    Object.assign(document.createElement('span'), { textContent: '/' }),
    document.createTextNode(' 开发工作台'));
  crumb.getBoundingClientRect = vi.fn(() => ({
    x: 20, y: 60, left: 20, top: 60, right: 235, bottom: 80,
    width: 215, height: 20, toJSON: () => ({}),
  }));
  const create = document.createRange.bind(document);
  vi.spyOn(document, 'createRange').mockImplementation(() => {
    const range = create();
    range.getBoundingClientRect = vi.fn(() => {
      const index = Array.from(crumb.childNodes).indexOf(range.startContainer);
      const left = index === 0 ? 20 : 130;
      const width = index === 0 ? 80 : 105;
      return { x: left, y: 60, left, top: 60, right: left + width,
        bottom: 80, width, height: 20, toJSON: () => ({}) } as DOMRect;
    });
    return range;
  });
  document.body.append(crumb);
  run(createInspectorScript('test-breadcrumb-fragment', true));
  const overlay = Array.from(document.documentElement.children).find(x =>
    x instanceof HTMLElement && x.style.zIndex === '2147483646') as HTMLElement;
  for (const [index, text, x, width] of [
    [0, '工作空间', 55, 80], [2, '开发工作台', 170, 105],
  ] as const) {
    const options = { bubbles: true, cancelable: true, clientX: x, clientY: 70 };
    crumb.dispatchEvent(new MouseEvent('pointermove', options));
    expect(overlay.style.left).toBe(index === 0 ? '20px' : '130px');
    expect(overlay.style.width).toBe(width + 'px');
    crumb.dispatchEvent(new MouseEvent('click', options));
    expect(invoke).toHaveBeenLastCalledWith('plugin:event|emit', {
      event: 'browser-inspector-element-selected-test-breadcrumb-fragment',
      payload: expect.objectContaining({
        tagName: 'span', path: 'span#breadcrumb', textContent: text,
        textRange: { nodeIndex: index, text },
      }),
    });
  }
});

it('does not draw a second blue ring when the selected card already has a blue box-shadow', () => {
  button.style.boxShadow = '0 0 0 3px rgb(47, 107, 255)';
  const original = button.getAttribute('style');
  run(createInspectorScript('test-single-existing-border', true));
  const overlay = Array.from(document.documentElement.children).find(x =>
    x instanceof HTMLElement && x.style.zIndex === '2147483646') as HTMLElement;
  expect(overlay.style.borderColor).toBe('transparent');
  expect(overlay.style.boxShadow).toBe('none');
  expect(button.getAttribute('style')).toBe(original);
  run(PAUSE_INSPECTOR_SCRIPT);
  expect(button.getAttribute('style')).toBe(original);
});

it('carries unsaved text while clicking a more specific target and ignores the floating editor UI', () => {
  Object.assign(window, { __openbitfunControlGuiFloatingEditor: {
    draftText: () => '保留正在输入的批注',
  } });
  try {
    run(createInspectorScript('test-retarget-text', true));
    const target = new MouseEvent('click', { bubbles: true, cancelable: true });
    button.dispatchEvent(target);
    expect(invoke).toHaveBeenCalledWith('plugin:event|emit', {
      event: 'browser-inspector-element-selected-test-retarget-text',
      payload: expect.objectContaining({
        path: 'button#create-new-task', draftComment: '保留正在输入的批注',
      }),
    });
    const ui = document.createElement('div');
    ui.setAttribute('data-openbitfun-controlgui-editor', '');
    document.body.append(ui);
    ui.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(invoke).toHaveBeenCalledTimes(1);
  } finally {
    delete (window as Window & { __openbitfunControlGuiFloatingEditor?: unknown }).__openbitfunControlGuiFloatingEditor;
  }
});

it('switches the dark DOM tooltip between elements without committing an annotation', () => {
  const second = document.createElement('button');
  second.id = 'status';
  second.textContent = '查看运行状态';
  second.getBoundingClientRect = vi.fn(() => ({
    x: 500, y: 250, left: 500, top: 250, right: 635, bottom: 290,
    width: 135, height: 40, toJSON: () => ({}),
  }));
  document.body.appendChild(second);
  run(createInspectorScript('test-hover-to-lock', true));
  const tooltip = Array.from(document.documentElement.children).find(x =>
    x instanceof HTMLElement && x.style.zIndex === '2147483647') as HTMLElement;
  expect(tooltip.textContent).toContain('button#create-new-task');
  second.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }));
  expect(tooltip.textContent).toContain('135 × 40');
  expect(tooltip.textContent).toContain('button#status');
  expect(tooltip.textContent).not.toContain('button#create-new-task');
  expect(invoke).not.toHaveBeenCalled();
  second.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  expect(invoke).toHaveBeenCalledWith('plugin:event|emit', {
    event: 'browser-inspector-element-selected-test-hover-to-lock',
    payload: expect.objectContaining({ path: 'button#status', textContent: '查看运行状态' }),
  });
  run(PAUSE_INSPECTOR_SCRIPT);
  expect(tooltip.isConnected).toBe(false);
});

it('matches the screenshot: h1 blue outline, tag dimensions, and complete DOM path on dark hover hint', () => {
  const app = document.createElement('div');
  app.id = 'app';
  const main = document.createElement('main');
  main.className = 'page';
  const header = document.createElement('header');
  header.className = 'hero';
  const heading = document.createElement('h1');
  heading.textContent = '数据面板';
  heading.getBoundingClientRect = vi.fn(() => ({
    x: 40, y: 25, left: 40, top: 25, right: 174, bottom: 83,
    width: 134, height: 58, toJSON: () => ({}),
  }));
  header.appendChild(heading);
  main.appendChild(header);
  app.appendChild(main);
  document.body.appendChild(app);
  run(createInspectorScript('test-heading-hover', true));
  heading.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }));
  const overlay = Array.from(document.documentElement.children).find(x =>
    x instanceof HTMLElement && x.style.zIndex === '2147483646') as HTMLElement;
  const tooltip = Array.from(document.documentElement.children).find(x =>
    x instanceof HTMLElement && x.style.zIndex === '2147483647') as HTMLElement;
  expect(overlay.style.width).toBe('134px');
  expect(overlay.style.height).toBe('58px');
  expect(tooltip.children).toHaveLength(2);
  expect(tooltip.children[0].textContent).toContain('h1');
  expect(tooltip.children[0].textContent).toContain('134 × 58');
  expect(tooltip.children[1].textContent).toBe('div#app > main.page > header.hero > h1');
  expect(tooltip.style.display).toBe('block');
  expect(document.querySelector('[data-openbitfun-controlgui-hover-preview]')).toBeNull();
  expect(invoke).not.toHaveBeenCalled();
});

it('repeated start while already picking is harmless and does not cancel the mode', () => {
  run(createInspectorScript('test-idempotent', true));
  run(createInspectorScript('test-idempotent', true));
  expect(Array.from(document.documentElement.children).filter(node =>
    node instanceof HTMLElement && node.style.zIndex === '2147483646')).toHaveLength(1);
  expect(invoke).not.toHaveBeenCalled();
});

it('reinstalls the annotation Inspector if a SPA removed its blue box but left a stale active flag', () => {
  run(createInspectorScript('test-stale', true));
  const state = (window as Window & { __openbitfun_inspector_instance?: {
    overlay: HTMLElement; tooltip: HTMLElement;
  } }).__openbitfun_inspector_instance!;
  const oldOverlay = state.overlay;
  const oldTooltip = state.tooltip;
  oldOverlay.remove();
  expect(oldOverlay.isConnected).toBe(false);
  run(createInspectorScript('test-stale', true));
  const recovered = (window as Window & { __openbitfun_inspector_instance?: {
    overlay: HTMLElement; tooltip: HTMLElement;
  } }).__openbitfun_inspector_instance!;
  expect(recovered.overlay).not.toBe(oldOverlay);
  expect(recovered.overlay.isConnected).toBe(true);
  expect(recovered.overlay.style.display).toBe('block');
  expect(oldTooltip.isConnected).toBe(false);
  const click = new MouseEvent('click', { bubbles: true, cancelable: true });
  button.dispatchEvent(click);
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(invoke).toHaveBeenCalledWith('plugin:event|emit', {
    event: 'browser-inspector-element-selected-test-stale',
    payload: expect.objectContaining({ path: 'button#create-new-task' }),
  });
});

it('keeps special-character CSS classes querySelector-safe so the fixed editor can locate the target', () => {
  button.removeAttribute('id');
  button.classList.add('hover:bg-blue/30', 'md:w-1/2');
  run(createInspectorScript('test-css-escape', true));
  button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  const event = invoke.mock.calls[0]?.[1] as { payload?: { path?: string } };
  const path = event.payload?.path;
  expect(path).toBeTruthy();
  expect(() => document.querySelector(path!)).not.toThrow();
  expect(document.querySelector(path!)).toBe(button);
});

it('preserves normal context inspector technical tooltip and Escape exit behavior', () => {
  run(createInspectorScript('test-context', false));
  button.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  const tooltip = Array.from(document.documentElement.children).find(x =>
    x instanceof HTMLElement && x.style.zIndex === '2147483647') as HTMLElement;
  expect(tooltip.textContent).toContain('button#create-new-task.button.primary');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(invoke).toHaveBeenCalledWith('plugin:event|emit', {
    event: 'browser-inspector-cancelled-test-context', payload: null,
  });
  expect((window as Window & { __openbitfun_inspector_active?: boolean }).__openbitfun_inspector_active).toBeUndefined();
});

it('host cancel script still notifies and fully releases inspector', () => {
  run(createInspectorScript('test-host-exit', true));
  run(CANCEL_INSPECTOR_SCRIPT);
  expect(invoke).toHaveBeenCalledWith('plugin:event|emit', {
    event: 'browser-inspector-cancelled-test-host-exit', payload: null,
  });
});
