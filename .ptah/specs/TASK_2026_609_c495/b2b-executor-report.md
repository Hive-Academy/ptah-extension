# Batch B-2b executor report: C2 quarantine RPC contract and handler

Executor: backend-developer-b2b. No git write commands were run. batches.md and task.md were not edited.

## Files modified (7, exactly the batch list)

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\backend\agent-generation\src\index.ts`: type-only re-export of `QuarantinedAgentItem`, `QuarantinedAgentState`, `QuarantinedAgentsListing`, `QuarantineRestoreOutcome` and `QuarantineRestoreResult`, added to the existing `export type {…} from './lib/services/user-layer/user-layer-mirror.service'` block. The mirror service already re-exports them at `:47-53`.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\shared\src\lib\types\rpc\rpc-skill-clone.types.ts`: adds `QuarantineAgentSyncState` (`'enabled'|'disabled'|'unknown'`), `QuarantinedAgentEntryState`, `QuarantinedAgentEntry` (`quarantinedAt: string|null`), `SkillSynthesisListQuarantinedAgents{Params,Result}` (`workspaceRoot: string|null`, `recordUnreadable?: true`, `quarantined`, `notOwned`), `QuarantinedAgentRestoreOutcome`, and `SkillSynthesisRestoreQuarantinedAgent{Params,Result}`. All are self-contained, and no domain type is imported into libs/shared.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\shared\src\lib\types\rpc.types.ts`: type imports, two `RpcMethodRegistry` entries, and two `RPC_METHOD_ENTRIES` entries. The manifest is not edited; it derives from `METHODS`.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\backend\rpc-handlers\src\lib\handlers\skills-synthesis-rpc.handlers.ts`: two `METHODS` entries, registrations, and `registerListQuarantinedAgents` / `registerRestoreQuarantinedAgent`. Also adds the helpers `quarantineWorkspaceRoot()` and `readAgentSync()`, and the module function `toQuarantinedAgentEntry` that maps domain types to the RPC shape. A new last constructor parameter injects `HARNESS_SYNC_TOKENS.AGENT_SYNC_GATE` with `{ isOptional: true }`, typed as the read-only `AgentConsentReader`.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\backend\rpc-handlers\src\lib\handlers\skills-synthesis-rpc.schema.ts`: adds `SkillListQuarantinedAgentsParamsSchema` (strict, optional) and `SkillRestoreQuarantinedAgentParamsSchema` (strict `{ slug: SlugSchema }`).
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\backend\rpc-handlers\src\lib\handlers\skills-synthesis-rpc.handlers.spec.ts`: new describe block, `quarantine list / restore (C2)`, with 15 tests.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\backend\rpc-handlers\src\lib\handlers\skills-synthesis-rpc.schema.spec.ts`: two new describe blocks with 15 tests, including the traversal table.

No file was created. I did not touch the Codex lane's harness-sync files.

## Task B-2b.1: contracts and registrations (COMPLETE)

- The shapes match implementation-plan.md:62-63 exactly. `recordUnreadable` is present only when true; the handler spreads it in only when the domain flag is true.
- The `METHODS` / `RpcMethodRegistry` / `RPC_METHOD_ENTRIES` totality is enforced at compile time (`satisfies readonly RpcMethodName[]` and `Record<RpcMethodName, true>`). The rpc-handlers suite covers it at runtime, including the dual-registration smoke check over `ALLOWED_METHOD_PREFIXES`. Both checks pass.

## Task B-2b.2: handlers, zod and specs (COMPLETE)

Behaviour:
- `listQuarantinedAgents`: params are parsed first. Then `requireDesktop(this.mirror)` runs: if the mirror is absent it raises `RpcUserError PERSISTENCE_UNAVAILABLE`, never an empty list. Next it calls `resolveHarnessWorkspaceRoot(agentScope())`. If no folder is open it returns `{ workspaceRoot: null, agentSync: 'unknown', quarantined: [], notOwned: [] }`. Otherwise it calls `mirror.listQuarantinedAgents(root)`, maps the result and adds `agentSync`.
- `restoreQuarantinedAgent`: zod with `SlugSchema` runs first, so a traversal slug is rejected with `INVALID_PARAMS` before the mirror is called. A missing mirror gives the same explicit error. With no open folder it raises `RpcUserError INVALID_PARAMS`. Otherwise it calls `mirror.restoreQuarantinedAgent(root, slug)` and returns `outcome`, `path`, `reason?` and `agentSync`, where `agentSync` is read after the restore.
- In both methods, a thrown non-user error goes through `report()` (Sentry) and is raised as the generic `PERSISTENCE_UNAVAILABLE` user error. The internal message, such as the facade's "absolute workspace root" text, does not reach the caller, and a throw is never mapped to a success.
- The root is always `resolveHarnessWorkspaceRoot(raw)`, which is absolute by construction (`path.resolve`). It is the same root used by the mirror pass (`resolveAgentMirrorSource`) and by the gate.

Spec evidence (targeted run `npx jest -c libs/backend/rpc-handlers/jest.config.ts libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc --maxWorkers=2 -t "quarantine|Quarantined"`):
```
Test Suites: 3 skipped, 2 passed, 2 of 5 total
Tests:       523 skipped, 30 passed, 553 total
```
The new cases are:
- Gate disabled, using the REAL `AgentSyncGate(new ManagedManifestStore())` over a real `.ptah/harness/state.json` with `agentSyncEnabled:false`. Restore returns `{ outcome:'restored', agentSync:'disabled' }`; `enable` is never called (spy); the state.json bytes are identical before and after restore and after list; `gate.resolve(ws)` is still `{enabled:false, derived:false}`; and the following list reports the item as `source-restored`.
- Gate enabled reports `'enabled'`.
- Gate unregistered gives `'unknown'` on both list and restore.
- When gate `resolve` throws, the result is `'unknown'`, the restore result still stands, and a warning is logged.
- With a sub-folder workspace, the mirror receives the harness-resolved absolute root (`ws`), not the raw sub-folder.
- `recordUnreadable` maps to `true` and is omitted when false.
- A refusal outcome (`conflict` plus its reason) is passed through as a result.
- Traversal slugs `../evil`, `..`, `a/b`, `a\b` and `''` are rejected with `INVALID_PARAMS`, and the mirror is not called.
- When the mirror is absent, both methods raise `PERSISTENCE_UNAVAILABLE`.
- A thrown facade error becomes `RpcUserError PERSISTENCE_UNAVAILABLE` without leaking the message, and is reported to Sentry.
- With no open folder, list returns an empty result with `workspaceRoot: null`, and restore raises `INVALID_PARAMS` without calling the mirror.
- Schema specs: list params accept `undefined` and `{}` and reject unknown keys. Restore params accept a plain slug and reject `../evil`, `a..b`, `.`, `..`, `a/b`, `a\b`, `/etc/passwd`, `C:\x`, an empty slug, a slug over 128 characters, a missing slug, and extra keys.

The handler spec uses a stateful double for the mirror's two facade methods. The real filesystem restore against a real `UserLayerMirrorService` is already pinned in agent-generation's `user-layer-seed-quarantine.spec.ts` (B-2a). Using the real service here would mean mocking `os.homedir` across this 3.9k-line shared spec file.

## Verification (tailed)

1. `npx nx run-many -t typecheck,lint -p @ptah-extension/shared,@ptah-extension/rpc-handlers,@ptah-extension/agent-generation`: all 6 tasks passed ("Output of 6 successful tasks were not shown").
   - The first run failed rpc-handlers lint on one error in my own schema spec. A shell heredoc had un-escaped `'a\\b'` / `'C:\\x'` into `'C:\x'` ("Hexadecimal digit expected"). I fixed it and the re-run passed.
   - On the four touched rpc-handlers files, eslint shows 0 errors and 3 pre-existing warnings in `skills-synthesis-rpc.handlers.ts`: unused `SkillStatus`, `max-lines` (the file was already over 2000 lines), and `no-useless-assignment` for `historyCount`.
2. `npx nx run-many -t test -p @ptah-extension/shared,@ptah-extension/rpc-handlers --maxWorkers=2`:
   ```
   shared:        Test Suites: 83 passed, 83 total   Tests: 2277 passed, 2277 total
   rpc-handlers:  Test Suites: 136 passed, 136 total Tests: 7 skipped, 3962 passed, 3969 total
   NX   Successfully ran target test for 2 projects
   ```
   The 7 skipped tests are pre-existing; the new tests are not skipped (30 passed in the targeted run above).

`npx prettier --write` was run on the 7 files. Only the handler and the handler spec were reformatted.

## PA-1, PA-3, PR4, PR5

- **PA-1**: the gate is injected as `@inject(HARNESS_SYNC_TOKENS.AGENT_SYNC_GATE, { isOptional: true }) agentSyncGate: AgentConsentReader | null`. It is the last constructor parameter, so every existing container-construction site resolves unchanged; tsyringe gives `undefined` for an unregistered token, and the whole rpc-handlers suite passes. If the gate is absent or `resolve` throws, the result is `'unknown'`. Both cases are asserted in the spec.
- **PA-3**: no manifest edit. `METHODS` and `RPC_METHOD_ENTRIES` totality is enforced at compile time and exercised by the rpc-handlers test run (which passes), including the dual-registration smoke test.
- **PR4**: the strict zod schema `SkillRestoreQuarantinedAgentParamsSchema` reuses `SlugSchema` (regex plus `..`, `/` and `\` refusal) and runs before any mirror call. Both the schema spec and the handler spec cover it. The B-2a facade re-checks the slug before any path join.
- **PR5**: the handler only ever calls `resolve`. The injected type is `AgentConsentReader`, which has only `resolve`, so `enable` cannot even be called from this class. The spec uses the real `AgentSyncGate` and asserts that `enable` is never called and that the state.json bytes are unchanged.

## Plan deviations

- The plan text names the `isRegistered(...)` container pattern from `wizard-generation-rpc.handlers.ts`. This class has no container reference, so I used the optional injection that batches.md PA-1 prescribes.
- I added the no-open-folder behaviour, which the plan did not specify: list returns an empty result with `workspaceRoot: null`, and restore raises `INVALID_PARAMS`. The contract already allows `workspaceRoot: string|null`.

## Out-of-scope observations

- Pre-existing lint warnings in `skills-synthesis-rpc.handlers.ts`: unused `SkillStatus` import, `max-lines`, and `no-useless-assignment` on `historyCount`. Not touched.
