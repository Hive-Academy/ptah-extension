# Code Logic Review — Final Pre-Push (TASK_2026_879_9809)

Review family: reviewer ollama-cloud, implementers codex/grok/claude

Verdict: APPROVED

Score: 8/10

Scope: `git diff main...HEAD`, 7 commits. Reviewed whole changed files in
`libs/backend/lane-outcomes`, `libs/backend/lane-routing`,
`libs/backend/platform-core`, `libs/backend/vscode-lm-tools` and `scripts/dev`.
`.ptah/specs/` documents were read as context only. The P1 fix-round commit
309fde9e6 was covered here as requested. All scoped checks passed before this
review; per the memory-safe rule I ran no verify, build or test.

## Findings

1. **Moderate** — `libs/backend/platform-core/src/file-settings-manager.ts:415-433`
   with `:453-461`. `handleFileRename` sets `fileRenameReestablishPending = true`
   and arms `this.debounceTimer`. If a content `change` event arrives before that
   timer fires, `scheduleDebouncedFlush` clears the same `debounceTimer` and arms
   a plain flush cycle. The pending flag is now latched: no code resets it except
   `disposeCrossProcessWatch` and the cleared timer itself. Every later `rename`
   event returns early at `:416`, so the watcher is never re-established and the
   atomic-replace fix is silently disabled for the rest of the process.
   Reachability is narrow: on Linux the stale inode watcher emits no content
   `change` after a replace, and on Windows the path-based watcher needs no
   re-establishment, so no platform combines both halves. It is still a latch
   with no timeout that silently restores the bug this branch fixes.
   Required fix: reset `fileRenameReestablishPending` when
   `scheduleDebouncedFlush` takes over the timer, or arm the rename timer on a
   separate field so a content change cannot cancel the re-watch.

2. **Minor** — `libs/backend/lane-outcomes/src/lib/store/lane-outcome.store.ts:70-74`
   with the host producer in `lane-outcome-recorder.service.ts:383-443`. A
   host-observed report on a subagent row whose stop was recorded as `failed`
   (for example a timeout) overwrites `verdict` with `delivered` when the
   `WROTE:` files exist, and `failureClass` stays set next to a `delivered`
   verdict. The plan documents the subagent rule for explicit reports, and the
   subagent lane stays out of `pastOutcomes`, but no test pins the
   `failed` → `delivered` case for a host report. Required fix: add that test,
   or preserve a `failed` verdict for `hostObserved` effects the way agent rows
   are preserved at `:71-73`.

3. **Minor** — `libs/backend/lane-outcomes/src/lib/deliverable-check.ts:47-58`.
   `checkDeliverable` stats whatever `realpath` returns. An entry that names a
   directory, or the root itself, stats successfully and its `size` is non-zero,
   so `deliverablesVerdictOf` (`write/report-effect.ts:84-92`) records
   `delivered`. A `WROTE: docs/` line therefore counts as a delivered
   deliverable. Required fix: reject a non-file stat result when the provider
   reports a file type.

4. **Minor** — `libs/backend/lane-outcomes/src/lib/wrote-lines.parser.ts:47-53`
   (`wroteBody`). A `WROTE:` line inside a markdown list (`- WROTE: …`) or with
   a bold prefix (`**WROTE:** …`) does not match, and the row stays `unverified`
   with no warn. That is the safe default and the plan specifies the bare
   case-sensitive prefix, so this is a missed recovery, not a false record.
   Required fix: none before push; consider accepting one list marker or bold
   wrapper.

5. **Minor** — `scripts/dev/seed-lane-outcomes.mjs:16`.
   `realpathSync(process.env.HOME)` throws when `HOME` is unset. The script
   still refuses before any database is opened, so requirement (g) holds, but
   the refusal is a stack trace and exit code 1 instead of the one-line
   refusal with exit 2. Required fix: none for a dev script; a guard would make
   the refusal clean.

No Blocking or Serious findings. The score sits in the "sound" band: the
precedence, containment and logging logic held up under every failure injection
I traced, and the four real gaps above are edge-conditional or cosmetic.

## Verified

- **Requested behaviour is present.**
  - `pastOutcomes` now reaches both providers: `matrix/outcome-figures.ts`
    aggregates verified verdicts per offered `laneId`/`taskKind`
    (`failed` and `no-deliverable` count as failed, `unverified` is skipped,
    subagent, blank-lane and null-kind rows are excluded, deduped by run),
    `model-refine.ts:233-258` recomputes the figures inside the width loop so
    the byte cap counts them in payload and prompt, and fixed pre-flight
    questions still send none.
  - The watcher dispatches on the `eventType` argument of the single `change`
    event (`file-settings-manager.ts:324-330`); a `rename` type re-watches after
    the debounce settles. `fs.watch` emits no separate `rename` event, so the
    old listener at this site was dead code and the fix is correct.
  - One `[lane-routing] route decided` info line per call: success paths log
    exactly once (reused `:147-152`, pre-flight `:210`, gate `:288-291`), and
    the `try`/`catch` in `decide` (`:121-166`) adds one error summary with
    `stage`, `outcome: 'error'`, error name and `durationMs` only. No success
    statement follows a log site that can still throw, so there is no double
    log. `nowMs` is a getter over the injected seam (`:388`).
  - Pre-flight depth descriptions map `DEPTHS` order (`Full`, `Partial`,
    `Minimal`) to `o1`–`o3` via `DEPTH_CRITERIA`; `taskType` criteria and the
    confidence threshold are untouched.
  - The outcome-report tool accepts absolute in-workspace paths and shares
    `checkDeliverable`, so the tool and the host producer apply one rule.

- **Failure behaviour is safe.** Every producer failure leaves the row
  `unverified`, is contained in a `warn` whose meta carries only `runId`,
  a reason code, an errno-style code and a path count
  (`lane-outcome-recorder.service.ts:383-443`), and never throws into the SDK
  callback. The parser refuses the whole message on an empty path, NUL, an
  over-long path or more than 20 paths. Matrix degrade paths (no reader, no
  persistence, no lane ids, reader throw, unreadable snapshot) all return
  `EMPTY_OUTCOME_FIGURES`.

- **Path security.** Lexical gate before any filesystem call (traversal,
  sibling-prefix, absolute-outside, Windows drive, UNC and drive-relative
  entries all rejected); `realpath` of root and entry, then the containment
  test repeated on real paths, and an outside real path is never stat'ed.
  Symlink-in to symlink-in is accepted; symlink-out is rejected without stat;
  a dangling symlink reads as not found; a symlinked root uses the real root.
  TOCTOU between `realpath` and `stat` is local-only and was accepted in the
  plan. Errors carry codes, never paths. The tool's refusal strings echo the
  caller's own path back to the caller in the tool result only; they do not
  reach logs or held payloads.

- **Precedence and idempotency in all three stores.**
  `applyOutcomeEffect` (`lane-outcome.store.ts:63-87`) returns the row
  unchanged when a `hostObserved` effect meets any `deliverablesDeclaredAt`;
  every applied declaration sets that field, so an explicit report wins in
  both orders. SQLite applies it inside `db.transaction`
  (`sqlite-lane-outcome.store.ts:146-179`), the in-memory store is synchronous
  through the mutation, and the key-value store serializes through a promise
  chain and one atomic storage key — there is no check-then-write window.
  The fixed `deliverables:host:<runId>` id makes a repeated `subagentEnded`
  a `duplicate`. Specs cover all four orders plus the held-before-insert case
  in each store, and `subagent-stop.integration.spec.ts` runs the
  explicit-held-before-stop case through the real pipeline.

- **Watcher leaks and double reloads.** The real-fs spec
  (`file-settings-manager.cross-process.spec.ts`, TC-CP-REAL-3) drives two
  successive atomic replacements through the real `fs.watch`, asserts both
  values reload, each stale watcher is closed and exactly one watcher stays
  open; the error-path specs assert a content `change` does not re-establish
  and that repeated `rename` events coalesce. `disposeCrossProcessWatch`
  resets the pending flag and the timer.

- **Callers outside the diff.** `LaneOutcomeRecorder` is constructed only in
  `di/register.ts` (optional provider, guarded by `isRegistered`); the five
  spec constructors stay valid. `recordSubagentEnded` is wired only from
  `di/start.ts`. `CapabilityMatrixSnapshot` is built only in
  `capability-matrix.store.ts` and `gather.ts`; `score.ts` consumes it
  read-only. `runLaneRequest` and `LaneQuestion` are used only inside
  lane-routing and the dev checker. `host-routing.coordinator.ts`
  (`rpc-handlers`) and `route-tool-handlers.ts` (`vscode-lm-tools`) call the
  unchanged `decide` contract and still validate the returned stage. No
  package index beyond lane-outcomes' new `checkDeliverable` exports changed;
  the `@ptah-extension/lane-outcomes` import in vscode-lm-tools is
  pre-existing and resolved by tsconfig paths, matching the other packages.

- **No request or path text in logs.** `preflightSummary` and `gateSummary`
  carry enums, ids, counts and durations; the request text and `reasons`
  strings are excluded and specs assert the log shape. `logSummary` isolates
  builder and logger failures and the fallback warn carries the error name
  only. The open P1 note on caller-supplied `phaseId`/`executor` identifiers
  stays a recorded follow-up (decisions 25/26), not a new defect.

- **Tests assert behaviour.** Real-fs containment specs (worktree and
  symlink cases from decision 16), store precedence orders, real watcher
  replacement, parser boundary cases, gate/pre-flight log assertions
  including the throwing-logger and error cases, and the live checker's
  window/count cross-check against the seeded rows. The hold-TTL deflake
  freezes only `Date` via Jest fake timers in the two 497-plus-one tests;
  no production code changed.

- **Seeder safety.** `safeDbPath` resolves `HOME` and `~/.ptah` to real
  paths, realpaths the target (or its parent when absent), and refuses the
  profile directory and everything inside it before the database is opened
  (refusal at `:76` precedes `Database` at `:77`). A symlink into the
  profile, the profile itself and any interior path are refused; the
  marker check keeps the script off existing Ptah databases, and the live
  checker opens read-only with the same guard and marker.

- **Not verified by me:** runtime behaviour on Windows and macOS (analysis
  only), the live `/v1/systemone` A/B runs (I read the recorded evidence in
  decisions 30–33), and the un-reviewed flaky
  `electron-state-storage-commit-store.spec` noted in decision 27.
