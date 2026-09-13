# Batches - TASK_2026_433

Total tasks: 29 (in this delivery; +1 blocked in B7) | Batches: 9 in delivery + 1 blocked + 1 deferred | Complete: 1/9

Worktree: `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes` (branch `feat/task-433-role-lanes`).
Every path below is relative to that root unless it is written in full. Executors work ONLY in this worktree.

## Decisions (user, 2026-09-13)

1. **v1 is preamble-only for every lane.** Native selection (ptah-cli SDK `agent` option, opencode `--agent`) and the marker probe are plan Component 8 = Batch B8, marked `DEFERRED` and NOT part of this delivery. The acceptance line "same call for a native-capable CLI reports `native`" moves to B8. In v1 every spawn and every list row reports `roleDelivery: 'preamble'`.
2. **One strict Zod schema shared by both MCP surfaces.** `AgentSpawnArgsSchema` is parsed by the HTTP `ptah_agent_spawn` case and the stdio `agent_spawn` handler. Unknown keys are rejected on HTTP and stdio alike. This is a deliberate behaviour change on HTTP (today it casts and silently drops unknown keys). A second consequence, recorded here so nobody treats it as a regression: HTTP `cli` becomes enum-validated (`SYSTEM_CLI_TYPES`) at the schema, instead of failing later at spawn time.
3. **B7 (agent-lanes skill documents `role`) is blocked on TASK_2026_431 merging (PR #501).** The `agent-lanes` skill does not exist on this branch (`apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/` has no `agent-lanes`); it lives on `origin/refactor/task-431-agent-lanes`.

## Team-leader defaults (my judgment, recorded)

- **Sibling WIP (`wiring/agent-events.ts`, agent-sdk `session-metadata-store.ts`) is SPLIT OUT, not scheduled last.** The main checkout carries another agent's uncommitted edits there (+221/-356 lines on the metadata store). v1 touches neither file: `agent-events.ts:166-168` broadcasts the whole `AgentProcessInfo` object, so the new optional role fields reach the webview with no edit. The only work that needs those files is the UI follow-up "resume from UI re-applies the recorded role" (persist `role` on `CliSessionReference`). It is out of this delivery and must be filed as its own task after the sibling WIP lands. No batch below may edit either file; a reviewer rejects a diff that does.
- Batch ids keep the plan's numbers (B1..B8) so the user's references ("B7", "B8") stay true. Plan batches that were not independently verifiable are split with letter suffixes (B2a/B2b, B4a/B4b, B5a/B5b), and adapter-channel declaration moves from B2 to B3 (see Plan defect D1).
- Parallel batches share one worktree. Each executor runs its OWN spec files while the sibling is mid-edit (`npx nx run-many -t test -p @ptah-extension/cli-agent-runtime --testPathPattern=<pattern>`), and the full-lib gate runs once both have returned. No batch edits a `project.json`, so no `nx reset` is needed; never run one while a sibling executor is active.
- Status words `BLOCKED` and `DEFERRED` on B7/B8 headers are outside the normal vocabulary on purpose. Mode 3 completion for this delivery = B1..B6 COMPLETE; B7 stays BLOCKED until #501 merges, B8 stays DEFERRED.

## Plan validation

Status: PASSED WITH RISKS

Contracts checked against the code (all cites hold unless listed under defects): `tool-description.builder.ts:494-590` (no `role`, `required: ['task']`); `mcp-stdio/tool-builders.ts:53-55` (rename only); `agent-tool.dispatcher.ts:53-69` (strict stdio schema), `:247-306`, `:396-407`, `:496-523`; `protocol-dispatcher.ts:730-827` (HTTP cast, no Zod), `:424-445`, `:874-886`, `:1803-1823`; `agent-namespace.builder.ts:65-84`, `:154-253` (ptah-cli branch passes `projectGuidance` only), `:271-283`, `:310-319`; `ptah-api-builder.service.ts:434-435`, `:575`, `:619-627`, `:664-673`; `cli-adapter.utils.ts:247-277` (`spawnCli`), `:357-379` (`buildTaskPrompt`), `:428-461`; `cli-adapter.interface.ts:22-55`, `:160-165`; `agent-process-manager.service.ts:386-454`, `:460-533`, `:543-612`, `:723-731` (result built field by field); `cli-detection.service.ts:100-128`; `agent-rpc.handlers.ts:829-845`; `codex-cli.adapter.ts:602-632`, `:658`, `:684`; `copilot-sdk.adapter.ts:312-319`, `:459`; `antigravity-cli.adapter.ts:441` (MCP write) before `:455` (prompt) and `:492-493` (spawn); `opencode-cli.adapter.ts:406`, `:458-459`; `cursor-cli.adapter.ts:285`, `:346`, `:354`; `pi-cli.adapter.ts:499`; `ptah-cli-registry.ts:559-587`, `:653-667`, `:752-760`; `ptah-cli-spawn-options.service.ts:147-181`; harness-sync barrel `:86` and `:155-161`; `PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER` (`platform-core/src/di/tokens.ts:13`); `AGENT_REPORT_ROUTER` registration `di/register.ts:43-52`. `wiring/agent-events.ts:166-168` broadcasts `AgentProcessInfo` whole (no projection to extend).

### Plan defects found

- **D1 (sequencing, MEDIUM): required `CliAdapter.roleChannel` in B2 breaks B2's own gate.** `cli-agent-runtime/jest.config.ts` runs ts-jest with full diagnostics, so the moment the interface gains a required member every adapter spec fails to compile until all 6 adapters implement it. The plan's own note ("B4's typecheck is green only once B3 lands") understates it: B2 itself cannot go green. Fix applied in this decomposition: B2b adds only `CliCommandOptions.role`; B3 adds the required `roleChannel` member together with all 6 adapter declarations and the detection stamp, in one batch.
- **D2 (RISK, MEDIUM): the win32 budget guard models only CreateProcess (32,767).** `resolveDirectSpawn` (`cli-adapter.utils.ts:442-461`) falls back to the unchanged `.cmd` path when the wrapper cannot be parsed or the call throws; `cross-spawn` then runs it through `cmd.exe`, capped at 8,191 (the plan's own cite `:428-441`). A guard that allows 32,767 for a `.cmd`/`.bat` command lets a ~20 KB role through to an OS "command line is too long" error, which is exactly what the named error was meant to replace. Mitigation: Task 2b.2 applies 8,191 when the win32 command ends in `.cmd` or `.bat`.
- **D3 (RISK, LOW): double frontmatter strip.** `AgentRoleDefinition.body` is already stripped by the resolver, and `transformAgentBody` (`transform-rules.ts:362-363`) strips again. A role whose body itself begins with a `---\n...\n---` block loses that block on the four CliTarget lanes only. The individual rewrite functions are not exported from the harness-sync barrel. Mitigation: Task 2b.1 pins a spec case for a body starting with a `---` pair; if it is mangled, the resolver keeps the raw file content on a non-exported field of its own result and `renderRoleBlock` transforms from it, without widening harness-sync's barrel.
- **D4 (gap, LOW): no detection spec exists.** The plan asks for "a detection spec on stamped fields" but lists no file, and `cli-agents/cli-detection.service.ts` has no spec today. Task 3.7 creates `cli-detection.service.spec.ts`.
- **D5 (contract ambiguity, MEDIUM): `CliDetectionResult.roleDelivery/roleChannel` must be OPTIONAL.** The plan lists them without `?`. `CliDetectionResult` literals are built in 6 adapter `detect()` bodies, `agent-rpc.handlers.ts`, `agent-namespace.builder.ts`, and specs in cli-agent-runtime, vscode-lm-tools and `libs/frontend/tribunal-panel/.../tribunal-discovery.service.spec.ts`. Required fields would break all of them, including a frontend lib outside this task. Detection stamps them centrally (success AND error branch, and therefore the cache); the type stays optional.
- **D6 (cite drift, LOW):** mirror enumeration rule is `user-layer-mirror.service.ts:1263` (`e.isFile() && e.name.endsWith('.md')`), not `:1307-1308`. The rule itself is as the plan says.
- **D7 (pre-existing, LOW, not this task's to fix):** `cli-agent-runtime/package.json` does not list `@ptah-extension/harness-sync`, yet `antigravity-cli.adapter.ts:55-59` already imports it. B2a/B2b add more imports of it. If `@nx/dependency-checks` flags it during lint, the executor STOPS and reports rather than editing `package.json` outside the batch; the orchestrator decides.
- **D8 (gap, LOW): `formatAgentList` needs the role list from a second call.** `ptahAPI.agent.list()` returns `CliDetectionResult[]`; the "Roles in this workspace" line needs `listRoles()`. Both dispatchers must call it, and a `listRoles` failure must degrade to the "no roles" line with a logged warning, never fail `ptah_agent_list`. Handled in Task 5b.4.

Assumptions:

- A1 codex accepts `--config developer_instructions=<JSON>` and adds to built-ins — unverified; checked in B6 live e2e (codex run when installed).
- A2 home `~/.codex/config.toml` `developer_instructions` is overridden per run — unverified; checked in B6, documented in `cli-agent-runtime/CLAUDE.md` either way.
- A3 libuv Windows quoting is the right length model — unverified; Task 2b.2 pins limit-1/limit/limit+1 with quote and trailing-backslash costs; B6 senior-tester runs one real `node -e` spawn at limit-1 and limit+1 on Windows.
- A4 `resolveHarnessWorkspaceRoot(getWorkspaceRoot())` is the root Claude subagents use, including worktree lanes — Task 5a.1 spec with `workingDirectory` in a nested worktree.
- A5 (new) `resolveHarnessWorkspaceRoot` does synchronous `node:fs` marker lookups (`workspace-root.ts:86-93`), so the resolver is not 100% behind `IFileSystemProvider`. Accepted: harness-sync already owns that behaviour and the plan chose it as the anchor. The resolver spec uses a real temp dir (or the `homeDir` option) for the sub-package case and the fake provider for everything else.
- A6 (new) `ptah-cli` `assembly.systemPromptContent` is the `fullSystemPromptContent` built at `ptah-cli-spawn-options.service.ts:171-179`, so appending there reaches both `standalone` and `preset-append` — verified by Task 4a.2 spec on both modes.

| Risk | Severity | Mitigation |
| --- | --- | --- |
| D1 required member breaks intermediate gates | MEDIUM | `roleChannel` moved into B3 with all adapters (Task 3.1) |
| D2 `.cmd` fallback hits cmd.exe 8,191 cap | MEDIUM | Task 2b.2 cmd-shim branch |
| HTTP strict schema rejects keys callers send today (behaviour change) | MEDIUM | Decision 2; Task 5b.1/5b.3 specs pin rejection; B6 documents it in `vscode-lm-tools/CLAUDE.md` |
| antigravity writes HOME MCP entry before a rejected spawn | MEDIUM | Task 3.4: build args + guard before `configureMcpServer`; spec asserts it is never called |
| codex SDK spawn bypasses `spawnCli` guard | MEDIUM | Task 3.2 guards the serialized `--config` override before `new sdk.Codex` |
| D5 required detection fields break frontend spec | MEDIUM | Fields optional (Task 1.1) |
| `protocol-dispatcher.ts` (2,132 lines) / `agent-process-manager.service.ts` (2,334) growth | LOW | Spawn validation moves to the schema file (5b.1); manager adds fields only, no new methods |
| D3 double frontmatter strip | LOW | Task 2b.1 spec case |
| Role resolved but never delivered (silent role-less spawn) | HIGH | Task 5a.1: named error when `role` set and no resolver; every resolver failure throws `AgentRoleError` |
| Vendor names leak into the `role` tool description | LOW | `vendor-roster-drift.spec.ts` in B5b gate |
| Sibling WIP in `agent-events.ts` / session metadata store | MEDIUM | Split out of this delivery (see defaults) |

Edge cases:

- Missing `.claude/agents` dir → `listRoles` returns `[]`, `resolve` throws `no_roles` — Task 2a.1
- Traversal name `../x`, case mismatch, frontmatter-only file, CRLF body, 64 KiB+1 body, unreadable file after listing — Task 2a.1
- Sub-package `workspaceRoot` / nested worktree `workingDirectory` — Tasks 2a.1, 5a.1
- Prompt section order with/without system context and role; delimiter text pinned — Task 2b.1
- Budget at limit-1/limit/limit+1 per platform branch, `"` and trailing `\` quoting cost, `.cmd` shim — Task 2b.2
- Role-less spawns stay byte-identical except the new guard — Tasks 2b.1, 3.2-3.6
- Continuation turns do not re-send the role; resume spawns carrying `role` deliver it again — Tasks 3.2-3.6
- Role never changes `sandboxMode`, permissions, `model`, `reasoningEffort` — Tasks 3.2-3.6, 4a.1
- ptah-cli role with a 64 KiB body stays off argv/env — Task 4a.3
- `role` set with no resolver wired → named error, no spawn — Task 5a.1
- Every `AgentRoleError` code surfaced on BOTH surfaces before any slot is taken — Task 5b.3/5b.5
- `listRoles` failure during `ptah_agent_list` degrades, never fails the list — Task 5b.4

## Batch overview

| Id | Scope | Executor | Depends on | Parallel group |
| --- | --- | --- | --- | --- |
| B1 | Role contract types (shared) | backend-developer | none | G0 (alone) |
| B2a | `AgentRoleResolver` + DI token + barrel | backend-developer | B1 | G1: B2a ∥ B2b |
| B2b | `renderRoleBlock`, `buildTaskPrompt` role section, command-line guard, `CliCommandOptions.role` | backend-developer | B1 | G1: B2a ∥ B2b |
| B3 | `CliAdapter.roleChannel` + 6 adapters + detection stamp | backend-developer (sequential) | B2b | G2: B3 ∥ B4a |
| B4a | ptah-cli system-prompt delivery | backend-developer | B2b | G2: B3 ∥ B4a |
| B4b | Manager plumbing + rpc-handlers list-row stamp | backend-developer | B1, B3 | G3: may start while B4a is still running |
| B5a | Namespace role resolution + API builder wiring + `AgentNamespace` type | backend-developer | B2a, B4a, B4b | G4 (alone) |
| B5b | Shared strict schema, both dispatchers, tool description, formatters, parity guard | backend-developer (sequential) | B5a | G5 (alone) |
| B6 | Lib docs + live e2e + A1-A3 evidence | technical-content-writer ∥ senior-tester | B5b | G6: docs lane ∥ e2e lane |
| B7 | agent-lanes skill `role` routing + content manifest | technical-content-writer | B6, PR #501 merged | BLOCKED |
| B8 | Native role probe (plan Component 8) | backend-developer | B6 | DEFERRED |

Full-delivery gate (after B5b, and again at Mode 3):

```
npx nx run-many -t test -p @ptah-extension/shared @ptah-extension/cli-agent-runtime @ptah-extension/vscode-lm-tools @ptah-extension/rpc-handlers @ptah-extension/tribunal-panel
npx nx run-many -t lint,typecheck -p @ptah-extension/shared @ptah-extension/cli-agent-runtime @ptah-extension/vscode-lm-tools @ptah-extension/rpc-handlers @ptah-extension/tribunal-panel
```

Read the `Running target test for 5 projects` header; N must be 5.

## Batch B1: Role contract types — COMPLETE (commit 0714d36c4)

- Recommended executor: backend-developer
- Fallback executor: a single CLI lane with the task text below
- Execution mode: sequential
- Rationale: one file, additive types that every later batch imports; nothing to parallelise.
- Tasks: 1 | Depends on: none

### Task 1.1: Add role types to the shared agent-process contract — COMPLETE

- File: `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\shared\src\lib\types\agent-process.types.ts`
- Plan reference: implementation-plan.md:84-100
- Pattern to follow: `AgentMessagingCapability` / `messagingMode` in the same file (`:176-229`); "Injected by MCP server, NOT set by callers" docs at `:128-139`
- Contract:
  - `export interface AgentRoleDefinition { readonly name: string; readonly description?: string; readonly body: string; readonly sourcePath: string; readonly bytes: number }`
  - `export type AgentRoleDelivery = 'preamble' | 'native'`
  - `export type AgentRoleChannel = 'task-prompt' | 'developer-instructions' | 'system-prompt' | 'agent-selection'` (`agent-selection` reserved for B8, unused in v1)
  - `SpawnAgentRequest`: `readonly role?: string` (caller-set) and `readonly roleDefinition?: AgentRoleDefinition` ("Injected by MCP server, NOT set by callers")
  - `SpawnAgentResult` and `AgentProcessInfo`: `readonly role?: string; readonly roleDelivery?: AgentRoleDelivery; readonly roleChannel?: AgentRoleChannel`
  - `CliDetectionResult`: `readonly roleDelivery?: AgentRoleDelivery; readonly roleChannel?: AgentRoleChannel` — OPTIONAL (defect D5)
- Quality requirements: no `node:` imports (shared reaches the webview); no comments beyond the field docs that match neighbouring fields.
- Validation notes: the barrel already re-exports this file (`libs/shared/src/index.ts:23`); do NOT edit the barrel.
- Acceptance:
  - `npx nx run-many -t typecheck -p @ptah-extension/shared @ptah-extension/cli-agent-runtime @ptah-extension/vscode-lm-tools @ptah-extension/rpc-handlers @ptah-extension/tribunal-panel` (N=5, green)
  - `npx nx run-many -t test -p @ptah-extension/shared` (N=1, green)

### Batch B1 verification

- Only `agent-process.types.ts` changed (`git show --stat`)
- Typecheck of the 5 projects green; no consumer edited
- Reviewer: code-style-reviewer (pure contract/type precision)
- Gate record (2026-09-13): orchestrator delegated reviewer depth to team-leader judgment for this additive, single-file batch. Gate run = team-leader inline contract review, no separate reviewer spawn. Checked: every field in the Task 1.1 contract present with exact names, literal unions and optionality (D5 optional on `CliDetectionResult`); no `node:` import; barrel untouched; field docs follow the `AgentMessagingMode` / "Injected by MCP server, NOT set by callers" pattern; `git show --stat` = 1 file, +56. Evidence re-run by team-leader: typecheck 5/5 projects green; `@ptah-extension/shared` test 57 suites / 1381 tests green; lint shared 0 errors (2 pre-existing warnings, none in the changed file). Type-precision is re-reviewed by code-style-reviewer at B5b, where these types meet the MCP surfaces.

## Batch B2a: AgentRoleResolver — IN_PROGRESS

- Recommended executor: backend-developer
- Fallback executor: CLI lane (self-contained: new folder + 3 wiring lines)
- Execution mode: sequential (within batch); parallel with B2b
- Rationale: new service with a security-sensitive name check and error taxonomy; owns the lib's DI and barrel files, which B2b does not touch.
- Tasks: 2 | Depends on: B1

### Task 2a.1: Implement resolver and spec — IN_PROGRESS

- Files:
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\cli-agent-runtime\src\lib\roles\agent-role-resolver.service.ts`
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\cli-agent-runtime\src\lib\roles\agent-role-resolver.service.spec.ts`
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\cli-agent-runtime\src\lib\roles\index.ts`
- Plan reference: implementation-plan.md:102-122
- Pattern to follow: `AgentMessageError` (`cli-agents/agent-message-router.service.ts:47-55`); `@inject(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER)` as in `agent-generation/.../analysis-storage.service.ts:59`
- Contract:
  - `listRoles(workspaceRoot: string): Promise<string[]>` — entries of `{resolveHarnessWorkspaceRoot(workspaceRoot)}/.claude/agents` where `type` is File and name ends `.md`, basename without `.md`, sorted; missing dir → `[]`
  - `resolve(workspaceRoot: string, role: string): Promise<AgentRoleDefinition>` — name regex `^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$` checked BEFORE any FS call; exact case-sensitive match against `listRoles`; path joined only from the matched listing entry; `stripFrontmatter` + `extractFrontmatterDescription`; reject empty trimmed body; reject body > `MAX_ROLE_BYTES = 64 * 1024` (UTF-8 bytes); no cache
  - `export class AgentRoleError extends Error { readonly code: 'invalid_role_name' | 'no_roles' | 'unknown_role' | 'empty_role' | 'role_too_large' | 'role_read_failed'; readonly availableRoles: string[] }`; message names the harness root and lists roles; `no_roles` says the setup wizard generates roles and that spawning without `role` is valid; `role_read_failed` carries the narrowed `instanceof Error` message
  - Export `AgentRoleResolver`, `AgentRoleError`, `AgentRoleErrorCode` type, `MAX_ROLE_BYTES` from `roles/index.ts`
- Spec cases: missing dir, empty dir, unknown role lists available, `../x` fails with zero FS calls, case mismatch, frontmatter-only file, 64 KiB exact accepted / +1 rejected, CRLF body, read failure after listing, sub-package workspaceRoot (real temp dir with `.git` marker, assumption A5), a body beginning with a `---` pair (defect D3 — record what the resolver returns so 2b.1 can pin the rendering).
- Quality: `catch (error: unknown)`; no fallback to role-less anything.

### Task 2a.2: Register token and export — IN_PROGRESS

- Files:
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\cli-agent-runtime\src\lib\di\tokens.ts` — `AGENT_ROLE_RESOLVER: Symbol.for('AgentRoleResolver')`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\cli-agent-runtime\src\lib\di\register.ts` — singleton registration next to `AGENT_REPORT_ROUTER` (`:43-52`)
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\cli-agent-runtime\src\index.ts` — `export * from './lib/roles'`
- Depends on: Task 2a.1
- Validation: `register.ptah-cli-registry.smoke.spec.ts` stays green; token key appears in the registered-services log list automatically.

### Batch B2a verification

- `npx nx run-many -t test -p @ptah-extension/cli-agent-runtime --testPathPattern="roles|di"` while B2b is active; after both return, `npx nx run-many -t test,lint,typecheck -p @ptah-extension/cli-agent-runtime` (N=1)
- Traversal case proves no FS call before validation
- Reviewer: code-logic-reviewer (path safety, error taxonomy, no silent fallback)

## Batch B2b: Role prompt assembly + command-line budget guard — IN_PROGRESS

- Recommended executor: backend-developer
- Fallback executor: CLI lane
- Execution mode: sequential (within batch); parallel with B2a
- Rationale: exact-value ordering and platform-limit math in one util file; owns `cli-adapter.utils.ts` and the `CliCommandOptions` half of the interface.
- Tasks: 3 | Depends on: B1

### Task 2b.1: `renderRoleBlock` and `buildTaskPrompt` role section — IN_PROGRESS

- Files:
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\cli-adapter.utils.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\cli-adapter.utils.spec.ts`
- Plan reference: implementation-plan.md:124-146
- Contract:
  - `export function renderRoleBlock(role: AgentRoleDefinition, cli: CliType): string` → `## Role: <name>` + one sentence ("You are running as the `<name>` role; the definition below governs this task and outranks any generic persona above.") + body; body via `transformAgentBody(body, cli)` when `cli` is a `CliTarget` (codex, copilot, cursor, antigravity), unchanged for opencode, pi, ptah-cli
  - `buildTaskPrompt` order: `systemPrompt || projectGuidance` → `\n\n---\n\n` → role block when `options.role` → `\n\n---\n\n` → tool policy, task, files, taskFolder. Role-less output must be byte-identical to today.
- Spec: order with/without system context and with/without role (4 combinations, exact strings), transform applied for a CliTarget and skipped for `pi`, D3 `---`-leading body case.

### Task 2b.2: `assertCommandLineWithinLimit` + `CliCommandLineTooLongError`, called first in `spawnCli` — IN_PROGRESS

- Files: same two as 2b.1
- Depends on: none within batch (same files, do after 2b.1)
- Contract:
  - `export function assertCommandLineWithinLimit(command: string, args: readonly string[], platform: NodeJS.Platform = process.platform): void`
  - win32: libuv-quoted length of `command + args` ≤ 32,767 UTF-16 units; when `command` ends `.cmd` or `.bat` (case-insensitive) the limit is 8,191 (defect D2)
  - linux: each arg ≤ 131,071 bytes; darwin: sum of arg bytes ≤ 1,048,576 − 4,096
  - `export class CliCommandLineTooLongError extends Error { readonly measured: number; readonly limit: number; readonly largestArgIndex: number }`; message names the largest arg and size, says nothing is truncated, lists the two remedies (shorten the task; use a lane whose channel does not use argv) without naming a vendor
  - `spawnCli` calls it first, before the `spawner` branch, so off-thread and inline spawns are both guarded
- Spec: limit-1 / limit / limit+1 for win32, win32 `.cmd`, linux, darwin (platform injected, never global); quoting cost of `"` and trailing `\`; error fields.

### Task 2b.3: `CliCommandOptions.role` — IN_PROGRESS

- File: MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\cli-adapter.interface.ts`
- Contract: `readonly role?: AgentRoleDefinition` on `CliCommandOptions` ONLY. Do NOT add `roleChannel` to `CliAdapter` here (defect D1 — that is Task 3.1).
- Also export `renderRoleBlock`, `assertCommandLineWithinLimit`, `CliCommandLineTooLongError` through `cli-adapters/index.ts` only if that barrel already re-exports utils symbols; otherwise leave the barrel for B3/B4a to import by relative path. (Barrel file is owned by this batch if edited.)

### Batch B2b verification

- `npx nx run-many -t test -p @ptah-extension/cli-agent-runtime --testPathPattern="cli-adapter.utils"` while B2a is active; after both return, `npx nx run-many -t test,lint,typecheck -p @ptah-extension/cli-agent-runtime` (N=1) — every existing adapter spec still green (role-less byte identity)
- Reviewer: code-logic-reviewer (limit math, ordering, no truncation)

## Batch B3: Adapter role channels + detection stamp — PENDING

- Recommended executor: backend-developer (single sub-agent)
- Fallback executor: after Task 3.1 is committed to the worktree by the sub-agent, CLI lanes x 6 for Tasks 3.2-3.6 + 3.8 split by adapter
- Execution mode: sequential
- Rationale: the required interface member makes every adapter red until all six land (D1), and codex (SDK argv bypass) and antigravity (reorder before a HOME side effect) each need a judgment call mid-flight.
- Tasks: 8 | Depends on: B2b

### Task 3.1: Required `CliAdapter.roleChannel` — PENDING

- File: MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\cli-adapter.interface.ts`
- Contract: `readonly roleChannel: AgentRoleChannel` on `CliAdapter`, required, doc sentence mirroring `capabilities()` (`:160-165`).

### Task 3.2: codex → `developer-instructions` — PENDING

- Files: `codex-cli.adapter.ts` + `codex-cli.adapter.spec.ts` in `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\`
- Contract: `roleChannel = 'developer-instructions'`; when `options.role`, `config['developer_instructions'] = renderRoleBlock(role, 'codex')`; run `assertCommandLineWithinLimit` on the serialized override (`--config`, `developer_instructions=<JSON.stringify(value)>`, against the resolved codex binary) BEFORE `new sdk.Codex` (`:632`); `buildTaskPrompt({ ...options, role: undefined })` at `:658`.
- Spec: config carries the block and thread input does not; oversized role rejects with `CliCommandLineTooLongError` and `sdk.Codex` is never constructed; `sandboxMode`/`approvalPolicy` unchanged; role-less config unchanged.

### Task 3.3: copilot → `task-prompt` — PENDING

- Files: `copilot-sdk.adapter.ts` + `.spec.ts`
- Contract: `roleChannel = 'task-prompt'`; role reaches `-p` via `buildTaskPrompt` (`:459`); continuation `runTurn(message)` does not re-add it.
- Spec: role block inside the `-p` value after harness context; continuation turn argv has no role block; guard error surfaces through `spawnCli`.

### Task 3.4: antigravity → `task-prompt`, guard before MCP write — PENDING

- Files: `antigravity-cli.adapter.ts` + `antigravity-cli.adapter.spec.ts` (leave `antigravity-cli.adapter.mcp.spec.ts` green, edit only if its ordering assumption breaks)
- Contract: `roleChannel = 'task-prompt'`; reorder `runSdk` so prompt + args are built and `resolveDirectSpawn` resolved, then `assertCommandLineWithinLimit(descriptor.command, [...prefixArgs, ...args])` runs, then `configureMcpServer` (`:441`), then `spawnCli`. `ensureFolderTrusted` stays first (unchanged behaviour).
- Spec: role block in `--print` value; oversized role rejects and `configureMcpServer` is never called.

### Task 3.5: opencode → `task-prompt` — PENDING

- Files: `opencode-cli.adapter.ts` + `.spec.ts`
- Contract: `roleChannel = 'task-prompt'`; role in trailing positional via `buildTaskPrompt` (`:406`); `OPENCODE_CONFIG_CONTENT` unchanged (no native agent in v1).

### Task 3.6: cursor and pi → `task-prompt` — PENDING

- Files: `cursor-cli.adapter.ts` + `.spec.ts`, `pi-cli.adapter.ts` + `.spec.ts`
- Contract: `roleChannel = 'task-prompt'` on both; cursor role in `agent.send(prompt)` first turn; pi role in stdin JSONL first prompt; neither re-sends on continuation.

### Task 3.7: Detection stamps role fields — PENDING

- Files:
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-detection.service.ts`
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-detection.service.spec.ts` (defect D4)
- Contract: `doDetectAll` stores `{ ...result, roleDelivery: 'preamble', roleChannel: adapter.roleChannel }` on the success branch and adds both to the error-branch literal (`:122-126`), so the cache carries them.
- Spec: both branches stamped; cache returns stamped rows.

### Task 3.8: No adapter-side permission drift — PENDING

- Files: the adapter specs above
- Contract: one assertion per adapter spec that a role-carrying spawn produces the same sandbox/permission/model/effort arguments as the role-less spawn.

### Batch B3 verification

- `npx nx run-many -t test,lint,typecheck -p @ptah-extension/cli-agent-runtime` (N=1) after the batch returns; while B4a runs in parallel use `--testPathPattern="cli-adapters|cli-detection"`
- `git show --stat` lists only files named above
- Reviewer: code-logic-reviewer (side-effect ordering, SDK argv guard, continuation behaviour)

## Batch B4a: ptah-cli system-prompt delivery — PENDING

- Recommended executor: backend-developer
- Fallback executor: CLI lane
- Execution mode: sequential; parallel with B3
- Rationale: owns only `ptah-cli/**`, disjoint from B3's `cli-adapters/**` and detection.
- Tasks: 3 | Depends on: B2b

### Task 4a.1: Thread `role` through `PtahCliRegistry.spawnAgent` — PENDING

- File: MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\cli-agent-runtime\src\lib\ptah-cli\ptah-cli-registry.ts`
- Contract: `options.role?: AgentRoleDefinition` (`:562-583`), forwarded to `assembleSpawnOptions` (`:653-667`) as a new trailing parameter; tier/model precedence untouched; role frontmatter `model`/`tools` never read.

### Task 4a.2: Append role block to the system prompt — PENDING

- Files:
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\cli-agent-runtime\src\lib\ptah-cli\helpers\ptah-cli-spawn-options.service.ts`
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\cli-agent-runtime\src\lib\ptah-cli\helpers\ptah-cli-spawn-options.role.spec.ts`
- Contract: `assembleSpawnOptions(..., agentId?, role?)`; `fullSystemPromptContent` gains `renderRoleBlock(role, 'ptah-cli')` after `## Project Guidance`. Existing positional callers and specs (`*.output-style.spec.ts`, `*.session-ids.spec.ts`, registry specs) stay green unchanged.
- Spec: role section after project guidance; absent without role; present with no project guidance; both `standalone` and preset-append carry it (assumption A6).

### Task 4a.3: argv/env probe with a 64 KiB role — PENDING

- File: MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\cli-agent-runtime\src\lib\ptah-cli\ptah-cli-registry-auto-compact-argv.spec.ts`
- Contract: one case spawning with a 64 KiB role asserts the role text is in `initialize.systemPrompt` or `appendSystemPrompt` and in no argv element or env value.

### Batch B4a verification

- `npx nx run-many -t test -p @ptah-extension/cli-agent-runtime --testPathPattern="ptah-cli"` during G2; full `test,lint,typecheck` for the lib after B3 and B4a both return
- Reviewer: code-logic-reviewer

## Batch B4b: Manager plumbing + list-row stamp — PENDING

- Recommended executor: backend-developer
- Fallback executor: CLI lane
- Execution mode: sequential
- Rationale: needs `adapter.roleChannel` (B3); disjoint from B4a, so it may start as soon as B3 is committed even if B4a is still running.
- Tasks: 2 | Depends on: B1, B3

### Task 4b.1: `AgentProcessManager` forwards role and stamps records — PENDING

- Files:
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\cli-agent-runtime\src\lib\cli-agents\agent-process-manager.service.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\cli-agent-runtime\src\lib\cli-agents\agent-process-manager.service.spec.ts`
- Plan reference: implementation-plan.md:174-190
- Contract:
  - `doSpawn` passes `adapter.roleChannel` into `doSpawnSdk` (new parameter)
  - `doSpawnSdk`: `runSdk({ ..., role: request.roleDefinition })`; when `request.roleDefinition` is set, `info` gets `role: roleDefinition.name, roleDelivery: 'preamble', roleChannel`; `Spawning SDK agent` log gains `role` and `roleChannel`
  - `spawnFromSdkHandle` `meta` gains `role?`, `roleDelivery?`, `roleChannel?`, copied onto `info`
  - `trackSdkHandle` result literal (`:723-731`) copies the three fields from `info`
  - No new method; role never affects slot reservation
- Spec: role forwarded to `runSdk`; record, `agent:spawned` payload and result carry the three fields; role-less spawn carries none; `spawnFromSdkHandle` meta copy.
- Validation: do NOT touch `wiring/agent-events.ts` (sibling WIP, see defaults).

### Task 4b.2: ptah-cli list rows in rpc-handlers — PENDING

- File: MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\rpc-handlers\src\lib\handlers\agent-rpc.handlers.ts`
- Contract: `mergePtahCliAgents` rows (`:833-843`) add `roleDelivery: 'preamble', roleChannel: 'system-prompt'`. List-row stamping only; no RPC method added, no `rpc.types.ts` or `ALLOWED_METHOD_PREFIXES` change.
- Spec: if no existing spec covers `mergePtahCliAgents`, add the assertion to a new `agent-rpc.handlers.list-rows.spec.ts` in the same folder.

### Batch B4b verification

- `npx nx run-many -t test,lint,typecheck -p @ptah-extension/cli-agent-runtime @ptah-extension/rpc-handlers` (N=2)
- Reviewer: code-style-reviewer (plumbing, no CLI-name branching, file growth on a 2,334-line file)

## Batch B5a: Namespace role resolution + API builder wiring — PENDING

- Recommended executor: backend-developer
- Fallback executor: none (one coherent change across 3 coupled files)
- Execution mode: sequential
- Rationale: `types.ts` is shared with every namespace; resolution order relative to the ptah-cli / rival branch is the core behaviour of the feature.
- Tasks: 2 | Depends on: B2a, B4a, B4b

### Task 5a.1: `AgentNamespace.spawn` resolves role; `listRoles` — PENDING

- Files in `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\vscode-lm-tools\src\lib\code-execution\`:
  - MODIFY `types.ts` — `AgentNamespace.listRoles: () => Promise<string[]>`
  - MODIFY `namespace-builders/agent-namespace.builder.ts` + `agent-namespace.builder.spec.ts`
- Plan reference: implementation-plan.md:216-219, 290-296
- Contract:
  - deps gain `resolveAgentRole?: (workspaceRoot: string, role: string) => Promise<AgentRoleDefinition>` and `listAgentRoles?: (workspaceRoot: string) => Promise<string[]>`
  - `spawn`: after session resolution, before `getProjectGuidance`'s branch split and before any `reserveAgentId`/slot: if `request.role`, `roleDefinition = await resolveAgentRole(getWorkspaceRoot(), request.role)`; if `request.role` and no resolver → named `Error` (same rule as `report`, `:271-283`), no spawn
  - ptah-cli branch: `registry.spawnAgent(..., { ..., role: roleDefinition })` and `spawnFromSdkHandle(handle, { ..., role: name, roleDelivery: 'preamble', roleChannel: 'system-prompt' })`
  - rival branch: `enrichedRequest` includes `roleDefinition`
  - `PtahCliRegistryLike.spawnAgent` options gain `role?: AgentRoleDefinition` (`:65-84`)
  - ptah-cli list rows (`:310-319`) add `roleDelivery: 'preamble', roleChannel: 'system-prompt'`
  - `listRoles()` → `listAgentRoles?.(getWorkspaceRoot()) ?? []`
- Spec: resolution before either branch; `AgentRoleError` → no `reserveAgentId`, no `spawnFromSdkHandle`, no `agentProcessManager.spawn`; ptah-cli branch passes role; nested-worktree `workingDirectory` still resolves from `getWorkspaceRoot()` (A4); missing resolver named error.

### Task 5a.2: Wire resolver into `PtahApiBuilder` — PENDING

- File: MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\vscode-lm-tools\src\lib\code-execution\ptah-api-builder.service.ts`
- Contract: `@inject(CLI_AGENT_RUNTIME_TOKENS.AGENT_ROLE_RESOLVER, { isOptional: true })` next to `AGENT_REPORT_ROUTER` (`:434-435`); `resolveAgentRole` throws a named error when absent; `listAgentRoles` returns `[]` when absent (listing is informational) — pattern `:664-673`.

### Batch B5a verification

- `npx nx run-many -t test,lint,typecheck -p @ptah-extension/vscode-lm-tools` (N=1)
- Reviewer: code-logic-reviewer (ordering, no role-less spawn on any failure)

## Batch B5b: MCP surfaces — shared strict schema, formatters, parity guard — PENDING

- Recommended executor: backend-developer (single sub-agent)
- Fallback executor: none; HTTP and stdio must change together for Decision 2
- Execution mode: sequential
- Rationale: the one-schema decision only holds if both dispatchers, the JSON tool schema and the parity guard land in one reviewed commit.
- Tasks: 6 | Depends on: B5a

### Task 5b.1: `AgentSpawnArgsSchema` — PENDING

- File: CREATE `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\agent-spawn-args.schema.ts`
- Contract: exactly the stdio shape at `agent-tool.dispatcher.ts:53-69` (including `MAX_TASK_LENGTH = 100 * 1024`, `cli: z.enum(SYSTEM_CLI_TYPES)`, unbounded non-negative `timeout`) plus `role: z.string().min(1).max(100).optional()`, `.strict()`. Exported with `MAX_TASK_LENGTH`.

### Task 5b.2: `role` in the JSON tool schema — PENDING

- Files: `mcp-core/tool-description.builder.ts` + `tool-description.builder.spec.ts`
- Contract: `role` property: the name of an agent role generated for this workspace; `ptah_agent_list` shows valid names; the definition is delivered to the lane and the result reports how; do not paste role templates into `task`. No vendor names. `required` stays `['task']`.

### Task 5b.3: HTTP dispatcher parses with the shared schema — PENDING

- Files: `mcp-core/protocol-dispatcher.ts` + `protocol-dispatcher.spec.ts`
- Contract: `case 'ptah_agent_spawn'` (`:730-827`) replaces the cast and the two hand-written checks with `AgentSpawnArgsSchema.safeParse`, failing via `toolErrorResponse` + `describeZodIssues`; forwards `role`; logs `role`; catches `AgentRoleError` → `Error: ptah_agent_spawn role <code>: <message>`; `CliCommandLineTooLongError` → tool error naming sizes. `ptah_agent_list` calls `ptahAPI.agent.listRoles()` (failure → warn + empty) and passes roles to `formatAgentList`. File must not grow materially.
- Spec: role forwarded; each of the 6 `AgentRoleError` codes surfaced; unknown key rejected; invalid `cli` rejected; list with roles / no roles / `listRoles` throwing.

### Task 5b.4: Formatters — PENDING

- Files: `mcp-core/mcp-response-formatter.ts` + `mcp-response-formatter.spec.ts` (touch `mcp-response-formatter-extra.spec.ts` only if an existing assertion pins the list table exactly)
- Contract: `formatAgentSpawn` adds `**Role:** <name> (<roleDelivery> via <roleChannel>)` when set; `formatAgentStatus` shows the role; `formatAgentList(agents, roles?: string[])` adds `role delivery: <roleDelivery>/<roleChannel>` to each Capabilities cell that has it and one line `Roles in this workspace: a, b` or `No agent roles generated for this workspace`.

### Task 5b.5: stdio dispatcher uses the shared schema — PENDING

- Files: `mcp-stdio/agent-tool.dispatcher.ts` + `agent-tool.dispatcher.spec.ts`
- Contract: delete local `AgentSpawnSchema` and `MAX_TASK_LENGTH`, import from `agent-spawn-args.schema.ts`; forward `role`; `structuredContent` adds `role`, `roleDelivery`, `roleChannel` on spawn and `roles` on list; `AgentRoleError` → `toolError(..., 'mcp_tool_failed', { tool: 'agent_spawn', state: code, availableRoles })` (pattern `:396-407`). Same `listRoles` degradation as HTTP.
- Spec: mirror of 5b.3 cases on stdio.

### Task 5b.6: Surface parity guard — PENDING

- File: CREATE `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\agent-spawn-surface-parity.spec.ts`
- Contract: key set of `buildAgentSpawnTool().inputSchema.properties` equals `Object.keys(AgentSpawnArgsSchema.shape)`; `buildMcpAgentSpawnTool()` deep-equals `buildAgentSpawnTool()` except `name`.

### Batch B5b verification

- `npx nx run-many -t test,lint,typecheck -p @ptah-extension/vscode-lm-tools` (N=1), including `vendor-roster-drift.spec.ts`, `stdio-mcp-server.service.spec.ts`, `index.barrel.spec.ts`
- Then the full-delivery gate (5 projects) above
- Reviewer: code-logic-reviewer AND code-style-reviewer (behaviour change on HTTP + schema consolidation)

## Batch B6: Docs + live e2e evidence — PENDING

- Recommended executor: technical-content-writer (docs lane) ∥ senior-tester (e2e lane)
- Fallback executor: senior-tester for both, sequentially
- Execution mode: parallel (2 lanes, disjoint files)
- Rationale: docs and evidence are independent; both read the finished code only.
- Tasks: 2 | Depends on: B5b

### Task 6.1: Lib CLAUDE.md updates — PENDING

- Files:
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\cli-agent-runtime\CLAUDE.md` — role channels per adapter, resolver source (`.claude/agents`, not the consent-gated user layer), budget guard incl. `.cmd` 8,191 branch, why read-only is not mapped to a sandbox, why frontmatter `model` is ignored, A2 outcome
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\vscode-lm-tools\CLAUDE.md` — one shared spawn schema; HTTP now strict (Decision 2)
- Constraint: these CLAUDE.md files are not VSIX assets, so vendor names are allowed here; the `role` tool-description text itself stays vendor-free.

### Task 6.2: Live e2e + A1/A3 evidence — PENDING

- File: CREATE `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\.ptah\specs\TASK_2026_433_d22a\test-report.md`
- Contract: one `ptah_agent_spawn({ cli: <installed argv lane, antigravity preferred>, role: 'code-logic-reviewer', taskFolder, task })` on a scratch task; record result showing `preamble via task-prompt`, the deliverable in `taskFolder` with the role's structure, `ptah_agent_read` showing the role block reached the lane; one codex run for A1/A2 if codex is installed (else record "not installed" as an open item); A3 real Windows `node -e` spawn at limit-1 / limit+1; one `ptah_agent_spawn` with an unknown key on HTTP showing the Zod rejection.
- Acceptance-line mapping: context.md acceptance 1 and 3 close here; acceptance 2 is B8.

### Batch B6 verification

- test-report.md carries the raw tool outputs, not paraphrase
- Reviewer: code-style-reviewer on the CLAUDE.md diffs only; e2e evidence reviewed by the orchestrator

## Batch B7: agent-lanes skill routing for `role` — BLOCKED

- Gate: BLOCKED on TASK_2026_431 merging (PR #501). Do not start, and do not cherry-pick 431 into this branch.
- Recommended executor: technical-content-writer
- Execution mode: sequential
- Tasks: 1 | Depends on: B6, PR #501 merged into `main` and this branch rebased/merged from `main`

### Task 7.1: Skill §2 `role` row, §3 "pass `role`, never paste a template into `task`" — BLOCKED

- Files: MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\apps\ptah-extension-vscode\assets\plugins\ptah-core\skills\agent-lanes\SKILL.md` (post-431) + regenerate `content-manifest.json` via `npm run manifest:generate`
- Constraint: no CLI → capability table in the skill (context.md constraint); capabilities come from `ptah_agent_list`.
- Acceptance: `node scripts/generate-content-manifest.js --check` green.

## Batch B8: Native role probe (plan Component 8) — DEFERRED

- Not part of this delivery (Decision 1). Scope, cache shape and candidate lanes are as written in implementation-plan.md:255-268.
- Carries the acceptance line: "`ptah_agent_spawn` for a native-capable CLI reports `roleDelivery: native`".
- Depends on: B6. Needs opencode installed and a measured answer on the SDK `agent` option vs Ptah's `{preset, append}` harness prompt before decomposition.

## Out of this delivery (file as follow-ups)

- Resume-from-UI re-applies the recorded role: persist `role` on `CliSessionReference` (`wiring/agent-events.ts` `persistCliSessionReference`, agent-sdk session metadata store) + `role` param on `agent:resumeCliSession`. Blocked by sibling WIP in the main checkout on both files.
- Agent card/tile role + delivery badge; Tribunal lane role picker replacing the `(role)` token grammar; "no roles generated" onboarding hint.
