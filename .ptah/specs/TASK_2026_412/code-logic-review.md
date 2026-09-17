# TASK_2026_412 — Code logic review

## Verdict

**NEEDS CHANGES — 7/10.** The implementation removes routine observation fan-out without changing capture persistence, and the owner-token replacement prevents stale boot disposables from removing the latest memory listener. However, two user-visible correctness gaps remain in meaningful curation delivery/workspace routing, and the replacement helper drops a healthy bridge if a later subscription attempt fails.

## Findings

### 1. Medium — merge-only curation never refreshes the TUI

**Evidence:**

- `libs/backend/cli-engine/src/lib/bootstrap/wire-thoth-push-bridges.ts:38-49`
- `libs/backend/thoth-runtime/src/lib/boot-thoth-runtime.ts:301-317`
- `apps/ptah-tui/src/components/thoth/MemoryPanel.tsx:30-33,148-160`

Both host bridges publish `MEMORY_EXTRACTED` only when `stats.created > 0`, although the payload and activity mapper explicitly support `merged`. After this change, the TUI refreshes only for `MEMORY_EXTRACTED` or corpus changes; its former observation-triggered refresh is gone.

**Failure scenario:** a curation pass resolves every draft into an existing memory (`created = 0`, `merged > 0`). Stored memory content/salience changes, but neither bridge emits the only curation notification the TUI listens to. The visible TUI list and stats remain stale until another qualifying event or remount. The new tests use only `{ created: 1, merged: 0 }`, so they do not cover this case.

**Smallest remedy:** emit the meaningful curation event when `created > 0 || merged > 0` in both bridges, and add merge-only assertions to both bridge suites. Keep extracted-but-fully-skipped runs quiet because they made no stored-memory change.

### 2. Medium — raw workspace string equality drops valid same-workspace activity on Windows

**Evidence:**

- `libs/frontend/core/src/lib/services/back-office-activity.service.ts:160-169,372-382`
- `libs/shared/src/lib/utils/workspace-root-key.ts:35-49`
- `libs/frontend/core/src/lib/services/back-office-activity.service.spec.ts:251-271`

`isForActiveWorkspace` compares the event root and active root with exact string equality. The repository's shared normalization utility documents that startup roots, renderer echoes, and agent working directories can identify the same Windows directory with different case, slash direction, or trailing separators. The test uses identical POSIX strings and therefore misses the platform case.

**Failure scenario:** the active workspace is `D:\Projects\Ptah`, while a successful curation event carries `d:/projects/ptah/`. The event belongs to the active workspace but is discarded as foreign, so the user loses the meaningful curation activity item this task intended to preserve. An event arriving while the active scope is still `null` is also discarded; there is no replay after workspace readiness.

**Smallest remedy:** compare non-null string roots through the existing shared `normalizeWorkspaceRoot` helper, while retaining the current compatibility behavior for `null`/omitted roots. Add case/separator/trailing-slash coverage and explicitly decide/test the pre-readiness (`activeWorkspacePath === null`) policy.

### 3. Low — a failed replacement destroys the last working singleton bridge

**Evidence:**

- `libs/backend/thoth-runtime/src/lib/boot-thoth-runtime.ts:65-79`
- `libs/backend/thoth-runtime/src/lib/boot-thoth-runtime.ts:291-345`

`replacePushBridge` deletes and disposes the previous subscription before calling `subscribe()`. The surrounding boot blocks deliberately treat bridge wiring failures as non-fatal, but a thrown `subscribe()` (or thrown prior `dispose()`) now leaves that singleton source with no active bridge.

**Failure scenario:** workspace A has a healthy curator/status bridge. During workspace B's boot, a source rejects a new subscription. The error is logged and boot continues, but the working A subscription was already removed; subsequent meaningful events are lost until another successful boot.

**Smallest remedy:** create and validate the candidate first, then atomically replace the map entry and dispose the previous subscription. If candidate creation fails, leave the previous entry active. Add a repeated-boot test whose second subscription throws.

## What was verified

- Verified the requested worktree and branch: `fix-observation-session-performance` at `D:\projects\ptah-extension\.claude-worktrees\fix-observation-session-performance`.
- Read `CLAUDE.md`, the applicable area instructions, `context.md`, `implementation-plan.md`, `implementation-report.md`, and the complete 16-file product diff.
- `git diff --check` passed.
- Independently ran four test targets with Nx cache bypassed:
  - `@ptah-extension/thoth-runtime`: 4 suites / 73 tests passed.
  - `@ptah-extension/cli-engine`: 17 suites / 172 tests passed.
  - `@ptah-extension/core`: 28 suites / 663 tests passed.
  - `@ptah-extension/memory-curator-ui`: 16 suites / 171 tests passed.
- Independently ran `memory-curator.service.spec.ts`: 1 suite / 52 tests passed.
- Independently ran `ptah-tui:typecheck`: it failed on the six Jest-global errors in `src/build-artifact-gate.ts`. `HEAD` contains the same file/config and neither is in this task's diff, so that attribution is verified as pre-existing.
- A `ptah-tui:test` attempt produced no diagnostic before the bounded 64-second timeout and was not counted as a pass or as evidence of a product failure. Source/config inspection confirms that the test target depends on the CLI build and that `node_modules/web-tree-sitter/web-tree-sitter.wasm` is absent, but this review did not independently reproduce the report's exact build error.
- The implementation report's full memory-curator result (489 passing / 60 skipped), other typechecks, and lint totals were not rerun. No dependency install, native rebuild, live DB/settings access, model traffic, commit, reset, or product-code edit was performed.

## Capture and contract assessment

- No production `onCapture` subscriber remains outside `ObservationQueueStore`; the shared message constant/payload mapping remains for compatibility.
- `ObservationQueueStore` behavior changed only in documentation in this diff. Capture batching, SQLite writes, and its store-level listener tests remain present, so no source-level persistence regression was found.
- Meaningful corpus, vec, embedder, and curation subscriptions remain wired. The 1/6/9 regression table specifically proves one live **memory curator** listener, one curation broadcast, zero observation subscriptions, and stale-owner disposal safety for sequential boots. It does not exercise repeated-boot cardinality for corpus/vec/embedder sources or replacement failure.
- No material scope creep was found; the changed files align with the stated plan.

## Six-session implications and unmeasured gaps

The diff supports a static cardinality conclusion: routine observation capture no longer enters either renderer/CLI push bridge, so each active background session avoids that per-observation fan-out and the TUI's premature list/stats requests. The Electron IPC path can therefore no longer be forced to flush pending chat batches by this message type. Capture serialization, enqueueing, synchronous SQLite batching, and actual tool activity still scale with active sessions.

The 1/6/9 tests are workspace-boot tests, not active-session benchmarks. They use sequential boots, one singleton curator, one webview manager, and one synthetic event after boot. They do not measure six idle/background/visible sessions, concurrent boots, IPC volume, event-loop delay, renderer work, FPS, database latency, memory use, or stream flush timing. No measured performance claim should be attached to this review.
