import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'

const installer = resolve(import.meta.dirname, '../install.mjs')
const createHome = initial => {
  const home=mkdtempSync(join(tmpdir(),'dsh-codex-install-'))
  const dir=join(home,'profiles','web')
  mkdirSync(dir,{recursive:true})
  writeFileSync(join(dir,'cordis.patch.yml'), initial)
  return { home, file:join(dir,'cordis.patch.yml') }
}
const call=(home,...args)=>execFileSync(process.execPath,[installer,'--home',home,...args],{encoding:'utf8'})
test('new profile installs, repeats safely and uninstalls without unrelated changes',()=>{
 const {home,file}=createHome('- id: unrelated\n  disabled: false\n')
 try{
  call(home)
  const first=readFileSync(file,'utf8')
  assert.match(first,/# dsh-codex-gui-plugin:begin/)
  assert.match(first,/src\/index\.ts/)
  assert.match(first,/- id: unrelated/)
  call(home)
  const second=readFileSync(file,'utf8')
  assert.equal((second.match(/- id: codex-visual-preview/g)||[]).length,1)
  call(home,'--uninstall')
  assert.doesNotMatch(readFileSync(file,'utf8'),/- id: codex-visual-preview/)
  assert.match(readFileSync(file,'utf8'),/- id: unrelated/)
 }finally{rmSync(home,{recursive:true,force:true})}
})
test('existing legacy plugin row is converted and can be disabled without touching neighbors',()=>{
 const {home,file}=createHome("- insert:\n    - id: codex-visual-preview\n      name: 'C:/old/index.ts'\n- id: another\n  disabled: false\n")
 try{
  call(home)
  const first=readFileSync(file,'utf8')
  assert.match(first,/src\/index\.ts/)
  assert.doesNotMatch(first,/C:\/old\/index\.ts/)
  call(home,'--uninstall')
  const second=readFileSync(file,'utf8')
  assert.match(second,/- id: codex-visual-preview\n      disabled: true/)
  assert.match(second,/- id: another\n  disabled: false/)
 }finally{rmSync(home,{recursive:true,force:true})}
})
