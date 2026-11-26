import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const body = readFileSync(resolve(import.meta.dirname, '../src/client/CodexGuiBody.tsx'), 'utf8')

test('new Session has no active preview until an explicit target is confirmed', () => {
  const start = body.indexOf('const [target, setTarget] = useState<CodexGuiTarget>')
  const end = body.indexOf('// Editable target', start)
  assert.ok(start >= 0 && end > start)
  const init = body.slice(start, end)
  assert.doesNotMatch(init, /readLastTarget\(/, 'last-used project must never initialize active preview')
  assert.match(init, /:\s*\{\s*project:\s*''\s*\}/, 'a blank panel starts with no active project')
  assert.match(body, /else\s*\{\s*\/\/ A blank panel[^\n]*\n\s*setTarget\(\{\s*project:\s*''\s*\}\)/)
  // Input convenience may remember the path, but it cannot start any sidecar preview.
  assert.match(body, /projectInput.*readLastTarget\(sessionId\)/)
})

test('direct send calls the scoped DSH conversation service, not the composer', () => {
  const install = readFileSync(resolve(import.meta.dirname, '../src/client/install.ts'), 'utf8')
  assert.match(install, /sessions\.scope\(sessionId\)\?\.get\('conversation'\)/)
  assert.match(install, /await conversation\.send\(prompt\)/)
  assert.match(body, /props\.sendAnnotation\(formatCodexPrompt\(notes, pageUrl\)\)/)
  assert.doesNotMatch(body, /inputActions|insertText\(|persistDraft\(\)|CONTROLGUI_RECEIPT|setProposal|confirmRef/)
  assert.doesNotMatch(body, /添加到对话|已加入对话|手动发送/)
})

test('unsent notes persist across refresh and successful send clears only the sent batch', () => {
  assert.match(body, /localStorage\.setItem\(key, JSON\.stringify\(\{ version: 4, notes \}\)\)/)
  assert.match(body, /restore: \(\) => restoreDraft\(sessionId, target, url\)/)
  assert.match(body, /JSON\.stringify\(restoreDraft\(sessionId, target, url\)\) === JSON\.stringify\(notes\)/)
  assert.match(body, /persistDraft\(sessionId, target, \[\]\)/)
  assert.match(body, /catch \(error\) \{[\s\S]*发送失败，批注已保留/)
})