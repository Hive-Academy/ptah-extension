# P1 phase logic review — TASK_2026_873_f748

## Verdict

**REJECT** — score **4/10**.

The dry-run GitHub boundary, token handling, and path checks are real. A review of a real pull request still cannot finish: the worker's 60-second deadline expires during context collection, and the lane runner parses CLI stdout instead of the JSON file the prompt tells the model to write. Shutdown can close SQLite while that work is still writing. That is another pass, not a merge. It is not a 1–2, because the queue schema, Zod boundaries, and P1 write refusals are implemented. It is not a 5–6, because those two wiring faults fail every live attempt before a lens result exists.

| Metric | Value |
| --- | --- |
| Overall score | 4/10 |
| Assessment | REJECT |
| Blocking | 3 |
| Serious | 6 |
| Minor | 2 |
| Failure modes | 9 |
| Confidence | MEDIUM (source read; tests not re-run; helper lanes still running and were not used as evidence) |

Reviewed `git diff main...HEAD` on `feat/ptah-review`. Read in full: command runner, file adapter, GitHub adapter, queue service, SQLite repository, migration 0065, orchestrator, discovery/context/triage/lens/verification/publication runners, admission, lane runner, selector, parser, prompts, artifact writer, settings store, query repository, RPC handlers, Electron environment, lane gateway, worker activation, shutdown lease section, policy, checks, worktree, dependencies, context service. Decisions D27, D30, D31, D35, D40, and D29 were not scored.

## Five logic questions

### 1. How does this fail silently?

The worker treats a drained attempt as finished even when every lane returned `partial` because the deadline had already passed (`review-orchestrator.service.ts:89-112`). Publication still writes a preview and the attempt is released as `partial` or, for the lens rows, stored as stage state `completed` (`lens-stage.runner.ts:49-50`), which the query maps to `succeeded` (`review-query.repository.ts:43`). The operator sees a completed stage and a dry-run artifact that says no findings. A heartbeat or lease release that returns false is ignored (`review-orchestrator.service.ts:77-78` and `:111`), so the row can stay `running` while the log says the attempt ended.

### 2. What user action produces unexpected behaviour?

Opening the app and waiting for cron. Context creation hashes the whole tree and may run `npm ci` (`review-dependencies.service.ts:26`) with no view of the drain deadline. By the time triage starts, `Date.now()` is past the deadline passed from `review-worker.activation.ts:73`, and every lane bails (`review-lane.runner.ts:56`). Quitting Electron during that work calls `dispose()` which only clears the interval (`review-worker.activation.ts:79-84`). Five seconds later SQLite closes (`shutdown.ts:330-347`) while `process()` can still be inside `npm ci`, a lane wait, or `release()`.

### 3. What input data produces a wrong answer?

A force-push back to a SHA that already has any automatic attempt returns that old row and does not touch `review_heads` (`sqlite-review.repository.ts:52-54`). The active head stays on the SHA that is no longer the PR. A draft is not inserted at all (`discovery-stage.runner.ts:28-31`), so it is not "recorded but not reviewed" (AC-1.3). More than one verifier candidate on an attempt: admission allows 6 launches per attempt and does not read `laneCapPerPr` (`review-lane-admission.service.ts:34`). Triage plus four lenses consume five, so only the first finding is verified.

### 4. What happens when a dependency fails?

GitHub poll exceptions skip the `last_poll_at` update (good) but nothing writes `poll_status`, `poll_error`, or `review_poll_state` (columns exist only in `0065_ptah_review.ts:12-13` and `:163`). Startup failure is replaced with a generic `Error` (`review-worker.activation.ts:63-65`), so AC-1.5's visible failed poll does not exist. An expired lease is marked `interrupted` and is not queued again (`sqlite-review.repository.ts:109-112`). The next claim will not take it, and discovery will not create a new automatic attempt for that SHA. `stage()` turns a prior `running` or `interrupted` stage into a terminal skip (`review-orchestrator.service.ts:128-130`).

### 5. What is missing that the requirements never mentioned?

Nothing extra was invented here. The gaps below are requirements the phase claims (FR-1, FR-2, FR-5, FR-6, FR-7, AC-3.1, AC-11.6) and decisions D12 and D36's surrounding lifecycle, not new scope.

## Blocking issues

### B1. The drain deadline is the review deadline

- File: `apps/ptah-electron/src/activation/review-worker.activation.ts:73`, `libs/backend/review-core/src/lib/review-orchestrator.service.ts:63-66`, `libs/backend/review-core/src/lib/lanes/review-lane.runner.ts:54-56`, `libs/backend/review-core/src/lib/stages/context-stage.runner.ts:48-56`
- Scenario: `drain(owner, Date.now() + 60_000)` both limits how long the loop may claim work and is passed into triage, lenses, and verification. Context runs first and does not look at that deadline. It adds a detached worktree, hashes every tracked file, and when `package-lock.json` is unchanged it runs `npm ci` with a 600_000 ms cap (`review-dependencies.service.ts:17-26`). When the lanes start, `clock.now() >= deadline` and each one returns `{ status: 'partial', reason: 'deadline' }` without spawning. Publication still runs. The attempt is stored as a finished partial review with no lens output.
- Impact: Every real PR review on Electron is coverage-empty. Unit tests that inject a future deadline and skip context stay green.
- Fix: Keep the 60s value as the idle gap between claim attempts only. Give each attempt its own deadline (settings or a multi-minute constant) that heartbeats extend, and pass that value to the stages. Do not start publication as a successful preview when every lane was skipped for `deadline`.

### B2. Lens results are read from the wrong stream

- File: `libs/backend/review-core/src/lib/lanes/prompts/prompt-fence.ts:33-35`, `libs/backend/review-core/src/lib/lanes/prompts/triage.prompt.ts:6-7`, `apps/ptah-electron/src/services/review/review-lane-gateway.ts:53-61`, `libs/backend/review-core/src/lib/lanes/review-lane.runner.ts:75-84`
- Scenario: The prompt requires `out/lane-output.json` and, for triage, `out/walkthrough.md`. The gateway returns `readOutput(agentId).stdout`, which is the CLI transcript. `JSON.parse` of that transcript throws, the runner catches it, and the lane is `partial` / `lane-failed` (`review-lane.runner.ts:87-90`). Nothing in the runner reads `out/lane-output.json`. The publication stage reads `walkthrough.md` only (`review-artifact.writer.ts:118-123`). A model that follows the prompt produces a file the pipeline ignores and a transcript the parser rejects.
- Impact: Even with a longer deadline, completed lanes do not become findings. AC-4.1's walkthrough is "Walkthrough unavailable" unless something else wrote the file, and that file is still not the parsed lens output.
- Fix: After the agent exits, read `out/lane-output.json` through the attempt file port (realpath, `out/` only) and parse that. Keep stdout out of the schema parse. Keep the walkthrough read, and fail the triage stage when the headings are missing instead of substituting a success string.

### B3. Shutdown does not stop the drain before SQLite closes

- File: `apps/ptah-electron/src/activation/shutdown.ts:241`, `apps/ptah-electron/src/activation/shutdown.ts:330-347`, `apps/ptah-electron/src/activation/review-worker.activation.ts:79-88`, `libs/backend/review-core/src/lib/review-orchestrator.service.ts:75-112`
- Scenario: `dispose()` sets a local flag, clears the 30s interval, and unregisters the cron handler. It does not abort the signal `drain()` and `process()` actually check, and it does not stop a spawned lane. `process()` only notices `signal.aborted` between stages, and context does not check it at all. `awaitStopped()` is budgeted at 5 seconds, then `sqliteConnection.close()` runs. The in-flight `saveStage`, heartbeat `setInterval`, or `release()` still uses that connection. The heartbeat timer is cleared only in `process`'s `finally`, which has not run yet.
- Impact: A quit during a review drops the lease update or closes the database under a write. The comment in shutdown says the lease will reconcile next start; reconcile does not requeue (S1), and it cannot help a write that already hit a closed connection.
- Fix: On dispose, abort the same `AbortSignal` the drain watches, stop the active agent, clear heartbeats, and await the drain before `SQLite close`. If the budget expires, the worker must be failed closed (no further repository calls), not left running against a closed connection.

## Serious issues

### S1. A crashed or superseded SHA is never picked up again

- File: `libs/backend/review-core/src/lib/persistence/sqlite-review.repository.ts:52-54`, `libs/backend/review-core/src/lib/persistence/sqlite-review.repository.ts:104-114`, `libs/backend/review-core/src/lib/review-orchestrator.service.ts:128-130`
- Scenario: `reconcileExpiredLeases` sets the attempt to `interrupted` and clears the lease. `claimNext` only claims `queued`. `enqueueDiscovered` returns the existing automatic row for `(repo, pr, sha)` in any state, including `failed`, `cancelled`, and `interrupted`, and returns before updating `review_heads`. `stage()` refuses to rerun a `running` or `interrupted` stage. Startup calls `reconcileStartup([])` (`review-orchestrator.service.ts:51`), so it does not re-discover heads either.
- Impact: AC-2.4 does not hold. A crash, a lease expiry, or a force-push back to a previously seen SHA leaves that head unreviewed and not queued. The interface comment on `IReviewQueueRepository` says expired leases are reclaimable after reconcile; the SQL does not reclaim them.
- Fix: Requeue by inserting a new attempt (or setting `queued`) when the latest automatic attempt is `interrupted` or `failed` and this SHA is the PR's current head. On rediscovery, update `review_heads` to active before the early return. Resume or restart a stage instead of converting `interrupted` into a permanent skip.

### S2. Admission budget does not match D12 or the settings the operator saved

- File: `libs/backend/review-core/src/lib/lanes/review-lane-admission.service.ts:29-43`, `libs/backend/review-core/src/lib/stages/verification-stage.runner.ts:20-29`, `libs/backend/review-contracts/src/lib/review-config.schema.ts:91`
- Scenario: The cap is a hardcoded `6` on a key of `pr + attempt`. `release()` decrements only the global `active` count, so the six are a per-attempt budget, which matches a single review. Verification then calls `lanes.run` once per finding. Triage (1) and four lenses (4) leave one slot. Every later candidate is `partial` / `budget` and publication suppresses it (`publication-stage.runner.ts:36-39`). `laneCapPerPr` is stored and shown in the drawer and never passed into `acquire`. A saved cap of 1 still launches six.
- Impact: D12's "coverage-limited when there is no room" path is taken even when other families have room, because the budget is spent on duplicate verifier processes. The operator's lower cap does not bind. AC-7.5 is safe (unverified findings are not accepted) and AC-7.2 is not met for the rest of the candidates.
- Fix: Read `laneCapPerPr` inside `acquire`. Run one verifier pass for the candidate set, or reserve the last slots for verification before the lenses consume them. Do not count a `partial` admission as a launch (today only `admitted` increments; keep that).

### S3. Deterministic context is hard-wired empty

- File: `libs/backend/review-core/src/lib/stages/context-stage.runner.ts:54-61`
- Scenario: `ReviewContextService.build` is called with `changedSymbols = []`, so the git grep for callers never runs. `fileContent` and `comments` in the prompt are `''`. `ReviewChecksService.run` is called with `[]`, so no check is invoked through `scripts/verify.mjs`. `baseConfig()` on Electron always returns `null` (`electron-review-environment.ts:49`), so lens include/exclude and path instructions from the repo are never loaded.
- Impact: AC-5.1, AC-5.2, and AC-5.3 do not happen on this path. The services exist and are unit-tested with caller-supplied symbols; the stage that is supposed to call them passes nothing. Lenses only see the patch text the prompt already fenced.
- Fix: Derive exported symbols from the diff, pass them to `build`, and put callers into `fileContent` or `deterministicEvidence`. Load a bounded check list from the trusted base config (not the PR head) and pass that array to `checks.run`. Surface a null base config as "defaults", which the policy already does, only after the defaults include those checks.

### S4. Discovery drops drafts and hides poll failures

- File: `libs/backend/review-core/src/lib/stages/discovery-stage.runner.ts:27-32`, `apps/ptah-electron/src/activation/review-worker.activation.ts:34-65`, `libs/backend/persistence-sqlite/src/lib/migrations/0065_ptah_review.ts:12-13`
- Scenario: Ineligible pulls, including drafts, `continue` before `queue.discover`. No `review_heads` row is written with `draft = 1`. On success the worker updates `last_poll_at` and nothing else. On failure the cron handler throws and the startup `catch` logs `new Error('Review startup poll failed')`, discarding the cause. `poll_status`, `poll_error`, and `review_poll_state` have no writers in the branch.
- Impact: AC-1.3 (recorded, not reviewed) and AC-1.5 (visible failed poll, cursor not advanced) are unmet. A GitHub outage looks like "review disabled" or a stale success time.
- Fix: Insert a non-queued head for a draft or closed PR, and enqueue only when eligibility later flips. Persist poll success and the redacted error code on `review_poll_state` in both the cron handler and the startup catch, and return that status from the runs RPC.

### S5. Manual retry does not report an attempt id, and a partial lens is stored as success

- File: `libs/backend/rpc-handlers/src/lib/handlers/review-rpc.handlers.ts:76-80`, `libs/backend/review-core/src/lib/stages/lens-stage.runner.ts:49-50`, `libs/backend/review-core/src/lib/persistence/review-query.repository.ts:43-48`
- Scenario: `review:retryHead` generates a `ulid()`, passes it to `queue.retry`, and returns `{ ok: true }`. The id is not in the result schema (`review-rpc.schema.ts:65-72` result is `{ ok, error? }`). Separately, a lens whose runner returned `partial` is saved with stage `state: 'completed'` and `outcome: result.status`. `mapRun` sets the stage status from `state` alone, so `completed` becomes `succeeded`, and `error` stays null.
- Impact: AC-3.1's "reports its attempt ID" is false. The runs UI shows lens stages as succeeded on the same attempt whose overall status is `partial` because the deadline hit (B1).
- Fix: Return the attempt id from `retry` and add it to the RPC result schema. Map stage status from `outcome` when it is `partial`. Do not mark the stage `completed` unless the lane status is `completed`.

### S6. Verifier input is not fenced, and the canary list is always empty

- File: `libs/backend/review-core/src/lib/stages/verification-stage.runner.ts:23-26`, `libs/backend/review-core/src/lib/stages/publication-stage.runner.ts:45-52`, `libs/backend/review-core/src/lib/lanes/review-artifact.writer.ts:35-42`
- Scenario: Lens prompts use `fenceReviewInput`. The verifier prompt concatenates `JSON.stringify(finding)` after a one-line warning. That finding is model output trained on the PR diff, so a hostile PR that is echoed into `title` or `scenario` becomes an instruction to the verifier. Publication passes `secrets: []`. Redaction is only the regex list. A canary that is not a `gh*_` / `sk-` / `Bearer` shape is copied into the preview, the export, and the finding payload.
- Impact: AC-6.5 stops at the first hop. AC-11.6 fails for a canary the regex does not know. Same-family weaker labeling itself is implemented (`review-lane.runner.ts:85-86` and the publication label).
- Fix: Fence the candidate JSON with the same random marker. Plumb a test canary into `secrets` in the eval path, and refuse publication when redaction did not remove it. Do not log the raw finding on parse failure.

## Minor issues

### M1. `git worktree add/remove` arguments are not confined

- File: `apps/ptah-electron/src/services/review/review-command-runner.ts:56-62`
- Scenario: Those two git forms may run with cwd equal to the repository realpath and with whatever `args` the caller passed. `ReviewWorktreeService` passes an attempt path today (`review-worktree.service.ts:39`). Another caller of `IReviewCommandRunner` can `worktree add` outside the attempt root. Output over the cap is sliced and the child is killed without a truncated flag (`review-command-runner.ts:73-77`); a process that exits 0 as `kill()` lands can return a short `ls-files` with `exitCode === 0`, and the snapshot checksum then covers a prefix of the tree.
- Fix: Allow `worktree add/remove` only when the path argument realpath-resolves under `attemptsRoot`. If the cap is hit, return `timedOut` or a truncated flag and make `git()` treat it as failure.

### M2. The shipped screen cannot store the settings the worker requires

- File: `libs/frontend/review-runs-ui/src/lib/review-runs.store.ts:68-74`, `libs/backend/review-core/src/lib/persistence/review-settings.store.ts:20-22`, `apps/ptah-electron/src/activation/review-worker.activation.ts:43-46`
- Scenario: There is no seed row. `getSettings()` returns null, and the cron handler skips with `review-disabled`. The only writer is `review:updateSettings`. The store loads settings and drops `hasToken`. The drawer never calls update. D36's "updates never accept a token" holds: `ReviewSettingsUpdateSchema` is a strict `OperatorSettings` with no token field (`review-rpc.schema.ts:25-27`), and handlers do not register `review:replaceBotToken`.
- Fix: Either seed operator settings from a host-local setup that calls `updateSettings`, or add a save path on the drawer that posts that schema and shows `hasToken`. Do not add the token to the update body.

## Failure modes

### Deadline looks like a finished partial review

- Trigger: Any attempt whose context stage exceeds the 60s drain budget.
- Symptom: Run status `partial`, lens stages `succeeded`, preview with no findings.
- Evidence: `review-worker.activation.ts:73`, `review-lane.runner.ts:56`, `lens-stage.runner.ts:50`, `review-query.repository.ts:43`
- Current handling: Lanes return `partial`; publication still writes; release records `partial`.
- Recommendation: B1 and S5.

### Compliant lane output is discarded

- Trigger: Agent writes `out/lane-output.json` and prints a normal transcript.
- Symptom: `lane-failed` or a JSON parse error turned into `partial`.
- Evidence: `prompt-fence.ts:33-35`, `review-lane-gateway.ts:61`, `review-lane.runner.ts:82-90`
- Current handling: Catch-all returns `partial` and logs a generic error.
- Recommendation: B2.

### Quit closes the database under the worker

- Trigger: Quit while context, a lane, or `release()` is in flight.
- Symptom: Lease stays `running`, or the next start sees a torn write. The review is not retried (S1).
- Evidence: `review-worker.activation.ts:79-84`, `shutdown.ts:241` and `:330-347`
- Current handling: Interval cleared; 5s wait; SQLite close.
- Recommendation: B3.

### Previously seen SHA after a force-push

- Trigger: PR moves A → B → A, and A already has an automatic attempt.
- Symptom: No new queued attempt; `review_heads` can stay on B.
- Evidence: `sqlite-review.repository.ts:52-64`
- Current handling: Early return of the old attempt.
- Recommendation: S1.

### Lease lost mid-run

- Trigger: Heartbeat fails or `release` matches zero rows because `lease_expires_at` passed (`sqlite-review.repository.ts:89-101`).
- Symptom: Work is finished in memory; the row stays `running` and blocks the PR until a later reconcile marks it `interrupted` without requeue.
- Evidence: `review-orchestrator.service.ts:77-78`, `:111`
- Current handling: Log and continue; ignore the boolean.
- Recommendation: If heartbeat or release returns false, stop the attempt and requeue (S1). Do not publish.

### One finding verified, the rest dropped

- Trigger: A lens returns two or more findings, or `laneCapPerPr` is below 6.
- Symptom: Later candidates suppressed as `budget` while families still have room.
- Evidence: `review-lane-admission.service.ts:34-39`, `verification-stage.runner.ts:22`
- Current handling: Suppression reason is stored. Safe, incomplete.
- Recommendation: S2.

### Draft never appears, failed poll invisible

- Trigger: Draft PR, or GitHub 5xx on poll.
- Symptom: No head row; UI has no failed-poll state.
- Evidence: `discovery-stage.runner.ts:28-31`, `review-worker.activation.ts:63-65`
- Current handling: `continue`, or a generic log line.
- Recommendation: S4.

### Caller and check context absent

- Trigger: Any PR, including one that breaks an unchanged caller or an audit rule.
- Symptom: Prompt evidence has an empty caller list and no check records.
- Evidence: `context-stage.runner.ts:54-56`
- Current handling: Coverage line lists dependency status and `diff-complete` only.
- Recommendation: S3.

### Canary and verifier injection

- Trigger: Finding text contains an instruction or a secret that misses the regex.
- Symptom: Verifier sees the instruction as part of the task. Export contains the secret.
- Evidence: `verification-stage.runner.ts:26`, `publication-stage.runner.ts:51`
- Current handling: Prose warning; pattern redaction; `secrets` empty.
- Recommendation: S6.

## Data flow

1. Cron `handler:review:discover` or startup → `DiscoveryStageRunner.run` → GitHub GET list. OK for open ready maintainer PRs. Gap: drafts and poll errors (S4).
2. `enqueueDiscovered` dedupes on SHA. OK for a first push. Gap: terminal rows and a returning SHA (S1).
3. Interval calls `drain` with a 60s deadline. Gap: B1.
4. `claimNext` is one running attempt per PR, active head only. OK. Expired rows are not claimable (S1).
5. Context worktree + full hash + optional `npm ci`. Path checks in the worktree service and file adapter are real. Gap: no symbols, no checks (S3); time blows the deadline (B1).
6. Triage and lenses spawn agents. Gap: stdout versus `lane-output.json` (B2); cap (S2).
7. Verification one call per finding, cross-family preferred, weaker label when the family matches. Label OK. Fence and budget not OK (S2, S6).
8. Publication writes local preview and export only. GitHub `upsertWalkthrough`, `createCommentReview`, and `replyToFinding` throw `publication-unavailable` (`github-review.adapter.ts:230-238`). No POST in `request()`. OK for P1.
9. Query/RPC parses with Zod. Settings update cannot carry a token (M2). `getSettings` returns `hasToken` only. Gap: retry id and stage status (S5).
10. Quit. Gap: B3.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| FR-1 discover eligible heads | PARTIAL | Drafts not recorded; poll failure not visible (S4) |
| FR-2 identity, supersede, restart | PARTIAL | New SHA supersede SQL exists; restart and SHA reuse do not (S1) |
| FR-3 manual retry and dry-run | PARTIAL | Dry-run does not call GitHub. Retry omits the attempt id (S5) |
| FR-4 walkthrough | MISSING | File is requested and not required for success (B2) |
| FR-5 deterministic context | MISSING | Symbols and checks are empty (S3) |
| FR-6 four lenses | MISSING | Deadline and stdout parse skip them (B1, B2) |
| FR-7 verify, weaker label | PARTIAL | Label works; budget verifies one finding (S2) |
| FR-11 no GitHub mutation in P1 / head match | COMPLETE | Writes throw; `guard()` compares head SHA before publication |
| D12 caps and partial coverage | PARTIAL | Global 3 and operator reserve exist; per-PR cap ignores settings (S2) |
| D36 token not in settings update | COMPLETE | Strict schema, no replace-token handler |
| D37 0065 settings row and payload_json | COMPLETE | Table and column are in the unshipped migration; writers use them |
| AC-11.6 canary | MISSING | `secrets: []` (S6) |

Implicit requirements not addressed: a first-run settings seed (M2).

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Fork or non-maintainer | YES | Policy rejects before enqueue and again in `guard` | Draft is rejected the same way and not stored |
| Head moves during a run | YES | `guard` before each stage returns superseded | Local preview is skipped; good |
| GitHub write in P1 | YES | Three methods throw; fetcher is GET | Live mode in settings does not post either |
| Token in RPC | YES | Boolean `hasToken`; update schema rejects unknown keys | UI drops the boolean (M2) |
| Symlink escape on artifact read | YES | `realpath` plus `review-export.json` basename | Command `worktree` path is the remaining hole (M1) |
| Second review of the same PR | NO | Automatic dedupe returns the old attempt | S1 |
| Process quit | NO | Dispose does not abort the drain | B3 |
| Output larger than 1 MB from git | NO | Slice without a hard failure | M1 |

## What was checked and is sound

- `GithubReviewAdapter.request` sends only `GET`, puts the token in the Authorization header, and logs a static retry string (`github-review.adapter.ts:93-137`).
- RPC `safe()` does not log the caught value (`review-rpc.handlers.ts:33-40`).
- Command runner uses `spawn` with `shell: false`, `realpath` on both roots and cwd, and a timeout (`review-command-runner.ts:43-72`).
- `ReviewFiles.checked` rejects paths outside the attempt id and realpath-checks existing files and parents (`review-files.ts:14-38`).
- Admission reserves one slot: `min(3, maxConcurrentAgents - 1)` (`review-lane-admission.service.ts:35-36`).
- Selector prefers a different family for the verifier and the runner sets `evidenceStrength: 'weaker'` when it cannot (`review-lane-selector.ts:29-31`, `review-lane.runner.ts:86`).
- Migration 0065 keeps static SQL, one active head, one running attempt per PR, and `payload_json` (`0065_ptah_review.ts`).

## Decisions

- Helper lanes `da8a3e5f` and `b222b665` were still running when this was written. Their notes were not read and are not evidence. Reversible: a later pass can fold in anything they prove against the files above.
- Verdict is REJECT rather than APPROVE WITH FIXES because B1 and B2 mean a live PR does not get a lens review, which is the phase's purpose. Reversible once those two are fixed and S1–S3 are retested.

## Verdict

- Recommendation: REJECT
- Confidence: MEDIUM
- Top risk: An Electron run records a finished partial review that never called a lens, and a quit during that run can close SQLite first.
- What a robust implementation would add: an attempt-scoped deadline independent of the poll slice; parsing `out/lane-output.json`; abort-and-await before SQLite close; requeue of interrupted heads; one fenced verifier pass bounded by `laneCapPerPr`; context symbols and verify-wrapper checks from the trusted base config.
