import 'reflect-metadata';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { SqliteConnectionService } from './sqlite-connection.service';
import { createMockLogger } from './testing/mock-logger';

function makeTempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-vec-realbinary-'));
  return path.join(dir, 'ptah.db');
}

describe('SqliteConnectionService — real-binary vec load (skipped without native)', () => {
  let nativeAvailable = false;
  let nativeProbeError: string | null = null;
  try {
    require.resolve('better-sqlite3');
    require.resolve('sqlite-vec');
    const Database = require('better-sqlite3') as new (file: string) => {
      close(): void;
    };
    const probe = new Database(':memory:');
    probe.close();
    nativeAvailable = true;
  } catch (err: unknown) {
    nativeAvailable = false;
    nativeProbeError = err instanceof Error ? err.message : String(err);
  }
  if (!nativeAvailable && nativeProbeError) {
    process.stderr.write(
      `[realbinary-spec] native probe failed; suite skipped: ${nativeProbeError}\n`,
    );
  }

  const maybe = nativeAvailable ? it : it.skip;

  maybe(
    'loads sqlite-vec with the default resolver and exposes vec_version()',
    async () => {
      const service = new SqliteConnectionService(
        makeTempDbPath(),
        createMockLogger(),
      );
      await service.openAndMigrate();

      expect(service.vecExtensionLoaded).toBe(true);

      const diag = service.vecLoadDiagnostic;
      expect(diag.ok).toBe(true);
      expect(diag.reason).toBe('ok');
      expect(typeof diag.attemptedPath).toBe('string');
      expect(diag.attemptedPath?.length ?? 0).toBeGreaterThan(0);
      expect(diag.fsExists).toBe(true);
      expect(diag.processArch).toBe(process.arch);
      expect(diag.processPlatform).toBe(process.platform);

      const version = service.db.prepare('SELECT vec_version() AS v').get() as {
        v: string;
      };
      expect(typeof version.v).toBe('string');
      expect(version.v.length).toBeGreaterThan(0);

      service.close();
    },
  );

  maybe(
    'falls back to require.resolve probe when primary resolver returns a missing path',
    async () => {
      const service = new SqliteConnectionService(
        makeTempDbPath(),
        createMockLogger(),
      );
      service.configure({
        vecPathResolver: () =>
          path.join(os.tmpdir(), 'ptah-nonexistent-vec-binary.dll'),
      });

      await service.openAndMigrate();

      expect(service.vecExtensionLoaded).toBe(true);
      const diag = service.vecLoadDiagnostic;
      expect(diag.ok).toBe(true);
      expect(diag.reason).toBe('ok');
      expect(diag.errorChain).toBeDefined();
      expect((diag.errorChain ?? []).length).toBeGreaterThanOrEqual(1);
      expect(
        (diag.errorChain ?? []).some(
          (entry) => entry.strategy === 'primary-resolver',
        ),
      ).toBe(true);

      service.close();
    },
  );

  maybe(
    'records load-failed reason when every strategy fails (primary + platform + host fallback all bad)',
    async () => {
      const service = new SqliteConnectionService(
        makeTempDbPath(),
        createMockLogger(),
      );
      service.configure({
        vecPathResolver: () => {
          throw new Error('synthetic primary failure');
        },
        vecPathPlatformResolver: () => {
          throw new Error('synthetic platform failure');
        },
        vecPathFallbackResolver: () => {
          throw new Error('synthetic host fallback failure');
        },
      });

      await service.openAndMigrate();

      const diag = service.vecLoadDiagnostic;
      expect(service.vecExtensionLoaded).toBe(false);
      expect(diag.ok).toBe(false);
      expect(['load-failed', 'binary-missing']).toContain(diag.reason);
      expect(diag.error?.message.length ?? 0).toBeGreaterThan(0);
      expect(diag.errorChain).toBeDefined();
      expect((diag.errorChain ?? []).length).toBeGreaterThanOrEqual(3);
      expect(
        (diag.errorChain ?? []).some((e) => e.strategy === 'primary-resolver'),
      ).toBe(true);
      expect(
        (diag.errorChain ?? []).some(
          (e) => e.strategy === 'require-resolve-platform-pkg',
        ),
      ).toBe(true);
      expect(
        (diag.errorChain ?? []).some((e) => e.strategy === 'host-fallback'),
      ).toBe(true);

      service.close();
    },
  );
});
