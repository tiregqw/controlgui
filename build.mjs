/** Build only the browser client bundle. Cordis and the preview server run TypeScript directly. */
import { createRequire } from 'node:module'
const localRequire = createRequire(import.meta.url)
// Building inside the DSH pnpm checkout; compiled distribution needs no builder.
let esbuild
try { esbuild = localRequire('esbuild') }
catch {
  // When developed as a standalone repo, use the DSH checkout from which the build is invoked.
  const { resolve: resolvePath } = await import('node:path')
  esbuild = localRequire(resolvePath(process.env.DSH_CHECKOUT ?? process.cwd(), 'node_modules/.pnpm/node_modules/esbuild'))
}
const { build } = esbuild
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const outdir = resolve(root, 'lib')
await mkdir(outdir, { recursive: true })
// DSH's browser module table requires a factory rather than an ESM import.
// The factory executes only when the client loader activates this plugin.
const client = await build({
  entryPoints: [resolve(root, 'src/client/index.ts')],
  platform: 'browser', format: 'cjs', target: 'es2022',
  jsx: 'automatic', bundle: true, write: false, sourcemap: 'external', outfile: resolve(outdir, 'client.js'),
  external: ['react', 'react/*', '@deepseek-ai/*'], legalComments: 'none', logLevel: 'warning',
})
const content = client.outputFiles.find(file => file.path.endsWith('.js'))?.text
const rawMap = client.outputFiles.find(file => file.path.endsWith('.js.map'))?.text
if (!content || !rawMap) throw new Error('Client bundle or sourcemap missing')
const name = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')).name
const preludeLines = 5
const map = JSON.parse(rawMap)
map.file = 'client.js'
map.mappings = ';'.repeat(preludeLines) + map.mappings
const script = `window.__ModuleLoader__.load({
  id: ${JSON.stringify(name)},
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
${content}
    return module.exports;
  }
});
`
await writeFile(resolve(outdir, 'client.js'), script+'\n//# sourceMappingURL=client.js.map\n', 'utf8')
await writeFile(resolve(outdir, 'client.js.map'), JSON.stringify(map), 'utf8')
// Remove obsolete Node bundles from the earlier all-compiled design.
for (const legacy of ['index.js', 'index.js.map', 'server.js', 'server.js.map', 'page-runtime.js']) {
  await rm(resolve(outdir, legacy), { force: true })
}
console.log(`Built DSH Codex GUI browser bundle ${name}; Node entries are loaded directly from src/*.ts`)
