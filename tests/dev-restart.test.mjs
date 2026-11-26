import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import { resolve } from 'node:path'
import { createProjectPreviewManager, probeDevServer } from '../src/project-preview.ts'

const root = resolve(import.meta.dirname, '..')
const project = resolve(root, 'tests/fixtures/test-projects/05-react-codex')
const bridge = resolve(root, 'assets/page-runtime.js')

async function upgradeStatus(url) {
  const target = new URL(url)
  return await new Promise((ok, fail) => {
    const socket = net.connect(Number(target.port), target.hostname)
    const timeout = setTimeout(() => { socket.destroy(); fail(new Error('upgrade timed out')) }, 2500)
    let received = ''
    socket.once('connect', () => socket.write(
      'GET /hmr HTTP/1.1\r\nHost: ' + target.host +
      '\r\nConnection: Upgrade\r\nUpgrade: websocket' +
      '\r\nSec-WebSocket-Key: ZGVtbzEyMzQ1Njc4OTA=' +
      '\r\nSec-WebSocket-Version: 13\r\n\r\n'
    ))
    socket.on('data', chunk => {
      received += String(chunk)
      if (!received.includes('\r\n\r\n')) return
      clearTimeout(timeout)
      socket.destroy()
      ok(received.split('\r\n')[0])
    })
    socket.once('error', error => { clearTimeout(timeout); fail(error) })
    socket.once('close', () => { clearTimeout(timeout) })
  })
}

test('preview reports Vite loss and recovers HTTP + HMR on the same proxy URL', {timeout: 15000}, async () => {
  const manager = createProjectPreviewManager(bridge)
  let server
  let port
  const sockets = new Set()
  const start = async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(200, {'content-type':'text/html'})
      res.end('<html><head></head><body>dev restored</body></html>')
    })
    server.on('connection', socket => {
      sockets.add(socket)
      socket.once('close', () => sockets.delete(socket))
    })
    server.on('upgrade', (_req, socket) => {
      socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n')
    })
    await new Promise((ok, fail) => {
      server.once('error', fail)
      server.listen(port ?? 0, '127.0.0.1', () => {
        server.off('error', fail)
        port ??= server.address().port
        ok()
      })
    })
  }
  const stop = async () => {
    if (!server?.listening) return
    for (const socket of sockets) socket.destroy()
    await new Promise(ok => server.close(ok))
  }
  try {
    await start()
    const devUrl = 'http://127.0.0.1:' + port + '/'
    const preview = await manager.open(project, devUrl)
    assert.equal(await probeDevServer(devUrl), true)
    assert.equal((await fetch(preview.url)).status, 200)
    assert.match(await upgradeStatus(preview.url), /^HTTP\/1\.1 101/u)

    await stop()
    assert.equal(await probeDevServer(devUrl), false)
    const failure = await fetch(preview.url)
    assert.equal(failure.status, 502)
    assert.match(await upgradeStatus(preview.url), /^HTTP\/1\.1 502/u)
    assert.equal((await manager.open(project, devUrl)).url, preview.url)

    await start()
    assert.equal(await probeDevServer(devUrl), true)
    const restored = await fetch(preview.url)
    assert.equal(restored.status, 200)
    assert.match(await restored.text(), /__dsh_gui__\/bridge\.js/u)
    assert.match(await upgradeStatus(preview.url), /^HTTP\/1\.1 101/u)
    assert.equal((await manager.open(project, devUrl)).url, preview.url)
  } finally {
    await manager.close()
    await stop()
  }
})

test('health checks reject non-loopback URLs before attempting a connection', async () => {
  await assert.rejects(probeDevServer('http://example.com:5173/'), /Only local HTTP/u)
  await assert.rejects(probeDevServer('http://127.0.0.1:5173/private'), /Only local HTTP/u)
})
