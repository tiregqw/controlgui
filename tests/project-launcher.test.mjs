import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { readProjectCatalog, resolveProjectByName, createProjectLauncher } from '../src/project-launcher.ts'

const fixtures=mkdtempSync(join(tmpdir(),'controlgui-no-registration-'))
function project(name, files) {
  const dir=join(fixtures,name)
  mkdirSync(dir,{recursive:true})
  for (const [filename,content] of Object.entries(files)) writeFileSync(join(dir,filename),content)
  return dir
}
const vue=project('arc-vue',{'package.json':JSON.stringify({name:'arc-vue',scripts:{dev:'echo never-execute'}})})
const board=project('vue-board',{'package.json':JSON.stringify({name:'vue-board'})})
const staticSite=project('static-board',{'index.html':'<!doctype html><h1>Board</h1>'})
const configFile=join(fixtures,'projects.local.json')
writeFileSync(configFile,JSON.stringify({searchRoots:[fixtures]}))
process.once('exit',()=>rmSync(fixtures,{recursive:true,force:true}))

test('project discovery resolves folder or package name with NO registration', () => {
  const catalog=readProjectCatalog(configFile)
  assert.equal(catalog.projects,undefined)
  const found=resolveProjectByName('arc-vue',catalog)
  assert.equal(found.project,vue)
  assert.equal(found.source,'discovered')
})
test('another project is automatically discoverable without any alias', () => {
  assert.equal(resolveProjectByName('vue-board',readProjectCatalog(configFile)).project,board)
})
test('unknown name cannot launch an arbitrary project', () => {
  assert.throws(()=>resolveProjectByName('根本不存在的产品',readProjectCatalog(configFile)),/无法确定/)
})
test('ambiguous identical package names are rejected with candidate paths', () => {
  const root=join(fixtures,'ambiguous')
  mkdirSync(root,{recursive:true})
  for(const name of ['first','second']){
    const dir=join(root,name)
    mkdirSync(dir)
    writeFileSync(join(dir,'package.json'),JSON.stringify({name:'identical-project'}))
  }
  assert.throws(()=>resolveProjectByName('identical-project',{searchRoots:[root]}),/多个可能|确认一个路径/)
})
test('vague Vue name is not silently resolved to one of several Vue candidates', () => {
  assert.throws(()=>resolveProjectByName('打开 Vue 项目',readProjectCatalog(configFile)),/无法确定|多个可能/)
})
test('static site can be prepared without any registration or dev scripts', async () => {
  const launcher=createProjectLauncher(configFile)
  try {
    assert.deepEqual(await launcher.prepare({name:'static-board'},new AbortController().signal),{
      project:staticSite,started:false,source:'discovered',
    })
  } finally {launcher.dispose()}
})
test('untrusted arbitrary dev script is never executed by automatic open',async()=>{
  const launcher=createProjectLauncher(configFile)
  try {
    await assert.rejects(launcher.prepare({name:'arc-vue'},new AbortController().signal),/不是已安装依赖的 Vite/)
  } finally {launcher.dispose()}
})
test('explicit project with running loopback server is reused, not relaunched',async()=>{
  const server=createServer((_req,res)=>{res.writeHead(200,{'content-type':'text/html'});res.end('<h1>OK</h1>')})
  await new Promise(done=>server.listen(0,'127.0.0.1',done))
  try {
    const launcher=createProjectLauncher(configFile)
    const port=server.address().port
    const result=await launcher.prepare({project:vue,dev:'http://127.0.0.1:'+port+'/'},new AbortController().signal)
    assert.equal(result.started,false)
    assert.equal(result.dev,'http://127.0.0.1:'+port+'/')
    launcher.dispose()
  } finally {await new Promise(done=>server.close(done))}
})
