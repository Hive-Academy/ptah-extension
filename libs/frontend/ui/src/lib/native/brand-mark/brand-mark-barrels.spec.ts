/**
 * R7 barrel guard (TASK_2026_533 Batch 24a).
 *
 * esbuild follows EVERY import of a barrel it keeps, not only the symbols a
 * consumer uses. When the monogram tile and the slug resolvers were exported
 * through `./brand-mark/index.ts`, one eager import of either put
 * `brand-mark.component.ts` and the whole vendored table
 * (`brand-marks.vendored.ts`) in the initial chunk. These source-level pins
 * keep the artwork-free barrels, and the files behind them, away from the
 * table, and keep the artwork barrel down to the one component that needs it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const nativeDir = join(__dirname, '..');
const read = (...parts: string[]): string =>
  readFileSync(join(nativeDir, ...parts), 'utf8');

/** The code of a file, without comments (doc comments show usage examples). */
const code = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** Every module specifier a file imports or re-exports from. */
const specifiers = (source: string): string[] =>
  [...code(source).matchAll(/\bfrom '([^']+)'/g)].map((match) => match[1]);

/** Value (non-type) re-exports of a barrel: `export { A, B } from '…'`. */
const valueExports = (source: string): string[] =>
  [...code(source).matchAll(/^export \{([^}]*)\} from '[^']+';$/gm)].flatMap(
    (match) =>
      match[1]
        .split(',')
        .map((name) => name.trim())
        .filter((name) => name.length > 0),
  );

/** The artwork component, its table, or the artwork barrel itself. */
const ARTWORK = /brand-mark\.component|brand-marks\.vendored|(^|\/)brand-mark$/;

describe('brand-mark barrels (R7)', () => {
  it('keeps the artwork barrel down to BrandMarkComponent', () => {
    expect(valueExports(read('brand-mark', 'index.ts'))).toEqual([
      'BrandMarkComponent',
    ]);
  });

  it.each([
    ['monogram-tile', 'index.ts'],
    ['mark-svg', 'index.ts'],
    ['brand-slugs', 'index.ts'],
    ['brand-mark', 'monogram-tile.component.ts'],
    ['brand-mark', 'mark-svg.component.ts'],
    ['brand-mark', 'mark-artwork.ts'],
    ['brand-mark', 'brand-slugs.ts'],
  ])('%s/%s never imports the brand mark or its artwork table', (...path) => {
    const imported = specifiers(read(...path));
    expect(imported.filter((specifier) => ARTWORK.test(specifier))).toEqual([]);
  });

  it('exposes the brand mark to eager hosts only through its own entry point', () => {
    const entry = readFileSync(
      join(__dirname, '..', '..', '..', 'brand-mark.ts'),
      'utf8',
    );
    expect(valueExports(entry)).toEqual(['BrandMarkComponent']);
    expect(specifiers(entry)).toEqual([
      './lib/native/brand-mark/brand-mark.component',
    ]);
  });

  // The load-bearing rule: esbuild never emits a star-only barrel, so these
  // umbrellas do not carry reachability. One concrete export (a named
  // re-export, a const, an import) would keep the file and pull every barrel
  // it lists, `./brand-mark` and the artwork table included, onto the eager
  // path.
  it.each([
    ['src/index.ts', join(__dirname, '..', '..', '..', 'index.ts')],
    ['src/lib/native/index.ts', join(nativeDir, 'index.ts')],
  ])(
    'keeps the umbrella barrel %s a pure list of `export *` lines',
    (_, path) => {
      const lines = code(readFileSync(path, 'utf8'))
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      expect(lines.length).toBeGreaterThan(0);
      expect(
        lines.filter((line) => !/^export \* from '\.[^']*';$/.test(line)),
      ).toEqual([]);
    },
  );
});
