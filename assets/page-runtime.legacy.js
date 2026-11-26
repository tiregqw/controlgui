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
