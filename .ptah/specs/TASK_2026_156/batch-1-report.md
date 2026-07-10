# TASK_2026_156 — Batch 1 Implementation Report (Data Layer & messaging-gateway Foundations)

**Developer**: senior-backend-developer | **Date**: 2026-07-10
**Worktree**: `D:/projects/ptah-extension/.claude-worktrees/fix/gateway-turn-hang` (branch `fix/gateway-turn-hang`)
**Scope**: plan §9 Batch 1 — C1, C2, M1, M2, M3, C3, C4, C5, C6, C7, C8, C9, M8, M9, M10. No behavior change; nothing from Batches 2–5 was started. NOT committed (per instructions).

---

## Per-Item Status

| Item | Status | File(s) |
|---|---|---|
| C1 migration 0028 | DONE | `libs/backend/persistence-sqlite/src/lib/migrations/0028_gateway_conversation_workspace_root.ts` — exact SQL/header from plan §3.1 (`ALTER TABLE gateway_conversations ADD COLUMN workspace_root TEXT;`, static, no `${...}`) |
| C2 migration spec | DONE | `.../0028_gateway_conversation_workspace_root.spec.ts` — registry-entry shape (version 28, plain sql, not vec-gated, highest bundled version); behavior on a 0005→0024 gateway schema with 0024-era rows: nullable TEXT column added (7 cols total), existing rows (backfilled `default` + thread row) read back `workspace_root = NULL` (AC-7.1); re-run no-op via `SqliteMigrationRunner` ledger. Mirrors `0024_gateway_conversations.spec.ts` conventions incl. native-availability skip guard |
| M1 registry | DONE | `.../migrations/index.ts` — import + `{ version: 28, name: '0028_gateway_conversation_workspace_root', sql }` appended after 27 |
| M2 type | DONE | `libs/backend/messaging-gateway/src/lib/types.ts` — `GatewayConversation.workspaceRoot: string \| null` (doc: NULL = inherit binding root) |
| M3 store + spec | DONE | `libs/backend/messaging-gateway/src/lib/conversation.store.ts` — `ConversationRow.workspace_root`, `SELECT_COLS`, `toConversation`, `insert` writes explicit NULL (AC-7.3); new methods per plan §3.4: `setWorkspaceRoot(id, root)`, `setWorkspaceRootAndClearSession(id, root)` (single better-sqlite3 txn, SEC-4), `setPtahSessionIdAndWorkspaceRoot(id, uuid, root)` (txn, Data-3/AC-7.4), `findBySessionId(uuid): GatewayConversation[]` (durable AC-3.4 ownership check). All follow the existing prepare/run → re-read → throw-if-vanished style. Spec extended (`conversation.store.spec.ts`): SCHEMA_VERSIONS now `[5, 6, 20, 24, 28]`; NULL workspaceRoot on create; setWorkspaceRoot keeps session; setWorkspaceRootAndClearSession sets+clears together, no-session-safe, other conversations untouched; setPtahSessionIdAndWorkspaceRoot atomic round-trip + last_active_at bump; findBySessionId cross-binding + empty; unknown-id throws for all three writers |
| C3 workspace resolution | DONE | `libs/backend/messaging-gateway/src/lib/workspace-resolution.ts` — `normalizeWorkspacePath` (resolve → forward slashes → lower-case → strip trailing slash), `isAllowlistedWorkspaceRoot` (EXACT-root only; header documents the deliberate SEC-2 divergence from the subpath-accepting `rpc-handlers` helper, which is also a forbidden import), `workspaceRootDigest` (`#` + first 16 sha256 hex of normalized path, §2.2 pick-value fallback), `resolveEffectiveWorkspaceRoot` (conversation → binding → active; non-NULL conversation root must be allowlisted or FAILS CLOSED with `conversation-root-revoked`; else `no-workspace-open`). Pure/synchronous — fs existence deliberately left to callers per plan §3.2. Signatures/`EffectiveWorkspace` union exactly as plan |
| C4 resolution spec | DONE | `workspace-resolution.spec.ts` — precedence (conversation > binding > active), fail-closed on revoked root with binding+active present, subpath/parent/non-member/empty-allowlist rejection, dot-dot handling, case/trailing-slash/separator normalization (backslash cases win32-gated for portability), digest shape/stability/distinctness, returned root preserves the caller's original (unnormalized) string |
| C5 turn tracker | DONE | `libs/backend/messaging-gateway/src/lib/turn-activity-tracker.ts` — `@injectable() ConversationTurnTracker` with counter-based `begin/end/isBusy` keyed by `ConversationKey` (§4.6); `end` deletes at 0 and clamps (no negative wedge) |
| C6 tracker spec | DONE | `turn-activity-tracker.spec.ts` — busy between begin/end, stays busy with a queued turn behind a running one, per-key isolation (NFR-4), unmatched-end safety |
| C7 lister port | DONE | `session-lister.interface.ts` — `GatewaySessionSummary`, `IGatewaySessionLister.listForWorkspace(root): Promise<{ sessions; truncated }>` exactly per plan §4.2; doc notes host-implemented pattern + token |
| C8 activity port | DONE | `session-activity.interface.ts` — `ISessionActivityProbe { isActive(sessionUuid: string): boolean }`; doc notes Electron `useFactory` over `TOKENS.AGENT_ADAPTER` |
| C9 command types | DONE | `commands/gateway-command.types.ts` — `GatewayCommand` union, `GatewayCommandInvocation`, `GatewayCommandOutcome`, `GatewayAutocompleteRequest`, `IGatewayCommandHandler` byte-equivalent to plan §4.4 (untrusted-pick and no-inbound/no-persist notes in header) |
| M8 tokens | DONE | `di/tokens.ts` — `GATEWAY_COMMAND_SERVICE`, `GATEWAY_TURN_TRACKER`, `GATEWAY_SESSION_LISTER`, `GATEWAY_SESSION_ACTIVITY_PROBE` (`Symbol.for('Ptah…')`, unique descriptions) |
| M9 register | DONE (partial by design) | `di/register.ts` — registers `GATEWAY_TURN_TRACKER` → `ConversationTurnTracker` singleton; doc-comment gains the two host preconditions (session lister, activity probe) mirroring the `GATEWAY_TOKEN_VAULT` contract. The `GATEWAY_COMMAND_SERVICE` registration line is deferred to Batch 3 — see Decisions |
| M10 barrel | DONE | `src/index.ts` — exports `ConversationTurnTracker`, the four resolution functions + `EffectiveWorkspace`, `IGatewaySessionLister`/`GatewaySessionSummary`, `ISessionActivityProbe`, and the five §4.4 command contracts |

## Consequential edits outside the listed items (compile-green requirement)

- `libs/backend/messaging-gateway/src/lib/gateway.service.spec.ts` — `makeConversation` helper gains `workspaceRoot: null` (required field added by M2; one line).
- `libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.spec.ts` — same one-line `workspaceRoot: overrides.workspaceRoot ?? null` in its `makeConversation`. No bridge production code touched (that is Batch 2 / M11).
- `libs/backend/persistence-sqlite/src/lib/migrations/0027_skill_event_reconciliation.spec.ts` — removed its "is the highest bundled version = 27" test (now false by construction once 0028 exists); the assertion moved forward into the 0028 spec, matching the head-migration convention.

## Decisions Taken

1. **M9 split**: plan text says "Register command service + turn tracker", but `GatewayCommandService` (C10) is a Batch 3 create — registering it now cannot compile. Registered the tracker only and documented the host preconditions; the one `registerSingleton(GATEWAY_COMMAND_SERVICE, GatewayCommandService)` line lands with C10. This is the reconciliation the batch definition itself implies ("everything compiles green alone"), not a design change.
2. **Resolver returns the stored root verbatim** (not the normalized/lower-cased form) when the conversation root passes the allowlist check — normalization is comparison-only, so downstream `fs.access`/`resolvePremiumContext` see the user's real path casing.
3. **Empty-string roots treated as unset** in `resolveEffectiveWorkspaceRoot` (defensive; `''` can never be a valid absolute root and must not dodge the fallback chain).
4. **Digest helper named `workspaceRootDigest`**, emitting `#<16 hex>` of the normalized path per §2.2 (the plan's trailing space inside the quoted value was treated as a typo).
5. **Portability of resolution specs**: backslash-form assertions are `win32`-gated; all other assertions are platform-neutral (built via `path.resolve`).

## Conflicts / Deviations to flag

- None blocking. No plan-vs-code contradictions encountered beyond the M9 sequencing note above.

## Verification (all run from the worktree root)

1. `npx nx run-many -t typecheck --projects=messaging-gateway,persistence-sqlite,gateway-chat-bridge` → **Successfully ran target typecheck for 3 projects**; `npx nx run-many -t typecheck --projects=shared` → green (shared untouched, run per gate list).
2. `npx nx run-many -t test --projects=messaging-gateway,persistence-sqlite,gateway-chat-bridge` → **all green**:
   - messaging-gateway: 13 passed / 1 skipped suites, 141 passed / 32 skipped tests
   - persistence-sqlite: 8 passed / 8 skipped suites, 75 passed / 58 skipped tests
   - gateway-chat-bridge: 2 passed suites, 31 passed tests (all TASK_2026_155 specs untouched and passing)
3. `npx nx run-many -t lint --projects=messaging-gateway,persistence-sqlite,gateway-chat-bridge` → green; 1 pre-existing warning in `gateway.service.spec.ts` (`ISessionResumabilityChecker` unused import — present before this batch; my diff to that file is the single `workspaceRoot: null` line).

**Environment caveat**: the local `better-sqlite3` native binary is compiled for a different NODE_MODULE_VERSION (electron-rebuilt), so the native-DB-backed assertions (0028 behavior tests, ConversationStore suite) took their built-in `nativeAvailable` skip path — the exact same pre-existing skip behavior as the 0024 spec and the existing ConversationStore suite in this environment. They will execute on CI/dev setups with a Node-matched binary. Registry-entry tests, workspace-resolution, and turn-tracker suites executed fully.

## Files Created (8)

- `libs/backend/persistence-sqlite/src/lib/migrations/0028_gateway_conversation_workspace_root.ts`
- `libs/backend/persistence-sqlite/src/lib/migrations/0028_gateway_conversation_workspace_root.spec.ts`
- `libs/backend/messaging-gateway/src/lib/workspace-resolution.ts`
- `libs/backend/messaging-gateway/src/lib/workspace-resolution.spec.ts`
- `libs/backend/messaging-gateway/src/lib/turn-activity-tracker.ts`
- `libs/backend/messaging-gateway/src/lib/turn-activity-tracker.spec.ts`
- `libs/backend/messaging-gateway/src/lib/session-lister.interface.ts`
- `libs/backend/messaging-gateway/src/lib/session-activity.interface.ts`
- `libs/backend/messaging-gateway/src/lib/commands/gateway-command.types.ts`

## Files Modified (10)

- `libs/backend/persistence-sqlite/src/lib/migrations/index.ts`
- `libs/backend/persistence-sqlite/src/lib/migrations/0027_skill_event_reconciliation.spec.ts`
- `libs/backend/messaging-gateway/src/lib/types.ts`
- `libs/backend/messaging-gateway/src/lib/conversation.store.ts`
- `libs/backend/messaging-gateway/src/lib/conversation.store.spec.ts`
- `libs/backend/messaging-gateway/src/lib/di/tokens.ts`
- `libs/backend/messaging-gateway/src/lib/di/register.ts`
- `libs/backend/messaging-gateway/src/index.ts`
- `libs/backend/messaging-gateway/src/lib/gateway.service.spec.ts` (spec helper only)
- `libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.spec.ts` (spec helper only)

## Handoff notes for Batch 2/3

- Bridge (M11) can inject `GATEWAY_TOKENS.GATEWAY_TURN_TRACKER` and import `resolveEffectiveWorkspaceRoot` / `EffectiveWorkspace` from `@ptah-extension/messaging-gateway` — both exported.
- `GatewayService.attachSession` (M7-part-1) should switch to `setPtahSessionIdAndWorkspaceRoot` — available and tested.
- Batch 3 must add the `GATEWAY_COMMAND_SERVICE` registration in `register.ts` when C10 lands (see Decision 1) and the Electron host registrations for `GATEWAY_SESSION_LISTER` / `GATEWAY_SESSION_ACTIVITY_PROBE` (M12).
