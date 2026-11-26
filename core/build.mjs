import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { withCore } from './load-core.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const { data, pack } = await withCore((plugin, { exportBrowserAnnotationPackage, parseBrowserAnnotationPackage }) => {
  const data = JSON.stringify(exportBrowserAnnotationPackage(plugin), null, 2);
  return { data, pack: parseBrowserAnnotationPackage(data) };
});
const output = resolve(root, process.argv[2] ?? ('dist/' + pack.manifest.id + '-' + pack.manifest.version + '.bitfun-plugin.json'));
await mkdir(dirname(output), { recursive: true });
await writeFile(output, data, 'utf8');
console.log(JSON.stringify({ output, bytes: Buffer.byteLength(data), sha256: createHash('sha256').update(data).digest('hex') }));
