# P1-02 - Forward-only review tables

## Files created/modified

- `libs/backend/persistence-sqlite/src/lib/migrations/0065_ptah_review.ts` - static schema.
- `libs/backend/persistence-sqlite/src/lib/migrations/0065_ptah_review.spec.ts` - in-memory SQLite constraint coverage.
- `libs/backend/persistence-sqlite/src/lib/migrations/index.ts` - version 65 registration.
- Existing migration spec ratchets updated: 0028, 0030, 0038, 0039, 0040, 0041, 0042, 0043, 0044, 0045, 0046, 0047, 0051, 0052, 0053, 0054, 0055, 0056, 0059, 0060, 0061, 0063, 0064 (`*.spec.ts`).
- `.ptah/specs/TASK_2026_873_f748/reports/p1-02-report.md` - this report.

## Migration number and why

65. The file search and registry showed 64 as the current head, with no existing 65.

## Schema summary

| Table | Keys and constraints | Acceptance |
| --- | --- | --- |
| `review_repositories` | `repo_id` PK; unique case-insensitive owner/name; enabled/mode/paused and poll metadata; no token | AC-2.1 |
| `review_heads` | Composite PR/SHA PK; unique active head per PR partial index; repo FK restrict | AC-2.1, AC-2.3 |
| `review_attempts` | `attempt_id` PK; unique head/attempt number; head FK restrict; queued/running state, lease owner/expiry/heartbeat/deadline; unique running attempt per PR partial index | AC-2.4, AC-2.5, AC-3.1 |
| `review_stages` | Composite attempt/stage/ordinal PK; state, outcome, error and artifact reference; attempt FK cascade | AC-2.5, AC-3.1 |
| `review_findings` | Assigned 26-character ULID PK; indexed path/symbol/category shortlist; first/last head FKs restrict | AC-8.1, AC-8.4 |
| `review_finding_events` | Event PK; unique attempt/finding/kind; both FKs restrict | AC-8.5 |
| `review_identity_matches` | Composite attempt/candidate PK; nullable prior finding FK; relation/evidence/hash/family | AC-8.4, AC-8.5 |
| `review_publications` | Publication PK; unique repo/PR/SHA/kind/key; planned/inflight/confirmed/unknown, request hash, marker, GitHub ID; head/attempt FKs restrict | AC-11.3 |
| `review_poll_state` | Repo PK/FK restrict; separate success/error and conditional metadata | AC-2.1 |
| `review_artifacts` | Artifact PK; unique attempt/path; stage FK restrict, content hash, size, validation and retention metadata | AC-2.5, AC-3.1 |

## Verification command + result lines

The orchestrator ran `npm run verify -- -p persistence-sqlite` because this lane's sandbox could not spawn Nx.

- Lint: 0065 files clean; only pre-existing errors in `0057_drop_skill_pipeline.ts`, `0057_drop_skill_pipeline.spec.ts`, and `0058_provider_accounts.spec.ts`.
- Test: failed on the latest-version ratchet, expected 64 and received 65. The ratchet assertions have now been updated to 65. No verification rerun was requested or performed after these edits.
- Scoped `ptah_get_diagnostics` after the edits was unavailable after a 45-second TypeScript check timeout; three selected spec files remained unchecked.

## Deviations

- The requested ratchet updates expanded the edited file set beyond the initial migration-only scope, per the orchestrator's instruction.
- The new spec verifies repeat execution of the static `CREATE IF NOT EXISTS` SQL on an in-memory database and runner skip behavior on a second application using the repository fake database. The full historical chain was not executed in this isolated test.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Keep lease fields on attempts and artifact metadata in a separate table | Separate lease table / attempt fields; stage fields only / artifact table | Plan requires atomic queued-to-running claim and retention metadata linked to validated stage artifacts | Yes, before runtime consumers |
| Restrict deletion of identity and publication history; cascade only stage rows on attempt deletion | Cascade all / restrict durable history | Plan retains finding and unknown outbox identities for dedup and recovery | Partly, forward-only schema |
| Use assigned 26-character ULIDs for finding IDs | Prose hash / assigned ULID | Plan revision log and identity matching requirement | No, once IDs persist |

## Open issues

- The orchestrator should rerun the one-project verification to confirm the revised ratchets. The pre-existing 0057/0058 lint errors remain outside this batch.