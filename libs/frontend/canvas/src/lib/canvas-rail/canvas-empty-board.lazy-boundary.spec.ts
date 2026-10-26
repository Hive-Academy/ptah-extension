/**
 * Pins the source shape that keeps the canvas zero-sessions hero out of the
 * webview's initial bundle (TASK_2026_721). The canvas lib is eager
 * (app.config.ts imports OrchestraCanvasComponent), so the hero loads only
 * through the rail board's `@defer` block. That split holds only while:
 *
 *   - canvas-rail-board is the one file that imports the hero component, and
 *     uses its tag only inside `@defer`;
 *   - the canvas barrel never re-exports the hero or its view mapping;
 *   - the hero's view mapping is imported only by the hero;
 *   - the hero's stat molecules come from `@ptah-extension/chat-ui/vitals`.
 *
 * The production build budget is the real proof; this keeps a refactor from
 * silently undoing the split.
 *
 * Source of the local helper copies:
 * libs/frontend/chat/src/lib/components/testing/lazy-boundary.helpers.ts
 * (`sourceFiles`, `specifiersOf`, `withoutComments`). Keep fixes in sync.
 * Nx module boundaries prevent importing that private chat testing file here.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const CANVAS_SRC = join(__dirname, '..', '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')
      ? [path]
      : [];
  });
}

/** Specifiers of the runtime import/export-from declarations (type-only ones emit nothing). */
function specifiersOf(source: string): string[] {
  return [
    ...source.matchAll(
      /^\s*(import|export)\s+(type\s+)?[^;]*?\s+from\s+['"]([^'"]+)['"]/gm,
    ),
  ]
    .filter((match) => match[2] === undefined)
    .map((match) => match[3]);
}

/** `source` without HTML, block and line comments. */
function withoutComments(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const HERO = 'canvas-empty-board.component';
const HERO_VIEW = 'canvas-empty-board.view';

const files = sourceFiles(CANVAS_SRC).map((path) => ({
  path,
  name: basename(path, '.ts'),
  source: readFileSync(path, 'utf8'),
}));

function importersOf(moduleName: string): string[] {
  return files
    .filter(({ source }) =>
      specifiersOf(source).some((specifier) => specifier.endsWith(`/${moduleName}`)),
    )
    .map(({ name }) => name);
}

describe('the canvas zero-sessions hero stays in a lazy chunk', () => {
  it('scans the canvas library', () => {
    expect(files.length).toBeGreaterThan(20);
    expect(files.some(({ name }) => name === HERO)).toBe(true);
    expect(files.some(({ name }) => name === HERO_VIEW)).toBe(true);
  });

  it('imports the hero only from the rail board', () => {
    expect(importersOf(HERO)).toEqual(['canvas-rail-board.component']);
  });

  it('imports the hero view mapping only from the hero', () => {
    expect(importersOf(HERO_VIEW)).toEqual([HERO]);
  });

  it('renders <ptah-canvas-empty-board> only inside @defer', () => {
    const board = files.find(({ name }) => name === 'canvas-rail-board.component');
    const source = withoutComments(board?.source ?? '');
    const tag = source.indexOf('<ptah-canvas-empty-board');
    expect(tag).toBeGreaterThan(-1);
    expect(source.indexOf('<ptah-canvas-empty-board', tag + 1)).toBe(-1);
    const deferOpen = source.lastIndexOf('@defer', tag);
    expect(deferOpen).toBeGreaterThan(-1);
    expect(source.slice(deferOpen, tag).trim()).toMatch(/^@defer\s*(\([^)]*\))?\s*\{$/);
    // The class name appears only in its import and the `imports` array.
    expect(source.match(/\bCanvasEmptyBoardComponent\b/g)).toHaveLength(2);
  });

  it('never re-exports the hero from a barrel', () => {
    for (const { path, source } of files.filter(({ name }) => name === 'index')) {
      const leaked = specifiersOf(source).filter(
        (specifier) => specifier.endsWith(`/${HERO}`) || specifier.endsWith(`/${HERO_VIEW}`),
      );
      expect({ path, leaked }).toEqual({ path, leaked: [] });
    }
  });

  it('takes the stat molecules from the lazy vitals entry point', () => {
    const hero = files.find(({ name }) => name === HERO);
    expect(specifiersOf(hero?.source ?? '')).toContain('@ptah-extension/chat-ui/vitals');
  });
});
