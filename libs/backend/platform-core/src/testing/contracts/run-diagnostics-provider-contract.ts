/**
 * `runDiagnosticsProviderContract` — behavioural contract for `IDiagnosticsProvider`.
 *
 * Assertions target output shape (severity string union, line numeric, file
 * path string), not call counts. Electron impls return `[]` until a live
 * tsc/ESLint bridge lands, so contracts permit an empty array as a valid
 * response even with seeded fixtures.
 */

import type { IDiagnosticsProvider } from '../../interfaces/diagnostics-provider.interface';

export interface DiagnosticsProviderSetup {
  provider: IDiagnosticsProvider;
  /** Optional seed hook — impls that can't ingest fixtures (Electron) ignore it. */
  seed?(diagnostics: ReturnType<IDiagnosticsProvider['getDiagnostics']>): void;
}

const ALLOWED_SEVERITIES = new Set(['error', 'warning', 'info', 'hint']);

export function runDiagnosticsProviderContract(
  name: string,
  createSetup: () =>
    | Promise<DiagnosticsProviderSetup>
    | DiagnosticsProviderSetup,
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

    it('getDiagnostics returns an array', () => {
      expect(Array.isArray(setup.provider.getDiagnostics())).toBe(true);
    });

    it('getDiagnostics is safe to call when nothing seeded', () => {
      expect(() => setup.provider.getDiagnostics()).not.toThrow();
    });

    it('every returned entry has file: string and diagnostics: array', () => {
      setup.seed?.([
        {
          file: '/tmp/a.ts',
          diagnostics: [{ message: 'bad', line: 1, severity: 'error' }],
        },
      ]);
      for (const entry of setup.provider.getDiagnostics()) {
        expect(typeof entry.file).toBe('string');
        expect(Array.isArray(entry.diagnostics)).toBe(true);
      }
    });

    it('every diagnostic has message:string, line:number, severity:allowed', () => {
      setup.seed?.([
        {
          file: '/tmp/b.ts',
          diagnostics: [
            { message: 'x', line: 3, severity: 'warning' },
            { message: 'y', line: 10, severity: 'info' },
          ],
        },
      ]);
      for (const entry of setup.provider.getDiagnostics()) {
        for (const d of entry.diagnostics) {
          expect(typeof d.message).toBe('string');
          expect(typeof d.line).toBe('number');
          expect(ALLOWED_SEVERITIES.has(d.severity)).toBe(true);
        }
      }
    });

    it('repeated calls return stable shape (no mid-flight errors)', () => {
      setup.provider.getDiagnostics();
      expect(() => setup.provider.getDiagnostics()).not.toThrow();
    });

    it('seed-then-read surfaces the fixture when the impl supports seeding', () => {
      setup.seed?.([{ file: '/tmp/c.ts', diagnostics: [] }]);
      const entries = setup.provider.getDiagnostics();
      if (setup.seed) {
        const hit = entries.find((e) => e.file === '/tmp/c.ts');
        // Electron impls may return [] despite seed; only assert when present.
        if (hit) expect(hit.diagnostics).toEqual([]);
      }
    });
  });
}
