# Code Logic Review — `TASK_2026_873_f748` (P2 Minor Fix Review)

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 9/10 |
| Assessment | APPROVED |
| Verdict | APPROVE |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 0 |
| Minor issues | 1 |
| Failure modes found | 0 |

Score 9/10: Both Round-3 Minor findings are resolved cleanly with direct SQLite and unit regression coverage. It sits in the 9–10 band (exemplary for the scoped delta) rather than 7–8 because no Blocking, Serious, or Moderate defects exist in the changed paths and all four verification criteria hold under schema and boundary analysis. A single non-blocking Minor observation is noted regarding `getOpenFailures` when an `addressed` follow-up fails publication and the operator later invokes a manual `retryHead` / `rerun` with a new `attemptId`. No skill was assigned; none was loaded. Source was not edited.

## Verification of Scoped Changes

### 1. `pendingFollowUp(attemptId, findingId)` JOIN correctness (`publication-outbox.repository.ts:110-131`)

```sql
SELECT p.marker FROM review_publications p
JOIN review_attempts a ON a.repo_id = p.repo_id AND a.pr_number = p.pr_number AND a.head_sha = p.head_sha
WHERE a.attempt_id = ? AND p.finding_id = ? AND p.kind = 'follow_up' AND p.state != 'confirmed'
LIMIT 1
```

- **Different head or PR?** Cannot match. `review_attempts.attempt_id` is a `PRIMARY KEY` (`0065_ptah_review.ts:43`), so `WHERE a.attempt_id = ?` binds `a` to at most one `(repo_id, pr_number, head_sha)` tuple, and the `JOIN` predicate `ON a.repo_id = p.repo_id AND a.pr_number = p.pr_number AND a.head_sha = p.head_sha` restricts `p` to that exact repository, PR number, and head SHA.
- **Superseded head?** Cannot match a different head. A follow-up planned on an earlier head has that earlier `head_sha` in `review_publications.head_sha` (`publication-outbox.repository.ts:557-575`), which will not join against a new attempt on a newer head SHA. If an attempt is running on the same SHA (e.g., force-push back to a previously seen SHA or manual retry of the current active head), replaying an unconfirmed (`state != 'confirmed'`) follow-up for that exact `(repo_id, pr_number, head_sha)` is the intended idempotent behavior.
- **Confirmed row?** Excluded by `AND p.state != 'confirmed'` (`publication-outbox.repository.ts:120`), matching the `CHECK (state IN ('planned', 'inflight', 'confirmed', 'unknown'))` constraint in `0065_ptah_review.ts:150`.
- **Multiple rows / `LIMIT 1` determinism?** In `PublicationOutboxRepository.identity()` (`publication-outbox.repository.ts:503-510`) and `PublicationOutboxService.publish()` (`publication-outbox.service.ts:62-69`), `follow_up` rows are planned with `key: findingId` (`publication_key = finding_id`). Because `review_publications` enforces `UNIQUE (repo_id, pr_number, head_sha, kind, publication_key)` (`0065_ptah_review.ts:155`), at most one `follow_up` row exists per `(repo_id, pr_number, head_sha, finding_id)` in production flows.

### 2. `pendingFollowUp` callers (`review-publication.service.ts:71, 93`)

- **Reopened caller (`review-publication.service.ts:93`):** When attempt 1 transitions a prior `addressed` finding to `reopened` (`publication-outbox.repository.ts:502-520`) and publication subsequently fails, `review_findings.status` is `'reopened'` and `review_publications` holds an unconfirmed `follow_up` row with marker `<!-- ptah-review:reopened:<id> -->`. On a manual `retryHead` / `rerun` (attempt 2, new `attemptId`, same `head_sha`), `SqliteReviewRepository.getOpenFailures` (`sqlite-review.repository.ts:43-44`) includes `status IN ('open', 'reopened')`, the verifier accepts the candidate, `repository.identity()` returns `outcome: 'still_open'` (since `prior.status` is now `'reopened'`), and `repository.pendingFollowUp(claim.attemptId, identity.findingId) === 'reopened'` at `review-publication.service.ts:93` evaluates to `true` via the new JOIN, re-emitting the reopened follow-up and skipping duplicate root selection.
- **Addressed caller (`review-publication.service.ts:71`):** When `verdicts` contains a `disproved` verdict for a finding in `scope.recheckFailureIds`, `repository.identity()` returns `'uncertain'` if `prior.status` was already transitioned to `'addressed'` on attempt 1 (`publication-outbox.repository.ts:486-488`), and `repository.pendingFollowUp(claim.attemptId, verdict.priorFindingId) === 'addressed'` at `review-publication.service.ts:71` evaluates to `true` via the new JOIN. (See Minor observation below regarding how `scope.recheckFailureIds` is populated on a fresh manual attempt vs. same-attempt retry.)

### 3. Follow-up marker derivation in `PublicationOutboxService.publish` (`publication-outbox.service.ts:61-70`)

- Line 67 computes:
  ```ts
  marker: `<!-- ptah-review:${item.body.includes(`ptah-review:reopened:${item.findingId}`) ? 'reopened' : 'addressed'}:${item.findingId} -->`
  ```
- **Can this mislabel an addressed follow-up?** No. `ReviewPublicationService` constructs addressed follow-up bodies with suffix `\n<!-- ptah-review:addressed:${verdict.priorFindingId} -->` (`review-publication.service.ts:72-73`) and reopened follow-up bodies with suffix `\n<!-- ptah-review:reopened:${identity.findingId} -->` (`review-publication.service.ts:94-95`). Moreover, `findingId` is a 26-character Crockford base32 ULID (`0065_ptah_review.ts:89`), and user/model text in `item.body` cannot accidentally forge `ptah-review:reopened:<findingId>` unless that exact marker is present. When pre-planned by `PublicationOutboxRepository.identity()` (`publication-outbox.repository.ts:508`), the marker in `outbox.plan` now matches the pre-planned marker identically.

### 4. Regression tests (`publication-outbox.service.spec.ts:181-198, 255-312`)

- **Manual-retry test (`publication-outbox.service.spec.ts:181-198`):** Marks the initial `'attempt'` as `'failed'` (respecting `idx_review_attempts_one_running_pr`, `0065_ptah_review.ts:67-68`), inserts `'manual-retry'` on the same `(repo_id, pr_number, head_sha)` with `attempt_number = 2`, and verifies `repository.pendingFollowUp('manual-retry', findingId)` returns `'reopened'`.
- **Unplanned reopened follow-up test (`publication-outbox.service.spec.ts:255-312`):** Calls `service.publish` directly with a `followUps` entry containing `<!-- ptah-review:reopened:${findingId} -->` without calling `repository.identity()` first, simulates a publisher timeout, and asserts `pendingFollowUp('attempt', findingId)` returns `'reopened'`.

## Five logic questions

### 1. How does this fail silently?

- For an `addressed` follow-up: if attempt 1 transitions `review_findings.status` from `'open'` / `'reopened'` to `'addressed'` (`publication-outbox.repository.ts:511-520`) and GitHub publication then fails, and the attempt is not recovered via lease expiry (`reconcileExpiredLeases`, which reuses `attemptId` and stage checkpoints) but instead fails terminally and is followed by a manual `retryHead` / `rerun` (attempt 2, new `attemptId`), `ContextStageRunner.run` (`context-stage.runner.ts:99`) calls `SqliteReviewRepository.getOpenFailures` (`sqlite-review.repository.ts:43-44`). Because `getOpenFailures` filters `WHERE status IN ('open', 'reopened')`, the already-`'addressed'` finding is not in `scope.recheckFailureIds` on attempt 2, so `review-publication.service.ts:65` (`scope.recheckFailureIds.includes(verdict.priorFindingId)`) is not reached during a fresh context + lens + verifier run (Minor 1). By contrast, `reopened` findings have `status = 'reopened'`, so `getOpenFailures` includes them and attempt 2 replays the `reopened` follow-up end-to-end.

### 2. What user action produces unexpected behaviour?

- None in the primary flows. Manual `retryHead` / `rerun` after a failed publication replays unconfirmed `reopened` follow-ups end-to-end and `pendingFollowUp` resolves across attempt IDs on the same head.

### 3. What input data produces a wrong answer?

- None identified in the scoped changes. The marker check `item.body.includes(\`ptah-review:reopened:${item.findingId}\`)` is scoped to the specific 26-char ULID `findingId`.

### 4. What happens when a dependency fails?

- When `publisher.publish` throws (e.g. GitHub timeout), `PublicationOutboxService.publish` marks `walkthrough`, `review`, and `followUps` rows `'unknown'` (`publication-outbox.service.ts:112-116`) and rethrows; `pendingFollowUp` matches any row with `state != 'confirmed'` across attempts sharing `(repo_id, pr_number, head_sha)`.

### 5. What is missing that the requirements never mentioned?

- Nothing blocking or major.

## Minor Issues

### 1. Minor — `getOpenFailures` excludes findings with an unconfirmed `'addressed'` follow-up on the current head when starting a new manual attempt

- File: `libs/backend/review-core/src/lib/persistence/sqlite-review.repository.ts:43-44` (interacting with `libs/backend/review-core/src/lib/publication/review-publication.service.ts:65,71`)
- Scenario: Attempt 1 disproves a prior open finding; `repository.identity()` updates `review_findings.status = 'addressed'` and plans the `follow_up` row (`publication-outbox.repository.ts:503-520`), then `publisher.publish` fails. If the operator triggers a manual `retryHead` / `rerun` (creating Attempt 2 with no stage checkpoints), `ContextStageRunner` calls `getOpenFailures`, which only selects `status IN ('open', 'reopened')`. Because the finding's status is already `'addressed'`, it is omitted from `scope.recheckFailureIds`, so Attempt 2 will not re-verify or hit `review-publication.service.ts:71` (`pendingFollowUp` for `'addressed'`) unless `getOpenFailures` also includes findings with an unconfirmed `follow_up` publication or `ReviewPublicationService` drains unconfirmed `follow_up` rows for the head directly. (Note: `reopened` findings are unaffected because their status is `'reopened'`, which `getOpenFailures` selects.)
- Fix (optional hardening): Either drain unconfirmed `follow_up` rows for `(repo_id, pr_number, head_sha)` directly in `ReviewPublicationService.publish`, or include findings that have a non-confirmed `follow_up` row in `getOpenFailures`.

## Verification Evidence

- `ptah_get_diagnostics` on `publication-outbox.repository.ts`, `publication-outbox.service.ts`, and `publication-outbox.service.spec.ts`: 0 errors, 0 warnings (`clean: true`).
- `npx jest --config libs/backend/review-core/jest.config.ts publication --coverage=false --runInBand`: 5 suites passed, 19 tests passed.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: Minor only — an `addressed` transition whose GitHub publication fails before a manual `retryHead` (new attempt ID) is not re-queued into `recheckFailureIds` by `getOpenFailures`, whereas `reopened` transitions are.
