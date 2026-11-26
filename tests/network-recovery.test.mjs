import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import { resolve } from 'node:path'
import { createProjectPreviewManager } from '../src/project-preview.ts'

const root = resolve(import.meta.dirname, '..')
const project = resolve(root, 'tests/fixtures/test-projects/05-react-codex')
const bridge = resolve(root, 'assets/page-runtime.js')
const wait = ms => new Promise(ok => setTimeout(ok, ms))
const listen = server => new Promise((ok, fail) => {
  server.once('error', fail)
  server.listen(0, '127.0.0.1', () => { server.off('error', fail); ok(server.address().port) })
})

async function openWebSocket(url, pathname) {
  const target = new URL(url)
  const socket = net.connect(Number(target.port), '127.0.0.1')
  socket.on('error', () => {}) // Peers deliberately reset connections in this test.
  const response = new Promise((ok, fail) => {
    const timer = setTimeout(() => fail(new Error('WebSocket upgrade did not answer')), 2000)
    socket.once('connect', () => {
      socket.write(`GET ${pathname} HTTP/1.1\r\nHost: 127.0.0.1:${target.port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: ZGVtbzEyMzQ1Njc4OTA=\r\nSec-WebSocket-Version: 13\r\n\r\n`)
    })
    socket.on('data', data => {
      if (!String(data).includes('101 Switching Protocols')) return
      clearTimeout(timer)
      ok(socket)
    })
    socket.once('close', () => { clearTimeout(timer) })
  })
  return response
}

test('unexpected HTTP stream and WebSocket resets do not kill or replace the preview manager', {timeout: 15000}, async () => {
  const activeSockets = new Set()
  const dev = http.createServer((req, res) => {
    if (req.url === '/broken-html') {
      res.writeHead(200, {'content-type':'text/html'})
      res.write('<html>partial')
      setTimeout(() => res.destroy(), 10)
      return
    }
    if (req.url === '/broken-js') {
      res.writeHead(200, {'content-type':'application/javascript'})
      res.write('window.partial=true;')
      setTimeout(() => res.destroy(), 10)
      return
    }
    res.writeHead(200, {'content-type':'text/html'})
    res.end('<html><head></head><body>still here</body></html>')
  })
  dev.on('connection', socket => {
    activeSockets.add(socket)
    socket.on('error', () => {})
    socket.once('close', () => activeSockets.delete(socket))
  })
  dev.on('upgrade', (req, socket) => {
    if (req.url === '/reject') {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
      return
    }
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n')
    if (req.url === '/reset') setTimeout(() => socket.resetAndDestroy(), 30)
    if (req.url === '/echo') socket.on('data', data => socket.write('echo:' + data))
  })
  const port = await listen(dev)
  const manager = createProjectPreviewManager(bridge)
  const devUrl = `http://127.0.0.1:${port}/`
  let aliveSocket
  try {
    const opened = await manager.open(project, devUrl)
    assert.equal(opened.mode, 'dev')
    const good = async () => {
      const reply = await fetch(new URL('/still-ok', opened.url))
      assert.equal(reply.status, 200)
      assert.match(await reply.text(), /__dsh_gui__\/bridge\.js/u)
    }
    await good()
    for (const pathname of ['/broken-html','/broken-js']) {
      try { const reply = await fetch(new URL(pathname, opened.url)); await reply.text() }
      catch (error) {assert.ok(error instanceof Error)}
      await good()
    }
    const echo = await openWebSocket(opened.url, '/echo')
    const echoReply = new Promise(ok => echo.on('data', chunk => {
      if (String(chunk).includes('echo:ping')) ok(String(chunk))
    }))
    echo.write('ping')
    assert.match(await Promise.race([echoReply, wait(2000).then(()=>{throw new Error('HMR proxy did not forward bidirectional bytes')})]), /echo:ping/)
    echo.end()
    const refused = await new Promise((ok, fail) => {
      const url = new URL(opened.url)
      const client = net.connect(Number(url.port),'127.0.0.1')
      let response = ''
      client.on('error',fail)
      client.once('connect',()=>client.write(`GET /reject HTTP/1.1\r\nHost: 127.0.0.1:${url.port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: ZGVtbzEyMzQ1Njc4OTA=\r\nSec-WebSocket-Version: 13\r\n\r\n`))
      client.on('data',chunk=>{response+=String(chunk)})
      client.once('close',()=>ok(response))
    })
    assert.match(refused,/502 Bad Gateway/u)
    await good()
    const rejected = await openWebSocket(opened.url,'/reset')
    await new Promise(ok => rejected.once('close', ok))
    await good()
    const clientReset = await openWebSocket(opened.url,'/hold')
    clientReset.resetAndDestroy()
    await wait(60)
    await good()
    const repeated = await manager.open(project, devUrl)
    assert.equal(repeated.url,opened.url,'transient resets must reuse the listening site port')
    aliveSocket = await openWebSocket(opened.url,'/hold')
    const remoteClosed = new Promise(ok => aliveSocket.once('close', ok))
    // Releasing a workspace must also terminate upgraded sockets; server.close()
    // alone does not close them and would leave shutdown hanging.
    await Promise.race([
      Promise.all([manager.close(), remoteClosed]),
      wait(2500).then(() => { throw new Error('manager.close hung on WebSocket') }),
    ])
    assert.equal(aliveSocket.destroyed, true)
  } finally {
    aliveSocket?.destroy()
    await manager.close()
    for (const socket of activeSockets) socket.destroy()
    await new Promise(ok => dev.close(ok))
  }
})
