import { readCodexDraft, readCodexSubmit, type CodexNote } from './protocol.ts'

/** Untrusted preview packets are validated before the Host sends to its owning DSH Session. */
export interface CodexAnnotationSink {
  /** Send a validated batch directly to the owning DSH Session. */
  send(notes: readonly CodexNote[], url: string): Promise<void>
  /** Save or remove a draft for the authenticated Session/preview target. */
  draft(notes: readonly CodexNote[]): void
  /** Restore the draft after each new preview document handshake. */
  restore(): readonly CodexNote[]
}

/** Origin-checked, nonce-tagged transport; authorization is exclusively host-side. */
export class CodexAnnotationPort {
  readonly supported: boolean
  private readonly nonce = globalThis.crypto.randomUUID()
  private readonly origin: string
  private readonly workspace: string | null
  private ready = false
  private reviewPending = false
  private attempts = 0
  private timer: ReturnType<typeof setInterval> | undefined

  constructor(
    private readonly iframe: HTMLIFrameElement,
    url: string,
    private readonly sink: CodexAnnotationSink,
  ) {
    const address = new URL(url)
    this.origin = address.origin
    this.workspace = address.searchParams.get('workspace')
    this.supported = address.protocol === 'http:'
      && ['127.0.0.1', 'localhost'].includes(address.hostname)
      && address.searchParams.get('__dsh_gui') === '1'
      && this.workspace !== null
  }

  start(): void {
    if (!this.supported) return
    window.addEventListener('message', this.receive)
    this.handshake()
  }

  handshake(): void {
    if (!this.supported) return
    this.stopTimer()
    this.ready = false
    this.reviewPending = false
    this.attempts = 0
    this.post({ type: 'controlgui.hello', nonce: this.nonce })
    this.timer = setInterval(() => {
      if (this.ready || this.attempts >= 40) { this.stopTimer(); return }
      this.attempts += 1
      this.post({ type: 'controlgui.hello', nonce: this.nonce })
    }, 250)
  }

  dispose(): void {
    this.stopTimer()
    window.removeEventListener('message', this.receive)
    this.reviewPending = false
  }

  private post(packet: Record<string, unknown>): void {
    this.iframe.contentWindow?.postMessage(packet, this.origin)
  }

  private acceptsUrl(value: string): boolean {
    try {
      const url = new URL(value)
      if (url.origin !== this.origin) return false
      const claimedWorkspace = url.searchParams.get('workspace')
      return claimedWorkspace === null || claimedWorkspace === this.workspace
    } catch { return false }
  }

  private readonly receive = (event: MessageEvent): void => {
    if (event.source !== this.iframe.contentWindow || event.origin !== this.origin) return
    const data: unknown = event.data
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return
    const packet = data as Record<string, unknown>
    if (packet.nonce !== this.nonce) return

    if (packet.type === 'codex.ready') {
      this.ready = true
      this.stopTimer()
      this.post({ type: 'codex.restore', nonce: this.nonce, notes: this.sink.restore() })
      return
    }
    if (!this.ready) return
    if (packet.type === 'codex.draft') {
      const draft = readCodexDraft(packet)
      if (draft !== undefined && this.acceptsUrl(draft.url)) this.sink.draft(draft.notes)
      return
    }
    if (packet.type !== 'codex.submit' || this.reviewPending) return
    const proposal = readCodexSubmit(packet)
    if (proposal === undefined || !this.acceptsUrl(proposal.url)) return
    this.reviewPending = true
    void this.sink.send(proposal.notes, proposal.url).then(
      () => {
        this.reviewPending = false
        this.post({ type: 'codex.sent', nonce: this.nonce, ok: true, notes: proposal.notes })
      },
      (error: unknown) => {
        this.reviewPending = false
        const reason = error instanceof Error ? error.message : 'DSH 发送失败'
        this.post({ type: 'codex.sent', nonce: this.nonce, ok: false, notes: proposal.notes, reason: reason.slice(0, 300) })
      },
    )
  }

  private stopTimer(): void {
    if (this.timer !== undefined) { clearInterval(this.timer); this.timer = undefined }
  }
}
