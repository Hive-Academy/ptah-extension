# Code Style Review — `TASK_2026_437_0778` (Batch 5)

## Summary

| Metric          | Value                                |
| --------------- | ------------------------------------ |
| Overall score   | 7/10                                 |
| Assessment      | APPROVE_WITH_FIXES                   |
| Blocking issues | 0                                    |
| Serious issues  | 2                                    |
| Minor issues    | 3                                    |
| Files reviewed  | 13 (4 created, 9 modified)           |

## Five style questions

### 1. What breaks when requirements change in six months?

`HANG_LOG_FILE_NAME` is defined twice — `libs/backend/vscode-core/src/diagnostics/main-loop-watchdog.ts:42` and `apps/ptah-electron/src/services/diagnostics/process-lifecycle-recorder.ts:57` — held equal only by a doc comment ("Twin of vscode-core's `HANG_LOG_FILE_NAME`", `process-lifecycle-recorder.ts:53-55`). A future rename of the file in vscode-core silently forks the two writers onto different files; nothing in the type system or the build catches it. This is the exact class of defect the repo's own `arm-diagnostics.ts` and `armWatchdog` comments are careful to avoid for every other failure path in this batch.

### 2. What would a new team member misread?

They would read `libs/backend/vscode-core/src/diagnostics/index.ts:21-30`, see `HANG_LOG_FILE_NAME` exported from the sub-barrel exactly like `EVENT_LOOP_LAG_WARN_MS_ENV` and `CPU_PROFILE_ON_LAG_MS_ENV` a few lines above, and reasonably assume it is reachable from `@ptah-extension/vscode-core` the same way. It is not — `src/index.ts:115-128` re-exports `EventLoopMonitor`, `CpuProfileCapture`, `armDiagnostics` and their env constants from `./diagnostics`, but never re-exports `MainLoopWatchdog`, `HANG_LOG_FILE_NAME`, or any of the four constants added at `main-loop-watchdog.ts:42-60`. The asymmetry is invisible unless you diff the two barrels.

### 3. What does this cost to maintain?

Every host that needs the hang-log path (today just Electron) has to either re-derive the literal (what happened here) or reach past the public barrel into `@ptah-extension/vscode-core/src/diagnostics/main-loop-watchdog` directly. Both are worse than one export line. The comment at `process-lifecycle-recorder.ts:53-55` is the tell: it exists purely to keep a human honest about a constraint the compiler could enforce for free.

### 4. Where is this inconsistent with the rest of the repository?

- vs. `libs/backend/vscode-core/src/index.ts:115-128`: siblings added by the SAME diagnostics feature (`EventLoopMonitor`, `CpuProfileCapture`) are promoted to the root barrel; `MainLoopWatchdog`'s exports are not, with no stated reason.
- vs. `libs/backend/workspace-intelligence/src/diagnostics/ts-diagnostics-worker-source.ts:1-32`: the precedent this batch explicitly follows (and says so, `main-loop-watchdog-source.ts:5`) documents the eval-worker trade-off in nearly identical terms — that discipline was carried over faithfully. The barrel-export gap is the one place the copy diverges from the source of the pattern.
- vs. `batches.md:320` (Task 5.1 file list: CREATE the recorder + spec, MODIFY `main.ts` **and** `activation/post-window.ts`): the delivered diff touches only `main.ts` (`git diff apps/ptah-electron/src/main.ts`); `post-window.ts` is untouched. Batch 3's outcome section (`batches.md:258`) shows the convention for a deliberate deviation — recorded, with a rationale, under "Accepted deviation". Batch 5's outcome section has no equivalent entry yet (Batch 5 is still IN_PROGRESS per `batches.md:5`), so this is a gap to close before commit, not a defect in the code itself. The chosen placement (subscribing before `app.whenReady`, per `main.ts:83-86`'s own comment) is arguably better than the plan's split, but "better and undocumented" still needs the one line Batch 3 got.

### 5. What would you have done differently, and why is that better rather than merely other?

Promote the six symbols already sitting in `diagnostics/index.ts:21-30` (`MainLoopWatchdog`, `HANG_LOG_FILE_NAME`, `DEFAULT_HEARTBEAT_INTERVAL_MS`, `DEFAULT_HANG_THRESHOLD_MS`, `DEFAULT_HANG_CHECK_INTERVAL_MS`, `MAX_BREADCRUMB_KEYS`, `MAX_BREADCRUMB_VALUE_LENGTH`) to `src/index.ts`, the same way `CpuProfileCapture`'s constants were. `process-lifecycle-recorder.ts` then imports `HANG_LOG_FILE_NAME` from `@ptah-extension/vscode-core` instead of redeclaring it, and the "Twin of..." comment disappears because there is only one definition. This is strictly better than the current state: same runtime behavior, one less place for the two logs to drift apart, and no new export surface risk — `vscode-core` already depends on nothing Electron-specific, so widening its barrel costs nothing on the hexagonal boundary.

## Blocking issues

None.

## Serious issues

### Duplicated `HANG_LOG_FILE_NAME` literal instead of a shared import

- File: `apps/ptah-electron/src/services/diagnostics/process-lifecycle-recorder.ts:57`, twin at `libs/backend/vscode-core/src/diagnostics/main-loop-watchdog.ts:42`
- Problem: two independent `export const HANG_LOG_FILE_NAME = 'ptah-hang.log'` declarations, correctness held together only by a code comment. The constant IS already exported from the lib's `diagnostics/index.ts:23` sub-barrel; it is only missing from the top-level `src/index.ts` barrel that `@ptah-extension/vscode-core` resolves to (compare `src/index.ts:115-128`, which promotes the sibling `EventLoopMonitor`/`CpuProfileCapture` exports).
- Tradeoff: keeping the duplicate avoids widening `vscode-core`'s public API by one constant, but the class it belongs to (`MainLoopWatchdog`) is not otherwise exposed either, and nothing here crosses the hexagonal boundary — `vscode-core` has no Electron dependency either way.
- Recommendation: add `MainLoopWatchdog`, `HANG_LOG_FILE_NAME`, and the four threshold/bound constants to `libs/backend/vscode-core/src/index.ts`'s diagnostics export block, then import `HANG_LOG_FILE_NAME` from `@ptah-extension/vscode-core` in `process-lifecycle-recorder.ts` and delete the local declaration (keep the file's own re-export if other consumers need it from this module, but stop redefining the value).

### Planned file (`post-window.ts`) dropped from Task 5.1 without a recorded deviation

- File: `.ptah/specs/TASK_2026_437_0778/batches.md:320` (Task 5.1 file list) vs. delivered diff (`main.ts` only; `apps/ptah-electron/src/activation/post-window.ts` untouched)
- Problem: the plan named `post-window.ts` as a MODIFY target for wiring the recorder; the implementation instead does the entire wiring pre-`whenReady` in `main.ts:83-98`. Batch 3's outcome section (`batches.md:258`) shows this repo's convention for exactly this situation — log the deviation and the reason under "Accepted deviation" once the batch closes.
- Tradeoff: the actual choice reads as sound (the class doc at `process-lifecycle-recorder.ts:109-112` explains why `install()` must run before `app.whenReady`, which `post-window.ts` — reached well after window creation — could not satisfy), so this is a documentation gap, not a design defect.
- Recommendation: before Batch 5 is marked COMPLETE, add an "Accepted deviation" line to its outcome section naming the file-list change and the one-sentence reason above.

## Minor issues

- `libs/backend/vscode-core/src/diagnostics/main-loop-watchdog.ts:187-193` (`dispose()`'s `catch`) and the worker's own `error`/`exit` handlers (`main-loop-watchdog.ts:143-158`) log without a `degradation-audit:` marker; harmless today because `tools/degradation-audit/baseline.json` does not scan `libs/backend/vscode-core` (only `apps/ptah-electron`, `libs/backend/thoth-runtime`, `libs/backend/persistence-sqlite` are in scope per `check-degradation.ts:20-23`), but worth knowing if that scope ever widens — the sibling file in the same batch (`process-lifecycle-recorder.ts:266-277`, `:314-321`) does carry markers because it lives in a scanned directory.
- `libs/backend/vscode-core/CLAUDE.md`'s new "The hang log" section (lines 107-146) is good prose but is inserted between the existing `EventLoopMonitor` unref note and "## Counting a degradation" — a reader following the "Internal Structure" list at the bottom (`CLAUDE.md:203`, correctly updated to add `MainLoopWatchdog`) has to scroll past the whole diagnostics narrative to find it; consider a forward pointer from "Internal Structure" the way `armDiagnostics` already has one. Cosmetic only.
- The three `container.smoke.spec.ts` additions (`apps/ptah-cli`, `apps/ptah-electron`, `apps/ptah-extension-vscode`) are ~30-line near-duplicates differing only in one doc-comment line naming the host's registration path. This matches the pre-existing per-host smoke-spec pattern in the same files (each host already carries its own resolution assertions), so it is not a new inconsistency — noted only because a future fourth host will need the same block copied a fourth time; no action needed now.

## File-by-file

### `main-loop-watchdog-source.ts`

Score 9/10 — 0 blocking, 0 serious, 0 minor. Matches `ts-diagnostics-worker-source.ts`'s eval-worker discipline almost line for line (String.raw constraint, no-backtick/no-`${}` rule, protocol comment, suspend guard reasoning). The suspend-guard logic (`:94-99`) is a genuinely careful piece of reasoning, stated and implemented consistently.

### `main-loop-watchdog.ts`

Score 7/10 — 0 blocking, 1 serious (shared with the review-wide duplication finding), 1 minor. Class is well-bounded: idempotent `start`, safe-to-repeat `dispose`, `unref()`-ed timer and worker matching the documented `EventLoopMonitor` rule (`:28-31`). The stale-worker guard (`if (this.worker !== worker) return;`, `:144`, `:152`) correctly prevents a terminated-then-replaced worker's late event from clobbering current state.

### `main-loop-watchdog.spec.ts`

Score 8/10 — 0 blocking, 0 serious, 0 minor. Runs the real worker against a real temp file and a real `Atomics.wait` block, which is the only test that actually proves INV-8's claim — mocking the worker would have proven nothing, and the spec's own top comment says so. Six cases cover the hang/recovery pair, silence, multiple cycles, directory creation, an unwritable log, and breadcrumb bounds; idempotent start/dispose is pinned too.

### `diagnostics/index.ts`

Score 8/10 — 0 blocking, 1 serious (contributes to the duplication finding — this is where the promotable exports already sit, one barrel short of the public surface), 0 minor. Export block for `MainLoopWatchdog` mirrors the existing `EventLoopMonitor`/`CpuProfileCapture` blocks exactly in shape.

### `arm-diagnostics.ts`

Score 9/10 — 0 blocking, 0 serious, 0 minor. `armWatchdog` is its own failure boundary (`:137-153`), correctly separated from the lag-monitor's failure boundary so a worker-thread failure (forbidden workers, resource exhaustion) can't cost the host its lag monitor too — exactly the kind of boundary discipline the module doc for `armDiagnostics` itself calls for.

### `di/tokens.ts`, `di/register-platform-agnostic.ts`

Score 9/10 — 0 blocking, 0 serious, 0 minor. `Symbol.for('MainLoopWatchdog')`, UPPER_SNAKE constant, placed beside `EVENT_LOOP_MONITOR`/`CPU_PROFILE_CAPTURE` in both the token file and the `TOKENS` object and the diagnostic log-array (`register-platform-agnostic.ts:140`) — textbook adherence to the CLAUDE.md DI-token rule.

### `libs/backend/vscode-core/CLAUDE.md`

Score 8/10 — 0 blocking, 0 serious, 1 minor (placement/discoverability, above). Content is accurate against the code (verified `1 s` heartbeat, `5 s` threshold, breadcrumb bounds, CLI `--verbose`-gated arming all match `main-loop-watchdog.ts` constants) and gives a genuinely useful "reading it" section for a future incident responder.

### `apps/ptah-electron/src/services/diagnostics/process-lifecycle-recorder.ts`

Score 7/10 — 0 blocking, 1 serious (the duplicated literal), 0 minor. Otherwise a careful piece of code: renderer death taken once from `app` rather than per-`webContents` to avoid double logging (`:14-17`, correctly implemented at `:123-130`), rate-limited console forwarding with a correctly-`unref()`-ed flush timer, UTF-8-safe truncation that steps back over continuation bytes rather than risking a split code point (`:424-431`). Degradation-audit markers are present and correctly zoned everywhere the detector would look (verified against `tools/degradation-audit/check-degradation.ts`'s zone rules).

### `process-lifecycle-recorder.spec.ts`

Score 8/10 — 0 blocking, 0 serious, 0 minor. Fake `EventEmitter`-based `app`/window/`webContents` is the right level of fidelity for a module whose whole contract is "subscribes to named events" (stated explicitly at the file's own top comment). Covers the destroyed-`WebContents` edge case (`:130-147`) that a naive test would miss.

### `apps/ptah-electron/src/main.ts`

Score 8/10 — 0 blocking, 1 serious (shared: undocumented deviation from the Task 5.1 file list), 0 minor. The ordering rationale (Crashpad and the `browser-window-created` subscription both need to exist before `whenReady`, comment at `:83-86`) is correct and matches the class's own documented constraint (`process-lifecycle-recorder.ts:109-112`).

### `apps/ptah-electron/esbuild.config.cjs`

Score 9/10 — 0 blocking, 0 serious, 0 minor. One-line addition (`crashReporter` to `ELECTRON_NAMED_EXPORTS`), correctly placed alphabetically-adjacent to the existing list, no other change.

### `container.smoke.spec.ts` (×3 hosts)

Score 8/10 — 0 blocking, 0 serious, 1 minor (near-duplication across hosts, expected given the existing per-host pattern). Each pins exactly what `batches.md`'s plan-defect D2 called for: resolve as a singleton, unstarted (`running === false`), and assert singleton identity — a real assertion of the "registered but not armed" contract, not a smoke test that merely resolves without checking state.

## Pattern compliance

| Repository rule or nearby convention | Status | Evidence |
| --- | --- | --- |
| Eval'd worker pattern (`String.raw`, no backtick/`${}`, typed mirror + worker doc) | PASS | `main-loop-watchdog-source.ts:1-39` vs. `ts-diagnostics-worker-source.ts:1-32` |
| DI token naming (`Symbol.for`, UPPER_SNAKE, `tokens.ts` + `TOKENS` + register) | PASS | `di/tokens.ts:180-186,277`; `di/register-platform-agnostic.ts:27,101,140` |
| Registered-but-not-started singleton (construction spawns nothing) | PASS | `register-platform-agnostic.ts:99-101` comment; `main-loop-watchdog.ts:127-128` (`start()` guarded, not called from constructor) |
| Hexagonal rule: vscode-core imports nothing Electron-specific | PASS | `process-lifecycle-recorder.ts:38-39` ("imports nothing from `electron` at runtime"); `main-loop-watchdog.ts` has no electron import |
| Public barrel symmetry (new diagnostics export promoted lib-root the way siblings were) | FAIL | `src/index.ts:115-128` omits `MainLoopWatchdog`/`HANG_LOG_FILE_NAME` present in `diagnostics/index.ts:21-30` |
| `catch (error: unknown)`, narrow with `instanceof Error` | PASS | `main-loop-watchdog.ts:189-191`; `process-lifecycle-recorder.ts:274,319,351,390,414` |
| `degradation-audit:` marker on scanned-directory swallowed catches | PASS | `process-lifecycle-recorder.ts:269-271,314-316,347-349,366-368,387-389` (all correctly zoned) |
| Batch file-list fidelity / deviations recorded in `batches.md` | FAIL (pending) | `batches.md:320` names `post-window.ts`; not modified; no "Accepted deviation" entry yet (batch still IN_PROGRESS) |

## Maintenance debt

- Introduced: one new off-thread watchdog class + eval worker, one Electron lifecycle recorder, one new DI token, ~230 lines of CLAUDE.md documentation, six new spec files' worth of coverage.
- Retired: nothing — this batch is additive; no prior diagnostics code was removed or replaced.
- Net: small net addition to maintenance surface, mostly justified by the incident this task exists to prevent recurring silently. The duplicated literal is the one place that adds ongoing risk rather than just size.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Key concern: the duplicated `HANG_LOG_FILE_NAME` literal (Serious #1) is a real, fixable drift risk but is a one-line-export fix, not a redesign; it does not block merge on its own. The undocumented file-list deviation (Serious #2) is a process gap to close in `batches.md` before the batch is marked COMPLETE, not a code change.
- What a 10/10 version would do differently: promote `MainLoopWatchdog`'s exports to `vscode-core`'s root barrel and import `HANG_LOG_FILE_NAME` in the Electron recorder instead of redeclaring it; add the "Accepted deviation" line to Batch 5's outcome section for the `post-window.ts` file-list change; give the CLAUDE.md hang-log section a one-line forward pointer from "Internal Structure".
