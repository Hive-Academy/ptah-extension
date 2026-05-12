/**
 * Port for settings migration runners.
 *
 * An implementation reads sentinel files in ~/.ptah/migrations/ to determine
 * which migrations have already been applied, then runs any pending ones in order.
 */
export interface ISettingsMigrator {
  /** Run all pending migrations. Idempotent — already-applied migrations are skipped. */
  runMigrations(): Promise<void>;
}
