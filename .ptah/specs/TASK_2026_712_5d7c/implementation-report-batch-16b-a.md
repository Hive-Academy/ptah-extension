# Batch 16b-A implementation report

Implemented append-only migration 0059 and its registration with the exact requested schema.

## Files changed

Paths are relative to `D:/projects/ptah-extension/.claude-worktrees/provider-accounts/`:

- Created `libs/backend/persistence-sqlite/src/lib/migrations/0059_provider_account_session_links.ts`.
- Created `libs/backend/persistence-sqlite/src/lib/migrations/0059_provider_account_session_links.spec.ts`.
- Modified `libs/backend/persistence-sqlite/src/lib/migrations/index.ts`: import and append version 59, name `0059_provider_account_session_links`.
- Created this report, `.ptah/specs/TASK_2026_712_5d7c/implementation-report-batch-16b-a.md`.

Left `0058_provider_accounts.spec.ts` unchanged: its line 123 assertion checks the result of applying only migration 58, not the registry maximum or migration count.

## Final SQL

```sql
CREATE TABLE IF NOT EXISTS provider_account_session_links (
  provider TEXT NOT NULL,
  sdk_session_id TEXT NOT NULL,
  run_id TEXT NOT NULL UNIQUE,
  attached_at INTEGER NOT NULL,
  PRIMARY KEY (provider, sdk_session_id),
  FOREIGN KEY (run_id) REFERENCES provider_account_run_bindings (run_id)
);
CREATE INDEX IF NOT EXISTS idx_provider_account_session_links_run
  ON provider_account_session_links (run_id);
```

## Test cases

Seven specs use the existing real `node:sqlite` in-memory database seam with `PRAGMA foreign_keys = ON` from 0058:

1. Registration immediately after 58 and maximum version 59.
2. Apply after 0058, create table/index, preserve existing bindings, and attach a valid session.
3. Reapply idempotently while preserving existing links.
4. Reject a duplicate provider/session pair with a different valid run.
5. Allow the same SDK session ID under distinct providers with distinct runs.
6. Reject a second SDK session ID for the same run.
7. Reject an unknown run through the foreign key.

Tests were authored but not executed, per the batch's explicit command prohibition. No Nx, Jest, tsc, lint, build, serve, e2e, package, or git commands were run.

## Diagnostics result

`ptah_get_diagnostics` scoped to the three changed TypeScript files returned source `typescript-compiler`, clean coverage, zero errors, and zero warnings. No runtime-test pass is claimed.

## Other specs needing the 58-to-59 bump

The initial search found these 16 registry-head assertions, all under `libs/backend/persistence-sqlite/src/lib/migrations/`. This lane did not edit them. A final search no longer found their 58 assertions, consistent with concurrent orchestrator-owned updates; the only remaining match was the intentionally unchanged 0058-specific runner assertion.

- `0028_gateway_conversation_workspace_root.spec.ts:84`
- `0030_skill_event_metrics.spec.ts:39`
- `0038_gateway_message_turn_state.spec.ts:92`
- `0039_reap_orphaned_queue_rows.spec.ts:66`
- `0040_skill_candidate_workspace_root.spec.ts:79`
- `0041_skill_md_migration_state.spec.ts:63`
- `0042_db_integrity_check_state.spec.ts:71`
- `0043_memory_retention.spec.ts:55`
- `0045_skill_backlog_cleanup.spec.ts:34`
- `0047_memory_retention_health.spec.ts:35`
- `0051_skill_lifecycle.spec.ts:31`
- `0052_memory_boot_scan_failures.spec.ts:63`
- `0053_memory_boot_scan_failure_generation.spec.ts:65`
- `0054_lane_outcome_records.spec.ts:128`
- `0055_skill_invocation_run_id.spec.ts:80`
- `0056_skill_nullable_grades.spec.ts:83`

## Decisions

- Preserve the exact requested SQL without additional CHECK constraints. Options: exact contract or additional text/timestamp checks. Evidence: 0058 leaves text validation to the write boundary and has no timestamp CHECK constraints; only revisions and epochs receive nonnegative checks. This matches the current batch contract. Reversible during review before migration deployment; deployed migrations remain append-only.
- Retain 0058's runner assertion at 58. Options: retain the migration-specific expectation or incorrectly bump it with registry-head expectations. Evidence: `0058_provider_accounts.spec.ts` calls `runner.applyAll([migration58])`; changing the expected user version would contradict the invocation. Reversible test-only decision.
- Use real SQLite constraint specs and the same local structural database interface as 0058. Options: real SQLite or fake database assertions. Evidence: 0058 explicitly reserves real SQLite for constraint validation; the project uses Jest and migration SQL exports. Reversible test implementation choice.

Repository guidance was read from root `CLAUDE.md`, `CONTRIBUTING.md`, and `README.md`; task context and relevant plan/batch sections were inspected. No 16b/0059 entry was found in batches.md, so the explicit current batch assignment supplied the file and schema contract.
