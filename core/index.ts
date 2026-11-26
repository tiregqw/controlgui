import type { BrowserExtension } from './contracts.ts';
import manifest from './manifest.json' with { type: 'json' };
import {
  CONTROLGUI_MAX_NOTES, controlGuiDraftKey, readControlGuiDraft,
  saveControlGuiDraft, makeControlGuiNote, assertControlGuiPageMatches,
  formatControlGuiPrompt,
} from './controlGuiAnnotations.ts';
import {
  controlGuiEditorEvent, createControlGuiEditorOpenScript,
  controlGuiEditorOpenedEvent,
  createControlGuiEditorCloseScript, createControlGuiEditorStatusScript,
} from './controlGuiFloatingEditor.ts';
import { controlGuiMarkerClickEvent, createControlGuiMarkerScript } from './controlGuiMarkers.ts';
import {
  createInspectorScript, CANCEL_INSPECTOR_SCRIPT, PAUSE_INSPECTOR_SCRIPT,
} from './controlGuiInspector.ts';

const extension: BrowserExtension = {
  manifest: {
    ...manifest,
    target: 'browser-webview',
  },
  annotation: {
    label: '批注',
    activeLabel: '退出批注',
    maxNotes: CONTROLGUI_MAX_NOTES,
    createInspectorScript: (label) => createInspectorScript(label, true),
    pauseInspectorScript: PAUSE_INSPECTOR_SCRIPT,
    cancelInspectorScript: CANCEL_INSPECTOR_SCRIPT,
    createEditorOpenScript: createControlGuiEditorOpenScript,
    createEditorCloseScript: createControlGuiEditorCloseScript,
    createEditorStatusScript: createControlGuiEditorStatusScript,
    editorEvent: controlGuiEditorEvent,
    editorOpenedEvent: controlGuiEditorOpenedEvent,
    markerClickEvent: controlGuiMarkerClickEvent,
    createMarkerScript: createControlGuiMarkerScript,
    // Disabling removes all page-owned UI without deleting saved drafts.
    createCleanupScript: () => [
      'if (window.__openbitfun_inspector_cancel && window.__openbitfun_inspector_annotation_mode) window.__openbitfun_inspector_cancel(false);',
      'window.__openbitfunControlGuiFloatingEditor?.close?.();',
      'window.__openbitfunControlGuiPins?.dispose?.();',
    ].join('\n'),
    draftKey: controlGuiDraftKey,
    readDraft: readControlGuiDraft,
    saveDraft: saveControlGuiDraft,
    makeNote: makeControlGuiNote,
    assertPageMatches: assertControlGuiPageMatches,
    formatPrompt: formatControlGuiPrompt,
  },
};

export default extension;
