# Batches - TASK_2026_433

Total tasks: 36 (in this delivery) | Batches: 12 in delivery + 1 deferred (B8) | Complete: 12/12

Worktree: `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes` (branch `feat/task-433-role-lanes`).
Every path below is relative to that root unless it is written in full. Executors work ONLY in this worktree.

## Decisions (user, 2026-09-13)

1. **v1 is preamble-only for every lane.** Native selection (ptah-cli SDK `agent` option, opencode `--agent`) and the marker probe are plan Component 8 = Batch B8, marked `DEFERRED` and NOT part of this delivery. The acceptance line "same call for a native-capable CLI reports `native`" moves to B8. In v1 every spawn and every list row reports `roleDelivery: 'preamble'`.
2. **One strict Zod schema shared by both MCP surfaces.** `AgentSpawnArgsSchema` is parsed by the HTTP `ptah_agent_spawn` case and the stdio `agent_spawn` handler. Unknown keys are rejected on HTTP and stdio alike. This is a deliberate behaviour change on HTTP (today it casts and silently drops unknown keys). A second consequence, recorded here so nobody treats it as a regression: HTTP `cli` becomes enum-validated (`SYSTEM_CLI_TYPES`) at the schema, instead of failing later at spawn time.
3. **B7 (agent-lanes skill documents `role`) was blocked on TASK_2026_431 merging (PR #501). UNBLOCKED 2026-09-13: #501 is merged into `origin/main` (2cc4d8fa7).** Original note: The `agent-lanes` skill does not exist on this branch (`apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/` has no `agent-lanes`); it lives on `origin/refactor/task-431-agent-lanes`.

## Team-leader defaults (my judgment, recorded)

- **Sibling WIP (`wiring/agent-events.ts`, agent-sdk `session-metadata-store.ts`) is SPLIT OUT, not scheduled last.** The main checkout carries another agent's uncommitted edits there (+221/-356 lines on the metadata store). v1 touches neither file: `agent-events.ts:166-168` broadcasts the whole `AgentProcessInfo` object, so the new optional role fields reach the webview with no edit. The only work that needs those files is the UI follow-up "resume from UI re-applies the recorded role" (persist `role` on `CliSessionReference`). It is out of this delivery and must be filed as its own task after the sibling WIP lands. No batch below may edit either file; a reviewer rejects a diff that does.
- Batch ids keep the plan's numbers (B1..B8) so the user's references ("B7", "B8") stay true. Plan batches that were not independently verifiable are split with letter suffixes (B2a/B2b, B4a/B4b, B5a/B5b), and adapter-channel declaration moves from B2 to B3 (see Plan defect D1).
- Parallel batches share one worktree. Each executor runs its OWN spec files while the sibling is mid-edit, and the full-lib gate runs once both have returned.
- **Per-batch test filter (corrected at B2 verify):** `nx run-many ... --testPathPattern=<p>` is NOT forwarded to this Jest; the filter is ignored. The working form, and the only one used below, is `npx nx run <project>:test --testPathPatterns="<regex>" --skip-nx-cache` (plural `Patterns`, single project via `nx run`). Read the `Test Suites: N` line and check N matches the spec files you meant. Prefix `NX_DAEMON=false` when a sibling lane is running in the same worktree. No batch edits a `project.json`, so no `nx reset` is needed; never run one while a sibling executor is active.
- Status words `BLOCKED` and `DEFERRED` on B7/B8 headers are outside the normal vocabulary on purpose. Mode 3 completion for this delivery = B1..B7 COMPLETE (B7 unblocked 2026-09-13); B8 stays DEFERRED.

## Plan validation

Status: PASSED WITH RISKS

Contracts checked against the code (all cites hold unless listed under defects): `tool-description.builder.ts:494-590` (no `role`, `required: ['task']`); `mcp-stdio/tool-builders.ts:53-55` (rename only); `agent-tool.dispatcher.ts:53-69` (strict stdio schema), `:247-306`, `:396-407`, `:496-523`; `protocol-dispatcher.ts:730-827` (HTTP cast, no Zod), `:424-445`, `:874-886`, `:1803-1823`; `agent-namespace.builder.ts:65-84`, `:154-253` (ptah-cli branch passes `projectGuidance` only), `:271-283`, `:310-319`; `ptah-api-builder.service.ts:434-435`, `:575`, `:619-627`, `:664-673`; `cli-adapter.utils.ts:247-277` (`spawnCli`), `:357-379` (`buildTaskPrompt`), `:428-461`; `cli-adapter.interface.ts:22-55`, `:160-165`; `agent-process-manager.service.ts:386-454`, `:460-533`, `:543-612`, `:723-731` (result built field by field); `cli-detection.service.ts:100-128`; `agent-rpc.handlers.ts:829-845`; `codex-cli.adapter.ts:602-632`, `:658`, `:684`; `copilot-sdk.adapter.ts:312-319`, `:459`; `antigravity-cli.adapter.ts:441` (MCP write) before `:455` (prompt) and `:492-493` (spawn); `opencode-cli.adapter.ts:406`, `:458-459`; `cursor-cli.adapter.ts:285`, `:346`, `:354`; `pi-cli.adapter.ts:499`; `ptah-cli-registry.ts:559-587`, `:653-667`, `:752-760`; `ptah-cli-spawn-options.service.ts:147-181`; harness-sync barrel `:86` and `:155-161`; `PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER` (`platform-core/src/di/tokens.ts:13`); `AGENT_REPORT_ROUTER` registration `di/register.ts:43-52`. `wiring/agent-events.ts:166-168` broadcasts `AgentProcessInfo` whole (no projection to extend).

### Plan defects found

- **D1 (sequencing, MEDIUM): required `CliAdapter.roleChannel` in B2 breaks B2's own gate.** `cli-agent-runtime/jest.config.ts` runs ts-jest with full diagnostics, so the moment the interface gains a required member every adapter spec fails to compile until all 6 adapters implement it. The plan's own note ("B4's typecheck is green only once B3 lands") understates it: B2 itself cannot go green. Fix applied in this decomposition: B2b adds only `CliCommandOptions.role`; B3 adds the required `roleChannel` member together with all 6 adapter declarations and the detection stamp, in one batch.
- **D2 (RISK, MEDIUM): the win32 budget guard models only CreateProcess (32,767).** `resolveDirectSpawn` (`cli-adapter.utils.ts:442-461`) falls back to the unchanged `.cmd` path when the wrapper cannot be parsed or the call throws; `cross-spawn` then runs it through `cmd.exe`, capped at 8,191 (the plan's own cite `:428-441`). A guard that allows 32,767 for a `.cmd`/`.bat` command lets a ~20 KB role through to an OS "command line is too long" error, which is exactly what the named error was meant to replace. Mitigation: Task 2b.2 applies 8,191 when the win32 command ends in `.cmd` or `.bat`.
- **D3 (RISK, LOW): double frontmatter strip.** `AgentRoleDefinition.body` is already stripped by the resolver, and `transformAgentBody` (`transform-rules.ts:362-363`) strips again. A role whose body itself begins with a `---\n...\n---` block loses that block on the four CliTarget lanes only. The individual rewrite functions are not exported from the harness-sync barrel. **Outcome at B2 verify: CONFIRMED MANGLED** on codex/copilot/cursor/antigravity (kept on pi/opencode/ptah-cli); B2b's spec pins the mangled output. Conductor ruling: a mangled role body is a correctness bug and must not ship. **Resolution: Task 3.0 (first task of B3)** fixes it inside `renderRoleBlock` without touching harness-sync or the shared `AgentRoleDefinition` type, and flips the pinned case to "preserved on every lane".
- **D9 (found at B2 verify, MEDIUM): empty `workspaceRoot` reads roles relative to `process.cwd()`.** `resolveHarnessWorkspaceRoot('')` returns `''` (`harness-sync/src/lib/workspace/workspace-root.ts:70`), so the resolver probes `join('', '.claude', 'agents')`, a cwd-relative path (install dir in Electron, the shell cwd in the CLI). No consumer exists before B5a, so nothing is reachable today. **Resolution: Task 3.0b** — the resolver rejects a non-absolute or empty `workspaceRoot` before any FS call.
- **D10 (found at B2 verify, LOW-MEDIUM): the `.cmd` fallback under-measures.** When `resolveDirectSpawn` falls back to a `.cmd` wrapper, `cross-spawn` escapes cmd.exe metacharacters (space included) with `^`, twice for `node_modules/.bin` shims, so the real cmd.exe line can be well above the libuv-quoted length the guard measures. Over the cap the spawn still fails loudly with the OS error (no truncation, same as before this task), just not with `CliCommandLineTooLongError`. Not a regression. Mitigation: Task 6.2 records one real `.cmd` spawn with a space-heavy prompt measured just under 8,191 and documents the outcome in `cli-agent-runtime/CLAUDE.md` (Task 6.1).
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
| D3 double frontmatter strip (confirmed mangled) | MEDIUM | Task 2b.1 pinned it; Task 3.0 fixes it and flips the spec |
| D9 empty `workspaceRoot` resolves roles from `process.cwd()` | MEDIUM | Task 3.0b |
| D10 `.cmd` fallback under-measured (cross-spawn `^` escaping) | LOW-MEDIUM | Tasks 6.1 / 6.2 evidence + docs |
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
| B4c | `doSpawnSdk` typed options object (user decision, from B4b review) | backend-developer | B4b | G4: B4c ∥ B5a |
| B5a | Namespace role resolution + API builder wiring + `AgentNamespace` type | backend-developer | B2a, B4a, B4b | G4: B4c ∥ B5a |
| B4d | Facade split of `agent-process-manager.service.ts` (user decision, from B4b review) | backend-developer | B4c | G5: B4d ∥ B5b |
| B5b | Shared strict schema, both dispatchers, tool description, formatters, parity guard | backend-developer (sequential) | B5a | G5: B4d ∥ B5b |
| B6 | Lib docs + live e2e + A1-A3 evidence | technical-content-writer ∥ senior-tester | B4d, B5b | G6: docs lane ∥ e2e lane |
| B7 | agent-lanes skill `role` routing + content manifest | technical-content-writer | `origin/main` merged into this branch (PR #501 merged) | READY after the main merge; parallel with B6 (file-disjoint) |
| B8 | Native role probe (plan Component 8) | backend-developer | B6 | DEFERRED |

Full-delivery gate (after B5b, and again at Mode 3):

```
npx nx run-many -t test -p @ptah-extension/shared @ptah-extension/cli-agent-runtime @ptah-extension/vscode-lm-tools @ptah-extension/rpc-handlers @ptah-extension/tribunal-panel
npx nx run-many -t lint,typecheck -p @ptah-extension/shared @ptah-extension/cli-agent-runtime @ptah-extension/vscode-lm-tools @ptah-extension/rpc-handlers @ptah-extension/tribunal-panel
```

Read the `Running target test for 5 projects` header; N must be 5.

**Parallel-lane rule for G4 and G5 (recorded at B4b verify).** B4c/B4d own only `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager*` (+ the new collaborator files and `di/register.ts` in B4d). B5a/B5b own only `libs/backend/vscode-lm-tools/**`. Verified: no B5a/B5b task names `agent-process-manager.service.ts`, and vscode-lm-tools reaches the manager only through the `@ptah-extension/cli-agent-runtime` barrel (`agent-namespace.builder.ts`, `ptah-api-builder.service.ts`, `mcp-caller-workspace-resolver.ts`, three specs). The coupling is compile-time only: vscode-lm-tools typecheck and ts-jest compile cli-agent-runtime source through the path alias, so a half-edited manager can turn a vscode-lm-tools run red. Therefore, while two lanes overlap: each lane runs ONLY `npx nx run <its project>:test --testPathPatterns="..." --skip-nx-cache` with `NX_DAEMON=false`; no lane runs `typecheck` or an unfiltered test of the other lane's project; a red result that points into the other lane's files is reported, not fixed. The unfiltered N=2 gate (`cli-agent-runtime` + `vscode-lm-tools`, test,lint,typecheck) runs once after both lanes of the group return, before either commit. No `project.json` edit, so no `nx reset`.

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

## Batch B2a: AgentRoleResolver — COMPLETE (commit 7fdcc73d9)

- Recommended executor: backend-developer
- Fallback executor: CLI lane (self-contained: new folder + 3 wiring lines)
- Execution mode: sequential (within batch); parallel with B2b
- Rationale: new service with a security-sensitive name check and error taxonomy; owns the lib's DI and barrel files, which B2b does not touch.
- Tasks: 2 | Depends on: B1

### Task 2a.1: Implement resolver and spec — COMPLETE

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

### Task 2a.2: Register token and export — COMPLETE

- Files:
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\cli-agent-runtime\src\lib\di\tokens.ts` — `AGENT_ROLE_RESOLVER: Symbol.for('AgentRoleResolver')`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\cli-agent-runtime\src\lib\di\register.ts` — singleton registration next to `AGENT_REPORT_ROUTER` (`:43-52`)
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\cli-agent-runtime\src\index.ts` — `export * from './lib/roles'`
- Depends on: Task 2a.1
- Validation: `register.ptah-cli-registry.smoke.spec.ts` stays green; token key appears in the registered-services log list automatically.

### Batch B2a verification

- `npx nx run @ptah-extension/cli-agent-runtime:test --testPathPatterns="roles|register" --skip-nx-cache` while B2b is active; after both return, `npx nx run-many -t test,lint,typecheck -p @ptah-extension/cli-agent-runtime` (N=1)
- Traversal case proves no FS call before validation
- Reviewer: code-logic-reviewer (path safety, error taxonomy, no silent fallback)
- Gate record (2026-09-13): conductor instructed verify-and-commit in one invocation; team-leader cannot spawn, so the logic gate was an inline team-leader logic review of every changed line, not a separate reviewer spawn. Verdict APPROVE with one scheduled finding (D9 → Task 3.0b). Checked: name regex runs before `resolveHarnessWorkspaceRoot` and before any provider call (spec asserts `totalCalls() === 0` for `../x`, `..`, `.hidden`, `a/b`, `a\b`, empty, 101 chars, space); path joined only from the matched listing entry; case-sensitive exact match; empty check before size check; size in UTF-8 bytes on the LF-normalized stripped body; every failure is `AgentRoleError`, `role_read_failed` narrows with `instanceof Error`; no cache; no role-less fallback. Accepted deviation: `exists()` before `readDirectory` (port has no uniform not-found error), up to 3 FS calls per resolve. Evidence: conductor full-lib run 55 suites / 800 passed / 1 skipped; team-leader filtered run `--testPathPatterns="roles|cli-adapter\.utils|register"` 3 suites / 90 passed; `nx run-many -t lint,typecheck` for cli-agent-runtime, vscode-lm-tools, rpc-handlers, cli-engine green (4/4, 0 errors; no warning in a changed file); D7 `@nx/dependency-checks` did NOT fire on the harness-sync import. `git show --stat 7fdcc73d9` = 6 files, all named in this batch.

## Batch B2b: Role prompt assembly + command-line budget guard — COMPLETE (commit c0ecc1644)

- Recommended executor: backend-developer
- Fallback executor: CLI lane
- Execution mode: sequential (within batch); parallel with B2a
- Rationale: exact-value ordering and platform-limit math in one util file; owns `cli-adapter.utils.ts` and the `CliCommandOptions` half of the interface.
- Tasks: 3 | Depends on: B1

### Task 2b.1: `renderRoleBlock` and `buildTaskPrompt` role section — COMPLETE

- Files:
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\cli-adapter.utils.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\cli-adapter.utils.spec.ts`
- Plan reference: implementation-plan.md:124-146
- Contract:
  - `export function renderRoleBlock(role: AgentRoleDefinition, cli: CliType): string` → `## Role: <name>` + one sentence ("You are running as the `<name>` role; the definition below governs this task and outranks any generic persona above.") + body; body via `transformAgentBody(body, cli)` when `cli` is a `CliTarget` (codex, copilot, cursor, antigravity), unchanged for opencode, pi, ptah-cli
  - `buildTaskPrompt` order: `systemPrompt || projectGuidance` → `\n\n---\n\n` → role block when `options.role` → `\n\n---\n\n` → tool policy, task, files, taskFolder. Role-less output must be byte-identical to today.
- Spec: order with/without system context and with/without role (4 combinations, exact strings), transform applied for a CliTarget and skipped for `pi`, D3 `---`-leading body case.

### Task 2b.2: `assertCommandLineWithinLimit` + `CliCommandLineTooLongError`, called first in `spawnCli` — COMPLETE

- Files: same two as 2b.1
- Depends on: none within batch (same files, do after 2b.1)
- Contract:
  - `export function assertCommandLineWithinLimit(command: string, args: readonly string[], platform: NodeJS.Platform = process.platform): void`
  - win32: libuv-quoted length of `command + args` ≤ 32,767 UTF-16 units; when `command` ends `.cmd` or `.bat` (case-insensitive) the limit is 8,191 (defect D2)
  - linux: each arg ≤ 131,071 bytes; darwin: sum of arg bytes ≤ 1,048,576 − 4,096
  - `export class CliCommandLineTooLongError extends Error { readonly measured: number; readonly limit: number; readonly largestArgIndex: number }`; message names the largest arg and size, says nothing is truncated, lists the two remedies (shorten the task; use a lane whose channel does not use argv) without naming a vendor
  - `spawnCli` calls it first, before the `spawner` branch, so off-thread and inline spawns are both guarded
- Spec: limit-1 / limit / limit+1 for win32, win32 `.cmd`, linux, darwin (platform injected, never global); quoting cost of `"` and trailing `\`; error fields.

### Task 2b.3: `CliCommandOptions.role` — COMPLETE

- File: MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\cli-adapter.interface.ts`
- Contract: `readonly role?: AgentRoleDefinition` on `CliCommandOptions` ONLY. Do NOT add `roleChannel` to `CliAdapter` here (defect D1 — that is Task 3.1).
- Also export `renderRoleBlock`, `assertCommandLineWithinLimit`, `CliCommandLineTooLongError` through `cli-adapters/index.ts` only if that barrel already re-exports utils symbols; otherwise leave the barrel for B3/B4a to import by relative path. (Barrel file is owned by this batch if edited.)

### Batch B2b verification

- `npx nx run @ptah-extension/cli-agent-runtime:test --testPathPatterns="cli-adapter\.utils" --skip-nx-cache` while B2a is active; after both return, `npx nx run-many -t test,lint,typecheck -p @ptah-extension/cli-agent-runtime` (N=1) — every existing adapter spec still green (role-less byte identity)
- Reviewer: code-logic-reviewer (limit math, ordering, no truncation)
- Accepted deviations: (a) `buildTaskPrompt(options, cli?: CliType)` — role-less output is byte-identical with or without `cli`; a role without `cli` throws (programmer error, no silent role-less prompt). This changes the B3 contract (see Tasks 3.2-3.6). (b) win32 measure includes the terminating NUL (32,766 and 32,767 pass, 32,768 throws; same rule for 8,191). (c) POSIX platforms other than linux/darwin use the Linux per-argument rule. (d) `lib jest.config.ts` gains `setupFiles: ['reflect-metadata']` (conductor fix: the harness-sync barrel loads tsyringe, which broke 6 adapter spec suites); the per-spec `import 'reflect-metadata'` stays, consistent with the 9 sibling specs that already carry it.
- Gate record (2026-09-13): inline team-leader logic review (same basis as B2a). Verdict APPROVE with scheduled findings. Checked against libuv `quote_cmd_arg`: no-quote set is space/tab/`"`, empty arg `""`, reverse walk doubles backslashes before a quote or the closing quote and escapes `"` — implementation matches. Separators + NUL counted; `.cmd`/`.bat` case-insensitive branch present (D2); Linux 131,071 = `MAX_ARG_STRLEN` minus NUL; `spawnCli` guards before the `spawner` branch so off-thread and inline spawns are both covered; all `spawnCli` callers sit inside async/Promise paths so the synchronous throw becomes a rejection. Findings: **F1 = D3 CONFIRMED MANGLED → Task 3.0** (commit body of c0ecc1644 names it as open); **F2 = D10** `.cmd` fallback under-measured by cross-spawn `^` escaping → Tasks 6.1/6.2; **F3 (LOW)** Linux total `ARG_MAX` and darwin env bytes are not modelled — per-arg/args-only is the plan contract, document in Task 6.1; **F4 (LOW, no action)** `probeCliVersion` is documented "never throws"; the guard inside its Promise executor would reject, unreachable with `--version`/`models` args; **F5 (LOW, no action)** transform lanes `trim()` the body, pass-through lanes do not — whitespace only. Evidence as in B2a; `git show --stat c0ecc1644` = 5 files, all named in this batch (+ conductor's jest config).

## Batch B3: Adapter role channels + detection stamp — COMPLETE (commit 248276a6f)

- Recommended executor: backend-developer (single sub-agent)
- Fallback executor: after Task 3.1 is on disk, CLI lanes x 6 for Tasks 3.2-3.6 + 3.8 split by adapter
- Execution mode: sequential
- Rationale: the required interface member makes every adapter red until all six land (D1), and codex (SDK argv bypass) and antigravity (reorder before a HOME side effect) each need a judgment call mid-flight. Tasks 3.0/3.0b are two small correctness fixes found at B2 verify; they sit here because B3 owns `cli-adapters/**` and B4a owns only `ptah-cli/**`.
- Tasks: 10 | Depends on: B2b
- File ownership (G2): everything under `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/**`, `cli-agents/cli-detection.service.ts` + its new spec, and `libs/backend/cli-agent-runtime/src/lib/roles/**`. B3 must NOT edit `ptah-cli/**`.

### Task 3.0: D3 fix — role body keeps a leading `---` block on every lane — COMPLETE

- Files:
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\cli-adapter.utils.ts` (`renderRoleBlock`)
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\cli-adapter.utils.spec.ts` (`describe('a body that itself begins with a --- pair')`)
- Problem: `AgentRoleDefinition.body` is already frontmatter-stripped by the resolver; `transformAgentBody` (`harness-sync/src/lib/targets/transformers/transform-rules.ts:362-369`) calls `stripFrontmatter` again, so on codex/copilot/cursor/antigravity a body starting `---\n...\n---` loses that block.
- Contract: fix inside `renderRoleBlock` only. Do NOT change harness-sync (no new export, no new option on `transformAgentBody`) and do NOT change the shared `AgentRoleDefinition` type. Recommended mechanism: on transform lanes pass `transformAgentBody(EMPTY_FRONTMATTER + role.body, cli)` with a module constant `EMPTY_FRONTMATTER = '---\n\n---\n'`. `stripFrontmatter`'s regex `^---\n[\s\S]*?\n---\n?` matches exactly that sentinel (lazy match closes at the first `\n---`), so the second strip consumes the sentinel and never the body. Team-leader verified the regex on `'---\nkeep\n---\nx'`, `'plain'`, `'\nlead'`, `'---\n---\nx'` and `''`: body survives byte-for-byte in all five. Pass-through lanes (pi, opencode, ptah-cli) unchanged. If the executor picks another mechanism it must meet the same spec and the same no-harness-sync-change constraint.
- Spec change (flips the pinned case): replace `'loses the leading block on a transform lane (double strip)'` and `'keeps the leading block on a pass-through lane'` with one `it.each` over all 7 lanes (`codex, copilot, cursor, antigravity, pi, opencode, ptah-cli`) titled `'preserves the leading block on the %s lane'`, expecting `header('reviewer') + '---\nkeep: this block\n---\nThe real instructions.'` for every lane. Keep the existing `'applies the harness transform for the %s lane'` cases green (the rewrite still runs on transform lanes) and add one case where a `---`-leading body also contains a rewritable token (e.g. `AskUserQuestion`) on `codex`, expecting the block kept AND the token rewritten (`transformAgentBody` output for the post-block text).

### Task 3.0b: D9 fix — resolver rejects an empty or relative `workspaceRoot` — COMPLETE

- Files:
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\cli-agent-runtime\src\lib\roles\agent-role-resolver.service.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\cli-agent-runtime\src\lib\roles\agent-role-resolver.service.spec.ts`
- Problem: `resolveHarnessWorkspaceRoot('')` returns `''`, so `join('', '.claude', 'agents')` is cwd-relative and the resolver reads `process.cwd()/.claude/agents`.
- Contract: `listRoles` and `resolve` both reject `workspaceRoot` that is empty or not `path.isAbsolute` BEFORE `resolveHarnessWorkspaceRoot` and before any provider call. `resolve` keeps its order: name check first, then the workspace check. Add `'no_workspace'` to `AgentRoleErrorCode`; message says no workspace folder is open, so roles cannot be resolved, and that spawning without `role` is valid. `availableRoles` is `[]`. Export surface unchanged apart from the widened union.
- Spec: `listRoles('')`, `listRoles('relative/dir')`, `resolve('', 'x')` each raise `no_workspace` with `totalCalls() === 0`; `resolve('', '../x')` still raises `invalid_role_name` (name check first).
- Downstream: Task 5b.3/5b.5 "each of the 6 `AgentRoleError` codes" becomes 7 codes.

### Task 3.1: Required `CliAdapter.roleChannel` — COMPLETE

- File: MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\cli-adapter.interface.ts`
- Contract: `readonly roleChannel: AgentRoleChannel` on `CliAdapter`, required, doc sentence mirroring `capabilities()` (`:160-165`).

**`buildTaskPrompt` call-site rule (conductor decision, B2 verify):** B2b shipped `buildTaskPrompt(options, cli?: CliType)`, which throws when `options.role` is set and `cli` is missing. copilot, antigravity, opencode, cursor and pi call `buildTaskPrompt(options, this.name)`. codex keeps `buildTaskPrompt({ ...options, role: undefined })` (its role travels on `developer_instructions`, never in the thread input). Every call site in `cli-adapters/**` must follow this; grep `buildTaskPrompt(` after the batch and confirm no bare `buildTaskPrompt(options)` remains.

### Task 3.2: codex → `developer-instructions` — COMPLETE

- Files: `codex-cli.adapter.ts` + `codex-cli.adapter.spec.ts` in `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\`
- Contract: `roleChannel = 'developer-instructions'`; when `options.role`, `config['developer_instructions'] = renderRoleBlock(role, 'codex')` (after Task 3.0, so a `---`-leading body survives); run `assertCommandLineWithinLimit` on the serialized override (`--config`, `developer_instructions=<JSON.stringify(value)>`, against the resolved codex binary) BEFORE `new sdk.Codex` (`:632`); `buildTaskPrompt({ ...options, role: undefined })` at `:658` (no `cli` argument needed because the role is stripped).
- Spec: config carries the block and thread input does not; oversized role rejects with `CliCommandLineTooLongError` and `sdk.Codex` is never constructed; `sandboxMode`/`approvalPolicy` unchanged; role-less config unchanged.

### Task 3.3: copilot → `task-prompt` — COMPLETE

- Files: `copilot-sdk.adapter.ts` + `.spec.ts`
- Contract: `roleChannel = 'task-prompt'`; role reaches `-p` via `buildTaskPrompt(options, this.name)` (`:459`); continuation `runTurn(message)` does not re-add it.
- Spec: role block inside the `-p` value after harness context; continuation turn argv has no role block; guard error surfaces through `spawnCli`.

### Task 3.4: antigravity → `task-prompt`, guard before MCP write — COMPLETE

- Files: `antigravity-cli.adapter.ts` + `antigravity-cli.adapter.spec.ts` (leave `antigravity-cli.adapter.mcp.spec.ts` green, edit only if its ordering assumption breaks)
- Contract: `roleChannel = 'task-prompt'`; prompt via `buildTaskPrompt(options, this.name)`; reorder `runSdk` so prompt + args are built and `resolveDirectSpawn` resolved, then `assertCommandLineWithinLimit(descriptor.command, [...prefixArgs, ...args])` runs, then `configureMcpServer` (`:441`), then `spawnCli`. `ensureFolderTrusted` stays first (unchanged behaviour).
- Spec: role block in `--print` value; oversized role rejects and `configureMcpServer` is never called.

### Task 3.5: opencode → `task-prompt` — COMPLETE

- Files: `opencode-cli.adapter.ts` + `.spec.ts`
- Contract: `roleChannel = 'task-prompt'`; role in trailing positional via `buildTaskPrompt(options, this.name)` (`:406`); `OPENCODE_CONFIG_CONTENT` unchanged (no native agent in v1).

### Task 3.6: cursor and pi → `task-prompt` — COMPLETE

- Files: `cursor-cli.adapter.ts` + `.spec.ts`, `pi-cli.adapter.ts` + `.spec.ts`
- Contract: `roleChannel = 'task-prompt'` on both; both build the prompt with `buildTaskPrompt(options, this.name)`; cursor role in `agent.send(prompt)` first turn; pi role in stdin JSONL first prompt; neither re-sends on continuation.

### Task 3.7: Detection stamps role fields — COMPLETE

- Files:
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-detection.service.ts`
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-detection.service.spec.ts` (defect D4)
- Contract: `doDetectAll` stores `{ ...result, roleDelivery: 'preamble', roleChannel: adapter.roleChannel }` on the success branch and adds both to the error-branch literal (`:122-126`), so the cache carries them.
- Spec: both branches stamped; cache returns stamped rows.

### Task 3.8: No adapter-side permission drift — COMPLETE

- Files: the adapter specs above
- Contract: one assertion per adapter spec that a role-carrying spawn produces the same sandbox/permission/model/effort arguments as the role-less spawn.

### Batch B3 verification

- While B4a runs in parallel: `NX_DAEMON=false npx nx run @ptah-extension/cli-agent-runtime:test --testPathPatterns="cli-adapters|cli-detection|roles" --skip-nx-cache`
- After B3 and B4a both return: `npx nx run-many -t test,lint,typecheck -p @ptah-extension/cli-agent-runtime` (N=1)
- The D3 spec reads "preserves the leading block on the %s lane" for all 7 lanes; no spec still asserts the mangled output
- No bare `buildTaskPrompt(options)` left in `cli-adapters/**`
- `git diff --name-only` lists only files named above
- Reviewer: code-logic-reviewer (side-effect ordering, SDK argv guard, continuation behaviour)
- Gate record (2026-09-13): conductor instructed verify-and-commit for B3 and B4a in one invocation; gate = inline team-leader logic review of every changed production line (same basis as B2a/B2b). Verdict APPROVE. Checked on disk: all 6 adapters declare `roleChannel` (codex `developer-instructions`, others `task-prompt`); `buildTaskPrompt(` call sites = 5x `(options, this.name)` + codex `({ ...options, role: undefined })`, no bare call; codex guard runs on `['--config', 'developer_instructions=' + JSON.stringify(block)]` against `nativeBinaryPath ?? 'codex'` before `codexOptions.config` is assigned and before `new sdk.Codex`; antigravity order `ensureFolderTrusted` → prompt/args → `resolveDirectSpawn` → `assertCommandLineWithinLimit` → `configureMcpServer` → `spawnCli`, `priorMcpEntry` still a local; `renderRoleBlock` prepends `EMPTY_FRONTMATTER` on transform lanes only; D3 spec is the 7-lane `it.each` "preserves the leading block on the %s lane" plus the codex block-kept-and-rewritten case, no mangled assertion left; resolver `assertWorkspaceRoot` runs before `resolveHarnessWorkspaceRoot` in `listRoles` and after the name check in `resolve`; detection stamps both branches. Evidence (team-leader, unfiltered): `NX_DAEMON=false npx nx run-many -t test,lint,typecheck -p @ptah-extension/cli-agent-runtime --skip-nx-cache` → 1 project, Test Suites 57 passed / 57, Tests 847 passed + 1 skipped, lint 0 errors (38 warnings, pre-existing kinds: max-lines on codex 819 / registry 1079 / a 1502-line spec, no-empty-function and no-non-null-assertion in specs), typecheck green, EXIT 0. Downstream `run-many -t typecheck -p vscode-lm-tools rpc-handlers cli-engine tribunal-panel ptah-cli --skip-nx-cache` → 5 projects green. `git show --stat 248276a6f` = 19 files, all in B3 ownership. Prettier whitespace reflow of existing B2b lines in `cli-adapter.utils.spec.ts` accepted (B3-owned file).
- Open-item decisions: (1) copilot/pi `runTurn` throws synchronously from `continue()` if the guard ever fires on a continuation — NO CHANGE: the only caller, `AgentProcessManager.continueConversation` (`agent-process-manager.service.ts:1250-1252`), runs `await sdkHandle.continue(message)` inside `try`, so a synchronous throw and a rejection take the same path; filed under follow-ups as a contract-tidiness item. (2)/(3) review items from e8cf6739b (no spec for empty `args`; `largestArgIndex` -1 coerced to 0 misattributes overflow to "argument 0") — filed under follow-ups, LOW: no production caller passes empty `args`, and the error still fires with the right `measured`/`limit`, only the attribution text is wrong.

## Batch B4a: ptah-cli system-prompt delivery — COMPLETE (commit f7f93baf6)

- Recommended executor: backend-developer
- Fallback executor: CLI lane
- Execution mode: sequential; parallel with B3
- Rationale: owns only `ptah-cli/**`, disjoint from B3's `cli-adapters/**` and detection.
- Tasks: 3 | Depends on: B2b

- File ownership (G2): only `libs/backend/cli-agent-runtime/src/lib/ptah-cli/**`. B4a must NOT edit `cli-adapters/**` (including `cli-adapter.utils.ts`, which B3 edits in Task 3.0), `roles/**`, detection, or any barrel. Import `renderRoleBlock` from `../../cli-agents/cli-adapters/cli-adapter.utils` (or the `cli-adapters` barrel, which already exports it). `renderRoleBlock(role, 'ptah-cli')` is a pass-through lane, so Task 3.0 does not change its output.

### Task 4a.1: Thread `role` through `PtahCliRegistry.spawnAgent` — COMPLETE

- File: MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\cli-agent-runtime\src\lib\ptah-cli\ptah-cli-registry.ts`
- Contract: `options.role?: AgentRoleDefinition` (`:562-583`), forwarded to `assembleSpawnOptions` (`:653-667`) as a new trailing parameter; tier/model precedence untouched; role frontmatter `model`/`tools` never read.

### Task 4a.2: Append role block to the system prompt — COMPLETE

- Files:
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\cli-agent-runtime\src\lib\ptah-cli\helpers\ptah-cli-spawn-options.service.ts`
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\cli-agent-runtime\src\lib\ptah-cli\helpers\ptah-cli-spawn-options.role.spec.ts`
- Contract: `assembleSpawnOptions(..., agentId?, role?)`; `fullSystemPromptContent` gains `renderRoleBlock(role, 'ptah-cli')` after `## Project Guidance`. Existing positional callers and specs (`*.output-style.spec.ts`, `*.session-ids.spec.ts`, registry specs) stay green unchanged.
- Spec: role section after project guidance; absent without role; present with no project guidance; both `standalone` and preset-append carry it (assumption A6).

### Task 4a.3: argv/env probe with a 64 KiB role — COMPLETE

- File: MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\cli-agent-runtime\src\lib\ptah-cli\ptah-cli-registry-auto-compact-argv.spec.ts`
- Contract: one case spawning with a 64 KiB role asserts the role text is in `initialize.systemPrompt` or `appendSystemPrompt` and in no argv element or env value.

### Batch B4a verification

- During G2: `NX_DAEMON=false npx nx run @ptah-extension/cli-agent-runtime:test --testPathPatterns="ptah-cli" --skip-nx-cache`; full `npx nx run-many -t test,lint,typecheck -p @ptah-extension/cli-agent-runtime` (N=1) after B3 and B4a both return
- `git diff --name-only` for B4a lists only `ptah-cli/**` files named above
- Reviewer: code-logic-reviewer
- Gate record (2026-09-13): inline team-leader logic review, same basis as B3. Verdict APPROVE. Checked: `role?: AgentRoleDefinition` on `spawnAgent` options forwarded as the trailing `assembleSpawnOptions` argument; `renderRoleBlock(role, 'ptah-cli')` joins `fullSystemPromptContent` after `## Project Guidance`; no read of role frontmatter `model`/`tools`; log gains `role: role?.name ?? null`; argv probe now records `spawnOptions.env` and the `role-64kib` case asserts body in `initialize.systemPrompt`/`appendSystemPrompt`, marker in no argv element and no env value. A6: executor reports the real assembler always returns preset-append; standalone proven in the role spec by forcing `mode` — accepted. The executor's post-test prettier pass (e.g. `findPinnedSdk` reflow) was covered by the team-leader's unfiltered re-run after it (57/57 suites, see B3 gate record). `git show --stat f7f93baf6` = 4 files, all `ptah-cli/**`.

## Batch B4b: Manager plumbing + list-row stamp — COMPLETE (commit b0ab33b48)

- Recommended executor: backend-developer
- Fallback executor: CLI lane
- Execution mode: sequential
- Rationale: needs `adapter.roleChannel` (B3); disjoint from B4a, so it may start as soon as B3 is committed even if B4a is still running.
- Tasks: 2 | Depends on: B1, B3

### Task 4b.1: `AgentProcessManager` forwards role and stamps records — COMPLETE

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
- Validation: do NOT touch `wiring/agent-events.ts` (sibling WIP, see defaults). The spec's adapter fake (`agent-process-manager.service.spec.ts:221-239`) is cast `as unknown as jest.Mocked<CliAdapter>`, so it still compiles after Task 3.1 without `roleChannel`; add `roleChannel` to it here, because `doSpawn` now reads it.

### Task 4b.2: ptah-cli list rows in rpc-handlers — COMPLETE

- File: MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\rpc-handlers\src\lib\handlers\agent-rpc.handlers.ts`
- Contract: `mergePtahCliAgents` rows (`:833-843`) add `roleDelivery: 'preamble', roleChannel: 'system-prompt'`. List-row stamping only; no RPC method added, no `rpc.types.ts` or `ALLOWED_METHOD_PREFIXES` change.
- Spec: if no existing spec covers `mergePtahCliAgents`, add the assertion to a new `agent-rpc.handlers.list-rows.spec.ts` in the same folder.

### Batch B4b verification

- `npx nx run-many -t test,lint,typecheck -p @ptah-extension/cli-agent-runtime @ptah-extension/rpc-handlers` (N=2)
- Reviewer: code-style-reviewer (plumbing, no CLI-name branching, file growth on a 2,334-line file)
- Gate record (2026-09-13): code-style-reviewer run by the conductor, `code-style-review-b4b.md` (committed with the batch): APPROVE 7/10, 0 blocking, 2 serious, 2 minor. Both serious findings fixed before commit, by conductor decision, in the same batch:
  1. **Single source for ptah-cli delivery.** `PTAH_CLI_ROLE_DELIVERY: { readonly roleDelivery: AgentRoleDelivery; readonly roleChannel: AgentRoleChannel } = { roleDelivery: 'preamble', roleChannel: 'system-prompt' }` in `ptah-cli/helpers/ptah-cli-registry.utils.ts`, exported via `ptah-cli/helpers/index.ts` → `ptah-cli/index.ts` → `@ptah-extension/cli-agent-runtime`. `agent-rpc.handlers.ts` spreads it; `agent-rpc.handlers.list-rows.spec.ts` mocks it with `native`/`agent-selection` so a leftover literal would fail. No new dependency edge.
  2. **Atomic role stamp.** Exported `AgentRoleStamp { role; roleDelivery; roleChannel }` (all required, type-exported from `cli-agents/index.ts`) + file-level `roleStampOf(record)` that returns a stamp only when all three are present. `doSpawnSdk` builds one stamp and spreads it; `spawnFromSdkHandle` meta takes `roleStamp?: AgentRoleStamp` (no flat keys); `trackSdkHandle` spreads `roleStampOf(info)`. Shared `AgentProcessInfo`/`SpawnAgentResult` flat optional fields unchanged. A spec proves a `Partial<AgentRoleStamp>` is not assignable to the meta's `roleStamp`.
  - Files outside the original B4b list, accepted: `ptah-cli-registry.utils.ts`, both ptah-cli barrels, `cli-agents/index.ts`, `ptah-cli-spawn-options.role.spec.ts`.
  - Minor findings (doSpawnSdk 9 positional params; manager ~2,366 lines) are NOT follow-ups: user decision schedules them as B4c and B4d.
- Team-leader verification: diff read on disk for all 10 files; `wiring/agent-events.ts` and agent-sdk `session-metadata-store.ts` untouched; no `rpc.types.ts` / `ALLOWED_METHOD_PREFIXES` change; `doSpawn` passes `adapter.roleChannel`; `runSdk` receives `role: roleDefinition`. Evidence — conductor, after the amendment: `NX_DAEMON=false npx nx run-many -t test,lint,typecheck -p @ptah-extension/cli-agent-runtime @ptah-extension/rpc-handlers --skip-nx-cache` → 2 projects; cli-agent-runtime 57 suites / 854 passed + 1 skipped, lint 0 errors; rpc-handlers 99 suites / 2,987 passed + 33 skipped, lint 0 errors; typecheck green. Team-leader, downstream importers of the new exports: `NX_DAEMON=false npx nx run-many -t typecheck -p @ptah-extension/vscode-lm-tools @ptah-extension/cli-engine @ptah-extension/rpc-handlers @ptah-extension/cli-agent-runtime ptah-cli ptah-electron ptah-extension-vscode --skip-nx-cache` → `Successfully ran target typecheck for 7 projects`, EXIT 0. `git show --stat b0ab33b48` = 10 files, +634/-1.

## Batch B4c: `doSpawnSdk` typed options object — COMPLETE (commit 3e32135b2)

- Origin: B4b code-style review minor finding 1, promoted to a batch by user decision (2026-09-13).
- Recommended executor: backend-developer
- Fallback executor: CLI lane (single private method + one call site)
- Execution mode: sequential; runs in parallel with B5a (G4, file-disjoint, see the parallel-lane rule)
- Rationale: pure signature refactor inside one private method; no behaviour change, so it is safe beside B5a, which never touches the manager.
- Tasks: 1 | Depends on: B4b

### Task 4c.1: Replace the 9 positional parameters with one readonly options interface — COMPLETE

- Files:
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\cli-agent-runtime\src\lib\cli-agents\agent-process-manager.service.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\cli-agent-runtime\src\lib\cli-agents\agent-process-manager.service.spec.ts` (only if an existing case must change; a behaviour-preserving refactor should need none)
- Pattern to follow: the `meta` object of `spawnFromSdkHandle` in the same file.
- Contract:
  - Declare a file-local (NOT exported) `interface SdkSpawnOptions` next to `AgentRoleStamp`, all members `readonly`: `runSdk: (options: CliCommandOptions) => Promise<SdkHandle>`; `request: SpawnAgentRequest`; `task: string`; `workingDirectory: string`; `cli: CliType`; `displayName: string`; `roleChannel: AgentRoleChannel`; `binaryPath?: string`; `mcpPort?: number`. Name verified free across `libs/` (no existing `SdkSpawnOptions`).
  - `private async doSpawnSdk(options: SdkSpawnOptions): Promise<SpawnAgentResult>`; destructure at the top so the body below stays line-for-line the same.
  - The single call site in `doSpawn` passes an object literal with named keys (`runSdk: adapter.runSdk.bind(adapter)`, `task: request.task`, `binaryPath: detection.path`, …).
  - No change to `spawn`, `spawnFromSdkHandle`, `trackSdkHandle`, `AgentRoleStamp`, the runSdk argument object, log payloads, or any public signature. No new comments.
- Validation notes: do NOT touch `wiring/agent-events.ts` or agent-sdk `session-metadata-store.ts`. Do not start the B4d split here.
- Acceptance: `grep -n "doSpawnSdk(" agent-process-manager.service.ts` shows exactly the declaration and one call, both object-shaped; `git diff --stat` = 1 file (2 if the spec had to change, with the reason reported).

### Batch B4c verification

- During G4 overlap: `NX_DAEMON=false npx nx run @ptah-extension/cli-agent-runtime:test --testPathPatterns="agent-process-manager|sdk-callbacks" --skip-nx-cache` (expect `Test Suites: 5`: `agent-process-manager.service`, `.restore`, `.workspace-scope`, `agent-process-manager-helpers`, `sdk-callbacks`)
- After B4c and B5a both return: `NX_DAEMON=false npx nx run-many -t test,lint,typecheck -p @ptah-extension/cli-agent-runtime @ptah-extension/vscode-lm-tools --skip-nx-cache` (N=2)
- Reviewer: code-style-reviewer (signature shape, consistency with `spawnFromSdkHandle` meta); team-leader may run it inline given the size
- Gate record (2026-09-13): code-style-reviewer run by the conductor, `code-style-review-b4c.md` (committed with the batch): APPROVE 8/10, 0 blocking, 0 serious, 2 minor, both intentional and left as-is (named interface vs the inline `meta` type of `spawnFromSdkHandle`; member ordering). Team-leader verification on disk: `SdkSpawnOptions` file-local, all nine members `readonly`, declared after `AgentRoleStamp`; `doSpawnSdk(options)` destructures at the top; `grep doSpawnSdk(` = declaration + one object-shaped call; no public signature or log payload change; `git show --stat 3e32135b2` = manager +31/-16 + the review. Evidence (conductor): filtered G4 run 5 suites / 146 passed; joint N=2 gate `NX_DAEMON=false npx nx run-many -t test,lint,typecheck -p @ptah-extension/cli-agent-runtime @ptah-extension/vscode-lm-tools --skip-nx-cache` → cli-agent-runtime 57 suites / 854 passed + 1 skipped, lint 0 errors; vscode-lm-tools 46 suites / 1,075 passed, lint 0 errors; typecheck green. The manager is 2,381 lines at 3e32135b2: B4d line ranges below (taken at b0ab33b48) shift by about +15 after line 121.

## Batch B4d: Facade split of `agent-process-manager.service.ts` — COMPLETE (commit 84ff943bc)

- Origin: B4b code-style review minor finding 2, promoted to a batch by user decision (2026-09-13). Rule: root `CLAUDE.md` "File size" facade rule.
- Recommended executor: backend-developer (single sub-agent)
- Fallback executor: none; the three tasks share the constructor and the spec harnesses
- Execution mode: sequential; may run in parallel with B5b (G5, file-disjoint, see the parallel-lane rule)
- Rationale: one class loses two concerns to injected collaborators; every hand-built manager in 4 spec files changes with the constructor, so the work cannot be split across lanes.
- Tasks: 3 | Depends on: B4c (same file)

### B4d design (team-leader, at B4b verify, on the file at b0ab33b48, 2,366 lines)

Seams found (line ranges at b0ab33b48; B4c shifts them by a few lines):

| # | Concern | Members | Lines | ~Size | State / deps it touches |
| - | --- | --- | --- | --- | --- |
| S1 | Launch settings and spawn environment | `mapEffortToCli`, `mapEffortToAgy`, `resolveReasoningEffort`, `resolveAutoApprove`, `MODEL_CONFIG_KEYS`, `resolveConfiguredModel` | 222-325 | 105 | `workspace`, `reasoningSettings`; no agent state |
| | | `getSdkIdleReleaseMs` | 1784-1813 | 30 | `workspace` |
| | | `getMaxConcurrentAgents` | 2115-2143 | 29 | `workspace` |
| | | `getPreferredCli` | 2145-2209 | 65 | `workspace`, `cliDetection`, `logger` |
| | | `resolveScopedWorkspaceRoot`, `getWorkspaceRoot`, `isWithinWorkspaceScope` | 2211-2251 | 41 | `callerWorkspaceResolver`, `workspace` |
| | | `validateWorkingDirectory`, `resolveMcpPort`, `runHarnessPreflight` | 2286-2365 | 80 | `fs.realpath`, `mcpServerStatus`, `sentryService`, `harnessPreflight`, `logger` |
| S2 | Output buffering and throttled delta emission | `scheduleFlush`, `appendBuffer`, `accumulateDelta`, `accumulateSegment`, `accumulateStreamEvent`, `flushDelta`, `cleanupFlushTimer` | 1532-1728, 2012-2022 | 210 | `pendingDeltas`, `flushTimers` (owned only here), per-record buffers/segments/stream events, `events.emit('agent:output')`, re-arms the watchdog on flush |
| S3 | Spawn and SDK-handle tracking | `spawn`, `doSpawn`, `doSpawnSdk`, `spawnFromSdkHandle`, `trackSdkHandle`, `reserveSpawnSlot`, `acquireSpawnLock`, `markParentSubagentsAsCliAgent`, `getRunningCount`, `getRunningAgentIds` | 389-769, 1457-1501, 2103-2113, 2253-2284 | 480 | `agents`, `spawning`, `spawnMutex`, `events`, `subagentRegistry` |
| S4 | Read-side queries and restore | `noSuchAgentMessage`, `restoredRecordMessage`, `restoreAgents`, `getStatus`, `listTrackedAgents`, `reserveAgentId`, `findAgentInfo`, `recordAgentNote`, `readOutput`, `resolveParentSessionId`, `readOutputForPersistence` | 771-1153 | 380 | `agents`, workspace scope |
| S5 | Messaging and continuation | `sendToAgent`, `canStartNewTurn`, `continueConversation` | 1154-1329 | 175 | `agents`, `messageRouter` (router calls back into the manager via `flushPending(agentId, tracked, this)`) |
| S6 | Lifecycle: watchdog, idle release, exit, TTL cleanup, kill | `stop`, `disposeAll`, `unrefTimer`, `resolveInactivityTimeout`, `armInactivityWatchdog`, `handleTimeout`, `scheduleIdleRelease`, `clearIdleRelease`, `releaseTracked`, `releaseSubprocess`, `handleExit`, `scheduleCleanup`, `killProcess`, `waitForSdkSettle` | 1330-1456, 1503-1530, 1730-1782, 1815-2010, 2024-2101 | 600 | `agents`, `events` (`agent:exited`/`released`/`expired`), `messageRouter`, `sentryService`, S2 flush |

**Cut chosen: two collaborators, S1 and S2.**

- **`AgentSpawnEnvironment`** (`cli-agents/agent-spawn-environment.service.ts`, ~350 lines with docs) takes all of S1. It answers "what does a spawn run with, and where": model / effort / auto-approve for a CLI, the preferred CLI, the concurrency cap, the idle-release window, the scoped workspace root and scope test, working-directory validation, the MCP port and the harness preflight. It holds no per-agent state. Its constructor takes `logger`, `cliDetection`, `workspace`, `reasoningSettings`, `sentryService`, and the optional `harnessPreflight`, `mcpServerStatus`, `callerWorkspaceResolver` with the SAME tokens and `{ isOptional: true }` the manager uses today (move the three constructor doc blocks with them).
- **`AgentOutputBuffer`** (`cli-agents/agent-output-buffer.service.ts`, ~250 lines with docs) takes S2 and owns `pendingDeltas` and `flushTimers`. It must not own the agent map or the event emitter: its methods take the `TrackedAgent` record (and its id), mutate that record's buffers, and hand a built `AgentOutputDelta` back to the manager, which emits `agent:output` and re-arms the watchdog. The flush timer calls a callback the manager supplies (e.g. `schedule(agentId, onDue)`), so the manager's flush path stays the one funnel. `readOutput` / `readOutputForPersistence` stay on the manager (public API, S4) and may delegate formatting only if it falls out naturally.
- **`TrackedAgent`** moves to `cli-agents/tracked-agent.ts` (interface only, not exported from any barrel) because both the manager and `AgentOutputBuffer` now need it. This is a shared contract, not a cap-driven fragment.

Why not the others:
- S6 (lifecycle, ~600 lines) is the largest block but shares four mutable things with S3/S4/S5: the `agents` map, the emitter, `messageRouter` (whose `flushPending` takes the manager itself), and the S2 flush in `handleExit`. Extracting it needs a host back-reference or a new shared record-store class, which is fragment sprawl and a second owner of the map. It stays.
- S4 restore alone is ~145 lines of code under the ~150 floor; S5 is already delegated to `AgentMessageRouter`. Neither passes the guardrails.
- S3 is the manager's reason to exist.

Expected result: manager ≈ 2,366 − ~560 moved + ~40 delegation ≈ 1,850 lines. That is still past 1,000, and deliberately so: what remains is one state owner (the map, the spawn slots, the emitter) and the lifecycle over it. Constructor goes from 10 injected parameters to 7: `logger`, `cliDetection`, `subagentRegistry`, `sentryService` (`killProcess`), `messageRouter`, `spawnEnvironment`, `outputBuffer`. `workspace`, `reasoningSettings`, `harnessPreflight`, `mcpServerStatus`, `callerWorkspaceResolver` leave the manager.

Invariants the split must hold:
- `AgentProcessManager` keeps its name, `TOKENS.AGENT_PROCESS_MANAGER`, `events`, every public method signature, and the exports from `cli-agents/index.ts` (`MIN/MAX/DEFAULT_CONCURRENT_AGENTS`, `AgentContinueError`, `AgentContinueErrorCode`, `AgentReleaseReason`, `AgentRoleStamp`). `MIN/MAX/DEFAULT_CONCURRENT_AGENTS` stay exported from `agent-process-manager.service.ts` (re-export if the definitions move).
- Every user-facing error string stays byte-identical (the concurrency message, `Working directory must be within workspace root…`, `Cannot spawn agent process: no workspace root is open.`, `Agent not found: …`).
- The spawn mutex, `spawning` counter and `reserveSpawnSlot` stay in the manager; the slot release in `finally` is untouched.
- Timer unref behaviour is preserved in both classes (Jest open-handle regressions are the failure mode).
- Collaborators are registered as singletons in `libs/backend/cli-agent-runtime/src/lib/di/register.ts` before `TOKENS.AGENT_PROCESS_MANAGER`, and injected by class token the way `AgentMessageRouter` is. They are not exported from the lib barrel unless a consumer needs them (none does today).
- Do NOT touch `wiring/agent-events.ts` or agent-sdk `session-metadata-store.ts` (sibling WIP). `wiring/sdk-callbacks.spec.ts` constructs the manager by hand and is in scope for the constructor change only.

### Task 4d.1: Extract `AgentSpawnEnvironment` — COMPLETE

- Files:
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\cli-agent-runtime\src\lib\cli-agents\agent-spawn-environment.service.ts`
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\cli-agent-runtime\src\lib\cli-agents\agent-spawn-environment.service.spec.ts` (move the pure-resolution cases — effort mapping, configured model, preferred CLI, cap bounds, idle-release floor, working-directory scope, MCP port — out of `agent-process-manager.service.spec.ts` / `.workspace-scope.spec.ts` where they test S1 logic directly; manager-level cases that go through `spawn`/`getStatus` stay where they are)
  - MODIFY `agent-process-manager.service.ts`, `di/register.ts`
- Contract: as in the design above. Public methods of the collaborator are named for what they answer (`resolveModel`, `resolveReasoningEffort`, `resolveAutoApprove`, `preferredCli`, `maxConcurrentAgents`, `sdkIdleReleaseMs`, `scopedWorkspaceRoot`, `workspaceRoot`, `isWithinScope`, `validateWorkingDirectory`, `mcpPort`, `runHarnessPreflight` — exact names are the executor's call, no `get`/`helper` prefixes required).

### Task 4d.2: Extract `AgentOutputBuffer` and move `TrackedAgent` — COMPLETE

- Files:
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\cli-agent-runtime\src\lib\cli-agents\agent-output-buffer.service.ts`
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\cli-agent-runtime\src\lib\cli-agents\agent-output-buffer.service.spec.ts` (low-water trim + line count, segment cap, stream-event cap slack and log-once, flush merges text segments and clears pending, cleanup clears timer and pending)
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\cli-agent-runtime\src\lib\cli-agents\tracked-agent.ts`
  - MODIFY `agent-process-manager.service.ts`, `di/register.ts`
- Depends on: Task 4d.1 (constructor shape settles once)
- Contract: as in the design above. The spec at `agent-process-manager.service.spec.ts:2140` that reads `manager.flushTimers` through a cast must read the collaborator's state instead (or assert behaviour), not a re-added manager field.

### Task 4d.3: Constructor callers and spec harnesses — COMPLETE

- Files: `agent-process-manager.service.spec.ts` (harness `:370`, `:2285`), `agent-process-manager.restore.spec.ts` (`:59`), `agent-process-manager.workspace-scope.spec.ts` (`:67`, private casts `:97`, `:108`), `wiring/sdk-callbacks.spec.ts` (`:358`)
- Depends on: Tasks 4d.1, 4d.2
- Contract: every hand-built manager builds its two collaborators from the same fakes it passes today (one small factory per spec file is fine; no shared test-helper module). No assertion is deleted; a moved assertion is named in the report with its old and new location. No default-constructed collaborator is added to the manager constructor just to keep old positional calls compiling.

### Batch B4d verification

- During G5 overlap: `NX_DAEMON=false npx nx run @ptah-extension/cli-agent-runtime:test --testPathPatterns="agent-process-manager|agent-spawn-environment|agent-output-buffer|sdk-callbacks|register" --skip-nx-cache`
- After B4d and B5b both return: `NX_DAEMON=false npx nx run-many -t test,lint,typecheck -p @ptah-extension/cli-agent-runtime @ptah-extension/vscode-lm-tools @ptah-extension/rpc-handlers @ptah-extension/cli-engine --skip-nx-cache` (N=4); cli-agent-runtime test count must be ≥ 854 passed (moved cases counted once)
- `wc -l` for the three files reported; no new file under ~150 lines except `tracked-agent.ts`; manager constructor ≤ 8 parameters
- `git diff --name-only` lists only the files above; `wiring/agent-events.ts` and `session-metadata-store.ts` absent
- Reviewer: code-style-reviewer (facade rule, nameability, dependency direction, constructor size)
- Gate record (2026-09-13): code-style-reviewer run by the conductor, `code-style-review-b4d.md` (committed with the batch): APPROVE 8/10, 0 blocking, 1 serious, 2 minor. Serious = no DI smoke spec for the new collaborators; fixed before commit at conductor request: `di/register.agent-process-manager.smoke.spec.ts` resolves `TOKENS.AGENT_PROCESS_MANAGER` through the real container and asserts both collaborators are container singletons injected into the manager; conductor proved it fails (2 failed) with either `registerSingleton` line removed, then restored `register.ts` (diff = the 4 B4d lines only). Minor findings filed under follow-ups (shared unref helper; log-prefix / Sentry `errorSource` rename pass, kept byte-identical here by the batch invariant).
- Team-leader verification on disk: `wc -l` manager 1,741 / `agent-spawn-environment.service.ts` 431 / `agent-output-buffer.service.ts` 228 / `tracked-agent.ts` 68; constructor 7 injected params (`logger`, `cliDetection`, `subagentRegistry`, `sentryService`, `messageRouter`, `spawnEnvironment`, `outputBuffer`), no default-constructed collaborator; `MIN/MAX/DEFAULT_CONCURRENT_AGENTS` re-exported from the manager file; `Cannot spawn agent process: no workspace root is open.`, `Working directory must be within workspace root.` and `Agent not found: ` strings unchanged; `register.ts` registers both collaborators before `AGENT_PROCESS_MANAGER`; no TODO/STUB/PLACEHOLDER in the new files; `wiring/agent-events.ts` and agent-sdk untouched. Evidence: conductor joint gate (before the smoke spec) `run-many -t test,lint,typecheck` cli-agent-runtime 59 suites / 900, vscode-lm-tools 48 / 1,138, rpc-handlers 99 / 2,987, cli-engine 17 / 173, 0 lint errors, typecheck green; typecheck green for ptah-electron, ptah-extension-vscode, ptah-cli, tribunal-panel. Team-leader re-run after the smoke spec: `npx nx run-many -t test -p @ptah-extension/cli-agent-runtime --skip-nx-cache` → 1 project, Test Suites 60 passed / 60, Tests 905 passed + 1 skipped (≥ 854), EXIT 0. `git show --stat 84ff943bc` = 13 files (12 cli-agent-runtime + review), +2,142/-922.

## Batch B5a: Namespace role resolution + API builder wiring — COMPLETE (commit e7672c332)

- Recommended executor: backend-developer
- Fallback executor: none (one coherent change across 3 coupled files)
- Execution mode: sequential
- Rationale: `types.ts` is shared with every namespace; resolution order relative to the ptah-cli / rival branch is the core behaviour of the feature.
- Tasks: 2 | Depends on: B2a, B4a, B4b
- Parallel: runs beside B4c (G4). File-disjoint: B5a owns only `libs/backend/vscode-lm-tools/**` and must not edit anything under `libs/backend/cli-agent-runtime/**`. Follow the parallel-lane rule under the full-delivery gate.
- Contract amendment at B4b verify (commit b0ab33b48): B4b shipped `PTAH_CLI_ROLE_DELIVERY` and `AgentRoleStamp` from `@ptah-extension/cli-agent-runtime`, and `spawnFromSdkHandle` meta takes `roleStamp?: AgentRoleStamp` instead of three flat keys. B5a uses both; it writes no `'preamble'` or `'system-prompt'` literal for ptah-cli anywhere in production code.

### Task 5a.1: `AgentNamespace.spawn` resolves role; `listRoles` — COMPLETE

- Files in `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\vscode-lm-tools\src\lib\code-execution\`:
  - MODIFY `types.ts` — `AgentNamespace.listRoles: () => Promise<string[]>`
  - MODIFY `namespace-builders/agent-namespace.builder.ts` + `agent-namespace.builder.spec.ts`
- Plan reference: implementation-plan.md:216-219, 290-296
- Contract:
  - deps gain `resolveAgentRole?: (workspaceRoot: string, role: string) => Promise<AgentRoleDefinition>` and `listAgentRoles?: (workspaceRoot: string) => Promise<string[]>`
  - `spawn`: after session resolution, before `getProjectGuidance`'s branch split and before any `reserveAgentId`/slot: if `request.role`, `roleDefinition = await resolveAgentRole(getWorkspaceRoot(), request.role)`; if `request.role` and no resolver → named `Error` (same rule as `report`, `:271-283`), no spawn
  - ptah-cli branch: `registry.spawnAgent(..., { ..., role: roleDefinition })` and `spawnFromSdkHandle(handle, { ..., ...(roleDefinition ? { roleStamp: { role: roleDefinition.name, ...PTAH_CLI_ROLE_DELIVERY } } : {}) })` — no `roleStamp` key at all on a role-less spawn; `PTAH_CLI_ROLE_DELIVERY` imported from `@ptah-extension/cli-agent-runtime`
  - rival branch: `enrichedRequest` includes `roleDefinition`
  - `PtahCliRegistryLike.spawnAgent` options gain `role?: AgentRoleDefinition` (`:65-84`)
  - ptah-cli list rows (`:310-319`) spread `...PTAH_CLI_ROLE_DELIVERY` (same as `agent-rpc.handlers.ts` in B4b)
  - deps already type the manager as `AgentProcessManager` (`agent-namespace.builder.ts:90`), so `roleStamp` type-checks with no local type change
  - `listRoles()` → `listAgentRoles?.(getWorkspaceRoot()) ?? []`
- Spec: resolution before either branch; `AgentRoleError` → no `reserveAgentId`, no `spawnFromSdkHandle`, no `agentProcessManager.spawn`; ptah-cli branch passes role and `roleStamp` built from `PTAH_CLI_ROLE_DELIVERY` — preferably overridden with non-default values via `jest.mock('@ptah-extension/cli-agent-runtime', () => ({ ...jest.requireActual('@ptah-extension/cli-agent-runtime'), PTAH_CLI_ROLE_DELIVERY: { roleDelivery: 'native', roleChannel: 'agent-selection' } }))` as `agent-rpc.handlers.list-rows.spec.ts` does, so a hand-typed literal fails; if `requireActual` breaks the harness, assert against the imported constant and say so in the report; role-less ptah-cli spawn has no `roleStamp` key; ptah-cli list rows carry the mocked constant; rival branch `enrichedRequest.roleDefinition`; nested-worktree `workingDirectory` still resolves from `getWorkspaceRoot()` (A4); missing resolver named error; `listRoles()` with and without `listAgentRoles`.

### Task 5a.2: Wire resolver into `PtahApiBuilder` — COMPLETE

- File: MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\vscode-lm-tools\src\lib\code-execution\ptah-api-builder.service.ts`
- Contract: `@inject(CLI_AGENT_RUNTIME_TOKENS.AGENT_ROLE_RESOLVER, { isOptional: true })` next to `AGENT_REPORT_ROUTER` (`:434-435`); `resolveAgentRole` throws a named error when absent; `listAgentRoles` returns `[]` when absent (listing is informational) — pattern `:664-673`.

### Batch B5a verification

- During G4 overlap: `NX_DAEMON=false npx nx run @ptah-extension/vscode-lm-tools:test --testPathPatterns="agent-namespace\.builder|ptah-api-builder\.service" --skip-nx-cache`
- After B5a and B4c both return: `NX_DAEMON=false npx nx run-many -t test,lint,typecheck -p @ptah-extension/cli-agent-runtime @ptah-extension/vscode-lm-tools --skip-nx-cache` (N=2)
- `grep -rn "'system-prompt'" libs/backend/vscode-lm-tools/src --include=*.ts` returns spec lines only
- Reviewer: code-logic-reviewer (ordering, no role-less spawn on any failure)
- Gate record (2026-09-13): code-logic-reviewer run by the conductor, `code-logic-review-b5a.md` (committed with the batch): APPROVE 8/10, 0 blocking, 0 serious. DI registration of `AGENT_ROLE_RESOLVER` confirmed in the vscode, electron and cli-engine roots. Findings and dispositions:
  1. Moderate — `listRoles` propagates a wired resolver's rejection (`no_workspace`, `role_read_failed`). Disposition: handled at the dispatchers, not the namespace; B5b contract amended below (D8 on both dispatchers, explicit).
  2. Minor — role resolution runs before the disabled-CLI / missing-API-key checks, so a bad role is reported first. Error ordering only, no slot taken either way. Disposition: accepted, recorded under follow-ups.
  3. Minor — rival branch forwards `roleDefinition` even when `resumeSessionId` is set. Product question, recorded under follow-ups next to "resume re-applies role".
- Executor deviations, accepted: (a) the spec mocks `@ptah-extension/cli-agent-runtime` as a barrel exposing only `PTAH_CLI_ROLE_DELIVERY` (non-default `native`/`agent-selection`) plus a local `AgentRoleError` look-alike, because `requireActual` loads tsyringe without the reflect polyfill in vscode-lm-tools; the non-default values still fail a hand-typed literal. (b) `request.role !== undefined` (not truthy), so `''` reaches the resolver and fails there instead of silently spawning role-less. (c) caller-supplied `roleDefinition` is stripped from the rival request.
- Team-leader verification on disk: resolution sits after `activeSessionId` and before `getProjectGuidance` and both branches; named error when `role` is set with no resolver; ptah-cli `roleStamp` only when a definition exists; `grep "'system-prompt'\|'preamble'"` over non-spec vscode-lm-tools sources returns nothing; no TODO/STUB markers; `git show --stat e7672c332` = 5 source/spec files + the review, +699/-10. Evidence (conductor): filtered G4 run 2 suites / 49 tests; joint N=2 gate as recorded under B4c. Out of scope, handed to B5b: `stdio-mcp-server.service.spec.ts` `makeAgentApi` (`:52-83`) has no `listRoles`.

## Batch B5b: MCP surfaces — shared strict schema, formatters, parity guard — COMPLETE (commit 7be3259e2)

- Recommended executor: backend-developer (single sub-agent)
- Fallback executor: none; HTTP and stdio must change together for Decision 2
- Execution mode: sequential
- Rationale: the one-schema decision only holds if both dispatchers, the JSON tool schema and the parity guard land in one reviewed commit.
- Tasks: 6 | Depends on: B5a
- Parallel: may run beside B4d (G5). File-disjoint: B5b owns only `libs/backend/vscode-lm-tools/**`. Follow the parallel-lane rule under the full-delivery gate.
- Contract amendment at B5a verify (commit e7672c332), binding on Tasks 5b.3 and 5b.5:
  - **D8 on BOTH dispatchers.** `ptahAPI.agent.listRoles()` may reject when a resolver is wired (`AgentRoleError` `no_workspace` / `role_read_failed`, or any other error). HTTP `ptah_agent_list` and stdio `agent_list` each wrap the call in its own `try/catch (error: unknown)`: on rejection, log a warning naming the error, use `roles = []`, and continue. The list result then carries the "No agent roles generated for this workspace" line (HTTP) and `roles: []` (stdio). A `listRoles` failure never turns the list into a tool error, and an `agent.list()` failure keeps today's error path unchanged. Each dispatcher spec pins: roles present, roles empty, `listRoles` rejecting → list still succeeds + warning logged.
  - **Spec mocks gain `listRoles`.** Add `listRoles: jest.fn().mockResolvedValue([])` to `mcp-stdio/stdio-mcp-server.service.spec.ts` `makeAgentApi` (`:52-83`), and to every agent mock in `mcp-core/protocol-dispatcher.spec.ts` / `mcp-stdio/agent-tool.dispatcher.spec.ts` that reaches a list path. Do not rely on the D8 catch to hide a missing mock.
  - Spawn keeps B5a's order (role resolved before disabled-CLI / API-key checks); do not reorder it in the dispatchers.

### Task 5b.1: `AgentSpawnArgsSchema` — COMPLETE

- File: CREATE `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\agent-spawn-args.schema.ts`
- Contract: exactly the stdio shape at `agent-tool.dispatcher.ts:53-69` (including `MAX_TASK_LENGTH = 100 * 1024`, `cli: z.enum(SYSTEM_CLI_TYPES)`, unbounded non-negative `timeout`) plus `role: z.string().min(1).max(100).optional()`, `.strict()`. Exported with `MAX_TASK_LENGTH`.

### Task 5b.2: `role` in the JSON tool schema — COMPLETE

- Files: `mcp-core/tool-description.builder.ts` + `tool-description.builder.spec.ts`
- Contract: `role` property: the name of an agent role generated for this workspace; `ptah_agent_list` shows valid names; the definition is delivered to the lane and the result reports how; do not paste role templates into `task`. No vendor names. `required` stays `['task']`.

### Task 5b.3: HTTP dispatcher parses with the shared schema — COMPLETE

- Files: `mcp-core/protocol-dispatcher.ts` + `protocol-dispatcher.spec.ts`
- Contract: `case 'ptah_agent_spawn'` (`:730-827`) replaces the cast and the two hand-written checks with `AgentSpawnArgsSchema.safeParse`, failing via `toolErrorResponse` + `describeZodIssues`; forwards `role`; logs `role`; catches `AgentRoleError` → `Error: ptah_agent_spawn role <code>: <message>`; `CliCommandLineTooLongError` → tool error naming sizes. `ptah_agent_list` calls `ptahAPI.agent.listRoles()` (failure → warn + empty) and passes roles to `formatAgentList`. File must not grow materially.
- Spec: role forwarded; each of the 7 `AgentRoleError` codes (incl. `no_workspace`, Task 3.0b) surfaced; unknown key rejected; invalid `cli` rejected; list with roles / no roles / `listRoles` throwing.

### Task 5b.4: Formatters — COMPLETE

- Files: `mcp-core/mcp-response-formatter.ts` + `mcp-response-formatter.spec.ts` (touch `mcp-response-formatter-extra.spec.ts` only if an existing assertion pins the list table exactly)
- Contract: `formatAgentSpawn` adds `**Role:** <name> (<roleDelivery> via <roleChannel>)` when set; `formatAgentStatus` shows the role; `formatAgentList(agents, roles?: string[])` adds `role delivery: <roleDelivery>/<roleChannel>` to each Capabilities cell that has it and one line `Roles in this workspace: a, b` or `No agent roles generated for this workspace`.

### Task 5b.5: stdio dispatcher uses the shared schema — COMPLETE

- Files: `mcp-stdio/agent-tool.dispatcher.ts` + `agent-tool.dispatcher.spec.ts`
- Contract: delete local `AgentSpawnSchema` and `MAX_TASK_LENGTH`, import from `agent-spawn-args.schema.ts`; forward `role`; `structuredContent` adds `role`, `roleDelivery`, `roleChannel` on spawn and `roles` on list; `AgentRoleError` → `toolError(..., 'mcp_tool_failed', { tool: 'agent_spawn', state: code, availableRoles })` (pattern `:396-407`). Same `listRoles` degradation as HTTP.
- Spec: mirror of 5b.3 cases on stdio.

### Task 5b.6: Surface parity guard — COMPLETE

- File: CREATE `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\agent-spawn-surface-parity.spec.ts`
- Contract: key set of `buildAgentSpawnTool().inputSchema.properties` equals `Object.keys(AgentSpawnArgsSchema.shape)`; `buildMcpAgentSpawnTool()` deep-equals `buildAgentSpawnTool()` except `name`.

### Batch B5b verification

- During G5 overlap: `NX_DAEMON=false npx nx run @ptah-extension/vscode-lm-tools:test --testPathPatterns="agent-spawn-args|agent-spawn-surface-parity|tool-description\.builder|protocol-dispatcher|mcp-response-formatter|agent-tool\.dispatcher|stdio-mcp-server|vendor-roster-drift|index\.barrel|agent-namespace\.builder" --skip-nx-cache` (report the `Test Suites: N` line and name each suite)
- After B5b and B4d both return: `npx nx run-many -t test,lint,typecheck -p @ptah-extension/vscode-lm-tools` (N=1), including `vendor-roster-drift.spec.ts`, `stdio-mcp-server.service.spec.ts`, `index.barrel.spec.ts`
- Then the full-delivery gate (5 projects) above
- Reviewer: code-logic-reviewer AND code-style-reviewer (behaviour change on HTTP + schema consolidation)
- Gate record (2026-09-13): code-logic-reviewer run by the conductor, `code-logic-review-b5b.md` (committed with the batch): APPROVE 8/10, 0 blocking, 0 serious, 2 moderate. (1) `AgentRoleError` messages embed absolute local paths and are forwarded verbatim to MCP callers on both surfaces; redaction is a product decision, filed under follow-ups. (2) the JSON tool schema `timeout` description still says "max: 3600000 = 1hr" while the schema has no upper bound; filed under follow-ups. Reviewer confirmed no in-repo caller sends a key outside the strict schema and that `instanceof` narrowing is safe (in-process classes). No separate code-style review of B5b was run; the conductor accepted the logic review as this batch's gate.
- Accepted deviation: stdio maps `CliCommandLineTooLongError` to `state: 'command_line_too_long'` with `measured`/`limit` (beyond the 5b.5 contract, mirrors HTTP 5b.3).
- Team-leader verification on disk: `agent-spawn-args.schema.ts` = stdio shape + `role: z.string().min(1).max(100).optional()`, `.strict()`, exports `MAX_TASK_LENGTH`; stdio local `AgentSpawnSchema`/`MAX_TASK_LENGTH` deleted, shared schema imported; HTTP case uses `safeParse` + `toolErrorResponse` + `describeZodIssues`, forwards and logs `role`, maps `AgentRoleError` and `CliCommandLineTooLongError`, rethrows the rest; `ptah_agent_list` and stdio `agent_list` each wrap `listRoles()` in `try/catch (error: unknown)` → warn + `[]` (D8); stdio `structuredContent` adds `role`/`roleDelivery`/`roleChannel` and `roles`; `role` tool description names no vendor, `required` still `['task']`; `protocol-dispatcher.ts` 2,132 → 2,121. Evidence: conductor filtered 11 suites / 347; joint gate as under B4d (vscode-lm-tools 48 suites / 1,138, lint 0 errors, typecheck green). `git show --stat 7be3259e2` = 13 files (12 vscode-lm-tools + review), +1,186/-115.

## Batch B6: Docs + live e2e evidence — COMPLETE (commit b9ff27c9d)

- Recommended executor: technical-content-writer (docs lane) ∥ senior-tester (e2e lane)
- Fallback executor: senior-tester for both, sequentially
- Execution mode: parallel (2 lanes, disjoint files)
- Rationale: docs and evidence are independent; both read the finished code only.
- Tasks: 2 | Depends on: B4d, B5b

### Task 6.1: Lib CLAUDE.md updates — COMPLETE

- Files:
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\cli-agent-runtime\CLAUDE.md` — role channels per adapter, resolver source (`.claude/agents`, not the consent-gated user layer), budget guard incl. `.cmd` 8,191 branch and its limits (D10 cross-spawn `^` escaping on the fallback path, Linux total `ARG_MAX` and darwin env bytes not modelled), role body frontmatter handling (D3 fix), `no_workspace` (D9), why read-only is not mapped to a sandbox, why frontmatter `model` is ignored, A2 outcome
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\vscode-lm-tools\CLAUDE.md` — one shared spawn schema; HTTP now strict (Decision 2)
- Constraint: these CLAUDE.md files are not VSIX assets, so vendor names are allowed here; the `role` tool-description text itself stays vendor-free.

### Task 6.2: Live e2e + A1/A3 evidence — COMPLETE

- File: CREATE `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\.ptah\specs\TASK_2026_433_d22a\test-report.md`
- Contract: one `ptah_agent_spawn({ cli: <installed argv lane, antigravity preferred>, role: 'code-logic-reviewer', taskFolder, task })` on a scratch task; record result showing `preamble via task-prompt`, the deliverable in `taskFolder` with the role's structure, `ptah_agent_read` showing the role block reached the lane; one codex run for A1/A2 if codex is installed (else record "not installed" as an open item); A3 real Windows `node -e` spawn at limit-1 / limit+1; D10: one real spawn through a `.cmd` wrapper (cross-spawn fallback path) with a space-heavy argument the guard measures just under 8,191, recording whether the OS accepts it or fails with its own "command line is too long"; one `ptah_agent_spawn` with an unknown key on HTTP showing the Zod rejection.
- Acceptance-line mapping: context.md acceptance 1 and 3 close here; acceptance 2 is B8.

### Batch B6 verification

- test-report.md carries the raw tool outputs, not paraphrase
- Reviewer: code-style-reviewer on the CLAUDE.md diffs only; e2e evidence reviewed by the orchestrator
- Gate record (2026-09-13): code-style-reviewer run by the conductor, `code-style-review-b6-b7.md` (committed with B6): APPROVE 7/10, 0 blocking, 1 serious, 2 minor. Serious (stale "Internal Structure" section in `cli-agent-runtime/CLAUDE.md`) fixed before commit; minor "drives" wording in `vscode-lm-tools/CLAUDE.md` fixed to "pinned equal to"; minor stale `timeout` row in `agent-lanes/SKILL.md` §2 is pre-existing, merged into the stale-timeout follow-up. A2 paragraph filled by the conductor from test-report E2/A2 and checked by the reviewer against `codex-cli.adapter.ts:630-637`.
- E2e evidence (test-report.md, Route 1 = this branch's `ptah mcp-serve` over stdio): E1 antigravity + `role: code-logic-reviewer` PASS (`preamble via task-prompt`, deliverable in `taskFolder` follows the role's structure); E2/A1 codex `developer_instructions` PASS; E2/A2 per-run override REPLACES the home value PASS; E3/A3 win32 guard decision matches the OS at 32,766 / 32,767 / 32,768 PASS; E4/D10 confirmed accepted gap (guard PASS at 8,190, cmd.exe rejects, no truncation); E5 stdio unknown-key rejection PASS over the wire, HTTP PASS in-process only (open item). Throwaway `CODEX_HOME` deleted; real `~/.codex` untouched; `.tmp-e2e-433*` dirs deleted.
- Team-leader verification on disk: both CLAUDE.md diffs re-read (Internal Structure corrected, "pinned equal to" present, A2 paragraph matches `codex-cli.adapter.ts:634-636`); test-report carries raw JSON outputs; `git show --stat b9ff27c9d` = 4 files, +653/-3.

## Batch B7: agent-lanes skill routing for `role` — COMPLETE (commit 5b53d2d48)

- Gate history: was BLOCKED on TASK_2026_431 (PR #501). PR #501 merged into `origin/main` on 2026-09-13 (2cc4d8fa7); `agent-lanes/SKILL.md` exists on `origin/main`. Do not cherry-pick 431.
- Precondition: `origin/main` merged into `feat/task-433-role-lanes` with a merge commit (no rebase), while no lane is running. `git merge-tree --write-tree HEAD origin/main` at 7be3259e2 reports no conflicts. The one file both sides touched is `cli-agents/agent-process-manager.restore.spec.ts` (main a58654a26, B4d constructor change); main also changed `vscode-lm-tools/.../vendor-roster-drift.spec.ts` and `lane-rule-single-home.spec.ts`, which read tool descriptions B5b edited. After the merge run `npx nx run-many -t test,typecheck -p @ptah-extension/cli-agent-runtime @ptah-extension/vscode-lm-tools @ptah-extension/shared --skip-nx-cache` (N=3) before any lane starts.
- Parallelism: file-disjoint with B6 (B6 = two lib CLAUDE.md files + test-report.md; B7 = the skill + `content-manifest.json`), so B7 may run beside B6 once the merge is in.
- Conflict guard: branch `refactor/task-435-skill-descriptions` (PR #504) rewrites the `description:` line of `agent-lanes/SKILL.md` frontmatter. B7 changes the BODY only; the frontmatter block stays byte-identical.
- Recommended executor: technical-content-writer
- Execution mode: sequential
- Tasks: 1 | Depends on: `origin/main` merged into this branch (precondition above); B6 is not a hard dependency

### Task 7.1: Skill §2 `role` row, §3 "pass `role`, never paste a template into `task`" — COMPLETE

- Files: MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\apps\ptah-extension-vscode\assets\plugins\ptah-core\skills\agent-lanes\SKILL.md` (post-431) + regenerate `content-manifest.json` via `npm run manifest:generate`
- Constraint: no CLI → capability table in the skill (context.md constraint); capabilities come from `ptah_agent_list`.
- Acceptance: `node scripts/generate-content-manifest.js --check` green.

### Batch B7 verification

- Gate record (2026-09-13): reviewed in the same `code-style-review-b6-b7.md` (APPROVE; SKILL.md 8/10, manifest 10/10). Team-leader verification: diff hunks against HEAD start at line 41 and line 68, so the frontmatter is byte-identical to the merge point 6db3a356f; `node scripts/generate-content-manifest.js --check` → up to date (sha256:0da065b5…, 224 files) before and after the commit hook; conductor ran `lane-rule-single-home`, `vendor-roster-drift` (59) and `skill-sibling-links` (11) green. `git show --stat 5b53d2d48` = 2 files, +8/-3.
- Merge note: `origin/main` has since moved to bd0d15115 (PR #504, TASK_2026_435), which rewrites the `description:` line of this SKILL.md and regenerates `content-manifest.json`. Expect a textual conflict on `content-manifest.json` only (`contentHash`/`generatedAt`); resolve by taking either side and re-running `npm run manifest:generate`, then `--check`. The SKILL.md hunks are disjoint (frontmatter vs body).

## Batch B8: Native role probe (plan Component 8) — DEFERRED

- Not part of this delivery (Decision 1). Scope, cache shape and candidate lanes are as written in implementation-plan.md:255-268.
- Carries the acceptance line: "`ptah_agent_spawn` for a native-capable CLI reports `roleDelivery: native`".
- Depends on: B6. Needs opencode installed and a measured answer on the SDK `agent` option vs Ptah's `{preset, append}` harness prompt before decomposition.

## Out of this delivery (file as follow-ups)

- Resume-from-UI re-applies the recorded role: persist `role` on `CliSessionReference` (`wiring/agent-events.ts` `persistCliSessionReference`, agent-sdk session metadata store) + `role` param on `agent:resumeCliSession`. Blocked by sibling WIP in the main checkout on both files.
- Agent card/tile role + delivery badge; Tribunal lane role picker replacing the `(role)` token grammar; "no roles generated" onboarding hint.
- (LOW, from B2 code-logic-review) `assertCommandLineWithinLimit` with empty `args` (`cli-adapter.utils.ts:287-295`): `indexOfLargest` returns -1, coerced to 0, so the error names "argument 0" when the command string itself overflows. Fix the attribution (e.g. `largestArgIndex: -1` + message naming the command) and add the empty-`args` spec. Unreachable today: every caller passes at least one argument.
- (Product question, from B5a code-logic review) Should a rival spawn that carries `resumeSessionId` re-deliver `role`? Today the namespace forwards `roleDefinition` on resume, so the resumed lane receives the role block again. Decide together with "Resume-from-UI re-applies the recorded role" above: either resume re-applies the recorded role (and a caller-supplied `role` on resume is rejected or must match), or resume ignores `role`.
- (LOW, from B5a code-logic review) Role resolution runs before the disabled-CLI and missing-API-key checks in `AgentNamespace.spawn`, so a caller with both a bad role and a disabled CLI sees the role error first. No slot is taken on either path. Reorder only if a user reports the message order as confusing.
- (LOW, from B3 verify) copilot and pi `runTurn` call `spawnCli` synchronously, so a guard throw on a continuation leaves `continue()` as a synchronous throw instead of a rejected promise. Harmless with the one caller (`continueConversation` awaits inside `try`); tidy by making `runTurn` return `Promise.reject` on a throw if a second caller appears.
- (From PR #505 review) antigravity (`--print`) and copilot (`-p`) carry the whole task prompt in argv, and with a role that prompt now includes the role body. Task, system prompt and project guidance were already there before this task; role bodies are workspace-committed files, not credentials. Moving both prompts to stdin (agy `--input-format stream-json`, copilot equivalent) needs an installed-version probe first and would also lift the argv budget.
- (Decision needed, from B5b code-logic review) `AgentRoleError` messages carry the absolute harness root path and are forwarded verbatim to MCP callers on HTTP and stdio. Decide whether to redact to a workspace-relative path (e.g. `.claude/agents`) before surfacing; the caller is a local agent today, but gateway-bridged sessions can relay tool errors off-machine.
- (LOW, from B5b code-logic review) `buildAgentSpawnTool` `timeout` description still says "max: 3600000 = 1hr"; the shared schema has no upper bound (inactivity window, `0` disables). Rewrite the description to match; update `tool-description.builder.spec.ts` if it pins the text.
- (LOW, from B4d code-style review) the timer unref guard is duplicated between `AgentOutputBuffer.scheduleFlush` and the manager's `unrefTimer`. Extract one shared helper when either copy next changes.
- (LOW, from B4d code-style review) log prefixes and Sentry `errorSource` in the moved code still say `AgentProcessManager` (kept byte-identical by the B4d invariant). One rename pass to `AgentSpawnEnvironment` / `AgentOutputBuffer`, with any log-assertion specs updated in the same commit.

## Completion (Mode 3, 2026-09-13)

### Final summary

| Batch | Name | Commit |
| --- | --- | --- |
| B1 | Role contract types | 0714d36c4 |
| B2a | `AgentRoleResolver` | 7fdcc73d9 |
| B2b | Role prompt assembly + command-line guard | c0ecc1644 |
| B3 | Adapter role channels + detection stamp | 248276a6f |
| B4a | ptah-cli system-prompt delivery | f7f93baf6 |
| B4b | Manager plumbing + list-row stamp | b0ab33b48 |
| B4c | `doSpawnSdk` options object | 3e32135b2 |
| B4d | Facade split of the agent process manager | 84ff943bc |
| B5a | Namespace role resolution + API builder wiring | e7672c332 |
| B5b | Shared strict schema on both MCP surfaces | 7be3259e2 |
| B6 | Lib docs + live e2e evidence | b9ff27c9d |
| B7 | agent-lanes skill `role` routing | 5b53d2d48 |
| B8 | Native role probe | DEFERRED |

Every SHA verified with `git merge-base --is-ancestor <sha> HEAD`. Key files verified on disk (resolver, detection spec, ptah-cli role spec, list-rows spec, both collaborators, `tracked-agent.ts`, DI smoke spec, shared schema, parity spec). `wiring/agent-events.ts` and agent-sdk `session-metadata-store.ts` show no diff between `origin/main` at the merge (6db3a356f^2) and HEAD. origin/main was merged at 6db3a356f.

### Full-delivery gate (Mode 3)

`NX_DAEMON=false npx nx run-many -t test,lint,typecheck -p @ptah-extension/shared @ptah-extension/cli-agent-runtime @ptah-extension/vscode-lm-tools @ptah-extension/rpc-handlers @ptah-extension/tribunal-panel @ptah-extension/cli-engine @ptah-extension/harness-sync @ptah-extension/agent-generation --skip-nx-cache` at 5b53d2d48. The project list was widened from 5 to 8 because of the merge: cli-engine is a DI root for `AGENT_ROLE_RESOLVER`, and main changed harness-sync and agent-generation. Header: `Running targets test, lint, typecheck for 8 projects`, then `Successfully ran targets test, lint, typecheck for 8 projects`, EXIT 0.

| Project | Suites | Tests | Lint | Typecheck |
| --- | --- | --- | --- | --- |
| shared | 57 | 1,398 passed | 0 errors (2 warnings) | green |
| cli-agent-runtime | 60 | 905 passed + 1 skipped | 0 errors (38 warnings) | green |
| vscode-lm-tools | 49 | 1,151 passed | 0 errors (21 warnings) | green |
| rpc-handlers | 99 | 2,987 passed + 33 skipped | 0 errors (19 warnings) | green |
| tribunal-panel | 16 | 333 passed | 0 errors | green |
| cli-engine | 17 | 173 passed | 0 errors (2 warnings) | green |
| harness-sync | 46 | 384 passed | 0 errors (1 warning) | green |
| agent-generation | 32 | 1,027 passed | 0 errors (430 warnings) | green |

The agent-generation user-layer flake from the earlier post-merge run (it failed once under parallel load and passed 9/9 suites alone) did not recur in this run.

### Acceptance criteria

| Criterion (context.md / task.md) | Status | Evidence |
| --- | --- | --- |
| `ptah_agent_spawn({ cli: antigravity, role, task })` produces a lane whose first turn follows the role contract (deliverable in `taskFolder`) and the result reports `roleDelivery` | MET | test-report E1: `role: code-logic-reviewer`, `preamble via task-prompt`, `REVIEW_OUTPUT.md` in `taskFolder` with the role's structure. Role used was code-logic-reviewer, not frontend-developer (the B6 contract picked a reviewer role for a checkable deliverable) |
| Same call for a native-capable CLI reports `native` | MOVED TO DEFERRED (B8) | Decision 1: v1 is preamble-only on every lane |
| Unit specs per adapter | MET | B3: `roleChannel` + role and no-permission-drift specs in all 6 adapter specs; B4a ptah-cli role spec + 64 KiB argv/env probe |
| One e2e with a real installed CLI recorded in this folder | MET | `test-report.md` (antigravity 1.2.2, codex-cli 0.153.4, via this branch's `ptah mcp-serve`) |
| Unknown role → hard error listing roles, never a role-less spawn | MET | B2a/B3 `AgentRoleError` (7 codes, `availableRoles`); B5a named error when no resolver; B5b both surfaces map every code |
| Resolution from the workspace's generated agent definitions | MET | `{harnessRoot}/.claude/agents/<role>.md` (B2a), D9 `no_workspace` guard (B3) |
| Result reports delivery | MET | `role`/`roleDelivery`/`roleChannel` on spawn result, status and list rows (B4b, B5b) |
| `ptah_agent_list` reports roles per lane | MET (v1 form) | list rows carry `roleDelivery`/`roleChannel`; list shows the "Roles in this workspace" line; native per-lane capability is B8 |
| Both MCP surfaces expose the parameter identically | MET, with one OPEN part | one strict `AgentSpawnArgsSchema` + `agent-spawn-surface-parity.spec.ts`; stdio rejection proven over the wire, HTTP proven in-process only (open: over-the-wire HTTP e2e) |
| No new RPC namespace without dual registration | MET | no RPC namespace added (B4b list-row stamp only) |
| No CLI → capability table in skills or tool descriptions | MET | `role` tool description is vendor-free; `vendor-roster-drift.spec.ts` green; skill defers to `ptah_agent_list` |
| Skill routing: pass `role`, never paste templates into `task` | MET | B7 agent-lanes §2 row + §3 rule |
| Tribunal UI redesigned around `role` | OPEN (follow-up) | out of this delivery; see UI follow-ups |

### Consolidated follow-ups

Decisions for the user:
1. Codex role replaces vs merges the user's `~/.codex/config.toml` `developer_instructions`. v1 ships REPLACE (documented in `cli-agent-runtime/CLAUDE.md`, measured in test-report E2/A2). Follow-up: "merge as opt-in", pending the user's decision.
2. Role-error path redaction: `AgentRoleError` messages carry the absolute harness root and reach MCP callers verbatim on both surfaces. Gateway-bridged sessions can relay them off-machine.
3. Should resume re-apply the role? A rival spawn with `resumeSessionId` re-delivers `role` today. Decide together with persisting `role` on `CliSessionReference` for UI resume, which is blocked on sibling WIP in `wiring/agent-events.ts` and the agent-sdk session metadata store.

Evidence gaps:
4. Over-the-wire HTTP e2e for `ptah_agent_spawn` unknown-key rejection (proven in-process only). Needs a VS Code or Electron host running this branch.
5. D10 `.cmd` caret gap: the guard under-measures the cmd.exe line on the cross-spawn `.cmd` fallback. Confirmed live in E4. The OS error fires, with no truncation, but it is not the named error. Model the `^` escaping if it matters.

Code tidy-ups (LOW):
6. Stale `timeout` description ("max: 3600000 = 1hr") in `tool-description.builder.ts` AND "default and maximum one hour" in agent-lanes SKILL.md §2. The schema has no upper bound. Fix both in one commit.
7. Shared timer unref helper (`AgentOutputBuffer.scheduleFlush` and the manager's `unrefTimer` duplicate it).
8. Log-prefix and Sentry `errorSource` rename in the moved B4d code (`AgentProcessManager` → `AgentSpawnEnvironment` / `AgentOutputBuffer`).
9. Empty-`args` guard message: `largestArgIndex` -1 is coerced to 0, so the error names "argument 0" when the command string overflows. Add an empty-`args` spec.
10. copilot/pi `runTurn` throws synchronously from `continue()` when the guard fires on a continuation. Return a rejected promise instead.
11. Role resolution runs before the disabled-CLI and API-key checks (error ordering only).

UI follow-ups:
12. Tribunal UI passes `role` per lane (replace the `(role)` token grammar).
13. Agent tiles and cards show `role` / `roleDelivery` / `roleChannel`, plus a "no roles generated" onboarding hint.

Deferred batch:
14. B8 native role probe (ptah-cli SDK `agent` option, opencode `--agent`). Carries acceptance "reports `native`".

Merge note: `origin/main` is at bd0d15115 (PR #504), past the merge point. Expect a `content-manifest.json` conflict; re-run `npm run manifest:generate` and `--check`. The SKILL.md hunks do not overlap (frontmatter vs body).
