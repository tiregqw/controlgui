import { createServer } from 'vite';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Vite's TS transform is deliberate: script factories serialize function bodies.
// Node's native type stripping produces different whitespace and output bytes.
export async function withCore(callback) {
  const server = await createServer({
    root: dirname(fileURLToPath(import.meta.url)), configFile: false,
    server: { middlewareMode: true, hmr: false }, appType: 'custom',
  });
  try {
    const { default: plugin } = await server.ssrLoadModule('/index.ts');
    const protocol = await server.ssrLoadModule('/runtimePackage.ts');
    return await callback(plugin, protocol);
  } finally { await server.close(); }
}
