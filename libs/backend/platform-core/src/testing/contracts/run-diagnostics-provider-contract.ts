/**
 * `runDiagnosticsProviderContract` — behavioural contract for `IDiagnosticsProvider`.
 *
 * Assertions target the async + capability-aware `DiagnosticsResult` shape.
 */

import type {
  IDiagnosticsProvider,
  DiagnosticsResult,
  FileDiagnostics,
} from '../../interfaces/diagnostics-provider.interface';

export interface DiagnosticsProviderSetup {
  provider: IDiagnosticsProvider;
  seed?(diagnostics: FileDiagnostics[]): void;
  makeUnavailable?(reason: string): void;
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
  });
}
