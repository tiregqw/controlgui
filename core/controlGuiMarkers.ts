/**
 * Small Codex-style numbered pins inside BitFun's native browser WebView.
 * Adapted from the original DSH ControlGUI page-runtime's marker behavior:
 * shadow-root isolation, pinning to an element's top-right corner, and
 * repositioning after scroll, resize, SPA updates and HMR replacements.
 *
 * The page owns only the visual markers. All drafts and editing remain with
 * BitFun BrowserPanel; page contents are untrusted location hints.
 */
import type { ControlGuiNote, ControlGuiTextRange } from './controlGuiAnnotations.ts';

export const CONTROLGUI_MARKER_HOST_ATTRIBUTE = 'data-openbitfun-controlgui-pins';
export const controlGuiMarkerClickEvent = (label: string): string =>
  `browser-controlgui-marker-click-${label}`;

interface MarkerPayload {
  label: string;
  expectedUrl: string;
  notes: { index: number; path: string; comment: string; sourceUrl: string;
    textRange?: ControlGuiTextRange }[];
}

/**
 * This function is stringified, then evaluated in the actual native WebView.
 * Do not reference variables, imported functions or values outside its body.
 */
function runControlGuiMarkers(input: MarkerPayload): void {
  type PinRuntime = {
    owner: string;
    update(notes: MarkerPayload['notes']): void;
    dispose(): void;
  };
  type PinPage = Window & {
    __openbitfunControlGuiPins?: PinRuntime;
    __TAURI_INTERNALS__?: {
      invoke?: (command: string, args: unknown) => Promise<unknown>;
    };
  };
  const page = window as PinPage;
  const attribute = 'data-openbitfun-controlgui-pins';
  const runtimeKey = page.__openbitfunControlGuiPins;

  const samePage = (a: string, b: string): boolean => {
    try {
      const left = new URL(a);
      const right = new URL(b);
      if (!['http:', 'https:'].includes(left.protocol) || !['http:', 'https:'].includes(right.protocol)) return false;
      left.hash = '';
      right.hash = '';
      return left.href === right.href;
    } catch { return false; }
  };

  if (!input.notes.length || !samePage(window.location.href, input.expectedUrl)) {
    runtimeKey?.dispose();
    return;
  }
  if (runtimeKey && runtimeKey.owner === input.label) {
    runtimeKey.update(input.notes);
    return;
  }
  runtimeKey?.dispose();

  const host = document.createElement('div');
  host.setAttribute(attribute, '');
  host.style.cssText =
    'position:fixed;inset:0;z-index:2147483645;pointer-events:none;';
  const shadow = host.attachShadow({ mode: 'closed' });
  const css = [
    ':host{all:initial}',
    '*{box-sizing:border-box}',
    '.pins{position:fixed;inset:0;pointer-events:none}',
    '.pin{position:fixed;display:none;width:25px;height:25px;place-items:center;',
    'padding:0;border:2px solid #fff;border-radius:9px 9px 9px 2px;',
    'background:#2f6bff;color:white;box-shadow:0 3px 14px rgba(6,46,96,.5);',
    'font:700 12px/1 system-ui,sans-serif;cursor:pointer;pointer-events:auto;',
    'user-select:none;-webkit-user-select:none}',
    '.pin:hover{background:#1651e8;transform:scale(1.07)}',
    '.pin:focus-visible{outline:3px solid #a3c4ff;outline-offset:2px}',
  ].join('');
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    shadow.adoptedStyleSheets = [...shadow.adoptedStyleSheets, sheet];
  } catch { /* Explicit CSSOM pin styles below handle restrictive pages. */ }
  const pins = document.createElement('div');
  pins.className = 'pins';
  pins.style.setProperty('position', 'fixed');
  pins.style.setProperty('inset', '0');
  pins.style.setProperty('pointer-events', 'none');
  shadow.append(pins);
  document.documentElement.appendChild(host);

  let notes: MarkerPayload['notes'] = [];
  let frame = 0;
  let disposed = false;

  const paint = (): void => {
    if (disposed) return;
    const onPage = samePage(window.location.href, input.expectedUrl);
    Array.from(pins.children).forEach((child, offset) => {
      const pin = child as HTMLButtonElement;
      const note = notes[offset];
      if (!onPage || !note || !samePage(note.sourceUrl, window.location.href)) {
        pin.style.display = 'none';
        return;
      }
      let element: Element | null = null;
      try { element = document.querySelector(note.path); } catch { /* Invalid selector. */ }
      if (!element) {
        pin.style.display = 'none';
        return;
      }
      let rect = element.getBoundingClientRect();
      if (note.textRange) {
        const node = element.childNodes[note.textRange.nodeIndex];
        // Never attach a left/right text annotation to the whole breadcrumb
        // if the source text changed after HMR or a page reload.
        if (!node || node.nodeType !== Node.TEXT_NODE ||
          node.textContent?.trim() !== note.textRange.text) {
          pin.style.display = 'none';
          return;
        }
        const content = node.textContent;
        const start = content.length - content.trimStart().length;
        const end = content.trimEnd().length;
        if (start >= end) { pin.style.display = 'none'; return; }
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, end);
        rect = range.getBoundingClientRect();
      }
      if (rect.width < 1 || rect.height < 1 || rect.bottom <= 0 || rect.top >= innerHeight
        || rect.right <= 0 || rect.left >= innerWidth) {
        pin.style.display = 'none';
        return;
      }
      pin.style.display = 'grid';
      pin.style.left = Math.max(3, Math.min(innerWidth - 27, rect.right - 12)) + 'px';
      pin.style.top = Math.max(3, Math.min(innerHeight - 27, rect.top - 12)) + 'px';
    });
  };

  const schedule = (): void => {
    if (disposed || frame) return;
    frame = window.requestAnimationFrame(() => { frame = 0; paint(); });
  };
  const onViewChange = (): void => { schedule(); };

  // Ignore gestures on the pin: they are UI actions, not clicks on the page.
  for (const type of ['click', 'pointerdown', 'pointerup']) {
    shadow.addEventListener(type, (event) => { event.stopPropagation(); });
  }
  const update = (next: MarkerPayload['notes']): void => {
    notes = next.slice();
    pins.replaceChildren();
    for (const note of notes) {
      const pin = document.createElement('button');
      pin.className = 'pin';
      pin.type = 'button';
      // The target page may reject dynamically injected <style> tags due to
      // CSP. Apply each important visual property independently via CSSOM.
      const pinStyles: Record<string, string> = {
        position: 'fixed', display: 'none', width: '25px', height: '25px',
        'place-items': 'center', padding: '0', border: '2px solid white',
        'border-radius': '9px 9px 9px 2px', background: '#2f6bff',
        color: '#fff', 'box-shadow': '0 3px 14px rgba(6,46,96,.5)',
        'font-size': '12px', 'font-weight': '700', 'line-height': '1',
        'font-family': 'system-ui,sans-serif', cursor: 'pointer',
        'pointer-events': 'auto', 'user-select': 'none', 'z-index': '1',
      };
      for (const [property, value] of Object.entries(pinStyles)) {
        pin.style.setProperty(property, value);
      }
      pin.textContent = String(note.index + 1);
      pin.title = '编辑第 ' + (note.index + 1) + ' 条批注：' + note.comment.slice(0, 150);
      pin.setAttribute('aria-label', pin.title);
      pin.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        const invoke = page.__TAURI_INTERNALS__?.invoke;
        if (typeof invoke !== 'function') return;
        // The host checks index and page identity again. Never trust a
        // cross-WebView event to modify persistent notes on its own.
        void invoke('plugin:event|emit', {
          event: 'browser-controlgui-marker-click-' + input.label,
          payload: { index: note.index, pageUrl: window.location.href },
        }).catch(() => {});
      });
      pins.appendChild(pin);
    }
    schedule();
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('scroll', onViewChange, true);
  window.addEventListener('resize', onViewChange);
  // Polling also covers SPA history changes without a DOM mutation.
  const routeTimer = window.setInterval(schedule, 650);

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    window.clearInterval(routeTimer);
    window.removeEventListener('scroll', onViewChange, true);
    window.removeEventListener('resize', onViewChange);
    observer.disconnect();
    if (frame) window.cancelAnimationFrame(frame);
    host.remove();
    if (page.__openbitfunControlGuiPins === current) {
      delete page.__openbitfunControlGuiPins;
    }
  };
  const current: PinRuntime = { owner: input.label, update, dispose };
  page.__openbitfunControlGuiPins = current;
  update(input.notes);
}

export function createControlGuiMarkerScript(
  label: string,
  expectedUrl: string,
  notes: readonly ControlGuiNote[],
): string {
  const input: MarkerPayload = {
    label,
    expectedUrl,
    notes: notes.map((note, index) => ({
      index,
      path: note.element.path,
      ...(note.element.textRange ? { textRange: note.element.textRange } : {}),
      sourceUrl: note.element.sourceUrl,
      comment: note.comment,
    })),
  };
  // JSON serialization keeps comments and CSS selectors as data, never code.
  return `(${runControlGuiMarkers.toString()})(${JSON.stringify(input)});`;
}
