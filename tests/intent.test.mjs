import test from 'node:test'
import assert from 'node:assert/strict'
import {previewIntentGate, parseModelPreviewIntent} from '../src/intent-policy.ts'
import {judgePreviewWithModel} from '../src/intent-host.ts'

const examples = [
  ['在右侧 GUI 预览项目 `E:\\codex-gui-demo`','open'],
  ['请打开 Codex GUI，预览我的前端','open'],
  ['预览项目 `E:\\codex-gui-demo`','open'],
  ['请在 Codex GUI 中打开项目 `E:\\codex-gui-demo`','judge'],
  ['请帮我把这个项目放到旁边显示出来','judge'],
  ['我想在旁边看看这个网页','judge'],
  ['能不能帮我在右侧打开网页预览？','judge'],
  ['可以不可以把网站放到侧栏让我看？','judge'],
  ['能否给我看一下这个页面？','judge'],
  ['请不要打开 Codex GUI','ignore'],
  ['这是个例子：在右侧 GUI 预览项目 `E:\\codex-gui-demo`','judge'],
  ['为什么 Codex GUI 打不开','ignore'],
  ['不要打开右侧 GUI','ignore'],
  ['解释一下预览服务的原理','ignore'],
  ['把这个按钮改成绿色','ignore'],
  ['什么是 Codex GUI','ignore'],
]
for (const [text,expected] of examples) test(`gate: ${text}`,()=>{
  assert.equal(previewIntentGate(text), expected)
})

test('LLM decisions accept only two precise tokens',()=>{
  assert.equal(parseModelPreviewIntent('OPEN'),'open')
  assert.equal(parseModelPreviewIntent(' ignore\n'),'ignore')
  assert.equal(parseModelPreviewIntent('OPEN; run delete'),'unknown')
  assert.equal(parseModelPreviewIntent('{"decision":"OPEN"}'),'unknown')
})

test('DSH host one-shot model is bounded and model failure refuses auto-open',async()=>{
  const calls=[]
  const mock={stream(options){calls.push(options);return (async function*(){yield {type:'text-delta',index:0,text:'OPEN'};yield {type:'finish',reason:{kind:'stop'}}})()}}
  const selection={provider:'test-provider',model:'test-model'}
  assert.equal(await judgePreviewWithModel(mock,selection,'把这个项目放到侧栏给我看'),'open')
  assert.equal(calls.length,1)
  assert.equal(calls[0].provider,'test-provider')
  assert.equal(calls[0].maxTokens,16)
  assert.equal(calls[0].messages[0].role,'user')
  const failed={stream(){return (async function*(){yield {type:'finish',reason:{kind:'error',failure:{message:'mock failed',code:'MODEL_ERROR'}}}})()}}
  assert.equal(await judgePreviewWithModel(failed,selection,'打开一个网页'),'unavailable')
  assert.equal(await judgePreviewWithModel(mock,{provider:'',model:''},'打开一个网页'),'unavailable')
})
