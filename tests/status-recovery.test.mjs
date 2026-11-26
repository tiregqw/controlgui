import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const delay = ms => new Promise(ok => setTimeout(ok, ms))
async function listen(server, port = 0) {
  await new Promise((ok, fail) => {
    server.once('error', fail)
    server.listen(port, '127.0.0.1', () => { server.off('error', fail); ok() })
  })
  return server.address().port
}
async function freePort() {
  const server = http.createServer()
  const port = await listen(server)
  await new Promise(ok => server.close(ok))
  return port
}
test('protected status endpoint reports upstream loss and restoration', {timeout: 18000}, async () => {
  const resolverPort = await freePort()
  let devPort
  let upstream
  const sockets = new Set()
  const startDev = async () => {
    upstream = http.createServer((_req, res) => { res.writeHead(200); res.end('ok') })
    upstream.on('connection', socket => {
      sockets.add(socket)
      socket.once('close', () => sockets.delete(socket))
    })
    devPort = await listen(upstream, devPort)
  }
  const stopDev = async () => {
    if (!upstream?.listening) return
    for (const socket of sockets) socket.destroy()
    await new Promise(ok => upstream.close(ok))
  }
  await startDev()
  const child = spawn(process.execPath, [resolve(import.meta.dirname, '../src/server.ts')], {
    env: { ...process.env, CODEX_PREVIEW_PORT: String(resolverPort), CONTROLGUI_WEB_PORT: '3080' },
    stdio: 'ignore',
  })
  try {
    const dev = 'http://127.0.0.1:' + devPort + '/'
    const url = 'http://127.0.0.1:' + resolverPort + '/api/status?codex=1&dev=' + encodeURIComponent(dev)
    const fetchStatus = async () => {
      const res = await fetch(url, {headers:{origin:'http://127.0.0.1:3080'},signal:AbortSignal.timeout(3000)})
      return {status:res.status,body:await res.json()}
    }
    let ready = false
    for (let i=0;i<80;i++) {
      if (child.exitCode !== null) throw new Error('sidecar exited before listening')
      try { if ((await fetchStatus()).status === 200) { ready = true; break } } catch {}
      await delay(100)
    }
    assert.equal(ready, true, 'sidecar did not start')
    let result = await fetchStatus()
    assert.equal(result.status, 200)
    assert.equal(result.body.upstreamHealthy, true)
    assert.equal(typeof result.body.instanceId, 'string')

    await stopDev()
    result = await fetchStatus()
    assert.equal(result.body.upstreamHealthy, false)
    await startDev()
    result = await fetchStatus()
    assert.equal(result.body.upstreamHealthy, true)

    const rejected = await fetch(url, {headers:{origin:'https://example.com'}})
    assert.equal(rejected.status,403)
    const invalidUrl = 'http://127.0.0.1:' + resolverPort + '/api/status?codex=1&dev=' + encodeURIComponent('http://example.com:5173/')
    const invalid = await fetch(invalidUrl,{headers:{origin:'http://127.0.0.1:3080'}})
    assert.equal(invalid.status,400)
  } finally {
    child.kill()
    await stopDev()
  }
})
