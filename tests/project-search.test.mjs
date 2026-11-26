import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { searchLocalProjects } from '../src/project-search.ts'
import { installPreviewTool, SEARCH_PROJECTS_TOOL, PREVIEW_TOOL } from '../src/preview-tool.ts'

const root = mkdtempSync(join(tmpdir(),'controlgui-search-'))
process.once('exit',()=>rmSync(root,{recursive:true,force:true}))
const project=(relative,files)=>{
  const path=join(root,relative)
  mkdirSync(path,{recursive:true})
  for(const [name,content] of Object.entries(files)) writeFileSync(join(path,name),content)
  return path
}
const vue=project('hidden/新项目/vue-collab-app',{
  'package.json':JSON.stringify({name:'vue-collab-app',description:'用户协作项目看板',dependencies:{vue:'^3.5.0'},devDependencies:{vite:'^5.4.0'}}),
  'README.md':'# 智能协作工作台\n\n这是我们协作的应用。',
})
const anime=project('课程/推荐系统/anime_recommender',{
  'requirements.txt':'Flask==3.0.0\n',
  'app.py':'print("not executed")',
  'README.md':'# 基于协同过滤的动漫偏好分析与推荐系统\n\n设计文档',
})
const extra=project('another/vue-collab-app',{
  'package.json':JSON.stringify({name:'vue-collab-app',description:'用户协作项目看板',dependencies:{vue:'^3.5.0'},devDependencies:{vite:'^5.4.0'}}),
})
const ignored=project('node_modules/example',{
  'package.json':JSON.stringify({name:'example'}),
})
const conf={searchRoots:[root]}
test('discover Vue project by README descriptive title without registration',()=>{
  const out=searchLocalProjects('智能协作工作台',conf)
  assert.equal(out.matches[0]?.project,vue)
  assert.equal(out.matches[0]?.framework,'Vue/Vite')
})
test('discover Python/Flask-like project by long Chinese README title',()=>{
  const out=searchLocalProjects('动漫偏好分析与推荐',conf)
  assert.equal(out.matches[0]?.project,anime)
  assert.equal(out.matches[0]?.startup,'manual')
})
test('ambiguous generic Vue project never claimed as a unique match',()=>{
  const out=searchLocalProjects('打开Vue项目',conf)
  assert.ok(out.matches.length>=2)
  assert.match(out.note,/存在相近候选/)
})
test('exclude ignored node_modules project from automatic discovery',()=>{
  const out=searchLocalProjects('example',conf)
  assert.ok(!out.matches.some(x=>x.project===ignored))
})
test('project search is read only and does not conclude an Agent turn',async()=>{
  const definitions=[]
  installPreviewTool({inject(_services,run){
    run({
      tools:{register(tool){definitions.push(tool);return ()=>{}}},
      effect(fn){fn()},
    })
  }})
  assert.ok(definitions.some(x=>x.name===PREVIEW_TOOL))
  const search=definitions.find(x=>x.name===SEARCH_PROJECTS_TOOL)
  assert.ok(search)
  let conclude=false
  const out=JSON.parse(await search.execute({query:'vue'},{
    signal:new AbortController().signal,
    concludeTurn(){conclude=true},
  }))
  assert.ok(out.matches)
  assert.equal(conclude,false)
})
