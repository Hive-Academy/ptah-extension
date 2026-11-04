# P1-04 report

## Files

- `libs/backend/review-core/src/index.ts`: public exports.
- `src/di/tokens.ts`, `src/di/registration.ts`: symbols and tsyringe registration; host supplies queue repository and existing logger.
- `src/lib/review-policy.service.ts` and spec: deterministic trust, publication, and defaults.
- `src/lib/review-queue.service.ts` and spec: queue orchestration contract and in-memory fake tests.

## Public API

- `ReviewPolicyService.eligibility`, `.publication`, `.effectiveSettings`; reason and result types.
- `ReviewQueueService.discover`, `.retry`, `.claim`, `.heartbeat`, `.release`, `.reconcileStartup`.
- `IReviewQueueRepository`, `IReviewClock`, queue head/attempt/claim/lease types; `REVIEW_CORE_TOKENS`, `registerReviewCore`.

## Policy decision table

| Input | Decision/reason | Spec |
| --- | --- | --- |
| Exact repo, allowed login ignoring case, same head/base repo, open ready, valid settings/config | eligible | `accepts case-insensitive maintainer` |
| Other repo | ineligible / `untrusted-repository` | `rejects` |
| Empty maintainer list | ineligible / `empty-allowlist` | `rejects` |
| Invalid settings or config | ineligible / `invalid-settings` or `invalid-config` | `rejects` |
| Disabled repo | ineligible / `repository-disabled` | `rejects` |
| Closed, draft, fork/null/different head repo, unknown author | ineligible / respective audited reason | `rejects` |
| Global pause, repo pause, dry run, invalid config | publication denied / respective reason | `gates publication` |
| All gates open | publication allowed | `allows publication` |
| Missing trusted config and omitted optional settings | cap 6, confidence 0.8, max inline 10, minimum Minor | `accepts case-insensitive maintainer` |

## Queue interface and invariants

- Repository owns atomic deduplication of automatic `(repo, PR, SHA)` attempts, supersession of older active heads, distinct manual attempt IDs, newest-head claim order, and one active claim per PR.
- Claims carry owner and expiry; heartbeat and release compare owner. Expired leases are reconciled before restart and interrupted stages must be recorded by the repository.
- `reconcileStartup(currentHeads)` expires leases and enqueues current heads independently of cron catch-up. Caller obtains current GitHub heads.
- Queue service validates fixed repo, PR number, SHA, attempt ID, owner and lease duration before repository calls. The fake tests check dedupe, supersession, newest claim, manual IDs, owner protection, and startup reconciliation.

## Deviations

- Existing scaffold and contract lib were reused; generator/config files were untouched.
- No Nx command was run because this sandbox cannot run Nx (EPERM). Scoped `ptah_get_diagnostics` reported 0 TypeScript errors after edits.
- The host does not expose a skill catalogue/loading tool to this lane, so no matching skill could be loaded.

## Decisions

- **Decision:** Put atomic queue behavior in `IReviewQueueRepository`, and keep the service thin. **Options:** service-side locking or repository transaction. **Evidence:** plan requires transactional discovery and P1-05 owns SQLite. **Reversible:** yes.
- **Decision:** Treat missing trusted config as schema defaults; reject malformed config. **Options:** missing as invalid or defaults. **Evidence:** plan Config and trust. **Reversible:** yes.
- **Decision:** Accept a current-head list for startup reconciliation. **Options:** couple queue to GitHub adapter or receive discovered heads. **Evidence:** plan separates discovery from worker and requires restart independent of cron. **Reversible:** yes.

## Open issues

- P1-05 must implement the documented atomic and crash recovery guarantees in SQLite; the in-memory fake is only a service-level test double.
- P1-09/P1-10 must recheck trust, current head and publication gates immediately before every GitHub mutation; this batch supplies policy evaluation but does not perform publication.
