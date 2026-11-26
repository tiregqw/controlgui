import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { inspectHarmonyProject, renderArktsStructure } from '../src/harmony-preview.ts'
import { createProjectLauncher } from '../src/project-launcher.ts'
import { createProjectPreviewManager } from '../src/project-preview.ts'
import { searchLocalProjects } from '../src/project-search.ts'
import { formatCodexPrompt } from '../src/client/protocol.ts'

const root = join(import.meta.dirname, '..')
const bridge = join(root, 'assets', 'page-runtime.js')
function makeStage({web=false, name='SampleHarmonyApp'}={}) {
  const dir = mkdtempSync(join(tmpdir(), name + '-'))
  mkdirSync(join(dir, 'entry', 'src', 'main', 'ets', 'pages'), { recursive: true })
  writeFileSync(join(dir, 'build-profile.json5'), '{}')
  writeFileSync(join(dir, 'entry','src','main','module.json5'), '{}')
  const code = web
    ? "@Entry\n@Component\nstruct Main { build() {\n  Web({src: $rawfile('index.html')})\n} }"
    : "@Entry\n@Component\nstruct Main {\n build(){\n  Column(){\n    Text('<script>alert(1)</script>')\n    Button('立即打卡')\n  }\n }\n}"
  writeFileSync(join(dir, 'entry','src','main','ets','pages','Index.ets'), code)
  if (web) {
    const webDir = join(dir,'entry','src','main','resources','rawfile')
    mkdirSync(webDir,{recursive:true})
    writeFileSync(join(webDir,'index.html'), '<html><head></head><body><h1>ArkWeb web demo</h1></body></html>')
  }
  return dir
}

test('identify native HarmonyOS and extract bounded source locations, not rendered app UI', () => {
  const dir=makeStage()
  try {
    const result=inspectHarmonyProject(dir)
    assert.equal(result?.kind,'arkui')
    assert.equal(result.pages.length,1)
    assert.equal(result.pages[0]?.file,'entry/src/main/ets/pages/Index.ets')
    assert.ok(result.pages[0]?.components.some(v => v.kind==='Button' && v.line===7))
    const html=renderArktsStructure(dir,result)
    assert.match(html,/不是鸿蒙原生渲染截图/)
    assert.match(html,/data-source-file="entry\/src\/main\/ets\/pages\/Index\.ets:7"/)
    assert.doesNotMatch(html,/<script>alert\(1\)<\/script>/)
    assert.match(html,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  } finally {rmSync(dir,{recursive:true,force:true})}
})
test('automatic project search recognizes HarmonyOS without Node package.json',()=>{
  const dir=makeStage()
  try {
    const results=searchLocalProjects(dir.split(/[\\/]/).at(-1),{searchRoots:[dir]},4)
    assert.equal(results.matches[0]?.project,dir)
    assert.equal(results.matches[0]?.startup,'harmony')
    assert.match(results.matches[0]?.framework??'',/HarmonyOS ArkUI/)
  }finally{rmSync(dir,{recursive:true,force:true})}
})
test('native HarmonyOS Stage opens read-only source structure and no filesystem routes',async()=>{
  const dir=makeStage()
  const launcher=createProjectLauncher()
  const manager=createProjectPreviewManager(bridge)
  try {
    const prepared=await launcher.prepare({project:dir},new AbortController().signal)
    assert.equal(prepared.previewKind,'arkui')
    assert.equal(prepared.started,false)
    const preview=await manager.open(dir)
    assert.equal(preview.mode,'harmony')
    assert.equal(new URL(preview.url).searchParams.get('mode'),'harmony')
    const doc=await fetch(preview.url)
    assert.equal(doc.status,200)
    const html=await doc.text()
    assert.match(html,/HarmonyOS · ArkTS 组件结构/)
    assert.match(html,/data-source-file=/)
    assert.equal((await fetch(new URL('/entry/src/main/ets/pages/Index.ets',preview.url))).status,404)
    assert.equal((await fetch(preview.url,{method:'POST'})).status,405)
    const bridgeResponse=await fetch(new URL('/__dsh_gui__/bridge.js',preview.url))
    assert.equal(bridgeResponse.status,200)
    assert.match(await bridgeResponse.text(),/codex\.submit/)
  }finally{
    await manager.close()
    launcher.dispose()
    rmSync(dir,{recursive:true,force:true})
  }
})
test('HarmonyOS ArkWeb packaged HTML stays in real H5 static preview',async()=>{
  const dir=makeStage({web:true})
  const launcher=createProjectLauncher()
  const manager=createProjectPreviewManager(bridge)
  try {
    const inspected=inspectHarmonyProject(dir)
    assert.equal(inspected?.kind,'arkweb')
    assert.ok(inspected.webRoot)
    const prepared=await launcher.prepare({project:dir},new AbortController().signal)
    assert.equal(prepared.previewKind,'arkweb')
    const preview=await manager.open(dir)
    assert.equal(preview.mode,'static')
    const html=await (await fetch(preview.url)).text()
    assert.match(html,/ArkWeb web demo/)
    assert.match(html,/__dsh_gui__\/bridge.js/)
    assert.doesNotMatch(html,/不是鸿蒙原生渲染截图/)
  }finally{
    await manager.close()
    launcher.dispose()
    rmSync(dir,{recursive:true,force:true})
  }
})
test('optional DevEco screenshot is displayed as a reference only, with no image-pixel source mapping',async()=>{
  const dir=makeStage()
  const manager=createProjectPreviewManager(bridge)
  try {
    writeFileSync(join(dir,'controlgui-preview.png'),Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==','base64'))
    const inspected=inspectHarmonyProject(dir)
    assert.equal(inspected?.kind,'arkui')
    assert.ok(inspected.screenshot)
    const preview=await manager.open(dir)
    const html=await (await fetch(preview.url)).text()
    assert.match(html,/用户截图，仅供视觉参考/)
    assert.match(html,/harmony-shot\.png/)
    const response=await fetch(new URL('/__dsh_gui__/harmony-shot.png',preview.url))
    assert.equal(response.status,200)
    assert.equal(response.headers.get('content-type'),'image/png')
  }finally{await manager.close();rmSync(dir,{recursive:true,force:true})}
})
test('refresh reflects newly generated ArkTS without restarting the preview server',async()=>{
  const dir=makeStage()
  const manager=createProjectPreviewManager(bridge)
  try {
    const preview=await manager.open(dir)
    const before=await (await fetch(preview.url)).text()
    assert.doesNotMatch(before,/第 11 行/)
    const file=join(dir,'entry','src','main','ets','pages','Index.ets')
    writeFileSync(file,"@Entry\n@Component\nstruct Main {\n build(){\n  Column(){\n    Text('update')\n    Button('new')\n    Button('added after edit')\n  }\n }\n}")
    const after=await (await fetch(preview.url)).text()
    assert.match(after,/added after edit/)
    assert.match(after,/Index\.ets:8/)
  } finally{await manager.close();rmSync(dir,{recursive:true,force:true})}
})
test('ArkTS annotation prompt records source location and warns about missing native rendering',()=>{
  const url='http://127.0.0.1:54001/?__dsh_gui=1&workspace=E%3A%5Capp&mode=harmony'
  const prompt=formatCodexPrompt([{
    comment:'按钮加宽',
    element:{tag:'button',selector:'.component',text:'Button',html:'<button>Button</button>',
      page:'/',sourceHint:'entry/src/main/ets/pages/Index.ets:7'}
  }],url)
  assert.match(prompt,/不是 DevEco 原生渲染/)
  assert.match(prompt,/Index\.ets:7/)
  assert.match(prompt,/按钮加宽/)
})
test('plain Web projects stay Web and are not mislabeled as HarmonyOS',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'plain-web-'))
  const manager=createProjectPreviewManager(bridge)
  try {
    writeFileSync(join(dir,'index.html'),'<html><body>ordinary web app</body></html>')
    assert.equal(inspectHarmonyProject(dir),undefined)
    const page=await manager.open(dir)
    assert.equal(page.mode,'static')
    assert.match(await (await fetch(page.url)).text(),/ordinary web app/)
  } finally{await manager.close();rmSync(dir,{recursive:true,force:true})}
})
