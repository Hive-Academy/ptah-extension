/**
 * Structural guard: the `@ptah-extension/memory-curator` and
 * `@ptah-extension/skill-synthesis` barrels load tsyringe and vscode-core, so
 * a module that imports one at runtime only works
 * where `reflect-metadata` and a `vscode` shim exist — the bench host and the
 * specs, never the plain runner parent. Jest hides the gap (the specs stub
 * `vscode`), so this spec pins the rule on the import graph instead:
 *
 * 1. Only modules under `host/` and in `HOST_ONLY_MODULES` may value-import
 *    either barrel.
 * 2. Outside `host/`, no non-spec module may import a host-only module,
 *    unless it is host-only itself.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const ROOT = __dirname;
// Both barrels load tsyringe and vscode-core at runtime.
const BARRELS = new Set([
  '@ptah-extension/memory-curator',
  '@ptah-extension/skill-synthesis',
]);

const HOST_ONLY_MODULES = new Set([
  'baselines/retention-policy-defaults.ts',
  'ground-truth/seeded-session-generator.ts',
  // Host suites (Batch 17): they run inside the bench host only.
  'suites/memory/extraction.suite.ts',
  'suites/memory/liveness.suite.ts',
  'suites/memory/liveness-harness.ts',
  // Batch 18 host adapter: wired only by the host entry; the suites import
  // its types only.
  'suites/memory/merge-update-ports.ts',
  // Batch 21 host adapter: value-imports the skill-synthesis barrel; wired
  // only by the host entry.
  'suites/skills/judge-agreement-ports.ts',
  // Batch 23 host suites: they call the product's skill writer and trigger
  // scoring through the skill-synthesis barrel; wired only by the host entry.
  'suites/skills/namer-and-trigger.suite.ts',
  'suites/skills/trigger-human-eval.ts',
  // Batch 22 host adapters: value-import the skill-synthesis and agent-sdk
  // barrels; wired only by the host entry.
  'suites/skills/funnel-host-port.ts',
  'suites/skills/funnel-host-graph.ts',
  // Batch 22 spec support: builds production DI for the funnel specs.
  'suites/skills/funnel-di.test-support.ts',
  // Batch 20 host adapter of the retention suites: wired only by the host
  // entry; `retention.suite.ts` imports its types only.
  'suites/memory/retention-port.ts',
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

  it('lets only host and host-only modules value-import either barrel', () => {
    const offenders = files
      .filter((file) => !toKey(file).startsWith('host/'))
      .filter((file) => !HOST_ONLY_MODULES.has(toKey(file)))
      .filter((file) =>
        readImports(file).some((e) => BARRELS.has(e.specifier) && !e.typeOnly),
      )
      .map(toKey);
    expect(offenders).toEqual([]);
  });

  it('keeps host-only modules out of every non-host module', () => {
    const offenders = files
      .filter((file) => !toKey(file).startsWith('host/'))
      // A host-only module runs in the host, so it may import another one.
      .filter((file) => !HOST_ONLY_MODULES.has(toKey(file)))
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
