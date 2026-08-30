/**
 * `ts-diagnostics-worker-containment.spec.ts` — TASK_2026_303 finding 1.
 *
 * The type-check worker is started with `eval: true`, so it has no module
 * resolution and CANNOT import `platform-core`'s `isPathWithinRoots`. Its
 * containment predicate is therefore a hand-written twin
 * (`WORKER_CONTAINMENT_SOURCE`), and a hand-kept twin is a hope, not a
 * guarantee.
 *
 * That matters more here than for a typical duplicate, because the two copies
 * fail in opposite directions. The worker's copy runs BEFORE `postMessage`, so
 * anything it drops is unrecoverable — the host can never ask for it back. A
 * drift that makes the worker stricter than the helper silently deletes real
 * diagnostics, which is the precise bug TASK_2026_299 → 303 exists to kill.
 *
 * So the promise is converted into a checked invariant: both implementations
 * are driven over ONE shared table and must agree on every row. The worker's
 * side is obtained by evaluating the exact source text the worker runs — not a
 * TypeScript re-implementation of it, which would be a third copy and would
 * prove nothing about what actually ships.
 */

import 'reflect-metadata';
import * as nodePath from 'node:path';
import { isPathWithinRoots } from '@ptah-extension/platform-core';
import { WORKER_CONTAINMENT_SOURCE } from './ts-diagnostics-worker-source';

type ContainmentFn = (
  normRoot: string,
  normFile: string,
  platform: NodeJS.Platform,
) => boolean;

/**
 * Compile the worker's own source text into a callable.
 *
 * `nodePath` is the one free variable in `WORKER_CONTAINMENT_SOURCE`; the
 * worker prelude binds it with `require('node:path')`, and here it is injected
 * as a parameter. `new Function` is the point of this spec — evaluating the
 * shipped text, rather than a TypeScript re-implementation of it, is what makes
 * the equivalence claim real.
 */
function loadWorkerContainment(): ContainmentFn {
  const factory = new Function(
    'nodePath',
    `${WORKER_CONTAINMENT_SOURCE}\nreturn isWithinRoot;`,
  ) as (p: typeof nodePath) => ContainmentFn;
  return factory(nodePath);
}

const workerIsWithinRoot = loadWorkerContainment();

/**
 * One row of the shared truth table.
 *
 * Paths are POSIX-absolute rather than `D:/...` so that `path.resolve` — which
 * both implementations reach, and which is governed by the HOST os, not by
 * `platform` — is a no-op on Linux and adds the same drive prefix to both
 * operands on Windows. That keeps every row's expectation identical on the
 * ubuntu CI runner and on a Windows dev box.
 */
interface Row {
  readonly name: string;
  readonly root: string;
  readonly file: string;
  readonly platform: NodeJS.Platform;
  readonly expected: boolean;
}

const ROWS: readonly Row[] = [
  {
    name: 'identical paths are contained',
    root: '/ws/root',
    file: '/ws/root',
    platform: 'linux',
    expected: true,
  },
  {
    name: 'a descendant is contained',
    root: '/ws/root',
    file: '/ws/root/src/index.ts',
    platform: 'linux',
    expected: true,
  },
  {
    name: 'win32: drive-letter casing mismatch is still contained',
    root: '/d/projects/ptah',
    file: '/D/Projects/ptah/src/a.ts',
    platform: 'win32',
    expected: true,
  },
  {
    name: 'win32: path-segment casing mismatch is still contained',
    root: '/ws/root',
    file: '/WS/Root/src/a.ts',
    platform: 'win32',
    expected: true,
  },
  {
    name: 'separator boundary: /foo/barbaz is NOT inside /foo/bar',
    root: '/foo/bar',
    file: '/foo/barbaz/a.ts',
    platform: 'linux',
    expected: false,
  },
  {
    name: 'separator boundary holds under the win32 fold too',
    root: '/foo/bar',
    file: '/FOO/BARBAZ/a.ts',
    platform: 'win32',
    expected: false,
  },
  {
    name: 'trailing slash on the FILE operand is ignored',
    root: '/ws/root',
    file: '/ws/root/',
    platform: 'linux',
    expected: true,
  },
  {
    name: 'trailing slash on the ROOT operand is ignored',
    root: '/ws/root/',
    file: '/ws/root/src/a.ts',
    platform: 'linux',
    expected: true,
  },
  {
    name: 'trailing slash on BOTH operands is ignored',
    root: '/ws/root/',
    file: '/ws/root/',
    platform: 'linux',
    expected: true,
  },
  {
    name: 'linux is case-SENSITIVE: a casing mismatch is out of root',
    root: '/ws/root',
    file: '/WS/ROOT/src/a.ts',
    platform: 'linux',
    expected: false,
  },
  {
    name: 'a sibling tree is out of root',
    root: '/ws/root',
    file: '/ws/other/a.ts',
    platform: 'linux',
    expected: false,
  },
  {
    name: 'a parent is not inside its own child',
    root: '/ws/root',
    file: '/ws',
    platform: 'linux',
    expected: false,
  },
  {
    name: 'dot segments are resolved, not compared literally',
    root: '/ws/root',
    file: '/ws/root/../other/a.ts',
    platform: 'linux',
    expected: false,
  },
  {
    name: 'backslashes are folded to forward slashes on both operands',
    root: '/ws/root',
    file: '/ws\\root\\src\\a.ts',
    platform: 'win32',
    expected: true,
  },
];

describe('worker containment twin agrees with platform-core isPathWithinRoots', () => {
  it.each(ROWS.map((row) => [row.name, row] as const))(
    '%s',
    (_name, row: Row) => {
      const helper = isPathWithinRoots(row.file, [row.root], row.platform);
      const twin = workerIsWithinRoot(row.root, row.file, row.platform);

      // Asserting BOTH against a literal expectation, not just against each
      // other: two implementations that drifted together would still agree.
      expect(helper).toBe(row.expected);
      expect(twin).toBe(row.expected);
    },
  );

  it('covers every behaviour the twin is claimed to share', () => {
    // A guard on the table itself. If a row is deleted, this fails rather than
    // letting the suite quietly shrink to the cases that happen to pass.
    expect(ROWS).toHaveLength(14);
    expect(ROWS.filter((r) => r.platform === 'win32').length).toBeGreaterThan(
      0,
    );
    expect(ROWS.filter((r) => r.platform === 'linux').length).toBeGreaterThan(
      0,
    );
    expect(ROWS.filter((r) => r.expected).length).toBeGreaterThan(0);
    expect(ROWS.filter((r) => !r.expected).length).toBeGreaterThan(0);
  });

  it('the twin is never STRICTER than the helper (the unrecoverable direction)', () => {
    // The worker filter runs before `postMessage`, so anything it drops is gone
    // for good. `twin === helper` on every row already implies this, but
    // stating it separately names the asymmetry a future editor must preserve
    // if a row is ever allowed to differ.
    for (const row of ROWS) {
      const helper = isPathWithinRoots(row.file, [row.root], row.platform);
      const twin = workerIsWithinRoot(row.root, row.file, row.platform);
      if (helper) {
        expect(twin).toBe(true);
      }
    }
  });
});
