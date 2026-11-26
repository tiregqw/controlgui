/**
 * Right sidebar layouts are persisted per DSH Session. Drop only Codex GUI
 * occurrences that were already there at this browser boot, so no preview
 * pane appears without a new explicit user action.
 *
 * This does NOT clear the remembered project/URL or affect another tab kind.
 * New previews opened after startup have new tab IDs and are never discarded.
 */
export interface SnapshotSource<Value> {
  getSnapshot(): Value
  subscribe(listener: () => void): () => void
}

export interface SavedTab<S extends string, T extends string> {
  readonly sessionId: S
  readonly tabId: T
  readonly kind: string
}
export interface LiveTab<T extends string> {
  readonly id: T
  readonly kind: string
}
export interface SidebarCleanupAccess<S extends string, T extends string> {
  readonly openTabs: SnapshotSource<readonly SavedTab<S, T>[]>
  readonly mounted: SnapshotSource<S | undefined>
  tabsIn(sessionId: S): readonly LiveTab<T>[]
  closeIn(sessionId: S, tabId: T): void
}

export function discardRestoredCodexGuiTabs<S extends string, T extends string>(
  sidebar: SidebarCleanupAccess<S, T>,
  kind = 'codex-gui',
): () => void {
  // Capture exactly the tabs persisted before this plugin's boot. Never close
  // anything opened later by /codexgui, the guide, or a tool/result.
  const pending = new Map<S, Set<T>>()
  const remember = (sessionId: S, tabId: T): void => {
    const tabs = pending.get(sessionId) ?? new Set<T>()
    tabs.add(tabId)
    pending.set(sessionId, tabs)
  }
  for (const tab of sidebar.openTabs.getSnapshot()) {
    if (tab.kind === kind) remember(tab.sessionId, tab.tabId)
  }
  // The inventory may be published after plugin activation. Read the exact
  // saved Session layouts as an additional source of pre-boot tab identities.
  // Read-only: the normal Sidebar store owns all persistence mutations.
  try {
    if (typeof localStorage !== 'undefined') {
      const prefix = 'dsh.sidebar-right.v1.'
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (!key?.startsWith(prefix)) continue
        const sessionId = key.slice(prefix.length) as S
        const value = JSON.parse(localStorage.getItem(key) ?? '{}') as {
          bySession?: Record<string, { layout?: { tabs?: Record<string, { kind?: string }> } }>
        }
        for (const [tabId, record] of Object.entries(value.bySession?.[sessionId]?.layout?.tabs ?? {})) {
          if (record.kind === kind) remember(sessionId, tabId as T)
        }
      }
    }
  } catch { /* private mode or malformed historical layout: inventory still works */ }
  if (pending.size === 0) return () => {}

  let syncing = false
  let dirty = false
  const sweep = (): void => {
    if (syncing) { dirty = true; return }
    syncing = true
    try {
      do {
        dirty = false
        for (const [sessionId, ids] of pending) {
          // The DSH store is adopted per Session. Background saved tabs remain
          // in pending until the Session is actually restored/mounted.
          const live = sidebar.tabsIn(sessionId)
          for (const tab of live) {
            if (!ids.has(tab.id) || tab.kind !== kind) continue
            ids.delete(tab.id) // before closeIn, which can synchronously publish
            sidebar.closeIn(sessionId, tab.id)
          }
          if (ids.size === 0) pending.delete(sessionId)
        }
      } while (dirty)
    } finally { syncing = false }
  }
  // The Sidebar publishes its selected Session before React has finished
  // adopting the persisted store. A snapshot can therefore show its saved tab
  // in the inventory while tabsIn() is still empty. Retry around the initial
  // render commit rather than relying on a second inventory notification,
  // which is omitted if the already-published tab list is unchanged.
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const checkAfterAdoption = (): void => {
    const sessionId = sidebar.mounted.getSnapshot()
    if (sessionId === undefined || !pending.has(sessionId)) return
    for (const delay of [0, 40, 150, 600, 2000]) {
      const timer = setTimeout(() => {
        timers.delete(timer)
        sweep()
      }, delay)
      timers.add(timer)
    }
  }
  const stopInventory = sidebar.openTabs.subscribe(sweep)
  const stopMounted = sidebar.mounted.subscribe(() => {
    sweep()
    checkAfterAdoption()
  })
  sweep()
  checkAfterAdoption()
  return () => {
    stopInventory()
    stopMounted()
    for (const timer of timers) clearTimeout(timer)
    timers.clear()
    pending.clear()
  }
}
