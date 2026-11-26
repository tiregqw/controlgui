/**
 * Refresh vs actual DSH host restart:
 * - sessionStorage survives a browser refresh in the same tab;
 * - the sidecar status exposes a stable *host process* epoch (not sidecar ID).
 * Reuse the native DSH right-sidebar persistence on ordinary refreshes.
 * Only discard saved Codex GUI tabs when that DSH host epoch changes.
 */
import { CODEX_PREVIEW_STATUS } from './endpoints.ts'
import { discardRestoredCodexGuiTabs, type SidebarCleanupAccess } from './startup-tabs.ts'

const KEY = 'dsh:codex:observed-host-epoch:v1'
export const CODEX_HOST_EPOCH_SESSION_KEY = KEY

export type RestoreDecision = 'retain' | 'discard'
export function decideCodexRestore(savedEpoch: string | null, hostEpoch: string): RestoreDecision {
  return savedEpoch === hostEpoch ? 'retain' : 'discard'
}

interface EpochStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface RestorePolicyOptions {
  readonly getHostEpoch?: (signal: AbortSignal) => Promise<string>
  readonly storage?: EpochStorage
}

export async function readCodexDshHostEpoch(signal: AbortSignal): Promise<string> {
  const response = await fetch(CODEX_PREVIEW_STATUS, {
    mode: 'cors', cache: 'no-store', signal,
  })
  if (!response.ok) throw new Error('DSH preview status HTTP ' + response.status)
  const data: unknown = await response.json()
  if (!data || typeof data !== 'object' || !('hostEpoch' in data) ||
      typeof data.hostEpoch !== 'string' || !data.hostEpoch.trim()) {
    throw new Error('DSH preview status has no host epoch')
  }
  return data.hostEpoch
}

export function restoreCodexTabsOnlyOnDshRestart<S extends string, T extends string>(
  sidebar: SidebarCleanupAccess<S, T>,
  options: RestorePolicyOptions = {},
): () => void {
  const controller = new AbortController()
  let disposed = false
  let stopDiscard = (): void => {}
  // Do not touch persisted tabs or overwrite the last known epoch when the
  // service is offline; a transient network failure must not close previews.
  void (async () => {
    const hostEpoch = await (options.getHostEpoch ?? readCodexDshHostEpoch)(controller.signal)
    if (disposed) return
    let storage: EpochStorage
    try { storage = options.storage ?? sessionStorage } catch { return }
    let previous: string | null
    try { previous = storage.getItem(KEY) } catch { return }
    if (decideCodexRestore(previous, hostEpoch) === 'discard') {
      stopDiscard = discardRestoredCodexGuiTabs(sidebar)
    }
    try { storage.setItem(KEY, hostEpoch) } catch { /* keep current tab state */ }
  })().catch(() => { /* keep current layout if status is unavailable */ })
  return () => {
    disposed = true
    controller.abort()
    stopDiscard()
  }
}
