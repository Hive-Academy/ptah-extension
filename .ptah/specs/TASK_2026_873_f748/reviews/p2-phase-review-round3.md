# Code Logic Review (Round 3) — P2 phase `TASK_2026_873_f748`

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 8/10 |
| Assessment | SOUND |
| Verdict | APPROVE |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 2 |
| Failure modes found | 2 |

Score 8/10: All 4 previously partial rows (Findings 2, 4, 6, 7) and all 5 Round-2 New Findings (1–5) are FIXED with regression tests. Specifically:
- Confirmed finding publications are recorded on `review_publications` (`publication-outbox.service.ts:54`, `publication-outbox.repository.ts:31-41`) and checked before incremental selection (`review-publication.service.ts:98-101,132`), so confirmed prior roots are suppressed as `previously-identified-root` while unconfirmed roots flow through marker reconciliation.
- Follow-ups (`addressed` and `reopened`) are planned in `review_publications` inside the same SQLite transaction as the `review_findings.status` transition (`publication-outbox.repository.ts:170-175`) and replayed via `pendingFollowUp` on retry after a timeout (`publication-outbox.repository.ts:43-49`, `review-publication.service.ts:71,93`).
- Reopened findings are included in `SqliteReviewRepository.getOpenFailures` (`sqlite-review.repository.ts:43-44`) and pass their actual status (`'reopened'`) into the fixed recheck (`publication-outbox.repository.ts:26-29`, `review-publication.service.ts:67`).
- Fresh-install bot verification, first-time live settings save, and post-token-replacement permission attestation work end-to-end (`review-rpc.handlers.ts:89-93,157-175`, `review-settings.store.ts:96-109`, `review-settings-drawer.component.ts:109-114`, `review-runs.store.ts:174`).
- Verified findings are persisted to SQLite in dry-run and paused modes even when `ReviewPublicationService` is injected (`publication-stage.runner.ts:58-59`).

It sits in the 7–8 band (sound) rather than 5–6 because no Blocker or Major logic defects remain in the P2 pipeline, and below 9–10 because of two minor non-blocking edge cases around cross-attempt follow-up replay after manual `retryHead` and fallback marker text in `PublicationOutboxService.publish`. No skill was assigned; none was loaded. Source was not edited.

## Status Table — Round-2 PARTIAL Rows (2, 4, 6, 7) and New Findings (1–5)

| Item | Description | Status | Evidence |
| --- | --- | --- | --- |
| Row 1 | Changed review body blocks timeout reconciliation | FIXED (Round 2) | `libs/backend/review-core/src/lib/publication/publication-outbox.repository.ts:198-203` refreshes `request_hash` and resets `state = 'planned'` for non-confirmed rows (`publication-outbox.service.spec.ts:35-41`). |
| Row 2 | `still_open` treats a never-posted root as already published | FIXED | `libs/backend/review-core/src/lib/publication/review-publication.service.ts:98-101,132` suppresses `identity.outcome !== 'new'` when `repository.hasConfirmedFinding(identity.findingId)` (`publication-outbox.repository.ts:31-35`) is true, and passes unconfirmed `still_open` roots to `GithubReviewPublicationAdapter.publish` (`github-review-publication.adapter.ts:168-176`) while `confirmFindingMarkers` (`publication-outbox.repository.ts:37-41`, `publication-outbox.service.ts:54`) records confirmed inline + overflow IDs (`review-publication.service.spec.ts:58-67`). |
| Row 3 | Repository identity ignores symbol and wording | FIXED (Round 2) | `libs/backend/review-core/src/lib/stages/verification-stage.runner.ts:36-66` and `libs/backend/review-core/src/lib/publication/publication-outbox.repository.ts:52-110,123-150` shortlist and stage semantic verifier identity (`publication-outbox.service.spec.ts:55-77`). |
| Row 4 | Regression is reopened in SQLite and hidden on GitHub | FIXED | `libs/backend/review-core/src/lib/publication/publication-outbox.repository.ts:170-175` plans the `reopened` follow-up inside the identity transaction and `libs/backend/review-core/src/lib/publication/review-publication.service.ts:93-97` emits the `<!-- ptah-review:reopened:<id> -->` follow-up on both initial execution and retry via `pendingFollowUp` (`review-publication.service.spec.ts:68-73,87-92`). |
| Row 5 | Ranked-out findings never reach the review summary | FIXED (Round 2) | `libs/backend/review-core/src/lib/publication/review-publication.service.ts:120-128` caps inline at 10 and lists overflow in `overview` (`review-publication.service.spec.ts:93-98`). |
| Row 6 | Second addressed follow-up aborts publication | FIXED | `libs/backend/persistence-sqlite/src/lib/migrations/0066_review_publication.ts:21-22` uses a non-unique `(finding_id, kind)` index, `libs/backend/review-core/src/lib/persistence/sqlite-review.repository.ts:43-44` loads `status IN ('open', 'reopened')`, and `libs/backend/review-core/src/lib/publication/review-publication.service.ts:67` passes `repository.findingStatus(verdict.priorFindingId) ?? 'open'` (`review-publication.service.spec.ts:80-86`, `publication-outbox.service.spec.ts:78-82`). |
| Row 7 | Live enablement does not require bot identity or scopes | FIXED | Per user decision (operator attestation + plaintext warning on Linux without keyring), `libs/backend/rpc-handlers/src/lib/handlers/review-rpc.handlers.ts:89-93,125-128,157-175`, `libs/backend/review-core/src/lib/persistence/review-settings.store.ts:96-109`, `apps/ptah-electron/src/di/phase-2-libraries.ts:411-414`, `libs/frontend/review-runs-ui/src/lib/components/review-settings-drawer.component.ts:38,109-114`, and `libs/frontend/review-runs-ui/src/lib/review-runs.store.ts:174` enforce and persist `LiveGateRecord` across fresh install, first save, and token replacement (`review-rpc.handlers.spec.ts:55-82,112-125`, `review-settings-drawer.component.spec.ts:43-61`). |
| Row 8 | "fixed" is a reason prefix, not the disproved verdict | FIXED (Round 2) | `libs/backend/review-core/src/lib/publication/review-publication.service.ts:61-75` keys on `output?.verdict === 'disproved'` (`review-publication.service.spec.ts:99-104`). |
| Row 9 | Production redaction secrets are empty, and connection time is "now" | FIXED (Round 2) | `apps/ptah-electron/src/services/review/electron-review-environment.ts:30,33-36` and `libs/backend/rpc-handlers/src/lib/handlers/review-rpc.handlers.ts:88-97` supply redaction secrets and preserve `connectedAt`. |
| New 1 | `publishNewVerifiedRootsOnly` dead code; `still_open` leaks into incremental overview/inline cap | FIXED | `libs/backend/review-core/src/lib/publication/review-publication.service.ts:98-101,132`, `libs/backend/review-core/src/lib/publication/publication-outbox.Service.ts:54`, and `libs/backend/review-core/src/lib/publication/publication-outbox.repository.ts:31-41` record confirmed finding markers (including overflow) and suppress confirmed prior roots before `selected` / `inline` / `overflow` (`review-publication.service.spec.ts:62-67`). |
| New 2 | Addressed and reopened follow-ups lost on retry after publication timeout | FIXED | `libs/backend/review-core/src/lib/publication/publication-outbox.repository.ts:43-49,170-175` plans the follow-up row with `<!-- ptah-review:${outcome}:${decision.findingId} -->` in the same transaction as the status update, and `libs/backend/review-core/src/lib/publication/review-publication.service.ts:71,93` replays pending `addressed` / `reopened` follow-ups when `pendingFollowUp` is non-null (`review-publication.service.spec.ts:68-79`, `publication-outbox.service.spec.ts:67`). |
| New 3 | Reopened finding can never be rechecked or marked addressed on a subsequent head | FIXED | `libs/backend/review-core/src/lib/persistence/sqlite-review.repository.ts:43-44` selects `status IN ('open', 'reopened')` and `libs/backend/review-core/src/lib/publication/review-publication.service.ts:67` passes `repository.findingStatus(verdict.priorFindingId) ?? 'open'` (`sqlite-review.repository.spec.ts:44`, `review-publication.service.spec.ts:80-86`). |
| New 4 | First-time settings save and post-token-replacement live attestation fail | FIXED | `libs/backend/rpc-handlers/src/lib/handlers/review-rpc.handlers.ts:90-93,157-175` falls back to default repo in `getBotIdentity`, saves settings before attestation in `updateSettings`, and guards repo-change reset on `old`; `libs/backend/review-core/src/lib/persistence/review-settings.store.ts:96-109` seeds default settings in `setLiveGate` when no row exists; `libs/frontend/review-runs-ui/src/lib/components/review-settings-drawer.component.ts:109-114` prompts `'live-enable'` after token replacement on an active live draft; and `libs/frontend/review-runs-ui/src/lib/review-runs.store.ts:174` falls back to `parsed.data.maintainerLogins[0]` (`review-rpc.handlers.spec.ts:55-82`, `review-settings-drawer.component.spec.ts:43-61`). |
| New 5 | Verified findings not persisted to SQLite in dry-run or paused mode when `ReviewPublicationService` is injected | FIXED | `libs/backend/review-core/src/lib/stages/publication-stage.runner.ts:58-59` runs `persistVerifiedFindings` whenever `!this.publication || !this.policy.publication(operatorSettings, baseConfig).allowed` (`publication-stage.runner.spec.ts:101-120`). |

## Five logic questions

### 1. How does this fail silently?

- If a publication attempt fails after `PublicationOutboxRepository.identity()` has already transitioned a finding to `addressed` or `reopened` (`publication-outbox.repository.ts:170-175`), automatic retry / lease recovery on the same `attemptId` replays the follow-up via `pendingFollowUp(claim.attemptId, ...)` (`publication-outbox.repository.ts:43-49`). However, if an operator triggers a manual `review:retryHead` or `review:rerun` (`review-rpc.handlers.ts:129-130,185-186`), a new `attemptId` is allocated while the unconfirmed `review_publications` row still has the previous `attempt_id`, so `pendingFollowUp(claim.attemptId, ...)` returns `null` (Minor Finding 1).

### 2. What user action produces unexpected behaviour?

- None of the primary operator flows fail: fresh install token connection, permission attestation, first-time live save, token replacement on an active live repository, and live rerun confirmation all complete as expected (`review-rpc.handlers.ts:89-93,157-175`, `review-settings-drawer.component.ts:109-114`).

### 3. What input data produces a wrong answer?

- If `PublicationOutboxService.publish` (`publication-outbox.service.ts:38-40`) is called directly with a `reopened` follow-up that was not pre-planned by `PublicationOutboxRepository.identity()` (`publication-outbox.repository.ts:171-172`), `outbox.plan` inserts `marker: <!-- ptah-review:addressed:${item.findingId} -->` instead of inspecting `item.body` for `:reopened:` (Minor Finding 2). In normal pipeline execution, `identity()` always pre-inserts the row with the `:reopened:` marker first, and `ON CONFLICT DO NOTHING` preserves it.

### 4. What happens when a dependency fails?

- When GitHub times out or returns 5xx/429 during `publisher.publish`, `PublicationOutboxService` marks the `walkthrough`, `review`, and `follow_up` rows `'unknown'` (`publication-outbox.service.ts:58-62`). On retry of the same attempt, `pendingFollowUp` restores `addressed` and `reopened` follow-ups (`review-publication.service.ts:71,93`), `plan()` updates `request_hash` for non-confirmed rows (`publication-outbox.repository.ts:198-202`), and `GithubReviewPublicationAdapter` reconciles bot-owned markers on GitHub before posting (`github-review-publication.adapter.ts:156-185`).

### 5. What is missing that the requirements never mentioned?

- Nothing material.

## New Findings (Round 3)

No new Blocker or Major defects were introduced by the Round-2 fixes. Two Minor non-blocking items are noted below:

### 1. Minor — `pendingFollowUp` filters by `attempt_id` rather than `(repo_id, pr_number, head_sha)`, so a manual `retryHead` / `rerun` with a new `attemptId` after a publication failure does not replay an unconfirmed follow-up

- File: `libs/backend/review-core/src/lib/publication/publication-outbox.repository.ts:43-49`
- Scenario: `PublicationOutboxRepository.plan` keys `review_publications` on `(repo_id, pr_number, head_sha, kind, publication_key)` (`publication-outbox.repository.ts:192`), leaving `attempt_id` set to the first attempt that planned the row. Lease recovery (`reconcileExpiredLeases`, `sqlite-review.repository.ts:183`) reuses the same `attempt_id`, so `pendingFollowUp(claim.attemptId, findingId)` works on automatic retries. However, if the attempt fails and the operator manually invokes `review:retryHead` or `review:rerun` (`review-rpc.handlers.ts:130,186`), a new `attemptId` is created for the same `head_sha`, causing `WHERE attempt_id = ?` in `pendingFollowUp` (and `status IN ('open', 'reopened')` in `getOpenFailures` for already-addressed findings) to miss the unconfirmed follow-up from the prior attempt on that head.
- Fix: Query `review_publications` in `pendingFollowUp` by `(repo_id, pr_number, head_sha)` (via the current attempt's head) rather than `attempt_id = ?`.

### 2. Minor — `PublicationOutboxService.publish` passes a hardcoded `:addressed:` marker to `outbox.plan` for follow-ups

- File: `libs/backend/review-core/src/lib/publication/publication-outbox.service.ts:38-40`
- Scenario: `outbox.plan` is called with `marker: <!-- ptah-review:addressed:${item.findingId} -->` for every item in `input.followUps`. In production flows `PublicationOutboxRepository.identity()` (`publication-outbox.repository.ts:171-172`) has already inserted the `follow_up` row with the accurate `<!-- ptah-review:${outcome}:${decision.findingId} -->` marker and `ON CONFLICT DO NOTHING` (`line 192`) preserves that marker, so runtime behavior is unaffected. However, any direct caller of `PublicationOutboxService.publish` that does not call `repository.identity()` first would record an `:addressed:` marker for a reopened follow-up.
- Fix: Derive the marker in `publication-outbox.service.ts:40` from `item.body.includes('<!-- ptah-review:reopened:') ? 'reopened' : 'addressed'`.

## Verification Evidence

- `npx jest --config libs/backend/review-core/jest.config.ts --coverage=false --runInBand`: 25 suites passed, 108 tests passed.
- `npx jest --config libs/backend/rpc-handlers/jest.config.ts libs/backend/rpc-handlers/src/lib/handlers/review-rpc.handlers.spec.ts --coverage=false --runInBand`: 1 suite passed, 27 tests passed.
- `npx jest --config libs/frontend/review-runs-ui/jest.config.ts --coverage=false --runInBand`: 7 suites passed, 23 tests passed.
- `ptah_get_diagnostics` timed out after 45s on cold workspace compiler warmup; fallback verification confirmed via focused Jest suites and full file inspection.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: Minor only — manual `retryHead` / `rerun` after a failed publication on the same head allocates a new `attemptId`, which does not match the prior attempt's `attempt_id` in `pendingFollowUp`.
