## Changed files

- `apps/ptah-electron/src/ipc/ipc-bridge.ts:204` — removed the obsolete `skillSynthesis:event` boot-scan explanation from the window-availability comment; retained the current harness notification behavior.

## Removed vs kept methods

| Surface | Removed | Kept | Evidence |
| --- | --- | --- | --- |
| Electron IPC bridge | Obsolete skill-synthesis push mention in a comment | Generic RPC dispatch and window delivery | `ipc-bridge.ts:204-225,314-393`; no method-specific dispatch entries |
| Electron host profile | None | `skillSynthesis: true` capability | Actual file `apps/ptah-electron/src/rpc-host-profile.ts:28`; capability still gates Library RPCs |
| CLI/TUI host profile | None | `skillSynthesis: true` capability | `libs/backend/cli-engine/src/lib/rpc/cli-host-profile.ts:28`; capability still gates Library RPCs |
| CLI RPC surface spec | None | `skillSynthesis:` namespace assertion | Actual spec `libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts:79`; retained methods use this prefix |

## Post-cut grep

- `rg -n 'skill-synthesis|skillSynthesis|SkillSynthesis|SkillTriggerService|listCandidates|getCandidate|promoteCandidate|rejectCandidate|runCurator|runSynthesis'` over the IPC bridge and actual host-profile/spec files: only the two kept `skillSynthesis: true` capability flags and the kept `skillSynthesis:` namespace assertion remain. Zero live obsolete batch-owned hits.
- Plan G14 (`apps/ptah-cli/src/cli`, Electron and VS Code activation) is outside this batch's ownership; the batch-owned IPC/profile grep above is the applicable post-cut check.
- `ptah_get_diagnostics` was called for the changed IPC file. It returned **unavailable** because the TypeScript compiler check was still running after 45 seconds; it did not provide a pass or fail. No Nx, Jest, lint, typecheck, build, or e2e command was run, as directed.

## Guards checked

- `libs/shared/src/lib/types/rpc/host-source-registry.baseline.ts:308-350,565` still contains obsolete RPC and event entries. This central baseline is owned by later batches; no edit was made here.
- `apps/ptah-electron/src/ipc/ipc-bridge.window-availability.spec.ts:5,58` still references the event; batch 35 owns that spec.
- `libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts:79` asserts the namespace, not individual obsolete methods. It must remain for retained Library RPCs.
- No exported symbol was removed, so the shared-contract exported-symbol search was not triggered. No guard was changed or broken by this comment edit.

## Decisions

- **Keep both capability flags and the namespace assertion.** Options were to remove them or retain them. The flags gate surviving Library RPCs (`listClones`, `getClone`, `saveCloneBody`, `invocationStats`, scorecards, settings), and the test checks the surviving namespace. This is reversible after the RPC registry changes, but removal now would disable supported methods.
- **Use the actual file locations.** The batch lists `apps/ptah-electron/src/ipc/rpc-host-profile.ts` and a colocated `cli-host-profile.spec.ts`; neither exists. The profile is `apps/ptah-electron/src/rpc-host-profile.ts`, and the corresponding CLI surface spec is `libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts`. Neither needed an edit.

## Proposed Removals

- Batch 35 should remove the obsolete event fixture in `apps/ptah-electron/src/ipc/ipc-bridge.window-availability.spec.ts:5,58`.
- Batches 40/41 should remove obsolete central registry and expected-surface entries after their handlers are cut. Do not remove the retained Library RPC names or their `skillSynthesis:` prefix.
