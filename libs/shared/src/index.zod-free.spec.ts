/**
 * Guard the plain contract types, not the whole main barrel. A follow-up owns
 * its pre-existing Zod paths through lib/providers/provider-registry.ts,
 * lib/types/origin-sidecar.types.ts and lib/utils/codex-token-freshness.ts.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { preProcessFile } from 'typescript';

/** Follow type imports too: a type-only edge must not hide a zod dependency. */
function zodImports(
  entry: string,
  read: (file: string) => string,
  resolveImport: (file: string, name: string) => string,
): string[] {
  const pending = [entry];
  const visited = new Set<string>();
  const found: string[] = [];
  while (pending.length > 0) {
    const file = pending.pop();
    if (file === undefined || visited.has(file)) continue;
    visited.add(file);
    const references = preProcessFile(read(file), true, true).importedFiles;
    for (const { fileName } of references) {
      if (fileName === 'zod' || fileName.startsWith('zod/'))
        found.push(`${file}: ${fileName}`);
      if (fileName.startsWith('.')) pending.push(resolveImport(file, fileName));
    }
  }
  return found;
}

function resolveRelative(file: string, name: string): string {
  const base = resolve(dirname(file), name);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.d.ts`,
    resolve(base, 'index.ts'),
  ];
  const target = candidates.find(
    (path) => existsSync(path) && statSync(path).isFile(),
  );
  if (target === undefined)
    throw new Error(`Cannot resolve ${name} from ${file}`);
  return target;
}

describe('plain surface contract modules stay zod-free', () => {
  it.each(['surface.types.ts', 'surface-catalog.ts'])(
    'walks every relative import and re-export from %s',
    (entry) => {
      expect(
        zodImports(
          resolve(__dirname, 'mcp-apps-contracts', entry),
          (file) => readFileSync(file, 'utf8'),
          resolveRelative,
        ),
      ).toEqual([]);
    },
  );

  it('detects Zod in the real surface schema module', () => {
    expect(
      zodImports(
        resolve(__dirname, 'mcp-apps-contracts/surface.schemas.ts'),
        (file) => readFileSync(file, 'utf8'),
        resolveRelative,
      ),
    ).toContain(
      `${resolve(__dirname, 'mcp-apps-contracts/surface.schemas.ts')}: zod`,
    );
  });

  it.each([
    "import type { ZodType } from 'zod';",
    "import { z } from 'zod';",
    "export { z } from 'zod';",
    "import type { ZodType } from 'zod/v4';",
  ])('detects a transitive zod edge: %s', (edge) => {
    const files: Record<string, string> = {
      entry: "export type * from './types';",
      types: "import type { Shape } from './shape';",
      shape: edge,
    };
    expect(
      zodImports(
        'entry',
        (file) => files[file],
        (_file, name) => name.slice(2),
      ),
    ).toHaveLength(1);
  });

  it('terminates on cycles and ignores comments and plain strings', () => {
    const files: Record<string, string> = {
      entry: "export * from './types'; // import { z } from 'zod';",
      types: `import type { Shape } from './entry'; const example = "import { z } from 'zod'";`,
    };
    expect(
      zodImports(
        'entry',
        (file) => files[file],
        (_file, name) => name.slice(2),
      ),
    ).toEqual([]);
  });
});
