Reviewer family: codex. Implementer family: claude.

# Code Style Review — TASK_2026_858_f7b9, Phase B (Batches 3–7)

## Summary

| Metric | Result |
| --- | --- |
| Score | 7/10 |
| Verdict | REVISE |
| Findings | 0 blocking, 2 major, 1 minor |
| Scope | 38 files in `git diff 8ca164796..7ea368e4b -- . ':!.ptah'` |

## Findings

1. **Major — the machines method tuple can drift from its registry.** `libs/shared/src/lib/types/rpc/rpc-machines.types.ts:50-70` constrains each listed name to `keyof MachinesRpcMethodRegistry`, but does not require *every* registry key to appear. The params table at `:296-315` and its spec at `rpc-machines.types.spec.ts:21-35` only check the tuple against itself. A new registry method can therefore be omitted from the manifest's `host.remoteMachines` methods at `libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts:557-565`. The sibling provider account contract has a two-way type check (`libs/shared/src/lib/types/rpc/rpc-provider-accounts.types.ts:330-346`) exercised by its spec (`rpc-provider-accounts.spec.ts:160-163`). **Suggested fix:** add the same two-way `Exclude` proof and a compile-time assertion in the machines spec; keep the existing manifest totality test as a separate wiring check.

2. **Major — the shared/worker contract duplication has no cross-boundary compatibility proof.** `libs/shared/src/lib/types/rpc/rpc-machines.types.ts:30-40,150-183,365-376` restates ID, prompt and pairing limits and worker result shapes from `libs/worker-protocol/src/lib/methods.ts:32,61-109,166-182` and `libs/worker-protocol/src/lib/pairing-code.ts:34`. The values match today, and the restatement is justified by the required dependency direction. The shared spec (`rpc-machines.types.spec.ts:21-173`) checks its own values but never checks the worker contract. A later wire limit or field change can leave the IPC contract accepting a request the worker rejects, or misdescribe a worker result, while both project suites still pass. **Suggested fix:** add a small compatibility spec in `worker-protocol` or another allowed downstream project, importing both public barrels, that compares the duplicated limits and checks the restated result shapes by type. Keep `libs/shared` free of a worker-protocol import.

3. **Minor — a source comment names a future implementation file and batch.** `libs/worker-protocol/src/lib/client/worker-client.ts:29-31` assigns reconnection to “C8 `machine-connection.ts`”, a file that is not part of this batch and may be renamed. The durable contract is simply that reconnection and reattachment are host responsibilities. **Suggested fix:** keep that boundary statement and remove the speculative phase/file reference when this area is next edited. The temporary Batch 22 note in `apps/ptah-electron/src/di/rpc-surface.spec.ts:9-14,43-54` is explicitly required by Batch 7 and accurately describes a test exception, so it is not a finding.

## Five style questions

1. **What breaks in six months?** A wire limit or result field changed in `worker-protocol` can leave `rpc-machines.types.ts:30-40,150-183` stale without a failing cross-contract check.
2. **What would a new team member misread?** `MACHINES_RPC_METHOD_NAMES` at `rpc-machines.types.ts:50-70` looks exhaustive, but `satisfies readonly (keyof MachinesRpcMethodRegistry)[]` proves only membership.
3. **What does this cost to maintain?** Adding one machines method requires updating the registry, tuple, params table, RPC entries and manifest. Existing checks cover most links; the missing registry-to-tuple proof adds a manual audit step.
4. **Where is it inconsistent with sibling code?** The provider account registry has an explicit bidirectional type proof and assertion (`rpc-provider-accounts.types.ts:330-346`, `rpc-provider-accounts.spec.ts:160-163`); machines does not.
5. **What would I do differently?** Retain the deliberate shared/worker separation, then prove its duplicated edges in a downstream contract spec. Add the registry-to-tuple assertion using the provider account pattern. Both changes preserve the current architecture and make drift visible during scoped verification.

## Pattern compliance

| Convention | Assessment | Evidence |
| --- | --- | --- |
| Isomorphic worker protocol and public cross-library entry points | Pass | `libs/worker-protocol/src/lib/frames.ts:18-28`, `src/lib/client/worker-client.ts:34-57`; imports are Zod, local modules and type-only `@ptah-extension/shared`; `src/index.ts:1-7` exposes the public surface. |
| Shared does not depend on worker protocol | Pass | `libs/shared/src/lib/types/rpc/rpc-machines.types.ts:1-29`; no worker-protocol import. |
| Domain RPC types live outside oversized registry file | Pass | `libs/shared/src/lib/types/rpc.types.ts:65-69,987-996`; domain types are in `rpc/rpc-machines.types.ts`. |
| Host-owned methods use manifest and capability | Pass | `libs/backend/rpc-handlers/src/lib/host-profile/capabilities.ts:96-104`, `manifest.ts:557-565`; CLI and VS Code absence lists and surface specs were updated in the diff. |
| Nx project tags and discovery | Pass | `libs/worker-protocol/project.json:1-7` has `scope:shared` and `type:util`; `nx.json:290,380` includes the project in lint/test file lists. |
| No new `any`, suppression or deep cross-library import | Pass | New production modules and changed imports in the specified diff. The `any` at `manifest.ts:101` predates this diff. |
| Commit scopes | Pass | Five reviewed subjects use scopes present in `.commitlintrc.json`. |

## Decisions

- **Restate renderer contracts in `libs/shared`.** Options: import worker-protocol into shared, or restate the IPC shapes. The task plan C2 explicitly prohibits that import, and the implementation uses a type-only dependency in the opposite direction. Restatement is the defensible choice; add compatibility proof downstream. Reversible: yes.
- **Keep `host.remoteMachines` host-owned and temporarily excluded in Electron.** Options: register an incomplete handler now, or exclude the capability until C9. Batch 7 requires the latter, and `rpc-surface.spec.ts:43-54` derives its exclusion from the manifest. Reversible: yes, when the Electron handler lands.
- **No source edits or verification rerun.** This is an independent review of committed code. Batch 7 reports 79/79 scoped verification tasks succeeded in `batches.md`; I did not independently rerun them. The findings concern maintenance checks that the reported run does not establish.
