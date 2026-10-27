/**
 * Pins the source shape that keeps the no-workspace welcome out of the
 * webview's initial bundle (TASK_2026_721). electron-shell is eager (app.ts
 * imports it), so the welcome loads only through its `@defer` block. That
 * split holds only while:
 *
 *   - electron-shell is the one file that imports `electron-welcome.component`,
 *     and uses the tag only inside `@defer`;
 *   - the chat barrels never re-export the welcome or its welcome-only modules
 *     (a static re-export puts the file back on the eager path);
 *   - the welcome-only modules are imported only from inside that set;
 *   - the welcome's chat-ui molecules come from `@ptah-extension/chat-ui/vitals`,
 *     which the main chat-ui barrel does not re-export at runtime.
 *
 * The production build budget is the real proof; this keeps a refactor from
 * silently undoing the split.
 */
import { readFileSync } from 'node:fs';
import {
  sourceFiles,
  specifiersOf,
  withoutComments,
} from '../testing/lazy-boundary.helpers';
import { basename, join } from 'node:path';

const CHAT_SRC = join(__dirname, '..', '..', '..');
const CHAT_UI_SRC = join(CHAT_SRC, '..', '..', 'chat-ui', 'src');

/** Welcome-only modules of the chat lib (file base names, no extension). */
const WELCOME_ONLY = [
  'electron-welcome.component',
  'welcome-vitals.store',
  'welcome-vitals.view',
  'recent-workspaces.store',
  'host-inventory.cache',
];

const files = sourceFiles(CHAT_SRC).map((path) => ({
  path,
  name: basename(path, '.ts'),
  source: readFileSync(path, 'utf8'),
}));

function importersOf(moduleName: string): string[] {
  return files
    .filter(({ source }) =>
      specifiersOf(source).some((specifier) =>
        specifier.endsWith(`/${moduleName}`),
      ),
    )
    .map(({ name }) => name);
}

describe('the Electron welcome stays in a lazy chunk', () => {
  it('scans the chat library', () => {
    expect(files.length).toBeGreaterThan(50);
    for (const name of WELCOME_ONLY) {
      expect(files.some((file) => file.name === name)).toBe(true);
    }
  });

  it('imports the welcome component only from electron-shell', () => {
    expect(importersOf('electron-welcome.component')).toEqual([
      'electron-shell.component',
    ]);
  });

  it('renders <ptah-electron-welcome> in electron-shell only inside @defer', () => {
    const shell = files.find(({ name }) => name === 'electron-shell.component');
    const source = withoutComments(shell?.source ?? '');
    const tag = source.indexOf('<ptah-electron-welcome');
    expect(tag).toBeGreaterThan(-1);
    expect(source.indexOf('<ptah-electron-welcome', tag + 1)).toBe(-1);
    const deferOpen = source.lastIndexOf('@defer', tag);
    expect(deferOpen).toBeGreaterThan(-1);
    // Only the block header (any trigger list) sits between `@defer` and the tag.
    expect(source.slice(deferOpen, tag).trim()).toMatch(
      /^@defer\s*(\([^)]*\))?\s*\{$/,
    );
    // The class name appears only in its import and the `imports` array.
    expect(source.match(/\bElectronWelcomeComponent\b/g)).toHaveLength(2);
  });

  it('imports welcome-only modules only from inside the welcome set', () => {
    for (const name of WELCOME_ONLY.filter(
      (module) => module !== 'electron-welcome.component',
    )) {
      const outside = importersOf(name).filter(
        (importer) => !WELCOME_ONLY.includes(importer),
      );
      expect({ module: name, outside }).toEqual({ module: name, outside: [] });
    }
  });

  it('never re-exports welcome-only modules from a barrel', () => {
    const barrels = files.filter(({ name }) => name === 'index');
    for (const { path, source } of barrels) {
      const leaked = specifiersOf(source).filter((specifier) =>
        WELCOME_ONLY.some((name) => specifier.endsWith(`/${name}`)),
      );
      expect({ path, leaked }).toEqual({ path, leaked: [] });
    }
  });

  it('keeps the welcome molecules out of the main chat-ui barrel at runtime', () => {
    const vitalsBarrel = readFileSync(
      join(CHAT_UI_SRC, 'lib', 'molecules', 'vitals', 'index.ts'),
      'utf8',
    );
    for (const runtime of [
      'PlanRingComponent',
      'planRingCaption',
      'SpendBarsComponent',
      'StatRowComponent',
      'StatCellComponent',
      'StatValueComponent',
      'RecentWorkspaceListComponent',
    ]) {
      expect(vitalsBarrel).not.toMatch(new RegExp(`\\b${runtime}\\b`));
    }
    const welcome = files.find(
      ({ name }) => name === 'electron-welcome.component',
    );
    expect(specifiersOf(welcome?.source ?? '')).toContain(
      '@ptah-extension/chat-ui/vitals',
    );
  });
});
