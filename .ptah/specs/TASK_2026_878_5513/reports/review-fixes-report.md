# Review fixes report — TASK_2026_878_5513

Worktree: `/home/amun/ptah-extension/.claude-worktrees/memory-skills-dead-actions`. No git actions taken.
Line ranges are in the new file (from `git diff -U0`). The coordinator's comment at
`indexing-control.service.ts:242` ("migration 0070") is still there.

## Fix 1 — Phase A #1: redact secrets in the tool-failure snippet

- CREATED `libs/backend/memory-curator/src/lib/triggers/redact-secrets.ts`. It holds a pure
  `redactSecrets(text)` and `REDACTED`, and redacts:
  - credentials in URLs (`scheme://userinfo@`)
  - `Authorization:` / `Proxy-Authorization:` values, with the scheme
  - bare `Bearer x` tokens
  - `api_key` / `x-api-key` / `*token` / `secret` / `client_secret` / `password` / `passwd` /
    `pwd` / `private_key` values in `=`, `:` and JSON forms
  - `sk-…`, `ghp_/gho_/ghu_/ghs_/ghr_…`, `github_pat_…`, `xox[abprs]-…`, `AKIA/ASIA…`, `AIza…`
    and `glpat-…` tokens
  - JWTs, hex runs of 32+ characters, and base64 runs of 32+ characters that mix digits with
    upper and lower case
- CREATED `libs/backend/memory-curator/src/lib/triggers/redact-secrets.spec.ts`. It has 16
  `it.each` secret cases, one check that ordinary text is unchanged, and one check that the
  URL host and path are kept.
- MODIFIED `libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts`:
  - :52 imports the redactor.
  - :66-67 adds `TOOL_FAILURE_REDACT_SCAN = 4096`, which caps the regex work.
  - :501-507 sends the raw text to `logger.debug('[memory-trigger] tool failure', …)` and
    nowhere else.
  - :514-517 builds `stats.error = snippetOneLine(redactSecrets(error.slice(0, 4096)), 140)`.
    Redaction runs before truncation, so a secret cut short by the 140-character limit cannot
    slip past the patterns.
- MODIFIED `memory-trigger.service.spec.ts:1505-1530`. New test: "tool-failure event never
  carries a secret from the tool failure text". It fires a URL credential and a Bearer `sk-`
  sentinel, then checks that the serialized pushed event has no `SENTINEL` and still holds
  the snippet with `[REDACTED]`.
- The UI spec `event-feed.component.spec.ts` is unchanged. The event still carries the
  snippet, so its assertion still holds.

## Fix 2 — B/C #1: a failed lastRun write must not look like success

- `indexing-control.service.ts`:
  - `upsertRow` (:1245, :1298-1305) now returns `boolean`. On a write failure it logs a warn
    (`[indexing-control] indexing_state write failed`) and carries a `degradation-audit:
    reported` justification.
  - In `settleCensus` (:867-875, :887-895), the single lastRun write goes through
    `persistLastRun`. A failed write gives a warn with a fixed message: `[indexing-control]
    last run could not be saved`, with origin and outcome. A succeeded census whose write
    failed sends `INDEXING_FAILED` instead of `INDEXING_COMPLETE`.
  - Each census still sends at most one push. A cancelled census still sends none (warn only).
  - `describeError` (:221-225) is a log-only helper.
- Tests (`indexing-control.service.spec.ts:1471+`, `failLastRunWrites` helper):
  - "a failed lastRun write turns a succeeded census into one INDEXING_FAILED push" checks:
    no complete push, one failed push, no `SQLITE_FULL` in the payload, the fixed warn, and
    `lastRun` null.
  - "a failed lastRun write for a failed census still pushes INDEXING_FAILED once".

## Fix 3 — B/C #2: an older census never overwrites a newer last run

- `indexing-control.service.ts`:
  - `CensusRecord.seq` (:134-135) is set in `openRecord` from the monotonic `censusSeq`
    (:288-291).
  - The new `newestPersistedSeq` map is keyed by fingerprint.
  - `persistLastRun` (:910-939) skips the write, with a debug log, when one of two checks
    finds a newer census. Check one: a newer `seq` was already persisted in this process.
    Check two: the stored `last_run_json.startedAt` is strictly newer, which also covers
    another instance.
  - A skipped write still counts as persisted. The older census's own single push is still
    sent.
  - Each census still writes at most once. Pause still writes nothing.
- The test at `spec:1324-1335` ("record closes: a watcher run during the manual memory phase
  opens a new census") now checks:
  - exactly one write, from `background`, the newer census, which settles first
  - `getStatus().lastRun` has origin `background`
  - `running` is null
  - two complete pushes

## Fix 4 — B/C #3: document reviews never become work grades

- `libs/backend/skill-synthesis/src/lib/spec-harvester.service.ts:43,213` replaces
  `/plan|architecture/i` with the `isDocumentReview` helper from `spec-extractor.ts`.
- `spec-harvester.service.spec.ts:184-210` adds "never turns a planning-document review into a
  work grade". The folder holds `task-description-review.md`, `design-spec-review.md`,
  `implementation-plan-review.md` and `architecture-review.md`, and no grade is written. After
  `code-logic-review.md` is added, exactly one grade is written, from that file.

## Fix 5 — B/C #4: ignore late progress

- `indexing-control.service.ts:766-768`: the record's `onProgress` returns early once the
  record has left `liveCensuses`, which happens at final release and settle.
- Test: "a late progress callback after the census settled produces no broadcast". It checks
  that no extra batch push arrives, the listener is not called, and `running` is null.

## Fix 6 — B/C #5: make background setup failures visible

- In `indexing-control.service.ts`, `trackBackgroundRun` (:628-646) uses
  `Promise.allSettled`. There are two cases:
  - **No fingerprint:** the service logs a warn with a fixed message (`… background index
    setup failed before a workspace fingerprint was derived`) and rethrows. Nothing is pushed.
  - **Fingerprint derived, SHA failed:** `recordBackgroundSetupFailure` (:681-714) logs a warn
    with the raw text, writes one failed `background` lastRun through `persistLastRun`, sends
    one `INDEXING_FAILED` with origin `background`, and rethrows.
  - In both cases the rejection passes through unchanged, so `boot-thoth-runtime.ts`
    (unchanged) still only logs it.
- Tests:
  - "a background setup failure after the fingerprint records one failed background lastRun
    and one push" checks: `run` is not called, one failed write, one push with no raw text,
    status `lastRun` failed/background, the warn, and no open census.
  - "a background setup failure without a fingerprint warns with a fixed message and pushes
    nothing".

## Plan amendments A-F6 / A-F7

The A-F6 and A-F7 tests are unchanged and pass. Registry removal is still identity-checked
at final release, and the settle rules are unchanged.

## Verification

All commands were run from the worktree root with `TMPDIR=/var/tmp/b878`.

1. `npm run verify -- -p @ptah-extension/memory-curator,@ptah-extension/skill-synthesis`
   - lint and typecheck: `NX   4 tasks: 4 succeeded`
   - test: `NX   2 tasks: 1 succeeded, 1 failed`. skill-synthesis passed. memory-curator gave
     `Tests: 1 failed, 1008 passed, 1009 total`.
   - The one failure is in `observation-queue.store.spec.ts:860`, a file this change does not
     touch. It is a load-timing flake: the warn "slow observation-queue transaction" fired
     because a transaction took 71 ms.
2. `npm run verify -- -t test -p @ptah-extension/memory-curator -- --testPathPatterns=observation-queue.store.spec`
   - `NX   1 task: 1 succeeded`, exit code 0

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Use `isDocumentReview` only on the unattributed match branch | Exclude document reviews from every branch, including those matched by explicit Run ID or session | Finding 3 names the regex at :212, the only classifier in `writeGrades`. A review carrying an explicit Run ID is attributed on purpose. | Yes |
| Guard stale last runs by an in-process `seq` plus the persisted `startedAt` | SQL conditional update; in-memory guard only | Ties at the same millisecond need `seq`. The persisted check covers other instances. The fake DB in the spec does not run SQL conditions. | Yes |
| A stale skip still sends the older census's own complete or failed push | Suppress the push | Each census's outcome is real, and the rule allows at most one push per census. | Yes |
| On a cancelled census whose write failed: warn only | Send failed | A cancel was never a failure push. Sending one would add a push that the A-F6 rules leave out. | Yes |

## Round 2 (codex re-review `code-logic-review-fixes.md`)

Line numbers below are in the current files.

### R2-1: quoted values with whitespace, and backtracking

- `libs/backend/memory-curator/src/lib/triggers/redact-secrets.ts`:
  - :50-59 is a new quoted-value rule. It matches through the closing quote, allows spaces and
    escaped quotes, and redacts to the end of the text if the quote is never closed.
  - :61-68 is the unquoted rule, now limited to values that do not start with a quote.
  - :34-36: the URL scheme length is capped at `{0,31}`, so one long word cannot backtrack
    quadratically.
  - The other rules start only at literal prefixes, or at the start of a run (lookbehind),
    so they stay linear.
- Tests in `redact-secrets.spec.ts`:
  - :26-38 has 5 whitespace and quote sentinel cases. Example: `{"password":"alpha SENTINEL
    beta"}` keeps neither `SENTINEL` nor `beta`.
  - :40-44 checks that text after a closed quoted value is kept.
  - :46-58 has 7 inputs of about 100 KB each: a long word, hex with a trailing letter, a
    mixed-case run, a URL with no `@`, an unclosed quoted secret, repeated key names, and
    Bearer followed by spaces. Each must finish in under 1 s. Measured locally with esbuild
    and node: 10-48 ms each.

### R2-2: a delayed SHA failure must not outrank a newer census

- `indexing-control.service.ts`:
  - :152-155 adds the `SetupAttempt` type.
  - :636-639: `trackBackgroundRun` reserves `seq` and `startedAt` before any `await`.
  - :698-741: `recordBackgroundSetupFailure(workspaceRoot, fp | null, attempt, error)` uses
    the reserved values for its lastRun write.
- Test `spec:1613`: the SHA read is held, a manual census opens and settles, and then the SHA
  read rejects. The test checks that the only lastRun write is the manual one, that status
  shows the manual run, and that exactly one background `INDEXING_FAILED` push is sent.

### R2-3: survive a clock rollback

- `persistLastRun` (:938-970) now has two cases:
  - **This instance already wrote the row for this fingerprint:** order by the in-memory
    `seq` only.
  - **It has not:** compare the stored `startedAt`, which came from another instance or
    process.
- Tests:
  - `spec:1645` mocks `Date.now` going from 10 000 to 5 000. Both writes land, and status
    shows `startedAt` 5 000.
  - `spec:1661` checks that a second instance does not overwrite a newer row written by the
    first.

### R2-4: document reviews never grade on any branch

- `spec-harvester.service.ts:210-214`: `!isDocumentReview(review.file)` now applies to the
  Run ID, session and unattributed branches.
- Test `spec-harvester.service.spec.ts:202-206`: `task-description-review.md` with `Run ID:
  run-1` and `design-spec-review.md` with `Session ID: session-1` write no grade.

### R2-5: a fingerprint failure is visible in the UI

- `libs/shared/src/lib/types/rpc/rpc-indexing.types.ts:135-136`: `IndexingFailedEvent`
  `workspaceFingerprint` is now optional. Its consumers read only `failedAt` and
  `workspaceRoot`, so neither needed a change: `libs/frontend/core/.../back-office-activity.service.ts:503`
  and `libs/frontend/workspace-indexing/.../workspace-indexing.service.ts:278`.
- When the fingerprint cannot be derived, the service now:
  - logs a fixed warning
  - sends one background `INDEXING_FAILED` with no fingerprint
  - writes no lastRun, because there is no `indexing_state` row; a code comment at :692-697
    says so.
- The event has no message field. The fixed sentence comes from the UI consumer, which shows
  "Workspace index failed".
- The fingerprint-failure test (`spec:1588`) now expects one push with no
  `workspaceFingerprint` and no raw text.

### Round 2 verification (TMPDIR=/var/tmp/b878)

1. `npm run verify -- -p @ptah-extension/memory-curator,@ptah-extension/skill-synthesis,@ptah-extension/shared,@ptah-extension/core,@ptah-extension/workspace-indexing`
   - lint and typecheck: `NX   10 tasks: 10 succeeded`
   - test: `NX   5 tasks: 4 succeeded, 1 failed`. memory-curator gave `Tests: 1 failed, 1024
     passed, 1025 total`.
   - The only failure was `boot-scan-runner.spec.ts` › "does not re-admit an unchanged
     given_up generation" (`options.failures?.recordFailure is not a function`). Neither the
     test nor `boot-scan-runner.ts` is modified in the worktree, and it passed in round 1.
2. `npm run verify -- -t test -p @ptah-extension/memory-curator -- --testPathPatterns=boot-scan-runner.spec`
   - `NX   1 task: 1 succeeded`, exit code 0
   - Conclusion: an intermittent failure that is not related to these changes.

`@ptah-extension/core` and `@ptah-extension/workspace-indexing` passed lint, typecheck and
test. That includes the frontend edits in progress by the ui-builder, which I did not touch.
