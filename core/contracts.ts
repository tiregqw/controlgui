/** Host-owned annotation protocol. No concrete plugin dependencies. */
export interface BrowserAnnotationTextRange {
  /** Index in the parent element's childNodes, not its children collection. */
  readonly nodeIndex: number;
  /** Exact trimmed text; used to reject stale or mislocated DOM anchors. */
  readonly text: string;
}

export interface BrowserAnnotationElement {
  readonly tagName: string;
  readonly path: string;
  readonly textContent: string;
  readonly outerHTML: string;
  readonly sourceUrl: string;
  readonly textRange?: BrowserAnnotationTextRange;
}

export interface BrowserAnnotationNote {
  readonly element: BrowserAnnotationElement;
  readonly comment: string;
}

export interface FloatingEditorTarget {
  readonly path: string;
  readonly tagName: string;
  readonly pageUrl: string;
  readonly textContent?: string;
  readonly textRange?: BrowserAnnotationTextRange;
}

export type FloatingEditorAction = 'save' | 'cancel' | 'delete';
export interface FloatingEditorEvent {
  action: FloatingEditorAction;
  pageUrl: string;
  path: string;
  index: number | null;
  comment?: string;
  textRange?: BrowserAnnotationTextRange;
}

export interface BrowserExtensionManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly target: 'browser-webview';
  readonly defaultEnabled: boolean;
}

export interface BrowserAnnotationContribution {
  readonly label: string;
  readonly activeLabel: string;
  readonly maxNotes: number;
  createInspectorScript(label: string): string;
  readonly pauseInspectorScript: string;
  readonly cancelInspectorScript: string;
  createEditorOpenScript(label: string, target: FloatingEditorTarget, index: number | null, comment: string): string;
  createEditorCloseScript(): string;
  createEditorStatusScript(message: string): string;
  editorEvent(label: string): string;
  editorOpenedEvent(label: string): string;
  markerClickEvent(label: string): string;
  createMarkerScript(label: string, url: string, notes: readonly BrowserAnnotationNote[]): string;
  createCleanupScript(): string;
  draftKey(sessionId: string, url: string): string;
  readDraft(key: string): BrowserAnnotationNote[];
  saveDraft(key: string, notes: readonly BrowserAnnotationNote[]): void;
  makeNote(element: BrowserAnnotationElement, comment: string): BrowserAnnotationNote | null;
  assertPageMatches(expected: string, actual: string): void;
  formatPrompt(notes: readonly BrowserAnnotationNote[], url: string): string;
}

export interface BrowserExtension {
  readonly manifest: BrowserExtensionManifest;
  readonly annotation?: BrowserAnnotationContribution;
}
