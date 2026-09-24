/**
 * Dependency-boundary pins for `@ptah-extension/chat-ui` (R7, TASK_2026_533
 * Batch 24a). Same shape as `libs/frontend/ui/src/lib/dependency-boundaries.spec.ts`:
 * concrete, reviewable facts about which modules this lib may import.
 *
 * WHAT THIS IS FOR. chat-ui is on the webview's initial path: the dashboard
 * skill picker and the chat views import it statically. Its source must
 * therefore never reach the vendored logo table, which only
 * `BrandMarkComponent` imports:
 *
 *   - no import of `BrandMarkComponent` from the main `@ptah-extension/ui`
 *     barrel (that would make the brand-mark module a static dependency);
 *   - no import of the artwork modules themselves;
 *   - a file that shows a vendor mark imports it from
 *     `@ptah-extension/ui/brand-mark`, in a declaration of its own, and renders
 *     `<ptah-brand-mark>` only inside `@defer`, so the compiler emits a
 *     dynamic import and the table stays in a lazy chunk.
 *
 * WHY A SPEC WHEN LINT EXISTS. The Nx boundary rule sees `chat-ui → ui` as one
 * allowed edge; it cannot tell which ui entry point, or whether a use sits
 * inside `@defer`. The production build plus the R7 probe is the real proof;
 * this pins the source shape that makes it pass.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')
      ? [path]
      : [];
  });
}

const files = sourceFiles(join(__dirname, '..')).map((path) => ({
  path,
  source: readFileSync(path, 'utf8'),
}));

/** One import declaration, parsed loosely enough to survive reformatting. */
interface ImportDeclaration {
  /** Imported binding names (`type` modifiers and aliases stripped). */
  readonly names: readonly string[];
  /** The module specifier, whatever quote style it used. */
  readonly specifier: string;
}

// Bindings stop at `;`, so a side-effect import (`import 'x';`) is never read
// as the head of the declaration after it.
const IMPORT_DECLARATION =
  /^\s*import\s+(?:type\s+)?([^;]*?)\s+from\s+['"]([^'"]+)['"]\s*;?/gm;

function importsOf(source: string): ImportDeclaration[] {
  return [...source.matchAll(IMPORT_DECLARATION)].map((match) => ({
    names: (match[1].match(/\{([\s\S]*)\}/)?.[1] ?? match[1])
      .split(',')
      .map((part) =>
        part
          .trim()
          .replace(/^type\s+/, '')
          .split(/\s+as\s+/)[0]
          .trim(),
      )
      .filter((name) => name.length > 0),
    specifier: match[2],
  }));
}

const BRAND_MARK_ENTRY = '@ptah-extension/ui/brand-mark';

describe('chat-ui keeps the brand artwork out of the initial chunk (R7)', () => {
  it('scans the library', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('never imports BrandMarkComponent from the main ui barrel', () => {
    const offenders = files
      .filter(({ source }) =>
        importsOf(source).some(
          ({ names, specifier }) =>
            specifier === '@ptah-extension/ui' &&
            names.includes('BrandMarkComponent'),
        ),
      )
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it('never imports the artwork modules directly', () => {
    const offenders = files
      .filter(({ source }) =>
        importsOf(source).some(({ specifier }) =>
          /brand-marks\.generated|brand-mark\.component/.test(specifier),
        ),
      )
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it('defers every brand mark it renders, through the brand-mark entry point', () => {
    const renderers = files.filter(({ source }) =>
      source.includes('<ptah-brand-mark'),
    );
    // The MCP Registry browser shows vendor marks for allowlisted listings.
    expect(renderers.map(({ path }) => path.replace(/\\/g, '/'))).toEqual([
      expect.stringMatching(/mcp-directory-browser\.component\.ts$/),
    ]);

    for (const { source } of renderers) {
      // Its own declaration: the compiler defers a dependency only when the
      // whole declaration can be dropped.
      const entryImports = importsOf(source).filter(
        ({ specifier }) => specifier === BRAND_MARK_ENTRY,
      );
      expect(entryImports.map(({ names }) => names)).toEqual([
        ['BrandMarkComponent'],
      ]);

      // The nearest block opener before each mark is a @defer.
      for (const prefix of source.split('<ptah-brand-mark').slice(0, -1)) {
        const lastDefer = prefix.lastIndexOf('@defer');
        const lastOther = Math.max(
          prefix.lastIndexOf('@placeholder'),
          prefix.lastIndexOf('@error'),
          prefix.lastIndexOf('@loading'),
        );
        expect(lastDefer).toBeGreaterThan(lastOther);
      }
    }
  });
});
