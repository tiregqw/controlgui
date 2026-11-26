import type { BrowserExtension, BrowserExtensionManifest, BrowserAnnotationContribution, BrowserAnnotationNote } from './contracts.ts';
import { makeControlGuiNote, readControlGuiDraft, saveControlGuiDraft, assertControlGuiPageMatches, formatControlGuiPrompt } from './annotationProtocolV1.ts';

const ARG = '__BITFUN_ANNOTATION_JSON_ARGUMENT_42__';
const PROBE = '__BITFUN_ANNOTATION_EXPORT_PROBE_42__';
const marker = JSON.stringify(PROBE);
const MAX_BYTES = 512 * 1024;
const SCRIPT_KEYS = ['inspector', 'editorOpen', 'editorClose', 'editorStatus', 'markers', 'cleanup', 'pause', 'cancel'] as const;
type ScriptKey = typeof SCRIPT_KEYS[number];
export interface BrowserAnnotationPackage {
  format: 'bitfun-browser-annotation-v1';
  manifest: BrowserExtensionManifest;
  annotation: { label: string; activeLabel: string; maxNotes: 20; editorEventPrefix: string; editorOpenedEventPrefix: string; markerEventPrefix: string };
  scripts: Record<ScriptKey, string>;
}
const TEMPLATE_KEYS = new Set<ScriptKey>(['inspector', 'editorOpen', 'editorStatus', 'markers']);
function fail(message: string): never { throw new Error(message); }
function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('插件包结构不正确');
  return value as Record<string, unknown>;
}
export function parseBrowserAnnotationPackage(raw: string): BrowserAnnotationPackage {
  if (new TextEncoder().encode(raw).length > MAX_BYTES) fail('插件包不能超过 512 KB');
  const root = object(JSON.parse(raw));
  if (root.format !== 'bitfun-browser-annotation-v1') fail('不支持的插件协议版本');
  const m = object(root.manifest), a = object(root.annotation), scripts = object(root.scripts);
  if (!text(m.id, 64) || !/^[a-z][a-z0-9-]*$/.test(m.id) || !text(m.name, 100) ||
      !text(m.description, 500) || !text(m.version, 32) || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(m.version) ||
      m.target !== 'browser-webview' || typeof m.defaultEnabled !== 'boolean') fail('插件声明无效');
  if (!text(a.label, 32) || !text(a.activeLabel, 32) || a.maxNotes !== 20) fail('批注协议不兼容');
  for (const k of ['editorEventPrefix', 'editorOpenedEventPrefix', 'markerEventPrefix']) {
    if (!text(a[k], 100) || !/^browser-[a-z0-9-]+-$/.test(a[k])) fail('无效的事件前缀');
  }
  const checked = {} as Record<ScriptKey, string>;
  for (const key of SCRIPT_KEYS) {
    const code = scripts[key];
    if (!text(code, MAX_BYTES) || code.split(ARG).length !== (TEMPLATE_KEYS.has(key) ? 2 : 1)) fail('无效的脚本模板: ' + key);
    checked[key] = code;
  }
  return {
    format: 'bitfun-browser-annotation-v1',
    manifest: { id: m.id, name: m.name, version: m.version, description: m.description, target: 'browser-webview', defaultEnabled: m.defaultEnabled },
    annotation: { label: a.label, activeLabel: a.activeLabel, maxNotes: 20,
      editorEventPrefix: a.editorEventPrefix as string, editorOpenedEventPrefix: a.editorOpenedEventPrefix as string, markerEventPrefix: a.markerEventPrefix as string },
    scripts: checked,
  };
}
// Data is substituted once, as JSON, never interpolated as executable input.
// The imported scripts themselves are trusted executable WebView code.
function render(template: string, data: unknown): string {
  const [before, after] = template.split(ARG);
  return before + JSON.stringify(data) + after;
}
function prefix(fn: (label: string) => string): string {
  const value = fn(PROBE);
  if (!value.endsWith(PROBE)) fail('不兼容的事件协议');
  return value.slice(0, -PROBE.length);
}
function template(script: string, value: string): string {
  if (script.split(value).length !== 2) fail('无法导出脚本参数模板');
  return script.replace(value, ARG);
}
export function exportBrowserAnnotationPackage(extension: BrowserExtension): BrowserAnnotationPackage {
  const a = extension.annotation;
  if (!a || a.maxNotes !== 20) fail('该插件不支持 v1 批注包');
  const target = { path: PROBE, tagName: 'button', pageUrl: 'http://localhost/' };
  const editorInput = { label: PROBE, target, index: null, comment: PROBE };
  const markerInput = { label: PROBE, expectedUrl: PROBE, notes: [] };
  const pack = {
    format: 'bitfun-browser-annotation-v1',
    manifest: extension.manifest,
    annotation: { label: a.label, activeLabel: a.activeLabel, maxNotes: 20,
      editorEventPrefix: prefix(a.editorEvent), editorOpenedEventPrefix: prefix(a.editorOpenedEvent), markerEventPrefix: prefix(a.markerClickEvent) },
    scripts: {
      inspector: template(a.createInspectorScript(PROBE), marker),
      editorOpen: template(a.createEditorOpenScript(PROBE, target, null, PROBE), JSON.stringify(editorInput)),
      editorClose: a.createEditorCloseScript(),
      editorStatus: template(a.createEditorStatusScript(PROBE), marker),
      markers: template(a.createMarkerScript(PROBE, PROBE, []), JSON.stringify(markerInput)),
      cleanup: a.createCleanupScript(), pause: a.pauseInspectorScript, cancel: a.cancelInspectorScript,
    },
  };
  return parseBrowserAnnotationPackage(JSON.stringify(pack));
}
export function materializeBrowserAnnotationPackage(pack: BrowserAnnotationPackage): BrowserExtension {
  const { manifest, annotation: a, scripts: s } = pack;
  const contribution: BrowserAnnotationContribution = {
    label: a.label, activeLabel: a.activeLabel, maxNotes: a.maxNotes,
    createInspectorScript: label => render(s.inspector, label),
    pauseInspectorScript: s.pause, cancelInspectorScript: s.cancel,
    createEditorOpenScript: (label, target, index, comment) => render(s.editorOpen, { label, target, index, comment }),
    createEditorCloseScript: () => s.editorClose,
    createEditorStatusScript: message => render(s.editorStatus, message),
    editorEvent: label => a.editorEventPrefix + label,
    editorOpenedEvent: label => a.editorOpenedEventPrefix + label,
    markerClickEvent: label => a.markerEventPrefix + label,
    createMarkerScript: (label, expectedUrl, notes: readonly BrowserAnnotationNote[]) => render(s.markers, {
      label, expectedUrl, notes: notes.map((note, index) => ({
        index, path: note.element.path, ...(note.element.textRange ? { textRange: note.element.textRange } : {}),
        sourceUrl: note.element.sourceUrl, comment: note.comment,
      })),
    }),
    createCleanupScript: () => s.cleanup,
    draftKey: (sessionId, url) => 'openbitfun:' + manifest.id + ':draft:v1:' + encodeURIComponent(sessionId) + ':' + encodeURIComponent(url),
    readDraft: readControlGuiDraft, saveDraft: saveControlGuiDraft, makeNote: makeControlGuiNote,
    assertPageMatches: assertControlGuiPageMatches, formatPrompt: formatControlGuiPrompt,
  };
  return { manifest, annotation: contribution };
}
