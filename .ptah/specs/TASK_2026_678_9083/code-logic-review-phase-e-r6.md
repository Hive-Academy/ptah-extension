# Code Logic Review - TASK_2026_678_9083 - Phase E round 6 (delta, commit 2501d9670)

## Summary

| Metric   | Value                                                                                  |
| -------- | -------------------------------------------------------------------------------------- |
| Score    | 8/10                                                                                   |
| Verdict  | APPROVED (with two non-blocking follow-ups)                                            |
| Blocking | 0                                                                                      |
| Serious  | 0                                                                                      |
| Moderate | 2                                                                                      |
| Minor    | 3                                                                                      |
| Scope    | The 6 files of the commit, plus `tribunal-run-coordinator.ts`, `command-center-tribunal.transport.ts`, `command-center-page.controller.ts` (sendCommand, open, answerQuestion callers), `command-center.store.ts` setSession. Ran `session-coordinator.spec.ts` + `command-center-workspace-binding.spec.ts`: 21/21 pass. |

## Review family

- Implementer: codex (CLI lane).
- Reviewer: Anthropic (Claude Sonnet 5.5). Different family from the implementer.

## Status of the r5 findings

| Finding | Status | Evidence |
| ------- | ------ | -------- |
| S-1 (Status bypasses guard) | CLOSED | Guard now sits in `send` (`session-coordinator.ts:239-249`). `sendStatusTurn` (`:274-277`) and `sendLaunchTurn` (`:280-282`) both delegate to `send`, so the Status button (`command-center-page.component.ts:274`), the typed/voice path (`controller.ts:555, 581`) and the Tribunal launch (`tribunal.transport.ts:175-177`) all hit it. A grep of non-spec code finds no other caller of `sender.send`. |
| M-4 (Confirm in stale window) | CLOSED for the launch turn; residue noted in Minor-1 | `tribunal-run-coordinator.ts:228-246`: a `false` from `sendLaunchTurn` falls to `removeManifest(entry.workspace, entry.runId)` and returns `launch-send-failed`, retryable. |
| M-1 (swallowed open rejection) | PARTIAL | Effect and `canSend` catches now set `error` plus a fixed-text toast (`binding.ts:62-70, 80-89`). `opening` resets through the `.finally` chain (`:43-49`), and the spec proves a later change opens again. But the initial page open is still unhandled (Moderate-1). |
| m-2 (`untracked`) | CLOSED | `binding.ts:80` wraps the `open()` call in `untracked`. The `store.workspace()` read in the `else if` at `:79` stays tracked, which is wanted (the effect only re-runs on workspace-signal changes plus that read). |

## AC22 / Amendment A1

Holds. The change adds only a refusal at the top of `send`. Nothing creates text for a roster Confirm, and `confirmProposal` (`controller.ts:588-595`) is untouched. A refused launch returns `false` to the run coordinator, which rolls back, so no Confirm ever reaches the model as text.

## Check 1: every send path and the bypass

- `send`, `sendStatusTurn`, `sendLaunchTurn` are all guarded (spec `it.each` over all three). Typed and voice commands are additionally guarded earlier by `canSend` (`controller.ts:541`), which also triggers a reopen.
- Guard condition is `markedTabId() && workspace() !== tabs.activeWorkspacePath`. With no marked tab the call goes to `openOrResume`, which is deduped through `this.opening` and opens for the active workspace, so the first open is not blocked.
- `answerQuestion` (`session-coordinator.ts:284-289`) still uses the old marked tab with no guard. Honest rating: **Minor**. It answers a question that the old session itself asked, shown on a card the user is looking at, so it is not misdirected content or an answer to the wrong session. The only cost is that the old session continues (a turn the user chose to approve). It is not a billed turn into the wrong workspace in the S-1 sense. See Minor-1 for the Tribunal case.

## Check 2: refused Tribunal launch

Consistent. Order in `tribunal-run-coordinator.ts`: the manifest is written (`:216`) before the send, and a `false` or throw reaches the rollback `removeManifest` (`:239-243`). The state stays `answered` (it is not terminated), so the card stays usable and retryable (`failure('launch-send-failed', true)`). `runId` is kept (`entry.runId ??=`), so a retry reuses it. No "launching" flag exists to get stuck; `inFlight` is released by the caller's normal path. The existing coordinator spec already pins `false` leading to `removeManifest` (`tribunal-run-coordinator.spec.ts:157-160, 337-352`). The toast ends up as the run coordinator's launch-failure text, which overwrites the "switching" toast. Acceptable.

## Check 3: false positives

None found in normal flows.

- Both values come from the same getter. `store.workspace()` is only ever set from `tabs.activeWorkspacePath` (`session-coordinator.ts:56 -> 75/128/187`, read once at the start of `openOrResume`) or carried over (`:264`). There is no normalization on either side, so a trailing slash or Windows case difference cannot arise between them.
- First open in flight: `markedTabId` is null (the last-session path calls `setSession` only after `switchSession`, `:128`), so no block.
- Workspace changes during an in-flight open: the open stores the older workspace, so the guard blocks, and the binding's do-while (`binding.ts:31-38`) reopens. This is the intended case.
- `clear()` sets `markedTabId` to null, so a send then goes to `openOrResume` and fails with the "Open a workspace" message. Correct.

One real dead end is described in Moderate-2.

## Check 4: M-1 details

- No unhandled rejection from the effect or `canSend`: both have a `.catch`. The `.finally().catch()` chain handles its own branch.
- The marker comment ("show a fixed-text toast for open failures") is truthful for these two sites.
- The toast text is fixed and does not leak the error ("private path" in the spec is asserted absent from the toast).

## Findings

### Blocking

None.

### Serious

None.

### Moderate

**Moderate-1. Initial page open still has an unhandled rejection and a stuck `starting` status.**
`command-center-page.component.ts:413` calls `void this.page.open()`; `controller.ts:461` does `await this.workspaceBinding.open()` with no catch. If `openOrResume` rejects there (e.g. `switchTab` or `createCommandCenterTab` throws after `setSessionStatus('starting')`, `session-coordinator.ts:61, 74, 121`), the rejection escapes `page.open()`: it is unhandled, the status stays `starting` with no toast, and the rest of `open()` is skipped (`tribunalTransport.open()` and `voice:getProviderConfig`, so voice provider state is never set). The r6 fix covered the effect and `canSend` paths only; this is the most common first-open path. Likelihood is low (these calls rarely throw), impact is a misleading permanent "starting".
Fix: in `controller.open()` wrap `workspaceBinding.open()` in try/catch that sets `error` plus the same fixed toast (best: a shared `reportOpenFailure(store)` helper used by all three sites) and continues to the voice config. Add a controller spec.

**Moderate-2. After a failed rebind, Status and Tribunal Confirm are refused with a misleading toast and nothing retries the open.**
When `open()` fails on a workspace change, the store keeps the old `markedTabId` and old workspace, so the guard at `session-coordinator.ts:239-249` refuses every send forever. Typed and voice sends recover because `canSend` (`binding.ts:62-70`) reopens each time. The Status button (`page.component.ts:274`, direct to `coordinator.sendStatusTurn`) and a Tribunal Confirm retry do not go through `canSend`, so they only show "switching to the selected workspace. Send again when it is ready." and no reopen occurs, which is untrue after a failure. The user's fix is to type or speak a command. Strictly better than before (previously the turn went to the wrong workspace), so not blocking.
Fix: route the Status button through a controller method that calls `workspaceBinding.canSend()` first, or have the coordinator guard trigger the binding's open. A one-line spec would pin it.

### Minor

- **Minor-1. Tribunal Confirm during the stale window still delivers the discovery answer to the old tab** (`tribunal.transport.ts:82-98` via `answerQuestion`, unguarded), runs a discovery turn on the old session, and only then has the launch refused. The old-session spend is wasted and the card stays until teardown. It is bounded (the marked-tab effect at `controller.ts:317-330` clears the card on rebind) and the user clicked Confirm on that session's own card. A guard in `transport.answer` (return `false` when stale) would make Confirm refuse earlier.
- **Minor-2. Narrow race in `send` when `markedTabId` is null.** `session-coordinator.ts:250` awaits `openOrResume()` for workspace A; if the workspace changes to B during that await, the turn is sent to the A tab. Re-check `tabs.activeWorkspacePath` after the await (about 4 lines). Needs a first open that is slow plus a workspace switch; the old behaviour was the same.
- **Minor-3. The guard toast says "switching" in every refusal**, including the failed-rebind dead end in Moderate-2 and the first open in flight with an unknown workspace (r5 m-3, text only).

## Test quality

- Coordinator spec: `it.each` over `send`, `sendStatusTurn`, `sendLaunchTurn` asserts `false`, `sender.send` not called, status unchanged (`running`) and the exact toast; the positive case asserts the sender call with `tabId` and `running`. Non-tautological; it would fail without the guard. Not pinned: the no-marked-tab case under a stale workspace, and a null `activeWorkspacePath` with a marked tab (both fall out of the same condition).
- Binding spec: the effect rejection test pins error status, the exact fixed toast, `opening` reset (a second `openOrResume` call, with `store.workspace()` landing on `/third`), and the `canSend` rejection path. One weakness: `await expect(binding.open()).rejects` joins the in-flight promise the effect started rather than starting a fresh one, so it proves the shared pending state and not the effect's own catch in isolation; the toast assertion after `await Promise.resolve()` is timing-dependent on microtask order (passes today). No test for `untracked` (m-2), reasonable given it is a dependency-tracking property.
- Controller spec: the new `it.each([true, undefined])` pins that a successful settle of a root without a session id gives `idle` and no toast, closing the r5 N-1 test gap for `hasLiveSession: true`/`undefined`.
- Missing: controller `open()` rejection (Moderate-1), Status button while stale after a failed open (Moderate-2).

## Verdict

APPROVED, 8/10, confidence HIGH. S-1, M-4 and m-2 are closed. M-1 is closed for the effect and `canSend` and still open on the initial page-open path (Moderate-1). The stale-workspace guard is placed at the right layer and has no false-positive path I could construct. Recommend a small follow-up for Moderate-1 and Moderate-2 before release.
