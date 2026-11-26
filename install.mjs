/** Register/unregister this portable dual-face plugin in one DSH profile. */
import { existsSync } from 'node:fs'
import { copyFile, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const self = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const value = name => {
  const index = args.indexOf(name)
  if (index !== -1 && index + 1 >= args.length) throw new Error('Missing value for '+name)
  return index === -1 ? undefined : args[index + 1]
}
const uninstall = args.includes('--uninstall')
const profile = value('--profile') ?? 'web'
if (!/^[a-z0-9][a-z0-9-_]*$/i.test(profile)) throw new Error('Invalid profile name')
const home = resolve(value('--home') ?? process.env.DSH_HOME ?? join(process.cwd(), '.dsh'))
const config = join(home, 'profiles', profile, 'cordis.patch.yml')
if (!existsSync(config)) throw new Error(`Profile config not found: ${config}\nUse --home PATH to specify the DSH home.`)
const entry = resolve(self, 'src', 'index.ts')
const client = resolve(self, 'lib', 'client.js')
if (!uninstall && (!existsSync(entry) || !existsSync(client))) throw new Error('Plugin requires src/index.ts and a built lib/client.js; run node build.mjs if needed')
const name = entry.replaceAll('\\', '/')
if (name.includes("'")) throw new Error('Single quotes are unsupported in the plugin install path')
const newline = (await readFile(config, 'utf8')).includes('\r\n') ? '\r\n' : '\n'
let yaml = await readFile(config, 'utf8')
const begin = '# dsh-codex-gui-plugin:begin'
const end = '# dsh-codex-gui-plugin:end'
const marker = new RegExp('(?:^|\\r?\\n)'+begin+'\\r?\\n[\\s\\S]*?\\r?\\n'+end+'(?=\\r?\\n|$)')
const existing = yaml.match(marker)
if (existing !== null) yaml = yaml.replace(marker, '')

// Handle the row from the older source-based GUI without touching other profile rows.
const lines = yaml.split(/\r?\n/u)
const matches = lines.map((line,i)=> /^\s+- id: codex-visual-preview\s*$/u.test(line) ? i : -1).filter(i => i !== -1)
if (matches.length > 1) throw new Error('Duplicate codex-visual-preview rows; refusing to edit profile')
if (matches.length === 1) {
  const start = matches[0]
  const indentation = lines[start].match(/^\s*/u)?.[0].length ?? 0
  let stop = start+1
  while (stop < lines.length) {
    const line = lines[stop]
    if (line.trim() === '' || line.trimStart().startsWith('#')) { stop++; continue }
    if ((line.match(/^\s*/u)?.[0].length ?? 0) <= indentation) break
    stop++
  }
  const nameIndex = lines.findIndex((line, i) => i > start && i < stop && /^\s+name:\s*/u.test(line))
  const disabledIndex = lines.findIndex((line, i) => i > start && i < stop && /^\s+disabled:\s*/u.test(line))
  if (nameIndex === -1 && !uninstall) throw new Error('Existing plugin row lacks a name; refusing to overwrite it')
  if (nameIndex !== -1 && !uninstall) lines[nameIndex] = ' '.repeat(indentation+2)+`name: '${name}'`
  if (disabledIndex !== -1) lines[disabledIndex] = ' '.repeat(indentation+2)+`disabled: ${uninstall?'true':'false'}`
  else lines.splice(start+1,0,' '.repeat(indentation+2)+`disabled: ${uninstall?'true':'false'}`)
  yaml = lines.join(newline)
} else if (!uninstall) {
  // A fresh DSH profile is a comment header followed by an empty YAML list.
  // Replace that standalone list before appending the first sequence entry.
  const significant = yaml.split(/\r?\n/u).filter(line => line.trim() && !line.trimStart().startsWith('#'))
  if (significant.length === 1 && /^\s*\[\s*\]\s*(?:#.*)?$/u.test(significant[0])) {
    yaml = yaml.split(/\r?\n/u).filter(line => line !== significant[0]).join(newline)
  }
  yaml = yaml.trimEnd()+newline+newline+begin+newline+'- insert:'+newline+
    '    - id: codex-visual-preview'+newline+`      name: '${name}'`+newline+end+newline
}
// Removing the only managed plugin must leave a valid empty sequence.
if (uninstall && !yaml.split(/\r?\n/u).some(line => line.trim() && !line.trimStart().startsWith('#'))) {
  yaml = yaml.trimEnd()+newline+'[]'+newline
}
const before = await readFile(config, 'utf8')
if (yaml === before) { console.log('No changes required:', config); process.exit(0) }
const stamp = new Date().toISOString().replace(/[:.]/gu,'-')
const backup = config+'.before-codex-gui-plugin-'+stamp+'.bak'
await copyFile(config,backup)
const temporary = config+'.tmp-codex-gui'
await writeFile(temporary,yaml,'utf8')
try { await rename(temporary,config) }
catch (error) { await copyFile(backup,config); throw error }
console.log(`${uninstall?'Disabled':'Enabled'} @local/dsh-codex-gui in ${profile} profile`)
console.log('Config:',config)
console.log('Backup:',backup)
if (!uninstall) console.log('Cordis TypeScript plugin:',entry)
console.log('Restart DSH Web to activate the change.')
