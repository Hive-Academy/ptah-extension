# Implementation report

## Result

Routine PostToolUse observations still serialize, enqueue, batch, and persist through `ObservationQueueStore`, but current Electron/VS Code and CLI bridges no longer publish `memory:observationCaptured`. This removes the activity toast/history entry, the non-stream IPC that forced `IpcBridge` to flush pending chat-stream batches, and the TUI list/stats refetch before curation has changed memory.

The remaining meaningful Thoth bridges (curation outcomes, corpus changes, vec status, embedder status) now replace any prior subscription for the same singleton source. Every boot returns an owner-aware disposable; disposing stale boot refs cannot remove the latest bridge. Successful curation events carry their source workspace, and the activity service ignores outcomes for a different active workspace. Existing warning/status activity remains registered.

The logic-review corrections are included: merge-only curation runs (`created = 0`, `merged > 0`) now refresh the TUI and produce a meaningful `Merged N memories` activity; workspace filtering uses the shared canonical key so Windows case, slash, and trailing-separator variants match; and replacement is transactional, so a thrown subscription attempt leaves the healthy prior bridge owned and active. A failed disposal after a successful replacement is reported without discarding the new bridge.

The Memory tab now performs one initial list/stats/symbol load. Its tier, scope, indexing-completion, and workspace-switch effects still reload on real changes, but skip their initial effect pass instead of overlapping `ngOnInit`.

## Scaling assessment

This is deterministic/static evidence, not a UI FPS or latency measurement:

| Session state | Before | After |
| --- | --- | --- |
| Idle retained session | No observation work unless events arrive | Unchanged; retained count alone adds no capture/IPC work |
| Active background session | Each observation was persisted, broadcast, added/coalesced into activity, and could flush pending chat stream IPC | Persistence remains; routine broadcast, renderer activity, TUI refetch, and stream-queue flush are removed |
| Visible streaming canvas tile | Chat deltas use the existing batched stream path, but each observation message forced an early batch flush | Chat batching is unchanged and observation capture no longer enters `sendToRenderer` |

The 1/6/9-workspace-boot regression cases each prove one live memory listener and one curation broadcast, while asserting that the observation store receives zero `onCapture` subscriptions. The number of active sessions still scales capture serialization/enqueue work with actual tool activity; no claim is made that this task measured or removed that host-synchronous cost.

## Changed files

- `apps/ptah-cli/docs/jsonrpc-schema.md`
- `apps/ptah-tui/src/components/thoth/MemoryPanel.tsx`
- `libs/backend/cli-engine/src/lib/bootstrap/wire-thoth-push-bridges.ts`
- `libs/backend/cli-engine/src/lib/bootstrap/wire-thoth-push-bridges.spec.ts`
- `libs/backend/memory-curator/src/lib/diagnostics.types.ts`
- `libs/backend/memory-curator/src/lib/memory-curator.service.ts`
- `libs/backend/memory-curator/src/lib/memory-curator.service.spec.ts`
- `libs/backend/memory-curator/src/lib/observation-queue.store.ts` (documentation only)
- `libs/backend/thoth-runtime/src/lib/boot-thoth-runtime.ts`
- `libs/backend/thoth-runtime/src/lib/boot-thoth-runtime.spec.ts`
- `libs/backend/thoth-runtime/src/lib/types.ts`
- `libs/frontend/core/src/lib/services/back-office-activity.service.ts`
- `libs/frontend/core/src/lib/services/back-office-activity.service.spec.ts`
- `libs/frontend/memory-curator-ui/src/lib/components/memory-curator-tab.component.ts`
- `libs/frontend/memory-curator-ui/src/lib/components/memory-curator-tab.component.spec.ts`
- `libs/shared/src/lib/types/messages/memory.ts` (compatibility documentation only)
- `.ptah/specs/TASK_2026_412/implementation-plan.md`
- `.ptah/specs/TASK_2026_412/implementation-report.md`
- `.ptah/specs/TASK_2026_412/agent-output-root.md`

## Verification

- `@ptah-extension/memory-curator:test`: 31 passing suites / 489 passing tests; 2 suites / 60 native-dependent tests skipped. A later focused rerun of `memory-curator.service.spec.ts` passed 52/52 tests.
- `@ptah-extension/thoth-runtime:test`: 4 suites / 74 tests passed, including 1/6/9 repeated-boot cases, merge-only curation, and failed-replacement retention.
- `@ptah-extension/cli-engine:test`: 17 suites / 173 tests passed, including merge-only curation and no-change suppression.
- `@ptah-extension/core:test`: 28 suites / 665 tests passed, including canonical Windows workspace identity and the explicit pre-readiness drop policy. The suite was rerun after the final activity wording adjustment and remained 665/665 green.
- `@ptah-extension/memory-curator-ui:test`: 16 suites / 171 tests passed.
- Typecheck passed for shared, memory-curator, thoth-runtime, cli-engine, frontend core, and memory-curator-ui. The correction-focused four-project run (shared, thoth-runtime, cli-engine, frontend core) also passed.
- Lint completed successfully for memory-curator, thoth-runtime, cli-engine, frontend core, memory-curator-ui, and ptah-tui with zero errors. The correction-focused run reported 15 existing warnings across cli-engine, frontend core, and shared; thoth-runtime was clean. The earlier six-project run reported 46 existing warnings in unrelated files.
- `git diff --check`: passed.

## Blockers and gaps

- Publishing authorization was subsequently clarified: the combined PR is intentionally allowed to include both independent scopes. The four inherited TASK_2026_409 commits are being preserved because they repair future local-production installer packaging, production-data backup checks, and unsigned/vendor-signature verification; they are not represented as dependencies of the notification fix.
- Dependency determination: after refreshing all remote refs, `origin/main..HEAD` still contains four inherited local-production/TASK_2026_409 commits: `b5959c2ae`, `9d0382da7`, `1ea605915`, and `01155ae3c`. None is an ancestor of current `origin/main`; GitHub's commit-to-PR API reports that none of the four SHAs exists on the remote. PR [#485](https://github.com/Hive-Academy/ptah-extension/pull/485) merged the original safe local-production workflow, but these later repair commits are not among its commits and are not currently on `main`.
- The inherited diff is independent of TASK_2026_412: it changes only Electron local-production packaging configuration, database-backup/signature-verification scripts and tests, plus TASK_2026_409 records. There is zero file overlap with the notification work; searches found no references to those scripts/configuration from the affected CLI, TUI, memory, Thoth, frontend-core, memory-UI, or shared sources. The focused notification tests and typechecks also run without the Electron packaging target. These repairs may be useful, but they are neither source nor build/test dependencies of this task.
- `ptah-tui:test` did not run: the focused `MemoryPanel.spec.tsx` attempt stopped in its declared dependency graph at `ptah-cli:copy-wasm` because `node_modules/web-tree-sitter/web-tree-sitter.wasm` is absent. Per task constraints, dependencies were not installed or rebuilt; therefore the TUI test count is zero, not a pass.
- `ptah-tui:typecheck` is already blocked by `apps/ptah-tui/src/build-artifact-gate.ts` being included without Jest globals; the build tsconfig additionally exposes existing incomplete VS Code shim types. The changed TUI file itself passed project lint.
- No live database, live settings, paid model, Electron UI, FPS, or latency measurement was used.

## Session

Codex CLI session: `01a088b2-233d-7f40-aa88-6fecae626bda`
