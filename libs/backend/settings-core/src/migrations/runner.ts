import * as fs from 'fs';
import * as path from 'path';
import type { ISettingsMigrator } from '../ports/settings-migrator.interface';

/** A migration function. Receives the path to ~/.ptah/ and performs its transform. */
export type MigrationFn = (ptahDir: string) => Promise<void>;

/**
 * Runs a versioned sequence of migration functions, skipping any already applied.
 *
 * Sentinel files at `~/.ptah/migrations/vN.applied` mark completed migrations.
 * The sentinel is written synchronously after a successful run so it survives
 * a crash mid-write (atomic write would be better but adds complexity —
 * a repeated idempotent migration is safer than a lost sentinel).
 *
 * Usage:
 *   const runner = new MigrationRunner(ptahDir, [runV1Migration, runV2Migration]);
 *   await runner.runMigrations();
 */
export class MigrationRunner implements ISettingsMigrator {
  private readonly ptahDir: string;
  private readonly migrations: readonly MigrationFn[];

  constructor(ptahDir: string, migrations: readonly MigrationFn[]) {
    this.ptahDir = ptahDir;
    this.migrations = migrations;
  }

  async runMigrations(): Promise<void> {
    const migrationsDir = path.join(this.ptahDir, 'migrations');
    fs.mkdirSync(migrationsDir, { recursive: true });

    for (let i = 0; i < this.migrations.length; i++) {
      const version = i + 1;
      const sentinel = path.join(migrationsDir, `v${version}.applied`);

      if (fs.existsSync(sentinel)) {
        continue; // Already applied — skip.
      }

      await this.migrations[i](this.ptahDir);

      // Write sentinel synchronously so it survives a crash between the async
      // migration completing and the file being created.
      fs.writeFileSync(sentinel, new Date().toISOString(), 'utf8');
    }
  }
}
