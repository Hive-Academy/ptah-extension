# Review fixes — `TASK_2026_853_3401`

Inputs: `code-style-review.md`, `code-logic-review.md`. All changes are uncommitted in this worktree.

## Style review

| Finding | Status | What changed |
| --- | --- | --- |
| BLOCKING: eager-closure gate not updated; stale `display-sheet.state.ts` entry | Fixed | `scripts/eager-closure-gate.js`: removed the deleted `display-sheet.state.ts` pattern. Added patterns for `display-window-sync.service.ts`, `display-window-wire.ts`, `display-sidebar-wiring.ts`, `transcript-turn-artifacts.ts`, `services/artifacts/published-artifact.ts` and `libs/shared/.../rpc/rpc-display-window.types.ts` (re-exported at runtime by `rpc.types.ts`). The detached window's component and state handler are left unlisted on purpose: they must stay lazy. `eager-closure-gate.spec.ts`: replaced the stale row with the six new paths and added a negative case for `display-window.component.ts`. The gate script needs esbuild stats from a build, and builds are not allowed here, so only its spec was run. The pre-push `validate-deps` gate will run it against a real build. |
| Serious: duplicated "open review" logic and its two message constants | Fixed | `change-set-actions.service.ts` now owns `NO_CHANGE_SET_TEXT`, `ACTION_FAILED_TEXT` and `runDisplayChangeSetAction()`. `display-sheet.component.ts` and `display-window-sync.service.ts` both import them. A missing change set is still reported in the same tick, because the code runs before the first await. |
| Serious: child IPC allowlist documented twice | Fixed | The `display-window.config.ts` doc comment now refers to `DISPLAY_WINDOW_ALLOWED_METHODS` in `ipc-bridge.ts` and no longer repeats the list. |
| Serious: component keeps the "sheet" name | Skipped | The rename would touch many files for no change in behaviour. Left as a follow-up: rename to `display-sidebar` (selector, test ids, CSS classes, barrel, gate pattern). |
| Minor: `console` instead of a logger, parameter properties, size of `chat-view.component.ts` | Skipped | The review marks these as consistent with sibling code. |

## Logic review

| Finding | Status | What changed |
| --- | --- | --- |
| SERIOUS: publish is gated on `requestAnimationFrame`, which stalls while the main window is minimized or hidden | Fixed | `display-window-sync.service.ts` now coalesces publishes with a 16 ms `setTimeout`. rAF is no longer used. The JSON check that skips unchanged views is kept. The spec still mocks rAF (cancel removes only the given id). A new test proves that publishes go out while no rAF frame ever runs. |
| Failed publish is not retried | Fixed | A failed publish (RPC `success: false` or a rejection) is retried up to 3 times with a growing delay (500, 1000, 1500 ms). The retry count resets after a success. If a newer publish already went out, the failed one is not retried. Specs cover the limit and a retry that succeeds. |
| Oversized snapshot is not visible in the child | Fixed | New wire field `notice` (`DisplayWindowView`, `toWire`, schema, `parseWireState`). An oversized view is replaced by a small "too large" notice view, published for the same tab. The main rail error is kept. `display-window.component.ts` shows the notice (`data-testid="display-window-notice"`) instead of the panel. |
| Dropped stale-tab actions reported as `relayed: true` | Fixed | Host: `ElectronDisplayWindowHost.relayAction` returns `false` when a snapshot is cached for a different tab, so the child shows its existing "did not receive" error. The port doc is updated. With no snapshot, the result is unchanged, so the contract runner still passes. Main renderer: `attach` is always honoured, whatever tab it came from. Any other dropped action triggers an immediate republish so the child resyncs. Specs added on both sides. |
| Child keeps the previous tab's content after the source unbinds | Fixed | When `view()` becomes null while detached, a "no chat tab" notice view is published for the last published tab. Spec added. |
| Auto-open order inversion (concurrent `settings:get` reads) | Fixed | `artifact-message-handler.service.ts` gives each message an arrival number. An auto-open whose settings read finishes after a newer publish already opened is dropped, so the latest publish wins, as the plan requires. Spec added in which the older read resolves last. |
| Blank child after a failed load or a renderer crash | Fixed | `display-window.ts`: `loadFile` rejection, a main-frame `did-fail-load` (except `ERR_ABORTED` -3) and `render-process-gone` each log an error and close the child. The existing `closed` handler then removes trust from the sender, drops the snapshot and sends `displayWindow:closed`, so the main renderer re-attaches the panel. `DisplayChildWindow.webContents` gained the two typed `on` overloads. Specs cover the three triggers and the ignored aborted or sub-frame failures. The degradation audit flags the new synchronous `BrowserWindow.close()` by name as a floating promise, so it carries a `reported` marker. |
| Re-publish of a known artifact re-selects it in an unpinned open dock | Kept (plan rule) | `implementation-plan.md` §B: `requestArtifactAutoOpen` copies `requestAutoOpen`. An open pinned dock does not move. Otherwise the dock opens with the artifact selected, and "Several publishes: the latest wins". Re-selecting is therefore the stated behaviour. To change it, the plan must change first. |
| Delayed auto-open when settings are slow | Not in scope | Not in the fix list. The 5 s timeout and the fallback to on are unchanged. |
| Bounds saved while minimized or maximized | Not in scope | The review rates the current fallback as acceptable. |

### Minor

| Finding | Status | What changed |
| --- | --- | --- |
| Clipboard IPC has no sender check | Skipped | The sender check in `IpcBridge` (`senderRole`) is private. The bridge is created in `bootstrap.ts`, after `post-window.ts` registers `clipboard:*`, so following that helper would mean moving the channel registration into the bridge. The Display window may also need the clipboard (copy buttons). This is not a minimal fix. Follow-up: register `clipboard:*` inside `IpcBridge` behind `senderRole`. |
| Malformed publish result produces no log | Fixed | `published-artifact.ts` logs, once per tool node id, a completed publish call with no text output, non-JSON output, or no artifact id. Turns are walked again on every change, which is why the log is limited to once per node. Spec added. |
| Other minors (revision never checked, maximized state not persisted, child unaware the main window is hidden) | Skipped | Out of scope for this pass. |

## Follow-ups

- Rename `display-sheet` to `display-sidebar` (identifiers, test ids, CSS, barrel, gate pattern).
- Move `clipboard:read-text` and `clipboard:write-text` into `IpcBridge` behind its sender check.
- Run `scripts/eager-closure-gate.js` against a real webview build. The pre-push `validate-deps` and CI do this.
