# Batch 7d.2 config review fixes

Source changes and regression specs are written. Verification is unfinished; no passing typecheck or test result is claimed.

## B2: inactive sessions save settings

- `libs/backend/rpc-handlers/src/lib/handlers/config-runtime-controls.ts:18`: fallback applies through the public SDK and treats only SdkError with the SessionControl missing-session/query-not-initialized messages as save-only. Ordinary live failures still reject before saving. No native failure falls through to legacy.
- `libs/backend/agent-sdk/src/lib/codex-app-server/legacy-session-controls.ts:86,109,136`: a scoped config mutation without a live query saves through the controls' persistence port, returning nextTurn/revision 0. Calls without options retain their previous strict missing-session error contract (including slash callers).
- Specs: restored missing-session permission save expectation in `config-rpc.handlers.spec.ts:735`; model/effort missing-session save-once cases at :1212; idle query and ordinary-error rejection in `config-runtime-controls.spec.ts:230`; bound live/non-live save-once coverage in `legacy-session-controls.spec.ts:260`.

## S2: one persistence owner

- `libs/shared/src/lib/types/session-runtime.types.ts:62`: optional SessionRuntimeControlOptions on model/effort/permission mutations, carrying applyTo and optional autopilot state. The latter preserves enabled=false with a selected permission level different from the effective live ask level.
- `libs/backend/agent-sdk/src/lib/codex-app-server/session-runtime-router.ts:29`: forwards options to the identity-selected controls without introducing a second save or fallback.
- `libs/backend/agent-sdk/src/lib/codex-app-server/legacy-session-controls.ts:35,100,123,151`: persistence ports receive those options within the existing serialized apply/save/rollback transaction.
- `libs/backend/rpc-handlers/src/lib/handlers/config-rpc.handlers.ts:206,351,743`: bound controls receive the mutation and scope; the RPC no longer writes again. With no bound control target (including no session ID), the RPC retains persistence.
- Specs: `config-runtime-controls.spec.ts:213` exercises bound and unbound ownership with exactly one model/effort write and one write per permission key; its final case preserves disabled autopilot selection. `legacy-session-controls.spec.ts:260` verifies one scoped save per setting with and without a live session. `session-runtime-router.spec.ts:215` verifies scope forwarding for both runtime identities. Existing rollback and ordering expectations remain.

## Permission rollback

- `config-rpc.handlers.ts:354-379`: snapshot previous live permission before applying. On partial persistence failure, attempt both settings restores, log restore failures, then rethrow the original save error. The shared fallback transaction restores the known live permission even if a settings restore fails.
- `config-rpc.handlers.ts:705`: live restore failures are logged without replacing the original persistence failure; default permission mirroring still occurs only after success.
- Specs: `config-rpc.handlers.spec.ts:1244` covers failed settings restoration, original error identity by message, both restore attempts and live rollback. `config-runtime-controls.spec.ts:173` retains partial-write restoration coverage on the unbound path.
- Limitation: when the optional lifecycle binding supplies no prior live record, rollback cannot safely guess a permission/model value from persisted defaults. This is reported through logger.warn. Bound legacy controls have authoritative snapshots and retain their own rollback.

## M1: fallback model/effort save failure

- `config-rpc.handlers.ts:209` snapshots currentModel and restores it through the SDK after save failure; `:705` preserves the original error and reports unknown snapshots.
- `config-rpc.handlers.ts:746`: effort intentionally does not use session.config.effort as a live snapshot. `agent-sdk/src/lib/helpers/session-lifecycle/session-control.service.ts:577-609` applies flags without updating that launch config. Restoring it could overwrite a newer live setting. The fallback reports this known limitation and rejects the RPC; bound LegacySessionControls tracks effort and rolls it back.
- Specs: `config-rpc.handlers.spec.ts:1225` checks model restoration; :1234 checks rejection and explicit warning rather than stale effort restoration. Existing legacy control specs exercise effort rollback.

## 8a persistence contract

When SESSION_RUNTIME_ROUTER is bound and a session is targeted, controls own the only settings transaction and rollback; the RPC never adds a second write. RPC model/effort pass the parsed applyTo (default app), permission passes global plus the original autopilot enabled/permissionLevel pair while applying the effective live level. The router forwards options unchanged; LegacySettingsPersistence must honor applyTo and autopilot, restore partial permission writes itself, and reject failed saves so LegacySessionControls can restore live state. Scoped config changes for absent/idle legacy sessions are save-only. 8a must bind LEGACY_SESSION_CONTROL_PORTS to real persistence and NATIVE_SESSION_CONTROLS to a persistence-owning adapter with corresponding rollback and inactive-session semantics, not raw native setters. Current `agent-sdk/src/lib/di/register.ts:998-1029` defaults native controls to null and constructs the router only when all ports exist; there is no current production native settings-persistence implementation to reuse. The router itself does not persist. The new interface documentation makes the native ownership requirement explicit; implementing the native host adapter remains 8a's assigned scope. Calls with no target session continue to save config directly.

## Verification

Launched each authorized command once, through the machine-wide FIFO verifier, with output limited to the last 50 lines:

- `npm run verify -- -t test -p @ptah-extension/rpc-handlers -- --testPathPatterns=config-` ? unfinished; exec session 37375. One completion check returned still running and no tail output.
- `npm run verify -- -t test -p @ptah-extension/agent-sdk -- --testPathPatterns="legacy-session-controls|session-runtime-router"` ? unfinished; exec session 44350. One completion check returned still running and no tail output. The verifier lock serializes the heavy runs.
- Scoped ptah_get_diagnostics after edits: unavailable, compiler still running after 45 seconds; nine assigned TS files were reported unchecked. Further changed-file requests also did not supply a completed result by report time. Host compilation is not established.
- Scoped read-only `git diff --check` passed (line-ending warnings only) before the final additive autopilot option change. No state-changing git commands, installs, paid live tests, workspace-wide checks or user-settings edits.
- Final refinements were made while verification was queued/running; no completed result for the final tree is asserted. The coordinator must collect or complete verification before merge.

## Decisions

1. **Inactive detection:** use actual SdkError plus the exact SessionControl absence-message families on the fallback, and the live query lookup inside bound legacy controls. Options considered: isSessionActive, broadly swallowing errors, or explicit absence signals. Evidence: SessionControl throws these SdkErrors before invoking the query; current fixtures and ports do not require a separate activity API. This avoids treating a real failed apply as successful. Reversible: yes.
2. **Persistence ownership:** bound controls own saves; unbound/no-target RPC owns saves. Options: RPC-owned saves with no-op ports, or controls-owned saves with propagated options. Evidence: existing LegacySessionControls.commit already serializes and rolls back authoritative snapshots; the task explicitly selects this contract. Reversible: additive optional contract, no migration.
3. **Native ownership:** require a persistent native adapter in 8a rather than silently adding RPC saves or duplicate router persistence. Evidence: native token is currently nullable, router has only dispatch responsibilities, and no production native control implementation is bound. No edits outside this batch's ownership. Reversible: 8a can implement behind the existing port.
4. **Unknown fallback snapshots:** restore model/permission only from the actual lifecycle record; report unknown values and reject. Do not use persisted defaults or launch effort as substitutes. Evidence: SessionControl updates currentModel/permissionLevel but does not track live effort, while LegacySessionControls has its own effort state. Reversible: bind authoritative controls (8a), or later add an explicitly maintained live effort snapshot.
5. **Disabled autopilot:** carry its original configured pair in optional control options instead of reconstructing it from effective ask. Evidence: the existing RPC stores both enabled and permissionLevel even when disabled; a level alone loses that information. Reversible: additive options, existing non-config callers remain valid.
6. **Restore errors:** log restore failures and retain the original fallback save failure; attempt restoration of both permission keys and known live state. Evidence: FM6 explicitly identifies error replacement and missing live rollback. Existing config API supplies resolved values rather than exact key-presence/scope snapshots, so restoring explicit prior values retains that pre-existing M2 limitation. Reversible: a future settings transaction/snapshot port can preserve exact key absence and scope.

## Absolute paths changed

- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/handlers/config-rpc.handlers.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/handlers/config-rpc.handlers.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/handlers/config-runtime-controls.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/handlers/config-runtime-controls.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/shared/src/lib/types/session-runtime.types.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/legacy-session-controls.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/legacy-session-controls.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/session-runtime-router.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/session-runtime-router.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/.ptah/specs/TASK_2026_714_c8a2/batch-7d-b-report.md
