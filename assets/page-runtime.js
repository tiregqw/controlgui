// DSH shared ControlGUI package SHA256: d0caf93c23de482ef9f78a2f906249d040a8339039d4e2d64c8bd5a9104f9ace
if(new URLSearchParams(location.search).get("mode")==="harmony"){
/**
 * Codex-style in-page annotation runtime for local DSH GUI previews.
 *
 * Served by the codex-visual-preview sidecar and injected into every previewed
 * HTML document. All UI lives in one open shadow root; the previewed project's
 * own DOM and styles are never rewritten.
 */
(() => {
  if (globalThis.__dshCodexGui === true) return
  globalThis.__dshCodexGui = true

  const MAX_NOTES = 20
  const BLUE = '#2f6bff'
  const state = { enabled: false, notes: [], sending: false, hovered: null, selected: null, selectedSelector: null, editing: null }
  let parentOrigin = null
  let nonce = null
  let frameRequest = 0
  let stopped = false

  // ------------------------------------------------------------------ shadow host

  const host = document.createElement('div')
  host.setAttribute('data-dsh-codex-gui', 'host')
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;'
  const shadow = host.attachShadow({ mode: 'open' })

  const style = document.createElement('style')
  style.textContent = [
    ':host{all:initial}',
    '*{box-sizing:border-box}',
    '.spot{position:fixed;inset:0;width:100%;height:100%;display:none;pointer-events:none}',
    '.tip{position:fixed;display:none;max-width:280px;padding:7px 9px;border-radius:8px;background:#111b30;',
    'color:#f4f8ff;box-shadow:0 8px 28px rgba(0,0,0,.38);font:11px/1.55 ui-sans-serif,system-ui,sans-serif;',
    'white-space:pre-wrap;pointer-events:none;overflow:hidden;text-overflow:ellipsis}',
    '.tip strong{display:block;font-weight:700;color:#8ab4ff;margin-bottom:2px}',
    '.bar{position:fixed;left:50%;bottom:12px;transform:translateX(-50%);display:flex;align-items:center;gap:6px;',
    'padding:5px 7px;border-radius:999px;background:rgba(17,27,48,.92);color:#f4f8ff;',
    'box-shadow:0 6px 24px rgba(0,0,0,.35);font:12px/1.4 ui-sans-serif,system-ui,sans-serif;',
    'pointer-events:auto;z-index:3;max-width:calc(100vw - 20px);flex-wrap:wrap;justify-content:center}',
    '.bar button{border:0;border-radius:999px;padding:4px 9px;font:600 12px/1.3 ui-sans-serif,system-ui,sans-serif;',
    'cursor:pointer;background:#26314b;color:#e8eeff}',
    '.bar button[aria-pressed="true"]{background:' + BLUE + ';color:#fff}',
    '.bar button:disabled{opacity:.45;cursor:default}',
    '.bar .count{opacity:.8;font-variant-numeric:tabular-nums}',
    '.bar .status{max-width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.85}',
    '.markers{position:fixed;inset:0;pointer-events:none;z-index:2}',
    '.pin{position:fixed;display:none;width:25px;height:25px;place-items:center;padding:0;border:2px solid #fff;',
    'border-radius:9px 9px 9px 2px;background:' + BLUE + ';color:#fff;box-shadow:0 3px 14px rgba(6,46,96,.5);',
    'font:700 12px/1 system-ui,sans-serif;cursor:pointer;pointer-events:auto}',
    '.editor{position:fixed;display:none;width:300px;padding:10px;border-radius:12px;background:#fff;',
    'box-shadow:0 14px 40px rgba(15,23,42,.28);border:1px solid #dbe2f2;z-index:4;pointer-events:auto;',
    'font:12px/1.5 ui-sans-serif,system-ui,sans-serif;color:#26314b}',
    '.editor header{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px}',
    '.editor header span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#64708c;font-size:11px}',
    '.editor textarea{width:100%;min-height:64px;resize:vertical;border:1px solid #d7dded;border-radius:8px;',
    'padding:7px 8px;font:13px/1.5 ui-sans-serif,system-ui,sans-serif;color:#1f2937;outline:none}',
    '.editor textarea:focus{border-color:' + BLUE + ';box-shadow:0 0 0 3px rgba(47,107,255,.14)}',
    '.editor .row{display:flex;gap:6px;justify-content:flex-end;margin-top:8px}',
    '.editor button{border:1px solid #d7dded;background:#fff;color:#2b3550;border-radius:8px;padding:4px 10px;',
    'font:600 12px/1.4 ui-sans-serif,system-ui,sans-serif;cursor:pointer}',
    '.editor button.primary{background:' + BLUE + ';border-color:' + BLUE + ';color:#fff}',
    '.editor button.danger{color:#b42318}',
    '.editor button:disabled{opacity:.45;cursor:default}',
  ].join('')
  shadow.appendChild(style)

  const ns = 'http://www.w3.org/2000/svg'
  const svg = (name, attrs) => {
    const node = document.createElementNS(ns, name)
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value))
    return node
  }
  const hole = svg('rect', { rx: 4, fill: '#000', x: 0, y: 0, width: 0, height: 0 })
  const mask = svg('mask', { id: 'dsh-codex-mask', maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: '100%', height: '100%' })
  mask.append(svg('rect', { x: 0, y: 0, width: '100%', height: '100%', fill: '#fff' }), hole)
  const defs = svg('defs', {})
  defs.appendChild(mask)
  const dim = svg('rect', { x: 0, y: 0, width: '100%', height: '100%', fill: 'rgba(15,23,42,.24)', mask: 'url(#dsh-codex-mask)' })
  const ring = svg('rect', { rx: 4, fill: 'none', stroke: BLUE, 'stroke-width': 2, x: 0, y: 0, width: 0, height: 0 })
  const spot = svg('svg', { class: 'spot' })
  spot.append(defs, dim, ring)

  const tip = document.createElement('div')
  tip.className = 'tip'
  const tipTitle = document.createElement('strong')
  const tipMeta = document.createElement('span')
  tip.append(tipTitle, tipMeta)

  const markers = document.createElement('div')
  markers.className = 'markers'

  const editor = document.createElement('div')
  editor.className = 'editor'
  const editorHead = document.createElement('header')
  const editorTag = document.createElement('span')
  const editorClose = document.createElement('button')
  editorClose.type = 'button'
  editorClose.textContent = '×'
  editorClose.title = '取消'
  editorHead.append(editorTag, editorClose)
  const textarea = document.createElement('textarea')
  textarea.maxLength = 3000
  textarea.placeholder = '例如：这个按钮改成绿色，圆角调整为 12px'
  const editorRow = document.createElement('div')
  editorRow.className = 'row'
  const removeButton = document.createElement('button')
  removeButton.type = 'button'
  removeButton.className = 'danger'
  removeButton.textContent = '删除'
  const cancelButton = document.createElement('button')
  cancelButton.type = 'button'
  cancelButton.textContent = '取消'
  const saveButton = document.createElement('button')
  saveButton.type = 'button'
  saveButton.className = 'primary'
  saveButton.textContent = '保存批注'
  editorRow.append(removeButton, cancelButton, saveButton)
  editor.append(editorHead, textarea, editorRow)

  const bar = document.createElement('div')
  bar.className = 'bar'
  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.textContent = '◎ 批注'
  toggle.title = '启用网页元素检查与可视化批注'
  const count = document.createElement('span')
  count.className = 'count'
  count.textContent = '0 条'
  const sendButton = document.createElement('button')
  sendButton.type = 'button'
  sendButton.textContent = '发送给 Agent'
  sendButton.disabled = true
  const clearButton = document.createElement('button')
  clearButton.type = 'button'
  clearButton.textContent = '清空批注'
  clearButton.title = '只清空预览中的批注，不会删除 DSH 聊天输入框中的文字'
  const status = document.createElement('span')
  status.className = 'status'
  bar.append(toggle, count, sendButton, clearButton, status)

  shadow.append(spot, tip, markers, editor, bar)
  // Keep our own gestures out of the previewed page's handlers.
  for (const type of ['click', 'pointerdown', 'keydown']) {
    shadow.addEventListener(type, (event) => { event.stopPropagation() })
  }
  document.documentElement.appendChild(host)

  const cursorStyle = document.createElement('style')
  cursorStyle.textContent = 'html[data-dsh-codex-annotating],html[data-dsh-codex-annotating] *{cursor:crosshair !important}'
  document.documentElement.appendChild(cursorStyle)

  // ------------------------------------------------------------------ helpers

  const insideUi = (event) => event.composedPath().includes(host)

  const cssEscape = (value) => {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value)
    return value.replace(/[^a-zA-Z0-9_-]/g, ch => '\\' + ch)
  }

  const segment = (element) => {
    const tag = element.tagName.toLowerCase()
    if (element.id) return tag + '#' + cssEscape(element.id)
    let part = tag
    const classes = Array.from(element.classList).filter(name => /^[a-zA-Z0-9_-]+$/.test(name)).slice(0, 2)
    if (classes.length > 0) part += '.' + classes.map(cssEscape).join('.')
    const parent = element.parentElement
    if (parent !== null) {
      const same = Array.from(parent.children).filter(child => child.tagName === element.tagName)
      if (same.length > 1) part += ':nth-of-type(' + String(same.indexOf(element) + 1) + ')'
    }
    return part
  }

  const selectorFor = (element) => {
    const chains = []
    let node = element
    while (node !== null && node.nodeType === 1) {
      const chain = []
      let cursor = node
      while (cursor !== null && cursor.nodeType === 1) {
        chain.unshift(segment(cursor))
        if (cursor.id) break
        const parent = cursor.parentElement
        if (parent === null || parent === document.documentElement) break
        cursor = parent
        if (chain.length >= 12) break
      }
      chains.unshift(chain.join(' > '))
      const root = node.getRootNode()
      if (typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot) {
        node = root.host
        continue
      }
      break
    }
    return chains.join(' >>> ').slice(0, 600)
  }

  const findBySelector = (selector) => {
    try {
      const chains = selector.split(' >>> ')
      let scope = document
      let found = null
      for (let index = 0; index < chains.length; index += 1) {
        const chain = chains[index]
        if (chain === undefined) return null
        found = scope.querySelector(chain)
        if (found === null) return null
        const last = index === chains.length - 1
        if (!last) {
          const next = found.shadowRoot
          if (next === null || next === undefined) return null
          scope = next
        }
      }
      return found
    } catch {
      return null
    }
  }

  // Source hints are best-effort evidence, not authoritative paths. In dev mode
  // React Fiber and Vue component instances may expose their original file.
  const sourceFileFor = (element) => {
    let node = element
    for (let depth = 0; node !== null && depth < 12; depth += 1, node = node.parentElement) {
      for (const attr of ['data-source-file', 'data-component-file']) {
        const file = node.getAttribute(attr)
        if (file && !/[\r\n]/.test(file)) return file.slice(0, 500)
      }
      const vue = node.__vueParentComponent || node.__vnode?.component
      const vueFile = vue?.type?.__file || vue?.vnode?.type?.__file || node.__vnode?.type?.__file
      if (typeof vueFile === 'string') return vueFile.slice(0, 500)
      for (const key of Object.keys(node).filter(value => value.startsWith('__reactFiber$'))) {
        let fiber = node[key]
        for (let hop = 0; fiber && hop < 30; hop += 1, fiber = fiber.return) {
          const source = fiber._debugSource?.fileName || fiber.type?.__source?.fileName
          if (typeof source === 'string') return source.slice(0, 500)
        }
      }
    }
    return ''
  }

  const pageKey = () => (location.pathname + location.search + location.hash).slice(0, 500)
  const noteIsOnCurrentPage = (note) => note.element.page === pageKey()

  const elementInfo = (element) => ({
    tag: element.tagName.toLowerCase(),
    selector: selectorFor(element),
    text: (element.innerText || '').slice(0, 700),
    html: (element.outerHTML || '').slice(0, 2400),
    page: pageKey(),
    sourceHint: sourceFileFor(element),
  })

  const visibleRect = (element) => {
    if (!(element instanceof Element) || !element.isConnected) return null
    const rect = element.getBoundingClientRect()
    if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height)) return null
    if (rect.width < 1 || rect.height < 1) return null
    if (rect.bottom < 0 || rect.top > innerHeight || rect.right < 0 || rect.left > innerWidth) return null
    return rect
  }

  const setNotice = (text) => { status.textContent = text }

  const updateBar = () => {
    count.textContent = String(state.notes.length) + ' 条'
    sendButton.disabled = state.notes.length === 0 || state.sending
    sendButton.textContent = state.sending ? '发送中…' : '发送给 Agent'
    clearButton.style.display = state.notes.length === 0 ? 'none' : ''
    toggle.setAttribute('aria-pressed', String(state.enabled))
    toggle.textContent = state.enabled ? '退出批注' : '◎ 批注'
  }

  const hideSpot = () => {
    spot.style.display = 'none'
    tip.style.display = 'none'
  }

  // Some components already paint a blue focus/selected frame. A second
  // SVG frame looks like nested blue rectangles, especially around spans.
  // Reuse their native border, outline or box-shadow instead of adding ours.
  const blueColor = (value) => {
    const matches = String(value || '').matchAll(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s\/]+([\d.]+))?\s*\)/gi)
    for (const parts of matches) {
      const r = Number(parts[1])
      const g = Number(parts[2])
      const b = Number(parts[3])
      const alpha = parts[4] === undefined ? 1 : Number(parts[4])
      if (alpha >= .35 && b >= 145 && b > r + 60 && b > g + 30) return true
    }
    return false
  }
  const styleHasBlueFrame = (css) => {
    const sides = ['Top', 'Right', 'Bottom', 'Left']
    if (sides.some(side => Number.parseFloat(css['border' + side + 'Width']) >= 1 &&
      css['border' + side + 'Style'] !== 'none' && blueColor(css['border' + side + 'Color']))) return true
    if (Number.parseFloat(css.outlineWidth) >= 1 &&
      css.outlineStyle !== 'none' && blueColor(css.outlineColor)) return true
    return blueColor(css.boxShadow) || blueColor(css.filter)
  }
  const hasBlueBorder = (element, rect) => {
    // A parent can draw the blue frame around an inline child. Only inspect
    // ancestors with nearly the same geometry, not an entire selected card.
    for (let node = element, depth = 0; node instanceof Element && depth < 5; node = node.parentElement, depth += 1) {
      const bounds = node.getBoundingClientRect()
      if (Math.abs(bounds.left - rect.left) > 12 ||
        Math.abs(bounds.top - rect.top) > 12 ||
        Math.abs(bounds.right - rect.right) > 12 ||
        Math.abs(bounds.bottom - rect.bottom) > 12) break
      if (styleHasBlueFrame(getComputedStyle(node)) ||
        styleHasBlueFrame(getComputedStyle(node, '::before')) ||
        styleHasBlueFrame(getComputedStyle(node, '::after'))) return true
    }
    return false
  }

  const showSpot = (rect, element) => {
    spot.style.display = 'block'
    ring.setAttribute('stroke', hasBlueBorder(element, rect) ? 'none' : BLUE)
    for (const node of [hole, ring]) {
      node.setAttribute('x', String(rect.left))
      node.setAttribute('y', String(rect.top))
      node.setAttribute('width', String(rect.width))
      node.setAttribute('height', String(rect.height))
    }
    tipTitle.textContent = element.tagName.toLowerCase() + '  ' + String(Math.round(rect.width)) + ' × ' + String(Math.round(rect.height))
    tipMeta.textContent = selectorFor(element)
    tip.style.display = 'block'
    const info = tip.getBoundingClientRect()
    const top = rect.top >= info.height + 12 ? rect.top - info.height - 8 : Math.min(innerHeight - info.height - 4, rect.bottom + 8)
    tip.style.top = String(Math.max(4, top)) + 'px'
    tip.style.left = String(Math.max(4, Math.min(rect.left, innerWidth - info.width - 8))) + 'px'
  }

  const paint = () => {
    if (stopped) return
    // While creating a note, hover can refine the clicked selection.
    const drafting = state.selected !== null && state.editing === null
    const active = drafting ? (state.hovered ?? state.selected) : (state.selected ?? state.hovered)
    const rect = active === null ? null : visibleRect(active)
    if (state.enabled && rect !== null && active !== null) showSpot(rect, active)
    else if (state.editing === null) hideSpot()
    updatePins()
  }

  const schedule = () => {
    if (frameRequest !== 0) return
    const queueFrame = globalThis.requestAnimationFrame ?? (callback => setTimeout(callback, 16))
    frameRequest = queueFrame(() => { frameRequest = 0; paint() })
  }

  // ------------------------------------------------------------------ editor

  const closeEditor = () => {
    state.selectedSelector = null
    state.editing = null
    state.selected = null
    editor.style.display = 'none'
    schedule()
  }

  const placeEditor = (rect) => {
    const width = Math.max(180, Math.min(300, innerWidth - 16))
    const estimated = 190
    editor.style.width = String(width) + 'px'
    const left = Math.max(8, Math.min(innerWidth - width - 8, rect.left))
    const top = rect.bottom + 8 + estimated < innerHeight
      ? rect.bottom + 8
      : Math.max(8, rect.top - estimated - 8)
    editor.style.left = String(left) + 'px'
    editor.style.top = String(top) + 'px'
  }

  const openEditor = (element, index) => {
    const rect = visibleRect(element)
    if (rect === null) return
    state.selected = element
    state.selectedPage = pageKey()
    // Stable selector survives HMR even when this concrete DOM node is replaced.
    state.selectedSelector = selectorFor(element)
    state.editing = index
    const note = index === null ? null : state.notes[index]
    textarea.value = note === null || note === undefined ? '' : note.comment
    editorTag.textContent = element.tagName.toLowerCase() + ' · ' + selectorFor(element).slice(0, 48)
    removeButton.style.display = index === null ? 'none' : ''
    saveButton.textContent = index === null ? '保存批注' : '更新批注'
    saveButton.disabled = textarea.value.trim().length < 2
    placeEditor(rect)
    editor.style.display = 'block'
    textarea.focus()
    schedule()
  }

  const retargetDraft = (element) => {
    if (state.selected === null || state.editing !== null || editor.style.display !== 'block') return false
    const rect = visibleRect(element)
    if (rect === null) return false
    // Retarget without wiping unsaved text in the editor.
    state.selected = element
    state.selectedPage = pageKey()
    state.selectedSelector = selectorFor(element)
    editorTag.textContent = element.tagName.toLowerCase() + ' · ' + state.selectedSelector.slice(0, 48)
    placeEditor(rect)
    schedule()
    return true
  }

  const syncDraft = () => {
    if (nonce === null || parentOrigin === null) return
    window.parent.postMessage({
      type: 'codex.draft', nonce, url: location.href,
      notes: state.notes.map(note => ({ comment: note.comment, element: note.element })),
    }, parentOrigin)
  }

  const save = () => {
    const selected = state.selected
    if (selected === null) return
    if (state.selectedPage !== pageKey()) {
      setNotice('页面地址已改变，请返回原页面完成批注，或重新选择元素')
      return
    }
    const element = selected.isConnected ? selected : state.selectedSelector ? findBySelector(state.selectedSelector) : null
    if (element === null || element.tagName !== selected.tagName) {
      setNotice('页面已更新，原元素尚未恢复；未保存的批注文字仍保留，请稍后重试或重新选择')
      return
    }
    state.selected = element

    const comment = textarea.value.trim()
    if (comment.length < 2) { setNotice('批注至少需要 2 个字符'); return }
    if (comment.length > 3000) { setNotice('批注不能超过 3000 个字符'); return }

    const note = { element: elementInfo(element), comment }
    if (state.editing === null) {
      if (state.notes.length >= MAX_NOTES) { setNotice('一次最多保存 ' + String(MAX_NOTES) + ' 条批注'); return }
      state.notes.push(note)
    } else {
      state.notes[state.editing] = note
    }
    closeEditor()
    renderPins()
    updateBar()
    syncDraft()
    setNotice('已保存，点击蓝色编号可再次编辑')
  }

  const remove = () => {
    if (state.editing === null) return
    state.notes.splice(state.editing, 1)
    closeEditor()
    renderPins()
    updateBar()
    syncDraft()
    setNotice('已删除批注')
  }

  // ------------------------------------------------------------------ markers

  const updatePins = () => {
    const pins = Array.from(markers.children)
    pins.forEach((pin, index) => {
      const note = state.notes[index]
      const element = note === undefined || !noteIsOnCurrentPage(note) ? null : findBySelector(note.element.selector)
      const rect = element === null ? null : visibleRect(element)
      if (rect === null) { pin.style.display = 'none'; return }
      pin.style.display = 'grid'
      pin.style.left = String(Math.max(3, Math.min(innerWidth - 27, rect.right - 12))) + 'px'
      pin.style.top = String(Math.max(3, Math.min(innerHeight - 27, rect.top - 12))) + 'px'
    })
  }

  const renderPins = () => {
    markers.replaceChildren()
    state.notes.forEach((note, index) => {
      const pin = document.createElement('button')
      pin.type = 'button'
      pin.className = 'pin'
      pin.textContent = String(index + 1)
      pin.title = '编辑第 ' + String(index + 1) + ' 条批注'
      pin.addEventListener('pointerdown', event => { event.stopPropagation() }, true)
      pin.addEventListener('click', event => {
        event.preventDefault()
        event.stopPropagation()
        const element = noteIsOnCurrentPage(note) ? findBySelector(note.element.selector) : null
        if (element !== null) openEditor(element, index)
      }, true)
      markers.appendChild(pin)
    })
    updatePins()
  }

  // ------------------------------------------------------------------ mode

  const setEnabled = (next) => {
    state.enabled = next
    state.hovered = null
    if (!next) {
      state.selected = null
      state.editing = null
      state.selectedSelector = null
      editor.style.display = 'none'
      hideSpot()
    }
    document.documentElement.toggleAttribute('data-dsh-codex-annotating', next)
    updateBar()
    schedule()
    setNotice(next ? '移动鼠标查看元素信息；点击元素添加批注' : '')
  }

  // ------------------------------------------------------------------ events

  const containsPoint = (element, x, y) => {
    if (element === host || !element.isConnected) return false
    const css = getComputedStyle(element)
    if (css.display === 'none' || css.visibility === 'hidden' || Number(css.opacity) === 0) return false
    // getClientRects handles inline spans (including wrapped breadcrumb labels).
    return Array.from(element.getClientRects()).some(rect =>
      rect.width >= 1 && rect.height >= 1 &&
      x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom)
  }

  // Delegated cards/links often set pointer-events:none on their children.
  // The browser event target is then the outer card rather than its label.
  // Resolve the most specific visible descendant under the pointer.
  const pickInside = (target, x, y) => {
    if (!containsPoint(target, x, y)) return target // synthetic .click() fallback
    let best = target
    let bestArea = target.getBoundingClientRect().width * target.getBoundingClientRect().height
    let bestDepth = 0
    let remaining = 600
    const visit = (node, depth) => {
      if (--remaining < 0 || !containsPoint(node, x, y)) return
      // SVG drawing primitives should resolve to the actual icon instead.
      const tag = node.tagName.toLowerCase()
      const candidate = ['path', 'rect', 'circle', 'line', 'polyline', 'polygon', 'g', 'use'].includes(tag)
        ? node.closest('svg') || node : node
      const rect = candidate.getBoundingClientRect()
      const area = rect.width * rect.height
      if (area >= 1 && (area < bestArea - 1 || (Math.abs(area - bestArea) <= 1 && depth > bestDepth))) {
        best = candidate
        bestArea = area
        bestDepth = depth
      }
      const children = node.shadowRoot?.children || node.children
      for (let index = children.length - 1; index >= 0 && remaining > 0; index -= 1) {
        visit(children[index], depth + 1)
      }
    }
    visit(target, 0)
    return best
  }

  const eventElement = (event) => {
    const target = event.composedPath().find(node => node instanceof Element)
    if (!(target instanceof Element)) return null
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return target
    return pickInside(target, event.clientX, event.clientY)
  }

  const onPointerMove = (event) => {
    if (!state.enabled || (state.selected !== null && state.editing !== null)) return
    if (insideUi(event)) {
      if (state.hovered !== null) { state.hovered = null; schedule() }
      return
    }
    const target = eventElement(event)
    if (target === null || target === document.documentElement || target === document.body) {
      if (state.hovered !== null) { state.hovered = null; schedule() }
      return
    }
    if (state.hovered === target) return
    state.hovered = target
    schedule()
  }

  const onPointerDown = (event) => {
    if (!state.enabled || insideUi(event) || event.button !== 0) return
    event.preventDefault()
    event.stopImmediatePropagation()
    // Stale native text selections look like an extra blue rectangle.
    getSelection()?.removeAllRanges()
  }

  const onClick = (event) => {
    if (!state.enabled || insideUi(event)) return
    event.preventDefault()
    event.stopImmediatePropagation()
    const target = eventElement(event)
    if (target === null || target === document.documentElement || target === document.body) return
    state.hovered = null
    if (!retargetDraft(target)) openEditor(target, null)
  }

  const onKeyDown = (event) => {
    if (event.isComposing || event.key !== 'Escape') return
    if (state.editing !== null || state.selected !== null) {
      event.preventDefault()
      closeEditor()
      return
    }
    if (state.enabled) setEnabled(false)
  }

  const onViewportChange = () => { schedule() }

  document.addEventListener('pointermove', onPointerMove, true)
  document.addEventListener('pointerdown', onPointerDown, true)
  document.addEventListener('click', onClick, true)
  document.addEventListener('keydown', onKeyDown, true)
  addEventListener('scroll', onViewportChange, true)
  addEventListener('resize', onViewportChange)

  const observer = new MutationObserver(() => {
    if (state.hovered !== null && !state.hovered.isConnected) state.hovered = null
    if (state.selected !== null && !state.selected.isConnected) {
      // HMR may replace the selected element, but the document-level listener survives.
      const replacement = state.selectedPage === pageKey() && state.selectedSelector ? findBySelector(state.selectedSelector) : null
      if (replacement !== null && replacement.tagName === state.selected.tagName) {
        state.selected = replacement
        const rect = visibleRect(replacement)
        if (rect !== null) placeEditor(rect)
        setNotice('页面已更新，批注目标已重新定位，未保存文字已保留')
      } else {
        // Preserve the editor and unsaved text while a matching node is unavailable.
        setNotice('页面正在更新，批注输入已保留；等待目标元素重新出现')
      }
    }
    schedule()
  })
  observer.observe(document.documentElement, { childList: true, subtree: true })

  // SPA navigation can change history without replacing the document or DOM nodes.
  let lastPage = pageKey()
  const checkRoute = () => {
    const nextPage = pageKey()
    // Rapid SPA navigation may leave old pins hidden between polling ticks.
    if (nextPage === lastPage) { if (state.notes.length > 0) schedule(); return }
    lastPage = nextPage
    state.hovered = null
    schedule()
  }
  addEventListener('popstate', checkRoute)
  addEventListener('hashchange', checkRoute)
  const routeWatcher = setInterval(checkRoute, 350)

  // ------------------------------------------------------------------ UI wiring

  toggle.addEventListener('click', () => { setEnabled(!state.enabled) })
  clearButton.addEventListener('click', () => {
    state.notes = []
    renderPins()
    updateBar()
    syncDraft()
    setNotice('已清空预览批注；聊天输入框中的文字不受影响')
  })
  sendButton.addEventListener('click', () => {
    if (state.notes.length === 0 || state.sending) return
    if (nonce === null || parentOrigin === null) { setNotice('尚未连接 DSH 会话'); return }
    window.parent.postMessage({
      type: 'codex.submit',
      nonce,
      url: location.href,
      notes: state.notes.map(note => ({ comment: note.comment, element: note.element })),
    }, parentOrigin)
    state.sending = true
    updateBar()
    setNotice('正在直接发送到当前 DSH 会话…')
  })
  textarea.addEventListener('input', () => {
    saveButton.disabled = textarea.value.trim().length < 2
  })
  textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      save()
    }
  })
  saveButton.addEventListener('click', save)
  removeButton.addEventListener('click', remove)
  cancelButton.addEventListener('click', closeEditor)
  editorClose.addEventListener('click', closeEditor)

  // ------------------------------------------------------------------ messages

  const localOrigin = (origin) => {
    try {
      const url = new URL(origin)
      return url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)
    } catch {
      return false
    }
  }

  addEventListener('message', (event) => {
    if (event.source !== window.parent) return
    const data = event.data
    if (typeof data !== 'object' || data === null) return
    if (data.type === 'controlgui.hello' && typeof data.nonce === 'string' && data.nonce.length >= 12) {
      if (!localOrigin(event.origin)) return
      parentOrigin = event.origin
      nonce = data.nonce
      window.parent.postMessage({ type: 'codex.ready', nonce }, parentOrigin)
      return
    }
    if (nonce === null || event.origin !== parentOrigin || data.nonce !== nonce) return
    if (data.type === 'codex.restore') {
      if (!Array.isArray(data.notes) || data.notes.length > MAX_NOTES) return
      const valid = data.notes.every(note => note && typeof note.comment === 'string' &&
        note.comment.length >= 2 && note.element && typeof note.element.selector === 'string' &&
        typeof note.element.tag === 'string')
      if (!valid) return
      state.notes = data.notes.map(note => ({ element: { ...note.element }, comment: note.comment }))
      state.sending = false
      renderPins()
      updateBar()
      setNotice(state.notes.length ? '已恢复 ' + String(state.notes.length) + ' 条未发送批注' : '')
      return
    }
    if (data.type === 'codex.sent') {
      state.sending = false
      if (data.ok === true && Array.isArray(data.notes) && data.notes.length > 0) {
        const sameBatch = data.notes.length === state.notes.length && state.notes.every((note, index) => {
          const received = data.notes[index]
          return received && note.comment === received.comment
            && note.element.selector === received.element?.selector
            && note.element.page === received.element?.page
            && note.element.tag === received.element?.tag
        })
        if (sameBatch) {
          state.notes = []
          closeEditor()
          renderPins()
          syncDraft()
          setNotice('批注已发送给 Agent')
        } else {
          setNotice('原批注已发送，新编辑的批注仍保留')
        }
      } else {
        setNotice('发送失败，批注已保留：' + (typeof data.reason === 'string' ? data.reason : '请重试'))
      }
      updateBar()
      return
    }
    if (data.type === 'codex.clear') {
      state.notes = []
      renderPins()
      updateBar()
      setNotice('')
    }
  })

  // ------------------------------------------------------------------ teardown

  const teardown = () => {
    if (stopped) return
    stopped = true
    document.removeEventListener('pointermove', onPointerMove, true)
    document.removeEventListener('pointerdown', onPointerDown, true)
    document.removeEventListener('click', onClick, true)
    document.removeEventListener('keydown', onKeyDown, true)
    removeEventListener('scroll', onViewportChange, true)
    removeEventListener('resize', onViewportChange)
    observer.disconnect()
    clearInterval(routeWatcher)
    removeEventListener('popstate', checkRoute)
    removeEventListener('hashchange', checkRoute)
    document.documentElement.removeAttribute('data-dsh-codex-annotating')
    cursorStyle.remove()
    host.remove()
  }

  addEventListener('pagehide', teardown, { once: true })

  updateBar()
  setNotice('')
})()

}else{
;/* DSH host adapter for the BitFun browser-annotation-v1 script ABI.
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

({"label":"批注","activeLabel":"退出批注","maxNotes":20,"editorEventPrefix":"browser-controlgui-editor-","editorOpenedEventPrefix":"browser-controlgui-editor-opened-","markerEventPrefix":"browser-controlgui-marker-click-"}, (bridge) => ({
"inspector": (arg) => {
window.__openbitfun_inspector_label = arg;
window.__openbitfun_inspector_annotation_mode = true;

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
    'border:2px solid var(--openbitfun-domain-inspector-active-border)',
    'background:var(--openbitfun-domain-inspector-active-background)',
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
    ['border', '2px solid var(--openbitfun-domain-inspector-active-border)'],
    ['background', 'var(--openbitfun-domain-inspector-active-background)'],
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
    'background:var(--openbitfun-domain-inspector-browser-tooltip-background)',
    'color:var(--openbitfun-domain-inspector-tooltip-text)',
    'padding:3px 8px',
    'border-radius:4px',
    'font-size:12px',
    'font-family:\'Fira Code\', \'Cascadia Mono\', \'Cascadia Code\', Consolas, \'Liberation Mono\', SFMono-Regular, \'SF Mono\', Menlo, Monaco, \'Courier New\', system-ui, -apple-system, BlinkMacSystemFont, \'Segoe UI\', \'PingFang SC\', \'Hiragino Sans GB\', \'Microsoft YaHei UI\', \'Microsoft YaHei\', \'Helvetica Neue\', Helvetica, Arial, sans-serif, monospace',
    'z-index:2147483647',
    'pointer-events:none',
    'display:none',
    'max-width:480px',
    'white-space:nowrap',
    'box-shadow:0 2px 8px var(--openbitfun-domain-inspector-tooltip-shadow)',
    'line-height:1.6',
  ].join(';');
  [
    ['position', 'fixed'],
    ['background', 'var(--openbitfun-domain-inspector-browser-tooltip-background)'],
    ['color', 'var(--openbitfun-domain-inspector-tooltip-text)'],
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
    var matches = String(value || '').matchAll(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s\/]+([\d.]+))?\s*\)/gi);
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
    var internals = bridge;
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
        (chosen.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 500),
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

    overlay.style.setProperty('border-color', 'var(--openbitfun-domain-inspector-selected-border)', 'important');
    overlay.style.setProperty('background-color', 'var(--openbitfun-domain-inspector-selected-background)', 'important');
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

},
"editorOpen": (arg) => {
(function runFloatingEditor(input, mode, status) {
  const page = window;
  const previous = page.__openbitfunControlGuiFloatingEditor;
  if (mode === "status") {
    previous?.status(status);
    return;
  };
  previous?.close();
  if (mode !== "open" || !input) return;
  const samePage = (a, b) => {
    try {
      const left = new URL(a);
      const right = new URL(b);
      left.hash = "";
      right.hash = "";
      return left.href === right.href;
    } catch {
      return false;
    }
  };
  if (!samePage(window.location.href, input.target.pageUrl)) return;
  const findTarget = () => {
    try {
      return document.querySelector(input.target.path);
    } catch {
      return null;
    }
  };
  let previewTextNode = null;
  let previewTextExpected = null;
  const targetRect = (element) => {
    const fragment = input.target.textRange;
    if (!fragment) return element.getBoundingClientRect();
    const node = element.childNodes[fragment.nodeIndex];
    if (!node || node.nodeType !== Node.TEXT_NODE || node.textContent?.trim() !== fragment.text && !(node === previewTextNode && node.textContent === previewTextExpected)) return null;
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
  if (!selected || selected.tagName.toLowerCase() !== input.target.tagName.toLowerCase() || !targetRect(selected)) return;
  const host = document.createElement("div");
  host.setAttribute("data-openbitfun-controlgui-editor", "");
  host.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483646;";
  const shadow = host.attachShadow({ mode: "closed" });
  const styleEach = (node, declarations2) => {
    for (const [property, value] of Object.entries(declarations2)) {
      node.style.setProperty(property, value);
    }
  };
  const css = [
    ":host{all:initial;color-scheme:dark}",
    "*{box-sizing:border-box}",
    "textarea::placeholder{color:#85858b}",
    "textarea:focus{border-color:#4b96f6!important;outline:none}",
    "button:focus-visible{outline:2px solid #60a5fa;outline-offset:2px}",
    "button:hover{filter:brightness(1.12)}"
  ].join("");
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    shadow.adoptedStyleSheets = [...shadow.adoptedStyleSheets, sheet];
  } catch {
  };
  const highlight = document.createElement("div");
  highlight.setAttribute("data-controlgui-selected-outline", "");
  highlight.style.cssText = [
    "position:fixed",
    "display:none",
    "pointer-events:none",
    "box-sizing:border-box",
    "border:2px solid #3979ff",
    "border-radius:8px",
    "background:rgba(47,107,255,.09)",
    "z-index:1"
  ].join(";");
  styleEach(highlight, {
    position: "fixed",
    display: "none",
    "pointer-events": "none",
    "box-sizing": "border-box",
    border: "2px solid #3979ff",
    "border-radius": "8px",
    background: "transparent",
    "box-shadow": "none",
    "z-index": "1"
  });
  const editor = document.createElement("div");
  editor.className = "editor";
  editor.setAttribute("role", "dialog");
  editor.setAttribute("aria-label", "ControlGUI 网页元素批注");
  styleEach(editor, {
    position: "fixed",
    display: "flex",
    "flex-direction": "column",
    gap: "10px",
    "box-sizing": "border-box",
    width: "340px",
    "max-width": "calc(100vw - 16px)",
    "max-height": "calc(100vh - 16px)",
    "overflow-y": "auto",
    padding: "14px",
    "border-radius": "16px",
    background: "#1b1b1d",
    color: "#ededf0",
    border: "1px solid #333337",
    "box-shadow": "0 18px 48px rgba(0,0,0,.35),0 3px 10px rgba(0,0,0,.18)",
    "pointer-events": "auto",
    "font-family": "system-ui,sans-serif",
    "font-size": "13px",
    "line-height": "1.5",
    "z-index": "2",
    "color-scheme": "dark"
  });
  const heading = document.createElement("header");
  styleEach(heading, { display: "flex", "align-items": "center", "justify-content": "space-between", gap: "8px", "min-width": "0" });
  const title = document.createElement("button");
  title.type = "button";
  title.setAttribute("aria-expanded", "true");
  title.title = "展开或收起元素 CSS 属性";
  styleEach(title, {
    display: "flex",
    "align-items": "center",
    gap: "7px",
    color: "#d0d0d4",
    background: "transparent",
    border: "0",
    padding: "0",
    "font-weight": "500",
    "font-size": "13px",
    "min-width": "0",
    cursor: "pointer",
    "text-align": "left",
    flex: "1",
    "font-family": "system-ui,sans-serif"
  });
  const chevron = document.createElement("span");
  chevron.textContent = "⌄";
  chevron.setAttribute("aria-hidden", "true");
  styleEach(chevron, { color: "#a0a0a8", flex: "0 0 auto", "font-size": "16px" });
  const titleText = document.createElement("span");
  styleEach(titleText, { "min-width": "0", overflow: "hidden", "white-space": "nowrap", "text-overflow": "ellipsis" });
  const friendlyName = (input.target.textContent || selected.textContent || "").replace(/\s+/g, " ").trim().slice(0, 48);
  titleText.textContent = input.target.tagName.toLowerCase() + (friendlyName ? ' "' + friendlyName + '"' : "");
  title.append(chevron, titleText);
  const close = document.createElement("button");
  close.className = "close";
  close.type = "button";
  close.title = "取消批注";
  close.setAttribute("aria-label", "取消批注");
  close.textContent = "×";
  styleEach(close, { flex: "0 0 auto", border: "0", "border-radius": "7px", padding: "0 4px", background: "transparent", color: "#a0a0a8", "font-size": "20px", cursor: "pointer" });
  const grip = document.createElement("button");
  grip.type = "button";
  grip.textContent = "⠿";
  grip.title = "拖动面板";
  grip.setAttribute("aria-label", "拖动面板");
  styleEach(grip, { border: "0", background: "transparent", color: "#a0a0a8", cursor: "grab", "touch-action": "none", "font-size": "19px", padding: "0 3px", "flex-shrink": "0" });
  const peek = document.createElement("button");
  peek.type = "button";
  peek.textContent = "查看效果";
  peek.setAttribute("aria-label", "查看效果");
  styleEach(peek, { border: "1px solid #48484f", "border-radius": "6px", background: "#28282b", color: "#ededf0", padding: "3px 6px", "font-size": "11px", cursor: "pointer", "white-space": "nowrap" });
  heading.append(grip, title, peek, close);
  const properties = document.createElement("div");
  properties.setAttribute("data-controlgui-computed-styles", "");
  properties.setAttribute("aria-label", "当前元素 CSS 属性");
  styleEach(properties, {
    background: "#28282b",
    "border-radius": "8px",
    padding: "9px 11px",
    "font-family": "ui-monospace,Consolas,monospace",
    "font-size": "12px",
    "line-height": "1.6",
    color: "#dedee4",
    "overflow-wrap": "anywhere",
    "flex-shrink": "0"
  });
  const styled = selected instanceof HTMLElement || selected instanceof SVGElement ? selected : null;
  const originalAttr = styled?.getAttribute("style") ?? null;
  let expectedAttr = originalAttr;
  let stale = false;
  const initial = /* @__PURE__ */ new Map();
  const computed = window.getComputedStyle(selected);
  for (let i = 0; i < computed.length; i++) {
    const name = computed.item(i);
    initial.set(name, computed.getPropertyValue(name).trim());
  };
  const fragmentNode = input.target.textRange ? selected.childNodes[input.target.textRange.nodeIndex] : selected.childNodes.length === 1 ? selected.firstChild : null;
  const textNode = fragmentNode?.nodeType === Node.TEXT_NODE && !["SCRIPT", "STYLE", "TEXTAREA", "TITLE", "OPTION"].includes(selected.tagName.toUpperCase()) ? fragmentNode : null;
  previewTextNode = textNode;
  const originalText = textNode?.data ?? "";
  let expectedText = originalText;
  previewTextExpected = originalText;
  let textChanged = false;
  let textPreviewSuspended = false;
  const restoreText = () => {
    if (textNode && textChanged && textNode.data === previewTextExpected) textNode.data = originalText;
  };
  const changes = /* @__PURE__ */ new Map();
  const fields = /* @__PURE__ */ new Map();
  const invalidFields = /* @__PURE__ */ new Set();
  const colors = /* @__PURE__ */ new Map();
  const declarations = (style) => {
    const result = /* @__PURE__ */ new Map();
    for (let i = 0; i < style.length; i++) {
      const name = style.item(i);
      result.set(name, [style.getPropertyValue(name), style.getPropertyPriority(name)]);
    };
    return result;
  };
  const originalInline = styled ? declarations(styled.style) : /* @__PURE__ */ new Map();
  const owned = /* @__PURE__ */ new Map();
  const samePair = (a, b) => a?.[0] === b?.[0] && a?.[1] === b?.[1];
  const restorePreview = () => {
    if (!styled || !owned.size) return;
    if (styled.getAttribute("style") === expectedAttr) {
      if (originalAttr === null) styled.removeAttribute("style");
      else styled.setAttribute("style", originalAttr);
    } else {
      const current2 = declarations(styled.style);
      for (const [name, pair] of owned) {
        if (!samePair(current2.get(name), pair)) continue;
        const old = originalInline.get(name);
        if (old) styled.style.setProperty(name, old[0], old[1]);
        else styled.style.removeProperty(name);
      }
    };
    owned.clear();
    expectedAttr = styled.getAttribute("style");
  };
  const rebuild = () => {
    if (stale || !styled || !selected.isConnected || findTarget() !== selected) return false;
    if (styled.getAttribute("style") !== expectedAttr) {
      restorePreview();
      stale = true;
      showNotice("页面样式已更新，请重新选择元素。");
      return false;
    };
    restorePreview();
    for (const [name, value] of changes) styled.style.setProperty(name, value, "important");
    expectedAttr = styled.getAttribute("style");
    const current2 = declarations(styled.style);
    for (const name of /* @__PURE__ */ new Set([...originalInline.keys(), ...current2.keys()])) if (!samePair(originalInline.get(name), current2.get(name))) owned.set(name, current2.get(name));
    schedule();
    return true;
  };
  const validName = (n) => /^-?[a-z][a-z0-9-]*$/.test(n) && n.length <= 80 && !["behavior", "-moz-binding"].includes(n);
  const validValue = (n, v) => {
    if (!validName(n) || !v || v.length > 350 || /[;{}!\\]|url\s*\(|(?:-webkit-)?image-set\s*\(|\bimage\s*\(|\bcross-fade\s*\(|\bsrc\s*\(|expression\s*\(|@import|\bvar\s*\(|\battr\s*\(/i.test(v)) return false;
    try {
      if (typeof CSS !== "undefined" && CSS.supports) return CSS.supports(n, v);
      const probe = document.createElement("div").style;
      probe.setProperty(n, v);
      return !!probe.getPropertyValue(n);
    } catch {
      return false;
    }
  };
  const originalValue = (name) => initial.get(name) ?? "";
  const changeCount = document.createElement("div");
  const refreshCount = () => {
    changeCount.textContent = "已调整 " + (changes.size + (textChanged ? 1 : 0)) + " 项 · 临时预览";
  };
  const update = (name, raw) => {
    const v = raw.trim();
    if (!validValue(name, v)) {
      invalidFields.add(name);
      showNotice("无效或暂不支持的 CSS 值：" + name);
      return false;
    };
    invalidFields.delete(name);
    if (!styled || stale) return false;
    const previous2 = changes.get(name);
    if (v === originalValue(name)) changes.delete(name);
    else changes.set(name, v);
    if (!rebuild()) {
      if (previous2 === void 0) changes.delete(name);
      else changes.set(name, previous2);
      return false;
    };
    showNotice("");
    refreshCount();
    return true;
  };
  const hex = (v) => {
    if (/^#[a-f0-9]{6}$/i.test(v)) return v;
    const m = v.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
    return m ? "#" + m.slice(1, 4).map((n) => Math.min(255, Number(n)).toString(16).padStart(2, "0")).join("") : null;
  };
  const reset = (name) => {
    if (name) {
      changes.delete(name);
      invalidFields.delete(name);
    } else {
      changes.clear();
      invalidFields.clear();
    };
    for (const [key, field] of fields) if (!name || name === key) {
      field.value = originalValue(key);
      const c = colors.get(key);
      if (c) c.value = hex(field.value) || "#000000";
    };
    if (!name && textField) {
      if (textNode?.data !== previewTextExpected) {
        stale = true;
        showNotice("页面文本已更新，请重新选择。");
      } else {
        restoreText();
        expectedText = originalText;
        previewTextExpected = originalText;
        textChanged = false;
        textField.value = originalText;
      }
    };
    rebuild();
    refreshCount();
  };
  styleEach(properties, { "font-family": "system-ui,sans-serif", "max-height": "min(320px, 45vh)", "overflow-y": "auto", display: "block", padding: "8px 10px" });
  const controlStyle = (node) => styleEach(node, { "box-sizing": "border-box", "min-width": "0", color: "#ededf0", background: "#202023", border: "1px solid #48484f", "border-radius": "7px", padding: "5px 7px", "font-size": "12px", "font-family": "system-ui,sans-serif" });
  const intro = document.createElement("div");
  styleEach(intro, { display: "flex", "justify-content": "space-between", "align-items": "center", gap: "4px", "margin-bottom": "6px" });
  const resetAll = document.createElement("button");
  resetAll.type = "button";
  resetAll.textContent = "恢复原样";
  controlStyle(resetAll);
  resetAll.addEventListener("click", () => reset());
  styleEach(changeCount, { color: "#a7bfff", "font-size": "11px" });
  refreshCount();
  intro.append(changeCount, resetAll);
  properties.append(intro);
  if (input.target.textRange) {
    const hint = document.createElement("div");
    hint.textContent = "CSS 预览作用于所选文字的父元素。";
    properties.append(hint);
  };
  let textField = null;
  if (textNode) {
    const row = document.createElement("div");
    styleEach(row, { display: "flex", "align-items": "center", gap: "5px", margin: "5px 0" });
    const label = document.createElement("label");
    label.textContent = "文本";
    styleEach(label, { flex: "0 0 36%", color: "#c6c6ce", "font-size": "12px" });
    const field = document.createElement("input");
    textField = field;
    field.type = "text";
    field.value = originalText;
    field.maxLength = 500;
    field.setAttribute("aria-label", "元素文本");
    controlStyle(field);
    styleEach(field, { flex: "1", width: "0" });
    field.addEventListener("input", () => {
      if (!selected.isConnected || findTarget() !== selected || textNode.parentNode !== selected || textNode.data !== previewTextExpected) {
        stale = true;
        showNotice("页面文本已更新，请重新选择。");
        return;
      };
      expectedText = field.value;
      textPreviewSuspended = false;
      previewTextExpected = expectedText;
      textChanged = expectedText !== originalText;
      textNode.data = expectedText;
      refreshCount();
      schedule();
    });
    row.append(label, field);
    properties.append(row);
  };
  const labels = {
    color: "文本颜色",
    "background-color": "背景颜色",
    opacity: "Opacity",
    "font-family": "字体",
    "font-size": "字号",
    "font-weight": "字重",
    "line-height": "行高",
    "text-align": "文本对齐",
    "letter-spacing": "字间距",
    width: "宽度",
    height: "高度",
    "min-width": "最小宽度",
    "min-height": "最小高度",
    padding: "内边距",
    margin: "外边距",
    gap: "间距",
    "border-radius": "圆角",
    "border-width": "边框宽度",
    "border-style": "边框样式",
    "border-color": "边框颜色",
    "box-shadow": "阴影",
    "text-shadow": "文字阴影",
    display: "Display",
    position: "定位",
    "flex-direction": "方向",
    "justify-content": "主轴对齐",
    "align-items": "交叉轴对齐",
    "flex-wrap": "换行",
    "grid-template-columns": "Grid 列",
    overflow: "溢出",
    cursor: "光标",
    "text-decoration": "文字装饰",
    "max-width": "最大宽度",
    "max-height": "最大高度"
  };
  const makeRow = (name, parent) => {
    if (fields.has(name)) return;
    if (!initial.has(name)) initial.set(name, computed.getPropertyValue(name).trim());
    const value = originalValue(name);
    const row = document.createElement("div");
    row.setAttribute("data-css-property", name);
    styleEach(row, { display: "flex", "align-items": "center", gap: "5px", margin: "5px 0" });
    const key = document.createElement("label");
    key.textContent = labels[name] || name;
    key.title = name;
    styleEach(key, { color: "#c6c6ce", flex: "0 0 36%", "min-width": "0", "overflow-wrap": "anywhere", "font-size": "12px" });
    const field = document.createElement("input");
    field.type = "text";
    field.value = value;
    field.placeholder = "CSS 值";
    field.spellcheck = false;
    field.setAttribute("aria-label", name);
    field.maxLength = 350;
    controlStyle(field);
    styleEach(field, { flex: "1", width: "0" });
    fields.set(name, field);
    row.append(key);
    if (name === "color" || name.endsWith("-color")) {
      const c = document.createElement("input");
      c.type = "color";
      c.value = hex(value) || "#000000";
      c.title = "选择颜色";
      c.setAttribute("aria-label", name + " 拾色器");
      styleEach(c, { width: "27px", height: "29px", padding: "1px", border: "0", background: "transparent", "flex-shrink": "0", cursor: "pointer" });
      colors.set(name, c);
      c.addEventListener("input", () => {
        field.value = c.value;
        update(name, field.value);
      });
      row.append(c);
    };
    const apply = () => {
      if (update(name, field.value)) {
        const c = colors.get(name);
        if (c) c.value = hex(field.value) || c.value;
      }
    };
    field.addEventListener("input", () => {
      if (validValue(name, field.value.trim())) apply();
      else invalidFields.add(name);
    });
    field.addEventListener("change", apply);
    field.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        apply();
      }
    });
    const undo = document.createElement("button");
    undo.type = "button";
    undo.textContent = "↶";
    undo.title = "恢复 " + name;
    undo.setAttribute("aria-label", "恢复 " + name);
    controlStyle(undo);
    styleEach(undo, { padding: "4px 5px", "flex-shrink": "0", cursor: "pointer" });
    undo.addEventListener("click", () => reset(name));
    row.append(field, undo);
    parent.append(row);
  };
  for (const name of ["color", "background-color", "opacity", "font-family", "font-size", "font-weight", "width", "height", "padding", "margin", "border-radius"]) makeRow(name, properties);
  const more = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = "更多样式 · 布局 / 边框 / 阴影";
  styleEach(summary, { cursor: "pointer", color: "#a7bfff", margin: "8px 0" });
  more.append(summary);
  for (const name of Object.keys(labels)) if (!fields.has(name)) makeRow(name, more);
  properties.append(more);
  const advanced = document.createElement("details");
  const advancedTitle = document.createElement("summary");
  advancedTitle.textContent = "高级 CSS · 搜索属性";
  styleEach(advancedTitle, { cursor: "pointer", color: "#a7bfff", margin: "8px 0" });
  const search = document.createElement("input");
  search.type = "text";
  search.placeholder = "如 transform / padding-top";
  search.setAttribute("aria-label", "自定义 CSS 属性");
  controlStyle(search);
  styleEach(search, { width: "100%" });
  const choices = document.createElement("div");
  styleEach(choices, { display: "flex", "flex-wrap": "wrap", gap: "3px", margin: "5px 0" });
  const advancedRows = document.createElement("div");
  const addProperty = (raw) => {
    const n = raw.trim().toLowerCase();
    if (!validName(n)) {
      showNotice("请输入标准 CSS 属性名。");
      return;
    };
    if (typeof CSS !== "undefined" && CSS.supports && !CSS.supports(n, "initial")) {
      showNotice("浏览器不支持此 CSS 属性。");
      return;
    };
    if (fields.has(n)) {
      if (more.contains(fields.get(n))) more.open = true;
      fields.get(n)?.focus();
    } else makeRow(n, advancedRows);
    schedule();
  };
  search.addEventListener("input", () => {
    choices.replaceChildren();
    const q = search.value.trim().toLowerCase();
    if (!q) return;
    for (const n of [...initial.keys()].filter((n2) => n2.includes(q) && validName(n2)).slice(0, 10)) {
      const item = document.createElement("button");
      item.type = "button";
      item.textContent = n;
      controlStyle(item);
      item.addEventListener("click", () => addProperty(n));
      choices.append(item);
    }
  });
  const add = document.createElement("button");
  add.type = "button";
  add.textContent = "添加 CSS 属性";
  controlStyle(add);
  add.addEventListener("click", () => addProperty(search.value));
  search.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addProperty(search.value);
    }
  });
  advanced.append(advancedTitle, search, choices, add, advancedRows);
  properties.append(advanced);
  const cssComment = () => changes.size ? "CSS 修改要求（临时预览，需落实到源码）：\n" + [...changes].map(([n, v]) => "- " + n + ": " + (originalValue(n) || "(未设置)") + " → " + v).join("\n") : "";
  const finalComment = () => [textarea.value.trim(), textChanged ? "文本修改：" + JSON.stringify(originalText) + " → " + JSON.stringify(expectedText) : "", cssComment()].filter(Boolean).join("\n\n");
  title.addEventListener("click", () => {
    const expanded = title.getAttribute("aria-expanded") === "true";
    title.setAttribute("aria-expanded", String(!expanded));
    properties.hidden = expanded;
    properties.style.display = expanded ? "none" : "block";
    chevron.textContent = expanded ? "›" : "⌄";
    schedule();
  });
  const textarea = document.createElement("textarea");
  textarea.setAttribute("aria-label", "网页元素批注内容");
  textarea.placeholder = "描述希望怎样修改这个元素…";
  textarea.maxLength = 3e3;
  textarea.value = input.comment;
  styleEach(textarea, {
    "box-sizing": "border-box",
    display: "block",
    width: "100%",
    height: "76px",
    "min-height": "76px",
    "max-height": "180px",
    "flex-shrink": "0",
    resize: "vertical",
    padding: "10px 11px",
    margin: "0",
    border: "1px solid #49494e",
    "border-radius": "9px",
    background: "#262628",
    color: "#f2f2f4",
    outline: "none",
    "font-family": "system-ui,sans-serif",
    "font-size": "13px",
    "line-height": "1.5"
  });
  const notice = document.createElement("div");
  notice.className = "notice";
  notice.setAttribute("role", "status");
  notice.style.display = "none";
  notice.style.cssText = "font:11px/1.4 system-ui,sans-serif;color:#fca5a5;white-space:pre-wrap;";
  styleEach(notice, { "font-size": "11px", color: "#fca5a5", "white-space": "pre-wrap" });
  notice.style.display = "none";
  const showNotice = (message) => {
    notice.textContent = message;
    notice.style.display = message && !peeking ? "block" : "none";
    schedule();
  };
  const actions = document.createElement("div");
  actions.className = "row";
  actions.style.cssText = "display:flex;align-items:center;justify-content:flex-end;gap:8px;";
  styleEach(actions, { display: "flex", "align-items": "center", "justify-content": "flex-end", gap: "8px" });
  const remove = document.createElement("button");
  remove.className = "danger";
  remove.type = "button";
  remove.textContent = "删除";
  remove.style.cssText = "margin-right:auto;border:0;background:transparent;color:#b42318;border-radius:8px;padding:6px 8px;font:600 12px/1.4 system-ui,sans-serif;cursor:pointer;";
  styleEach(remove, { "margin-right": "auto", border: "0", background: "transparent", color: "#fca5a5", "border-radius": "8px", padding: "6px 8px", "font-size": "12px", "font-weight": "600", cursor: "pointer" });
  if (input.index === null) remove.style.display = "none";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "取消";
  cancel.style.cssText = "border:1px solid #d7e0ed;background:#fff;color:#374151;border-radius:8px;padding:6px 12px;font:600 12px/1.4 system-ui,sans-serif;cursor:pointer;";
  styleEach(cancel, { border: "1px solid transparent", background: "transparent", color: "#b8b8be", "border-radius": "8px", padding: "6px 12px", "font-size": "12px", "font-weight": "600", cursor: "pointer" });
  const save = document.createElement("button");
  save.className = "primary";
  save.type = "button";
  save.textContent = input.index === null ? "保存批注" : "更新批注";
  save.style.cssText = "border:1px solid #2f6bff;background:#2f6bff;color:white;border-radius:8px;padding:6px 13px;font:600 12px/1.4 system-ui,sans-serif;cursor:pointer;";
  styleEach(save, { border: "1px solid #2f6bff", background: "#2f6bff", color: "#fff", "border-radius": "20px", padding: "7px 15px", "font-size": "12px", "font-weight": "600", cursor: "pointer" });
  actions.append(remove, cancel, save);
  editor.append(heading, textarea, properties, notice, actions);
  shadow.append(highlight, editor);
  document.documentElement.appendChild(host);
  try {
    const ready = bridge?.invoke?.("plugin:event|emit", {
      event: "browser-controlgui-editor-opened-" + input.label,
      payload: {
        path: input.target.path,
        index: input.index,
        pageUrl: location.href,
        ...input.target.textRange ? { textRange: input.target.textRange } : {}
      }
    });
    if (ready) void ready.catch(() => {
    });
  } catch {
  };
  let closed = false;
  let frame = 0;
  let peeking = false;
  let manualPosition = null;
  let drag = null;
  const place = () => {
    if (closed) return;
    const element = findTarget();
    if (!element || !samePage(location.href, input.target.pageUrl)) {
      restorePreview();
      restoreText();
      editor.style.display = "none";
      highlight.style.display = "none";
      return;
    };
    if (element !== selected && (changes.size || textChanged)) {
      restorePreview();
      restoreText();
      stale = true;
    };
    const rect = targetRect(element);
    if (!rect) {
      highlight.style.display = "none";
      editor.style.display = "none";
      return;
    };
    const pickerVisible = page.__openbitfun_inspector_instance?.overlay?.isConnected === true;
    highlight.style.display = rect.width > 0 && rect.height > 0 && !pickerVisible ? "block" : "none";
    highlight.style.top = rect.top + "px";
    highlight.style.left = rect.left + "px";
    highlight.style.width = Math.max(0, rect.width) + "px";
    highlight.style.height = Math.max(0, rect.height) + "px";
    const style = getComputedStyle(element);
    const blue = (value) => {
      const colors2 = String(value || "").matchAll(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s\/]+([\d.]+))?\s*\)/gi);
      for (const parts of colors2) {
        const r = Number(parts[1]), g = Number(parts[2]), b = Number(parts[3]);
        const alpha = parts[4] === void 0 ? 1 : Number(parts[4]);
        if (alpha >= 0.35 && b >= 145 && b > r + 60 && b > g + 30) return true;
      };
      return false;
    };
    const nativeBlue = blue(style.boxShadow) || parseFloat(style.outlineWidth) >= 1 && style.outlineStyle !== "none" && blue(style.outlineColor) || ["Top", "Right", "Bottom", "Left"].some((side) => parseFloat(style.getPropertyValue("border-" + side.toLowerCase() + "-width")) >= 1 && style.getPropertyValue("border-" + side.toLowerCase() + "-style") !== "none" && blue(style.getPropertyValue("border-" + side.toLowerCase() + "-color")));
    highlight.style.borderColor = nativeBlue ? "transparent" : "#3979ff";
    editor.style.display = "flex";
    const avoid = element.getBoundingClientRect();
    const edge = 8, gap = 12;
    const vw = Math.max(0, innerWidth), vh = Math.max(0, innerHeight);
    const availableWidth = Math.max(0, vw - edge * 2), availableHeight = Math.max(0, vh - edge * 2);
    const width = Math.min(peeking ? 148 : 340, availableWidth);
    const clamp = (value, low, high) => Math.max(low, Math.min(Math.max(low, high), value));
    editor.style.width = width + "px";
    editor.style.maxHeight = availableHeight + "px";
    editor.style.maxWidth = availableWidth + "px";
    const naturalHeight = Math.min(availableHeight, editor.scrollHeight || editor.offsetHeight || (peeking ? 40 : properties.hidden ? 180 : 300));
    const x = clamp(avoid.left, edge, vw - width - edge), y = clamp(avoid.top, edge, vh - naturalHeight - edge);
    const slots = [
      { left: x, top: Math.max(edge, avoid.bottom + gap), w: width, h: Math.max(0, vh - edge - Math.max(edge, avoid.bottom + gap)), side: "below" },
      { left: x, top: edge, w: width, h: Math.max(0, Math.min(vh - edge, avoid.top - gap) - edge), side: "above" },
      { left: Math.max(edge, avoid.right + gap), top: y, w: Math.max(0, Math.min(width, vw - edge - Math.max(edge, avoid.right + gap))), h: availableHeight, side: "right" },
      { left: edge, top: y, w: Math.max(0, Math.min(width, avoid.left - gap - edge)), h: availableHeight, side: "left" }
    ];
    const fits = slots.find((slot2) => slot2.w >= width && slot2.h >= naturalHeight);
    const useful = slots.filter((slot2) => slot2.w >= Math.min(240, width) && slot2.h >= Math.min(150, naturalHeight)).sort((a, b) => Math.min(b.w, width) * Math.min(b.h, naturalHeight) - Math.min(a.w, width) * Math.min(a.h, naturalHeight));
    const slot = fits ?? useful[0];
    if (manualPosition) {
      editor.style.left = clamp(manualPosition.left, edge, vw - width - edge) + "px";
      editor.style.top = clamp(manualPosition.top, edge, vh - naturalHeight - edge) + "px";
    } else if (slot) {
      const w = Math.min(slot.w, width);
      editor.style.width = w + "px";
      editor.style.maxHeight = slot.h + "px";
      const h = Math.min(slot.h, editor.offsetHeight || naturalHeight);
      editor.style.left = (slot.side === "left" ? clamp(avoid.left - gap - w, edge, vw - w - edge) : clamp(slot.left, edge, vw - w - edge)) + "px";
      editor.style.top = (slot.side === "above" ? clamp(avoid.top - gap - h, edge, vh - h - edge) : clamp(slot.top, edge, vh - h - edge)) + "px";
    } else {
      editor.style.left = x + "px";
      editor.style.top = clamp(avoid.top - naturalHeight - gap, edge, vh - naturalHeight - edge) + "px";
    }
  };
  const schedule = () => {
    if (closed || frame) return;
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      place();
    });
  };
  const togglePeek = () => {
    peeking = !peeking;
    peek.textContent = peeking ? "继续编辑" : "查看效果";
    peek.setAttribute("aria-label", peek.textContent);
    peek.setAttribute("aria-pressed", String(peeking));
    textarea.style.display = peeking ? "none" : "block";
    properties.style.display = peeking || properties.hidden ? "none" : "block";
    actions.style.display = peeking ? "none" : "flex";
    notice.style.display = peeking ? "none" : notice.textContent ? "block" : "none";
    title.style.display = peeking ? "none" : "flex";
    editor.style.padding = peeking ? "6px 8px" : "14px";
    manualPosition = null;
    place();
  };
  peek.addEventListener("click", togglePeek);
  grip.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const rect = editor.getBoundingClientRect();
    drag = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, id: event.pointerId };
    grip.setPointerCapture?.(event.pointerId);
    grip.style.cursor = "grabbing";
  });
  grip.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    manualPosition = { left: drag.left + event.clientX - drag.x, top: drag.top + event.clientY - drag.y };
    place();
  });
  const endDrag = () => {
    drag = null;
    grip.style.cursor = "grab";
  };
  grip.addEventListener("pointerup", endDrag);
  grip.addEventListener("pointercancel", endDrag);
  grip.addEventListener("lostpointercapture", endDrag);
  grip.addEventListener("dblclick", () => {
    manualPosition = null;
    place();
  });
  const report = (action) => {
    if (closed) return;
    const invoke = bridge?.invoke;
    if (typeof invoke !== "function") {
      showNotice("无法连接 BitFun 批注服务。");
      return;
    };
    void invoke("plugin:event|emit", {
      event: "browser-controlgui-editor-" + input.label,
      payload: {
        action,
        pageUrl: location.href,
        path: input.target.path,
        index: input.index,
        comment: action === "save" ? finalComment() : textarea.value,
        ...input.target.textRange ? { textRange: input.target.textRange } : {}
      }
    }).catch(() => {
      showNotice("未能发送批注指令，请重试。");
    });
  };
  const onKey = (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      report("cancel");
    }
  };
  const onView = () => {
    schedule();
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("scroll", onView, true);
  window.addEventListener("resize", onView);
  shadow.addEventListener("pointerdown", (event) => event.stopPropagation());
  shadow.addEventListener("click", (event) => event.stopPropagation());
  shadow.addEventListener("keydown", (event) => event.stopPropagation());
  shadow.addEventListener("keydown", onKey);
  close.addEventListener("click", () => report("cancel"));
  cancel.addEventListener("click", () => report("cancel"));
  remove.addEventListener("click", () => report("delete"));
  save.addEventListener("click", () => {
    if (invalidFields.size) {
      showNotice("请修正或恢复无效 CSS 属性：" + [...invalidFields].join(", "));
      return;
    };
    if (stale || textNode && textNode.data !== previewTextExpected || styled && styled.getAttribute("style") !== expectedAttr) {
      showNotice("页面样式已更新，请重新选择。");
      return;
    };
    if (finalComment().length > 3e3) {
      showNotice("批注与 CSS 差异超过 3000 字符，请减少修改项。");
      return;
    };
    if (finalComment().length < 2) {
      showNotice("批注至少需要两个字符。");
      return;
    };
    const currentTarget = findTarget();
    if (!currentTarget || currentTarget !== selected || !targetRect(currentTarget)) {
      showNotice("页面已更新，无法找到原来的元素，请重新选择。");
      return;
    };
    if (textChanged && textNode && input.target.textRange) {
      restoreText();
      previewTextExpected = originalText;
      textPreviewSuspended = true;
    };
    report("save");
  });
  const current = {
    owner: input.label,
    status(message) {
      if (textPreviewSuspended && textNode && textNode.data === originalText && findTarget() === selected) {
        textNode.data = expectedText;
        previewTextExpected = expectedText;
        textPreviewSuspended = false;
      };
      showNotice(message);
    },
    draftText() {
      return textarea.value;
    },
    close() {
      if (closed) return;
      closed = true;
      restorePreview();
      restoreText();
      observer.disconnect();
      window.removeEventListener("scroll", onView, true);
      window.removeEventListener("resize", onView);
      if (frame) window.cancelAnimationFrame(frame);
      host.remove();
      if (page.__openbitfunControlGuiFloatingEditor === current) delete page.__openbitfunControlGuiFloatingEditor;
    }
  };
  page.__openbitfunControlGuiFloatingEditor = current;
  place();
  textarea.focus({ preventScroll: true });
})(
    arg, 'open', '');
},
"editorClose": (arg) => {
(function runFloatingEditor(input, mode, status) {
  const page = window;
  const previous = page.__openbitfunControlGuiFloatingEditor;
  if (mode === "status") {
    previous?.status(status);
    return;
  };
  previous?.close();
  if (mode !== "open" || !input) return;
  const samePage = (a, b) => {
    try {
      const left = new URL(a);
      const right = new URL(b);
      left.hash = "";
      right.hash = "";
      return left.href === right.href;
    } catch {
      return false;
    }
  };
  if (!samePage(window.location.href, input.target.pageUrl)) return;
  const findTarget = () => {
    try {
      return document.querySelector(input.target.path);
    } catch {
      return null;
    }
  };
  let previewTextNode = null;
  let previewTextExpected = null;
  const targetRect = (element) => {
    const fragment = input.target.textRange;
    if (!fragment) return element.getBoundingClientRect();
    const node = element.childNodes[fragment.nodeIndex];
    if (!node || node.nodeType !== Node.TEXT_NODE || node.textContent?.trim() !== fragment.text && !(node === previewTextNode && node.textContent === previewTextExpected)) return null;
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
  if (!selected || selected.tagName.toLowerCase() !== input.target.tagName.toLowerCase() || !targetRect(selected)) return;
  const host = document.createElement("div");
  host.setAttribute("data-openbitfun-controlgui-editor", "");
  host.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483646;";
  const shadow = host.attachShadow({ mode: "closed" });
  const styleEach = (node, declarations2) => {
    for (const [property, value] of Object.entries(declarations2)) {
      node.style.setProperty(property, value);
    }
  };
  const css = [
    ":host{all:initial;color-scheme:dark}",
    "*{box-sizing:border-box}",
    "textarea::placeholder{color:#85858b}",
    "textarea:focus{border-color:#4b96f6!important;outline:none}",
    "button:focus-visible{outline:2px solid #60a5fa;outline-offset:2px}",
    "button:hover{filter:brightness(1.12)}"
  ].join("");
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    shadow.adoptedStyleSheets = [...shadow.adoptedStyleSheets, sheet];
  } catch {
  };
  const highlight = document.createElement("div");
  highlight.setAttribute("data-controlgui-selected-outline", "");
  highlight.style.cssText = [
    "position:fixed",
    "display:none",
    "pointer-events:none",
    "box-sizing:border-box",
    "border:2px solid #3979ff",
    "border-radius:8px",
    "background:rgba(47,107,255,.09)",
    "z-index:1"
  ].join(";");
  styleEach(highlight, {
    position: "fixed",
    display: "none",
    "pointer-events": "none",
    "box-sizing": "border-box",
    border: "2px solid #3979ff",
    "border-radius": "8px",
    background: "transparent",
    "box-shadow": "none",
    "z-index": "1"
  });
  const editor = document.createElement("div");
  editor.className = "editor";
  editor.setAttribute("role", "dialog");
  editor.setAttribute("aria-label", "ControlGUI 网页元素批注");
  styleEach(editor, {
    position: "fixed",
    display: "flex",
    "flex-direction": "column",
    gap: "10px",
    "box-sizing": "border-box",
    width: "340px",
    "max-width": "calc(100vw - 16px)",
    "max-height": "calc(100vh - 16px)",
    "overflow-y": "auto",
    padding: "14px",
    "border-radius": "16px",
    background: "#1b1b1d",
    color: "#ededf0",
    border: "1px solid #333337",
    "box-shadow": "0 18px 48px rgba(0,0,0,.35),0 3px 10px rgba(0,0,0,.18)",
    "pointer-events": "auto",
    "font-family": "system-ui,sans-serif",
    "font-size": "13px",
    "line-height": "1.5",
    "z-index": "2",
    "color-scheme": "dark"
  });
  const heading = document.createElement("header");
  styleEach(heading, { display: "flex", "align-items": "center", "justify-content": "space-between", gap: "8px", "min-width": "0" });
  const title = document.createElement("button");
  title.type = "button";
  title.setAttribute("aria-expanded", "true");
  title.title = "展开或收起元素 CSS 属性";
  styleEach(title, {
    display: "flex",
    "align-items": "center",
    gap: "7px",
    color: "#d0d0d4",
    background: "transparent",
    border: "0",
    padding: "0",
    "font-weight": "500",
    "font-size": "13px",
    "min-width": "0",
    cursor: "pointer",
    "text-align": "left",
    flex: "1",
    "font-family": "system-ui,sans-serif"
  });
  const chevron = document.createElement("span");
  chevron.textContent = "⌄";
  chevron.setAttribute("aria-hidden", "true");
  styleEach(chevron, { color: "#a0a0a8", flex: "0 0 auto", "font-size": "16px" });
  const titleText = document.createElement("span");
  styleEach(titleText, { "min-width": "0", overflow: "hidden", "white-space": "nowrap", "text-overflow": "ellipsis" });
  const friendlyName = (input.target.textContent || selected.textContent || "").replace(/\s+/g, " ").trim().slice(0, 48);
  titleText.textContent = input.target.tagName.toLowerCase() + (friendlyName ? ' "' + friendlyName + '"' : "");
  title.append(chevron, titleText);
  const close = document.createElement("button");
  close.className = "close";
  close.type = "button";
  close.title = "取消批注";
  close.setAttribute("aria-label", "取消批注");
  close.textContent = "×";
  styleEach(close, { flex: "0 0 auto", border: "0", "border-radius": "7px", padding: "0 4px", background: "transparent", color: "#a0a0a8", "font-size": "20px", cursor: "pointer" });
  const grip = document.createElement("button");
  grip.type = "button";
  grip.textContent = "⠿";
  grip.title = "拖动面板";
  grip.setAttribute("aria-label", "拖动面板");
  styleEach(grip, { border: "0", background: "transparent", color: "#a0a0a8", cursor: "grab", "touch-action": "none", "font-size": "19px", padding: "0 3px", "flex-shrink": "0" });
  const peek = document.createElement("button");
  peek.type = "button";
  peek.textContent = "查看效果";
  peek.setAttribute("aria-label", "查看效果");
  styleEach(peek, { border: "1px solid #48484f", "border-radius": "6px", background: "#28282b", color: "#ededf0", padding: "3px 6px", "font-size": "11px", cursor: "pointer", "white-space": "nowrap" });
  heading.append(grip, title, peek, close);
  const properties = document.createElement("div");
  properties.setAttribute("data-controlgui-computed-styles", "");
  properties.setAttribute("aria-label", "当前元素 CSS 属性");
  styleEach(properties, {
    background: "#28282b",
    "border-radius": "8px",
    padding: "9px 11px",
    "font-family": "ui-monospace,Consolas,monospace",
    "font-size": "12px",
    "line-height": "1.6",
    color: "#dedee4",
    "overflow-wrap": "anywhere",
    "flex-shrink": "0"
  });
  const styled = selected instanceof HTMLElement || selected instanceof SVGElement ? selected : null;
  const originalAttr = styled?.getAttribute("style") ?? null;
  let expectedAttr = originalAttr;
  let stale = false;
  const initial = /* @__PURE__ */ new Map();
  const computed = window.getComputedStyle(selected);
  for (let i = 0; i < computed.length; i++) {
    const name = computed.item(i);
    initial.set(name, computed.getPropertyValue(name).trim());
  };
  const fragmentNode = input.target.textRange ? selected.childNodes[input.target.textRange.nodeIndex] : selected.childNodes.length === 1 ? selected.firstChild : null;
  const textNode = fragmentNode?.nodeType === Node.TEXT_NODE && !["SCRIPT", "STYLE", "TEXTAREA", "TITLE", "OPTION"].includes(selected.tagName.toUpperCase()) ? fragmentNode : null;
  previewTextNode = textNode;
  const originalText = textNode?.data ?? "";
  let expectedText = originalText;
  previewTextExpected = originalText;
  let textChanged = false;
  let textPreviewSuspended = false;
  const restoreText = () => {
    if (textNode && textChanged && textNode.data === previewTextExpected) textNode.data = originalText;
  };
  const changes = /* @__PURE__ */ new Map();
  const fields = /* @__PURE__ */ new Map();
  const invalidFields = /* @__PURE__ */ new Set();
  const colors = /* @__PURE__ */ new Map();
  const declarations = (style) => {
    const result = /* @__PURE__ */ new Map();
    for (let i = 0; i < style.length; i++) {
      const name = style.item(i);
      result.set(name, [style.getPropertyValue(name), style.getPropertyPriority(name)]);
    };
    return result;
  };
  const originalInline = styled ? declarations(styled.style) : /* @__PURE__ */ new Map();
  const owned = /* @__PURE__ */ new Map();
  const samePair = (a, b) => a?.[0] === b?.[0] && a?.[1] === b?.[1];
  const restorePreview = () => {
    if (!styled || !owned.size) return;
    if (styled.getAttribute("style") === expectedAttr) {
      if (originalAttr === null) styled.removeAttribute("style");
      else styled.setAttribute("style", originalAttr);
    } else {
      const current2 = declarations(styled.style);
      for (const [name, pair] of owned) {
        if (!samePair(current2.get(name), pair)) continue;
        const old = originalInline.get(name);
        if (old) styled.style.setProperty(name, old[0], old[1]);
        else styled.style.removeProperty(name);
      }
    };
    owned.clear();
    expectedAttr = styled.getAttribute("style");
  };
  const rebuild = () => {
    if (stale || !styled || !selected.isConnected || findTarget() !== selected) return false;
    if (styled.getAttribute("style") !== expectedAttr) {
      restorePreview();
      stale = true;
      showNotice("页面样式已更新，请重新选择元素。");
      return false;
    };
    restorePreview();
    for (const [name, value] of changes) styled.style.setProperty(name, value, "important");
    expectedAttr = styled.getAttribute("style");
    const current2 = declarations(styled.style);
    for (const name of /* @__PURE__ */ new Set([...originalInline.keys(), ...current2.keys()])) if (!samePair(originalInline.get(name), current2.get(name))) owned.set(name, current2.get(name));
    schedule();
    return true;
  };
  const validName = (n) => /^-?[a-z][a-z0-9-]*$/.test(n) && n.length <= 80 && !["behavior", "-moz-binding"].includes(n);
  const validValue = (n, v) => {
    if (!validName(n) || !v || v.length > 350 || /[;{}!\\]|url\s*\(|(?:-webkit-)?image-set\s*\(|\bimage\s*\(|\bcross-fade\s*\(|\bsrc\s*\(|expression\s*\(|@import|\bvar\s*\(|\battr\s*\(/i.test(v)) return false;
    try {
      if (typeof CSS !== "undefined" && CSS.supports) return CSS.supports(n, v);
      const probe = document.createElement("div").style;
      probe.setProperty(n, v);
      return !!probe.getPropertyValue(n);
    } catch {
      return false;
    }
  };
  const originalValue = (name) => initial.get(name) ?? "";
  const changeCount = document.createElement("div");
  const refreshCount = () => {
    changeCount.textContent = "已调整 " + (changes.size + (textChanged ? 1 : 0)) + " 项 · 临时预览";
  };
  const update = (name, raw) => {
    const v = raw.trim();
    if (!validValue(name, v)) {
      invalidFields.add(name);
      showNotice("无效或暂不支持的 CSS 值：" + name);
      return false;
    };
    invalidFields.delete(name);
    if (!styled || stale) return false;
    const previous2 = changes.get(name);
    if (v === originalValue(name)) changes.delete(name);
    else changes.set(name, v);
    if (!rebuild()) {
      if (previous2 === void 0) changes.delete(name);
      else changes.set(name, previous2);
      return false;
    };
    showNotice("");
    refreshCount();
    return true;
  };
  const hex = (v) => {
    if (/^#[a-f0-9]{6}$/i.test(v)) return v;
    const m = v.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
    return m ? "#" + m.slice(1, 4).map((n) => Math.min(255, Number(n)).toString(16).padStart(2, "0")).join("") : null;
  };
  const reset = (name) => {
    if (name) {
      changes.delete(name);
      invalidFields.delete(name);
    } else {
      changes.clear();
      invalidFields.clear();
    };
    for (const [key, field] of fields) if (!name || name === key) {
      field.value = originalValue(key);
      const c = colors.get(key);
      if (c) c.value = hex(field.value) || "#000000";
    };
    if (!name && textField) {
      if (textNode?.data !== previewTextExpected) {
        stale = true;
        showNotice("页面文本已更新，请重新选择。");
      } else {
        restoreText();
        expectedText = originalText;
        previewTextExpected = originalText;
        textChanged = false;
        textField.value = originalText;
      }
    };
    rebuild();
    refreshCount();
  };
  styleEach(properties, { "font-family": "system-ui,sans-serif", "max-height": "min(320px, 45vh)", "overflow-y": "auto", display: "block", padding: "8px 10px" });
  const controlStyle = (node) => styleEach(node, { "box-sizing": "border-box", "min-width": "0", color: "#ededf0", background: "#202023", border: "1px solid #48484f", "border-radius": "7px", padding: "5px 7px", "font-size": "12px", "font-family": "system-ui,sans-serif" });
  const intro = document.createElement("div");
  styleEach(intro, { display: "flex", "justify-content": "space-between", "align-items": "center", gap: "4px", "margin-bottom": "6px" });
  const resetAll = document.createElement("button");
  resetAll.type = "button";
  resetAll.textContent = "恢复原样";
  controlStyle(resetAll);
  resetAll.addEventListener("click", () => reset());
  styleEach(changeCount, { color: "#a7bfff", "font-size": "11px" });
  refreshCount();
  intro.append(changeCount, resetAll);
  properties.append(intro);
  if (input.target.textRange) {
    const hint = document.createElement("div");
    hint.textContent = "CSS 预览作用于所选文字的父元素。";
    properties.append(hint);
  };
  let textField = null;
  if (textNode) {
    const row = document.createElement("div");
    styleEach(row, { display: "flex", "align-items": "center", gap: "5px", margin: "5px 0" });
    const label = document.createElement("label");
    label.textContent = "文本";
    styleEach(label, { flex: "0 0 36%", color: "#c6c6ce", "font-size": "12px" });
    const field = document.createElement("input");
    textField = field;
    field.type = "text";
    field.value = originalText;
    field.maxLength = 500;
    field.setAttribute("aria-label", "元素文本");
    controlStyle(field);
    styleEach(field, { flex: "1", width: "0" });
    field.addEventListener("input", () => {
      if (!selected.isConnected || findTarget() !== selected || textNode.parentNode !== selected || textNode.data !== previewTextExpected) {
        stale = true;
        showNotice("页面文本已更新，请重新选择。");
        return;
      };
      expectedText = field.value;
      textPreviewSuspended = false;
      previewTextExpected = expectedText;
      textChanged = expectedText !== originalText;
      textNode.data = expectedText;
      refreshCount();
      schedule();
    });
    row.append(label, field);
    properties.append(row);
  };
  const labels = {
    color: "文本颜色",
    "background-color": "背景颜色",
    opacity: "Opacity",
    "font-family": "字体",
    "font-size": "字号",
    "font-weight": "字重",
    "line-height": "行高",
    "text-align": "文本对齐",
    "letter-spacing": "字间距",
    width: "宽度",
    height: "高度",
    "min-width": "最小宽度",
    "min-height": "最小高度",
    padding: "内边距",
    margin: "外边距",
    gap: "间距",
    "border-radius": "圆角",
    "border-width": "边框宽度",
    "border-style": "边框样式",
    "border-color": "边框颜色",
    "box-shadow": "阴影",
    "text-shadow": "文字阴影",
    display: "Display",
    position: "定位",
    "flex-direction": "方向",
    "justify-content": "主轴对齐",
    "align-items": "交叉轴对齐",
    "flex-wrap": "换行",
    "grid-template-columns": "Grid 列",
    overflow: "溢出",
    cursor: "光标",
    "text-decoration": "文字装饰",
    "max-width": "最大宽度",
    "max-height": "最大高度"
  };
  const makeRow = (name, parent) => {
    if (fields.has(name)) return;
    if (!initial.has(name)) initial.set(name, computed.getPropertyValue(name).trim());
    const value = originalValue(name);
    const row = document.createElement("div");
    row.setAttribute("data-css-property", name);
    styleEach(row, { display: "flex", "align-items": "center", gap: "5px", margin: "5px 0" });
    const key = document.createElement("label");
    key.textContent = labels[name] || name;
    key.title = name;
    styleEach(key, { color: "#c6c6ce", flex: "0 0 36%", "min-width": "0", "overflow-wrap": "anywhere", "font-size": "12px" });
    const field = document.createElement("input");
    field.type = "text";
    field.value = value;
    field.placeholder = "CSS 值";
    field.spellcheck = false;
    field.setAttribute("aria-label", name);
    field.maxLength = 350;
    controlStyle(field);
    styleEach(field, { flex: "1", width: "0" });
    fields.set(name, field);
    row.append(key);
    if (name === "color" || name.endsWith("-color")) {
      const c = document.createElement("input");
      c.type = "color";
      c.value = hex(value) || "#000000";
      c.title = "选择颜色";
      c.setAttribute("aria-label", name + " 拾色器");
      styleEach(c, { width: "27px", height: "29px", padding: "1px", border: "0", background: "transparent", "flex-shrink": "0", cursor: "pointer" });
      colors.set(name, c);
      c.addEventListener("input", () => {
        field.value = c.value;
        update(name, field.value);
      });
      row.append(c);
    };
    const apply = () => {
      if (update(name, field.value)) {
        const c = colors.get(name);
        if (c) c.value = hex(field.value) || c.value;
      }
    };
    field.addEventListener("input", () => {
      if (validValue(name, field.value.trim())) apply();
      else invalidFields.add(name);
    });
    field.addEventListener("change", apply);
    field.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        apply();
      }
    });
    const undo = document.createElement("button");
    undo.type = "button";
    undo.textContent = "↶";
    undo.title = "恢复 " + name;
    undo.setAttribute("aria-label", "恢复 " + name);
    controlStyle(undo);
    styleEach(undo, { padding: "4px 5px", "flex-shrink": "0", cursor: "pointer" });
    undo.addEventListener("click", () => reset(name));
    row.append(field, undo);
    parent.append(row);
  };
  for (const name of ["color", "background-color", "opacity", "font-family", "font-size", "font-weight", "width", "height", "padding", "margin", "border-radius"]) makeRow(name, properties);
  const more = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = "更多样式 · 布局 / 边框 / 阴影";
  styleEach(summary, { cursor: "pointer", color: "#a7bfff", margin: "8px 0" });
  more.append(summary);
  for (const name of Object.keys(labels)) if (!fields.has(name)) makeRow(name, more);
  properties.append(more);
  const advanced = document.createElement("details");
  const advancedTitle = document.createElement("summary");
  advancedTitle.textContent = "高级 CSS · 搜索属性";
  styleEach(advancedTitle, { cursor: "pointer", color: "#a7bfff", margin: "8px 0" });
  const search = document.createElement("input");
  search.type = "text";
  search.placeholder = "如 transform / padding-top";
  search.setAttribute("aria-label", "自定义 CSS 属性");
  controlStyle(search);
  styleEach(search, { width: "100%" });
  const choices = document.createElement("div");
  styleEach(choices, { display: "flex", "flex-wrap": "wrap", gap: "3px", margin: "5px 0" });
  const advancedRows = document.createElement("div");
  const addProperty = (raw) => {
    const n = raw.trim().toLowerCase();
    if (!validName(n)) {
      showNotice("请输入标准 CSS 属性名。");
      return;
    };
    if (typeof CSS !== "undefined" && CSS.supports && !CSS.supports(n, "initial")) {
      showNotice("浏览器不支持此 CSS 属性。");
      return;
    };
    if (fields.has(n)) {
      if (more.contains(fields.get(n))) more.open = true;
      fields.get(n)?.focus();
    } else makeRow(n, advancedRows);
    schedule();
  };
  search.addEventListener("input", () => {
    choices.replaceChildren();
    const q = search.value.trim().toLowerCase();
    if (!q) return;
    for (const n of [...initial.keys()].filter((n2) => n2.includes(q) && validName(n2)).slice(0, 10)) {
      const item = document.createElement("button");
      item.type = "button";
      item.textContent = n;
      controlStyle(item);
      item.addEventListener("click", () => addProperty(n));
      choices.append(item);
    }
  });
  const add = document.createElement("button");
  add.type = "button";
  add.textContent = "添加 CSS 属性";
  controlStyle(add);
  add.addEventListener("click", () => addProperty(search.value));
  search.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addProperty(search.value);
    }
  });
  advanced.append(advancedTitle, search, choices, add, advancedRows);
  properties.append(advanced);
  const cssComment = () => changes.size ? "CSS 修改要求（临时预览，需落实到源码）：\n" + [...changes].map(([n, v]) => "- " + n + ": " + (originalValue(n) || "(未设置)") + " → " + v).join("\n") : "";
  const finalComment = () => [textarea.value.trim(), textChanged ? "文本修改：" + JSON.stringify(originalText) + " → " + JSON.stringify(expectedText) : "", cssComment()].filter(Boolean).join("\n\n");
  title.addEventListener("click", () => {
    const expanded = title.getAttribute("aria-expanded") === "true";
    title.setAttribute("aria-expanded", String(!expanded));
    properties.hidden = expanded;
    properties.style.display = expanded ? "none" : "block";
    chevron.textContent = expanded ? "›" : "⌄";
    schedule();
  });
  const textarea = document.createElement("textarea");
  textarea.setAttribute("aria-label", "网页元素批注内容");
  textarea.placeholder = "描述希望怎样修改这个元素…";
  textarea.maxLength = 3e3;
  textarea.value = input.comment;
  styleEach(textarea, {
    "box-sizing": "border-box",
    display: "block",
    width: "100%",
    height: "76px",
    "min-height": "76px",
    "max-height": "180px",
    "flex-shrink": "0",
    resize: "vertical",
    padding: "10px 11px",
    margin: "0",
    border: "1px solid #49494e",
    "border-radius": "9px",
    background: "#262628",
    color: "#f2f2f4",
    outline: "none",
    "font-family": "system-ui,sans-serif",
    "font-size": "13px",
    "line-height": "1.5"
  });
  const notice = document.createElement("div");
  notice.className = "notice";
  notice.setAttribute("role", "status");
  notice.style.display = "none";
  notice.style.cssText = "font:11px/1.4 system-ui,sans-serif;color:#fca5a5;white-space:pre-wrap;";
  styleEach(notice, { "font-size": "11px", color: "#fca5a5", "white-space": "pre-wrap" });
  notice.style.display = "none";
  const showNotice = (message) => {
    notice.textContent = message;
    notice.style.display = message && !peeking ? "block" : "none";
    schedule();
  };
  const actions = document.createElement("div");
  actions.className = "row";
  actions.style.cssText = "display:flex;align-items:center;justify-content:flex-end;gap:8px;";
  styleEach(actions, { display: "flex", "align-items": "center", "justify-content": "flex-end", gap: "8px" });
  const remove = document.createElement("button");
  remove.className = "danger";
  remove.type = "button";
  remove.textContent = "删除";
  remove.style.cssText = "margin-right:auto;border:0;background:transparent;color:#b42318;border-radius:8px;padding:6px 8px;font:600 12px/1.4 system-ui,sans-serif;cursor:pointer;";
  styleEach(remove, { "margin-right": "auto", border: "0", background: "transparent", color: "#fca5a5", "border-radius": "8px", padding: "6px 8px", "font-size": "12px", "font-weight": "600", cursor: "pointer" });
  if (input.index === null) remove.style.display = "none";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "取消";
  cancel.style.cssText = "border:1px solid #d7e0ed;background:#fff;color:#374151;border-radius:8px;padding:6px 12px;font:600 12px/1.4 system-ui,sans-serif;cursor:pointer;";
  styleEach(cancel, { border: "1px solid transparent", background: "transparent", color: "#b8b8be", "border-radius": "8px", padding: "6px 12px", "font-size": "12px", "font-weight": "600", cursor: "pointer" });
  const save = document.createElement("button");
  save.className = "primary";
  save.type = "button";
  save.textContent = input.index === null ? "保存批注" : "更新批注";
  save.style.cssText = "border:1px solid #2f6bff;background:#2f6bff;color:white;border-radius:8px;padding:6px 13px;font:600 12px/1.4 system-ui,sans-serif;cursor:pointer;";
  styleEach(save, { border: "1px solid #2f6bff", background: "#2f6bff", color: "#fff", "border-radius": "20px", padding: "7px 15px", "font-size": "12px", "font-weight": "600", cursor: "pointer" });
  actions.append(remove, cancel, save);
  editor.append(heading, textarea, properties, notice, actions);
  shadow.append(highlight, editor);
  document.documentElement.appendChild(host);
  try {
    const ready = bridge?.invoke?.("plugin:event|emit", {
      event: "browser-controlgui-editor-opened-" + input.label,
      payload: {
        path: input.target.path,
        index: input.index,
        pageUrl: location.href,
        ...input.target.textRange ? { textRange: input.target.textRange } : {}
      }
    });
    if (ready) void ready.catch(() => {
    });
  } catch {
  };
  let closed = false;
  let frame = 0;
  let peeking = false;
  let manualPosition = null;
  let drag = null;
  const place = () => {
    if (closed) return;
    const element = findTarget();
    if (!element || !samePage(location.href, input.target.pageUrl)) {
      restorePreview();
      restoreText();
      editor.style.display = "none";
      highlight.style.display = "none";
      return;
    };
    if (element !== selected && (changes.size || textChanged)) {
      restorePreview();
      restoreText();
      stale = true;
    };
    const rect = targetRect(element);
    if (!rect) {
      highlight.style.display = "none";
      editor.style.display = "none";
      return;
    };
    const pickerVisible = page.__openbitfun_inspector_instance?.overlay?.isConnected === true;
    highlight.style.display = rect.width > 0 && rect.height > 0 && !pickerVisible ? "block" : "none";
    highlight.style.top = rect.top + "px";
    highlight.style.left = rect.left + "px";
    highlight.style.width = Math.max(0, rect.width) + "px";
    highlight.style.height = Math.max(0, rect.height) + "px";
    const style = getComputedStyle(element);
    const blue = (value) => {
      const colors2 = String(value || "").matchAll(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s\/]+([\d.]+))?\s*\)/gi);
      for (const parts of colors2) {
        const r = Number(parts[1]), g = Number(parts[2]), b = Number(parts[3]);
        const alpha = parts[4] === void 0 ? 1 : Number(parts[4]);
        if (alpha >= 0.35 && b >= 145 && b > r + 60 && b > g + 30) return true;
      };
      return false;
    };
    const nativeBlue = blue(style.boxShadow) || parseFloat(style.outlineWidth) >= 1 && style.outlineStyle !== "none" && blue(style.outlineColor) || ["Top", "Right", "Bottom", "Left"].some((side) => parseFloat(style.getPropertyValue("border-" + side.toLowerCase() + "-width")) >= 1 && style.getPropertyValue("border-" + side.toLowerCase() + "-style") !== "none" && blue(style.getPropertyValue("border-" + side.toLowerCase() + "-color")));
    highlight.style.borderColor = nativeBlue ? "transparent" : "#3979ff";
    editor.style.display = "flex";
    const avoid = element.getBoundingClientRect();
    const edge = 8, gap = 12;
    const vw = Math.max(0, innerWidth), vh = Math.max(0, innerHeight);
    const availableWidth = Math.max(0, vw - edge * 2), availableHeight = Math.max(0, vh - edge * 2);
    const width = Math.min(peeking ? 148 : 340, availableWidth);
    const clamp = (value, low, high) => Math.max(low, Math.min(Math.max(low, high), value));
    editor.style.width = width + "px";
    editor.style.maxHeight = availableHeight + "px";
    editor.style.maxWidth = availableWidth + "px";
    const naturalHeight = Math.min(availableHeight, editor.scrollHeight || editor.offsetHeight || (peeking ? 40 : properties.hidden ? 180 : 300));
    const x = clamp(avoid.left, edge, vw - width - edge), y = clamp(avoid.top, edge, vh - naturalHeight - edge);
    const slots = [
      { left: x, top: Math.max(edge, avoid.bottom + gap), w: width, h: Math.max(0, vh - edge - Math.max(edge, avoid.bottom + gap)), side: "below" },
      { left: x, top: edge, w: width, h: Math.max(0, Math.min(vh - edge, avoid.top - gap) - edge), side: "above" },
      { left: Math.max(edge, avoid.right + gap), top: y, w: Math.max(0, Math.min(width, vw - edge - Math.max(edge, avoid.right + gap))), h: availableHeight, side: "right" },
      { left: edge, top: y, w: Math.max(0, Math.min(width, avoid.left - gap - edge)), h: availableHeight, side: "left" }
    ];
    const fits = slots.find((slot2) => slot2.w >= width && slot2.h >= naturalHeight);
    const useful = slots.filter((slot2) => slot2.w >= Math.min(240, width) && slot2.h >= Math.min(150, naturalHeight)).sort((a, b) => Math.min(b.w, width) * Math.min(b.h, naturalHeight) - Math.min(a.w, width) * Math.min(a.h, naturalHeight));
    const slot = fits ?? useful[0];
    if (manualPosition) {
      editor.style.left = clamp(manualPosition.left, edge, vw - width - edge) + "px";
      editor.style.top = clamp(manualPosition.top, edge, vh - naturalHeight - edge) + "px";
    } else if (slot) {
      const w = Math.min(slot.w, width);
      editor.style.width = w + "px";
      editor.style.maxHeight = slot.h + "px";
      const h = Math.min(slot.h, editor.offsetHeight || naturalHeight);
      editor.style.left = (slot.side === "left" ? clamp(avoid.left - gap - w, edge, vw - w - edge) : clamp(slot.left, edge, vw - w - edge)) + "px";
      editor.style.top = (slot.side === "above" ? clamp(avoid.top - gap - h, edge, vh - h - edge) : clamp(slot.top, edge, vh - h - edge)) + "px";
    } else {
      editor.style.left = x + "px";
      editor.style.top = clamp(avoid.top - naturalHeight - gap, edge, vh - naturalHeight - edge) + "px";
    }
  };
  const schedule = () => {
    if (closed || frame) return;
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      place();
    });
  };
  const togglePeek = () => {
    peeking = !peeking;
    peek.textContent = peeking ? "继续编辑" : "查看效果";
    peek.setAttribute("aria-label", peek.textContent);
    peek.setAttribute("aria-pressed", String(peeking));
    textarea.style.display = peeking ? "none" : "block";
    properties.style.display = peeking || properties.hidden ? "none" : "block";
    actions.style.display = peeking ? "none" : "flex";
    notice.style.display = peeking ? "none" : notice.textContent ? "block" : "none";
    title.style.display = peeking ? "none" : "flex";
    editor.style.padding = peeking ? "6px 8px" : "14px";
    manualPosition = null;
    place();
  };
  peek.addEventListener("click", togglePeek);
  grip.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const rect = editor.getBoundingClientRect();
    drag = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, id: event.pointerId };
    grip.setPointerCapture?.(event.pointerId);
    grip.style.cursor = "grabbing";
  });
  grip.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    manualPosition = { left: drag.left + event.clientX - drag.x, top: drag.top + event.clientY - drag.y };
    place();
  });
  const endDrag = () => {
    drag = null;
    grip.style.cursor = "grab";
  };
  grip.addEventListener("pointerup", endDrag);
  grip.addEventListener("pointercancel", endDrag);
  grip.addEventListener("lostpointercapture", endDrag);
  grip.addEventListener("dblclick", () => {
    manualPosition = null;
    place();
  });
  const report = (action) => {
    if (closed) return;
    const invoke = bridge?.invoke;
    if (typeof invoke !== "function") {
      showNotice("无法连接 BitFun 批注服务。");
      return;
    };
    void invoke("plugin:event|emit", {
      event: "browser-controlgui-editor-" + input.label,
      payload: {
        action,
        pageUrl: location.href,
        path: input.target.path,
        index: input.index,
        comment: action === "save" ? finalComment() : textarea.value,
        ...input.target.textRange ? { textRange: input.target.textRange } : {}
      }
    }).catch(() => {
      showNotice("未能发送批注指令，请重试。");
    });
  };
  const onKey = (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      report("cancel");
    }
  };
  const onView = () => {
    schedule();
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("scroll", onView, true);
  window.addEventListener("resize", onView);
  shadow.addEventListener("pointerdown", (event) => event.stopPropagation());
  shadow.addEventListener("click", (event) => event.stopPropagation());
  shadow.addEventListener("keydown", (event) => event.stopPropagation());
  shadow.addEventListener("keydown", onKey);
  close.addEventListener("click", () => report("cancel"));
  cancel.addEventListener("click", () => report("cancel"));
  remove.addEventListener("click", () => report("delete"));
  save.addEventListener("click", () => {
    if (invalidFields.size) {
      showNotice("请修正或恢复无效 CSS 属性：" + [...invalidFields].join(", "));
      return;
    };
    if (stale || textNode && textNode.data !== previewTextExpected || styled && styled.getAttribute("style") !== expectedAttr) {
      showNotice("页面样式已更新，请重新选择。");
      return;
    };
    if (finalComment().length > 3e3) {
      showNotice("批注与 CSS 差异超过 3000 字符，请减少修改项。");
      return;
    };
    if (finalComment().length < 2) {
      showNotice("批注至少需要两个字符。");
      return;
    };
    const currentTarget = findTarget();
    if (!currentTarget || currentTarget !== selected || !targetRect(currentTarget)) {
      showNotice("页面已更新，无法找到原来的元素，请重新选择。");
      return;
    };
    if (textChanged && textNode && input.target.textRange) {
      restoreText();
      previewTextExpected = originalText;
      textPreviewSuspended = true;
    };
    report("save");
  });
  const current = {
    owner: input.label,
    status(message) {
      if (textPreviewSuspended && textNode && textNode.data === originalText && findTarget() === selected) {
        textNode.data = expectedText;
        previewTextExpected = expectedText;
        textPreviewSuspended = false;
      };
      showNotice(message);
    },
    draftText() {
      return textarea.value;
    },
    close() {
      if (closed) return;
      closed = true;
      restorePreview();
      restoreText();
      observer.disconnect();
      window.removeEventListener("scroll", onView, true);
      window.removeEventListener("resize", onView);
      if (frame) window.cancelAnimationFrame(frame);
      host.remove();
      if (page.__openbitfunControlGuiFloatingEditor === current) delete page.__openbitfunControlGuiFloatingEditor;
    }
  };
  page.__openbitfunControlGuiFloatingEditor = current;
  place();
  textarea.focus({ preventScroll: true });
})(null, 'close', '');
},
"editorStatus": (arg) => {
(function runFloatingEditor(input, mode, status) {
  const page = window;
  const previous = page.__openbitfunControlGuiFloatingEditor;
  if (mode === "status") {
    previous?.status(status);
    return;
  };
  previous?.close();
  if (mode !== "open" || !input) return;
  const samePage = (a, b) => {
    try {
      const left = new URL(a);
      const right = new URL(b);
      left.hash = "";
      right.hash = "";
      return left.href === right.href;
    } catch {
      return false;
    }
  };
  if (!samePage(window.location.href, input.target.pageUrl)) return;
  const findTarget = () => {
    try {
      return document.querySelector(input.target.path);
    } catch {
      return null;
    }
  };
  let previewTextNode = null;
  let previewTextExpected = null;
  const targetRect = (element) => {
    const fragment = input.target.textRange;
    if (!fragment) return element.getBoundingClientRect();
    const node = element.childNodes[fragment.nodeIndex];
    if (!node || node.nodeType !== Node.TEXT_NODE || node.textContent?.trim() !== fragment.text && !(node === previewTextNode && node.textContent === previewTextExpected)) return null;
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
  if (!selected || selected.tagName.toLowerCase() !== input.target.tagName.toLowerCase() || !targetRect(selected)) return;
  const host = document.createElement("div");
  host.setAttribute("data-openbitfun-controlgui-editor", "");
  host.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483646;";
  const shadow = host.attachShadow({ mode: "closed" });
  const styleEach = (node, declarations2) => {
    for (const [property, value] of Object.entries(declarations2)) {
      node.style.setProperty(property, value);
    }
  };
  const css = [
    ":host{all:initial;color-scheme:dark}",
    "*{box-sizing:border-box}",
    "textarea::placeholder{color:#85858b}",
    "textarea:focus{border-color:#4b96f6!important;outline:none}",
    "button:focus-visible{outline:2px solid #60a5fa;outline-offset:2px}",
    "button:hover{filter:brightness(1.12)}"
  ].join("");
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    shadow.adoptedStyleSheets = [...shadow.adoptedStyleSheets, sheet];
  } catch {
  };
  const highlight = document.createElement("div");
  highlight.setAttribute("data-controlgui-selected-outline", "");
  highlight.style.cssText = [
    "position:fixed",
    "display:none",
    "pointer-events:none",
    "box-sizing:border-box",
    "border:2px solid #3979ff",
    "border-radius:8px",
    "background:rgba(47,107,255,.09)",
    "z-index:1"
  ].join(";");
  styleEach(highlight, {
    position: "fixed",
    display: "none",
    "pointer-events": "none",
    "box-sizing": "border-box",
    border: "2px solid #3979ff",
    "border-radius": "8px",
    background: "transparent",
    "box-shadow": "none",
    "z-index": "1"
  });
  const editor = document.createElement("div");
  editor.className = "editor";
  editor.setAttribute("role", "dialog");
  editor.setAttribute("aria-label", "ControlGUI 网页元素批注");
  styleEach(editor, {
    position: "fixed",
    display: "flex",
    "flex-direction": "column",
    gap: "10px",
    "box-sizing": "border-box",
    width: "340px",
    "max-width": "calc(100vw - 16px)",
    "max-height": "calc(100vh - 16px)",
    "overflow-y": "auto",
    padding: "14px",
    "border-radius": "16px",
    background: "#1b1b1d",
    color: "#ededf0",
    border: "1px solid #333337",
    "box-shadow": "0 18px 48px rgba(0,0,0,.35),0 3px 10px rgba(0,0,0,.18)",
    "pointer-events": "auto",
    "font-family": "system-ui,sans-serif",
    "font-size": "13px",
    "line-height": "1.5",
    "z-index": "2",
    "color-scheme": "dark"
  });
  const heading = document.createElement("header");
  styleEach(heading, { display: "flex", "align-items": "center", "justify-content": "space-between", gap: "8px", "min-width": "0" });
  const title = document.createElement("button");
  title.type = "button";
  title.setAttribute("aria-expanded", "true");
  title.title = "展开或收起元素 CSS 属性";
  styleEach(title, {
    display: "flex",
    "align-items": "center",
    gap: "7px",
    color: "#d0d0d4",
    background: "transparent",
    border: "0",
    padding: "0",
    "font-weight": "500",
    "font-size": "13px",
    "min-width": "0",
    cursor: "pointer",
    "text-align": "left",
    flex: "1",
    "font-family": "system-ui,sans-serif"
  });
  const chevron = document.createElement("span");
  chevron.textContent = "⌄";
  chevron.setAttribute("aria-hidden", "true");
  styleEach(chevron, { color: "#a0a0a8", flex: "0 0 auto", "font-size": "16px" });
  const titleText = document.createElement("span");
  styleEach(titleText, { "min-width": "0", overflow: "hidden", "white-space": "nowrap", "text-overflow": "ellipsis" });
  const friendlyName = (input.target.textContent || selected.textContent || "").replace(/\s+/g, " ").trim().slice(0, 48);
  titleText.textContent = input.target.tagName.toLowerCase() + (friendlyName ? ' "' + friendlyName + '"' : "");
  title.append(chevron, titleText);
  const close = document.createElement("button");
  close.className = "close";
  close.type = "button";
  close.title = "取消批注";
  close.setAttribute("aria-label", "取消批注");
  close.textContent = "×";
  styleEach(close, { flex: "0 0 auto", border: "0", "border-radius": "7px", padding: "0 4px", background: "transparent", color: "#a0a0a8", "font-size": "20px", cursor: "pointer" });
  const grip = document.createElement("button");
  grip.type = "button";
  grip.textContent = "⠿";
  grip.title = "拖动面板";
  grip.setAttribute("aria-label", "拖动面板");
  styleEach(grip, { border: "0", background: "transparent", color: "#a0a0a8", cursor: "grab", "touch-action": "none", "font-size": "19px", padding: "0 3px", "flex-shrink": "0" });
  const peek = document.createElement("button");
  peek.type = "button";
  peek.textContent = "查看效果";
  peek.setAttribute("aria-label", "查看效果");
  styleEach(peek, { border: "1px solid #48484f", "border-radius": "6px", background: "#28282b", color: "#ededf0", padding: "3px 6px", "font-size": "11px", cursor: "pointer", "white-space": "nowrap" });
  heading.append(grip, title, peek, close);
  const properties = document.createElement("div");
  properties.setAttribute("data-controlgui-computed-styles", "");
  properties.setAttribute("aria-label", "当前元素 CSS 属性");
  styleEach(properties, {
    background: "#28282b",
    "border-radius": "8px",
    padding: "9px 11px",
    "font-family": "ui-monospace,Consolas,monospace",
    "font-size": "12px",
    "line-height": "1.6",
    color: "#dedee4",
    "overflow-wrap": "anywhere",
    "flex-shrink": "0"
  });
  const styled = selected instanceof HTMLElement || selected instanceof SVGElement ? selected : null;
  const originalAttr = styled?.getAttribute("style") ?? null;
  let expectedAttr = originalAttr;
  let stale = false;
  const initial = /* @__PURE__ */ new Map();
  const computed = window.getComputedStyle(selected);
  for (let i = 0; i < computed.length; i++) {
    const name = computed.item(i);
    initial.set(name, computed.getPropertyValue(name).trim());
  };
  const fragmentNode = input.target.textRange ? selected.childNodes[input.target.textRange.nodeIndex] : selected.childNodes.length === 1 ? selected.firstChild : null;
  const textNode = fragmentNode?.nodeType === Node.TEXT_NODE && !["SCRIPT", "STYLE", "TEXTAREA", "TITLE", "OPTION"].includes(selected.tagName.toUpperCase()) ? fragmentNode : null;
  previewTextNode = textNode;
  const originalText = textNode?.data ?? "";
  let expectedText = originalText;
  previewTextExpected = originalText;
  let textChanged = false;
  let textPreviewSuspended = false;
  const restoreText = () => {
    if (textNode && textChanged && textNode.data === previewTextExpected) textNode.data = originalText;
  };
  const changes = /* @__PURE__ */ new Map();
  const fields = /* @__PURE__ */ new Map();
  const invalidFields = /* @__PURE__ */ new Set();
  const colors = /* @__PURE__ */ new Map();
  const declarations = (style) => {
    const result = /* @__PURE__ */ new Map();
    for (let i = 0; i < style.length; i++) {
      const name = style.item(i);
      result.set(name, [style.getPropertyValue(name), style.getPropertyPriority(name)]);
    };
    return result;
  };
  const originalInline = styled ? declarations(styled.style) : /* @__PURE__ */ new Map();
  const owned = /* @__PURE__ */ new Map();
  const samePair = (a, b) => a?.[0] === b?.[0] && a?.[1] === b?.[1];
  const restorePreview = () => {
    if (!styled || !owned.size) return;
    if (styled.getAttribute("style") === expectedAttr) {
      if (originalAttr === null) styled.removeAttribute("style");
      else styled.setAttribute("style", originalAttr);
    } else {
      const current2 = declarations(styled.style);
      for (const [name, pair] of owned) {
        if (!samePair(current2.get(name), pair)) continue;
        const old = originalInline.get(name);
        if (old) styled.style.setProperty(name, old[0], old[1]);
        else styled.style.removeProperty(name);
      }
    };
    owned.clear();
    expectedAttr = styled.getAttribute("style");
  };
  const rebuild = () => {
    if (stale || !styled || !selected.isConnected || findTarget() !== selected) return false;
    if (styled.getAttribute("style") !== expectedAttr) {
      restorePreview();
      stale = true;
      showNotice("页面样式已更新，请重新选择元素。");
      return false;
    };
    restorePreview();
    for (const [name, value] of changes) styled.style.setProperty(name, value, "important");
    expectedAttr = styled.getAttribute("style");
    const current2 = declarations(styled.style);
    for (const name of /* @__PURE__ */ new Set([...originalInline.keys(), ...current2.keys()])) if (!samePair(originalInline.get(name), current2.get(name))) owned.set(name, current2.get(name));
    schedule();
    return true;
  };
  const validName = (n) => /^-?[a-z][a-z0-9-]*$/.test(n) && n.length <= 80 && !["behavior", "-moz-binding"].includes(n);
  const validValue = (n, v) => {
    if (!validName(n) || !v || v.length > 350 || /[;{}!\\]|url\s*\(|(?:-webkit-)?image-set\s*\(|\bimage\s*\(|\bcross-fade\s*\(|\bsrc\s*\(|expression\s*\(|@import|\bvar\s*\(|\battr\s*\(/i.test(v)) return false;
    try {
      if (typeof CSS !== "undefined" && CSS.supports) return CSS.supports(n, v);
      const probe = document.createElement("div").style;
      probe.setProperty(n, v);
      return !!probe.getPropertyValue(n);
    } catch {
      return false;
    }
  };
  const originalValue = (name) => initial.get(name) ?? "";
  const changeCount = document.createElement("div");
  const refreshCount = () => {
    changeCount.textContent = "已调整 " + (changes.size + (textChanged ? 1 : 0)) + " 项 · 临时预览";
  };
  const update = (name, raw) => {
    const v = raw.trim();
    if (!validValue(name, v)) {
      invalidFields.add(name);
      showNotice("无效或暂不支持的 CSS 值：" + name);
      return false;
    };
    invalidFields.delete(name);
    if (!styled || stale) return false;
    const previous2 = changes.get(name);
    if (v === originalValue(name)) changes.delete(name);
    else changes.set(name, v);
    if (!rebuild()) {
      if (previous2 === void 0) changes.delete(name);
      else changes.set(name, previous2);
      return false;
    };
    showNotice("");
    refreshCount();
    return true;
  };
  const hex = (v) => {
    if (/^#[a-f0-9]{6}$/i.test(v)) return v;
    const m = v.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
    return m ? "#" + m.slice(1, 4).map((n) => Math.min(255, Number(n)).toString(16).padStart(2, "0")).join("") : null;
  };
  const reset = (name) => {
    if (name) {
      changes.delete(name);
      invalidFields.delete(name);
    } else {
      changes.clear();
      invalidFields.clear();
    };
    for (const [key, field] of fields) if (!name || name === key) {
      field.value = originalValue(key);
      const c = colors.get(key);
      if (c) c.value = hex(field.value) || "#000000";
    };
    if (!name && textField) {
      if (textNode?.data !== previewTextExpected) {
        stale = true;
        showNotice("页面文本已更新，请重新选择。");
      } else {
        restoreText();
        expectedText = originalText;
        previewTextExpected = originalText;
        textChanged = false;
        textField.value = originalText;
      }
    };
    rebuild();
    refreshCount();
  };
  styleEach(properties, { "font-family": "system-ui,sans-serif", "max-height": "min(320px, 45vh)", "overflow-y": "auto", display: "block", padding: "8px 10px" });
  const controlStyle = (node) => styleEach(node, { "box-sizing": "border-box", "min-width": "0", color: "#ededf0", background: "#202023", border: "1px solid #48484f", "border-radius": "7px", padding: "5px 7px", "font-size": "12px", "font-family": "system-ui,sans-serif" });
  const intro = document.createElement("div");
  styleEach(intro, { display: "flex", "justify-content": "space-between", "align-items": "center", gap: "4px", "margin-bottom": "6px" });
  const resetAll = document.createElement("button");
  resetAll.type = "button";
  resetAll.textContent = "恢复原样";
  controlStyle(resetAll);
  resetAll.addEventListener("click", () => reset());
  styleEach(changeCount, { color: "#a7bfff", "font-size": "11px" });
  refreshCount();
  intro.append(changeCount, resetAll);
  properties.append(intro);
  if (input.target.textRange) {
    const hint = document.createElement("div");
    hint.textContent = "CSS 预览作用于所选文字的父元素。";
    properties.append(hint);
  };
  let textField = null;
  if (textNode) {
    const row = document.createElement("div");
    styleEach(row, { display: "flex", "align-items": "center", gap: "5px", margin: "5px 0" });
    const label = document.createElement("label");
    label.textContent = "文本";
    styleEach(label, { flex: "0 0 36%", color: "#c6c6ce", "font-size": "12px" });
    const field = document.createElement("input");
    textField = field;
    field.type = "text";
    field.value = originalText;
    field.maxLength = 500;
    field.setAttribute("aria-label", "元素文本");
    controlStyle(field);
    styleEach(field, { flex: "1", width: "0" });
    field.addEventListener("input", () => {
      if (!selected.isConnected || findTarget() !== selected || textNode.parentNode !== selected || textNode.data !== previewTextExpected) {
        stale = true;
        showNotice("页面文本已更新，请重新选择。");
        return;
      };
      expectedText = field.value;
      textPreviewSuspended = false;
      previewTextExpected = expectedText;
      textChanged = expectedText !== originalText;
      textNode.data = expectedText;
      refreshCount();
      schedule();
    });
    row.append(label, field);
    properties.append(row);
  };
  const labels = {
    color: "文本颜色",
    "background-color": "背景颜色",
    opacity: "Opacity",
    "font-family": "字体",
    "font-size": "字号",
    "font-weight": "字重",
    "line-height": "行高",
    "text-align": "文本对齐",
    "letter-spacing": "字间距",
    width: "宽度",
    height: "高度",
    "min-width": "最小宽度",
    "min-height": "最小高度",
    padding: "内边距",
    margin: "外边距",
    gap: "间距",
    "border-radius": "圆角",
    "border-width": "边框宽度",
    "border-style": "边框样式",
    "border-color": "边框颜色",
    "box-shadow": "阴影",
    "text-shadow": "文字阴影",
    display: "Display",
    position: "定位",
    "flex-direction": "方向",
    "justify-content": "主轴对齐",
    "align-items": "交叉轴对齐",
    "flex-wrap": "换行",
    "grid-template-columns": "Grid 列",
    overflow: "溢出",
    cursor: "光标",
    "text-decoration": "文字装饰",
    "max-width": "最大宽度",
    "max-height": "最大高度"
  };
  const makeRow = (name, parent) => {
    if (fields.has(name)) return;
    if (!initial.has(name)) initial.set(name, computed.getPropertyValue(name).trim());
    const value = originalValue(name);
    const row = document.createElement("div");
    row.setAttribute("data-css-property", name);
    styleEach(row, { display: "flex", "align-items": "center", gap: "5px", margin: "5px 0" });
    const key = document.createElement("label");
    key.textContent = labels[name] || name;
    key.title = name;
    styleEach(key, { color: "#c6c6ce", flex: "0 0 36%", "min-width": "0", "overflow-wrap": "anywhere", "font-size": "12px" });
    const field = document.createElement("input");
    field.type = "text";
    field.value = value;
    field.placeholder = "CSS 值";
    field.spellcheck = false;
    field.setAttribute("aria-label", name);
    field.maxLength = 350;
    controlStyle(field);
    styleEach(field, { flex: "1", width: "0" });
    fields.set(name, field);
    row.append(key);
    if (name === "color" || name.endsWith("-color")) {
      const c = document.createElement("input");
      c.type = "color";
      c.value = hex(value) || "#000000";
      c.title = "选择颜色";
      c.setAttribute("aria-label", name + " 拾色器");
      styleEach(c, { width: "27px", height: "29px", padding: "1px", border: "0", background: "transparent", "flex-shrink": "0", cursor: "pointer" });
      colors.set(name, c);
      c.addEventListener("input", () => {
        field.value = c.value;
        update(name, field.value);
      });
      row.append(c);
    };
    const apply = () => {
      if (update(name, field.value)) {
        const c = colors.get(name);
        if (c) c.value = hex(field.value) || c.value;
      }
    };
    field.addEventListener("input", () => {
      if (validValue(name, field.value.trim())) apply();
      else invalidFields.add(name);
    });
    field.addEventListener("change", apply);
    field.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        apply();
      }
    });
    const undo = document.createElement("button");
    undo.type = "button";
    undo.textContent = "↶";
    undo.title = "恢复 " + name;
    undo.setAttribute("aria-label", "恢复 " + name);
    controlStyle(undo);
    styleEach(undo, { padding: "4px 5px", "flex-shrink": "0", cursor: "pointer" });
    undo.addEventListener("click", () => reset(name));
    row.append(field, undo);
    parent.append(row);
  };
  for (const name of ["color", "background-color", "opacity", "font-family", "font-size", "font-weight", "width", "height", "padding", "margin", "border-radius"]) makeRow(name, properties);
  const more = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = "更多样式 · 布局 / 边框 / 阴影";
  styleEach(summary, { cursor: "pointer", color: "#a7bfff", margin: "8px 0" });
  more.append(summary);
  for (const name of Object.keys(labels)) if (!fields.has(name)) makeRow(name, more);
  properties.append(more);
  const advanced = document.createElement("details");
  const advancedTitle = document.createElement("summary");
  advancedTitle.textContent = "高级 CSS · 搜索属性";
  styleEach(advancedTitle, { cursor: "pointer", color: "#a7bfff", margin: "8px 0" });
  const search = document.createElement("input");
  search.type = "text";
  search.placeholder = "如 transform / padding-top";
  search.setAttribute("aria-label", "自定义 CSS 属性");
  controlStyle(search);
  styleEach(search, { width: "100%" });
  const choices = document.createElement("div");
  styleEach(choices, { display: "flex", "flex-wrap": "wrap", gap: "3px", margin: "5px 0" });
  const advancedRows = document.createElement("div");
  const addProperty = (raw) => {
    const n = raw.trim().toLowerCase();
    if (!validName(n)) {
      showNotice("请输入标准 CSS 属性名。");
      return;
    };
    if (typeof CSS !== "undefined" && CSS.supports && !CSS.supports(n, "initial")) {
      showNotice("浏览器不支持此 CSS 属性。");
      return;
    };
    if (fields.has(n)) {
      if (more.contains(fields.get(n))) more.open = true;
      fields.get(n)?.focus();
    } else makeRow(n, advancedRows);
    schedule();
  };
  search.addEventListener("input", () => {
    choices.replaceChildren();
    const q = search.value.trim().toLowerCase();
    if (!q) return;
    for (const n of [...initial.keys()].filter((n2) => n2.includes(q) && validName(n2)).slice(0, 10)) {
      const item = document.createElement("button");
      item.type = "button";
      item.textContent = n;
      controlStyle(item);
      item.addEventListener("click", () => addProperty(n));
      choices.append(item);
    }
  });
  const add = document.createElement("button");
  add.type = "button";
  add.textContent = "添加 CSS 属性";
  controlStyle(add);
  add.addEventListener("click", () => addProperty(search.value));
  search.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addProperty(search.value);
    }
  });
  advanced.append(advancedTitle, search, choices, add, advancedRows);
  properties.append(advanced);
  const cssComment = () => changes.size ? "CSS 修改要求（临时预览，需落实到源码）：\n" + [...changes].map(([n, v]) => "- " + n + ": " + (originalValue(n) || "(未设置)") + " → " + v).join("\n") : "";
  const finalComment = () => [textarea.value.trim(), textChanged ? "文本修改：" + JSON.stringify(originalText) + " → " + JSON.stringify(expectedText) : "", cssComment()].filter(Boolean).join("\n\n");
  title.addEventListener("click", () => {
    const expanded = title.getAttribute("aria-expanded") === "true";
    title.setAttribute("aria-expanded", String(!expanded));
    properties.hidden = expanded;
    properties.style.display = expanded ? "none" : "block";
    chevron.textContent = expanded ? "›" : "⌄";
    schedule();
  });
  const textarea = document.createElement("textarea");
  textarea.setAttribute("aria-label", "网页元素批注内容");
  textarea.placeholder = "描述希望怎样修改这个元素…";
  textarea.maxLength = 3e3;
  textarea.value = input.comment;
  styleEach(textarea, {
    "box-sizing": "border-box",
    display: "block",
    width: "100%",
    height: "76px",
    "min-height": "76px",
    "max-height": "180px",
    "flex-shrink": "0",
    resize: "vertical",
    padding: "10px 11px",
    margin: "0",
    border: "1px solid #49494e",
    "border-radius": "9px",
    background: "#262628",
    color: "#f2f2f4",
    outline: "none",
    "font-family": "system-ui,sans-serif",
    "font-size": "13px",
    "line-height": "1.5"
  });
  const notice = document.createElement("div");
  notice.className = "notice";
  notice.setAttribute("role", "status");
  notice.style.display = "none";
  notice.style.cssText = "font:11px/1.4 system-ui,sans-serif;color:#fca5a5;white-space:pre-wrap;";
  styleEach(notice, { "font-size": "11px", color: "#fca5a5", "white-space": "pre-wrap" });
  notice.style.display = "none";
  const showNotice = (message) => {
    notice.textContent = message;
    notice.style.display = message && !peeking ? "block" : "none";
    schedule();
  };
  const actions = document.createElement("div");
  actions.className = "row";
  actions.style.cssText = "display:flex;align-items:center;justify-content:flex-end;gap:8px;";
  styleEach(actions, { display: "flex", "align-items": "center", "justify-content": "flex-end", gap: "8px" });
  const remove = document.createElement("button");
  remove.className = "danger";
  remove.type = "button";
  remove.textContent = "删除";
  remove.style.cssText = "margin-right:auto;border:0;background:transparent;color:#b42318;border-radius:8px;padding:6px 8px;font:600 12px/1.4 system-ui,sans-serif;cursor:pointer;";
  styleEach(remove, { "margin-right": "auto", border: "0", background: "transparent", color: "#fca5a5", "border-radius": "8px", padding: "6px 8px", "font-size": "12px", "font-weight": "600", cursor: "pointer" });
  if (input.index === null) remove.style.display = "none";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "取消";
  cancel.style.cssText = "border:1px solid #d7e0ed;background:#fff;color:#374151;border-radius:8px;padding:6px 12px;font:600 12px/1.4 system-ui,sans-serif;cursor:pointer;";
  styleEach(cancel, { border: "1px solid transparent", background: "transparent", color: "#b8b8be", "border-radius": "8px", padding: "6px 12px", "font-size": "12px", "font-weight": "600", cursor: "pointer" });
  const save = document.createElement("button");
  save.className = "primary";
  save.type = "button";
  save.textContent = input.index === null ? "保存批注" : "更新批注";
  save.style.cssText = "border:1px solid #2f6bff;background:#2f6bff;color:white;border-radius:8px;padding:6px 13px;font:600 12px/1.4 system-ui,sans-serif;cursor:pointer;";
  styleEach(save, { border: "1px solid #2f6bff", background: "#2f6bff", color: "#fff", "border-radius": "20px", padding: "7px 15px", "font-size": "12px", "font-weight": "600", cursor: "pointer" });
  actions.append(remove, cancel, save);
  editor.append(heading, textarea, properties, notice, actions);
  shadow.append(highlight, editor);
  document.documentElement.appendChild(host);
  try {
    const ready = bridge?.invoke?.("plugin:event|emit", {
      event: "browser-controlgui-editor-opened-" + input.label,
      payload: {
        path: input.target.path,
        index: input.index,
        pageUrl: location.href,
        ...input.target.textRange ? { textRange: input.target.textRange } : {}
      }
    });
    if (ready) void ready.catch(() => {
    });
  } catch {
  };
  let closed = false;
  let frame = 0;
  let peeking = false;
  let manualPosition = null;
  let drag = null;
  const place = () => {
    if (closed) return;
    const element = findTarget();
    if (!element || !samePage(location.href, input.target.pageUrl)) {
      restorePreview();
      restoreText();
      editor.style.display = "none";
      highlight.style.display = "none";
      return;
    };
    if (element !== selected && (changes.size || textChanged)) {
      restorePreview();
      restoreText();
      stale = true;
    };
    const rect = targetRect(element);
    if (!rect) {
      highlight.style.display = "none";
      editor.style.display = "none";
      return;
    };
    const pickerVisible = page.__openbitfun_inspector_instance?.overlay?.isConnected === true;
    highlight.style.display = rect.width > 0 && rect.height > 0 && !pickerVisible ? "block" : "none";
    highlight.style.top = rect.top + "px";
    highlight.style.left = rect.left + "px";
    highlight.style.width = Math.max(0, rect.width) + "px";
    highlight.style.height = Math.max(0, rect.height) + "px";
    const style = getComputedStyle(element);
    const blue = (value) => {
      const colors2 = String(value || "").matchAll(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s\/]+([\d.]+))?\s*\)/gi);
      for (const parts of colors2) {
        const r = Number(parts[1]), g = Number(parts[2]), b = Number(parts[3]);
        const alpha = parts[4] === void 0 ? 1 : Number(parts[4]);
        if (alpha >= 0.35 && b >= 145 && b > r + 60 && b > g + 30) return true;
      };
      return false;
    };
    const nativeBlue = blue(style.boxShadow) || parseFloat(style.outlineWidth) >= 1 && style.outlineStyle !== "none" && blue(style.outlineColor) || ["Top", "Right", "Bottom", "Left"].some((side) => parseFloat(style.getPropertyValue("border-" + side.toLowerCase() + "-width")) >= 1 && style.getPropertyValue("border-" + side.toLowerCase() + "-style") !== "none" && blue(style.getPropertyValue("border-" + side.toLowerCase() + "-color")));
    highlight.style.borderColor = nativeBlue ? "transparent" : "#3979ff";
    editor.style.display = "flex";
    const avoid = element.getBoundingClientRect();
    const edge = 8, gap = 12;
    const vw = Math.max(0, innerWidth), vh = Math.max(0, innerHeight);
    const availableWidth = Math.max(0, vw - edge * 2), availableHeight = Math.max(0, vh - edge * 2);
    const width = Math.min(peeking ? 148 : 340, availableWidth);
    const clamp = (value, low, high) => Math.max(low, Math.min(Math.max(low, high), value));
    editor.style.width = width + "px";
    editor.style.maxHeight = availableHeight + "px";
    editor.style.maxWidth = availableWidth + "px";
    const naturalHeight = Math.min(availableHeight, editor.scrollHeight || editor.offsetHeight || (peeking ? 40 : properties.hidden ? 180 : 300));
    const x = clamp(avoid.left, edge, vw - width - edge), y = clamp(avoid.top, edge, vh - naturalHeight - edge);
    const slots = [
      { left: x, top: Math.max(edge, avoid.bottom + gap), w: width, h: Math.max(0, vh - edge - Math.max(edge, avoid.bottom + gap)), side: "below" },
      { left: x, top: edge, w: width, h: Math.max(0, Math.min(vh - edge, avoid.top - gap) - edge), side: "above" },
      { left: Math.max(edge, avoid.right + gap), top: y, w: Math.max(0, Math.min(width, vw - edge - Math.max(edge, avoid.right + gap))), h: availableHeight, side: "right" },
      { left: edge, top: y, w: Math.max(0, Math.min(width, avoid.left - gap - edge)), h: availableHeight, side: "left" }
    ];
    const fits = slots.find((slot2) => slot2.w >= width && slot2.h >= naturalHeight);
    const useful = slots.filter((slot2) => slot2.w >= Math.min(240, width) && slot2.h >= Math.min(150, naturalHeight)).sort((a, b) => Math.min(b.w, width) * Math.min(b.h, naturalHeight) - Math.min(a.w, width) * Math.min(a.h, naturalHeight));
    const slot = fits ?? useful[0];
    if (manualPosition) {
      editor.style.left = clamp(manualPosition.left, edge, vw - width - edge) + "px";
      editor.style.top = clamp(manualPosition.top, edge, vh - naturalHeight - edge) + "px";
    } else if (slot) {
      const w = Math.min(slot.w, width);
      editor.style.width = w + "px";
      editor.style.maxHeight = slot.h + "px";
      const h = Math.min(slot.h, editor.offsetHeight || naturalHeight);
      editor.style.left = (slot.side === "left" ? clamp(avoid.left - gap - w, edge, vw - w - edge) : clamp(slot.left, edge, vw - w - edge)) + "px";
      editor.style.top = (slot.side === "above" ? clamp(avoid.top - gap - h, edge, vh - h - edge) : clamp(slot.top, edge, vh - h - edge)) + "px";
    } else {
      editor.style.left = x + "px";
      editor.style.top = clamp(avoid.top - naturalHeight - gap, edge, vh - naturalHeight - edge) + "px";
    }
  };
  const schedule = () => {
    if (closed || frame) return;
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      place();
    });
  };
  const togglePeek = () => {
    peeking = !peeking;
    peek.textContent = peeking ? "继续编辑" : "查看效果";
    peek.setAttribute("aria-label", peek.textContent);
    peek.setAttribute("aria-pressed", String(peeking));
    textarea.style.display = peeking ? "none" : "block";
    properties.style.display = peeking || properties.hidden ? "none" : "block";
    actions.style.display = peeking ? "none" : "flex";
    notice.style.display = peeking ? "none" : notice.textContent ? "block" : "none";
    title.style.display = peeking ? "none" : "flex";
    editor.style.padding = peeking ? "6px 8px" : "14px";
    manualPosition = null;
    place();
  };
  peek.addEventListener("click", togglePeek);
  grip.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const rect = editor.getBoundingClientRect();
    drag = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, id: event.pointerId };
    grip.setPointerCapture?.(event.pointerId);
    grip.style.cursor = "grabbing";
  });
  grip.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    manualPosition = { left: drag.left + event.clientX - drag.x, top: drag.top + event.clientY - drag.y };
    place();
  });
  const endDrag = () => {
    drag = null;
    grip.style.cursor = "grab";
  };
  grip.addEventListener("pointerup", endDrag);
  grip.addEventListener("pointercancel", endDrag);
  grip.addEventListener("lostpointercapture", endDrag);
  grip.addEventListener("dblclick", () => {
    manualPosition = null;
    place();
  });
  const report = (action) => {
    if (closed) return;
    const invoke = bridge?.invoke;
    if (typeof invoke !== "function") {
      showNotice("无法连接 BitFun 批注服务。");
      return;
    };
    void invoke("plugin:event|emit", {
      event: "browser-controlgui-editor-" + input.label,
      payload: {
        action,
        pageUrl: location.href,
        path: input.target.path,
        index: input.index,
        comment: action === "save" ? finalComment() : textarea.value,
        ...input.target.textRange ? { textRange: input.target.textRange } : {}
      }
    }).catch(() => {
      showNotice("未能发送批注指令，请重试。");
    });
  };
  const onKey = (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      report("cancel");
    }
  };
  const onView = () => {
    schedule();
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("scroll", onView, true);
  window.addEventListener("resize", onView);
  shadow.addEventListener("pointerdown", (event) => event.stopPropagation());
  shadow.addEventListener("click", (event) => event.stopPropagation());
  shadow.addEventListener("keydown", (event) => event.stopPropagation());
  shadow.addEventListener("keydown", onKey);
  close.addEventListener("click", () => report("cancel"));
  cancel.addEventListener("click", () => report("cancel"));
  remove.addEventListener("click", () => report("delete"));
  save.addEventListener("click", () => {
    if (invalidFields.size) {
      showNotice("请修正或恢复无效 CSS 属性：" + [...invalidFields].join(", "));
      return;
    };
    if (stale || textNode && textNode.data !== previewTextExpected || styled && styled.getAttribute("style") !== expectedAttr) {
      showNotice("页面样式已更新，请重新选择。");
      return;
    };
    if (finalComment().length > 3e3) {
      showNotice("批注与 CSS 差异超过 3000 字符，请减少修改项。");
      return;
    };
    if (finalComment().length < 2) {
      showNotice("批注至少需要两个字符。");
      return;
    };
    const currentTarget = findTarget();
    if (!currentTarget || currentTarget !== selected || !targetRect(currentTarget)) {
      showNotice("页面已更新，无法找到原来的元素，请重新选择。");
      return;
    };
    if (textChanged && textNode && input.target.textRange) {
      restoreText();
      previewTextExpected = originalText;
      textPreviewSuspended = true;
    };
    report("save");
  });
  const current = {
    owner: input.label,
    status(message) {
      if (textPreviewSuspended && textNode && textNode.data === originalText && findTarget() === selected) {
        textNode.data = expectedText;
        previewTextExpected = expectedText;
        textPreviewSuspended = false;
      };
      showNotice(message);
    },
    draftText() {
      return textarea.value;
    },
    close() {
      if (closed) return;
      closed = true;
      restorePreview();
      restoreText();
      observer.disconnect();
      window.removeEventListener("scroll", onView, true);
      window.removeEventListener("resize", onView);
      if (frame) window.cancelAnimationFrame(frame);
      host.remove();
      if (page.__openbitfunControlGuiFloatingEditor === current) delete page.__openbitfunControlGuiFloatingEditor;
    }
  };
  page.__openbitfunControlGuiFloatingEditor = current;
  place();
  textarea.focus({ preventScroll: true });
})(null, 'status', arg);
},
"markers": (arg) => {
(function runControlGuiMarkers(input) {
  const page = window;
  const attribute = "data-openbitfun-controlgui-pins";
  const runtimeKey = page.__openbitfunControlGuiPins;
  const samePage = (a, b) => {
    try {
      const left = new URL(a);
      const right = new URL(b);
      if (!["http:", "https:"].includes(left.protocol) || !["http:", "https:"].includes(right.protocol)) return false;
      left.hash = "";
      right.hash = "";
      return left.href === right.href;
    } catch {
      return false;
    }
  };
  if (!input.notes.length || !samePage(window.location.href, input.expectedUrl)) {
    runtimeKey?.dispose();
    return;
  };
  if (runtimeKey && runtimeKey.owner === input.label) {
    runtimeKey.update(input.notes);
    return;
  };
  runtimeKey?.dispose();
  const host = document.createElement("div");
  host.setAttribute(attribute, "");
  host.style.cssText = "position:fixed;inset:0;z-index:2147483645;pointer-events:none;";
  const shadow = host.attachShadow({ mode: "closed" });
  const css = [
    ":host{all:initial}",
    "*{box-sizing:border-box}",
    ".pins{position:fixed;inset:0;pointer-events:none}",
    ".pin{position:fixed;display:none;width:25px;height:25px;place-items:center;",
    "padding:0;border:2px solid #fff;border-radius:9px 9px 9px 2px;",
    "background:#2f6bff;color:white;box-shadow:0 3px 14px rgba(6,46,96,.5);",
    "font:700 12px/1 system-ui,sans-serif;cursor:pointer;pointer-events:auto;",
    "user-select:none;-webkit-user-select:none}",
    ".pin:hover{background:#1651e8;transform:scale(1.07)}",
    ".pin:focus-visible{outline:3px solid #a3c4ff;outline-offset:2px}"
  ].join("");
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    shadow.adoptedStyleSheets = [...shadow.adoptedStyleSheets, sheet];
  } catch {
  };
  const pins = document.createElement("div");
  pins.className = "pins";
  pins.style.setProperty("position", "fixed");
  pins.style.setProperty("inset", "0");
  pins.style.setProperty("pointer-events", "none");
  shadow.append(pins);
  document.documentElement.appendChild(host);
  let notes = [];
  let frame = 0;
  let disposed = false;
  const paint = () => {
    if (disposed) return;
    const onPage = samePage(window.location.href, input.expectedUrl);
    Array.from(pins.children).forEach((child, offset) => {
      const pin = child;
      const note = notes[offset];
      if (!onPage || !note || !samePage(note.sourceUrl, window.location.href)) {
        pin.style.display = "none";
        return;
      };
      let element = null;
      try {
        element = document.querySelector(note.path);
      } catch {
      };
      if (!element) {
        pin.style.display = "none";
        return;
      };
      let rect = element.getBoundingClientRect();
      if (note.textRange) {
        const node = element.childNodes[note.textRange.nodeIndex];
        if (!node || node.nodeType !== Node.TEXT_NODE || node.textContent?.trim() !== note.textRange.text) {
          pin.style.display = "none";
          return;
        };
        const content = node.textContent;
        const start = content.length - content.trimStart().length;
        const end = content.trimEnd().length;
        if (start >= end) {
          pin.style.display = "none";
          return;
        };
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, end);
        rect = range.getBoundingClientRect();
      };
      if (rect.width < 1 || rect.height < 1 || rect.bottom <= 0 || rect.top >= innerHeight || rect.right <= 0 || rect.left >= innerWidth) {
        pin.style.display = "none";
        return;
      };
      pin.style.display = "grid";
      pin.style.left = Math.max(3, Math.min(innerWidth - 27, rect.right - 12)) + "px";
      pin.style.top = Math.max(3, Math.min(innerHeight - 27, rect.top - 12)) + "px";
    });
  };
  const schedule = () => {
    if (disposed || frame) return;
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      paint();
    });
  };
  const onViewChange = () => {
    schedule();
  };
  for (const type of ["click", "pointerdown", "pointerup"]) {
    shadow.addEventListener(type, (event) => {
      event.stopPropagation();
    });
  };
  const update = (next) => {
    notes = next.slice();
    pins.replaceChildren();
    for (const note of notes) {
      const pin = document.createElement("button");
      pin.className = "pin";
      pin.type = "button";
      const pinStyles = {
        position: "fixed",
        display: "none",
        width: "25px",
        height: "25px",
        "place-items": "center",
        padding: "0",
        border: "2px solid white",
        "border-radius": "9px 9px 9px 2px",
        background: "#2f6bff",
        color: "#fff",
        "box-shadow": "0 3px 14px rgba(6,46,96,.5)",
        "font-size": "12px",
        "font-weight": "700",
        "line-height": "1",
        "font-family": "system-ui,sans-serif",
        cursor: "pointer",
        "pointer-events": "auto",
        "user-select": "none",
        "z-index": "1"
      };
      for (const [property, value] of Object.entries(pinStyles)) {
        pin.style.setProperty(property, value);
      };
      pin.textContent = String(note.index + 1);
      pin.title = "编辑第 " + (note.index + 1) + " 条批注：" + note.comment.slice(0, 150);
      pin.setAttribute("aria-label", pin.title);
      pin.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        const invoke = bridge?.invoke;
        if (typeof invoke !== "function") return;
        void invoke("plugin:event|emit", {
          event: "browser-controlgui-marker-click-" + input.label,
          payload: { index: note.index, pageUrl: window.location.href }
        }).catch(() => {
        });
      });
      pins.appendChild(pin);
    };
    schedule();
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("scroll", onViewChange, true);
  window.addEventListener("resize", onViewChange);
  const routeTimer = window.setInterval(schedule, 650);
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    window.clearInterval(routeTimer);
    window.removeEventListener("scroll", onViewChange, true);
    window.removeEventListener("resize", onViewChange);
    observer.disconnect();
    if (frame) window.cancelAnimationFrame(frame);
    host.remove();
    if (page.__openbitfunControlGuiPins === current) {
      delete page.__openbitfunControlGuiPins;
    }
  };
  const current = { owner: input.label, update, dispose };
  page.__openbitfunControlGuiPins = current;
  update(input.notes);
})(arg);
},
"cleanup": (arg) => {
if (window.__openbitfun_inspector_cancel && window.__openbitfun_inspector_annotation_mode) window.__openbitfun_inspector_cancel(false);
window.__openbitfunControlGuiFloatingEditor?.close?.();
window.__openbitfunControlGuiPins?.dispose?.();
},
"pause": (arg) => {
if (window.__openbitfun_inspector_cancel) { window.__openbitfun_inspector_cancel(false); }
},
"cancel": (arg) => {
if (window.__openbitfun_inspector_cancel) { window.__openbitfun_inspector_cancel(); }
}
}));
}
