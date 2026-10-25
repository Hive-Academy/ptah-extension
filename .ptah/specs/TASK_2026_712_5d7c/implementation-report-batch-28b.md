# Backend implementation — `TASK_2026_712_5d7c`, batch 28b

Executor: backend-developer subagent (Claude Opus 5.5). Worktree
`D:/projects/ptah-extension/.claude-worktrees/provider-accounts-p1e`. No git mutation, no nx/jest/tsc/lint run.

**Tasks completed**: 28.1 (MCP/namespace half, per D31): account selection on spawn, claude-lane description truthfulness, derived roster in help docs.

## Files

- MODIFIED `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-spawn-args.schema.ts`
  - `cli` stays `z.enum(SYSTEM_CLI_TYPES)`. It was already derived from the tuple, so no vendor list was copied.
  - Adds optional `accountSelection: ProviderAccountSelectionSchema` (strict shared schema from `@ptah-extension/shared/schemas`). It holds only `omitted`, `ambient`, or `named` + an opaque `profileId`. It has no path, env, token or owner field.
  - Adds `AGENT_SPAWN_ACCOUNT_CLI = 'claude' satisfies SystemCliType`.
  - Adds exported `agentSpawnAccountRefusal(input)`, the single refusal rule. A `.superRefine` on the still-`ZodObject` schema applies it (zod 4.6.5 keeps `.shape`, which the parity spec reads).
- MODIFIED `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts`
  - The spawn description now says:
    - `claude` is the system Claude lane: a Claude Agent SDK session with Ptah tools over MCP, distinct from Ptah CLI agents.
    - `modelTier` is Ptah-CLI-only, and system lanes (claude included) ignore it.
    - A claude resume continues its SDK session.
    - `accountSelection` is optional and claude-only.
  - The `modelTier` and `resume_session_id` field descriptions are updated to match.
  - New `accountSelection` property (object, `kind` enum, `additionalProperties: false`). Its description says that named is refused before spawn in this release and that a resume never takes a named account. It does not claim a live named launch (D7).
- MODIFIED `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/agent-namespace.builder.ts`
  - New `assertAccountSelection` at the `execute_code` boundary. It reads the value with the shared strict `readProviderAccountSelectionField`: a malformed value (null, extra keys, path or token fields, bad id) throws and is never read as ambient. It then applies the same `agentSpawnAccountRefusal`.
  - A checked selection is stripped before `agentProcessManager.spawn`, like `systemPrompt` (see D-28b-2).
- MODIFIED `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/system-namespace.builders.ts`
  - `HELP_DOCS.orchestration`: replaces the hand-copied, stale `Available CLI agents: codex, copilot, ptah-cli` with `${SYSTEM_CLI_TYPES.join(', ')}` plus ptah-cli and a per-machine `list()` note.
  - `HELP_DOCS.agent`: the spawn request now lists `ptahCliId`, `model`, `modelTier`, `resumeSessionId` and `accountSelection`. It explains the claude lane, that `modelTier` is Ptah-only, and the account rules.
- MODIFIED (spec) `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-spawn-args.schema.spec.ts`
  - Account cases:
    - Optional for old callers.
    - ambient and omitted accepted for claude and survive a JSON round trip (stdio hop).
    - Ambient accepted on resume.
    - Named refused fresh (release-held) and on resume (stored account kept).
    - Every non-claude tuple member refused (derived via `.filter`), as are no-cli and `ptahCliId`.
    - Path, env, token, owner, malformed id, null, unknown kind and id-less named all rejected.
  - Description truthfulness, plus HELP_DOCS derived-roster checks.
- MODIFIED (spec) `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/agent-namespace.builder.spec.ts`
  - New `spawn accountSelection` describe at the `execute_code` boundary:
    - ambient and omitted spawn on the existing route, and the key is not forwarded.
    - An ambient resume keeps `resumeSessionId`.
    - Named is refused fresh and on resume.
    - A selection for codex, auto-detect or ptahCliId is refused, and neither spawn path is called.
    - 7 malformed shapes are refused without spawn.
  - No `as unknown as`: it uses a typed request variable.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| D-28b-1: Refuse `named` before spawn. Accept `ambient`/`omitted` only with `cli: 'claude'` and no `ptahCliId`. | (a) accept named and forward it; (b) refuse named (release-held); (c) accept named and silently run ambient. Chose (b). | D7 release-held; `CLAUDE_LANE_ACCOUNT_PERSISTENCE` unregistered on every host (D28). The only named launch path is `ClaudeCliCommandOptions.accountAdmission` (`cli-agent-runtime/.../claude-cli.adapter.ts:271-289`), which `SpawnAgentRequest` cannot reach. Option (c) would launch the ambient login under a named request. Codex is in `PROVIDER_ACCOUNT_PROVIDERS` but has no lane contract (Phase 2). | Yes: drop the named branch in `agentSpawnAccountRefusal` once admission is released and `SpawnAgentRequest` carries the field. |
| D-28b-2: Do not forward the checked selection into `SpawnAgentRequest`. | Forward as an untyped extra key vs strip. | `SpawnAgentRequest` (`libs/shared/src/lib/types/agent-process.types.ts`, shared, not owned) has no account field. An accepted value is ambient or omitted, which is the route a lane takes with no selection (`prepareNamed` returns `undefined` without `accountAdmission`). Stripping is therefore behaviour-lossless, and no untyped key leaks downstream. | Yes |
| D-28b-3: Resume + ambient is allowed at this layer. Conflict detection is left to the runtime gate. Resume + named is refused here. | Classify here with `classifyAgentResumeAccountSelection` vs the runtime gate. | This layer has no stored binding. Because the selection is never forwarded, it cannot override the stored account. `resolveLaneAccountResume` (`lane-resume-gate.ts:208-235`) and `prepareNamed` (`claude-cli.adapter.ts:293-300`) refuse a bound session (release-held, D28 26c), so ambient against bound is still refused before the run. Named on resume is refused outright: it can only conflict or be release-held. | Yes |
| D-28b-4: One refusal function shared by the MCP schema and the `execute_code` namespace. | Duplicate the rules vs share. | Existing precedent: the namespace already imports `MAX_EFFORT_LENGTH` from the schema file for the same parity reason. | Yes |

## Existing specs that pin changed descriptions/enums

- `mcp-core/agent-spawn-surface-parity.spec.ts:96-103`: advertised keys must equal `AgentSpawnArgsSchema.shape` keys. `accountSelection` was added to both, and `.shape` is kept (zod 4 `superRefine` returns the object type).
- `mcp-core/agent-spawn-surface-parity.spec.ts:105-118`: the stdio `inputSchema` must equal the HTTP one. `buildMcpAgentSpawnTool` reuses it, and no stdio builder was touched.
- `vendor-roster-drift.spec.ts:63-104`: brand ban applies to the spawn description, every property description (including the new `accountSelection`), and `HELP_DOCS.agent`. The new text uses only lowercase `claude`/`codex` enum values and "Claude"; there is no "Codex", "Copilot" or Ptah CLI provider brand. `:115-123`: the enum still equals `SYSTEM_CLI_TYPES`.
- `mcp-core/tool-description.builder.spec.ts:285-330`: role/force property checks are unaffected. No spec pinned the replaced `modelTier`/resume sentences (grep for "Ignored for standard CLI", "Only applies to Ptah CLI", "Available CLI agents" found no spec hits).
- `namespace-builders/system-namespace.builders.spec.ts`: no pin on the replaced orchestration line found.

## Stdio dispatcher impact (`mcp-stdio/agent-tool.dispatcher.ts`)

- `:436` parses with `AgentSpawnArgsSchema`, so the stdio path now gets the same refusal (claude-only, named refused, malformed rejected) with no code change.
- `:489-497` maps fields explicitly into the spawn request, so `accountSelection` is not forwarded. HTTP `mcp-core/protocol-dispatcher.ts:1193-1264` does the same. Today this is lossless (D-28b-2): only ambient and omitted pass the schema.
- When named admission is released, both dispatchers and `SpawnAgentRequest` must forward the field together with removing the named refusal (owner: Batch 34 / certification).
- `apps/ptah-cli/src/cli/commands/agent-cli.ts` public command serialization was not touched (not owned). Batch 34 public drift tests cover it.

## Stack observed

- Zod 4.6.5 (`node -e require('zod/package.json').version`). The MCP schema is in `vscode-lm-tools`, and the shared zod schemas come via `@ptah-extension/shared/schemas` (`tsconfig.base.json:235`; precedent `harness-namespace.builder.ts:21`).
- MCP tool definitions use the JSON Schema shape `MCPToolDefinition` (`mcp-core/types/mcp-protocol.types.ts:115-128`).
- `execute_code` boundary guards are hand-written asserts that throw "…The agent was not spawned." (`agent-namespace.builder.ts` `assertEffort`).

## Verification

- `ptah_get_diagnostics` (typescript-compiler) on all 6 changed files: 0 errors, 0 warnings, coverage clean. The first 2 attempts timed out while the check was still running.
- As instructed, nx, jest, tsc and lint were not run.
- Suggested commands (orchestrator, one at a time):
  - `npx jest -c libs/backend/vscode-lm-tools/jest.config.ts libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-spawn-args.schema.spec.ts libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/agent-namespace.builder.spec.ts libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-spawn-surface-parity.spec.ts libs/backend/vscode-lm-tools/src/lib/code-execution/vendor-roster-drift.spec.ts libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.spec.ts libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/system-namespace.builders.spec.ts --coverage=false --maxWorkers=2`
  - Also run the stdio and HTTP dispatcher specs that parse spawn args: `mcp-stdio/agent-tool.dispatcher*.spec.ts` and `mcp-core/protocol-dispatcher*.spec.ts`.
  - `npx nx typecheck vscode-lm-tools --parallel=1` and `npx nx lint vscode-lm-tools --parallel=1`. Prettier may rewrap two long `it(...)` titles in the new spec blocks.

## Plan deviations

- The batch asked to "carry the selection without serialization loss". The selection is carried losslessly through the MCP schema (JSON round trip pinned) and validated at both boundaries. It is not forwarded into `SpawnAgentRequest` because shared has no field and named admission is release-held. While only ambient and omitted are admissible, this is behaviour-equivalent (D-28b-2).

## Out-of-scope observations

- `SpawnAgentRequest` needs an `accountSelection` field, and both dispatchers need to forward it, before named lanes can be released (shared plus dispatcher owners, Batch 34).
- `HELP_DOCS.orchestration` is not in `vendor-roster-drift.spec.ts`'s `agentFacingStrings()`. The stale hand-copied roster there went unnoticed for that reason. Adding it belongs in Batch 34's drift tests.
