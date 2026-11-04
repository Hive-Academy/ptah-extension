# Code Logic Review — P2 phase `TASK_2026_873_f748`

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 4/10 |
| Assessment | NEEDS_REVISION |
| Verdict | REVISE |
| Blocking issues | 2 |
| Serious issues | 5 |
| Moderate issues | 2 |
| Failure modes found | 7 |

Score 4: the live path can post, cap inline comments at 10, refuse a stale head, and keep the bot token out of RPC results. It is not a 1–2 because those guards and the migration are real. It is not a 5–6 because the retry path AC-11.3 depends on drops unpublished findings and can then refuse to reconcile, and a second distinct bug on the same path is withheld. No review skill was assigned; none was loaded. Source was not edited. Nx was not run.

## Five logic questions

### 1. How does this fail silently?

A verified finding is inserted as an open root, GitHub then times out, and the next attempt treats that root as `still_open` and omits it from the candidate list (`review-publication.service.ts:92`). The outbox can still confirm a review for that head. The run looks published. The comment is absent. If the overview text changed, reconciliation does not run at all: `publication-outbox.repository.ts:125` throws while the row is still `unknown`.

### 2. What user action produces unexpected behaviour?

A second accepted bug in the same file and category, with different failure text, is stored as `uncertain` and is not posted (`publication-outbox.repository.ts:29-34`). A later push that brings a fixed bug back is marked `reopened` in SQLite and then suppressed as a previously identified root, so GitHub never says it reopened (`review-publication.service.ts:93-96`). Unchecking dry-run, or calling `review:rerun` with `dryRun: false`, does not require a verified token scope (`review-policy.service.ts:56-65`, `apps/ptah-electron/src/di/phase-2-libraries.ts:407-421`).

### 3. What input data produces a wrong answer?

Identity is exact `failure_mode` plus `affected_behavior` text, with `symbol` forced to null (`publication-outbox.repository.ts:64`). A reworded same bug does not reuse the prior ULID. A distinct bug on that path does not get its own ULID. `FindingIdentityService` would do both (`finding-identity.service.spec.ts:27-33`), but publication never passes a semantic verdict. An addressed reason that does not start with "Fixed" or "resolved" stays open (`review-publication.service.ts:61-62`).

### 4. What happens when a dependency fails?

`PublicationOutboxService` marks the intent `unknown` after a thrown publish (`publication-outbox.service.ts:54-58`). The adapter can match its own walkthrough and head marker before creating another object (`github-review-publication.adapter.ts:153-180`). That reconcile call is skipped when the stored review hash differs and the row is not `confirmed`. A second addressed follow-up for the same finding violates `idx_review_publications_finding_kind` and aborts the whole `plan()` (`0066_review_publication.ts:21-22`). The in-memory per-PR lock does not cover a second process (`publication-outbox.service.ts:20-28`).

### 5. What is missing that the requirements never mentioned?

Nothing material beyond the written contract. The plan already required verifier `same` / `distinct` / `uncertain`, one identity transaction per PR, marker reconcile after unknown outcomes, and a scope check before live enablement. Those are unimplemented or bypassed, not unspecified.

## Findings

### 1. Blocker — a changed review body blocks timeout reconciliation

- File: `libs/backend/review-core/src/lib/publication/publication-outbox.repository.ts:125`
- Scenario: The first publish writes a review intent, GitHub times out or the process dies, and the row stays `inflight` or `unknown` (`publication-outbox.service.ts:44-58`). The retry builds a different overview because suppressed or still-open findings changed the sentence at `review-publication.service.ts:120`. `plan()` updates a walkthrough hash, then throws `Publication intent changed after planning` for the review or follow-up. `publisher.publish` is never called, so the adapter never lists bot-owned markers. The same throw repeats on every later attempt.
- Fix: If the row is `unknown` or `inflight`, reconcile by marker and stored GitHub id before comparing hashes. When no object exists, replace the stored hash and post the new body. When the object exists, keep its id and do not throw. Reserve the hash rejection for two different confirmed bodies.

### 2. Blocker — `still_open` treats a never-posted root as already published

- File: `libs/backend/review-core/src/lib/publication/review-publication.service.ts:92`
- Scenario: `identity()` commits the root before GitHub is called (`publication-outbox.repository.ts:76-102`). The publish then fails. The next pass matches the same failure text, gets `still_open`, and `continue`s. The candidate list is empty. If finding 1 did not throw, the adapter would create or reuse a COMMENT review with no inline comment and the outbox would mark it `confirmed` (`publication-outbox.service.ts:50-53`). An existing head review also returns immediately and drops any comments that were not on that object (`github-review-publication.adapter.ts:180`).
- Fix: Skip a root only when a `confirmed` publication or a bot-owned `ptah-review:finding:` marker proves that finding was posted. Otherwise send it again. If a head review already exists and this attempt still has unposted candidates, do not confirm those candidates against that review.

### 3. Major — repository identity ignores symbol and wording

- File: `libs/backend/review-core/src/lib/publication/publication-outbox.repository.ts:29-34`
- Scenario: `proposeIdentity` loads prior rows only by path and category. One exact failure-mode and affected-behavior pair becomes `same`. Zero rows becomes `distinct`. Any other row becomes `uncertain`. `identity()` then calls `FindingIdentityService.decide` with `symbol: null` (`publication-outbox.repository.ts:64`), which disables the symbol shortlist (`finding-identity.service.ts:34-36`). A reworded same bug does not keep the prior ULID. A second bug in the same symbol becomes `identity-uncertain`, is left out of `selected`, and is counted only as "held locally" (`review-publication.service.ts:91` and `:120`). The preview was already written as accepted (`publication-stage.runner.ts:41-64`). Migration `0066` adds `symbol_id`, and the insert never sets it (`0066_review_publication.ts:4`, `publication-outbox.repository.ts:77-82`).
- Fix: Shortlist inside the per-PR transaction by path, symbol, and category. Pass the verifier `same` / `distinct` / `uncertain` verdict into `decide`. Use exact text only as a fast confirmation of `same`. Persist `symbol_id`. Keep `uncertain` out of GitHub and record that reason on the preview, not only in the overview count.

### 4. Major — a regression is reopened in SQLite and hidden on GitHub

- File: `libs/backend/review-core/src/lib/publication/review-publication.service.ts:93-96`
- Scenario: An accepted match of an `addressed` root calls `FindingRecheckService` with a synthesized `still_present` and becomes `reopened` (`publication-outbox.repository.ts:89-96`). On any head after the first, `publishNewVerifiedRootsOnly` is true (`incremental-scope.service.ts:36`). The reopened outcome is not `new`, so the finding is pushed onto a local suppressed list and never given to the adapter. `repository.suppress` is not called on this branch. AC-8.5 asks for the regression to be clearly marked as reopened.
- Fix: Post one follow-up whose body says the prior id reopened, with the new evidence. Do not classify that follow-up as a new inline root, and do persist the suppression or publication row that explains it.

### 5. Major — ranked-out findings never reach the review summary

- File: `libs/backend/review-core/src/lib/publication/review-publication.service.ts:115-124`
- Scenario: The service keeps at most `min(maxNewInline, 10)` RIGHT anchors and passes only that slice as `candidates`. The adapter can append deferred findings to the review body (`github-review-publication.adapter.ts:181-182`), but it never receives the overflow. The overview is only `N verified new findings; M held locally`. FR-10 asks for a concise summary of the additional verified findings and for their count. The count is present. The findings are not.
- Fix: Pass the overflow in the overview, or pass them as candidates and let the adapter place them in the summary. Keep the inline cap at 10.

### 6. Major — a second addressed follow-up aborts publication

- File: `libs/backend/persistence-sqlite/src/lib/migrations/0066_review_publication.ts:21-22`
- Scenario: `idx_review_publications_finding_kind` allows one `follow_up` row per finding id. `plan()` inserts with `ON CONFLICT(repo_id, pr_number, head_sha, kind, publication_key) DO NOTHING` (`publication-outbox.repository.ts:111-116`). That conflict target does not cover the partial index. After a fix, a reopen, and a second fix, the new head's follow-up insert throws. Walkthrough planning may already have reset the walkthrough row to `planned`. The new head's review is not posted. The same throw happens when the first follow-up is still `unknown` and a later head retries it.
- Fix: Conflict on the finding follow-up index, reuse the existing row when it is already confirmed, and reconcile it when it is `unknown`. Do not let that constraint abort the walkthrough and review intents.

### 7. Major — live enablement does not require bot identity or scopes

- File: `apps/ptah-electron/src/di/phase-2-libraries.ts:407-421`
- Scenario: `mayPublish` returns true when a token exists, eligibility passes, and `publication()` allows. `publication()` checks pause and dry-run only (`review-policy.service.ts:56-65`). It does not read `review:getBotIdentity`. That method copies `x-oauth-scopes` (`review-rpc.handlers.ts:76-77`), which is empty for a fine-grained PAT, and it does not look at the result before a live rerun (`review-rpc.handlers.ts:97-106`). Saving dry-run off through `review:updateSettings` has the same hole. A live rerun is queued, and the first blocked write is a later 401/403, which then lands in `unknown`.
- Fix: Before dry-run can be turned off and before a live rerun is queued, require a successful identity check and the pull-request write permission the bot will use. Teach `mayPublish` the same check so a mutation cannot start after the token loses scope.

## Moderate and minor issues

### 8. Minor — "fixed" is a reason prefix, not the disproved verdict

- File: `libs/backend/review-core/src/lib/publication/review-publication.service.ts:61-62`
- Scenario: A current-head `disproved` verdict whose reason is "the failure path is gone" does not match `/^(?:fixed|resolved)\b|\bno longer present\b/i`. The finding stays open and no addressed follow-up is stored. The spec passes only because its reason begins with "Fixed".
- Fix: Treat verifier `disproved` plus a `same` prior id in `recheckFailureIds` as the confirmation. Keep the evidence text in the follow-up body.

### 9. Minor — production redaction secrets are empty, and connection time is "now"

- File: `apps/ptah-electron/src/services/review/electron-review-environment.ts:64-83`
- Scenario: `ElectronReviewEnvironment` does not implement `redactionSecrets`. `PublicationStageRunner` therefore scrubs with an empty list (`publication-stage.runner.ts:36`). Shape regex in the artifact writer and `safeText` still catches `ghp_` / `github_pat_` / `sk-` and local-path shapes, and the adapter refuses a body that contains the stored bot token (`github-review-publication.adapter.ts:149-152`). A canary that does not match those shapes is written to the preview. `review:getBotIdentity` sets both `connectedAt` and `verifiedAt` to the current time (`review-rpc.handlers.ts:74-77`), so the drawer cannot show when the token was stored.
- Fix: Pass the bot token and any operator canaries into `redactionSecrets` without logging them. Persist the first successful connection time.

## Data flow

1. Discovery enqueues the current open head. After 48 hours, `startupPoll` calls `discovery.run()`, which lists open PRs and enqueues each current head once (`review-orchestrator.service.ts:78-81`, `discovery-stage.runner.ts:24-34`). `reconcileStartup([])` only expires leases. OK for the 48h catch-up.
2. Context loads the last succeeded head and open finding ids, then sets `publishNewVerifiedRootsOnly` when a previous head exists. OK. The triage prompt tells the lane to recheck those ids (`triage.prompt.ts:5`).
3. Publication filters verdicts, assigns identity, then calls the outbox. Gap: findings 2, 3, and 4.
4. The outbox plans intent rows, then calls the adapter. Gap: findings 1 and 6.
5. The adapter checks the guard, reads the head, checks the guard again, and does that inside every POST and PATCH, including the 422 body-only retry (`github-review-publication.adapter.ts:59-75` and `:189-193`). Event is `COMMENT`. OK, except finding 2's early return when a head review already exists.
6. RPC parses the four new methods with Zod. Live rerun checks the open head, eligibility, and pause. Gap: finding 7. Pause-off sends `setPublicationPause(false)` only after confirmation (`review-runs.store.ts:175-176`, `review-settings-drawer.component.ts:81-87`). Live rerun opens the confirm dialog before `rerun(..., false)` (`review-run-detail.component.ts:48-56`). The token field is `type="password"`, is cleared before save, and is not returned by the read DTO. OK.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Per-PR outbox, intent before call, ids after, marker reconcile | PARTIAL | Findings 1, 2, and 6 |
| Head and pause guard before every mutation | COMPLETE | Adapter `request()` rechecks; unchanged walkthrough does not write |
| One COMMENT review per head, ≤10 new RIGHT anchors, suppression reasons | PARTIAL | Cap is enforced; summary and some reasons are not (findings 4 and 5) |
| Reworded same bug dedupes; distinct same-symbol bug stays distinct; fix/reopen confirmed | PARTIAL | Service contract is correct; repository bypasses it (findings 3, 4, and 8) |
| New verified roots only; old failures rechecked; 48h latest head once | PARTIAL | Scope and 48h discovery are wired; reopen and retry publication are not |
| Bot token only in secret storage; redaction | PARTIAL | Token is not echoed; production canary list is empty (finding 9) |
| Zod on the four RPC methods; live rerun head and kill switch | PARTIAL | Zod and head/pause checks exist; scopes do not (finding 7) |
| Pause-off and live rerun confirmation; write-only token | COMPLETE | Checked in the drawer and store |
| Migration 0066 forward-only; 0065 SQL untouched | COMPLETE | 0066 only adds columns and indexes. The 0065 spec now expects max version `>= 65` |

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Timeout then same body | YES | Unknown row, second `publish`, marker read | Only when the overview hash is unchanged |
| Timeout then changed overview | NO | `plan()` throws | Finding 1 |
| Identity saved, GitHub not posted | NO | Next pass is `still_open` | Finding 2 |
| Two bugs, one path and category | NO | Second is `uncertain` | Finding 3 |
| Line move, same failure text | YES | Exact text reuses the prior id | Rewording is not covered |
| 422 invalid anchor | YES | Guard runs again, one body-only POST | Does not list reviews between the two POSTs |
| Kill switch during POST | YES | `mayPublish` false throws before fetch | Scope loss is not part of that check |
| Second process, same PR | NO | `active` set is process-local | Duplicate posts are possible outside one Electron process |

## Decisions

- Semantic identity is required here. The alternative, exact failure text only, is what the code does. The plan (`implementation-plan.md` identity paragraph) and `finding-identity.service.spec.ts:27-33` require rewording and a distinct same-symbol bug. The repository bypass is a defect. Reversible by feeding `decide` a real verdict.
- A follow-up folded into the new head's overview is enough for the first addressed post. A second follow-up must not throw. Reversible by changing the conflict target.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: a timed-out publish either sticks in `unknown` or confirms a review that never received the verified comments.
- What a robust implementation would add: hash-tolerant marker reconcile, publish-if-unconfirmed identity, verifier relation plus symbol shortlist in one transaction, reopened and overflow text on the review, one follow-up row that can be reused, and a scope check before live mode.
