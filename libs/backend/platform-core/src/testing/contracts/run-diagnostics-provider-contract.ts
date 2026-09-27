/**
 * `runDiagnosticsProviderContract` — behavioural contract for `IDiagnosticsProvider`.
 *
 * Assertions target the async + capability-aware `DiagnosticsResult` shape.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type {
  IDiagnosticsProvider,
  DiagnosticsResult,
  FileDiagnostics,
} from '../../interfaces/diagnostics-provider.interface';
import type { LanguageId } from '../../interfaces/language-coverage.interface';

/**
 * A language a provider checks with a syntax-only check (Batch 25a): one
 * file with a syntax error and one without, in that language.
 */
export interface SyntaxOnlyFixture {
  readonly language: LanguageId;
  /** File extension with its leading dot, e.g. `.py`. */
  readonly extension: string;
  /** Source with at least one syntax error. */
  readonly broken: string;
  /** Source without a syntax error. */
  readonly clean: string;
}

export interface DiagnosticsProviderSetup {
  provider: IDiagnosticsProvider;
  seed?(diagnostics: FileDiagnostics[]): void;
  makeUnavailable?(reason: string): void;
  /**
   * Factory for a SECOND checkout of `primaryRoot`: a copy with its own
   * `tsconfig` chain, standing in for `git worktree add`, at a new root it
   * returns. Supplied only by providers that read a real workspace from disk;
   * the contract writes the primary fixture and removes both roots afterwards.
   */
  createSecondCheckout?(primaryRoot: string): Promise<string> | string;
  /**
   * Supplied only by a provider that reads a real workspace from disk AND
   * syntax-checks a language it cannot type-check. The contract writes the
   * fixture pair and checks the answer is never a type-check claim.
   */
  syntaxOnly?: SyntaxOnlyFixture;
}

/**
 * Why `result` breaks the floor-rule amendment (Batch 25a), one line per
 * broken rule; empty when it holds. `syntaxOnlyLanguage` is the language the
 * caller knows was syntax-checked, if any.
 *
 * - `checks: 'type-check'` never accompanies an `<id>:syntax-only`
 *   approximation, and a syntax-only approximation needs `checks`
 *   `'syntax-only'` or `'mixed'`;
 * - a result for a known syntax-only language carries `coverage`, whose
 *   `checks` is not `'type-check'` and whose approximations name it.
 */
export function syntaxOnlyClaimViolations(
  result: DiagnosticsResult,
  syntaxOnlyLanguage?: LanguageId,
): string[] {
  const violations: string[] = [];
  const coverage = result.coverage;
  if (coverage === undefined) {
    if (syntaxOnlyLanguage !== undefined) {
      violations.push(
        `no coverage: nothing says ${syntaxOnlyLanguage} was only syntax-checked`,
      );
    }
    return violations;
  }
  const syntaxOnly = (coverage.approximations ?? []).filter((approximation) =>
    approximation.endsWith(':syntax-only'),
  );
  if (coverage.checks === 'type-check' && syntaxOnly.length > 0) {
    violations.push(
      `checks is 'type-check' beside ${syntaxOnly.join(', ')}: a syntax-only check reported as a type-check`,
    );
  }
  if (
    syntaxOnly.length > 0 &&
    coverage.checks !== 'syntax-only' &&
    coverage.checks !== 'mixed'
  ) {
    violations.push(
      `syntax-only approximations with checks ${String(coverage.checks)}`,
    );
  }
  if (syntaxOnlyLanguage !== undefined) {
    if (coverage.checks === 'type-check') {
      violations.push(
        `${syntaxOnlyLanguage} was only syntax-checked, but checks is 'type-check'`,
      );
    }
    if (!syntaxOnly.includes(`${syntaxOnlyLanguage}:syntax-only`)) {
      violations.push(
        `approximations do not name ${syntaxOnlyLanguage}:syntax-only`,
      );
    }
  }
  return violations;
}

const ALLOWED_SEVERITIES = new Set(['error', 'warning', 'info', 'hint']);

/**
 * How long the second-checkout call may take. The fixture is one tiny project,
 * so this is the "seconds, not a queue" bar the worktree report was about
 * (TASK_2026_559 research/workspace-files.md §7), not a compile benchmark.
 */
const SECOND_CHECKOUT_BUDGET_MS = 10_000;

/** The scoped file, relative to either checkout's root. */
const CHECKOUT_FILE = 'libs/pkg/src/broken.ts';

/**
 * A small Nx-shaped workspace: a root base config, a solution-style project
 * config extending it, and a lib config extending that — the chain a
 * worktree copy has to resolve inside ITSELF. `broken.ts` holds one type error
 * so "the same diagnostics" can never be satisfied by two empty answers.
 */
function writeCheckoutFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-diag-checkout-'));
  const files: Record<string, unknown> = {
    'tsconfig.base.json': {
      compilerOptions: {
        target: 'es2020',
        module: 'commonjs',
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        types: [],
      },
    },
    'libs/pkg/tsconfig.json': {
      extends: '../../tsconfig.base.json',
      files: [],
      include: [],
      references: [{ path: './tsconfig.lib.json' }],
    },
    'libs/pkg/tsconfig.lib.json': {
      extends: './tsconfig.json',
      include: ['src/**/*.ts'],
    },
  };
  for (const [rel, content] of Object.entries(files)) {
    writeFixtureFile(root, rel, JSON.stringify(content, null, 2));
  }
  writeFixtureFile(
    root,
    CHECKOUT_FILE,
    "export const count: number = 'not a number';\n",
  );
  writeFixtureFile(root, 'libs/pkg/src/fine.ts', 'export const fine = 1;\n');
  return root;
}

function writeFixtureFile(root: string, rel: string, content: string): void {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
}

/**
 * Diagnostics with each file made relative to `root`, in a stable order, so
 * two checkouts can be compared. A file outside `root` keeps its absolute path
 * behind a marker: a second checkout answered with the PRIMARY's files must
 * fail the comparison, not pass it.
 */
function relativeView(
  diagnostics: readonly FileDiagnostics[],
  root: string,
): Array<{ file: string; entries: string[] }> {
  const normRoot = path.resolve(root).replace(/\\/g, '/').toLowerCase();
  return diagnostics
    .map((entry) => {
      const file = path.resolve(entry.file).replace(/\\/g, '/');
      const inside = file.toLowerCase().startsWith(normRoot + '/');
      return {
        file: inside ? file.slice(normRoot.length + 1) : `OUTSIDE:${file}`,
        entries: entry.diagnostics
          .map((d) => `${d.line}:${d.severity}:${d.code ?? ''}:${d.message}`)
          .sort(),
      };
    })
    .sort((a, b) => a.file.localeCompare(b.file));
}

export function runDiagnosticsProviderContract(
  name: string,
  createSetup: () =>
    Promise<DiagnosticsProviderSetup> | DiagnosticsProviderSetup,
  teardown?: () => Promise<void> | void,
): void {
  describe(`IDiagnosticsProvider contract — ${name}`, () => {
    let setup: DiagnosticsProviderSetup;

    beforeEach(async () => {
      setup = await createSetup();
    });

    afterEach(async () => {
      await teardown?.();
    });

    it('getDiagnostics returns a promise resolving to a DiagnosticsResult', async () => {
      const result = await setup.provider.getDiagnostics();
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('source');
      expect(['available', 'unavailable']).toContain(result.status);
    });

    it('getDiagnostics is safe to call when nothing seeded', async () => {
      await expect(setup.provider.getDiagnostics()).resolves.not.toThrow();
    });

    it('available result has a diagnostics array with correct entry shape', async () => {
      setup.seed?.([
        {
          file: '/tmp/a.ts',
          diagnostics: [{ message: 'bad', line: 1, severity: 'error' }],
        },
      ]);
      const result = await setup.provider.getDiagnostics();
      if (result.status === 'available') {
        expect(Array.isArray(result.diagnostics)).toBe(true);
        for (const entry of result.diagnostics) {
          expect(typeof entry.file).toBe('string');
          expect(Array.isArray(entry.diagnostics)).toBe(true);
        }
      }
    });

    it('every diagnostic has message:string, line:number, severity:allowed', async () => {
      setup.seed?.([
        {
          file: '/tmp/b.ts',
          diagnostics: [
            { message: 'x', line: 3, severity: 'warning' },
            { message: 'y', line: 10, severity: 'info' },
          ],
        },
      ]);
      const result = await setup.provider.getDiagnostics();
      if (result.status === 'available') {
        for (const entry of result.diagnostics) {
          for (const d of entry.diagnostics) {
            expect(typeof d.message).toBe('string');
            expect(typeof d.line).toBe('number');
            expect(ALLOWED_SEVERITIES.has(d.severity)).toBe(true);
          }
        }
      }
    });

    it('unavailable result carries a reason string and no diagnostics', async () => {
      if (!setup.makeUnavailable) return;
      setup.makeUnavailable('contract-test: forced unavailable');
      const result = await setup.provider.getDiagnostics();
      expect(result.status).toBe('unavailable');
      if (result.status === 'unavailable') {
        expect(typeof result.reason).toBe('string');
        expect(result.reason.length).toBeGreaterThan(0);
        expect(result).not.toHaveProperty('diagnostics');
      }
    });

    it('repeated calls return stable shape (no mid-flight errors)', async () => {
      await setup.provider.getDiagnostics();
      await expect(setup.provider.getDiagnostics()).resolves.not.toThrow();
    });

    it('seed-then-read surfaces the fixture when the impl supports seeding', async () => {
      setup.seed?.([{ file: '/tmp/c.ts', diagnostics: [] }]);
      const result = await setup.provider.getDiagnostics();
      if (setup.seed && result.status === 'available') {
        const hit = result.diagnostics.find((e) => e.file === '/tmp/c.ts');
        if (hit) expect(hit.diagnostics).toEqual([]);
      }
    });

    /**
     * TASK_2026_559 Task 19.2. A scoped check of a file in a second checkout
     * must resolve that checkout's own config chain and answer as the primary
     * does, within {@link SECOND_CHECKOUT_BUDGET_MS}. Nothing exercised a
     * provider against a second checkout before this case.
     */
    it('a file in a second checkout gets the same diagnostics as in the primary, within the budget', async () => {
      if (!setup.createSecondCheckout) return;
      const primaryRoot = writeCheckoutFixture();
      const roots = [primaryRoot];
      try {
        const secondRoot = await setup.createSecondCheckout(primaryRoot);
        roots.push(secondRoot);

        const primary: DiagnosticsResult = await setup.provider.getDiagnostics(
          primaryRoot,
          { files: [path.join(primaryRoot, CHECKOUT_FILE)] },
        );
        const startedAt = Date.now();
        const second: DiagnosticsResult = await setup.provider.getDiagnostics(
          secondRoot,
          { files: [path.join(secondRoot, CHECKOUT_FILE)] },
        );
        const secondMs = Date.now() - startedAt;

        expect(primary.status).toBe('available');
        expect(second.status).toBe('available');
        if (primary.status !== 'available' || second.status !== 'available') {
          return;
        }
        const primaryView = relativeView(primary.diagnostics, primaryRoot);
        expect(primaryView.map((entry) => entry.file)).toContain(CHECKOUT_FILE);
        expect(relativeView(second.diagnostics, secondRoot)).toEqual(
          primaryView,
        );
        expect(secondMs).toBeLessThan(SECOND_CHECKOUT_BUDGET_MS);
      } finally {
        for (const root of roots) {
          fs.rmSync(root, { recursive: true, force: true });
        }
      }
    }, 60_000);

    /** TASK_2026_559 Batch 25a: the floor-rule amendment holds for every answer. */
    it('never reports a syntax-only check as a type-check (any answer)', async () => {
      setup.seed?.([
        {
          file: '/tmp/d.ts',
          diagnostics: [{ message: 'z', line: 1, severity: 'error' }],
        },
      ]);
      expect(
        syntaxOnlyClaimViolations(await setup.provider.getDiagnostics()),
      ).toEqual([]);
    });

    /**
     * TASK_2026_559 Batch 25a, "syntax-only is not a type-check claim". A
     * provider that syntax-checks a language answers a scoped request for
     * two files of it with the syntax error found, the clean file clean,
     * and coverage that names the check as syntax-only.
     */
    it('syntax-only is not a type-check claim', async () => {
      const fixture = setup.syntaxOnly;
      if (!fixture) return;
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-diag-syntax-'));
      try {
        const broken = path.join(root, 'src', `broken${fixture.extension}`);
        const clean = path.join(root, 'src', `clean${fixture.extension}`);
        writeFixtureFile(root, path.relative(root, broken), fixture.broken);
        writeFixtureFile(root, path.relative(root, clean), fixture.clean);

        const result = await setup.provider.getDiagnostics(root, {
          files: [broken, clean],
        });

        expect(syntaxOnlyClaimViolations(result, fixture.language)).toEqual([]);
        expect(result.status).toBe('available');
        if (result.status !== 'available') return;
        expect(result.coverage?.checks).toBe('syntax-only');
        expect(result.coverage?.analyzed).toBe(2);
        const view = relativeView(result.diagnostics, root);
        const brokenRel = path.relative(root, broken).replace(/\\/g, '/');
        const brokenEntry = view.find((entry) => entry.file === brokenRel);
        expect(brokenEntry?.entries.some((e) => e.includes(':error:'))).toBe(
          true,
        );
        expect(view.every((entry) => entry.file === brokenRel)).toBe(true);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }, 60_000);
  });
}
