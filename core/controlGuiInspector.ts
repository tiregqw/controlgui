/**
 * Factory that generates the element-inspector script to be eval()'d inside a
 * Tauri native Webview.
 *
 * When injected, the script:
 *  1. Adds a semi-transparent blue highlight overlay over the hovered element.
 *  2. Shows a small tooltip with the element's tag/id/class info.
 *  3. On click, captures: tagName, CSS path, attributes, textContent, outerHTML.
 *  4. Emits a Tauri event `browser-inspector-element-selected-{label}` with the
 *     captured data so the host React component can receive it.
 *  5. Pressing Escape cancels inspection and emits
 *     `browser-inspector-cancelled-{label}`.
 *  6. Exposes `window.__openbitfun_inspector_cancel` so a second eval call can
 *     programmatically cancel an active session.
 */
import { INSPECTOR_OVERLAY_THEME, designTokens } from './theme.ts';

const INSPECTOR_MONO_FONT = String(designTokens['font.family.mono']).split("'").join("\\'");

const INSPECTOR_SCRIPT_BODY = /* js */ `
(function () {
  var LABEL = window.__openbitfun_inspector_label || '';
  var ANNOTATION_MODE = window.__openbitfun_inspector_annotation_mode === true;
  if (window.__openbitfun_inspector_active) {
    // A native reload, SPA replacement, or a former context inspector may
    // leave a stale flag behind with no visible outline. Only skip an install
    // when the correct inspector's actual DOM and listeners are still alive.
    var existing = window.__openbitfun_inspector_instance;
    if (existing && existing.label === LABEL && existing.mode === ANNOTATION_MODE
      && existing.overlay && existing.overlay.isConnected
      && existing.tooltip && existing.tooltip.isConnected) return;
    try {
      if (window.__openbitfun_inspector_cancel) window.__openbitfun_inspector_cancel(false);
    } catch (e) {}
  }
  window.__openbitfun_inspector_active = true;
  var EVENT_SELECTED = 'browser-inspector-element-selected-' + LABEL;
  var EVENT_CANCELLED = 'browser-inspector-cancelled-' + LABEL;

  // ── overlay element ──────────────────────────────────────────────────────
  var overlay = document.createElement('div');
  overlay.style.cssText = [
    'position:fixed',
    'border:2px solid ${INSPECTOR_OVERLAY_THEME.activeBorder}',
    'background:${INSPECTOR_OVERLAY_THEME.activeBackground}',
    'pointer-events:none',
    'z-index:2147483646',
    'box-sizing:border-box',
    'display:none',
    'border-radius:2px',
    'transition:top 0.05s,left 0.05s,width 0.05s,height 0.05s',
  ].join(';');
  // Page CSP may reject injected CSS. Use CSSOM property writes independently.
  [
    ['position', 'fixed'],
    ['border', '2px solid ${INSPECTOR_OVERLAY_THEME.activeBorder}'],
    ['background', '${INSPECTOR_OVERLAY_THEME.activeBackground}'],
    ['pointer-events', 'none'],
    ['z-index', '2147483646'],
    ['box-sizing', 'border-box'],
    ['display', 'none'],
    ['border-radius', '5px'],
  ].forEach(function (item) { overlay.style.setProperty(item[0], item[1]); });

  if (ANNOTATION_MODE) {
    // A host page may override generic div borders/backgrounds with
    // !important. Keep the actual hover outline strong and opaque even on
    // the preview application's dark sidebar and in restrictive-CSP WebViews.
    [
      ['border', '2px solid #2f6bff'],
      ['background-color', 'rgba(47,107,255,0.09)'],
      ['box-shadow', 'none'],
      ['border-radius', '6px'],
      ['opacity', '1'],
      ['visibility', 'visible'],
      ['mix-blend-mode', 'normal'],
    ].forEach(function (item) { overlay.style.setProperty(item[0], item[1], 'important'); });
  }

  // ── tooltip element ──────────────────────────────────────────────────────
  var tooltip = document.createElement('div');
  tooltip.style.cssText = [
    'position:fixed',
    'background:${INSPECTOR_OVERLAY_THEME.browserTooltipBackground}',
    'color:${INSPECTOR_OVERLAY_THEME.tooltipText}',
    'padding:3px 8px',
    'border-radius:4px',
    'font-size:${designTokens['font.size.xs']}',
    'font-family:${INSPECTOR_MONO_FONT}',
    'z-index:2147483647',
    'pointer-events:none',
    'display:none',
    'max-width:480px',
    'white-space:nowrap',
    'box-shadow:0 2px 8px ${INSPECTOR_OVERLAY_THEME.tooltipShadow}',
    'line-height:${designTokens['lineHeight.relaxed']}',
  ].join(';');
  [
    ['position', 'fixed'],
    ['background', '${INSPECTOR_OVERLAY_THEME.browserTooltipBackground}'],
    ['color', '${INSPECTOR_OVERLAY_THEME.tooltipText}'],
    ['padding', '5px 9px'],
    ['border-radius', '8px'],
    ['font-size', '12px'],
    ['font-family', 'ui-monospace,monospace'],
    ['z-index', '2147483647'],
    ['pointer-events', 'none'],
    ['display', 'none'],
    ['max-width', 'min(360px, calc(100vw - 16px))'],
    ['white-space', 'nowrap'],
    ['overflow', 'hidden'],
    ['text-overflow', 'ellipsis'],
    ['box-shadow', '0 6px 18px rgba(15,23,42,.28)'],
  ].forEach(function (item) { tooltip.style.setProperty(item[0], item[1]); });

  if (ANNOTATION_MODE) {
    // The inspected page can be very dark (including its sidebar). Keep
    // ControlGUI's compact inspector hint fully opaque and high-contrast.
    // Use CSSOM with !important so broad page styles cannot wash it out.
    [
      ['background-color', '#050a12'],
      ['color', '#f8fafc'],
      ['border', '1px solid #7589aa'],
      ['box-shadow', '0 10px 28px rgba(0,0,0,0.58)'],
      ['opacity', '1'],
      ['mix-blend-mode', 'normal'],
      ['isolation', 'isolate'],
      ['padding', '6px 10px'],
      ['border-radius', '9px'],
      ['line-height', '1.45'],
    ].forEach(function (item) { tooltip.style.setProperty(item[0], item[1], 'important'); });
  }

  document.documentElement.appendChild(overlay);
  document.documentElement.appendChild(tooltip);
  window.__openbitfun_inspector_instance = {
    label: LABEL, mode: ANNOTATION_MODE, overlay: overlay, tooltip: tooltip
  };

  var hoveredEl = null;
  var hoveredTextRange = null;
  // Only the pointer-transparent overlay owns the selection frame. Applying a
  // second box-shadow directly to the inspected node produced nested blue
  // borders and even polluted captured outerHTML/style attributes.

  // ── helpers ───────────────────────────────────────────────────────────────
  function cssPath(el) {
    var parts = [];
    var cur = el;
    while (cur && cur.nodeType === 1 && cur !== document.documentElement) {
      var seg = cur.tagName.toLowerCase();
      if (cur.id) {
        try { seg += '#' + CSS.escape(cur.id); }
        catch (e) { seg += '#' + cur.id.replace(/[^a-zA-Z0-9_-]/g, function (ch) { return String.fromCharCode(92) + ch; }); }
        parts.unshift(seg);
        break;
      }
      if (cur.parentElement) {
        var siblings = Array.prototype.filter.call(
          cur.parentElement.children,
          function (s) { return s.tagName === cur.tagName; }
        );
        if (siblings.length > 1) {
          seg += ':nth-of-type(' + (siblings.indexOf(cur) + 1) + ')';
        }
      }
      // Arbitrary CSS class names may contain ':' or '/' (e.g. Tailwind
      // variants). An unescaped path is not querySelector-safe and silently
      // prevents the annotation editor from finding the clicked target.
      var classes = Array.prototype.map.call(
        Array.prototype.slice.call(cur.classList, 0, 3),
        function (name) {
          try { return CSS.escape(name); }
          catch (e) { return name.replace(/[^a-zA-Z0-9_-]/g, function (ch) { return String.fromCharCode(92) + ch; }); }
        }
      ).join('.');
      if (classes) seg += '.' + classes;
      parts.unshift(seg);
      cur = cur.parentElement;
    }
    return parts.join(' > ') || 'html';
  }

  function getAttrs(el) {
    var attrs = {};
    for (var i = 0; i < el.attributes.length; i++) {
      attrs[el.attributes[i].name] = el.attributes[i].value;
    }
    return attrs;
  }

  function tooltipText(el) {
    var tag = el.tagName.toLowerCase();
    var id = el.id ? '#' + el.id : '';
    var cls = el.classList.length
      ? '.' + Array.prototype.slice.call(el.classList, 0, 3).join('.')
      : '';
    return tag + id + cls;
  }

  function containsPointer(el, x, y) {
    if (!(el instanceof Element) || !el.isConnected) return false;
    var style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) return false;
    var rects = el.getClientRects();
    for (var i = 0; i < rects.length; i++) {
      var r = rects[i];
      if (r.width > 0 && r.height > 0 &&
        x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
    }
    // WebView elements with a non-standard client rect list may still have
    // valid bounding boxes, including inline labels and progress controls.
    var rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 &&
      x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function smallestElementAt(root, x, y) {
    if (!containsPointer(root, x, y)) return root;
    var best = root;
    var bestArea = root.getBoundingClientRect().width * root.getBoundingClientRect().height;
    var bestDepth = 0;
    var remaining = 600;
    function walk(node, depth) {
      if (--remaining < 0) return;
      // display:contents has no own box but its children are visible.
      var inside = containsPointer(node, x, y);
      if (!inside && window.getComputedStyle(node).display !== 'contents') return;
      var tag = node.tagName.toLowerCase();
      var candidate = /^(path|rect|circle|line|polyline|polygon|g|use)$/.test(tag)
        ? (node.closest('svg') || node) : node;
      var rect = candidate.getBoundingClientRect();
      var area = rect.width * rect.height;
      if (inside && area >= 1 && (area < bestArea - 1 || (Math.abs(area - bestArea) <= 1 && depth > bestDepth))) {
        best = candidate;
        bestArea = area;
        bestDepth = depth;
      }
      var children = node.shadowRoot ? node.shadowRoot.children : node.children;
      for (var i = children.length - 1; i >= 0 && remaining > 0; i--) walk(children[i], depth + 1);
    }
    walk(root, 0);
    return best;
  }

  function selectableElement(event) {
    var path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    var el = path.find(function (node) { return node instanceof Element; }) || event.target;
    if (!(el instanceof Element)) return null;
    if (ANNOTATION_MODE) {
      // SVG drawing primitives belong to the icon, not the surrounding button.
      if (el instanceof SVGElement && el.tagName.toLowerCase() !== 'svg') {
        el = el.closest('svg') || el;
      }
      if (Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
        el = smallestElementAt(el, event.clientX, event.clientY);
      }
      // Never promote a label, icon or badge to its enclosing native control.
      // Clicking the control's padding still selects the whole control.
    }
    return el;
  }

  // A breadcrumb can be one span with two separate direct text nodes:
  // <span id="breadcrumb">Workspace <span>/</span> Dashboard</span>.
  // Element-only hit testing selects the entire span in both cases.
  // Text-node anchors remain stable without mutating the target DOM.
  function fragmentRect(el, fragment) {
    if (!fragment || !Number.isInteger(fragment.nodeIndex)) return null;
    var node = el.childNodes[fragment.nodeIndex];
    if (!node || node.nodeType !== 3 || !node.textContent ||
      node.textContent.trim() !== fragment.text) return null;
    var content = node.textContent;
    var start = content.length - content.trimStart().length;
    var end = content.trimEnd().length;
    if (start >= end) return null;
    var range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    if (typeof range.getBoundingClientRect !== 'function') return null;
    var rect = range.getBoundingClientRect();
    return rect.width > 1 && rect.height > 1 ? rect : null;
  }

  function textAtPoint(el, x, y) {
    if (!ANNOTATION_MODE) return null;
    var children = el.childNodes;
    // On padded buttons/links, even a single text node is a useful target.
    // Other single-text elements already have an independent DOM box.
    if (!children.length || children.length > 80 ||
      (children.length === 1 && !el.matches('button,a,[role="button"],[role="link"]'))) return null;
    for (var i = 0; i < children.length; i++) {
      var node = children[i];
      if (node.nodeType !== 3) continue;
      var text = (node.textContent || '').trim();
      if (!text || text.length > 240) continue;
      var fragment = { nodeIndex: i, text: text };
      var rect = fragmentRect(el, fragment);
      if (rect && x >= rect.left && x <= rect.right &&
        y >= rect.top && y <= rect.bottom) return fragment;
    }
    return null;
  }

  function selectionAtEvent(event) {
    var el = selectableElement(event);
    if (!el) return null;
    var fragment = ANNOTATION_MODE && Number.isFinite(event.clientX) &&
      Number.isFinite(event.clientY) ? textAtPoint(el, event.clientX, event.clientY) : null;
    return { element: el, textRange: fragment };
  }

  function blueColor(value) {
    var matches = String(value || '').matchAll(/rgba?\\(\\s*([\\d.]+)[,\\s]+([\\d.]+)[,\\s]+([\\d.]+)(?:[,\\s\\/]+([\\d.]+))?\\s*\\)/gi);
    for (var parts of matches) {
      var r = Number(parts[1]), g = Number(parts[2]), b = Number(parts[3]);
      var a = parts[4] === undefined ? 1 : Number(parts[4]);
      if (a >= .35 && b >= 145 && b > r + 60 && b > g + 30) return true;
    }
    return false;
  }

  function hasBlueFrame(el, rect) {
    for (var node = el, depth = 0; node instanceof Element && depth < 5; node = node.parentElement, depth++) {
      var b = node.getBoundingClientRect();
      if (Math.abs(b.left - rect.left) > 12 || Math.abs(b.top - rect.top) > 12 ||
        Math.abs(b.right - rect.right) > 12 || Math.abs(b.bottom - rect.bottom) > 12) break;
      var css = window.getComputedStyle(node);
      if (blueColor(css.boxShadow) || blueColor(css.filter)) return true;
      if (parseFloat(css.outlineWidth) >= 1 && css.outlineStyle !== 'none' && blueColor(css.outlineColor)) return true;
      if (['Top', 'Right', 'Bottom', 'Left'].some(function (side) {
        return parseFloat(css['border' + side + 'Width']) >= 1 &&
          css['border' + side + 'Style'] !== 'none' && blueColor(css['border' + side + 'Color']);
      })) return true;
    }
    return false;
  }

  // Turning on annotation happens from BitFun's toolbar, outside the page
  // WebView. No pointermove is dispatched into the page at that moment.
  // Show an initial, visible selection immediately instead of a blank page;
  // the next actual pointer move will take over naturally.
  function visibleSelectionCandidate(el) {
    if (!(el instanceof HTMLElement || el instanceof SVGElement)) return false;
    if (el.closest('[data-openbitfun-controlgui-editor],[data-openbitfun-controlgui-pins]')) return false;
    var rect = el.getBoundingClientRect();
    if (rect.width < 6 || rect.height < 6) return false;
    if (rect.bottom <= 0 || rect.right <= 0 || rect.top >= innerHeight || rect.left >= innerWidth) return false;
    var computed = window.getComputedStyle(el);
    return computed.display !== 'none' && computed.visibility !== 'hidden';
  }

  function showInitialSelection() {
    if (!ANNOTATION_MODE || hoveredEl) return;
    var groups = [
      'button,[role="button"],a[href],input:not([type="hidden"]),textarea,select',
      'h1,h2,h3',
      'main,[role="main"]',
    ];
    for (var group = 0; group < groups.length; group++) {
      var candidates = document.querySelectorAll(groups[group]);
      for (var i = 0; i < candidates.length; i++) {
        var candidate = candidates[i];
        if (!visibleSelectionCandidate(candidate)) continue;
        hoveredEl = candidate;
        hoveredTextRange = null;
        updateOverlay(candidate);
        return;
      }
    }
    // Empty or not-yet-rendered page: keep an instruction visible. Once a
    // visible element mounts, a pointer move or DOM-ready event picks it.
    tooltip.textContent = '移动鼠标选择网页元素，点击添加批注';
    tooltip.style.top = '12px';
    tooltip.style.left = '12px';
    tooltip.style.display = 'block';
  }

  function updateOverlay(el, fragment) {
    if (!el) {
      overlay.style.display = 'none';
      tooltip.style.display = 'none';
      return;
    }
    var rect = fragmentRect(el, fragment) || el.getBoundingClientRect();
    overlay.style.display = 'block';
    overlay.style.top = rect.top + 'px';
    overlay.style.left = rect.left + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';

    if (ANNOTATION_MODE) {
      // Existing blue borders/shadows already provide the outline.
      overlay.style.setProperty('border-color',
        !fragment && hasBlueFrame(el, rect) ? 'transparent' : '#2f6bff', 'important');
      // Hover: blue frame plus a compact, dark, two-line element hint.
      // Click the element before opening a persistent white annotation editor.
      var heading = document.createElement('div');
      var tag = document.createElement('span');
      tag.textContent = el.tagName.toLowerCase();
      tag.style.setProperty('color', '#7fb0ff', 'important');
      tag.style.setProperty('font-weight', '700');
      var dimensions = document.createElement('span');
      dimensions.textContent = '  ' + Math.round(rect.width) + ' × ' + Math.round(rect.height);
      dimensions.style.setProperty('color', '#c9d6ea', 'important');
      heading.appendChild(tag);
      heading.appendChild(dimensions);
      var path = document.createElement('div');
      path.textContent = cssPath(el) + (fragment ? ' · 文本「' + fragment.text.slice(0, 48) + '」' : '');
      path.style.setProperty('margin-top', '3px');
      path.style.setProperty('font-size', '12px');
      path.style.setProperty('font-weight', '500');
      path.style.setProperty('color', '#e6edf9', 'important');
      path.style.setProperty('overflow', 'hidden');
      path.style.setProperty('text-overflow', 'ellipsis');
      tooltip.replaceChildren(heading, path);
    } else {
      tooltip.textContent = tooltipText(el);
    }
    tooltip.style.display = 'block';
    var tooltipHeight = ANNOTATION_MODE ? 53 : 26;
    var ty = rect.bottom + 7;
    if (ty + tooltipHeight > window.innerHeight - 4) ty = rect.top - tooltipHeight - 6;
    if (ty < 4) ty = 4;
    var tx = rect.left;
    var tooltipWidth = Math.max(200, tooltip.offsetWidth || 300);
    if (tx + tooltipWidth > window.innerWidth - 4) tx = window.innerWidth - tooltipWidth - 4;
    if (tx < 4) tx = 4;
    tooltip.style.top = ty + 'px';
    tooltip.style.left = tx + 'px';
  }

  function emitTauri(eventName, payload) {
    var internals = window.__TAURI_INTERNALS__;
    if (!internals) return;
    try {
      if (typeof internals.invoke === 'function') {
        internals.invoke('plugin:event|emit', { event: eventName, payload: payload }).catch(function () {});
      }
    } catch (e) {}
  }

  // ── cleanup ───────────────────────────────────────────────────────────────
  function cleanup() {
    document.removeEventListener('DOMContentLoaded', showInitialSelection);
    document.removeEventListener('mouseover', onMouseOver, true);
    document.removeEventListener('pointermove', onPointerMove, true);
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('scroll', onViewportChange, true);
    window.removeEventListener('resize', onViewportChange);
    try { overlay.parentNode && overlay.parentNode.removeChild(overlay); } catch (e) {}
    try { tooltip.parentNode && tooltip.parentNode.removeChild(tooltip); } catch (e) {}
    delete window.__openbitfun_inspector_active;
    delete window.__openbitfun_inspector_cancel;
    delete window.__openbitfun_inspector_instance;
    delete window.__openbitfun_inspector_label;
    delete window.__openbitfun_inspector_hide_metadata;
    delete window.__openbitfun_inspector_annotation_mode;
  }

  // ── event handlers ────────────────────────────────────────────────────────
  function onMouseOver(e) {
    // ControlGUI's numbered pins are UI controls, not inspectable page nodes.
    // A document capture listener receives shadow-root events before the pin.
    if (e.composedPath && e.composedPath().some(function (node) {
      return node && node.hasAttribute && (
        node.hasAttribute('data-openbitfun-controlgui-pins') ||
        node.hasAttribute('data-openbitfun-controlgui-editor')
      );
    })) return;
    var target = selectionAtEvent(e);
    var el = target && target.element;
    if (el === overlay || el === tooltip) return;
    if (!el || el === document.documentElement || el === document.body) return;
    var fragment = target.textRange;
    if (hoveredEl === el && ((hoveredTextRange === null && fragment === null) ||
      (hoveredTextRange && fragment && hoveredTextRange.nodeIndex === fragment.nodeIndex &&
        hoveredTextRange.text === fragment.text))) return;
    hoveredEl = el;
    hoveredTextRange = fragment;
    updateOverlay(el, fragment);
  }

  function onPointerMove(e) {
    if (ANNOTATION_MODE) onMouseOver(e);
  }

  function onViewportChange() {
    if (!hoveredEl) return;
    if (!hoveredEl.isConnected) {
      hoveredEl = null;
      hoveredTextRange = null;
      updateOverlay(null);
      return;
    }
    updateOverlay(hoveredEl, hoveredTextRange);
  }

  function onPointerDown(e) {
    if (!ANNOTATION_MODE || e.button !== 0) return;
    if (e.composedPath && e.composedPath().some(function (node) {
      return node && node.hasAttribute && (
        node.hasAttribute('data-openbitfun-controlgui-pins') ||
        node.hasAttribute('data-openbitfun-controlgui-editor')
      );
    })) return;
    if (!selectableElement(e)) return;
    // Selecting a page button must never accidentally trigger the page action.
    e.preventDefault();
    e.stopImmediatePropagation();
    window.getSelection()?.removeAllRanges();
  }

  function onClick(e) {
    if (e.composedPath && e.composedPath().some(function (node) {
      return node && node.hasAttribute && (
        node.hasAttribute('data-openbitfun-controlgui-pins') ||
        node.hasAttribute('data-openbitfun-controlgui-editor')
      );
    })) return;
    // Dark tooltip is pointer-transparent. Selecting the actual page element
    // opens the persistent white annotation editor through the host.
    var target = ANNOTATION_MODE ? selectionAtEvent(e) : null;
    var chosen = ANNOTATION_MODE ? target && target.element : hoveredEl;
    if (!chosen) return;
    e.preventDefault();
    e.stopImmediatePropagation();

    // The page DOM is never mutated for highlighting, so captured HTML keeps
    // its original styles rather than including inspector-owned blue rings.
    var data = {
      // Capture the URL from the clicked document itself. The host address bar
      // can show an optimistic URL while the native page is still the old one.
      pageUrl: window.location.href,
      tagName: chosen.tagName.toLowerCase(),
      path: cssPath(chosen),
      attributes: getAttrs(chosen),
      textContent: target && target.textRange ? target.textRange.text :
        (chosen.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 500),
      outerHTML: (chosen.outerHTML || '').slice(0, 2000),
    };
    if (target && target.textRange) data.textRange = target.textRange;
    // New-note editor stays open while the user refines the target. Transfer
    // its unsaved text to the host for the next floating editor instance.
    if (ANNOTATION_MODE && window.__openbitfunControlGuiFloatingEditor &&
      typeof window.__openbitfunControlGuiFloatingEditor.draftText === 'function') {
      data.draftComment = window.__openbitfunControlGuiFloatingEditor.draftText().slice(0, 3000);
    }
    emitTauri(EVENT_SELECTED, data);

    overlay.style.setProperty('border-color', '${INSPECTOR_OVERLAY_THEME.selectedBorder}', 'important');
    overlay.style.setProperty('background-color', '${INSPECTOR_OVERLAY_THEME.selectedBackground}', 'important');
    setTimeout(function () {
      overlay.style.setProperty('border-color', '#2f6bff', 'important');
      overlay.style.setProperty('background-color', 'rgba(47,107,255,0.09)', 'important');
    }, 300);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      emitTauri(EVENT_CANCELLED, null);
      cleanup();
    }
  }

  window.__openbitfun_inspector_cancel = function (notify) {
    if (notify !== false) emitTauri(EVENT_CANCELLED, null);
    cleanup();
  };

  document.addEventListener('mouseover', onMouseOver, true);
  document.addEventListener('pointermove', onPointerMove, true);
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('scroll', onViewportChange, true);
  window.addEventListener('resize', onViewportChange);
  if (ANNOTATION_MODE) {
    showInitialSelection();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', showInitialSelection, { once: true });
    }
  }
})();
`;

/**
 * Returns the JavaScript string to eval() inside the Tauri embedded webview.
 *
 * @param webviewLabel  The label of the webview whose events should be listened to.
 */
export function createInspectorScript(webviewLabel: string, annotationMode = false): string {
  // Inject the label as a global before the IIFE runs.
  return `window.__openbitfun_inspector_label = ${JSON.stringify(webviewLabel)};\nwindow.__openbitfun_inspector_annotation_mode = ${JSON.stringify(annotationMode)};\n${INSPECTOR_SCRIPT_BODY}`;
}

/** Suspend page picking while an in-page annotation card is open, keeping
 * the host-side listener and annotation mode alive for the next selection. */
export const PAUSE_INSPECTOR_SCRIPT =
  `if (window.__openbitfun_inspector_cancel) { window.__openbitfun_inspector_cancel(false); }`;

/** Script to cancel an active inspector session without triggering a selection. */
export const CANCEL_INSPECTOR_SCRIPT =
  `if (window.__openbitfun_inspector_cancel) { window.__openbitfun_inspector_cancel(); }`;
