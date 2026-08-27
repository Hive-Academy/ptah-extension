/**
 * `type-script-diagnostics-provider.spec.ts` — TASK_2026_299 Batch 5/8.
 *
 * `TypeScriptDiagnosticsProvider` drives the real TypeScript compiler API
 * against on-disk fixtures (no mocking of `typescript` or `ts.sys`) because
 * the SUT reads tsconfig content and source files via `require('fs')` /
 * `ts.sys` directly — an in-memory `IFileSystemProvider` mock cannot back
 * that. Only tsconfig *discovery* goes through `IFileSystemProvider.findFiles`,
 * so that single method is mocked to return the exact paths each fixture
 * writes to a real OS temp directory. Every fixture is created in
 * `beforeEach`/per-test and removed in `afterEach`.
 *
 * Two cases below (marked EXPECTED RED) assert the CORRECT behavior per
 * context.md, not the current behavior. TASK_2026_299 Batch 8's logic review
 * found real defects in the landed `type-script-diagnostics-provider.ts`:
 *
 *   1. `rootFileNames.length === 0` returns (line ~129) BEFORE
 *      `program.getProjectReferences()` traversal (line ~148) runs, so a
 *      solution-style root tsconfig (`files: []`, `include: []`,
 *      `references: [...]`) never traverses its referenced child projects.
 *   2. When configs are discovered but zero programs get built and zero
 *      errors are recorded, the function falls through to
 *      `{ status: 'available', diagnostics: [] }` — a false "clean" result
 *      indistinguishable from a project with genuinely zero errors.
 *
 * These specs are deliberately failing (RED) until a backend-developer fixes
 * the source; do not soften the assertions to pass. See
 * `.ptah/specs/TASK_2026_299/test-report.md` for the failing-spec inventory.
 */

import 'reflect-metadata';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  createMockFileSystemProvider,
  runDiagnosticsProviderContract,
  type DiagnosticsProviderSetup,
} from '@ptah-extension/platform-core/testing';
import { TypeScriptDiagnosticsProvider } from './type-script-diagnostics-provider';
import { tsDiagnosticsWorker } from './ts-diagnostics-worker';

/**
 * Every behavioural case below runs a real `ts.createProgram` +
 * `getPreEmitDiagnostics` pass. Even against a one-file fixture that costs
 * seconds — TypeScript parses, binds and checks its own `lib.*.d.ts` set on
 * every program — so Jest's 5 s default was always a lottery this suite
 * happened to keep winning on an idle machine. Stating the real budget makes
 * the suite report compiler failures instead of stopwatch failures.
 */
jest.setTimeout(60_000);

/**
 * Terminate the shared type-check worker, and AWAIT it. `Worker.terminate()` is
 * asynchronous: a fire-and-forget teardown lets this file finish while the
 * thread is still winding down, which Jest reports as a worker process that
 * "failed to exit gracefully".
 */
afterAll(async () => {
  await tsDiagnosticsWorker.dispose();
});

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const createdDirs: string[] = [];

/** Write a real on-disk fixture tree under the OS temp dir. Returns its root. */
function writeFixture(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-ts-diag-'));
  createdDirs.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf-8');
  }
  return root;
}

function tsconfigContent(opts: {
  include?: string[];
  files?: string[];
  references?: Array<{ path: string }>;
  composite?: boolean;
}): string {
  return JSON.stringify({
    compilerOptions: {
      target: 'es2020',
      module: 'commonjs',
      strict: true,
      noEmit: true,
      ...(opts.composite ? { composite: true, declaration: true } : {}),
    },
    ...(opts.include ? { include: opts.include } : {}),
    ...(opts.files ? { files: opts.files } : {}),
    ...(opts.references ? { references: opts.references } : {}),
  });
}

/** Fake `IFileSystemProvider` whose `findFiles` returns a fixed config list. */
function fsProviderReturning(
  configPaths: string[],
): ReturnType<typeof createMockFileSystemProvider> {
  return createMockFileSystemProvider({
    findFiles: jest.fn(async () => configPaths),
  });
}

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Shared IDiagnosticsProvider contract (no-root path only — TS provider has
// no seed/makeUnavailable hooks since it reads real projects from disk).
// ---------------------------------------------------------------------------

runDiagnosticsProviderContract('TypeScriptDiagnosticsProvider', () => {
  const fsProvider = fsProviderReturning([]);
  const provider = new TypeScriptDiagnosticsProvider(fsProvider);
  const setup: DiagnosticsProviderSetup = { provider };
  return setup;
});

// ---------------------------------------------------------------------------
// TypeScriptDiagnosticsProvider — behavioural cases (TASK_2026_299 Task 5.3)
// ---------------------------------------------------------------------------

describe('TypeScriptDiagnosticsProvider', () => {
  it('clean project (valid tsconfig, no errors) -> available with empty diagnostics', async () => {
    const root = writeFixture({
      'tsconfig.json': tsconfigContent({ include: ['src/**/*.ts'] }),
      'src/index.ts': 'export const x: number = 1;\n',
    });
    const provider = new TypeScriptDiagnosticsProvider(
      fsProviderReturning([path.join(root, 'tsconfig.json')]),
    );

    const result = await provider.getDiagnostics(root);

    expect(result.status).toBe('available');
    if (result.status === 'available') {
      expect(result.source).toBe('typescript-compiler');
      expect(result.diagnostics).toEqual([]);
    }
  });

  it('error project -> available with diagnostics carrying correct file/line/severity', async () => {
    const root = writeFixture({
      'tsconfig.json': tsconfigContent({ include: ['src/**/*.ts'] }),
      'src/index.ts': 'export const bad: number = "nope";\n',
    });
    const provider = new TypeScriptDiagnosticsProvider(
      fsProviderReturning([path.join(root, 'tsconfig.json')]),
    );

    const result = await provider.getDiagnostics(root);

    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    expect(result.diagnostics).toHaveLength(1);
    const fileEntry = result.diagnostics[0];
    expect(fileEntry.file.endsWith('/src/index.ts')).toBe(true);
    expect(fileEntry.diagnostics).toHaveLength(1);
    const diag = fileEntry.diagnostics[0];
    expect(diag.severity).toBe('error');
    expect(diag.line).toBe(0);
    expect(diag.code).toBe(2322);
    expect(diag.message).toContain('not assignable');
  });

  it('EXPECTED RED (Batch 8 finding #1) — solution-style root traverses referenced child projects once and collects their diagnostics', async () => {
    const root = writeFixture({
      // Solution-style root: no own files, only references. This is the
      // dominant shape in this monorepo (see
      // libs/backend/workspace-intelligence/tsconfig.json).
      'tsconfig.json': tsconfigContent({
        files: [],
        include: [],
        references: [{ path: './child' }],
      }),
      'child/tsconfig.json': tsconfigContent({
        include: ['src/**/*.ts'],
        composite: true,
      }),
      'child/src/index.ts': 'export const bad: number = "nope";\n',
    });
    // Only the ROOT config is "discovered" by the mock — the child's
    // diagnostics must reach the result via project-reference traversal, not
    // via independent top-level discovery, to isolate the traversal defect.
    const provider = new TypeScriptDiagnosticsProvider(
      fsProviderReturning([path.join(root, 'tsconfig.json')]),
    );

    const result = await provider.getDiagnostics(root);

    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    const childEntry = result.diagnostics.find((d) =>
      d.file.endsWith('/child/src/index.ts'),
    );
    expect(childEntry).toBeDefined();
    expect(childEntry?.diagnostics.some((d) => d.code === 2322)).toBe(true);
  });

  it('EXPECTED RED (Batch 8 finding #2) — configs discovered but zero programs built and zero errors -> unavailable, not a false clean', async () => {
    // A solution-style tsconfig with no references either: rootFileNames end
    // up empty, `collectFromConfig` returns early with no error recorded, so
    // `visitedPrograms.size === 0 && errors.length === 0`. The correct
    // contract is `unavailable` with a reason — NOT `available` + `[]`,
    // which the formatter would render as "No issues found."
    const root = writeFixture({
      'tsconfig.json': tsconfigContent({ files: [], include: [] }),
    });
    const provider = new TypeScriptDiagnosticsProvider(
      fsProviderReturning([path.join(root, 'tsconfig.json')]),
    );

    const result = await provider.getDiagnostics(root);

    expect(result.status).toBe('unavailable');
    if (result.status === 'unavailable') {
      expect(typeof result.reason).toBe('string');
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });

  it('malformed tsconfig (invalid JSON) -> unavailable with reason, does not throw', async () => {
    const root = writeFixture({
      'tsconfig.json': '{ "compilerOptions": { invalid json,',
    });
    const provider = new TypeScriptDiagnosticsProvider(
      fsProviderReturning([path.join(root, 'tsconfig.json')]),
    );

    await expect(provider.getDiagnostics(root)).resolves.not.toThrow();
    const result = await provider.getDiagnostics(root);
    expect(result.status).toBe('unavailable');
    if (result.status === 'unavailable') {
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });

  it('no tsconfig under root -> unavailable with reason', async () => {
    const root = writeFixture({ 'src/index.ts': 'export const x = 1;\n' });
    const provider = new TypeScriptDiagnosticsProvider(fsProviderReturning([]));

    const result = await provider.getDiagnostics(root);

    expect(result.status).toBe('unavailable');
    if (result.status === 'unavailable') {
      expect(result.source).toBe('typescript-compiler');
      expect(result.reason).toBe(
        'No tsconfig.json found under workspace root.',
      );
    }
  });

  it.each([undefined, ''])(
    'no workspace root (%p) -> unavailable with reason, findFiles never called',
    async (root) => {
      const fsProvider = fsProviderReturning(['/should/not/be/used.json']);
      const provider = new TypeScriptDiagnosticsProvider(fsProvider);

      const result = await provider.getDiagnostics(root);

      expect(result.status).toBe('unavailable');
      if (result.status === 'unavailable') {
        expect(result.reason).toBe('No workspace root resolved.');
      }
      expect(fsProvider.findFiles).not.toHaveBeenCalled();
    },
  );

  it('dedup: the same diagnostic reachable via two discovered tsconfigs appears once', async () => {
    // Two independent (non-referencing) tsconfigs both include the same
    // source file, so the top-level discovery loop processes it twice.
    // Exercises the file:line:code:message dedup key directly, independent
    // of the (currently broken) project-reference traversal path.
    const root = writeFixture({
      'tsconfig.json': tsconfigContent({ include: ['src/**/*.ts'] }),
      'tsconfig.alt.json': tsconfigContent({ include: ['src/**/*.ts'] }),
      'src/index.ts': 'export const bad: number = "nope";\n',
    });
    const provider = new TypeScriptDiagnosticsProvider(
      fsProviderReturning([
        path.join(root, 'tsconfig.json'),
        path.join(root, 'tsconfig.alt.json'),
      ]),
    );

    const result = await provider.getDiagnostics(root);

    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].diagnostics).toHaveLength(1);
  });

  it('workspace switch: two sequential calls with different roots each see only their own tsconfigs (no caching)', async () => {
    const rootA = writeFixture({
      'tsconfig.json': tsconfigContent({ include: ['src/**/*.ts'] }),
      'src/index.ts': 'export const bad: number = "nope";\n',
    });
    const rootB = writeFixture({
      'tsconfig.json': tsconfigContent({ include: ['src/**/*.ts'] }),
      'src/index.ts': 'export const ok: number = 1;\n',
    });
    const fsProvider = createMockFileSystemProvider({
      findFiles: jest.fn(async (_pattern, _exclude, _maxResults, cwd) => {
        if (cwd === rootA) return [path.join(rootA, 'tsconfig.json')];
        if (cwd === rootB) return [path.join(rootB, 'tsconfig.json')];
        return [];
      }),
    });
    const provider = new TypeScriptDiagnosticsProvider(fsProvider);

    const resultA = await provider.getDiagnostics(rootA);
    const resultB = await provider.getDiagnostics(rootB);

    expect(resultA.status).toBe('available');
    expect(resultB.status).toBe('available');
    if (resultA.status === 'available' && resultB.status === 'available') {
      expect(resultA.diagnostics).toHaveLength(1);
      expect(resultB.diagnostics).toEqual([]);
    }
  });

  it('Windows paths: backslash-bearing temp paths are normalized to forward slashes in output', async () => {
    const root = writeFixture({
      'tsconfig.json': tsconfigContent({ include: ['src/**/*.ts'] }),
      'src/index.ts': 'export const bad: number = "nope";\n',
    });
    // On win32 (this repo's dev/CI target for this suite) `root` itself is
    // backslash-separated (`C:\Users\...\Temp\ptah-ts-diag-XXXX`).
    if (process.platform === 'win32') {
      expect(root).toContain('\\');
    }
    const provider = new TypeScriptDiagnosticsProvider(
      fsProviderReturning([path.join(root, 'tsconfig.json')]),
    );

    const result = await provider.getDiagnostics(root);

    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    for (const entry of result.diagnostics) {
      expect(entry.file).not.toMatch(/\\/);
    }
  });

  it('root filtering: a diagnostic from a file outside the requested root is excluded', async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-ts-diag-base-'));
    createdDirs.push(base);
    const root = path.join(base, 'workspaceRoot');
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.mkdirSync(path.join(base, 'outside'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'tsconfig.json'),
      tsconfigContent({ include: ['src/**/*.ts', '../outside/**/*.ts'] }),
    );
    // In-root file has NO error; only the outside file does. If filtering
    // fails, the outside error leaks in and this assertion catches it.
    fs.writeFileSync(
      path.join(root, 'src', 'index.ts'),
      'export const ok: number = 1;\n',
    );
    fs.writeFileSync(
      path.join(base, 'outside', 'bad.ts'),
      'export const bad: number = "nope";\n',
    );

    const provider = new TypeScriptDiagnosticsProvider(
      fsProviderReturning([path.join(root, 'tsconfig.json')]),
    );

    const result = await provider.getDiagnostics(root);

    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    expect(result.diagnostics).toEqual([]);
  });

  /**
   * TASK_2026_301. `findFiles` took a bare limit of 200 and nothing downstream
   * could tell "every config in the workspace" from "the first 200 of an
   * unknown larger number". Configs past the cap were never parsed, never
   * compiled and never reported — and the result read exactly like a clean
   * subtree.
   *
   * The cap is parameterized so these cases can saturate it with two files
   * rather than 2000.
   */
  describe('partial config discovery cannot report a clean result', () => {
    it('saturated discovery + zero diagnostics -> unavailable, naming the cap', async () => {
      const root = writeFixture({
        'tsconfig.json': tsconfigContent({ include: ['src/**/*.ts'] }),
        'src/index.ts': 'export const x: number = 1;\n',
      });
      // One config returned, cap of one — the page is full, so discovery may
      // have dropped others. The project itself is clean, which is precisely
      // the answer this pass is not entitled to give.
      const provider = new TypeScriptDiagnosticsProvider(
        fsProviderReturning([path.join(root, 'tsconfig.json')]),
        1,
      );

      const result = await provider.getDiagnostics(root);

      expect(result.status).toBe('unavailable');
      if (result.status !== 'unavailable') return;
      expect(result.reason).toContain('maximum of 1 tsconfig');
      expect(result.reason).toContain('partial coverage');
    });

    it('a workspace with more configs than the cap cannot report a clean result', async () => {
      // Three genuine tsconfigs on disk, all clean. The mock honors
      // `maxResults` the way the real `findFiles` does: it returns the first
      // `maxConfigs` and drops the rest. So discovery reports a full page
      // (length === cap) while two configs the provider never saw sit on disk.
      const root = writeFixture({
        'tsconfig.a.json': tsconfigContent({ include: ['a/**/*.ts'] }),
        'tsconfig.b.json': tsconfigContent({ include: ['b/**/*.ts'] }),
        'tsconfig.c.json': tsconfigContent({ include: ['c/**/*.ts'] }),
        'a/index.ts': 'export const a: number = 1;\n',
        'b/index.ts': 'export const b: number = 1;\n',
        'c/index.ts': 'export const c: number = 1;\n',
      });
      const allConfigs = [
        path.join(root, 'tsconfig.a.json'),
        path.join(root, 'tsconfig.b.json'),
        path.join(root, 'tsconfig.c.json'),
      ];
      const fsProvider = createMockFileSystemProvider({
        findFiles: jest.fn(
          async (_p: string, _e: unknown, maxResults: number) =>
            allConfigs.slice(0, maxResults),
        ),
      });
      const provider = new TypeScriptDiagnosticsProvider(fsProvider, 1);

      const result = await provider.getDiagnostics(root);

      // The page is full (1 === 1) and two configs were dropped. A clean
      // result from partial coverage is exactly the false clean TASK_2026_299
      // was opened to remove.
      expect(result.status).toBe('unavailable');
      if (result.status !== 'unavailable') return;
      expect(result.reason).toContain('maximum of 1 tsconfig');
      expect(result.reason).toContain('partial coverage');
    });

    it('saturated discovery + real diagnostics -> still available with those findings', async () => {
      const root = writeFixture({
        'tsconfig.json': tsconfigContent({ include: ['src/**/*.ts'] }),
        'src/index.ts': 'export const bad: number = "nope";\n',
      });
      const provider = new TypeScriptDiagnosticsProvider(
        fsProviderReturning([path.join(root, 'tsconfig.json')]),
        1,
      );

      const result = await provider.getDiagnostics(root);

      // Partial coverage does not make a found error wrong. Hiding a real
      // diagnostic behind a capability message is the worse trade.
      expect(result.status).toBe('available');
      if (result.status !== 'available') return;
      expect(result.diagnostics.length).toBeGreaterThan(0);
    });

    it('an unsaturated page still reports a clean project as clean', async () => {
      const root = writeFixture({
        'tsconfig.json': tsconfigContent({ include: ['src/**/*.ts'] }),
        'src/index.ts': 'export const x: number = 1;\n',
      });
      // One config returned against a cap of two — discovery is exhausted, so
      // "clean" is a claim this pass CAN make. Without this case the fix could
      // regress into reporting every workspace unavailable.
      const provider = new TypeScriptDiagnosticsProvider(
        fsProviderReturning([path.join(root, 'tsconfig.json')]),
        2,
      );

      const result = await provider.getDiagnostics(root);

      expect(result.status).toBe('available');
      if (result.status !== 'available') return;
      expect(result.diagnostics).toEqual([]);
    });
  });

  /**
   * TASK_2026_323 blocker B3. `ptah_get_diagnostics` is bound to this provider
   * in the Electron and CLI hosts, and the core prompt tells every agent to
   * call it — so three agents in one session call it in a burst, and in
   * Electron the thread they land on is the MAIN process. The compile now runs
   * on a worker thread, a burst on one root collapses into one run, and a
   * repeat within `RESULT_CACHE_TTL_MS` is served from the last result.
   */
  describe('does not block the caller and does not re-run per caller', () => {
    it('leaves the calling event loop free while the compile runs', async () => {
      const root = writeFixture({
        'tsconfig.json': tsconfigContent({ include: ['src/**/*.ts'] }),
        'src/index.ts': 'export const bad: number = "nope";\n',
      });
      const provider = new TypeScriptDiagnosticsProvider(
        fsProviderReturning([path.join(root, 'tsconfig.json')]),
      );

      // A 5 ms interval is the probe: it can only tick if the caller's loop is
      // free. The pre-fix implementation ran `ts.createProgram` inline, so this
      // counter stayed near zero for the entire call.
      let ticks = 0;
      const probe = setInterval(() => {
        ticks += 1;
      }, 5);

      const startedAt = Date.now();
      const result = await provider.getDiagnostics(root);
      const elapsedMs = Date.now() - startedAt;
      clearInterval(probe);

      expect(result.status).toBe('available');
      // Guards the guard: if the compile were somehow instant there would be
      // nothing to be blocked by, and the tick assertion would prove nothing.
      expect(elapsedMs).toBeGreaterThan(200);
      // At minimum one tick per 100 ms of wall clock. Off-thread this lands
      // near one per 5 ms; on-thread it lands at zero.
      expect(ticks).toBeGreaterThan(elapsedMs / 100);
    });

    it('single-flight: concurrent callers on one root share a single run', async () => {
      const root = writeFixture({
        'tsconfig.json': tsconfigContent({ include: ['src/**/*.ts'] }),
        'src/index.ts': 'export const bad: number = "nope";\n',
      });
      const fsProvider = fsProviderReturning([
        path.join(root, 'tsconfig.json'),
      ]);
      const provider = new TypeScriptDiagnosticsProvider(fsProvider);

      const [first, second, third] = await Promise.all([
        provider.getDiagnostics(root),
        provider.getDiagnostics(root),
        provider.getDiagnostics(root),
      ]);

      expect(fsProvider.findFiles).toHaveBeenCalledTimes(1);
      expect(first.status).toBe('available');
      expect(second).toEqual(first);
      expect(third).toEqual(first);
    });

    it('single-flight releases the slot, so a later call can still run', async () => {
      // Without the `finally` that clears the in-flight entry, the first run
      // would be served forever and the TTL would never be consulted.
      const rootA = writeFixture({
        'tsconfig.json': tsconfigContent({ include: ['src/**/*.ts'] }),
        'src/index.ts': 'export const bad: number = "nope";\n',
      });
      const rootB = writeFixture({
        'tsconfig.json': tsconfigContent({ include: ['src/**/*.ts'] }),
        'src/index.ts': 'export const ok: number = 1;\n',
      });
      const fsProvider = createMockFileSystemProvider({
        findFiles: jest.fn(async (_pattern, _exclude, _maxResults, cwd) =>
          cwd === rootA
            ? [path.join(rootA, 'tsconfig.json')]
            : [path.join(rootB, 'tsconfig.json')],
        ),
      });
      const provider = new TypeScriptDiagnosticsProvider(fsProvider);

      await provider.getDiagnostics(rootA);
      const resultB = await provider.getDiagnostics(rootB);

      expect(fsProvider.findFiles).toHaveBeenCalledTimes(2);
      expect(resultB.status).toBe('available');
      if (resultB.status !== 'available') return;
      expect(resultB.diagnostics).toEqual([]);
    });

    it('cache: a repeat call within the TTL is served without a second compile', async () => {
      const root = writeFixture({
        'tsconfig.json': tsconfigContent({ include: ['src/**/*.ts'] }),
        'src/index.ts': 'export const bad: number = "nope";\n',
      });
      const fsProvider = fsProviderReturning([
        path.join(root, 'tsconfig.json'),
      ]);
      const provider = new TypeScriptDiagnosticsProvider(fsProvider);

      const first = await provider.getDiagnostics(root);
      const second = await provider.getDiagnostics(root);

      expect(fsProvider.findFiles).toHaveBeenCalledTimes(1);
      expect(second).toEqual(first);
    });

    it('cache: the entry expires, so a fixed error is not reported forever', async () => {
      const root = writeFixture({
        'tsconfig.json': tsconfigContent({ include: ['src/**/*.ts'] }),
        'src/index.ts': 'export const bad: number = "nope";\n',
      });
      const fsProvider = fsProviderReturning([
        path.join(root, 'tsconfig.json'),
      ]);
      const provider = new TypeScriptDiagnosticsProvider(fsProvider);

      const realNow = Date.now.bind(Date);
      let clockOffsetMs = 0;
      const nowSpy = jest
        .spyOn(Date, 'now')
        .mockImplementation(() => realNow() + clockOffsetMs);

      try {
        const stale = await provider.getDiagnostics(root);
        expect(stale.status).toBe('available');
        if (stale.status === 'available') {
          expect(stale.diagnostics).toHaveLength(1);
        }

        // The agent fixes the error, then asks again past the TTL.
        fs.writeFileSync(
          path.join(root, 'src', 'index.ts'),
          'export const ok: number = 1;\n',
        );
        clockOffsetMs = 60_000;

        const fresh = await provider.getDiagnostics(root);

        expect(fsProvider.findFiles).toHaveBeenCalledTimes(2);
        expect(fresh.status).toBe('available');
        if (fresh.status !== 'available') return;
        expect(fresh.diagnostics).toEqual([]);
      } finally {
        nowSpy.mockRestore();
      }
    });

    it('cache is per root, so one workspace never answers for another', async () => {
      const rootA = writeFixture({
        'tsconfig.json': tsconfigContent({ include: ['src/**/*.ts'] }),
        'src/index.ts': 'export const bad: number = "nope";\n',
      });
      const rootB = writeFixture({
        'tsconfig.json': tsconfigContent({ include: ['src/**/*.ts'] }),
        'src/index.ts': 'export const ok: number = 1;\n',
      });
      const fsProvider = createMockFileSystemProvider({
        findFiles: jest.fn(async (_pattern, _exclude, _maxResults, cwd) =>
          cwd === rootA
            ? [path.join(rootA, 'tsconfig.json')]
            : [path.join(rootB, 'tsconfig.json')],
        ),
      });
      const provider = new TypeScriptDiagnosticsProvider(fsProvider);

      const [resultA, resultB] = await Promise.all([
        provider.getDiagnostics(rootA),
        provider.getDiagnostics(rootB),
      ]);

      expect(resultA.status).toBe('available');
      expect(resultB.status).toBe('available');
      if (resultA.status !== 'available' || resultB.status !== 'available') {
        return;
      }
      expect(resultA.diagnostics).toHaveLength(1);
      expect(resultB.diagnostics).toEqual([]);
    });
  });

  /**
   * TASK_2026_325 finding 1. `outcome.errors` was consulted ONLY when
   * `programCount === 0`, so a workspace where one tsconfig is broken and
   * another compiles reported the healthy project's result and threw the
   * failure away. With the healthy project clean that rendered as "No issues
   * found" — the same false clean TASK_2026_299 and TASK_2026_301 each removed
   * from a different path into this function.
   *
   * A config that could not be checked is reported as an error diagnostic on
   * that config file, which survives every consumer: the MCP formatter lists
   * it, and the `execute_code` payload carries it as an ordinary entry. There
   * is no side-channel on `DiagnosticsResult` for a caller to miss.
   */
  describe('a config that failed to compile is never dropped', () => {
    it('two configs, one clean and one malformed -> the result names the malformed config', async () => {
      const root = writeFixture({
        'tsconfig.json': tsconfigContent({ include: ['src/**/*.ts'] }),
        'tsconfig.broken.json': '{ "compilerOptions": { invalid json,',
        'src/index.ts': 'export const x: number = 1;\n',
      });
      const provider = new TypeScriptDiagnosticsProvider(
        fsProviderReturning([
          path.join(root, 'tsconfig.json'),
          path.join(root, 'tsconfig.broken.json'),
        ]),
      );

      const result = await provider.getDiagnostics(root);

      // The clean config DID produce a program, so the run is `available` —
      // its findings are real and worth returning.
      expect(result.status).toBe('available');
      if (result.status !== 'available') return;
      const failure = result.diagnostics.find((entry) =>
        entry.file.endsWith('/tsconfig.broken.json'),
      );
      expect(failure).toBeDefined();
      expect(failure?.diagnostics[0].severity).toBe('error');
      expect(failure?.diagnostics[0].message).toContain('Malformed tsconfig');
      // TypeScript's own code for the syntax error, which is only available
      // when `readConfigFile` returns a diagnostic instead of throwing. On
      // Windows it threw, because it was handed a backslashed path.
      expect(typeof failure?.diagnostics[0].code).toBe('number');
    });

    it('a broken config beside a clean project cannot render as "No issues found"', async () => {
      const root = writeFixture({
        'tsconfig.json': tsconfigContent({ include: ['src/**/*.ts'] }),
        'tsconfig.broken.json': '{ "compilerOptions": { invalid json,',
        'src/index.ts': 'export const x: number = 1;\n',
      });
      const provider = new TypeScriptDiagnosticsProvider(
        fsProviderReturning([
          path.join(root, 'tsconfig.json'),
          path.join(root, 'tsconfig.broken.json'),
        ]),
      );

      const result = await provider.getDiagnostics(root);

      expect(result.status).toBe('available');
      if (result.status !== 'available') return;
      // The compiled half is clean; the result is still not empty, because
      // "checked, and clean" is not what happened here.
      expect(result.diagnostics).toHaveLength(1);
    });

    it('real diagnostics and a config failure are reported together, failure first', async () => {
      const root = writeFixture({
        'tsconfig.json': tsconfigContent({ include: ['src/**/*.ts'] }),
        'tsconfig.broken.json': '{ "compilerOptions": { invalid json,',
        'src/index.ts': 'export const bad: number = "nope";\n',
      });
      const provider = new TypeScriptDiagnosticsProvider(
        fsProviderReturning([
          path.join(root, 'tsconfig.json'),
          path.join(root, 'tsconfig.broken.json'),
        ]),
      );

      const result = await provider.getDiagnostics(root);

      expect(result.status).toBe('available');
      if (result.status !== 'available') return;
      expect(result.diagnostics).toHaveLength(2);
      // What was NOT checked bounds how much the rest of the list is worth,
      // so it leads.
      expect(result.diagnostics[0].file.endsWith('/tsconfig.broken.json')).toBe(
        true,
      );
      expect(result.diagnostics[1].file.endsWith('/src/index.ts')).toBe(true);
      expect(result.diagnostics[1].diagnostics[0].code).toBe(2322);
    });

    it('every discovered config failing -> unavailable, with each failure named', async () => {
      const root = writeFixture({
        'tsconfig.json': '{ "compilerOptions": { invalid json,',
        'tsconfig.other.json': '{ "compilerOptions": { also broken,',
      });
      const provider = new TypeScriptDiagnosticsProvider(
        fsProviderReturning([
          path.join(root, 'tsconfig.json'),
          path.join(root, 'tsconfig.other.json'),
        ]),
      );

      const result = await provider.getDiagnostics(root);

      // Nothing compiled, so there is no finding to report and no clean claim
      // to make either.
      expect(result.status).toBe('unavailable');
      if (result.status !== 'unavailable') return;
      expect(result.reason).toContain('tsconfig.json');
      expect(result.reason).toContain('tsconfig.other.json');
    });
  });

  /**
   * TASK_2026_325 finding 2. The cache key is the root, and nothing in the key
   * moves when a source file does — so the agent loop the core prompt
   * prescribes (read diagnostics, fix, read again) was answered from before its
   * own edit. The affordable halves of a fix: a window narrow enough to be one
   * agent's burst rather than one agent's turn, and an explicit `invalidate`
   * for the caller that knows it just wrote.
   */
  describe('an edit is not hidden behind the result cache', () => {
    it('invalidate(root) makes the next call within the TTL reflect the edit', async () => {
      const root = writeFixture({
        'tsconfig.json': tsconfigContent({ include: ['src/**/*.ts'] }),
        'src/index.ts': 'export const bad: number = "nope";\n',
      });
      const fsProvider = fsProviderReturning([
        path.join(root, 'tsconfig.json'),
      ]);
      const provider = new TypeScriptDiagnosticsProvider(fsProvider);

      const before = await provider.getDiagnostics(root);
      expect(before.status).toBe('available');
      if (before.status === 'available') {
        expect(before.diagnostics).toHaveLength(1);
      }

      // The agent applies the fix and asks again immediately — well inside the
      // TTL, which is exactly when the stale answer used to be served.
      fs.writeFileSync(
        path.join(root, 'src', 'index.ts'),
        'export const ok: number = 1;\n',
      );
      provider.invalidate(root);

      const after = await provider.getDiagnostics(root);

      expect(fsProvider.findFiles).toHaveBeenCalledTimes(2);
      expect(after.status).toBe('available');
      if (after.status !== 'available') return;
      expect(after.diagnostics).toEqual([]);
    });

    it('invalidate() with no argument drops every cached root', async () => {
      const rootA = writeFixture({
        'tsconfig.json': tsconfigContent({ include: ['src/**/*.ts'] }),
        'src/index.ts': 'export const x: number = 1;\n',
      });
      const rootB = writeFixture({
        'tsconfig.json': tsconfigContent({ include: ['src/**/*.ts'] }),
        'src/index.ts': 'export const y: number = 2;\n',
      });
      const fsProvider = createMockFileSystemProvider({
        findFiles: jest.fn(async (_pattern, _exclude, _maxResults, cwd) =>
          cwd === rootA
            ? [path.join(rootA, 'tsconfig.json')]
            : [path.join(rootB, 'tsconfig.json')],
        ),
      });
      const provider = new TypeScriptDiagnosticsProvider(fsProvider);

      await provider.getDiagnostics(rootA);
      await provider.getDiagnostics(rootB);
      expect(fsProvider.findFiles).toHaveBeenCalledTimes(2);

      provider.invalidate();

      await provider.getDiagnostics(rootA);
      await provider.getDiagnostics(rootB);
      expect(fsProvider.findFiles).toHaveBeenCalledTimes(4);
    });

    it('the TTL is short enough that a call six seconds later recompiles', async () => {
      const root = writeFixture({
        'tsconfig.json': tsconfigContent({ include: ['src/**/*.ts'] }),
        'src/index.ts': 'export const bad: number = "nope";\n',
      });
      const fsProvider = fsProviderReturning([
        path.join(root, 'tsconfig.json'),
      ]);
      const provider = new TypeScriptDiagnosticsProvider(fsProvider);

      const realNow = Date.now.bind(Date);
      let clockOffsetMs = 0;
      const nowSpy = jest
        .spyOn(Date, 'now')
        .mockImplementation(() => realNow() + clockOffsetMs);

      try {
        await provider.getDiagnostics(root);
        fs.writeFileSync(
          path.join(root, 'src', 'index.ts'),
          'export const ok: number = 1;\n',
        );
        // Six seconds: inside the OLD 30 s window, outside the current one.
        clockOffsetMs = 6_000;

        const fresh = await provider.getDiagnostics(root);

        expect(fsProvider.findFiles).toHaveBeenCalledTimes(2);
        expect(fresh.status).toBe('available');
        if (fresh.status !== 'available') return;
        expect(fresh.diagnostics).toEqual([]);
      } finally {
        nowSpy.mockRestore();
      }
    });
  });

  /**
   * TASK_2026_325 finding 3. `unavailable` reports a condition, not a
   * measurement — a dead worker, a compiler mid-install, a config being saved
   * at that instant. Caching it handed the same failure to every caller in the
   * window without retrying the one thing that could clear it.
   */
  describe('a failed run is never cached', () => {
    it('an unavailable result is not served from cache: the next call re-runs the check', async () => {
      const root = writeFixture({
        'tsconfig.json': tsconfigContent({ include: ['src/**/*.ts'] }),
        'src/index.ts': 'export const x: number = 1;\n',
      });
      let discovered: string[] = [];
      const fsProvider = createMockFileSystemProvider({
        findFiles: jest.fn(async () => discovered),
      });
      const provider = new TypeScriptDiagnosticsProvider(fsProvider);

      const missing = await provider.getDiagnostics(root);
      expect(missing.status).toBe('unavailable');

      // The workspace finishes checking out / the config lands.
      discovered = [path.join(root, 'tsconfig.json')];

      const found = await provider.getDiagnostics(root);

      expect(fsProvider.findFiles).toHaveBeenCalledTimes(2);
      expect(found.status).toBe('available');
    });

    it('a rejected worker run is not cached: the next call recompiles', async () => {
      const root = writeFixture({
        'tsconfig.json': tsconfigContent({ include: ['src/**/*.ts'] }),
        'src/index.ts': 'export const bad: number = "nope";\n',
      });
      const fsProvider = fsProviderReturning([
        path.join(root, 'tsconfig.json'),
      ]);
      const provider = new TypeScriptDiagnosticsProvider(fsProvider);

      const runSpy = jest
        .spyOn(tsDiagnosticsWorker, 'run')
        .mockRejectedValueOnce(new Error('worker died mid-compile'));

      try {
        const failed = await provider.getDiagnostics(root);
        expect(failed.status).toBe('unavailable');
        if (failed.status === 'unavailable') {
          expect(failed.reason).toContain('worker died mid-compile');
        }

        // The spy falls back to the real implementation after the one
        // rejection, so this call is a genuine compile.
        const recovered = await provider.getDiagnostics(root);

        expect(fsProvider.findFiles).toHaveBeenCalledTimes(2);
        expect(recovered.status).toBe('available');
        if (recovered.status !== 'available') return;
        expect(recovered.diagnostics).toHaveLength(1);
      } finally {
        runSpy.mockRestore();
      }
    });
  });
});
