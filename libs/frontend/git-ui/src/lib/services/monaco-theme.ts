import type * as monaco from 'monaco-editor';

type MonacoApi = typeof monaco;

/** Resolve the host theme to Monaco's built-in theme identifiers. */
export function detectMonacoTheme(
  doc: Document | undefined = typeof document === 'undefined'
    ? undefined
    : document,
): string {
  if (!doc) return 'vs-dark';
  const root = doc.documentElement;
  const vscodeKind =
    doc.body.getAttribute('data-vscode-theme-kind') ??
    root.getAttribute('data-vscode-theme-kind');
  if (vscodeKind === 'vscode-light') return 'vs';
  if (vscodeKind === 'vscode-high-contrast') return 'hc-black';
  if (vscodeKind === 'vscode-dark') return 'vs-dark';

  const mode =
    root.getAttribute('data-theme-mode') ??
    doc.body.getAttribute('data-theme-mode');
  if (mode === 'light') return 'vs';
  if (mode === 'dark') return 'vs-dark';
  const theme =
    root.getAttribute('data-theme') ?? doc.body.getAttribute('data-theme');
  return theme === 'light' ? 'vs' : 'vs-dark';
}

/** Observe both theme owners and return an idempotent cleanup function. */
export function observeMonacoTheme(
  monacoApi: MonacoApi,
  onChange: (theme: string) => void = (theme) =>
    monacoApi.editor.setTheme(theme),
): () => void {
  if (
    typeof document === 'undefined' ||
    typeof MutationObserver === 'undefined'
  ) {
    return () => undefined;
  }
  const observer = new MutationObserver(() =>
    onChange(detectMonacoTheme(document)),
  );
  const options: MutationObserverInit = {
    attributes: true,
    attributeFilter: [
      'data-vscode-theme-kind',
      'data-theme',
      'data-theme-mode',
    ],
  };
  observer.observe(document.body, options);
  observer.observe(document.documentElement, options);
  return () => observer.disconnect();
}
