# TASK_2026_156 — Batch 2 Implementation Report (Bridge Conversation-First Resolution + Webview Attach Alignment)

**Developer**: senior-backend-developer | **Date**: 2026-07-10
**Worktree**: `D:/projects/ptah-extension/.claude-worktrees/fix/gateway-turn-hang` (branch `fix/gateway-turn-hang`)
**Scope**: plan §9 Batch 2 — M11 (bridge resolution + tracker wiring + spec) and M7-part-1 (`attachSession` → `setPtahSessionIdAndWorkspaceRoot` + spec). NOT committed (per instructions). No Batch 3/4/5 files touched — the concurrent Batch 3 agent's files (`libs/backend/messaging-gateway/src/lib/commands/*`, `apps/ptah-electron/src/services/gateway/*`, `phase-2-libraries.ts`) were left strictly alone.

---

## Per-Item Status

| Item | Status | Detail |
|---|---|---|
| M11 — conversation-first resolution in `runTurn` | DONE | `libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.ts` — the `binding.workspaceRoot ?? workspace.getWorkspaceRoot() ?? null` block is replaced with `resolveEffectiveWorkspaceRoot({ conversationRoot: conversation.workspaceRoot, bindingRoot: binding.workspaceRoot, workspace })` (imported from `@ptah-extension/messaging-gateway`, Batch 1 export). `conversation-root-revoked` → fail-closed reply `"This thread's workspace is no longer available in Ptah. Run /workspace use to pick another."` (module const `WORKSPACE_UNAVAILABLE_MESSAGE`); `no-workspace-open` → the existing "No workspace is open in Ptah…" text. Early returns keep the exact pre-155 position (before `sealTurn` is defined; `sendError` drains directly) so sealing semantics are unchanged (plan §6). |
| M11 — fs-exists fail-closed gate | DONE | New private `workspaceRootExists(root)` (`await access(root)` from `node:fs/promises`, `try/catch` → boolean), run once per turn on the resolved root after resolution succeeds; miss → same revoked-style error, no session start (plan §6 "+ async fs.access", Data-2/AC-6.3 spirit). Kept out of the pure resolver per plan §3.2. |
| M11 — `ConversationTurnTracker` wiring | DONE | Bridge injects `GATEWAY_TOKENS.GATEWAY_TURN_TRACKER` (appended constructor param, type-only `ConversationTurnTracker` import). `onInbound` now does exactly plan §4.6: `turnTracker.begin(conversationKey)` then `void this.queue.enqueue(...).catch(() => undefined).finally(() => this.turnTracker.end(conversationKey))` — busy while running OR queued; released on settle (watchdog guarantees settlement, so busy-state cannot leak). No `registerGatewayChatBridge` change needed: the tracker token is registered by `registerMessagingGatewayServices` (Batch 1), which the register.ts doc-contract already covers ("the `GATEWAY_TOKENS` services"). |
| M11 — spec updates | DONE | `gateway-chat-bridge.spec.ts` — harness gains `getWorkspaceFolders` mock (+ `workspaceFolders` setup option), a REAL `ConversationTurnTracker` instance (exposed on the harness), the tracker ctor arg, and a top-level `jest.mock('node:fs/promises')` (spreads `requireActual`, `access` defaults to resolve so all pre-existing synthetic roots like `/ws/proj` keep working). 8 new behavioral specs (see below). All 31 TASK_2026_155 test bodies untouched and passing. |
| M7-part-1 — `attachSession` conversation-level stamp | DONE | `libs/backend/messaging-gateway/src/lib/gateway.service.ts` — `this.conversations.setPtahSessionId(conversation.id, sessionUuid)` → `this.conversations.setPtahSessionIdAndWorkspaceRoot(conversation.id, sessionUuid, workspaceRoot)` (Batch 1 transactional method). Binding-level `bindings.setWorkspaceRoot` write stays (Data-4). Doc comment extended with the AC-7.4/Data-3 invariant rationale. |
| M7-part-1 — spec updates | DONE | `gateway.service.spec.ts` — conversation-store fake gains `setPtahSessionIdAndWorkspaceRoot: jest.fn()`; happy-path attach assertion updated to the atomic call `('conv-1', 'uuid-1', '/repo')`; NEW spec "stamps the workspace root on the conversation row atomically with the session link (AC-7.4), never via the separate single-field writers" — asserts the txn method with a threaded conversation + custom root, `setPtahSessionId` NOT called, and the binding-level write unchanged. |

## New behavioral specs (gateway-chat-bridge.spec.ts)

`GatewayChatBridge — conversation-first workspace resolution (TASK_2026_156)`:
1. allowlisted conversation-pinned root preferred over binding root (projectPath/workspaceId = conversation root; allowlist consulted).
2. NULL conversation root inherits the binding root.
3. NULL conversation root + NULL binding root falls back to the active workspace.
4. conversation root that left the allowlist → fail-closed error (exact `/workspace use` message), NO silent fallback to binding root, no `startChatSession`/`resumeSession`, drained on the right key.
5. allowlisted conversation root missing on disk (`access` rejects) → same fail-closed error, no session start (`access` called with the pinned root).

`GatewayChatBridge — turn tracker wiring (TASK_2026_156)`:
6. key busy while a turn runs AND while a second is queued behind it; released once the chain settles.
7. key released even when the turn fails before a session starts (no-workspace error path).
8. key released after the watchdog force-terminates a hung turn (fake timers, `TURN_WATCHDOG_MS`) — the §4.6/155 interplay case.

## Decisions Taken

1. **fs-exists gate applies to every resolved root** (conversation/binding/active), matching the plan §6 snippet's unconditional `fs.access(resolved.root)` — not only conversation-sourced roots. A binding/active root deleted mid-session now gets the clear revoked-style reply instead of an opaque SDK spawn failure. Strictly fail-closed; no 155 semantics weakened (gate runs before the watchdog is armed and before `sealTurn` exists, mirroring the old early-return position).
2. **Spec-side fs seam = module mock, not a production seam**: `jest.mock('node:fs/promises')` with `access` defaulting to success keeps every existing test body byte-identical; the on-disk-miss spec uses `mockRejectedValueOnce`. No injectable fs port was added (would be scope creep beyond M11).
3. **Harness `getWorkspaceRoot` now honors the port contract** (`string | undefined`, never `null`): `setup({ workspaceRoot: null })` maps to `undefined`. The old bridge coerced with `?? null`; the shared resolver (Batch 1) treats `undefined`/`''` as unset per `IWorkspaceProvider.getWorkspaceRoot(): string | undefined`. Only the harness mock changed — the one existing test using it ("no workspace resolvable") passes with its body unmodified.
4. **`gateway-chat-bridge/package.json` deps back-filled via `nx lint --fix`** (added `@ptah-extension/vscode-lm-tools`, `agent-sdk`, `agent-generation` at `0.0.1`): a PRE-EXISTING `@nx/dependency-checks` error — those imports landed with TASK_2026_155 (commit `bf55272c2` era) without a package.json update. In-scope file; required to make the `nx lint gateway-chat-bridge` gate green.
5. **Removed the pre-existing unused `ISessionResumabilityChecker` import** in `gateway.service.spec.ts` (the single lint warning Batch 1 flagged) — file is in Batch 2 scope; messaging-gateway lint is now warning-free.
6. **Real tracker instance in the harness** (not a jest mock) so specs assert observable `isBusy` behavior across the enqueue/settle lifecycle instead of call counts.

## Conflicts / Deviations to flag

- None against the plan. Note for the coordinator: the messaging-gateway test totals below include the CONCURRENT Batch 3 agent's suites already present in this shared worktree (command service etc.) — all passing at run time; my diff does not touch those files.

## Verification (run from the worktree root, final state)

1. `npx nx run-many -t typecheck --projects=gateway-chat-bridge,messaging-gateway` → **Successfully ran target typecheck for 2 projects**.
2. `npx nx run-many -t test --projects=gateway-chat-bridge,messaging-gateway` → **Successfully ran target test for 2 projects**:
   - gateway-chat-bridge: 2 suites passed, **39/39 tests passed** (31 pre-existing TASK_2026_155 specs, bodies unmodified + 8 new Batch 2 specs).
   - messaging-gateway: 14 suites passed / 1 skipped, **197 passed / 32 skipped** (skips = the pre-existing better-sqlite3 native-binary skip path documented in Batch 1; totals include the concurrent Batch 3 suites).
3. `npx nx run-many -t lint --projects=gateway-chat-bridge,messaging-gateway` → **Successfully ran target lint for 2 projects** (0 errors, 0 warnings — see Decisions 4 & 5).

## Files Modified (5)

- `libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.ts` (M11)
- `libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.spec.ts` (M11 spec)
- `libs/backend/gateway-chat-bridge/package.json` (lint dependency-checks back-fill, Decision 4)
- `libs/backend/messaging-gateway/src/lib/gateway.service.ts` (M7-part-1)
- `libs/backend/messaging-gateway/src/lib/gateway.service.spec.ts` (M7-part-1 spec + Decision 5)

## Handoff notes

- Batch 3's command service can rely on: the bridge marks `GATEWAY_TURN_TRACKER` busy from the synchronous `onInbound` (so `isBusy` is race-safe against a just-emitted inbound event on the same tick) and the turn path now uses `resolveEffectiveWorkspaceRoot` + an `fs.access` existence gate with the exact reply strings above — `/sessions`//`session use`/`/workspace use` messaging should stay consistent with them.
- M7-part-2 (`setCommandHandler` wiring in `wireAdapter`/`maybeStartDiscord`) remains for Batch 4; `attachSession` needs no further changes.
