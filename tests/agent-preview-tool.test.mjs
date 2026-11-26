import test from 'node:test'
import assert from 'node:assert/strict'
import { installPreviewTool, PREVIEW_TOOL, PREVIEW_TOOL_TARGET_REQUIRED } from '../src/preview-tool.ts'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function captureDefinition() {
  let definition
  const ctx = {
    inject(services, setup) {
      assert.deepEqual(services, ['tools'])
      setup({
        tools: { register(value) { definition = value; return () => {} } },
        effect(install) { install() },
      })
    },
  }
  installPreviewTool(ctx)
  assert.ok(definition)
  return definition
}

test('agent sees an explicit GUI preview tool with optional project/dev fields', () => {
  const tool = captureDefinition()
  assert.equal(tool.name, PREVIEW_TOOL)
  assert.equal(tool.parameters.type, 'object')
  assert.equal(tool.parameters.properties.project.type, 'string')
  assert.ok(tool.description.includes('“那个网页”'))
  assert.ok(tool.description.includes('ASK the user'))
})

test('missing project never concludes a turn: Agent must ask for a project name or path', async () => {
  const tool = captureDefinition()
  let count = 0
  const result = await tool.execute({}, {
    signal: new AbortController().signal,
    concludeTurn() { count++ },
  })
  assert.equal(result, PREVIEW_TOOL_TARGET_REQUIRED)
  assert.equal(count, 0)
  assert.deepEqual(tool.output.render({}, result), [{ type: 'text', text: PREVIEW_TOOL_TARGET_REQUIRED }])
})

test('verified project preview conclusively ends the Agent turn and returns the exact target', async () => {
  const tool = captureDefinition()
  const directory = mkdtempSync(join(tmpdir(), 'controlgui-target-'))
  writeFileSync(join(directory, 'index.html'), '<!doctype html><title>Example</title>')
  let count = 0
  try {
    const result = await tool.execute({ project: directory }, {
      signal: new AbortController().signal,
      concludeTurn() { count++ },
    })
    assert.equal(count, 1)
    const marker = 'CONTROLGUI_TARGET='
    assert.ok(result.includes(marker))
    const prepared = JSON.parse(result.slice(result.indexOf(marker) + marker.length).split('\n')[0])
    assert.equal(prepared.project, directory)
    assert.deepEqual(tool.output.render({}, result), [{ type: 'text', text: result }])
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('aborted tool does not mark a successful conclusion', async () => {
  const tool = captureDefinition()
  const abort = new AbortController()
  abort.abort(new Error('cancelled'))
  let concluded = false
  await assert.rejects(() => tool.execute({}, {
    signal: abort.signal,
    concludeTurn() { concluded = true },
  }))
  assert.equal(concluded, false)
})
