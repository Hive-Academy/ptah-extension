# Code Logic Review — Batch A (backend) — `TASK_2026_462_c819`

## Summary

| Metric              | Value           |
| ------------------- | --------------- |
| Overall score       | 8/10            |
| Assessment          | APPROVED (PASS) |
| Blocking issues     | 0               |
| Serious issues      | 0               |
| Moderate issues     | 2               |
| Failure modes found | 2               |

Scope reviewed: `waitlist-query.ts`(+spec), `admin-waitlist.dto.ts`, `admin-waitlist.types.ts`,
`admin-waitlist.service.ts`(+spec), `admin-waitlist.controller.ts`(+spec), `admin.module.ts`,
`admin.service.ts`(+spec), `waitlist-approval.service.ts`(+spec),
`libs/api/marketing/.../waitlist.service.ts`(+spec), `audit-log.types.ts`, `route-map.spec.ts`,
`controller-validation.spec.ts`. Cross-checked one downstream consumer of the changed
`GET /v1/admin/stats` contract in `libs/web/admin` because the plan and my brief both call out
"other consumers... still correct" as an explicit check.

## Five logic questions

### 1. How does this fail silently?

- `waitlist.service.ts:250-278` (`claimForApproval`) reports the wrong _label_ for a claim loss
  under a genuine race, without any observable error — see Failure mode 1 below. The database
  state stays correct (no double grant), but the per-row outcome returned to the admin can read
  `already_approved` when the row is in fact `already_paid`. Nothing logs or flags this; it looks
  like a normal, successful classification.
- `admin-waitlist.service.ts:158-215` (`list`) and `:244-270` (`resolveEligibleIds`): the reversed-
  date-range check runs twice per request (once for the page `where`, once for `countWhere`) with
  no functional difference, only wasted work — not a silent failure, but worth noting since a
  future edit to one call site and not the other could silently desync them (`admin-waitlist.service.ts:151-152`).

### 2. What user action produces unexpected behaviour?

- An admin who clicks **Approve** on a row at the exact moment a customer completes checkout for
  that same email sees the row reported as "already approved" instead of "already paid" (Failure
  mode 1). The grant is correctly refused either way, so no double-grant, but the admin's mental
  model of the funnel is wrong for that one row until they reload.
- An admin viewing the Overview dashboard's "Waitlist not yet invited" tile continues to see the
  pre-task, R1.2-violating count (`total − notified`), which still overcounts an approved-but-
  never-notified row as "not yet invited" — the exact bug this task exists to fix, just on a
  screen Batch A's file list didn't touch (Moderate finding below).

### 3. What input data produces a wrong answer?

- None found within Batch A's own files that produce a _wrong_ answer without being caught by a
  matching DTO/policy guard. `waitlist-query.spec.ts` proves the eight lifecycle-timestamp
  combinations map to exactly one stage and exactly one predicate, stage/source/sort values are
  allowlisted before touching a Prisma key, and the reversed-date-range guard is exercised.
- A `source` column literally storing the string `"unknown"` (not NULL) would be excluded from the
  `source=unknown` filter, since that filter reads `{ source: null }`. This is explicitly called
  out and accepted in the plan/implementation as the intended null-bucket semantics, not a defect.

### 4. What happens when a dependency fails?

- List/eligible-ids/details Prisma failures are caught and translated to sanitized 503s with the
  cause logged server-side only and never in the response body (`admin-waitlist.service.ts:208-215,
263-270, 501-508`, asserted in `admin-waitlist.service.spec.ts:313-334, 405-421, 740-758`).
- Export is fail-closed end-to-end: count failure → 503 `WAITLIST_EXPORT_UNAVAILABLE`; over-cap →
  413 before any row read; read failure → 503; **audit write failure → 503
  `WAITLIST_EXPORT_AUDIT_FAILED` with no CSV sent** (`admin-waitlist.service.ts:296-376`, proven at
  `admin-waitlist.service.spec.ts:498-516`). This is the one export path than can leak PII without
  attribution, and it is the one path with the most careful failure-order guarantee in the batch.
- Approval's existing per-row transactional/rollback behaviour is untouched by the claim hardening;
  the new `already_paid` branch throws before any write, so a Paddle/email/audit failure downstream
  of a converted row cannot occur (there is nothing left to fail).

### 5. What is missing that the requirements never mentioned?

- The claim-loss outcome label (`already_approved` vs `already_paid`) is derived from a
  pre-update read that can be stale under a genuine race (Failure mode 1) — the requirements
  (R1.3, AC-R3.3) specify the _actions_ must be blocked, which they are, but do not anticipate that
  the _reported reason_ can be wrong. Worth a follow-up: re-read `convertedAt` after `count === 0`
  before choosing the outcome label, or accept the mislabel as a documented limitation (it is
  partially documented in the JSDoc, but the JSDoc's claim that "the read IS trusted for the
  paid/approved split" is only true in one direction — see Failure mode 1).
- Overview dashboard drift (Failure mode 2): the requirements are scoped to the Waitlist Pipeline,
  and the plan explicitly says existing Overview inputs "remain valid," but that statement is only
  true for the raw fields (`notified`, `total`, `converted`) staying present — it does not make the
  _derived_ `waitlistUninvited` on Overview correct, and it silently continues to disagree with the
  Pipeline's own (now-correct) `new` count for the same admin session.

## Failure modes

### 1. Claim-loss outcome mislabeled under a payment/approval race

- Trigger: Admin A calls approve on row X. Between `waitlist.service.ts:252` (`findUnique`, reads
  `convertedAt: null`) and `:266` (`updateMany` with `WHERE approvedAt IS NULL AND convertedAt IS
NULL`), a concurrent Paddle webhook sets `convertedAt` on the same row.
- Symptom: `updateMany` correctly returns `count: 0` (no grant issued — correct), but the outcome
  is chosen from the _stale_ `row.convertedAt` read before the race (`waitlist.service.ts:270-278`),
  which was `null`, so the row is reported as `already_approved` rather than `already_paid`. The
  admin-facing per-row outcome and the `tally.already_approved` / `tally.already_paid` counters are
  both wrong for this row.
- Evidence: `libs/api/marketing/src/lib/waitlist/waitlist.service.ts:270-278` (the ternary keys off
  `row.convertedAt`, not a post-update re-read); JSDoc at `waitlist.service.ts:236-247` documents
  that the read is "advisory" for `not_found`/loss detection generally, then separately asserts (at
  `:240-244`, the "ONE VALUE THE READ IS TRUSTED FOR" paragraph) that the read is trustworthy for
  the paid/approved split — that claim is only sound in the direction "read shows converted ⇒ truly
  converted," never the converse ("read shows not-converted ⇒ truly not converted at update time").
- Current handling: no re-read after the failed `updateMany`; no test exercises this ordering
  (`waitlist.service.spec.ts`'s new test at line ~265 sets up `convertedAt` in the _initial_ read,
  which is the direction that is actually safe, not the race direction that is not).
- Recommendation: after `count === 0`, re-read `convertedAt` (a second cheap `findUnique` inside the
  same `tx`, which is already open) before choosing between `already_approved` and `already_paid`,
  or narrow the JSDoc claim to stop asserting the read is trustworthy for this split and accept the
  mislabel as a documented, narrow-window, no-data-loss limitation.

### 2. Overview dashboard keeps the R1.2 bug the task set out to fix

- Trigger: Any approved-but-never-notified waitlist row exists (the exact scenario in AC-R1.2).
- Symptom: The Waitlist Pipeline now correctly excludes it from "New" (via the hardened
  `attention.waitlistUninvited = new` on the backend, `admin.service.ts:371-379`), but
  `libs/web/admin/src/lib/overview/overview.ts:70-74` independently recomputes
  `Math.max(s.waitlist.total - s.waitlist.notified, 0)` client-side instead of consuming
  `attention.waitlistUninvited` from the wire response, so the Overview's "Waitlist not yet
  invited" tile still overcounts that row.
- Evidence: `libs/web/admin/src/lib/overview/overview.ts:66-74`; contrast with the now-authoritative
  `AdminStatsResponse.attention.waitlistUninvited` at `libs/api/admin/src/lib/admin.service.ts:95-96,
371-379` and its test at `libs/api/admin/src/lib/admin.service.spec.ts:544-547` (`waitlistUninvited:
15 // newCount`).
- Current handling: `overview.ts` was not touched by Batch A (correctly out of its file ownership)
  or by Batch B's file list in the plan either — it is not in either batch's ownership list
  (`implementation-plan.md:489-528`), so it appears to be a genuine gap in the plan's scope, not a
  Batch A regression.
- Recommendation: file a follow-up (or flag to the team-leader before sign-off) to change
  `overview.ts:70-74` to read `stats.attention.waitlistUninvited` directly instead of re-deriving it
  from `total`/`notified`, so the two screens agree. Not a Batch A defect since Batch A's contract
  (`attention.waitlistUninvited = new`) is correct and tested; the gap is an unclaimed consumer.

## Blocking issues

None found.

## Serious issues

None found.

## Moderate and minor issues

1. **Moderate** — Failure mode 1 above: claim-loss outcome label can be wrong under a real
   concurrency race (`libs/api/marketing/src/lib/waitlist/waitlist.service.ts:270-278`). No data
   corruption, but misinforms the admin/audit trail about payment status for that row.
2. **Moderate** — Failure mode 2 above: `libs/web/admin/src/lib/overview/overview.ts:70-74` is an
   orphaned consumer of the old, R1.2-violating waitlist-uninvited formula; the new authoritative
   field on the stats response is ignored. Not owned by either batch's file list — a scope gap, not
   a Batch A code defect, but it undercuts the correctness this task delivers on a different screen.
3. **Minor** — `buildWaitlistWhere` is invoked twice per `list()` call with the same filters except
   `stage` (`admin-waitlist.service.ts:151-152`), running the reversed-date-range check redundantly.
   Harmless today (same inputs, same exception either way) but a future edit that changes one call
   site's inputs without the other could silently desync date validation between the page/`total`
   query and the stage-count queries. Consider validating the range once and passing the validated
   bounds to both `buildWaitlistWhere` calls.
4. **Minor** — `admin-waitlist.controller.spec.ts:144-159` infers route-declaration order from
   `Object.getOwnPropertyNames(proto)`, which is an implementation detail of V8's own-property
   enumeration order for method definitions rather than a documented contract of the language. It
   happens to track Nest's route-registration order today (methods are registered in declaration
   order), so the test is a reasonable proxy, but it is worth a comment noting the assumption since
   a refactor that reorders via `Object.defineProperty` or mixins would silently stop being caught
   by `route-map.spec.ts`'s route list (which asserts existence, not order).

## Data flow

1. `GET /v1/admin/waitlist{,/eligible-ids,/export.csv,/:id/details}` — class-guarded by
   `JwtAuthGuard`→`AdminGuard` (`admin-waitlist.controller.ts:54-55`). OK.
2. Query/param bound via `dtoPipe(WaitlistListQueryDto | WaitlistFilterQueryDto |
WaitlistIdParamsDto)` on every handler (`admin-waitlist.controller.ts:71,82,94,119`), asserted
   structurally by `controller-validation.spec.ts`'s updated `MIN_TOTAL_PAYLOAD_PARAMS = 83`. OK.
3. DTO decorators allowlist every field from the SAME constants the policy module exports
   (`admin-waitlist.dto.ts:14-25`), so DTO and policy cannot drift. OK.
4. `AdminWaitlistService` builds `where`/`orderBy` exclusively through `waitlist-query.ts` — no
   ad hoc predicate construction anywhere in the service. OK.
5. List/eligible-ids/export/details each run their reads in one `$transaction` or a minimal
   sequential set (details: entry read, then one array transaction for user+audit). OK — matches
   the "no per-list-row relationship query" requirement.
6. Stage/eligibility/counts are derived once, in `waitlist-query.ts`, and reused by `list`,
   `resolveEligibleIds`, `exportCsv`, `getDetails`, and `AdminService.getStats`. OK — single source
   of truth, verified by the shared-predicate assertions in both spec files.
7. Export: count → 413 gate → findMany (bounded `take`) → CSV encode (formula-neutralize before
   quote) → audit write (awaited) → controller sets headers → body returned. Audit failure short-
   circuits before headers are set. OK, matches the contract's audit-before-bytes requirement.
8. Approval claim: `findUnique` (advisory) → `updateMany` with both null guards → outcome derived
   from `count` plus the advisory read. **Gap**: outcome label can be stale under the exact race the
   guard was added to defend against (Failure mode 1) — the write itself is still race-safe.
9. Stats: seven `waitlist.count` calls in one transaction (total + 4 disjoint stage predicates +
   raw notified + last7Days), summed client-side into `pending`; `attention.waitlistUninvited =
new`. OK on the backend; **unconsumed correctly by one existing frontend screen** (Failure mode 2,
   outside Batch A).

## Requirements fulfilment

| Requirement                                                            | Status   | Gap                                                                                                                                                                       |
| ---------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1.1/AC-R1.1 disjoint stage precedence                                 | COMPLETE | None — 8/8 combinations proven pure and via predicate cross-check.                                                                                                        |
| R1.2/AC-R1.2 accurate summary counts (Pipeline)                        | COMPLETE | Pipeline/stats backend fields correct; Overview UI (out of Batch A) still shows the old formula (Failure mode 2).                                                         |
| R1.3/AC-R1.3 approval eligibility (both stamps absent)                 | COMPLETE | Enforced server-side in `WAITLIST_ELIGIBLE_PREDICATE`, the claim `WHERE`, and `approvalEligible` wire field.                                                              |
| R2.1/R2.5 combined filters, boundary validation                        | COMPLETE | AND semantics, closed allowlists, reversed-range 400 all proven.                                                                                                          |
| R2.3 pagination/page size                                              | COMPLETE | 10/25/50/100 allowlist, deterministic order with id tie-breaker.                                                                                                          |
| Stage predicate contract (exhaustive/disjoint sum)                     | COMPLETE | `new+invited+approved+converted === all` proven by construction and by count-call assertions.                                                                             |
| Eligible-ids capped selection (R3.2/AC-R3.2)                           | COMPLETE | 50-cap, `eligibleMatching`, `truncated` all correct and tested.                                                                                                           |
| CSV export (R3.4/AC-R3.4) contract, formula safety, audit-before-bytes | COMPLETE | Exact header/order, quoting, formula neutralization, fail-closed audit all match plan and are tested.                                                                     |
| Approval hardening — converted claim (Component 4)                     | PARTIAL  | Grant refusal is correct and race-safe; **outcome label** (`already_paid` vs `already_approved`) can be wrong under the very race the hardening targets (Failure mode 1). |
| Stats contract (pending/new/invited, attention=new)                    | COMPLETE | Backend fields correct and tested; one existing consumer (`overview.ts`) not migrated — outside Batch A's or Batch B's file ownership per the plan.                       |
| Module DI resolvable                                                   | COMPLETE | `AdminWaitlistService` depends only on `@Global()` `PrismaService`/`AuditLogService`; no new module edge needed.                                                          |
| Structural specs (route-map, controller-validation)                    | COMPLETE | Honestly updated counts with derivations shown in comments, not just bumped numbers.                                                                                      |

Implicit requirements not addressed: none beyond the two Moderate findings above.

## Edge cases

| Case                                                              | Handled | How                                                                     | Concern                                                                                       |
| ----------------------------------------------------------------- | ------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| All 8 lifecycle-timestamp combinations                            | YES     | `deriveWaitlistStage` + predicate cross-check, unit-tested exhaustively | None                                                                                          |
| Reversed `createdFrom`/`createdTo`                                | YES     | `BadRequestException INVALID_DATE_RANGE` before any query               | None                                                                                          |
| Equal `createdFrom === createdTo`                                 | YES     | Inclusive bounds accepted                                               | None                                                                                          |
| Page beyond last page                                             | YES     | Empty `data`, accurate `total`/`totalPages`                             | None                                                                                          |
| `source = 'unknown'`                                              | YES     | Maps to `source: null`                                                  | Stored literal string `"unknown"` would not match this filter — accepted/intentional per plan |
| Eligible-ids > 50 matches                                         | YES     | `truncated: true`, `eligibleMatching` shows real count                  | None                                                                                          |
| Export > 50,000 matches                                           | YES     | 413 before any row fetch                                                | None                                                                                          |
| Export audit write fails                                          | YES     | 503, no CSV sent                                                        | None                                                                                          |
| CSV formula-prefixed cell (`=`,`+`,`-`,`@`, leading tab/CR/space) | YES     | Neutralization before quoting, tested with a hostile row                | None                                                                                          |
| Missing waitlist id at `:id/details`                              | YES     | 404 `WAITLIST_NOT_FOUND`, no downstream queries run                     | None                                                                                          |
| Entry with no matching user                                       | YES     | `user: null`, empty arrays, never an error                              | None                                                                                          |
| Unexpected Prisma/audit failure (list/eligible/export/details)    | YES     | Sanitized 503 with route-specific code, cause logged server-side only   | None                                                                                          |
| Concurrent approve + Paddle conversion race                       | PARTIAL | Grant correctly refused                                                 | Outcome label can misreport `already_approved` vs `already_paid` (Failure mode 1)             |
| Static route vs `:id/details` shadowing                           | YES     | Declaration order + route-map assertions                                | Order test relies on `Object.getOwnPropertyNames` enumeration order (Minor #4)                |
| Stats consumed by other UI (Overview)                             | NO      | N/A                                                                     | `overview.ts` still uses the pre-task formula (Failure mode 2), unclaimed by either batch     |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: the claim-loss outcome mislabeling (Failure mode 1) is the only finding with real
  behavioral incorrectness inside Batch A's own files; it is narrow-window, non-data-corrupting, and
  arguably acceptable given the "outcome is advisory, count is truth" framing already in the
  codebase, but it should be a deliberate, tracked decision rather than an implicit one.
- What a robust implementation would add: (1) re-read `convertedAt` after a failed claim update
  before choosing between `already_approved`/`already_paid`, or explicitly narrow the JSDoc's
  correctness claim; (2) a tracked follow-up item (not a Batch A blocker) to point
  `overview.ts`'s `waitlistUninvited` computed signal at the new `attention.waitlistUninvited` wire
  field instead of re-deriving it, so the two admin screens cannot disagree; (3) validate the
  reversed-date range once per request and share the result across the page/count `where` builds in
  `admin-waitlist.service.ts:151-152` rather than re-deriving it.
