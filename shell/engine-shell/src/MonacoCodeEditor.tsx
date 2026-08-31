import { useEffect, useRef } from 'react';

export const MONACO_LOADER_SRC = '/web/vendor/monaco/vs/loader.js';
export const MONACO_VS_PATH = '/web/vendor/monaco/vs';
export const MONACO_EDITOR_CSS_HREF = '/web/vendor/monaco/vs/editor/editor.main.css';

type MonacoRange = {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
};

type MonacoTextModel = {
  uri: { toString: () => string };
  isDisposed: () => boolean;
  getValue: () => string;
  setValue: (value: string) => void;
  getLineCount: () => number;
  getLanguageId?: () => string;
  findMatches: (
    searchString: string,
    searchOnlyEditableRange: boolean,
    isRegex: boolean,
    matchCase: boolean,
    wordSeparators: string | null,
    captureMatches: boolean,
  ) => Array<{ range: MonacoRange }>;
  dispose: () => void;
};

type MonacoDisposable = { dispose: () => void };

type MonacoStandaloneEditor = {
  dispose: () => void;
  getModel: () => MonacoTextModel | null;
  setModel: (model: MonacoTextModel | null) => void;
  saveViewState: () => unknown;
  restoreViewState: (state: unknown) => void;
  layout: () => void;
  focus: () => void;
  getPosition: () => { lineNumber: number; column: number } | null;
  setSelection: (range: MonacoRange) => void;
  revealRangeInCenter: (range: MonacoRange) => void;
  revealRangeNearTop?: (range: MonacoRange) => void;
  deltaDecorations: (oldDecorations: string[], newDecorations: unknown[]) => string[];
  onDidChangeModelContent: (listener: () => void) => MonacoDisposable;
  onDidChangeCursorPosition: (listener: () => void) => MonacoDisposable;
};

type MonacoDiffEditor = {
  dispose: () => void;
  layout: () => void;
  getModel: () => { original: MonacoTextModel | null; modified: MonacoTextModel | null } | null;
  setModel: (model: { original: MonacoTextModel; modified: MonacoTextModel } | null) => void;
  getModifiedEditor: () => MonacoStandaloneEditor;
  getOriginalEditor: () => MonacoStandaloneEditor;
};

type MonacoNamespace = {
  editor: {
    create: (element: HTMLElement, options: Record<string, unknown>) => MonacoStandaloneEditor;
    createDiffEditor: (element: HTMLElement, options: Record<string, unknown>) => MonacoDiffEditor;
    createModel: (value: string, language?: string, uri?: unknown) => MonacoTextModel;
    getModel: (uri: unknown) => MonacoTextModel | null;
    setTheme: (theme: string) => void;
    TrackedRangeStickiness: { NeverGrowsWhenTypingAtEdges: number };
  };
  Uri: {
    parse: (value: string) => unknown;
    file: (value: string) => unknown;
  };
};

type AmdRequire = {
  (modules: string[], callback: () => void, errback?: (error: unknown) => void): void;
  config: (options: { paths: Record<string, string> }) => void;
};

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  jsonc: 'json',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  htm: 'html',
  xml: 'xml',
  svg: 'xml',
  md: 'markdown',
  markdown: 'markdown',
  yml: 'yaml',
  yaml: 'yaml',
  py: 'python',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  go: 'go',
  rs: 'rust',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  java: 'java',
  rb: 'ruby',
  php: 'php',
  sql: 'sql',
  toml: 'ini',
  ini: 'ini',
  ps1: 'powershell',
  psm1: 'powershell',
  bat: 'bat',
  cmd: 'bat',
  lua: 'lua',
  kt: 'kotlin',
  swift: 'swift',
  proto: 'protobuf',
};

let monacoLoadPromise: Promise<MonacoNamespace> | null = null;

function getMonaco(): MonacoNamespace | undefined {
  return (window as Window & { monaco?: MonacoNamespace }).monaco;
}

function getAmdRequire(): AmdRequire | undefined {
  return (window as Window & { require?: AmdRequire }).require;
}

function ensureMonacoCss() {
  if (document.getElementById('sf-monaco-editor-css')) {
    return;
  }
  const link = document.createElement('link');
  link.id = 'sf-monaco-editor-css';
  link.rel = 'stylesheet';
  link.href = MONACO_EDITOR_CSS_HREF;
  document.head.appendChild(link);
}

export function inferMonacoLanguage(filePath: string) {
  const name = String(filePath || '').split(/[\\/]/).pop()?.toLowerCase() || '';
  if (!name) {
    return 'plaintext';
  }
  if (name === 'dockerfile') {
    return 'dockerfile';
  }
  if (name === 'makefile' || name === 'gnumakefile') {
    return 'makefile';
  }
  if (name === '.gitignore' || name === '.dockerignore') {
    return 'ignore';
  }
  const extension = name.includes('.') ? name.split('.').pop() || '' : '';
  return LANGUAGE_BY_EXTENSION[extension] || 'plaintext';
}

export function loadMonaco() {
  if (monacoLoadPromise) {
    return monacoLoadPromise;
  }

  monacoLoadPromise = new Promise((resolve, reject) => {
    const existing = getMonaco();
    if (existing) {
      ensureMonacoCss();
      resolve(existing);
      return;
    }

    const configureAndLoad = () => {
      const amdRequire = getAmdRequire();
      if (!amdRequire) {
        reject(new Error('Monaco AMD loader did not initialize window.require.'));
        return;
      }
      ensureMonacoCss();
      amdRequire.config({ paths: { vs: MONACO_VS_PATH } });
      amdRequire(['vs/editor/editor.main'], () => {
        const monaco = getMonaco();
        if (!monaco) {
          reject(new Error('Monaco editor.main loaded without window.monaco.'));
          return;
        }
        monaco.editor.setTheme('vs-dark');
        resolve(monaco);
      }, reject);
    };

    if (getAmdRequire()) {
      configureAndLoad();
      return;
    }

    const script = document.createElement('script');
    script.src = MONACO_LOADER_SRC;
    script.async = true;
    script.onload = configureAndLoad;
    script.onerror = () => reject(new Error('Failed to load Monaco loader from web/vendor/monaco/vs/loader.js'));
    document.head.appendChild(script);
  });

  return monacoLoadPromise;
}

function modelUri(monaco: MonacoNamespace, tabId: string, kind: 'draft' | 'baseline') {
  return monaco.Uri.parse(`inmemory://sf-code/${encodeURIComponent(tabId)}/${kind}`);
}

function editorOptions(readOnly: boolean): Record<string, unknown> {
  return {
    theme: 'vs-dark',
    fontSize: 13,
    fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Consolas', monospace",
    automaticLayout: true,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    wordWrap: 'off',
    lineNumbers: 'on',
    folding: true,
    renderWhitespace: 'selection',
    readOnly,
    tabSize: 2,
    insertSpaces: true,
    padding: { top: 8 },
    scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
    quickSuggestions: false,
    suggestOnTriggerCharacters: false,
    parameterHints: { enabled: false },
    hover: { enabled: false },
    inlayHints: { enabled: 'off' },
    lightbulb: { enabled: false },
    occurrencesHighlight: false,
    selectionHighlight: true,
  };
}

export function MonacoCodeEditor({
  tabId,
  path,
  draft,
  baseline,
  showDiff,
  searchQuery,
  searchIndex,
  retainedTabIds,
  readOnly = false,
  onDraftChange,
  onCursorChange,
  onSearchMatches,
}: {
  tabId: string;
  path: string;
  draft: string;
  baseline: string;
  showDiff: boolean;
  searchQuery: string;
  searchIndex: number;
  retainedTabIds: string[];
  readOnly?: boolean;
  onDraftChange: (value: string) => void;
  onCursorChange: (line: number, column: number, lineCount: number) => void;
  onSearchMatches: (count: number) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<MonacoStandaloneEditor | null>(null);
  const diffEditorRef = useRef<MonacoDiffEditor | null>(null);
  const modelsRef = useRef(new Map<string, { draft: MonacoTextModel; baseline: MonacoTextModel; viewState: unknown }>());
  const decorationsRef = useRef<string[]>([]);
  const draftRef = useRef(draft);
  const onDraftChangeRef = useRef(onDraftChange);
  const onCursorChangeRef = useRef(onCursorChange);
  const onSearchMatchesRef = useRef(onSearchMatches);
  const searchQueryRef = useRef(searchQuery);
  const searchIndexRef = useRef(searchIndex);
  draftRef.current = draft;
  onDraftChangeRef.current = onDraftChange;
  onCursorChangeRef.current = onCursorChange;
  onSearchMatchesRef.current = onSearchMatches;
  searchQueryRef.current = searchQuery;
  searchIndexRef.current = searchIndex;

  function activeTextEditor() {
    return diffEditorRef.current?.getModifiedEditor() || editorRef.current;
  }

  function getOrCreateModels(monaco: MonacoNamespace, nextTabId: string, nextPath: string) {
    const existing = modelsRef.current.get(nextTabId);
    if (existing && !existing.draft.isDisposed() && !existing.baseline.isDisposed()) {
      return existing;
    }
    const language = inferMonacoLanguage(nextPath);
    const draftModel = monaco.editor.getModel(modelUri(monaco, nextTabId, 'draft'))
      || monaco.editor.createModel(draftRef.current, language, modelUri(monaco, nextTabId, 'draft'));
    const baselineModel = monaco.editor.getModel(modelUri(monaco, nextTabId, 'baseline'))
      || monaco.editor.createModel(baseline, language, modelUri(monaco, nextTabId, 'baseline'));
    const record = { draft: draftModel, baseline: baselineModel, viewState: null as unknown };
    modelsRef.current.set(nextTabId, record);
    return record;
  }

  function disposeUnusedModels(retained: string[]) {
    const retainedSet = new Set(retained);
    for (const [id, record] of modelsRef.current) {
      if (retainedSet.has(id)) {
        continue;
      }
      if (!record.draft.isDisposed()) {
        record.draft.dispose();
      }
      if (!record.baseline.isDisposed()) {
        record.baseline.dispose();
      }
      modelsRef.current.delete(id);
    }
  }

  function applySearch(monaco: MonacoNamespace, editor: MonacoStandaloneEditor | null, query: string, index: number) {
    if (!editor) {
      onSearchMatchesRef.current(0);
      return;
    }
    const model = editor.getModel();
    if (!model || !query) {
      decorationsRef.current = editor.deltaDecorations(decorationsRef.current, []);
      onSearchMatchesRef.current(0);
      return;
    }
    const matches = model.findMatches(query, false, false, false, null, false);
    onSearchMatchesRef.current(matches.length);
    const current = matches.length && index >= 0 ? index % matches.length : -1;
    decorationsRef.current = editor.deltaDecorations(
      decorationsRef.current,
      matches.map((match, matchIndex) => ({
        range: match.range,
        options: {
          inlineClassName: matchIndex === current ? 'code-editor-search-match is-current' : 'code-editor-search-match',
          stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        },
      })),
    );
    if (current >= 0) {
      const range = matches[current].range;
      editor.setSelection(range);
      if (typeof editor.revealRangeNearTop === 'function') {
        editor.revealRangeNearTop(range);
      } else {
        editor.revealRangeInCenter(range);
      }
    }
  }

  useEffect(() => {
    let cancelled = false;
    let contentListener: MonacoDisposable | null = null;
    let cursorListener: MonacoDisposable | null = null;
    const host = hostRef.current;

    void loadMonaco().then((monaco) => {
      if (cancelled || !host) {
        return;
      }

      const previousEditor = activeTextEditor();
      const previousTabId = host.dataset.activeTabId;
      if (previousEditor && previousTabId) {
        const previous = modelsRef.current.get(previousTabId);
        if (previous) {
          previous.viewState = previousEditor.saveViewState();
        }
      }

      editorRef.current?.dispose();
      editorRef.current = null;
      if (diffEditorRef.current) {
        diffEditorRef.current.dispose();
        diffEditorRef.current = null;
      }
      host.replaceChildren();

      const models = getOrCreateModels(monaco, tabId, path);
      if (models.draft.getValue() !== draftRef.current) {
        models.draft.setValue(draftRef.current);
      }
      if (models.baseline.getValue() !== baseline) {
        models.baseline.setValue(baseline);
      }

      let textEditor: MonacoStandaloneEditor;
      if (showDiff) {
        const diffEditor = monaco.editor.createDiffEditor(host, {
          ...editorOptions(readOnly),
          originalEditable: false,
          renderSideBySide: true,
          enableSplitViewResizing: true,
          readOnly,
        });
        diffEditor.setModel({ original: models.baseline, modified: models.draft });
        diffEditorRef.current = diffEditor;
        textEditor = diffEditor.getModifiedEditor();
      } else {
        textEditor = monaco.editor.create(host, {
          ...editorOptions(readOnly),
          model: models.draft,
        });
        editorRef.current = textEditor;
      }

      host.dataset.activeTabId = tabId;
      if (models.viewState) {
        textEditor.restoreViewState(models.viewState);
      }

      contentListener = textEditor.onDidChangeModelContent(() => {
        const next = textEditor.getModel()?.getValue() ?? '';
        if (next !== draftRef.current) {
          onDraftChangeRef.current(next);
        }
        const position = textEditor.getPosition();
        onCursorChangeRef.current(
          position?.lineNumber || 1,
          position?.column || 1,
          textEditor.getModel()?.getLineCount() || 1,
        );
        applySearch(monaco, textEditor, searchQueryRef.current, searchIndexRef.current);
      });
      cursorListener = textEditor.onDidChangeCursorPosition(() => {
        const position = textEditor.getPosition();
        onCursorChangeRef.current(
          position?.lineNumber || 1,
          position?.column || 1,
          textEditor.getModel()?.getLineCount() || 1,
        );
      });
      const position = textEditor.getPosition();
      onCursorChangeRef.current(
        position?.lineNumber || 1,
        position?.column || 1,
        textEditor.getModel()?.getLineCount() || 1,
      );
      applySearch(monaco, textEditor, searchQueryRef.current, searchIndexRef.current);
    }).catch((error: unknown) => {
      if (cancelled || !host) {
        return;
      }
      host.textContent = error instanceof Error ? error.message : String(error);
    });

    return () => {
      cancelled = true;
      contentListener?.dispose();
      cursorListener?.dispose();
      const editor = activeTextEditor();
      const activeId = hostRef.current?.dataset.activeTabId;
      if (editor && activeId) {
        const record = modelsRef.current.get(activeId);
        if (record) {
          record.viewState = editor.saveViewState();
        }
      }
      editorRef.current?.dispose();
      editorRef.current = null;
      diffEditorRef.current?.dispose();
      diffEditorRef.current = null;
    };
  }, [tabId, path, showDiff, readOnly]);

  useEffect(() => {
    const record = modelsRef.current.get(tabId);
    if (!record || record.draft.isDisposed()) {
      return;
    }
    if (record.draft.getValue() !== draft) {
      record.draft.setValue(draft);
    }
  }, [draft, tabId]);

  useEffect(() => {
    const record = modelsRef.current.get(tabId);
    if (!record || record.baseline.isDisposed()) {
      return;
    }
    if (record.baseline.getValue() !== baseline) {
      record.baseline.setValue(baseline);
    }
  }, [baseline, tabId]);

  useEffect(() => {
    disposeUnusedModels(retainedTabIds);
  }, [retainedTabIds]);

  useEffect(() => {
    const monaco = getMonaco();
    if (!monaco) {
      return;
    }
    applySearch(monaco, activeTextEditor(), searchQuery, searchIndex);
  }, [searchQuery, searchIndex, tabId, showDiff]);

  useEffect(() => () => {
    disposeUnusedModels([]);
  }, []);

  return (
    <div
      aria-label={`Monaco editor for ${path}`}
      className="code-workspace__monaco"
      data-monaco-editor
      ref={hostRef}
    />
  );
}
