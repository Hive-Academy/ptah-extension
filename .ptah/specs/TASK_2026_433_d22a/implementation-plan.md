# Implementation Plan - TASK_2026_433

Role-addressed CLI lanes: `ptah_agent_spawn({ role })` runs a lane as a workspace-generated agent role.

## Inputs and constraints

- Requirements used: `task.md`, `context.md`, `research-report.md`, `research/lane-*.md` (all in this folder); `origin/refactor/task-431-agent-lanes:apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/agent-lanes/SKILL.md`; `origin/fix/task-432-template-grants:.ptah/specs/TASK_2026_432_f208/implementation-report.md`.
- Instruction files: root `CLAUDE.md`, `libs/backend/{cli-agent-runtime,vscode-lm-tools,harness-sync,agent-generation}/CLAUDE.md`.
- Corrections applied: research-report findings that the code contradicts. See "Research corrections" at the end.
- Design handoff used: none (no UI in v1; UI follow-ups listed, per the user directive that UI follows the design).
- Missing decision-critical input: no `task-description.md`. `context.md` "Acceptance" is used as the acceptance set. Consequence: acceptance bullet 2 ("a native-capable CLI reports `native`") cannot be met in v1, because the research DECISION makes native opt-in behind a probe and this plan defers the probe (Component 8). v1 reports `native` for no lane. The orchestrator should confirm this reading.

## Codebase evidence

| Evidence | Location | Architectural implication |
| --- | --- | --- |
| `ptah_agent_spawn` schema has no `role`; `required: ['task']` | `vscode-lm-tools/.../mcp-core/tool-description.builder.ts:494-590` | Add `role` once here; both surfaces read this builder. |
| stdio surface re-uses the same builder, only renames to `agent_spawn` | `mcp-stdio/tool-builders.ts:53-55` | JSON schema parity is automatic. Zod parity is not. |
| stdio validates spawn args with a strict Zod schema | `mcp-stdio/agent-tool.dispatcher.ts:53-69` | Unknown key `role` is rejected today on stdio. |
| HTTP surface casts args with NO Zod, silently drops unknown keys | `mcp-core/protocol-dispatcher.ts:730-811` | Today `role` would be dropped silently on HTTP. One shared schema is required. |
| message/report schemas are duplicated per surface with a "same shape" comment | `protocol-dispatcher.ts:424-445`, `agent-tool.dispatcher.ts:82-107` | Precedent is duplication; this plan replaces it for spawn with one exported schema. |
| MCP enrichment point: namespace builder resolves session, guidance, `systemPrompt`, then branches ptah-cli vs rival CLI | `namespace-builders/agent-namespace.builder.ts:154-253` | Role resolution belongs here, once, before the branch. |
| ptah-cli branch passes `projectGuidance` only, never `systemPrompt` | `agent-namespace.builder.ts:183-195` | A role folded into `systemPrompt` would never reach ptah-cli. |
| `systemPrompt` is the enhanced-prompt harness content | `ptah-api-builder.service.ts:619-627`; `agent-namespace.builder.ts:233-250` | Role must be a separate field. It must not replace the harness. |
| `buildTaskPrompt` = `systemPrompt \|\| projectGuidance`, `---`, tool policy, task, files, taskFolder | `cli-agent-runtime/.../cli-adapters/cli-adapter.utils.ts:357-379` | Single preamble assembly point for 5 adapters. |
| Adapters with a native channel strip fields before `buildTaskPrompt` | `cli-adapter.utils.ts:349-355` (doc comment) | Precedent for codex: strip `role`, send it on its own channel. |
| `CliCommandOptions` has `systemPrompt`, `projectGuidance`, `agentId`; no role | `cli-adapter.interface.ts:22-55` | Add `role?: AgentRoleDefinition`. |
| `CliAdapter.capabilities()` is REQUIRED so a new adapter cannot skip it | `cli-adapter.interface.ts:160-165`, `:129-142` | Precedent for a required role-channel declaration. |
| `doSpawnSdk` builds `CliCommandOptions` from the request | `agent-process-manager.service.ts:460-533` (runSdk args `:503-521`) | Forward `role` here; stamp record fields on `AgentProcessInfo` (`:474-488`). |
| `spawnFromSdkHandle` receives a finished handle plus `meta` | `agent-process-manager.service.ts:543-612` | Role is already baked into the ptah-cli handle; `meta` only carries record fields. |
| codex: `config` object built, `new sdk.Codex`, task via `buildTaskPrompt` | `codex-cli.adapter.ts:602-632`, `:658`, `:684` | `config.developer_instructions` is the codex channel. |
| codex-sdk serializes `config` into argv `--config k=<JSON string>`; task goes to stdin | `node_modules/@openai/codex-sdk/dist/index.js:174-179`, `:252-263`, `:306-345`; SDK `0.147.0` | Role on codex is subject to the OS command-line cap. |
| copilot passes the whole prompt as argv `-p <prompt>` | `copilot-sdk.adapter.ts:312-319`, `:459` | Argv cap applies to copilot too. |
| opencode passes the prompt as a trailing positional argv | `opencode-cli.adapter.ts:406`, `:427` | Argv cap applies. |
| antigravity passes the prompt as `--print <prompt>`; writes the HOME MCP entry BEFORE building argv | `antigravity-cli.adapter.ts:441`, `:455`, `:481`, `:492` | A budget failure must be detected before the MCP side effect. |
| Direct spawn exists because `cmd.exe` caps at 8,191 and CreateProcess at ~32 KB | `cli-adapter.utils.ts:428-441` | The limit is already a known, documented constraint. |
| cursor runs in-process (`Agent.create` / `agent.send`) | `cursor-cli.adapter.ts:285`, `:346`, `:354` | No argv cap. |
| pi writes the prompt as JSONL on stdin | `pi-cli.adapter.ts:24-25`, `:317-327`, `:499` | No argv cap. |
| Every argv spawn goes through `spawnCli` | `cli-adapter.utils.ts:247-277` | One chokepoint for a command-line budget guard. |
| ptah-cli system prompt = `assembleSystemPrompt` + `## Project Guidance` | `ptah-cli/helpers/ptah-cli-spawn-options.service.ts:147-181` | Role section is appended here. |
| ptah-cli sends it as `systemPrompt` string or `{preset, append}` | `ptah-cli/ptah-cli-registry.ts:752-760` | Both modes carry the appended role. |
| SDK system prompt travels on stdin in the `initialize` control request | `claude-agent-sdk/sdk.d.ts:2809-2815`; pinned by `ptah-cli-registry-auto-compact-argv.spec.ts:485-488` | No argv cap on ptah-cli. |
| Claude Agent SDK `0.3.150` has `Options.agent` (main-thread agent: its prompt, tool limits and model apply) and inline `agents` | `sdk.d.ts:1227-1261`, `AgentDefinition` `:38-110` | The one documented root-role selector. It is a native candidate for Component 8, not v1. |
| `PtahCliRegistryLike` duplicates `spawnAgent` options in vscode-lm-tools | `agent-namespace.builder.ts:65-84` | Both declarations change together. |
| Generated agents are written to `{ws}/.claude/agents/<role>.md` | `agent-generation/CLAUDE.md:7`, `:22-25` | This is the generation output. |
| `{ws}/.claude/agents` is source-managed truth; the user layer mirrors FROM it; the mirror is consent-gated | `harness-sync/CLAUDE.md:28`, `:110-113`, `:349-353`, `:360-378` | Resolve roles from `.claude/agents`. The user-layer clone can be absent when consent is closed. |
| Mirror enumerates top-level `*.md` files only | `agent-generation/.../user-layer-mirror.service.ts:1307-1308` | Resolver uses the same rule, so the role set matches native files. |
| `resolveHarnessWorkspaceRoot` maps a sub-package cwd to the harness root | `harness-sync/src/lib/workspace/workspace-root.ts:66-78`; exported `harness-sync/src/index.ts:86` | Resolver anchors on the same root harness-sync uses. |
| `stripFrontmatter`, `extractFrontmatterDescription`, `transformAgentBody(content, cli)` exported | `harness-sync/src/index.ts:155-161`; `transform-rules.ts:237-241`, `:362-369` | Preamble body is the same bytes the native targets get. |
| cli-agent-runtime → harness-sync is the allowed one-way dependency | `cli-agent-runtime/CLAUDE.md` Dependencies; `harness-sync/CLAUDE.md:149` | Resolver may live in cli-agent-runtime and import harness-sync. |
| codex transformer omits `model` (Claude aliases are not codex models) | `codex-agent-transformer.ts:1-12` | Role frontmatter `model` is never applied to a lane. |
| codex transformer maps `/reviewer$/` to `sandbox_mode = "read-only"` for DELEGATED children | `codex-agent-transformer.ts:45-48`, `:80-82` | Not transferable to a root lane that must write a deliverable file. |
| Named-error precedent carrying a machine code across both surfaces | `agent-message-router.service.ts:47-55`; `protocol-dispatcher.ts:874-886`; `agent-tool.dispatcher.ts:396-407` | `AgentRoleError` follows it. |
| DI token + lazy optional resolve into namespace deps | `cli-agent-runtime/src/lib/di/tokens.ts`, `register.ts:43-52`; `ptah-api-builder.service.ts:434-435`, `:664-673` | Resolver wiring follows `AGENT_REPORT_ROUTER`. |
| ptah-cli list rows are built in two places | `agent-namespace.builder.ts:310-319`; `rpc-handlers/.../agent-rpc.handlers.ts:833-842` | Both stamp the role channel. |
| Detection stamps `messagingMode` centrally on the error branch | `cli-detection.service.ts:100-128` | Role channel is stamped centrally for every result. |
| Tool descriptions must not name vendors | `vscode-lm-tools/.../vendor-roster-drift.spec.ts:77-81` | `role` description names no CLI. |
| Only spawn surface is MCP; RPC has `agent:resumeCliSession` only; no cli-engine agent parity site | `agent-rpc.handlers.ts:760-812`; grep of `libs/backend/cli-engine/src` for `agent:` returned nothing | No new RPC method. No dual registration. |
| Real role sizes on this repo | `.claude/agents/*.md`: 9,487 to 23,407 bytes, 214,245 total | Drives the budget rules in Component 3. |

## Architecture decision

- Chosen approach: resolve `role` once, at the MCP enrichment point, from `{harnessRoot}/.claude/agents/<role>.md`. Carry it as a typed `AgentRoleDefinition` through `SpawnAgentRequest` → `CliCommandOptions` / ptah-cli spawn options. Each adapter declares its role channel. v1 delivers every role as a preamble through that channel: `task-prompt` for 5 adapters, `developer-instructions` for codex, `system-prompt` for ptah-cli. Report `role`, `roleDelivery` and `roleChannel` on the spawn result, the agent record and `ptah_agent_list`. Enforce the OS command-line budget at the spawn chokepoint. Never truncate.
- Rationale: one resolver and one assembly point cover all 7 lanes. The body is the file Claude subagents read, so "role is what the work needs, lane is who runs it" holds byte for byte. The preamble default follows the research DECISION: the live probes showed `agy --agent` and `copilot --agent` ignored silently.
- Rejected alternatives:
  - Fold the role into `systemPrompt` (research-report "What the code already offers"). Loses: `systemPrompt` is the harness prompt, so the role would replace or be concatenated into it. The ptah-cli branch never receives `systemPrompt` (`agent-namespace.builder.ts:183-195`).
  - Resolve from the user-layer clone `~/.ptah/user/agents/<key>/`. Loses: it is consent-gated and absent until the wizard opens the gate (`harness-sync/CLAUDE.md:360-378`). Role lanes would fail in workspaces where Claude subagents work. It is also a derived copy of `.claude/agents`.
  - Resolve inside `AgentProcessManager.doSpawn`. Loses: the ptah-cli handle and its system prompt are built before `spawnFromSdkHandle` (`agent-namespace.builder.ts:183-217`), so the manager is too late for that lane.
  - Native in v1 for opencode or ptah-cli. Loses: opencode is not installed, and its evidence is source-reading only. The SDK `agent` option's interaction with Ptah's `{preset, append}` harness prompt is unmeasured: it may drop the MCP guidance. Both need the probe, so both are deferred (Component 8).
  - Map reviewer read-only intent to codex `sandbox_mode` / opencode permissions (research rec. 5). Loses: every role's contract writes a deliverable file (`code-logic-review.md` etc.). A read-only root sandbox makes the lane fail its own contract. The transformer's read-only is for delegated children whose parent writes.
- Assumptions (each with the check that resolves it):
  - A1: codex `exec --config developer_instructions="…"` is accepted by the installed codex binary and adds to the built-in instructions. Check: Component 4 marker test in the live e2e, plus a codex `--experimental-json` event capture showing the marker obeyed.
  - A2: a `developer_instructions` in the user's `~/.codex/config.toml` is overridden for that run, not merged. Check: the same run with a home-config value set. If it is merged, nothing changes. If it is overridden, document it in the lib CLAUDE.md.
  - A3: libuv's Windows argument quoting (backslash and quote escaping, outer quotes when the arg has spaces) is the right model for the command-line length. Check: a Windows spec spawns `node -e` with a measured argv at limit−1 and limit+1.
  - A4: `resolveHarnessWorkspaceRoot(getWorkspaceRoot())` equals the root whose `.claude/agents` Claude subagents use, including worktree lanes. The role is resolved from the caller's workspace root, not the lane's `workingDirectory`. Check: namespace-builder spec with `workingDirectory` set to a nested worktree path.
- Effect on existing code:
  - Replaced: HTTP `ptah_agent_spawn` ad-hoc casting and stdio `AgentSpawnSchema` → one exported strict schema. HTTP now REJECTS unknown keys, which is a behaviour change.
  - Extended in place: `buildTaskPrompt`, `CliCommandOptions`, `CliAdapter`, `SpawnAgentRequest`/`SpawnAgentResult`/`AgentProcessInfo`/`CliDetectionResult`, `PtahCliRegistry.spawnAgent` options, `assembleSpawnOptions`.
  - New guard: an oversized argv spawn now fails with a named error before launch instead of an OS spawn error. This applies to role-less spawns too.
  - Left alone: harness-sync transformers and targets, agent-generation, the consent gates, messaging, the report router.

## Component specifications

### 1. Role contract types

- Purpose: the cross-lib data shape for a role and how it was delivered.
- Responsibilities (all in `agent-process.types.ts`):
  - `AgentRoleDefinition { name; description?: string; body: string; sourcePath: string; bytes: number }`. `body` has the frontmatter stripped and is untransformed. Adapters apply the CLI rewrite.
  - `AgentRoleDelivery = 'preamble' | 'native'`.
  - `AgentRoleChannel = 'task-prompt' | 'developer-instructions' | 'system-prompt' | 'agent-selection'`. `agent-selection` is reserved for Component 8 and unused in v1.
  - `SpawnAgentRequest`: `role?: string` (caller-set) and `roleDefinition?: AgentRoleDefinition`, documented "Injected by MCP server, NOT set by callers", same as `systemPrompt` at `:133-135`.
  - `SpawnAgentResult` and `AgentProcessInfo`: `role?`, `roleDelivery?`, `roleChannel?`.
  - `CliDetectionResult`: `roleDelivery`, `roleChannel`.
- Verified contracts and entry points: `libs/shared/src/lib/types/agent-process.types.ts:75-105` (`AgentProcessInfo`), `:107-149` (`SpawnAgentRequest`), `:161-172` (`SpawnAgentResult`), `:211-238` (`CliDetectionResult`).
- Dependencies: none. `libs/shared` is the bridge; the frontend reads `AgentProcessInfo`, and every new field is optional or additive.
- Integration points: every component below.
- Failure behaviour: types only.
- Quality requirements: no `node:` imports (shared reaches the webview, `user-layer-agents.ts` header).
- Verification seam: `nx run-many -t typecheck` across shared + consumers.
- Files: MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\shared\src\lib\types\agent-process.types.ts`; MODIFY the shared barrel only if these names are not already re-exported by the types barrel. Verify with a grep for `SpawnAgentResult` in `libs/shared/src/index.ts` and its type barrels.

### 2. AgentRoleResolver

- Purpose: turn a role name into an `AgentRoleDefinition` for a workspace, or a named error.
- Responsibilities:
  - `listRoles(workspaceRoot): Promise<string[]>`. Top-level `isFile()` entries ending `.md` in `{resolveHarnessWorkspaceRoot(workspaceRoot)}/.claude/agents`, basename minus `.md`, sorted. A missing directory returns `[]`.
  - `resolve(workspaceRoot, role): Promise<AgentRoleDefinition>`. Validate the name against `^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$`. Match it EXACTLY against `listRoles`, case-sensitive; never join raw input into a path before the match. Read the file, then `stripFrontmatter` and `extractFrontmatterDescription` (harness-sync barrel). Reject an empty trimmed body. Reject bodies over `MAX_ROLE_BYTES` = 64 KiB (largest real role 23,407 bytes, so about 2.7× headroom).
  - `AgentRoleError extends Error { code: 'invalid_role_name' | 'no_roles' | 'unknown_role' | 'empty_role' | 'role_too_large' | 'role_read_failed'; availableRoles: string[] }`. The message names the workspace root and lists the available roles. `no_roles` says the setup wizard generates them and that spawning without `role` is valid.
  - Reads are fresh on every call (no cache). A regenerated agent is picked up immediately, same rule as the manifest stores in `cli-agent-runtime/CLAUDE.md`.
- Verified contracts and entry points: `harness-sync/src/index.ts:86` (`resolveHarnessWorkspaceRoot`), `:155-161` (`stripFrontmatter`, `extractFrontmatterDescription`); `user-layer-mirror.service.ts:1307-1308` (enumeration rule); `agent-message-router.service.ts:47-55` (error precedent).
- Dependencies: → `@ptah-extension/harness-sync` barrel (allowed direction). File IO through `PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER` (`platform-core/src/di/tokens.ts:13`; `readFile`/`readDirectory` at `file-system-provider.interface.ts:22`, `:46`), per the hexagonal rule. `agent-generation` already injects it (`analysis-storage.service.ts:59`).
- Integration points: registered as `CLI_AGENT_RUNTIME_TOKENS.AGENT_ROLE_RESOLVER` in `registerCliAgentRuntimeServices`, following `AGENT_REPORT_ROUTER` at `register.ts:43-52`. Exported from the lib barrel with `AgentRoleError`, like `AgentMessageError` (`cli-agents/index.ts:22-27`).
- Failure behaviour: every failure throws `AgentRoleError`. Nothing falls back to a role-less spawn. A `readFile` failure after a successful listing becomes `role_read_failed` with the underlying `instanceof Error` message.
- Quality requirements: security — no path is built from unvalidated input; a traversal name (`../x`) fails `invalid_role_name` before any filesystem call. Performance — one `readDirectory` plus one `readFile` per spawn.
- Verification seam: unit spec with a fake `IFileSystemProvider`. Cases: missing dir, empty dir, unknown role listing the available ones, traversal name, case mismatch, frontmatter-only file, 64 KiB+1 body, CRLF body, sub-package `workspaceRoot`.
- Files:
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\cli-agent-runtime\src\lib\roles\agent-role-resolver.service.ts`
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\cli-agent-runtime\src\lib\roles\agent-role-resolver.service.spec.ts`
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\cli-agent-runtime\src\lib\roles\index.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\cli-agent-runtime\src\lib\di\tokens.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\cli-agent-runtime\src\lib\di\register.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\cli-agent-runtime\src\index.ts`

### 3. Role prompt assembly and command-line budget

- Purpose: one definition of how a role reads in a prompt, and one guard against OS command-line overflow.
- Responsibilities:
  - `CliCommandOptions.role?: AgentRoleDefinition`.
  - `CliAdapter.roleChannel: AgentRoleChannel`, required readonly, same enforcement rationale as `capabilities()`.
  - `renderRoleBlock(role, cli)`. Output: `## Role: <name>`, then one sentence ("You are running as the `<name>` role; the definition below governs this task and outranks any generic persona above."), then the body. The body goes through `transformAgentBody(content, cli)` when `cli` is a harness `CliTarget` (codex, copilot, cursor, antigravity), so a preamble and a native file carry the same rewrites. Otherwise (opencode, pi, ptah-cli) it is the stripped body unchanged.
  - `buildTaskPrompt` order becomes: system context (unchanged rule, `systemPrompt || projectGuidance`) → `---` → role block when `options.role` is present → `---` → tool policy, task, files, taskFolder. An adapter that delivers the role on another channel passes `{ ...options, role: undefined }`, following the precedent at `:349-355`.
  - `assertCommandLineWithinLimit(command, args)`, called first inside `spawnCli`:
    - win32: libuv-quoted length of `command + args` ≤ 32,767 UTF-16 units.
    - linux: each arg ≤ 131,071 bytes.
    - darwin: sum of arg bytes ≤ 1,048,576 − 4,096 reserve.
    - Throws `CliCommandLineTooLongError { measured, limit, largestArgIndex }`. The message names the largest arg and its size, and says the prompt is not truncated. It lists two remedies: shorten the task, or use a lane whose channel does not use argv.
- Verified contracts and entry points: `cli-adapter.utils.ts:247-277` (`spawnCli`), `:357-379` (`buildTaskPrompt`), `:428-441` (limit rationale); `cli-adapter.interface.ts:22-55`, `:148-186`; `harness-sync/src/index.ts:160` (`transformAgentBody`).
- Dependencies: Component 1 types; harness-sync barrel.
- Integration points: all 6 adapters (Component 4); `ptah-cli-spawn-options` reuses `renderRoleBlock` (Component 6).
- Failure behaviour: the budget error is thrown synchronously before any process exists. Truncation never happens, silent or otherwise. The role block is all-or-nothing.
- Quality requirements: the guard adds no process spawn and costs O(total arg length).
- Verification seam: `cli-adapter.utils.spec.ts`. Cases: section order with and without system context/role, delimiter text pinned, `transformAgentBody` applied for a CliTarget and skipped for `pi`, guard at limit−1/limit/limit+1 per platform branch (platform injected, not global), quoting cost of `"` and trailing `\`.
- Files:
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\cli-adapter.utils.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\cli-adapter.utils.spec.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\cli-adapter.interface.ts`

### 4. Per-adapter role delivery (v1)

- Purpose: each adapter declares its channel and delivers `options.role` on it.
- Responsibilities (per adapter):

  | Adapter | `roleChannel` | Delivery | Transport cap |
  | --- | --- | --- | --- |
  | codex | `developer-instructions` | `config.developer_instructions = renderRoleBlock(role,'codex')`; `buildTaskPrompt({...options, role: undefined})` | argv via SDK `--config` → the adapter runs `assertCommandLineWithinLimit` on the serialized override (JSON-escaped) before `new sdk.Codex`, because SDK spawns bypass `spawnCli` |
  | copilot | `task-prompt` | via `buildTaskPrompt` | argv `-p` → `spawnCli` guard |
  | antigravity | `task-prompt` | via `buildTaskPrompt` | argv `--print` → guard. Build args and resolve the spawn descriptor, then run the guard BEFORE `configureMcpServer`, so a rejected spawn leaves the HOME MCP entry untouched |
  | opencode | `task-prompt` | via `buildTaskPrompt` | argv positional → guard |
  | cursor | `task-prompt` | via `buildTaskPrompt` | in-process, none |
  | pi | `task-prompt` | via `buildTaskPrompt` | stdin, none |

  - Continuation turns (`continue(message)`) do not re-send the role. The first turn's history carries it on task-prompt lanes, and codex keeps its `config` for the handle's lifetime.
  - Resume spawns that carry `role` deliver it again. This duplicates it in history on task-prompt lanes. It is accepted: dropping it would make a resumed lane's role depend on an unverifiable earlier turn.
  - No sandbox or permission change from a role. Explicit `model` and `reasoningEffort` handling is unchanged. Role frontmatter `model` is never read.
- Verified contracts and entry points: `codex-cli.adapter.ts:602-632`, `:658`; `copilot-sdk.adapter.ts:312-319`, `:459`; `antigravity-cli.adapter.ts:441`, `:455-492`; `opencode-cli.adapter.ts:406-427`; `cursor-cli.adapter.ts:285`; `pi-cli.adapter.ts:499`; codex-sdk `index.js:174-179`, `:306-345`.
- Dependencies: Component 3.
- Integration points: `CliDetectionService` reads `adapter.roleChannel` (Component 5).
- Failure behaviour: a budget error rejects `runSdk` before any side effect. antigravity must NOT leave a written MCP entry. codex surfaces the named error, not a codex-sdk spawn failure.
- Quality requirements: security — none added. The role body is workspace content the user's own Claude subagents already execute.
- Verification seam: each adapter spec asserts channel placement with a fake SDK or spawner: role block in `-p`/`--print`/positional/`send(prompt)`/stdin JSONL; codex `config.developer_instructions` set and absent from the thread input; ordering after the harness context. antigravity spec: an oversized role rejects and `configureMcpServer` is never called. codex spec: an oversized role rejects before `sdk.Codex` is constructed.
- Files:
  - MODIFY each adapter and its spec in `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\`: `codex-cli.adapter.ts` / `.spec.ts`, `copilot-sdk.adapter.ts` / `.spec.ts`, `antigravity-cli.adapter.ts` / `.spec.ts`, `opencode-cli.adapter.ts` / `.spec.ts`, `cursor-cli.adapter.ts` / `.spec.ts`, `pi-cli.adapter.ts` / `.spec.ts`.

### 5. Manager and detection plumbing

- Purpose: carry the role from request to adapter and onto the record; expose the channel in listings.
- Responsibilities:
  - `doSpawnSdk`: pass `role: request.roleDefinition` into `runSdk`. Stamp `role`, `roleDelivery: 'preamble'` and `roleChannel: adapter.roleChannel` on `AgentProcessInfo` and the returned result. Add `role` to the spawn log lines. `doSpawn` passes the adapter's channel in.
  - `spawnFromSdkHandle`: `meta` gains `role?`, `roleDelivery?`, `roleChannel?`, copied to the record only.
  - `CliDetectionService.doDetectAll`: stamp `roleDelivery: 'preamble'` and `roleChannel: adapter.roleChannel` on every result, success and error branch.
  - ptah-cli list rows (namespace builder, `agent-rpc.handlers.ts` `mergePtahCliAgents`): `roleDelivery: 'preamble'`, `roleChannel: 'system-prompt'`.
- Verified contracts and entry points: `agent-process-manager.service.ts:386-454`, `:460-533`, `:543-612`; `cli-detection.service.ts:100-128`; `agent-rpc.handlers.ts:829-845`.
- Dependencies: Components 1, 4.
- Integration points: the agent record is broadcast to the webview through the existing wiring (`wiring/agent-events.ts`); the fields are optional.
- Failure behaviour: no new failure; a role never changes slot reservation or detection.
- Verification seam: `agent-process-manager.service.spec.ts`: role forwarded to `runSdk`, record and result carry the three fields, a role-less spawn carries none. A detection spec on stamped fields.
- Files:
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\cli-agent-runtime\src\lib\cli-agents\agent-process-manager.service.ts` + `agent-process-manager.service.spec.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-detection.service.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\rpc-handlers\src\lib\handlers\agent-rpc.handlers.ts` (list-row stamping only)

### 6. ptah-cli system-prompt delivery

- Purpose: deliver the role to Claude Agent SDK lanes in the system prompt.
- Responsibilities:
  - `PtahCliRegistry.spawnAgent` options gain `role?: AgentRoleDefinition`, forwarded to `assembleSpawnOptions`.
  - `assembleSpawnOptions` appends `renderRoleBlock(role, 'ptah-cli')` after `## Project Guidance` in `fullSystemPromptContent`. That covers both `standalone` and `preset-append` (`ptah-cli-registry.ts:752-760`).
  - Frontmatter `model`/`tools` are NOT applied: the tier/model precedence at `ptah-cli-registry.ts` spawn is unchanged.
  - `PtahCliRegistryLike` in vscode-lm-tools gains the same option.
- Verified contracts and entry points: `ptah-cli-registry.ts:559-587` (options), `:653-667` (assemble call), `:752-760`; `ptah-cli-spawn-options.service.ts:147-181`; `agent-namespace.builder.ts:65-84`.
- Dependencies: Components 1, 3.
- Integration points: Component 7 passes `roleDefinition` on the ptah-cli branch.
- Failure behaviour: none new. The system prompt goes over stdin `initialize`, so no argv budget applies. `ptah-cli-registry-auto-compact-argv.spec.ts` already guards argv and env, and must stay green with a 64 KiB role in its cases.
- Verification seam: `ptah-cli-spawn-options.*.spec.ts`: role section after project guidance and absent without a role. Registry spec: option threaded. Add one role case to the auto-compact-argv probe asserting the role text is in `initialize.systemPrompt` or `appendSystemPrompt`.
- Files:
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\cli-agent-runtime\src\lib\ptah-cli\ptah-cli-registry.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\cli-agent-runtime\src\lib\ptah-cli\helpers\ptah-cli-spawn-options.service.ts`
  - MODIFY or CREATE the matching specs in `ptah-cli/` and `ptah-cli/helpers/` (e.g. `ptah-cli-registry-auto-compact-argv.spec.ts`, a new `ptah-cli-spawn-options.role.spec.ts`)

### 7. MCP surface: `role` on both surfaces

- Purpose: accept, validate, resolve and report `role` identically over HTTP and stdio.
- Responsibilities:
  - One exported `AgentSpawnArgsSchema` (strict). It is today's stdio shape plus `role: z.string().min(1).max(100).optional()`. The HTTP `case 'ptah_agent_spawn'` and the stdio `handleSpawn` both parse with it. It replaces the HTTP cast and deletes the stdio-local `AgentSpawnSchema`. The HTTP error text mirrors the message/report pattern (`describeZodIssues`).
  - `buildAgentSpawnTool` adds a `role` property. Its description says: the name of an agent role generated for this workspace; `ptah_agent_list` shows the valid names; the role's definition is delivered to the lane and the result reports how; do not paste role templates into `task`. It names no vendor.
  - `AgentNamespace`:
    - `spawn` resolves `request.role` via the injected resolver at the top, after session resolution and before either branch or slot reservation. It passes `roleDefinition` on the rival branch (enriched request) and `role` to `registry.spawnAgent` + `{ role, roleDelivery: 'preamble', roleChannel: 'system-prompt' }` to `spawnFromSdkHandle` on the ptah-cli branch.
    - New `listRoles(): Promise<string[]>`.
    - When `role` is set but no resolver is wired, it throws a named error, never spawns role-less. Same rule as `deliverAgentReport` (`agent-namespace.builder.ts:271-283`).
  - `ptah-api-builder.service.ts`: inject `AGENT_ROLE_RESOLVER` optionally and wire `resolveAgentRole` / `listAgentRoles` deps (pattern `:434-435`, `:664-673`).
  - Formatters:
    - `formatAgentSpawn` adds `**Role:**` `<name> (<roleDelivery> via <roleChannel>)`.
    - `formatAgentStatus` shows the role.
    - `formatAgentList` adds `role delivery: <roleDelivery>/<roleChannel>` to each Capabilities cell, plus one line under the table: `Roles in this workspace: a, b, …` or `No agent roles generated for this workspace`.
    - stdio `structuredContent` adds `role`, `roleDelivery`, `roleChannel` to spawn and `roles` to list.
  - `AgentRoleError` becomes a tool error carrying the code. HTTP: `toolErrorResponse` text `Error: ptah_agent_spawn role <code>: <message>`. stdio: `structuredContent { ptah_code: 'mcp_tool_failed', tool: 'agent_spawn', state: <code>, availableRoles }`. Same shape as `agent_message` `:396-407`.
- Verified contracts and entry points: `tool-description.builder.ts:494-590`; `protocol-dispatcher.ts:730-827`, `:938-946`, `:1803-1823`; `agent-tool.dispatcher.ts:53-69`, `:247-306`, `:496-523`; `mcp-stdio/tool-builders.ts:53-55`; `agent-namespace.builder.ts:89-130`, `:154-253`, `:290-345`; `types.ts:242`, `:302`; `mcp-response-formatter.ts:464-550`.
- Dependencies: → cli-agent-runtime barrel (types, token, `AgentRoleError`), already an allowed dependency (`vscode-lm-tools/CLAUDE.md` Dependencies).
- Integration points:
  - Callers: conductor sessions over HTTP, external hosts over stdio (`ptah mcp-serve`), `execute_code` via `ptah.agent.spawn`.
  - Protocol shape: `ptah_agent_spawn({ task, role?, cli?|ptahCliId?, … })` → text + (stdio) structured `role`/`roleDelivery`/`roleChannel`.
- Failure behaviour:
  - `invalid_role_name`/`no_roles`/`unknown_role`/`empty_role`/`role_too_large`/`role_read_failed` → tool error before any spawn slot is taken.
  - `CliCommandLineTooLongError` → tool error naming sizes.
  - An unknown key (now including legacy typos) on HTTP → Zod tool error. This is a deliberate behaviour change.
- Quality requirements: security — the role name is validated by schema and resolver (defence in depth). Maintainability — one schema, one builder.
- Verification seam:
  - `protocol-dispatcher.spec.ts` and `agent-tool.dispatcher.spec.ts`: role forwarded, each `AgentRoleError` code surfaced, unknown key rejected on BOTH.
  - A NEW parity guard spec: the key set of `buildAgentSpawnTool().inputSchema.properties` equals `AgentSpawnArgsSchema.shape` keys; the stdio `tools/list` entry deep-equals the HTTP one except `name`.
  - `agent-namespace.builder.spec.ts`: resolution before either branch, no spawn on error, ptah-cli branch passes `role`, `workingDirectory` in a nested worktree still resolves from the workspace root.
  - `vendor-roster-drift.spec.ts` stays green.
  - `mcp-response-formatter` specs cover the new lines.
- Files:
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\agent-spawn-args.schema.ts`
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\agent-spawn-surface-parity.spec.ts`
  - MODIFY in `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\vscode-lm-tools\src\lib\code-execution\`:
    - `mcp-core/tool-description.builder.ts` (+ `.spec.ts`)
    - `mcp-core/protocol-dispatcher.ts` (+ `.spec.ts`)
    - `mcp-core/mcp-response-formatter.ts` (+ spec)
    - `mcp-stdio/agent-tool.dispatcher.ts` (+ `.spec.ts`)
    - `namespace-builders/agent-namespace.builder.ts` (+ `.spec.ts`)
    - `types.ts`
    - `ptah-api-builder.service.ts`

### 8. Native role probe (DEFERRED — not in v1)

- Purpose: switch a lane to `native` only when a marker probe passes on the installed version.
- Why deferred: v1 is complete and honest without it (every lane reports `preamble`). Neither candidate can be verified now: opencode is not installed; the SDK `agent` option's effect on Ptah's harness prompt is unmeasured. Shipping the mechanism with no lane that passes adds code with no user-visible effect.
- Shape to build later:
  - Adapter capability: optional `nativeRoleSelection` with (a) the probe key and (b) how to apply the role natively. Candidates only:
    - ptah-cli: SDK `agent: <role>` + inline `agents[role] = { description, prompt }` with no `model`, so the provider tier still wins. Key `ptah-cli@sdk-<version>`.
    - opencode: `--agent <role>` + inline `agent.<role> = { mode: 'primary', prompt }` in `OPENCODE_CONFIG_CONTENT`, subject to the Windows 32,767-char per-env-var cap. Key `opencode@<detected version>`.
  - agy and copilot declare none until a probe finds a working layout. codex and cursor have no root selector.
  - When the probe runs: lazily, on the first role-carrying spawn for a key with no cached result. The real spawn proceeds as preamble. The probe runs in the background with a 60 s timeout, at most one in flight per key per process, and uses the lane's cheapest tier. Never at detection time, because detection runs often and a probe is a paid call.
  - What passes: the marker body ("reply with exactly ROLE_PROBE_OK") and a neutral prompt must return the marker. For ptah-cli the harness guidance must also survive (the probe asks for `ptah_workspace_analyze` to be listed).
  - Cache: `~/.ptah/cache/role-native-probes.json`, keyed by probe key, `{ result: 'passed'|'failed', probedAt }`. A version change invalidates the entry. Written atomically.
  - `failed`, timeout, or unreadable cache → `preamble`. Only `passed` flips `roleDelivery` to `native` / `roleChannel` to `agent-selection`, in both spawn and list.
- Files (later): CREATE `libs/backend/cli-agent-runtime/src/lib/roles/native-role-probe.service.ts` (+ spec); MODIFY `cli-adapter.interface.ts`, `ptah-cli-registry.ts`, `opencode-cli.adapter.ts`, `cli-detection.service.ts`.

### 9. Documentation, skill routing and live e2e

- Purpose: make the contract discoverable and record real-lane evidence.
- Responsibilities:
  - `cli-agent-runtime/CLAUDE.md`: role channels, the budget guard, why read-only is not mapped, why frontmatter model is ignored.
  - `vscode-lm-tools/CLAUDE.md`: shared spawn schema; HTTP is now strict.
  - Skill `agent-lanes` §2 adds a `role` row and §3 adds "pass `role`, never paste a template into `task`". This lands on top of TASK_2026_431, so it is sequenced after that branch merges. Content downloads at runtime, so `npm run manifest:generate` follows the edit (TASK_2026_432 report "Open risks").
  - Live e2e: record in this folder's `test-report.md`. One call, `ptah_agent_spawn({ cli: <an installed argv lane, antigravity preferred>, role: 'code-logic-reviewer', taskFolder, task })`, on a scratch task. Evidence required:
    - the result shows `roleDelivery: preamble via task-prompt`;
    - the deliverable file appears in `taskFolder` with the role's structure;
    - `ptah_agent_read` shows the role block reached the lane.
    - Plus one codex run proving A1 when codex is installed.
- Files:
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\cli-agent-runtime\CLAUDE.md`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\libs\backend\vscode-lm-tools\CLAUDE.md`
  - MODIFY (post-431) `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/agent-lanes/SKILL.md` + `content-manifest.json`
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\.ptah\specs\TASK_2026_433_d22a\test-report.md`

## Integration architecture

- Data flow:
  1. The MCP call (HTTP `protocol-dispatcher` or stdio `AgentToolDispatcher`) parses with `AgentSpawnArgsSchema`.
  2. `ptahAPI.agent.spawn` (namespace builder) resolves the session, then `AgentRoleResolver.resolve(getWorkspaceRoot(), role)` → `AgentRoleDefinition`.
  3. ptah-cli branch: `PtahCliRegistry.spawnAgent(…, { role })` → `assembleSpawnOptions` appends the role block to the system prompt → SDK stdin `initialize` → `spawnFromSdkHandle(meta{role fields})`.
  4. Rival branch: `AgentProcessManager.spawn(enriched{roleDefinition})` → `doSpawnSdk` → `adapter.runSdk({ role })` → channel (task-prompt via `buildTaskPrompt` → `spawnCli` guard → argv/stdin/in-process; or codex `developer_instructions` → guard → codex-sdk argv).
  5. The record and result carry `role`/`roleDelivery`/`roleChannel` → MCP response → agent broadcast to the webview.
- State or persistence: none new in v1. The role is re-read from disk per spawn. The record fields live in memory with the tracked agent. Persisting `role` onto `CliSessionReference` for UI resume is a follow-up (below).
- External boundaries:
  - MCP args: Zod strict, name regex.
  - Filesystem: exact-match against the directory listing; size cap.
  - OS process: command-line budget.
  - The role body is trusted as workspace content (the same trust Claude subagents give it).
- Failure and rollback: every role failure happens before a spawn slot, a side effect or a process. antigravity's MCP HOME entry is written only after the budget passes. No partial state is left to roll back.
- Observability:
  - `[AgentProcessManager] Spawning SDK agent` and `[MCP] ptah_agent_spawn invoked`/`result` gain `role` and `roleChannel`.
  - `AgentRoleError`/`CliCommandLineTooLongError` are logged at error level by the existing handlers (`protocol-dispatcher.ts:1803-1810`, `agent-tool.dispatcher.ts:295-305`).
  - `ptah_agent_list` shows roles and channels, so a missing role is visible before a spawn fails.

## Architecture-level quality requirements

- Functional:
  - A spawn with `role` either runs with the role block on the adapter's declared channel or fails with a named code. It never runs role-less.
  - The HTTP and stdio schemas are identical (guard spec).
  - Every lane reports `roleDelivery: 'preamble'` in v1.
- Performance: role resolution adds one directory read and one file read per role spawn. No probe or model call in v1.
- Security: no path is built from unvalidated role input; strict schemas on both surfaces; no sandbox or permission is widened or narrowed by a role.
- Maintainability:
  - Backend stays free of frontend imports.
  - cli-agent-runtime → harness-sync stays one-way.
  - No CLI-name branch in the manager: channels are adapter declarations, same as `capabilities()`.
  - No vendor names in tool descriptions.
  - File-size watch: `protocol-dispatcher.ts` (2,132 lines) must not grow materially; spawn validation moves to the schema file.
- Testability: behaviour coverage per the verification seams above. `buildTaskPrompt` ordering and the budget limits are pinned by exact-value specs. Both MCP surfaces are exercised for every `AgentRoleError` code.

## UI follow-ups (not designed around current UI)

- Agent card / tile: show `role` and a `preamble` or `native` delivery badge from `AgentProcessInfo`.
- Tribunal panel: let a lane take an agent role (the list of roles comes from `ptah_agent_list`). Retire the parenthesised `(role)` token grammar (`tribunal-run.service.ts:308`) in favour of the structured `role` field. Relay/Crucible move roles stay a separate vocabulary.
- Resume from UI: `agent:resumeCliSession` re-applies the recorded role. Needs `role` persisted on `CliSessionReference` (`wiring/agent-events.ts` `persistCliSessionReference`, `agent-sdk` session metadata store) and a `role` param on the RPC.
  - Coordinate: those two files carry unstaged sibling WIP in the main checkout.
- Settings/onboarding: surface "no roles generated" with a link to the setup wizard.

## Team-leader handoff

- Recommended executors: backend-developer for Components 1-7; technical-content-writer for the doc/skill part of 9; senior-tester for the live e2e and the parity guard review; backend-developer later for 8.
- Complexity: MEDIUM-HIGH. The change touches 4 libs and 6 adapters, adds a behaviour change on the HTTP surface, and adds an OS-limit guard with platform branches. Each piece is shallow.
- Dependencies and ordering (component-level):
  - 1 → 2, 3.
  - 3 → 4, 6.
  - 1 + 3 + 4 → 5 (manager forwards; detection reads `roleChannel`).
  - 2 + 5 + 6 → 7.
  - 7 → 9 (e2e).
  - The skill edit in 9 waits for TASK_2026_431 to merge.
  - 8 is independent and later.
- Suggested file-disjoint batches:
  - B1 contracts (Component 1): backend-developer.
  - B2 resolver + prompt/budget + interface (Components 2, 3): backend-developer. After B1.
  - B3 adapters (Component 4): backend-developer. After B2. Parallel-safe with B4.
  - B4 manager/detection + ptah-cli (Components 5, 6; includes the one-line `agent-rpc.handlers.ts` stamp): backend-developer. After B2. `CliAdapter.roleChannel` is a required member, so B4's typecheck is green only once B3 lands. Run typecheck after both.
  - B5 MCP surface (Component 7): backend-developer. After B3 and B4.
  - B6 docs + live e2e (Component 9 minus the skill): technical-content-writer + senior-tester. After B5.
  - B7 skill routing (post-431), deferred B8 native probe (Component 8).
- Parallel-safe work: B3 ∥ B4 (disjoint files, same lib; typecheck gate after both).
- Files affected:
  - CREATE: `cli-agent-runtime/src/lib/roles/{agent-role-resolver.service.ts, agent-role-resolver.service.spec.ts, index.ts}`; `vscode-lm-tools/src/lib/code-execution/mcp-core/{agent-spawn-args.schema.ts, agent-spawn-surface-parity.spec.ts}`; `ptah-cli/helpers/ptah-cli-spawn-options.role.spec.ts`; `.ptah/specs/TASK_2026_433_d22a/test-report.md`.
  - MODIFY:
    - `libs/shared/src/lib/types/agent-process.types.ts`;
    - `cli-agent-runtime/src/{index.ts, lib/di/tokens.ts, lib/di/register.ts}`;
    - `cli-agent-runtime/src/lib/cli-agents/{agent-process-manager.service.ts(+spec), cli-detection.service.ts}`;
    - `cli-agent-runtime/src/lib/cli-agents/cli-adapters/{cli-adapter.interface.ts, cli-adapter.utils.ts(+spec), codex-cli.adapter.ts(+spec), copilot-sdk.adapter.ts(+spec), antigravity-cli.adapter.ts(+spec), opencode-cli.adapter.ts(+spec), cursor-cli.adapter.ts(+spec), pi-cli.adapter.ts(+spec)}`;
    - `cli-agent-runtime/src/lib/ptah-cli/{ptah-cli-registry.ts, ptah-cli-registry-auto-compact-argv.spec.ts, helpers/ptah-cli-spawn-options.service.ts}`;
    - `rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts`;
    - `vscode-lm-tools/src/lib/code-execution/{types.ts, ptah-api-builder.service.ts, namespace-builders/agent-namespace.builder.ts(+spec), mcp-core/tool-description.builder.ts(+spec), mcp-core/protocol-dispatcher.ts(+spec), mcp-core/mcp-response-formatter.ts(+spec), mcp-stdio/agent-tool.dispatcher.ts(+spec)}`;
    - `libs/backend/{cli-agent-runtime,vscode-lm-tools}/CLAUDE.md`.
  - REWRITE: none.
- Verification points:
  - Confirm A1-A4 with the named checks.
  - The parity guard spec and `vendor-roster-drift.spec.ts` are green.
  - No `sandboxMode`/permission diff in adapter specs.
  - Commands, reading the "Running target test for N projects" header:
    - `npx nx run-many -t test -p @ptah-extension/shared @ptah-extension/cli-agent-runtime @ptah-extension/vscode-lm-tools @ptah-extension/rpc-handlers` (N=4);
    - `npx nx run-many -t lint,typecheck -p <same 4>`;
    - `node scripts/generate-content-manifest.js --check` after B7.

## Research corrections (claims the code contradicts)

1. **"Resolve the role body into `systemPrompt`" is wrong.**
   - `systemPrompt` is the harness prompt (`ptah-api-builder.service.ts:619-627`).
   - `buildTaskPrompt` takes `systemPrompt || projectGuidance` (`cli-adapter.utils.ts:359`), so the role would replace the harness or displace guidance.
   - The ptah-cli branch never receives `systemPrompt` (`agent-namespace.builder.ts:183-195`).
2. **The Windows argv cap is not antigravity-only.**
   - copilot passes the prompt as `-p` argv (`copilot-sdk.adapter.ts:312-319`).
   - opencode passes it as a positional argv (`opencode-cli.adapter.ts:427`).
   - codex's `config.developer_instructions` becomes argv `--config` through codex-sdk (`index.js:174-179`, `:306-345`). Only codex's task input goes to stdin.
3. **Reviewer read-only → codex `sandbox_mode`/opencode permissions would break the lane's deliverable write.** The transformer's `read-only` applies to delegated children (`codex-agent-transformer.ts:45-48`).
4. **ptah-cli "not researched" gap:** the installed SDK 0.3.150 documents a main-thread root selector, `Options.agent`, plus inline `agents` (`sdk.d.ts:1227-1261`). It is a real native candidate (Component 8), not "no native".
5. **Line cites drift:**
   - codex `new sdk.Codex` is at `codex-cli.adapter.ts:632` (config `:602-626`), not `:589`.
   - The installed `@openai/codex-sdk` is `0.147.0` (`package.json:3`), distinct from the CLI version the lane quoted.
6. **"harness-sync writes generated agents"** is a derived copy. The generation output is `{ws}/.claude/agents`, and the user-layer/native copies are consent-gated (`harness-sync/CLAUDE.md:110-113`, `:360-378`). That is why this plan resolves from `.claude/agents`.
