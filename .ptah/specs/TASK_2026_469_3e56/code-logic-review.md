# Code Logic Review — `TASK_2026_469_3e56`

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 4/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 1              |
| Serious issues      | 2              |
| Moderate issues     | 2              |
| Failure modes found | 5              |

## Verdict

**REVISE.** Ten of the eleven round-2 defects are implemented in the reviewed source. Backend defect 2 remains incomplete for terminals detected from a PATH location that is not byte-for-byte one of the built-in paths. Round 2 also introduced three merge-blocking behaviours: a working Windows Terminal hand-off can launch an unwanted `cmd.exe`, same-workspace `git:info` responses can apply out of order, and a superseded stash-list request reports success and can hide the real failure from the current request.

Focused verification passed:

- `@ptah-extension/platform-core:test`: 42 suites, 802 passed, 4 todo.
- `@ptah-extension/rpc-handlers:test`: 101 suites, 3,074 passed, 33 skipped.
- `@ptah-extension/git-ui:test`: 27 suites, 414 passed.
- Typecheck passed for platform-core, rpc-handlers, and git-ui.
- `ptah_get_diagnostics` was attempted repeatedly with the reviewed files but remained unavailable because its TypeScript check did not finish inside the tool window; the project typechecks above are the diagnostic evidence used instead.

## Round-2 defect verification

| Defect                                                                | Status        | Evidence and whether the named test fails without the fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend 1 — reject a candidate that starts and immediately fails      | **VERIFIED**  | The probe observes `exit`, `error`, and the synchronous `exitCode` before accepting a process (`libs/backend/platform-core/src/utils/terminal-launch.ts:252`, `libs/backend/platform-core/src/utils/terminal-launch.ts:255`, `libs/backend/platform-core/src/utils/terminal-launch.ts:325`, `libs/backend/platform-core/src/utils/terminal-launch.ts:333`). The non-zero-exit and error tests assert a second spawn, not merely that a mock ran (`terminal-launch.spec.ts:294`, `terminal-launch.spec.ts:308`, `terminal-launch.spec.ts:311`, `terminal-launch.spec.ts:325`); both fail against the pre-probe implementation, which returns after the first non-null pid. The WindowsApps test also fails without the probe (`terminal-launch.spec.ts:405`, `terminal-launch.spec.ts:421`), although it encodes the new false-positive described in new finding 1.                                                                                                                                                                                                                                                                                                                                                                                                         |
| Backend 2 — fallback on non-Windows hosts                             | **NOT FIXED** | The platform gate is gone, but follow-on candidates are appended only when the detected path exactly matches an entry in the built-in list (`libs/backend/platform-core/src/utils/terminal-launch.ts:197`, `libs/backend/platform-core/src/utils/terminal-launch.ts:202`, `libs/backend/platform-core/src/utils/terminal-launch.ts:207`). Detection preferentially returns the command found in any PATH directory (`libs/backend/platform-core/src/utils/editor-launcher-detection.ts:341`, `libs/backend/platform-core/src/utils/editor-launcher-detection.ts:344`, `libs/backend/platform-core/src/utils/editor-launcher-detection.ts:347`), so `/usr/local/bin/x-terminal-emulator` or `/etc/alternatives/x-terminal-emulator` produces `targetIndex === -1` and gets no gnome/konsole/xterm fallback. The named Linux tests use the exact built-in `/usr/bin/x-terminal-emulator` (`terminal-launch.spec.ts:182`, `terminal-launch.spec.ts:243`, `terminal-launch.spec.ts:273`), and they do fail against the old Windows-only gate, but they do not exercise the real PATH-produced `targetIndex === -1` branch. The explicit test for that branch asserts the incomplete behaviour—one attempt only (`terminal-launch.spec.ts:229`, `terminal-launch.spec.ts:240`). |
| Backend 3 — remove unreachable handler retry                          | **VERIFIED**  | `openDetected` now selects one detected target and invokes the launcher once (`libs/backend/rpc-handlers/src/lib/handlers/editor-rpc.handlers.ts:183`, `libs/backend/rpc-handlers/src/lib/handlers/editor-rpc.handlers.ts:184`, `libs/backend/rpc-handlers/src/lib/handlers/editor-rpc.handlers.ts:190`). The named test asserts one call and fixed error copy (`editor-rpc.handlers.spec.ts:173`, `editor-rpc.handlers.spec.ts:182`, `editor-rpc.handlers.spec.ts:189`). **It does not fail against the old loop when detection returns only one target**, so it does not independently prove loop removal; the source diff does.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Backend 4 — exercise the production terminal call shape               | **VERIFIED**  | `spawnTerminalProcess` exposes only the four production parameters (`libs/backend/platform-core/src/utils/terminal-launch.ts:187`, `libs/backend/platform-core/src/utils/terminal-launch.ts:191`), and the win32 tests call that shape (`terminal-launch.spec.ts:376`, `terminal-launch.spec.ts:383`, `terminal-launch.spec.ts:430`, `terminal-launch.spec.ts:433`). These tests would still compile and run against the prior optional fifth parameter, so **they do not fail merely because that test-only parameter exists**. The signature/source change, rather than the assertions, proves its removal.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Frontend 1 — stale fetch must not clear a newer fetch's loading state | **VERIFIED**  | A fetch increments `fetchGeneration`, and only the latest generation clears loading (`libs/frontend/git-ui/src/lib/services/git-status.service.ts:331`, `libs/frontend/git-ui/src/lib/services/git-status.service.ts:358`). The named test keeps A and B pending separately and asserts loading remains true after A settles (`git-status.service.spec.ts:306`, `git-status.service.spec.ts:327`, `git-status.service.spec.ts:330`); it fails without the generation check. New finding 2 covers the missing response-order check.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Frontend 2 — do not steal focus after primary or mouse activation     | **VERIFIED**  | `choose` records whether the menu was open and only restores focus for a non-mouse activation (`libs/frontend/git-ui/src/lib/open-in/open-in-button.component.ts:203`, `libs/frontend/git-ui/src/lib/open-in/open-in-button.component.ts:213`, `libs/frontend/git-ui/src/lib/open-in/open-in-button.component.ts:223`). The named tests assert `document.activeElement` is not the caret after a primary click and a real `MouseEvent` with `detail: 1` (`open-in-button.component.spec.ts:234`, `open-in-button.component.spec.ts:246`, `open-in-button.component.spec.ts:249`, `open-in-button.component.spec.ts:265`); both fail against unconditional caret focus.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Frontend 3 — reset drop confirmation across workspace/list identity   | **VERIFIED**  | Confirmation is keyed by hash and linked to open state, active workspace, and the ordered hash list (`libs/frontend/git-ui/src/lib/stash/stash-popover.component.ts:97`, `libs/frontend/git-ui/src/lib/stash/stash-popover.component.ts:193`, `libs/frontend/git-ui/src/lib/stash/stash-popover.component.ts:197`). The two named tests mutate the entries and workspace and assert the confirm control disappears (`stash-popover.component.spec.ts:147`, `stash-popover.component.spec.ts:162`, `stash-popover.component.spec.ts:165`, `stash-popover.component.spec.ts:173`); they fail against the old `isOpen`-only/index-keyed signal. No reset-on-unrelated-state-write was found: `stash.entries` suppresses propagation when the entries array reference is unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Frontend 4 — loading flags clear on supersession/collapse             | **VERIFIED**  | Collapse explicitly clears `filesLoading` (`libs/frontend/git-ui/src/lib/services/git-stash.service.ts:187`, `libs/frontend/git-ui/src/lib/services/git-stash.service.ts:193`); current owners clear list/file loading in `finally` (`git-stash.service.ts:167`, `git-stash.service.ts:231`), while mutation invalidation clears both immediately (`git-stash.service.ts:259`, `git-stash.service.ts:263`). The named test asserts the flag is false both before and after the stale show response settles (`git-stash.service.spec.ts:367`, `git-stash.service.spec.ts:382`, `git-stash.service.spec.ts:390`), so it fails without the collapse fix. It covers `filesLoading`; it does not directly cover superseded `listLoading`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Frontend 5 — preserve an actual reload failure                        | **VERIFIED**  | The generic stash-list-changed message is restored only when `loadListFor` reports success (`libs/frontend/git-ui/src/lib/services/git-stash.service.ts:306`, `libs/frontend/git-ui/src/lib/services/git-stash.service.ts:308`). The named test makes `git:stashList` return `Git index locked.` and asserts that exact copy remains (`git-stash.service.spec.ts:393`, `git-stash.service.spec.ts:404`, `git-stash.service.spec.ts:416`); it fails against the old unconditional overwrite. New finding 3 shows that the boolean result is unsound under supersession.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Frontend 6 — recover after a failed mutation invalidates a list read  | **VERIFIED**  | Mutation records whether it invalidated an in-flight read and conditionally reloads, then restores the mutation error after a successful reconciliation (`libs/frontend/git-ui/src/lib/services/git-stash.service.ts:258`, `libs/frontend/git-ui/src/lib/services/git-stash.service.ts:312`, `libs/frontend/git-ui/src/lib/services/git-stash.service.ts:319`). The named test asserts both the recovered entry list and preserved merge-conflict error, then proves the invalidated old response cannot replace it (`git-stash.service.spec.ts:419`, `git-stash.service.spec.ts:440`, `git-stash.service.spec.ts:445`); it fails without the recovery reload.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Frontend 7 — only the latest clicked stash file opens                 | **VERIFIED**  | Every file request receives a monotonically increasing token, checked after both awaits (`libs/frontend/git-ui/src/lib/services/git-stash.service.ts:361`, `libs/frontend/git-ui/src/lib/services/git-stash.service.ts:364`, `libs/frontend/git-ui/src/lib/services/git-stash.service.ts:378`). The named test resolves B before A and asserts only B opens and total calls remain one after A resolves (`git-stash.service.spec.ts:448`, `git-stash.service.spec.ts:494`, `git-stash.service.spec.ts:511`, `git-stash.service.spec.ts:529`); it fails without the token.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

## Five logic questions

### 1. How does this fail silently?

A superseded stash-list read returns `true`, which callers interpret as a successful refresh; the identity-mismatch and failed-mutation branches can then overwrite a newer request's concrete reload error with generic mutation copy (`libs/frontend/git-ui/src/lib/services/git-stash.service.ts:126`, `libs/frontend/git-ui/src/lib/services/git-stash.service.ts:160`, `libs/frontend/git-ui/src/lib/services/git-stash.service.ts:307`, `libs/frontend/git-ui/src/lib/services/git-stash.service.ts:319`).

Same-workspace `git:info` calls are generation-ordered only for clearing the spinner. An older response that arrives last still passes the workspace check and silently replaces newer status (`libs/frontend/git-ui/src/lib/services/git-status.service.ts:331`, `libs/frontend/git-ui/src/lib/services/git-status.service.ts:340`, `libs/frontend/git-ui/src/lib/services/git-status.service.ts:353`).

### 2. What user action produces unexpected behaviour?

Choosing Open in Terminal when the detected target is Windows Terminal can open Windows Terminal and then also open `cmd.exe`: every early clean exit from a WindowsApps path is classified as failure, even when the launcher successfully handed the request to the terminal app (`libs/backend/platform-core/src/utils/terminal-launch.ts:253`, `libs/backend/platform-core/src/utils/terminal-launch.ts:257`, `libs/backend/platform-core/src/utils/terminal-launch.ts:289`, `libs/backend/platform-core/src/utils/terminal-launch.ts:326`).

Two rapid operations that both refresh git status can resolve newest-first; the later completion from the older request overwrites the current branch/files because generation is not checked before applying data (`libs/frontend/git-ui/src/lib/services/git-status.service.ts:331`, `libs/frontend/git-ui/src/lib/services/git-status.service.ts:353`).

### 3. What input data produces a wrong answer?

A valid terminal target found as `/usr/local/bin/x-terminal-emulator`, `/etc/alternatives/x-terminal-emulator`, or another PATH-resolved path not identical to the built-in list receives no fallback candidates (`libs/backend/platform-core/src/utils/editor-launcher-detection.ts:341`, `libs/backend/platform-core/src/utils/editor-launcher-detection.ts:347`, `libs/backend/platform-core/src/utils/terminal-launch.ts:202`, `libs/backend/platform-core/src/utils/terminal-launch.ts:207`).

### 4. What happens when a dependency fails?

If a newer stash-list dependency fails while an older, superseded list call is still pending, the newer call correctly records its concrete error. When the older call later settles, it returns `true` despite applying nothing, allowing its caller to overwrite the concrete dependency error (`libs/frontend/git-ui/src/lib/services/git-stash.service.ts:126`, `libs/frontend/git-ui/src/lib/services/git-stash.service.ts:127`, `libs/frontend/git-ui/src/lib/services/git-stash.service.ts:153`, `libs/frontend/git-ui/src/lib/services/git-stash.service.ts:309`).

The terminal probe cleans its timer and both listeners on every normal `finish` path (`libs/backend/platform-core/src/utils/terminal-launch.ts:317`, `libs/backend/platform-core/src/utils/terminal-launch.ts:320`, `libs/backend/platform-core/src/utils/terminal-launch.ts:322`), and the timer is unreferenced (`libs/backend/platform-core/src/utils/terminal-launch.ts:329`). No timer/listener leak is evidenced on those paths. A healthy long-running candidate, however, makes the RPC wait the entire 1.5-second probe window before reporting success (`libs/backend/platform-core/src/utils/terminal-launch.ts:255`, `libs/backend/platform-core/src/utils/terminal-launch.ts:329`).

### 5. What is missing that the requirements never mentioned?

The fetch generation needs to own both loading and data publication, ideally per workspace; otherwise it solves spinner ordering while leaving response ordering wrong (`libs/frontend/git-ui/src/lib/services/git-status.service.ts:331`, `libs/frontend/git-ui/src/lib/services/git-status.service.ts:340`, `libs/frontend/git-ui/src/lib/services/git-status.service.ts:358`).

The stash list helper needs a three-state result—applied success, applied failure, or superseded. A boolean cannot distinguish a real success from a response intentionally discarded by generation (`libs/frontend/git-ui/src/lib/services/git-stash.service.ts:117`, `libs/frontend/git-ui/src/lib/services/git-stash.service.ts:127`, `libs/frontend/git-ui/src/lib/services/git-stash.service.ts:161`).

## Failure modes

### 1. Working Windows Terminal hand-off is classified as failure

- Trigger: `wt.exe` is detected under `Microsoft\WindowsApps` and exits cleanly inside 1.5 seconds after handing the request to Windows Terminal.
- Symptom: Windows Terminal opens, then the loop launches the `cmd.exe` fallback as well; the RPC still looks successful.
- Evidence: `libs/backend/platform-core/src/utils/terminal-launch.ts:253`, `libs/backend/platform-core/src/utils/terminal-launch.ts:257`, `libs/backend/platform-core/src/utils/terminal-launch.ts:289`, `libs/backend/platform-core/src/utils/terminal-launch.ts:326`.
- Current handling: `knownStub` turns every exit—including code 0—into failure. The test explicitly locks in this classification using a mock that cannot represent a successful GUI hand-off (`libs/backend/platform-core/src/utils/terminal-launch.spec.ts:405`, `libs/backend/platform-core/src/utils/terminal-launch.spec.ts:421`).
- Recommendation: Do not infer app-alias failure from path plus early clean exit. Capture a definitive failure signal (non-zero exit, spawn/error state, or validated stderr/result from a dedicated launcher) and accept exit 0 consistently; add a Windows integration seam/test for an already-running Terminal instance.

### 2. Same-workspace git status responses apply out of order

- Trigger: Two `refresh()` calls for one workspace overlap and the newer request resolves first.
- Symptom: The UI briefly shows the new state, then reverts to the older branch/file snapshot when the first call resolves.
- Evidence: `libs/frontend/git-ui/src/lib/services/git-status.service.ts:331`, `libs/frontend/git-ui/src/lib/services/git-status.service.ts:340`, `libs/frontend/git-ui/src/lib/services/git-status.service.ts:353`.
- Current handling: Generation controls only `_isLoading`; it is not checked before `applyGitInfo`.
- Recommendation: Track the latest fetch generation per workspace and require both workspace ownership and matching generation before publishing data or clearing that workspace's loading owner. Add a newest-first/same-workspace response-order spec.

### 3. Superseded stash read hides the current reload failure

- Trigger: Mutation recovery starts list read A; a newer list read B starts and fails; A settles afterward.
- Symptom: B's concrete error (for example `Git index locked.`) is replaced by `The stash list changed...` or by the earlier mutation error, while the list remains unreconciled.
- Evidence: `libs/frontend/git-ui/src/lib/services/git-stash.service.ts:126`, `libs/frontend/git-ui/src/lib/services/git-stash.service.ts:127`, `libs/frontend/git-ui/src/lib/services/git-stash.service.ts:160`, `libs/frontend/git-ui/src/lib/services/git-stash.service.ts:161`, `libs/frontend/git-ui/src/lib/services/git-stash.service.ts:307`, `libs/frontend/git-ui/src/lib/services/git-stash.service.ts:319`.
- Current handling: A discarded response returns `true`, the same value as an applied successful response.
- Recommendation: Return an explicit discriminated result such as `applied-success | applied-failure | superseded`; only restore mutation copy after `applied-success`, and never patch over state owned by a newer generation. Add an out-of-order recovery test where the newer read fails first.

### 4. PATH-resolved terminal bypasses the non-Windows fallback

- Trigger: `x-terminal-emulator` is found on PATH at a path not identical to `/usr/bin/x-terminal-emulator`.
- Symptom: Its failed spawn is the only attempt even when gnome-terminal, konsole, xfce4-terminal, or xterm is available.
- Evidence: `libs/backend/platform-core/src/utils/editor-launcher-detection.ts:341`, `libs/backend/platform-core/src/utils/editor-launcher-detection.ts:347`, `libs/backend/platform-core/src/utils/terminal-launch.ts:202`, `libs/backend/platform-core/src/utils/terminal-launch.ts:207`.
- Current handling: Built-in fallbacks are appended only after an exact normalized-list match; the `targetIndex === -1` test expects no fallback (`libs/backend/platform-core/src/utils/terminal-launch.spec.ts:229`, `libs/backend/platform-core/src/utils/terminal-launch.spec.ts:240`).
- Recommendation: Always append the platform's built-in candidates after the detected executable, de-duplicated by normalized comparison; if the target matches a built-in entry, preserve the intended suffix ordering.

### 5. Healthy terminal launch holds the RPC for 1.5 seconds

- Trigger: A terminal process stays alive past the probe window.
- Symptom: The launch succeeds immediately at OS level, but the UI receives no success for 1.5 seconds.
- Evidence: `libs/backend/platform-core/src/utils/terminal-launch.ts:170`, `libs/backend/platform-core/src/utils/terminal-launch.ts:255`, `libs/backend/platform-core/src/utils/terminal-launch.ts:329`; the test advances exactly that interval before the promise resolves (`libs/backend/platform-core/src/utils/terminal-launch.spec.ts:328`, `libs/backend/platform-core/src/utils/terminal-launch.spec.ts:340`).
- Current handling: Every live candidate is awaited through the whole probe.
- Recommendation: Decouple acknowledgement from monitoring, or use a shorter/target-specific definitive probe. Do not keep the editor RPC pending solely to infer long-lived success.

## Blocking issues

### Superseded list read can erase the real failure

- File: `libs/frontend/git-ui/src/lib/services/git-stash.service.ts:126`
- Scenario: A stale list request is superseded, a newer list request fails, then the stale request returns `true` to mutation recovery.
- Impact: The user is told only that the stash list changed or that the mutation failed; the actual reconciliation failure is hidden and the visible list may remain stale. This is a silent failure at the destructive stash boundary.
- Fix: Replace the boolean return with an applied/superseded result and prohibit stale callers from patching the current generation's error.

## Serious issues

### Working Windows Terminal can produce a second terminal

- File: `libs/backend/platform-core/src/utils/terminal-launch.ts:326`
- Scenario: The WindowsApps launcher exits 0 after a successful hand-off.
- Impact: One click performs two visible launches and reports success, making the fallback indistinguishable from duplicate execution.
- Fix: Treat exit 0 as success unless there is a definitive launch failure; test the app-alias hand-off rather than only a fabricated exit code.

### Older status response can replace newer state

- File: `libs/frontend/git-ui/src/lib/services/git-status.service.ts:353`
- Scenario: Same-workspace refresh B resolves before older refresh A.
- Impact: Branch, ahead/behind counts, and changed-file state regress to stale values with no error.
- Fix: Check a per-workspace request generation before applying the response, not only before clearing loading.

## Moderate and minor issues

- **Moderate — backend defect 2 incomplete:** PATH-resolved non-built-in terminal paths get no fallback (`libs/backend/platform-core/src/utils/terminal-launch.ts:202`, `libs/backend/platform-core/src/utils/terminal-launch.ts:207`).
- **Moderate — successful launch latency:** a stable terminal delays the RPC by 1.5 seconds (`libs/backend/platform-core/src/utils/terminal-launch.ts:255`, `libs/backend/platform-core/src/utils/terminal-launch.ts:329`).

## New findings introduced by round 2

1. **MERGE-BLOCKING — WindowsApps clean exit is misclassified.**
   - File: `libs/backend/platform-core/src/utils/terminal-launch.ts:326`
   - Failure scenario: a working `wt.exe` hands off successfully and exits 0 inside the probe; `knownStub` forces failure and the loop launches `cmd.exe` too.
   - Fix: accept clean exit unless an actual failure signal exists; cover a successful hand-off separately from a broken alias.

2. **MERGE-BLOCKING — fetch generation does not guard data publication.**
   - File: `libs/frontend/git-ui/src/lib/services/git-status.service.ts:353`
   - Failure scenario: two same-workspace refreshes resolve newest-first; the older response applies last and silently restores stale status.
   - Fix: use per-workspace generation ownership for both apply and loading, and add a reverse-resolution test.

3. **MERGE-BLOCKING — stale list requests report success and hide newer failures.**
   - File: `libs/frontend/git-ui/src/lib/services/git-stash.service.ts:127`
   - Failure scenario: a superseded recovery read returns `true` after a newer read already recorded a real error; mutation code overwrites that error.
   - Fix: return a distinct `superseded` outcome and never let the stale caller patch current state.

4. **FOLLOW-UP — the probe delays successful long-lived launches.**
   - File: `libs/backend/platform-core/src/utils/terminal-launch.ts:329`
   - Failure scenario: xterm or another healthy process remains alive, so the launch RPC waits the full 1.5 seconds.
   - Fix: acknowledge spawn separately from bounded health observation, or reduce/use a target-specific probe.

No timer or listener leak was found on the probe's normal exit, error, and timeout paths: `finish` clears the timer and removes both listeners (`libs/backend/platform-core/src/utils/terminal-launch.ts:317`, `libs/backend/platform-core/src/utils/terminal-launch.ts:322`). The focus fix does not depend solely on `document.activeElement`; actual mouse clicks are classified from the event before the focus fallback (`libs/frontend/git-ui/src/lib/open-in/open-in-button.component.ts:213`, `libs/frontend/git-ui/src/lib/open-in/open-in-button.component.ts:221`).

## Data flow

1. **Terminal detect — GAP:** PATH detection may return a path outside the built-in list (`editor-launcher-detection.ts:341`), which prevents fallback construction (`terminal-launch.ts:207`).
2. **Terminal spawn — OK:** `whenSpawned === null` moves to the next candidate (`terminal-launch.ts:252`, `terminal-launch.ts:262`).
3. **Terminal early-exit probe — GAP:** clean WindowsApps exit is forced to failure (`terminal-launch.ts:326`), and live success waits 1.5 seconds (`terminal-launch.ts:329`).
4. **Git status request — OK:** each call receives a generation (`git-status.service.ts:331`).
5. **Git status response — GAP:** workspace is checked but generation is not checked before applying (`git-status.service.ts:340`, `git-status.service.ts:353`).
6. **Stash list request — OK:** per-workspace generation is assigned (`git-stash.service.ts:118`).
7. **Stash stale response — GAP:** discarded response reports success (`git-stash.service.ts:127`, `git-stash.service.ts:161`).
8. **Mutation reconciliation — GAP:** callers use that false success to restore less-specific error copy (`git-stash.service.ts:307`, `git-stash.service.ts:319`).
9. **File diff request — OK:** latest-click token is checked after both awaits (`git-stash.service.ts:364`, `git-stash.service.ts:378`).

## Requirements fulfilment

| Requirement                  | Status   | Gap                                                                                       |
| ---------------------------- | -------- | ----------------------------------------------------------------------------------------- |
| Backend round-2 defect 1     | COMPLETE | Exact broken-alias case is caught, but the heuristic creates new finding 1.               |
| Backend round-2 defect 2     | PARTIAL  | Exact built-in Linux path falls back; arbitrary PATH-resolved path does not.              |
| Backend round-2 defect 3     | COMPLETE | Dead RPC retry loop removed.                                                              |
| Backend round-2 defect 4     | COMPLETE | Test-only candidates parameter removed; production call shape used.                       |
| Frontend round-2 defects 1–7 | COMPLETE | All named scenarios are implemented; defects 1 and 5 have newly exposed concurrency gaps. |

Implicit requirements not addressed: a successful launcher hand-off must not cause duplicate visible actions; async generations must order data/error publication as well as loading flags; a discarded result must not be represented as success.

## Edge cases

| Case                                                   | Handled | How                                                                          | Concern                          |
| ------------------------------------------------------ | ------- | ---------------------------------------------------------------------------- | -------------------------------- |
| Spawn never starts                                     | YES     | Null pid advances candidate (`terminal-launch.ts:252`).                      | None found.                      |
| Candidate exits non-zero                               | YES     | Probe advances candidate (`terminal-launch.ts:325`).                         | None found.                      |
| Candidate exits 0 after valid Windows app hand-off     | NO      | Path heuristic overrides exit 0 (`terminal-launch.ts:326`).                  | Duplicate terminal.              |
| Stable candidate                                       | PARTIAL | Accepted after timeout (`terminal-launch.ts:329`).                           | 1.5-second UI latency.           |
| PATH path absent from built-in list                    | NO      | `targetIndex === -1` adds nothing (`terminal-launch.ts:207`).                | No fallback.                     |
| Two same-workspace status reads, reverse completion    | NO      | Generation not checked before apply (`git-status.service.ts:353`).           | Stale state wins.                |
| Stale stash list completion                            | PARTIAL | Data is discarded, but return value is `true` (`git-stash.service.ts:127`).  | Caller overwrites current error. |
| Drop confirmation after workspace/list identity change | YES     | Hash/workspace/list linked source resets (`stash-popover.component.ts:193`). | No unrelated-state reset found.  |
| Two file diff clicks, reverse completion               | YES     | Latest global token wins (`git-stash.service.ts:361`).                       | None found in reviewed scope.    |

## Final verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: stale async owners can still publish success-looking state or hide the current failure at two user-visible boundaries.
- What a robust implementation would add: per-workspace status response generations; a discriminated stash-list completion result; fallback construction for any detected terminal path; a definitive Windows app-alias failure signal; and tests for same-workspace reverse completion, superseded recovery plus newer failure, and successful Windows Terminal hand-off.
