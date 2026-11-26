import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CONTROLGUI_MAX_COMMENT, assertControlGuiPageMatches, controlGuiDraftKey, formatControlGuiPrompt,
  makeControlGuiNote, readControlGuiDraft, saveControlGuiDraft,
} from './controlGuiAnnotations.ts';

const element = {
  tagName: 'BUTTON', path: '#save', textContent: '保存',
  outerHTML: '<button id="save">保存</button>', sourceUrl: 'http://127.0.0.1:5173/',
};

describe('BitFun ControlGUI annotations', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses the real page URL rather than an optimistic address bar when annotating', () => {
    expect(() => assertControlGuiPageMatches('http://localhost:5173', 'http://localhost:5173/')).not.toThrow();
    expect(() => assertControlGuiPageMatches('https://example.com/page#section', 'https://example.com/page#other')).not.toThrow();
    expect(() => assertControlGuiPageMatches('http://localhost:5173', 'https://openbitfun.com')).toThrow('不一致');
    expect(() => assertControlGuiPageMatches('http://localhost:5173', '')).toThrow('不一致');
  });

  it('validates and bounds an element selection', () => {
    expect(makeControlGuiNote(element, 'a')).toBeNull();
    expect(makeControlGuiNote({ ...element, tagName: 'invalid<script>' }, '修改按钮')).toBeNull();
    const note = makeControlGuiNote(element, 'x'.repeat(4000));
    expect(note?.comment).toHaveLength(CONTROLGUI_MAX_COMMENT);
    expect(note?.element.path).toBe('#save');
  });

  it('builds a source-location prompt without treating DOM as instructions', () => {
    const note = makeControlGuiNote(element, '让按钮变成绿色');
    expect(note).not.toBeNull();
    const prompt = formatControlGuiPrompt([note!], element.sourceUrl);
    expect(prompt).toContain('让按钮变成绿色');
    expect(prompt).toContain('#save');
    expect(prompt).toContain('不可信');
  });

  it('saves, restores and clears only the scoped draft', () => {
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => { data.set(key, value); },
      removeItem: (key: string) => { data.delete(key); },
    });
    const one = controlGuiDraftKey('s1', element.sourceUrl);
    const other = controlGuiDraftKey('s2', element.sourceUrl);
    const note = makeControlGuiNote(element, '修改按钮')!;
    saveControlGuiDraft(one, [note]);
    expect(readControlGuiDraft(one)).toEqual([note]);
    expect(readControlGuiDraft(other)).toEqual([]);
    saveControlGuiDraft(one, []);
    expect(readControlGuiDraft(one)).toEqual([]);
  });

  it('rejects malformed persisted notes and empty sends', () => {
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify([{ element: element, comment: '' }]) });
    expect(readControlGuiDraft('bad')).toEqual([]);
    expect(() => formatControlGuiPrompt([], element.sourceUrl)).toThrow();
  });

  it('preserves two independent text fragments sharing one breadcrumb selector', () => {
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => { data.set(key, value); },
      removeItem: (key: string) => { data.delete(key); },
    });
    const left = makeControlGuiNote({
      ...element, tagName: 'span', path: 'span#breadcrumb',
      textContent: '工作空间', textRange: { nodeIndex: 0, text: '工作空间' },
    }, '修改左边文字')!;
    const right = makeControlGuiNote({
      ...element, tagName: 'span', path: 'span#breadcrumb',
      textContent: '开发工作台', textRange: { nodeIndex: 2, text: '开发工作台' },
    }, '修改右边文字')!;
    expect(left.element.path).toBe(right.element.path);
    expect(left.element.textRange).not.toEqual(right.element.textRange);
    const key = controlGuiDraftKey('breadcrumb', element.sourceUrl);
    saveControlGuiDraft(key, [left, right]);
    expect(readControlGuiDraft(key)).toEqual([left, right]);
    const prompt = formatControlGuiPrompt([left, right], element.sourceUrl);
    expect(prompt).toContain('文本节点位置（父元素 childNodes）：0');
    expect(prompt).toContain('文本节点位置（父元素 childNodes）：2');
    expect(makeControlGuiNote({ ...left.element, textRange: { nodeIndex: -1, text: '工作空间' } }, '修改左边')).toBeNull();
    expect(makeControlGuiNote({ ...right.element, textRange: { nodeIndex: 2, text: '' } }, '修改右边')).toBeNull();
  });
});
