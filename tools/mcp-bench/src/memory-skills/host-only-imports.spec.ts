/**
 * Structural guard: the `@ptah-extension/memory-curator` barrel loads
 * tsyringe and vscode-core, so a module that imports it at runtime only works
 * where `reflect-metadata` and a `vscode` shim exist — the bench host and the
 * specs, never the plain runner parent. Jest hides the gap (the specs stub
 * `vscode`), so this spec pins the rule on the import graph instead:
 *
 * 1. Only the modules in `HOST_ONLY_MODULES` may value-import the barrel.
 * 2. Outside `host/`, no non-spec module may import a host-only module.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const ROOT = __dirname;
const BARREL = '@ptah-extension/memory-curator';

const HOST_ONLY_MODULES = new Set([
  'baselines/retention-policy-defaults.ts',
  'ground-truth/seeded-session-generator.ts',
]);

const IMPORT_PATTERN =
  /(?:^|\n)\s*(?:import|export)\s+(type\s+)?(?:[^;'"]*?\s+from\s+)?'([^']+)'/g;

interface ImportEdge {
  readonly specifier: string;
  readonly typeOnly: boolean;
}

function toKey(file: string): string {
  return relative(ROOT, file).split(sep).join('/');
}

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return listSourceFiles(full);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')
      ? [full]
      : [];
  });
}

function readImports(file: string): ImportEdge[] {
  const text = readFileSync(file, 'utf8');
  return [...text.matchAll(IMPORT_PATTERN)].map((m) => ({
    specifier: m[2],
    typeOnly: m[1] !== undefined,
  }));
}

function resolveRelative(file: string, specifier: string): string {
  return toKey(resolve(dirname(file), specifier)).replace(/(\.ts)?$/, '.ts');
}

describe('memory-skills host-only imports', () => {
  const files = listSourceFiles(ROOT);

  it('finds the source tree and every host-only module', () => {
    const keys = new Set(files.map(toKey));
    for (const hostOnly of HOST_ONLY_MODULES) {
      expect(keys.has(hostOnly)).toBe(true);
    }
  });

  it('lets only host-only modules value-import the memory-curator barrel', () => {
    const offenders = files
      .filter((file) => !HOST_ONLY_MODULES.has(toKey(file)))
      .filter((file) =>
        readImports(file).some((e) => e.specifier === BARREL && !e.typeOnly),
      )
      .map(toKey);
    expect(offenders).toEqual([]);
  });

  it('keeps host-only modules out of every non-host module', () => {
    const offenders = files
      .filter((file) => !toKey(file).startsWith('host/'))
      .flatMap((file) =>
        readImports(file)
          .filter((e) => e.specifier.startsWith('.') && !e.typeOnly)
          .map((e) => resolveRelative(file, e.specifier))
          .filter((target) => HOST_ONLY_MODULES.has(target))
          .map((target) => `${toKey(file)} -> ${target}`),
      );
    expect(offenders).toEqual([]);
  });
});
