# CodeRabbit triage — PR #957 (TASK_2026_878_5513)

12 unresolved threads. Each claim was checked against the current code. Result: 9 fixed,
3 disputed. Nothing is committed yet; the coordinator commits the change and replies on GitHub.

| # | Thread | commentId | file:line | Severity | Claim | Verdict | Change / reason (evidence) | Test |
|---|--------|-----------|-----------|----------|-------|---------|----------------------------|------|
| 1 | PRRT_kwDOPngTds60m7_c | 4495255958 | memory-curator/.../indexing-control.service.ts:560 | Minor | `indexing:start` fires `start()` without awaiting it; the status read can return `running: null` before the census is joined | fixed | Confirmed: `start()` awaits `deriveWorkspaceFingerprint` and `deriveGitHeadSha` before `joinCensus`, while the handler's `getStatus` (indexing-rpc.handlers.ts:182) and the renderer's follow-up read run in parallel. Fix: `start()` now records a `pendingManual` entry right after it takes the controller, before the first await (indexing-control.service.ts:306-317, 528-533). It clears the entry after `joinCensus` (:579) and in `finally` (:637). `runningView` reports that entry as a manual run, or as `joinedBackground` when an open background census exists (:1104-1113). The entry counts only while its controller is still the active one (:658-667), so pause and cancel need no change. The `activeAbortController` guard is unchanged. Not covered: `resume()` still awaits its own reads before it calls `start()`. | indexing-control.service.spec.ts:1282 "a manual start is running in status before its setup reads finish"; :1312 "a pending manual start reports joinedBackground on an open background census" |
| 2 | PRRT_kwDOPngTds60m7_5 | 4495255993 | memory-curator/.../indexing-control.service.ts:646 | Minor | After a successful background scan the panel keeps an old manual error under the label "the last index run", and the never-indexed block hides the last-run summary | fixed (template) | Confirmed: `trackBackgroundRun` never writes `last_error` or `last_indexed_at` (by design, plan line 227). Only manual `start()` writes `last_error` (indexing-control.service.ts:633). So `deriveStateFromRow` keeps `error` or `never-indexed` (:272-274) while `lastRun` shows the background success. Fix: the error copy now reads "A manual index run did not finish." and the never-indexed block shows `lastRunSummary()` (workspace-indexing.component.html:76-83, error block). The backend run-state design is unchanged. | workspace-indexing.component.spec.ts:600 "renders a background scan summary in the never-indexed block"; :621 "labels a kept manual error apart from a later successful background scan" |
| 3 | PRRT_kwDOPngTds60m8AQ | 4495256017 | memory-curator/.../indexing-control.service.ts:889 | Minor | `lastRun.origin` should be the deciding participant's origin, not `record.origin` | disputed | Intended behaviour. The approved plan says "Origin = first joiner" (implementation-plan.md P12, line 123) and "The settle writes `lastRun` once, taking `origin` and `startedAt` from the record" (line 222). For background→manual it requires "one `lastRun` (`origin:'background'`)" (line 384). The existing tests pin this: indexing-control.service.spec.ts "background first, manual second, success" (`origin:'background'`) and "A-F7" (`failed[0].origin === 'background'`). `startedAt` and `durationMs` also come from the record, so taking the origin from another participant would mix two runs' metadata. While the run is live the panel already shows the joined manual click (`running.joinedBackground`). | none (behaviour unchanged) |
| 4 | PRRT_kwDOPngTds60m8Am | 4495256048 | memory-curator/.../curator-activity-log.ts:341 | Minor | `provider-unsupported` passes use up `maxCuratesPerHour` slots | fixed | Confirmed: every trigger path calls `tryAcquire` before `curate`, and only `network-backoff` was refunded. `provider-unsupported` means no query was sent (sdk-internal-query.curator-llm.ts:155-162, 403-408). Fix: `refundIfNetworkDeferred` became `refundUndispatched` and also refunds `stats.reason === 'provider-unsupported'` (memory-trigger.service.ts:918-930; both call sites :1005, :1204). Real curation keeps its hourly slots once the user picks a provider that works. Passes that were dispatched (for example unreachable) still keep their slot. | memory-trigger.service.spec.ts:3048 "refunds the slot of a pass the curator provider cannot run" (existing "keeps the slot ... unreachable" still guards the other side) |
| 5 | PRRT_kwDOPngTds60m8A3 | 4495256065 | memory-curator/.../curator-activity-log.ts:520 | Minor | Error text and nested causes reach the log without redaction | fixed | Confirmed: `ElectronLoggerAdapter.warn` → `log()` JSON-stringifies the args into the message (apps/ptah-electron/src/di/electron-adapters.ts:304-306, 460-483) and does not run the context redaction that `logWithContext` applies. Fix: `redactSecrets` is now applied to `detail` and to each cause (curator-activity-log.ts:23, 477, 523). The rest of the text stays in the log, as the design intends. | curator-activity-log.spec.ts:245 "redacts credentials in the logged error and its causes" (the existing sentinel test still passes) |
| 6 | PRRT_kwDOPngTds60m8BF | 4495256083 | memory-curator/.../triggers/redact-secrets.ts:26 | **Major** | `\b` boundaries miss `GITHUB_TOKEN`, `OPENAI_API_KEY`, `DB_PASSWORD`, `client_secret_value` | fixed | Confirmed: `_` is a word character, so `\b(?:token)\b` does not match inside `GITHUB_TOKEN`. Fix: a new `KEY_PATTERN` (redact-secrets.ts:27-34) puts lookarounds on alphanumerics instead of `\b`: `(?<![A-Za-z0-9])(?:KEY_NAMES)(?:[_-][A-Za-z0-9_-]{0,64})?(?![A-Za-z0-9])`. A prefix or suffix is allowed only after `_` or `-`, so `author`, `tokens`, `secretary` and `mytoken` stay unchanged. CodeRabbit's suggested `(?:\b[\w-]*[_-])?` prefix can backtrack quadratically on long hyphenated text. This version is linear, and the suffix is capped at 64 characters. It is used in both the quoted and the unquoted rule. The user decision holds: the tool-failure snippet is kept, only redacted. | redact-secrets.spec.ts: "redacts a credential name with a delimited prefix or suffix" (5 cases), "keeps an ordinary word that contains a credential name" (4 cases), 2 new ~100 KB timing cases |
| 7 | PRRT_kwDOPngTds60m8BY | 4495256107 | skill-synthesis/.../spec-extractor.ts:86 | Minor | `code-style-review-architecture-compliance.md` is classed as a document review, so it is ignored by `taskVerdict` and `writeGrades` | fixed | Confirmed: `/(?:^|-)(?:plan|architecture|…)(?=[-.])/` matched `-architecture-` in the suffix. Fix: `isDocumentReview` now tests only the name before the first `-review` (spec-extractor.ts:80-88, 160-164). `implementation-plan-review*.md` still matches. `writeGrades` uses the same function (spec-harvester.service.ts:211). `parseReviewVerdict` was not touched and stays STRICT. | spec-extractor.spec.ts: classification list now includes `code-style-review-architecture-compliance.md`, `code-logic-review-plan-a.md` (work) and `implementation-plan-review-r2.md` (document); :128 "lets a work review with a document word in its suffix decide" |
| 8 | PRRT_kwDOPngTds60m8Br | 4495256130 | skill-synthesis/.../spec-harvester.service.ts:162 | Minor | No task-leading index for the `task_id = ? AND reconciled_at IS NULL` lookup run for each finished spec | fixed | Confirmed: the only task index is `(skill_slug, task_id)` (0056_skill_nullable_grades.ts:46). The query at skill-invocation-event.store.ts:205-206 runs once per finished spec on each harvest (spec-harvester.service.ts:154-160). That is a regression from batch-level reconcile. Fix: new migration 0071 `CREATE INDEX IF NOT EXISTS idx_skill_inv_events_task_unreconciled ON skill_invocation_events(task_id) WHERE reconciled_at IS NULL` (migrations/0071_skill_inv_events_task_unreconciled.ts, registered in migrations/index.ts). The max-version assertion moves from 70 to 71 in the 22 migration specs that pin it. Peer TASK_2026_879 adds no migration (its implementation-plan.md:619). | 0071_skill_inv_events_task_unreconciled.spec.ts (registration, static SQL, idempotent, `EXPLAIN QUERY PLAN` uses the new index) |
| 9 | PRRT_kwDOPngTds60m8B7 | 4495256152 | core/.../back-office-activity.service.ts:514 | Minor | `INDEXING_FAILED` is not filtered by workspace, so another workspace's failure raises a notice for the active one | fixed | Confirmed: `projectFailure` keys the notice to `activeWorkspacePath()` (back-office-activity.service.ts:192-210), and the push carries `workspaceRoot`. Fix: the `INDEXING_FAILED` case now uses the existing `isForActiveWorkspace` guard, as `MEMORY_EXTRACTED` does (:236-247). | back-office-activity.service.spec.ts:272 "ignores an indexing failure for another workspace"; the existing fixed-sentence test now sets the active workspace first |
| 10 | PRRT_kwDOPngTds60m8CV | 4495256175 | skill-synthesis-ui/.../skill-specs-control.component.ts:84 | Minor | "Nothing new to harvest" conflicts with a non-zero reconciled count | disputed | The approved copy: "`Nothing new to harvest` when harvested is 0" (implementation-plan.md:298, batches.md:930). "Harvest" means new spec records. The reconciled count is still shown on the same line ("Nothing new to harvest (1 task scanned, 1 skill run reconciled)"), and that exact line is pinned by skill-specs-control.component.spec.ts:105-111. No information is lost or misreported. | none |
| 11 | PRRT_kwDOPngTds60m8Dj | 4495256280 | workspace-indexing/.../workspace-indexing.service.ts:301 | Minor | Complete and failed pushes for another workspace replace the active panel's status and can show its failure sentence | fixed | Confirmed: `handleMessage` loaded `payload.workspaceRoot` without checking it. Fix: the service records the root of the last `loadStatus` (`activeRoot`, workspace-indexing.service.ts:417). Complete and failed pushes for a different `normalizeWorkspaceRoot` value are ignored (:297, :305, :315-321). With no known root the push is accepted, as before. | workspace-indexing.service.spec.ts:503 "ignores complete and failed pushes for another workspace" (also checks that a trailing-slash spelling of the same root is accepted) |
| 12 | PRRT_kwDOPngTds60oWVi | 4495865873 | memory-curator/.../indexing-control.service.ts:994 | Minor | An older successful census that settles after a newer failed one still pushes `INDEXING_COMPLETE` and clears the newer failure notice | disputed | A stale skip only means the older summary does not overwrite the newer `lastRun` (persistLastRun doc, indexing-control.service.ts ~:950). The older run did finish successfully, and it finished after the newer failure. When it is the manual run (rule 1, the reachable case: a manual run in its memory phase), it has already written `last_indexed_at` and cleared `last_error` (:610-616). The workspace has recovered, so resolving the failure notice is correct. `INDEXING_COMPLETE` is also the only push that makes the panel and the Memory tab reload that saved state (workspace-indexing.service.ts:289-294). The existing test "record closes: a watcher run during the manual memory phase opens a new census" pins two complete pushes. Dropping the push would leave the panel stale. Residual edge case: a manual memory phase is paused after a background joiner succeeded. Then rule 2 resolves a notice for a failure that started later. A dedicated "status changed" push would cover it, but that is a new message type and out of scope. | none |

## Files changed

- libs/backend/memory-curator/src/lib/control/indexing-control.service.ts (thread 1)
- libs/backend/memory-curator/src/lib/control/indexing-control.service.spec.ts (thread 1)
- libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts (thread 4)
- libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.spec.ts (thread 4)
- libs/backend/memory-curator/src/lib/curator-llm/curator-activity-log.ts (thread 5)
- libs/backend/memory-curator/src/lib/curator-llm/curator-activity-log.spec.ts (thread 5)
- libs/backend/memory-curator/src/lib/triggers/redact-secrets.ts (thread 6)
- libs/backend/memory-curator/src/lib/triggers/redact-secrets.spec.ts (thread 6)
- libs/backend/skill-synthesis/src/lib/spec-extractor.ts (thread 7)
- libs/backend/skill-synthesis/src/lib/spec-extractor.spec.ts (thread 7)
- libs/backend/persistence-sqlite/src/lib/migrations/0071_skill_inv_events_task_unreconciled.ts (new, thread 8)
- libs/backend/persistence-sqlite/src/lib/migrations/0071_skill_inv_events_task_unreconciled.spec.ts (new, thread 8)
- libs/backend/persistence-sqlite/src/lib/migrations/index.ts (thread 8)
- libs/backend/persistence-sqlite/src/lib/migrations/{0028,0030,0038,0039,0040,0041,0042,0043,0044,0045,0046,0047,0051,0052,0053,0054,0055,0056,0059,0060,0061,0063,0064,0070}_*.spec.ts: max version 70 → 71 (thread 8)
- libs/frontend/core/src/lib/services/back-office-activity.service.ts (thread 9)
- libs/frontend/core/src/lib/services/back-office-activity.service.spec.ts (thread 9)
- libs/frontend/workspace-indexing/src/lib/workspace-indexing.service.ts (thread 11)
- libs/frontend/workspace-indexing/src/lib/workspace-indexing.service.spec.ts (thread 11)
- libs/frontend/workspace-indexing/src/lib/workspace-indexing.component.html (thread 2)
- libs/frontend/workspace-indexing/src/lib/workspace-indexing.component.spec.ts (thread 2)

No public member was added to a frontend service. `activeRoot` and `isActiveRoot` are private, so no
test stubs in other libraries need an update. No file owned by peer TASK_2026_879_9809 was edited.

## Checks run

All checks ran with `export TMPDIR=/var/tmp/b878 PTAH_VERIFY_LOCK_DIR=/tmp/ptah-verify-lock`.

1. `npm run verify -- -p @ptah-extension/memory-curator,@ptah-extension/persistence-sqlite,@ptah-extension/skill-synthesis,@ptah-extension/core,@ptah-extension/workspace-indexing`
   - lint and typecheck: `NX 10 tasks: 9 succeeded, 1 failed`. The one failure is
     `@ptah-extension/persistence-sqlite:lint`, which reports `✖ 33 problems (10 errors, 23 warnings)`.
     All 10 errors are `no-restricted-syntax` ("SQL migrations must be static text") in
     `0057_drop_skill_pipeline.ts`, `0057_drop_skill_pipeline.spec.ts` and `0058_provider_accounts.spec.ts`.
     This failure was already present: neither this PR nor this triage touches those files (last
     changed on main in 902e37d2f, 2026-10-20), and the lint output shows no error in 0071 or `index.ts`.
     Typecheck passed for all 5 projects, and lint passed for the other 4.
   - test: `NX 5 tasks: 4 succeeded, 1 failed`. persistence-sqlite, skill-synthesis, core and
     workspace-indexing pass. memory-curator reports `Test Suites: 1 failed, 50 passed, 51 total`
     and `Tests: 1 failed, 1043 passed, 1044 total`. The only failure is
     `retention/memory-retention.integration.spec.ts` with "Exceeded timeout of 5000 ms" (real SQLite).
2. `npm run verify -- -t test -p @ptah-extension/memory-curator -- --testPathPatterns=memory-retention.integration`
   (one rerun): `Tests: 1 failed, 15 passed, 16 total`. It hit the same 5000 ms timeout on the same test,
   with about 4 GB of memory free (`free -g`). This is the known low-memory timeout. The retention
   spec does not use migrations or any changed code, and the PR did not touch `retention/`. It was
   not rerun again.
3. `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts`: exit 0
   (`degradation-audit: TOTAL 216 unsuppressed site(s)`, no regression). No new catch was added.

Not run: build, serve and e2e targets (not allowed), and the Electron visual review (only template
copy and a summary line changed; the component spec covers both).

## Fix round (codex review)

Source: `code-logic-review-coderabbit-fix.md` (REVISE 5/10, two findings). Both are fixed. Each
fix has a test that fails without it.

1. Serious, completion not filtered by workspace
   (`libs/frontend/core/src/lib/services/back-office-activity.service.ts`).
   - Fix: `INDEXING_COMPLETE` now goes through the same `isForActiveWorkspace` gate (the same
     normalized root comparison) as `INDEXING_FAILED`, in one shared `case`. A completion for
     another root is dropped, so it no longer narrates or resolves the active workspace's notice.
   - Test (`back-office-activity.service.spec.ts`): "resolves the failure notice only on a
     completion for the same workspace". A failure for `/ws-a`, then a completion for `/ws-b`,
     keeps the notice. A completion for `/ws-a` resolves it. Two existing completion tests now
     call `workspaceScope.switchTo('/ws')` because their payload root is `/ws`.
2. Moderate, stale skip reported as recovery
   (`libs/backend/memory-curator/src/lib/control/indexing-control.service.ts`).
   - Fix: `persistLastRun` returns `'written' | 'stale-skipped' | 'failed'` in place of a
     boolean. On `'stale-skipped'`, `settleCensus` returns before any push: no
     `INDEXING_COMPLETE`, no `INDEXING_FAILED`, no warn. The newer census settled first and has
     already sent its own push, and the panel reloaded status on that push. This matches the
     existing "cancelled, no push" path. No new message type was added. Known limit: no push
     tells the panel that the older run's live `running` view has ended. A status-only push
     (new message type) would be needed for that, and it is out of scope here. Kept as they
     were: ordering by the in-memory seq (clock rollback), compare-and-set with 3 attempts, and
     no write after a failed read. The setup-failure caller ignores the return value, as before.
   - New test (`indexing-control.service.spec.ts`, census join): "an older background success
     that settles after a newer failed census sends no completion". A background census starts.
     A manual run joins it and is cancelled (an aborted manual participant). A memory-only manual
     run opens a newer census of its own that fails (one `INDEXING_FAILED`, failed lastRun). Then
     the older background success settles. Result: zero `INDEXING_COMPLETE`, still one
     `INDEXING_FAILED`, and the only lastRun write and `getStatus().lastRun` is the newer
     `manual`/`failed` run.
   - Updated test: "record closes: a watcher run during the manual memory phase opens a new
     census" now expects 1 `INDEXING_COMPLETE` instead of 2. The second one was this defect: the
     stale-skipped older census sent it.

### Checks (fix round)

All ran with `export TMPDIR=/var/tmp/b878 PTAH_VERIFY_LOCK_DIR=/tmp/ptah-verify-lock`.

- `npm run verify -- -p memory-curator,core`: lint+typecheck `NX 4 tasks: 4 succeeded`, test
  `NX 2 tasks: 2 succeeded`, exit 0. The final run was a cache hit of earlier passing runs.
- One uncached run (`-t test -p memory-curator -- --skip-nx-cache`) had a single failure:
  `triggers/boot-scan-runner.spec.ts` "does not re-admit an unchanged given_up generation"
  (`options.failures?.recordFailure is not a function`), with
  `Tests: 1 failed, 1044 passed, 1045 total`. That file is not modified, and Nx flags the task as
  flaky. Two isolated runs of `boot-scan-runner.spec.ts` with `indexing-control.service.spec.ts`
  under the lock (`--exec --task mc-boot`) gave `1 failed, 78 passed`, then `79 passed`. So it
  is an intermittent failure that predates this round, and it is not caused by this change.
  `indexing-control.service.spec.ts` passed in every run.
- `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts`: exit 0
  (`TOTAL 216 unsuppressed site(s)`). No catch was added.
- No public member was added to a frontend service. No peer TASK_2026_879_9809 file was
  touched. Nothing was committed, pushed or stashed.

## Fix round 2 (codex round 1)

Finding (Moderate): a stale-skipped older census settled silently. The newer failure push had
re-read a status that still showed the older census `running`, so the panel could stay on
"indexing" with stale progress until the user acted.

### Change

- `libs/shared/src/lib/types/rpc/rpc-indexing.types.ts`: `IndexingCompleteEvent` gains the
  additive optional `refreshOnly?: true`, documented as "no run completed; drop live progress and
  re-read status; not a completion or a recovery".
- `libs/backend/memory-curator/src/lib/control/indexing-control.service.ts` (`settleCensus`): on
  `persistLastRun(...) === 'stale-skipped'` it now broadcasts exactly one `INDEXING_COMPLETE`
  with `refreshOnly: true`. The stored lastRun is left alone, and there is still no failure push
  and no real completion.
- `libs/frontend/workspace-indexing/src/lib/workspace-indexing.service.ts`: the logic is
  unchanged (comment only). `INDEXING_COMPLETE`, refreshOnly or not, still uses the same
  `isActiveRoot` filter, clears `_progress`, bumps `completedAt` and re-reads status.
- `libs/frontend/core/src/lib/services/back-office-activity.service.ts`: `mapIndexingComplete`
  returns `null` for `refreshOnly === true`. No activity item is pushed and the failure notice is
  not resolved. The active-workspace filter from the previous round is kept.

### INDEXING_COMPLETE consumers (grep of `MESSAGE_TYPES.INDEXING_COMPLETE` / `'indexing:complete'`
in libs/ and apps/)

1. `libs/frontend/workspace-indexing/.../workspace-indexing.service.ts` handles refreshOnly
   like any completion (clear progress, re-read status). This is the intended path.
2. `libs/frontend/core/.../back-office-activity.service.ts` ignores refreshOnly (no item,
   no recovery).
3. `libs/backend/memory-curator/.../indexing-control.service.ts` is the only producer.
4. Indirect readers of `WorkspaceIndexingService.completedAt()`:
   `libs/frontend/memory-curator-ui/.../memory-curator-tab.component.ts:456` and
   `libs/frontend/chat/.../vitals/workspace-vitals.store.ts:361`. Both use it only as a refresh
   trigger (reload stats/status). A refresh after the older census settled is correct, because
   its symbol work did land. No change.
5. `libs/shared` `payload-map.ts`, `message-constants.ts`, `message-type.ts` and
   `host-source-registry.baseline.ts` are type/registry entries only. No test stubs outside the
   listed specs build this payload, and the field is optional, so no stub needed an update.

### Tests

- memory-curator `indexing-control.service.spec.ts`:
  - "an older background success that settles after a newer failed census sends only a status
    refresh" (renamed; it used to assert zero completions). It now asserts exactly one
    `INDEXING_COMPLETE` with `refreshOnly: true` for ROOT, one `INDEXING_FAILED`, a stored
    lastRun that is still the newer manual failed run, and `running === null`.
  - "record closes ..." (stale-skipped older manual success) now asserts two completions:
    the newer real one (no `refreshOnly`) and then one `refreshOnly: true`.
- workspace-indexing `workspace-indexing.service.spec.ts`: "a refreshOnly completion after a
  newer failed push moves the panel to the persisted error". The older census is live while the
  failure push arrives, the panel stays `indexing` with progress, and after the refreshOnly
  completion it shows `{kind:'error', message:'memory broke'}` with progress null and not busy.
  No user action is needed. Note: this frontend path already existed. The test fails only
  without the backend push, so it pins the contract rather than new frontend logic.
- core `back-office-activity.service.spec.ts`: "keeps the failure notice on a refreshOnly
  completion for the same workspace". The notice stays, latest stays `failed`, and no item is
  added.
- Fail-without-fix check: I temporarily disabled the backend refresh broadcast and the
  back-office refreshOnly guard, then restored both from backups (diff confirmed).
  memory-curator spec: 2 failed / 53 passed. back-office spec: 1 failed / 40 passed.

### Verification

- `npm run verify -- -p memory-curator,core,workspace-indexing,shared`: exit 0. That is 8
  lint/typecheck tasks and 4 test tasks (4 projects), all succeeded.
- `npm run verify -- -t typecheck -p ptah-electron,ptah-extension-webview`: exit 0 (2 tasks).
- `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts`: exit 0.
- No commit, push or git state change.
