# Open review items (revise cap reached)

Phase B review ran an initial review, two revise rounds and one bounded correction
(commit 5da43d62c). The bounded-correction review (code-logic-review-bounded.md, REVISE 7/10)
left these items open. Per the revise-cap rule they are reported, not fixed.

1. Moderate: `persistLastRun` in
   libs/backend/memory-curator/src/lib/control/indexing-control.service.ts reads the row and then
   runs an unconditional UPDATE. Two processes that share one database can race between the read
   and the write. A possible fix: a conditional UPDATE (`WHERE last_run_json IS ?`) with a retry.
2. Moderate: `readRow` swallows a read error and returns null, so the ordering guard treats the
   row as empty and can overwrite a newer row. A possible fix: treat a failed read as "skip the
   write and warn".

Impact: only the displayed last-run summary, and only when two processes share one database.
Single-instance guarantees (one write or skip per census, at most one push, clock-rollback
order, older manual census never overwrites a newer one) hold per the same review.
Decision owner: the user (fix in this PR or follow-up).

## Resolution (2026-11-06)

The user chose to fix both items in this PR.

1. `persistLastRun` now writes with a compare-and-set UPDATE
   (`WHERE workspace_fingerprint = ? AND last_run_json IS ?`). After a miss it reads the row
   again and decides the order again, for at most 3 attempts.
2. `readRowResult` tells "no row" from "read failed". A failed read warns and never writes.

Tests: three new specs in indexing-control.service.spec.ts (failed read, conflict with a newer
row, conflict with an older row). Review: code-logic-review-moderate-fix.md, kimi, APPROVED 9/10.
Residual: the conflict tests use a fake database, not two real processes.
