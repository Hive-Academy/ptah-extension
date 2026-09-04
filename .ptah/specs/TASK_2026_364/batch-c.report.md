# Batch C report — the agent surface (`platform-core`, `shared`, `vscode-lm-tools`, `cli-agent-runtime`)

Executor: backend-developer (Batch C, TASK_2026_364). Date: 2026-08-31.
Status: **COMPLETE**. All verification targets green. Not committed (per instructions).

## Files changed and why

### 1. The new port (`platform-core`)

- `libs/backend/platform-core/src/interfaces/caller-workspace-resolver.interface.ts` (NEW)
  — `ICallerWorkspaceResolver`, one method: `resolveCallerWorkspaceRoot(): string | undefined`.
  The TSDoc states the resolution order (declared URL root, then caller-session
  workspace), the `undefined` cases (anonymous call, no MCP request in flight),
  and the one documented throw: a DECLARED workspace that is not open on this
  host is refused by name.
- `libs/backend/platform-core/src/di/tokens.ts`
  — `CALLER_WORKSPACE_RESOLVER: Symbol.for('PlatformCallerWorkspaceResolver')`,
  following the existing `Symbol.for('Platform*')` convention, with a comment
  naming the implementation and the hosts that register it.
- `libs/backend/platform-core/src/index.ts`
  — `export type { ICallerWorkspaceResolver }` beside the other port types.

The port exists so `cli-agent-runtime` never imports `vscode-lm-tools`. The
dependency runs `vscode-lm-tools` → `cli-agent-runtime`; the port keeps that
direction intact.

### 2. The implementation (`vscode-lm-tools`)

- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-caller-workspace-resolver.ts` (NEW)
  — `McpCallerWorkspaceResolver`, `@injectable()`. Reads Batch A's channel:
  `getCallerWorkspaceRoot()` first, then `getCallerSessionId()` +
  the SDK session lifecycle manager (injected optionally under the duplicated
  `Symbol.for('SdkSessionLifecycleManager')`, same pattern and warning comment
  as `ptah-api-builder.service.ts`). A declared root is validated against the
  open workspace folders with `isPathWithinRoots` (platform-core). Containment,
  not equality, is deliberate: Batch B's adapters declare the WORKING DIRECTORY
  they spawn into, which for a worktree lies inside an open folder rather than
  being one.
- `libs/backend/vscode-lm-tools/src/index.ts`
  — exports `McpCallerWorkspaceResolver` so the composition roots can register it.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-caller-workspace-resolver.spec.ts` (NEW)
  — 10 cases. See "Failure behaviour pinned" below.

### 3. `normalizeWorkspaceRoot` moved to `libs/shared`

- `libs/shared/src/lib/utils/workspace-root-key.ts` (NEW)
  — `NO_WORKSPACE_KEY` + `normalizeWorkspaceRoot`, function body byte-identical
  to the Electron original. The doc comment keeps the two contract notes that
  matter: this is the "are these two strings the same open folder" key (folds
  case and separators), and it is NOT `platform-core` / `task-specs`'
  same-named function (those resolve a path and keep case).
- `libs/shared/src/lib/utils/index.ts` — exports both. I deliberately did NOT
  touch `libs/shared/src/index.ts`: it carries TASK_2026_365's uncommitted
  export line, and the utils barrel is already re-exported from it.
- `libs/shared/src/lib/utils/workspace-root-key.spec.ts` (NEW) — pins the
  folding contract and the `NO_WORKSPACE_KEY` non-collision property.
- `apps/ptah-electron/src/activation/workspace-root-key.ts` — DELETED.
- `apps/ptah-electron/src/activation/plugin-activation.ts` — import line only:
  `'./workspace-root-key'` → `'@ptah-extension/shared'`. NOTE: this file also
  carries TASK_2026_365's uncommitted changes; my edit is the one import line
  and nothing else.
- `apps/ptah-electron/src/activation/boot-heavy-services.ts` — import updated
  the same way, and the dead re-export
  (`export { normalizeWorkspaceRoot } from './workspace-root-key';`) deleted —
  grep shows no importer of it (both consumers of this module import only
  `createHeavyServicesBooter`).

### 4. `AgentProcessManagerService` (`cli-agent-runtime`)

`libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts`:

- Constructor: new LAST parameter,
  `@inject(PLATFORM_TOKENS.CALLER_WORKSPACE_RESOLVER, { isOptional: true })
callerWorkspaceResolver: ICallerWorkspaceResolver | null = null`. Positioned
  last with a default so every existing construction (DI and the 1,900-line
  spec's positional `new AgentProcessManager(...)` calls) stays valid.
- New `resolveScopedWorkspaceRoot()`:
  `port?.resolveCallerWorkspaceRoot() ?? workspace.getWorkspaceRoot() ?? undefined`.
  A throw from the port PROPAGATES on purpose — degrading a refusal to the
  provider root would answer for an unrelated workspace, the defect this task
  closes.
- `getWorkspaceRoot()` now reads `resolveScopedWorkspaceRoot() ?? homedir()`, so
  `validateWorkingDirectory` (unchanged code) now compares the spawn directory
  against the caller-resolved root.
- `getStatus()` (list) filters by `workingDirectory` under the resolved root,
  compared with `normalizeWorkspaceRoot` keys (equality or `key + '/'` prefix,
  so a sibling folder sharing a name prefix cannot leak in). An `undefined`
  scope (no caller context AND no open folder) returns everything — the
  pre-scoping behaviour. A record with an empty working directory stays
  visible: hiding what cannot be attributed recreates the invisible-live-agent
  hazard.
- `getStatus(agentId)` distinguishes the two answers — see the wording below.
- New file: `agent-process-manager.workspace-scope.spec.ts` (10 cases).

The facade rule was not needed: the change is one injected collaborator, two
small private helpers and one rewritten public method. No split.

### 5. The one-line seam Batch A left

`libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts`:

- `getCallerWorkspaceRoot` added to the `./mcp-core/mcp-request-context` import
  and to the deps object in `resolveSessionWorkspaceRoot()` (line ~835). The
  method's precedence doc now lists four tiers.
- `ptah-api-builder.service.spec.ts` — new test: with a caller-declared root
  bound via `runWithMcpRequestContext`, all 17 root-capable namespace sites
  resolve the DECLARED root, outranking both the session root and the platform
  root. `build()` and the capability evaluation both run inside the context so
  value-shaped and closure-shaped capabilities are both asserted.

### 6. Composition roots

- `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts` — registers
  `PLATFORM_TOKENS.CALLER_WORKSPACE_RESOLVER` → `McpCallerWorkspaceResolver`
  (singleton), directly after `registerVsCodeLmToolsServices`.
- `apps/ptah-electron/src/di/phase-3-storage.ts` — same registration, same
  position.
- CLI root (`cli-engine/container.ts`) — deliberately NO change. It calls
  `registerVsCodeLmToolsServices` too, which is exactly why the registration
  lives in the two app roots and NOT inside that shared register function:
  putting it there would have registered an implementation on the CLI host,
  which the plan requires to stay unregistered.

## How the optional port degrades with no implementation

`AgentProcessManager` injects the token with `{ isOptional: true }` and a
`= null` default. With no registration (the CLI host, every existing unit
test), `resolveScopedWorkspaceRoot()` short-circuits on
`this.callerWorkspaceResolver?.` and evaluates
`this.workspace.getWorkspaceRoot() ?? undefined` — and `getWorkspaceRoot()`
then appends the same `?? homedir()` it always had. That is character-for-
character the old resolution. With an implementation registered but NO MCP
request in flight (webview RPC, watchers), the resolver returns `undefined` and
the same fallback applies. Both paths are pinned by tests.

## Failure behaviour (plan section 4) as it now holds

| Case                                                       | Behaviour                                      | Pinned by                                                                     |
| ---------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------- |
| Anonymous caller, one folder open                          | Unchanged — falls to the provider root         | resolver spec ("anonymous call"), manager spec ("falls to the provider root") |
| Scoped caller whose workspace is not open                  | Refused, naming the workspace it asked for     | resolver spec (two refusal cases), manager spec (refusal propagates)          |
| Scoped caller, workspace open (incl. a worktree inside it) | Resolves the declared root                     | resolver spec, manager spec (the 2026-08-31 regression case), builder spec    |
| CLI host                                                   | No registration → provider fallback, unchanged | manager spec ("no resolver registered"), ptah-cli suite green                 |
| UI-initiated spawn, no caller context                      | Unchanged — provider root                      | resolver spec ("outside any MCP request context")                             |
| Anonymous, several folders open                            | NOT implemented — Batch D, per instructions    | —                                                                             |

## Exact wording of the cross-workspace status answers

`getStatus(agentId)` for an agent that exists but is outside the caller's scope:

> Agent {agentId} exists but belongs to another workspace: its working directory is {workingDirectory}, and this call is scoped to {scopeRoot}. The agent is still tracked (status: {status}) — it did not disappear. Ask again from its own workspace to read or manage it.

`getStatus(agentId)` for an id that is not tracked at all (unchanged):

> Agent not found: {agentId}

The refusal for a declared-but-not-open workspace (thrown by the resolver, and
therefore by spawn validation and status calls alike):

> The caller declared workspace '{declared}', but that folder is not open in this window (open folders: {list} | no folder is open). The scoped MCP URL may be stale — re-read the 'ptah' entry in .mcp.json.

The list path returns only the caller's agents; a caller that holds an agent id
always gets the truthful by-id answer above, so an empty list can no longer be
read as "the agent died".

## Verification (verbatim output)

Command 1:
`npx nx run-many -t typecheck,lint,test -p @ptah-extension/platform-core @ptah-extension/shared @ptah-extension/vscode-lm-tools @ptah-extension/cli-agent-runtime`

Tail of the run:

```
> nx run @ptah-extension/vscode-lm-tools:lint
✖ 21 problems (0 errors, 21 warnings)

> nx run @ptah-extension/vscode-lm-tools:typecheck
> tsc --noEmit --project libs/backend/vscode-lm-tools/tsconfig.lib.json

> nx run @ptah-extension/vscode-lm-tools:test
Test Suites: 46 passed, 46 total
Tests:       969 passed, 969 total
Snapshots:   0 total
Time:        22.254 s, estimated 54 s
Ran all test suites.

 NX   Successfully ran targets typecheck, lint, test for 4 projects

Nx read the output from the cache instead of running the command for 5 out of 12 tasks.
```

The 21 lint warnings are the same pre-existing set Batch A reported
(`no-explicit-any` in `mcp-response-formatter.ts`, `max-lines` on three
builders, `chrome-launcher-browser-capabilities.ts`); zero errors, none in
files this batch touched. Per-project results observed during the runs:
`@ptah-extension/cli-agent-runtime` 41 suites / 518 tests passed (includes the
new scope suite); `@ptah-extension/platform-core` 30 suites / 544 tests passed
(one force-exited worker on the first attempt — Nx itself flagged the task
flaky; the immediate re-run passed with zero code change);
`@ptah-extension/shared` passed from a fresh run including the new
`workspace-root-key.spec.ts`.

Command 2 (all three composition-root suites — not optional):
`npx nx run-many -t test -p ptah-extension-vscode ptah-electron ptah-cli`

Summary lines of the run:

```
 NX   Running target test for 3 projects:

Test Suites: 1 skipped, 32 passed, 32 of 33 total        (ptah-electron)
Tests:       4 skipped, 405 passed, 409 total
Test Suites: 4 passed, 4 total                           (ptah-extension-vscode)
Tests:       36 passed, 36 total
Test Suites: 1 skipped, 65 passed, 65 of 66 total        (ptah-cli)
Tests:       3 skipped, 970 passed, 973 total

 NX   Successfully ran target test for 3 projects
```

The header confirms 3 of 3 projects ran. The skipped suites/tests are
pre-existing skips, not new. The `[ptah] withEngine: ... (non-fatal)` lines in
the ptah-cli output are pre-existing test noise inside passing suites.

Additionally (beyond the required commands, because this batch edits app-level
files): `npx nx run-many -t typecheck,lint -p ptah-extension-vscode
ptah-electron` —

```
✖ 2 problems (0 errors, 2 warnings)
 NX   Successfully ran targets typecheck, lint for 2 projects
```

## Constraints honored

- No import of `vscode-lm-tools` (or any `platform-{vscode,electron,cli}`
  adapter) from `cli-agent-runtime`. No `@ts-ignore`. `catch (error: unknown)`
  patterns untouched. Nothing registered against
  `PLATFORM_TOKENS.WORKSPACE_PROVIDER`.
- No git state-changing command was run. Nothing committed.
- TASK_2026_365's uncommitted work in `libs/shared/src/index.ts`,
  `libs/shared/src/lib/types/user-layer-agents.*` and the harness-sync /
  skill-synthesis / agent-generation files was not touched, moved or reverted.
  The only file both tasks now touch is
  `apps/ptah-electron/src/activation/plugin-activation.ts`, where this batch
  changed exactly one import line (unavoidable: the module it imported from is
  the file this batch moves).

## Not done, with reason

- The multi-folder ambiguity refusal — Batch D by explicit instruction.
- The `getStatus()` LIST return cannot itself say "N agents exist elsewhere":
  its wire type is `AgentProcessInfo[]` and the RPC/MCP formatting layers are
  outside this batch's ownership set. The disambiguation contract is carried by
  the by-id path (a live agent elsewhere is named, never "not found"), which is
  the line the batch marked most important. If the orchestrator wants the list
  response annotated too, that is a small follow-up in
  `agent-tool.dispatcher` / the agents RPC handler.
- Nothing else was cut.
