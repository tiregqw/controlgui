import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { withCore } from './load-core.mjs';
const { plugin, exportBrowserAnnotationPackage, parseBrowserAnnotationPackage, materializeBrowserAnnotationPackage } = await withCore((plugin, protocol) => ({ plugin, ...protocol }));

test('standalone build exactly reproduces the released compatibility package', () => {
  const data = JSON.stringify(exportBrowserAnnotationPackage(plugin), null, 2);
  assert.equal(data, readFileSync(new URL('../assets/shared-controlgui.bitfun-plugin.json', import.meta.url), 'utf8'));
});
test('round-trip preserves generated inspector, editor, markers, cleanup and event names', () => {
  const data = JSON.stringify(exportBrowserAnnotationPackage(plugin));
  const a = plugin.annotation;
  const b = materializeBrowserAnnotationPackage(parseBrowserAnnotationPackage(data)).annotation;
  const target = { path: '#submit', tagName: 'button', pageUrl: 'http://localhost/', textContent: 'Primary' };
  const comment = 'quote " and newline\n __BITFUN_ANNOTATION_JSON_ARGUMENT_42__';
  const notes = [{ element: { ...target, outerHTML: '<button>Primary</button>', sourceUrl: target.pageUrl }, comment }];
  for (const [name,args] of [
    ['createInspectorScript',['tab']], ['createEditorOpenScript',['tab',target,1,comment]],
    ['createEditorStatusScript',[comment]], ['createMarkerScript',['tab',target.pageUrl,notes]],
    ['createCleanupScript',[]], ['editorEvent',['tab']], ['draftKey',['s',target.pageUrl]]
  ]) assert.equal(b[name](...args),a[name](...args),name);
});
test('reject unsupported or malformed packages', () => {
  const p = exportBrowserAnnotationPackage(plugin);
  assert.throws(() => parseBrowserAnnotationPackage(JSON.stringify({...p,format:'invalid'})));
  assert.throws(() => parseBrowserAnnotationPackage(JSON.stringify({...p,scripts:{...p.scripts,inspector:'alert(1)'}})));
});
