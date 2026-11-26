import { spawn, type ChildProcess } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import { dirname, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-agent'
import { judgePreviewWithModel, type PreviewIntentDecision } from './intent-host.ts'
import { installPreviewTool } from './preview-tool.ts'

/** Host plugin: starts and supervises the local preview service. */
export const name = 'codex-visual-preview'

// Stable for the whole DSH Node process, including hot plugin reloads and
// sidecar restarts. Changes only when the actual DSH host process restarts.
const DSH_HOST_EPOCH = `${process.pid}:${Math.round(performance.timeOrigin)}`

const MAX_CONSECUTIVE_FAILURES = 10
const HEALTHY_UPTIME_MS = 60_000
const MAX_RESTART_DELAY_MS = 30_000

export default class CodexVisualPreview {
  private child: ChildProcess | undefined

  constructor(ctx: Context) {
    installPreviewTool(ctx)
    const dir = dirname(fileURLToPath(import.meta.url))
    let judge: (sessionId: string, prompt: string) => Promise<PreviewIntentDecision> = async () => 'unavailable'
    // Host-owned LLM is selected from the live Agent; the browser receives
    // only OPEN / IGNORE decisions, never model credentials or prompts.
    ctx.inject(['llm', 'agents'], scope => {
      scope.effect(() => {
        judge = async (sessionId, prompt) => {
          const agent = scope.agents.get(sessionId as Parameters<typeof scope.agents.get>[0])
          const selection = agent?.model.current()
          if (!selection) return 'unavailable'
          return judgePreviewWithModel(scope.llm, selection, prompt)
        }
        return () => { judge = async () => 'unavailable' }
      }, 'codex-visual-preview.llm-intent')
    })
    ctx.effect(() => {
      let disposed = false
      let restartTimer: ReturnType<typeof setTimeout> | undefined
      let consecutiveFailures = 0
      let startedAt = 0

      // The DSH CLI resolves TS through tsx; reuse that runtime for the sidecar.
      // The fallback supports a plugin directory outside the DSH workspace.
      let tsxLoader: string
      try { tsxLoader = import.meta.resolve('tsx/esm') }
      catch {
        const hostRequire = createRequire(pathToFileURL(resolve(process.cwd(), 'package.json')))
        tsxLoader = pathToFileURL(hostRequire.resolve('tsx/esm')).href
      }

      const restartAfterExit = (code: number | null, signal: NodeJS.Signals | null): void => {
        if (disposed) return
        const uptimeMs = Date.now() - startedAt
        if (uptimeMs >= HEALTHY_UPTIME_MS) consecutiveFailures = 0
        consecutiveFailures += 1
        if (consecutiveFailures > MAX_CONSECUTIVE_FAILURES) {
          console.error(`[codex-visual-preview] sidecar stopped after ${MAX_CONSECUTIVE_FAILURES} consecutive failures; reload the Cordis plugin after fixing its configuration`)
          return
        }
        const delayMs = Math.min(500 * 2 ** (consecutiveFailures - 1), MAX_RESTART_DELAY_MS)
        console.warn(`[codex-visual-preview] sidecar exited (code=${String(code)}, signal=${String(signal)}, uptime=${uptimeMs}ms); restarting in ${delayMs}ms (attempt ${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES})`)
        restartTimer = setTimeout(() => {
          restartTimer = undefined
          launch()
        }, delayMs)
        restartTimer.unref?.()
      }

      const launch = (): void => {
        if (disposed) return
        startedAt = Date.now()
        let child: ChildProcess
        try {
          child = spawn(process.execPath, ['--import', tsxLoader, resolve(dir, 'server.ts')], {
            cwd: process.cwd(),
            env: { ...process.env, CODEX_DSH_HOST_EPOCH: DSH_HOST_EPOCH },
            stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
            windowsHide: true,
          })
        } catch (error) {
          console.error('[codex-visual-preview] sidecar spawn failed:', error)
          restartAfterExit(null, null)
          return
        }
        this.child = child
        let activeJudgements = 0
        const lastJudgement = new Map<string, number>()
        child.on('message', packet => {
          if (disposed || this.child !== child || !packet || typeof packet !== 'object') return
          if (!('type' in packet) || packet.type !== 'codex:intent:request') return
          const request = packet as { id?: unknown; sessionId?: unknown; prompt?: unknown }
          if (typeof request.id !== 'string' || !/^[0-9a-f-]{36}$/u.test(request.id)
            || typeof request.sessionId !== 'string' || request.sessionId.length < 1 || request.sessionId.length > 150
            || typeof request.prompt !== 'string' || request.prompt.length > 4200) return
          const now = Date.now()
          const last = lastJudgement.get(request.sessionId) ?? 0
          const canJudge = activeJudgements < 3 && now - last >= 1500
          if (canJudge) {lastJudgement.set(request.sessionId, now); activeJudgements++}
          void (canJudge ? judge(request.sessionId, request.prompt) : Promise.resolve('unavailable' as const)).then(decision => {
            if (disposed || this.child !== child || !child.connected) return
            child.send({type:'codex:intent:response',id:request.id,decision}, error => {
              if (error && (error as NodeJS.ErrnoException).code !== 'ERR_IPC_CHANNEL_CLOSED') {
                console.warn('[codex-visual-preview] intent response could not be sent:', error.message)
              }
            })
          }).catch(() => {
            if (disposed || this.child !== child || !child.connected) return
            child.send({type:'codex:intent:response',id:request.id,decision:'unavailable'}, () => {})
          }).finally(() => {if (canJudge) activeJudgements--})
        })
        child.stdout?.on('data', (data: Buffer) => {
          console.info('[codex-visual-preview]', data.toString().trim().slice(0, 1000))
        })
        child.stderr?.on('data', (data: Buffer) => {
          console.error('[codex-visual-preview]', data.toString().trim().slice(0, 2000))
        })
        child.on('error', error => {
          console.error('[codex-visual-preview] sidecar process error:', error.message)
        })
        // 'close' is emitted after the process and its stdio streams finish.
        // It also follows spawn 'error', avoiding duplicate restart timers.
        child.once('close', (code, signal) => {
          if (this.child !== child) return
          this.child = undefined
          restartAfterExit(code, signal)
        })
      }

      launch()
      return () => {
        disposed = true
        if (restartTimer !== undefined) clearTimeout(restartTimer)
        restartTimer = undefined
        const child = this.child
        this.child = undefined
        if (child && !child.killed) child.kill()
      }
    }, 'codex-visual-preview.sidecar')
  }
}
