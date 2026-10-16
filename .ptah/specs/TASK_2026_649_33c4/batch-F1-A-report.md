# F1-A backend review fixes

## S1

- `harness-proposal-turn-attribution.service.ts:107` exposes `onTurnAborted`, which clears the active and ambiguous state through the existing turn-end logic. `chat-session.service.ts:1297` calls it after `interruptSession` succeeds. A prompt during an uninterrupted active turn still becomes ambiguous.
- `harness-proposal-store.service.ts:48` orders revisions by `turnStartedAt` when present and otherwise by `updatedAt`; ties use `updatedAt`, then stable array order. `HarnessProposalRevision.updatedAt` is a required write-time field.
- Specs: `harness-proposal-turn-attribution.service.spec.ts:95` covers the abort and mid-turn cases; `chat-session-abort-resume-state.spec.ts:224` verifies the abort hook; `harness-proposal-store.service.spec.ts:141` covers an unattributed newer revision overriding an older attributed revision.

## S4

- `rpc-harness.types.ts:236` and `rpc-harness-proposal.types.ts:27` add optional `workspaceRoot` to initialize and get-proposal params. `harness-rpc.schema.ts:203,212` validates it with the existing pin schema and normalizes it.
- `harness-proposal-store.service.ts:151` reads from `requireRoot(workspaceRoot)`, retaining the record/root equality check. `harness-rpc.handlers.ts:927` passes the parsed pinned root to the store. `harness-rpc.handlers.ts:368` validates an initialize pin against open folders and passes it to context resolution, including when another folder is active. An omitted root keeps active-root behavior.
- `harness-workspace-context.service.ts:111` accepts an optional root and reads that root's manifest and directory entries; `harness-proposal-store.interface.ts:23` exposes the optional root accepted by the store implementation. The only implementing class is `HarnessProposalStore`; no adapter or mock implementation needed an update.
- Specs: `harness-proposal-store.service.spec.ts:165` reads the pinned root with a different active provider; `harness-rpc.handlers.spec.ts:608,620,629,1160` covers unchanged no-pin initialize, invalid initialize pin, initialization for an open inactive folder, and pinned get-proposal after a provider switch. `harness-workspace-context.service.spec.ts:238` checks that explicit root discovery ignores the active root.
- Presets are global: `HarnessConfigStore.loadPresetsFromDisk()` reads `~/.ptah/harnesses/` (`harness-config-store.service.ts:255`), so there is no active-root dependency to extend.

## Verification

- No Nx, Jest, TypeScript build, or git commands were run, per lane instruction. In the previous lane, `ptah_ast_analyze` parsed the changed handler, schema, and chat service without syntax errors; both scoped diagnostics attempts timed out. This continuation's edits were inspected but not typechecked or tested; the orchestrator must run the changed-project checks.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Clear attribution after successful SDK interrupt. | Call the existing turn-end state reset; add an SDK event. | `abortSession` directly awaits `interruptSession`; Stop hooks do not fire for user interrupt (S1 review). | Yes |
| Keep mid-turn overlap ambiguous. | Preserve current rule; replace the active turn on every prompt. | User's explicit F1-A requirement and queued/steered turns. | Yes |
| Sort unknown turn revisions by their required write timestamp. | Use `updatedAt`; put unknown turns before all known turns. | `HarnessProposalRevision.updatedAt` is required and assigned at save. | Yes |
| Resolve pinned initialize against any open folder. | Pass the validated root to context resolution; keep the active-root restriction. | The caller approved extending the context resolver; presets are global and the proposal store already accepts a pinned root. | Yes |
