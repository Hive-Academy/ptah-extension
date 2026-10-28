# Batch 7 WP-c pins2 report

Head-version pin 59 -> 60 in `libs/backend/persistence-sqlite/src/lib/migrations/`:

- 0042_db_integrity_check_state.spec.ts line 71: `toBe(60)`
- 0043_memory_retention.spec.ts line 55: `toBe(60)`
- 0044_memory_lifecycle.spec.ts line 76 (`60,`) plus new history comment at line 74 (0060_provider_account_lease_epoch)
- 0045_skill_backlog_cleanup.spec.ts line 34: `toBe(60)`
- 0046_memory_merge_subject_index.spec.ts line 41 (`60,`) plus new history comment at line 39
- 0047_memory_retention_health.spec.ts line 35: `toBe(60)`

0042, 0043, 0045 and 0047 had no 58/59 history comment, so none was added (matches precedent). No other file touched.
