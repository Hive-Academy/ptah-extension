# Backend implementation — `TASK_2026_701_9e4b`, batch 19

The previous subagent stopped before it wrote a report. This audit checked its uncommitted work
against Tasks 19.1 and 19.2 (batches.md:987-1021, implementation-plan.md:761-926, A21, A28). The
implementation and specs were complete. The audit changed only comment wrapping in the three
container smoke specs, then ran the batch verification.

**Tasks completed**: 19.1, 19.2

## Task 19.1: LocalItemApprovals, CloneRebaseService, InstallLocalItemsService — done

**Files** (all under `D:\projects\ptah-extension\.claude-worktrees\wizard-library-alignment\`):

- CREATED `libs\backend\rpc-handlers\src\lib\handlers\marketplace\local-item-approvals.ts` (+ spec). An `@injectable` in-memory registry:
  - holds at most 256 entries and evicts the oldest first;
  - each entry expires after the consent token's lifetime (`ttlMs`) or after 30 minutes for kept reports;
  - each entry is bound to one family and one harness root;
  - `take` is single-use;
  - only a `randomUUID` approvalId leaves the server, and `peek` returns a copy.
- CREATED `libs\backend\rpc-handlers\src\lib\handlers\marketplace\install-local-items.service.ts` (+ spec). `apply({family, harnessRoot, approvalIds})` routes each item:
  - file items go to `HarnessBlockedRepairService.repair` with `expectedDigest`, in one call;
  - clone items go to `CloneRebaseService.rebase` with `expectedDigest` and the harness-root scope;
  - `agent-source` items go to `writeAgent` with `replace-allowed` and baseline `{present, approval digest}`. A target that is gone before the write is kept.
  - Mismatched, deleted or unreadable items are kept as `changed-since-approval`. A route error keeps the item and records its error.
  - Unknown, expired, already-used or other-family ids are reported in `unknown`, and nothing is done for them.
- CREATED `libs\backend\rpc-handlers\src\lib\handlers\skill-synthesis\clone-rebase.service.ts` (+ spec):
  - It was extracted from `skillSynthesis:rebaseClone`.
  - It resolves the upstream by `sourceRef` through the live plugin descriptors, never by basename. It falls back to `<pluginsPath>/<originPluginId>`, the SYNTH skill root, or `{harnessRoot}/.claude/agents`.
  - It re-digests the clone (`readCloneEditState`) immediately before `mirror.rebaseClone`. The outcome union is `unavailable | not-found | source-unavailable | changed-since-approval | completed`.
  - A-rebase-lock: the mirror's per-slug lock is private, so the re-digest runs directly before the rebase call. The rebase snapshots the replaced body into the clone's history. This is documented in the file header.
- MODIFIED `libs\backend\rpc-handlers\src\lib\handlers\skills-synthesis-rpc.handlers.ts` (+ spec):
  - `rebaseClone` now delegates to `CloneRebaseService` and maps its outcomes to the same `RpcUserError` codes as before.
  - `resolveUpstreamSourceDir` and `isUnsafePathSegment` moved into the service.
- MODIFIED `libs\backend\rpc-handlers\src\lib\register-shared-rpc-handlers.ts`. It adds `registerSingleton` for `LocalItemApprovals`, `CloneRebaseService`, `InstallLocalItemsService` and `CloneProvenanceResolver`.
- MODIFIED the container smoke specs, applying A-smoke per host's handler phase:
  - `apps\ptah-electron\src\di\container.smoke.spec.ts` asserts that `PluginRpcHandlers` and `SkillsSynthesisRpcHandlers` resolve.
  - `apps\ptah-extension-vscode\src\di\container.smoke.spec.ts` asserts `PluginRpcHandlers` only. `SkillsSynthesisRpcHandlers` is in `expected-absent.ts`.
  - `apps\ptah-cli\src\di\container.smoke.spec.ts` asserts `PluginRpcHandlers` only. `cli-engine/container.ts:886` registers it, and the CLI does not register `SkillsSynthesisRpcHandlers`.
  - This audit rewrapped the over-long first comment line in each of the three files.

**Tests** (the four required cases):
- A then B before confirm; deleted and recreated; unreadable after the plan; edited during the install.
- These are covered in `clone-rebase.service.spec.ts` and in `install-local-items.service.spec.ts` (the agent-source suite uses the real guarded writer; the file-route case is covered through the mocked repair outcome).
- `local-item-approvals.spec.ts` covers the bound, the expiry, family and root binding, single use and the copy semantics.

**Guards**: `expected-resolvable.ts` is unchanged. It stays a handler list (plan finding 10). No RPC method was added, so the `rpc-surface` specs are unchanged. The new methods belong to Batch 20.

## Task 19.2: CloneProvenanceResolver and harness-root agent scope (B13) — done

**Files**:

- CREATED `libs\backend\rpc-handlers\src\lib\handlers\skill-synthesis\clone-provenance.resolver.ts` (+ spec). Resolution order:
  - by `sourceRef` against the live descriptors;
  - `skills-sh:*` uses the root `.ptah-skillssh.json` source, else `sourceLabel`;
  - a legacy sidecar matches by basename only when exactly one descriptor matches;
  - an orphan keeps `sourceLabel`;
  - `pluginId:null` gives `setup-wizard` for agents the wizard wrote, else `workspace`;
  - the diverged reason follows A11.
- MODIFIED `skills-synthesis-rpc.handlers.ts`:
  - `agentScope()` uses `resolveHarnessWorkspaceRoot`.
  - The list result returns `scopeRoot`.
  - `toCloneSummary` and `getClone` carry provenance. A resolver failure or an unreadable sidecar omits provenance and the listing still succeeds.
  - A-rows: agent rows are filtered to clones in the scoped Library.
  - Invocation stats keep the raw workspace root.
- `register-shared-rpc-handlers.ts` registers `CloneProvenanceResolver`.

**Tests** (resolver spec plus the `B13` describe block in `skills-synthesis-rpc.handlers.spec.ts`), covering every case in plan :916-921:
- legacy wizard file gives workspace; wizard-written gives setup-wizard; a hand edit keeps setup-wizard; pack-kept gives workspace;
- plugin labels and skills.sh labels;
- uninstall when the display name differs from the id keeps the display name;
- two plugins with one basename;
- wizard reason vs plugin reason;
- a sub-folder lists the harness-root agents, and `scopeRoot` equals the broadcast root;
- resolver failure omits provenance.

## Stack observed

- tsyringe `@injectable` with an explicit `@inject(TOKEN)` on every parameter, and optional injects for capabilities only some hosts have (source: `skills-synthesis-rpc.handlers.ts`).
- Shared registrations go in `register-shared-rpc-handlers.ts`, and handler classes are registered in each host's handler phase (`apps/ptah-electron/src/di/phase-4-handlers.ts`, `apps/ptah-extension-vscode/src/di/phase-3-handlers.ts`, `libs/backend/cli-engine/src/lib/container.ts`).
- Zod validation stays at the RPC boundary. The services take server-held data only.
- Logging goes through the injected `Logger`. Each catch carries a degradation-audit justification.

## Verification

Command:
`npm run verify -- -p @ptah-extension/rpc-handlers,@ptah-extension/cli-engine,ptah-electron,ptah-extension-vscode,ptah-cli`

Ran in the background. Exit 0; Nx summary line: `NX   61 tasks: 61 succeeded, 31 cached`. The 61 tasks are lint, test and typecheck for the five requested projects plus their dependency typechecks. No failures, and none of the accepted pre-existing failures appeared.

## Plan deviations

None.

## Decisions

- `InstallLocalItemsService.apply` returns a report but does not compute `libraryPass` or `collisions`. Those belong to the installer routes that call it (Batch 20). Reversible: yes.

## Open items / out-of-scope observations

- Batch 20 still has to do the following:
  - wire `InstallLocalItemsService` into `plugins:*` and skills.sh confirm, and add `plugins:replace-kept-items` and `plugins:resolve-config-home`;
  - add `buildConsentResponse` local items (A-plan `attachLocalItems` / `takePlan`);
  - register approvals with the consent-token TTL.
- Nothing calls `LocalItemApprovals.register` with a consent-token TTL yet. Only specs exercise it until Batch 20.
