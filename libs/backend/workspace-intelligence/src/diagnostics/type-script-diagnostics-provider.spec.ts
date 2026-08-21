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
});
