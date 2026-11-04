# P1-05 report

## Files

- `libs/backend/review-core/src/lib/persistence/review-repository.interface.ts`: durable attempt, stage, checkpoint port.
- `libs/backend/review-core/src/lib/persistence/sqlite-review.repository.ts`: SQLite queue and persistence implementation.
- `libs/backend/review-core/src/lib/persistence/sqlite-review.repository.spec.ts`: migration-backed integration specs.
- `libs/backend/review-core/src/index.ts`, `src/di/tokens.ts`, `src/di/registration.ts`: exports and registration.

## Public API

`IReviewRepository` extends `IReviewQueueRepository` with `getAttempt`, `getStages`, `saveStage`, `saveCheckpoint`, and `getCheckpoint`. `SqliteReviewRepository` is exported and registered for both queue and wider repository tokens. It uses the shared `SqliteConnectionService`.

## Transactions and invariants

| Operation | Invariant | Spec |
| --- | --- | --- |
| Automatic enqueue | Existing `(repo, PR, SHA, automatic)` attempt returned; insert atomic | `dedupes concurrent discovery to one automatic attempt` |
| New head enqueue | Older active head and queued/running attempts cancelled; running stages interrupted | `supersedes an active head and interrupts its running stage` |
| Claim | Newest queued active head first; one running attempt per PR | `claims the newest head and leaves one active claim per PR` |
| Heartbeat/release | Owner and unexpired lease required | `claims the newest head and leaves one active claim per PR` |
| Lease recovery | Expired attempt and stages interrupted; rediscovery returns existing attempt | `reconciles expired leases and restart discovery cannot duplicate an interrupted run` |
| Manual enqueue | Caller ID unique; separate attempt number | `round trips a checkpoint and gives manual attempts distinct identities` |
| Stage/checkpoint save | UPSERT in one transaction; checkpoint JSON round trip | `round trips a checkpoint and gives manual attempts distinct identities` |

## Decisions

- **Decision:** Reuse `review_stages` for JSON checkpoints under `checkpoint:<stage>` names. **Options:** new table or existing stage table. **Evidence:** migration 0065 is immutable and has no checkpoint table; stage outcome is durable text. **Reversible:** yes, via later migration.
- **Decision:** Expired automatic runs remain interrupted and rediscovery returns their original attempt. **Options:** auto-requeue or explicit manual retry. **Evidence:** acceptance requires no duplicate run on restart and manual IDs are distinct. **Reversible:** yes.
- **Decision:** Use `SqliteConnectionService` through a feature-to-util dependency. **Options:** direct SQLite connection or shared service. **Evidence:** review-core is `scope:extension,type:feature`; persistence-sqlite is `scope:extension,type:util`, matching existing cron store direction. **Reversible:** yes.

## Verification

- Focused Jest integration suite: 5 tests passed using migration 0065 and an in-memory SQLite database.
- Scoped `ptah_get_diagnostics` found initial type errors; fixes were applied. Jest compiled the final spec. Nx was not run per D26.

## Open issues

- Later publication/finding work must add methods for the other review tables when those contracts are defined.
- Host composition roots must ensure persistence registration and migration precede review-core resolution; no host files were in this batch scope.
- The host did not expose a skill catalogue/loading tool to this lane, so no matching skill could be loaded.
