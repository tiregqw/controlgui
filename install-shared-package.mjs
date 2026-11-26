/** Install the same trusted browser-annotation-v1 JSON package into the DSH preview adapter.
 * No eval in the preview, no Tauri privileges, no host recompile.
 * Replaces only the generated page-runtime.js; Harmony structure mode retains the legacy renderer.
 */
import { readFile, writeFile, copyFile, rename } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const root = dirname(fileURLToPath(import.meta.url))
const assets = resolve(root, 'assets')
const target = resolve(assets, 'page-runtime.js')
const legacy = resolve(assets, 'page-runtime.legacy.js')
const packageFile = resolve(assets, 'shared-controlgui.bitfun-plugin.json')
const input = process.argv[2]
if (!input) throw new Error('Usage: node install-shared-package.mjs <trusted-package.json | --remove>')
if (input === '--remove') {
  if (!existsSync(legacy)) throw new Error('Legacy runtime is missing')
  await copyFile(legacy, target)
  console.log('Restored original DSH preview runtime; drafts untouched.')
} else {
  const bytes = await readFile(resolve(input))
  if (bytes.length > 512 * 1024) throw new Error('Package exceeds 512 KB')
  const pack = JSON.parse(bytes.toString('utf8'))
  if (pack.format !== 'bitfun-browser-annotation-v1' || pack.manifest?.target !== 'browser-webview' ||
      pack.manifest?.id !== 'controlgui' || pack.annotation?.maxNotes !== 20) throw new Error('Unsupported annotation package')
  const meta = pack.annotation
  for (const k of ['editorEventPrefix','editorOpenedEventPrefix','markerEventPrefix']) {
    if (typeof meta[k] !== 'string' || !/^browser-[a-z0-9-]+-$/.test(meta[k])) throw new Error('Invalid event prefix')
  }
  const sentinel = '__BITFUN_ANNOTATION_JSON_ARGUMENT_42__'
  const keys = ['inspector','editorOpen','editorClose','editorStatus','markers','cleanup','pause','cancel']
  const templated = new Set(['inspector','editorOpen','editorStatus','markers'])
  const functions = keys.map(key => {
    const source = pack.scripts?.[key]
    if (typeof source !== 'string' || !source.length || source.split(sentinel).length !== (templated.has(key)?2:1)) throw new Error('Invalid template '+key)
    // Translate only the host IPC references. The picker and UI algorithm remain byte-for-byte otherwise.
    const code = source.replaceAll('window.__TAURI_INTERNALS__','bridge').replaceAll('page.__TAURI_INTERNALS__','bridge').replace(sentinel,'arg')
    return JSON.stringify(key)+': (arg) => {\n'+code+'\n}'
  })
  const adapter = await readFile(resolve(assets,'shared-package-adapter.js'),'utf8')
  const hash = createHash('sha256').update(bytes).digest('hex')
  if (!existsSync(legacy)) await copyFile(target,legacy)
  const fallback = await readFile(legacy,'utf8')
  const generated = '// DSH shared ControlGUI package SHA256: '+hash+'\nif(new URLSearchParams(location.search).get("mode")==="harmony"){\n'+fallback+'\n}else{\n;'+adapter+'\n('+JSON.stringify(meta)+', (bridge) => ({\n'+functions.join(',\n')+'\n}));\n}\n'
  // Parse without executing it. Installation is an explicit trust decision.
  new Function(generated)
  await writeFile(packageFile,bytes)
  const temporary = target+'.tmp'
  await writeFile(temporary,generated,'utf8')
  await rename(temporary,target)
  console.log(JSON.stringify({package:packageFile,sha256:hash,runtime:target,bytes:bytes.length}))
}
