/**
 * DI Token Registry — Session Organization Tokens.
 *
 * Convention (CONVENTIONS.md §4, mirrors `task-specs/src/lib/di/tokens.ts`):
 *  - always `Symbol.for('Name')` (globally interned across bundles);
 *  - the namespaced identifier matches the symbol key
 *    (`SESSION_ORGANIZATION_TOKENS.SERVICE` ↔ `'SessionOrganizationService'`),
 *    and each key is globally unique;
 *  - frozen `as const`.
 *
 * The recorder port token lives in platform-core
 * (`PLATFORM_TOKENS.SESSION_ORGANIZATION_RECORDER`), not here: producers in
 * other libs depend on the port, never on this lib.
 */
export const SESSION_ORGANIZATION_TOKENS = {
  /** SessionOrganizationStore — pure SQLite I/O over the 0050 tables. */
  STORE: Symbol.for('SessionOrganizationStore'),
  /** SessionOrganizationService — availability, roots, validation, change events. */
  SERVICE: Symbol.for('SessionOrganizationService'),
} as const;

export type SessionOrganizationDIToken =
  keyof typeof SESSION_ORGANIZATION_TOKENS;
