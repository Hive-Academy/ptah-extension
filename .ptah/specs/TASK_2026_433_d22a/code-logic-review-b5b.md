# Code Logic Review — `TASK_2026_433` Batch B5b

Scope: `git -C D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes diff -- libs/backend/vscode-lm-tools/` (9 files: `mcp-core/mcp-response-formatter.ts`+spec, `mcp-core/protocol-dispatcher.ts`+spec, `mcp-core/tool-description.builder.ts`+spec, `mcp-stdio/agent-tool.dispatcher.ts`+spec, `mcp-stdio/stdio-mcp-server.service.spec.ts`) plus the three untracked files `mcp-core/agent-spawn-args.schema.ts`, `mcp-core/agent-spawn-args.schema.spec.ts`, `mcp-core/agent-spawn-surface-parity.spec.ts`. `cli-agent-runtime` changes (B4d, in progress) are read only as committed context, per instruction.

Contract basis: `batches.md` Batch B5b (Tasks 5b.1–5b.6), the "Contract amendment at B5a verify" block (D8 on both dispatchers, spec-mock requirement, spawn ordering unchanged), Decision 2 (one strict schema, unknown keys rejected on HTTP and stdio).

## Summary

| Metric              | Value                                |
| -------------------- | ------------------------------------ |
| Overall score        | 8/10                                 |
| Assessment            | APPROVED                             |
| Blocking issues       | 0                                    |
| Serious issues        | 0                                    |
| Moderate issues       | 2                                    |
| Failure modes found   | 3 (all handled correctly)            |

Evidence base: full read of all 9 diffed files (diff + surrounding context) and the 3 untracked files; `AgentRoleResolver`/`AgentRoleError` (`libs/backend/cli-agent-runtime/src/lib/roles/agent-role-resolver.service.ts`) and `CliCommandLineTooLongError` (`cli-adapters/cli-adapter.utils.ts:242-257`) read for error-shape and message-content verification; grepped the whole repo for other in-repo callers of `ptah_agent_spawn`/`agent_spawn` (tribunal-panel, `builtin-presets.ts`, plugin/skill markdown) to check for a key the new strict schema would reject. Ran and observed green: `nx run @ptah-extension/vscode-lm-tools:test --testPathPatterns="agent-spawn-args|agent-spawn-surface-parity|tool-description\.builder|protocol-dispatcher|mcp-response-formatter|agent-tool\.dispatcher|stdio-mcp-server" --skip-nx-cache` (8 suites, 256 tests), `nx run-many -t lint,typecheck -p @ptah-extension/vscode-lm-tools --skip-nx-cache` (0 lint errors, 21 pre-existing warnings none newly introduced; typecheck clean).

## Five logic questions

### 1. How does this fail silently?

Not on the paths this batch owns. The two silent-failure seams that existed before this batch are both closed, and no new one was introduced:

- **`ptah_agent_list` / `agent_list` no longer risk a hard failure on a role-listing error (D8, closed).** HTTP wraps `ptahAPI.agent.listRoles()` in its own `try/catch` (`protocol-dispatcher.ts:917-926`; `roles` stays `[]` and a warning is logged on rejection); stdio's `listRolesOrEmpty()` (`agent-tool.dispatcher.ts:533-542`) does the same and is called *inside* the outer `try` of `handleAgentList` — but since it swallows its own error, it can never trip that outer `catch`. Both are pinned: `protocol-dispatcher.spec.ts:264-287` and `agent-tool.dispatcher.spec.ts:246-266` assert the list still succeeds and a warning is logged; `protocol-dispatcher.spec.ts:289-304` and `agent-tool.dispatcher.spec.ts:268-281` assert the reverse — an `agent.list()` failure still fails the tool and `listRoles` is never even called, matching "D8 correctness: list error path unchanged, listRoles only after list."
- **A spawn is never reported as a success while silently dropping an unrecognized argument.** `.strict()` on `AgentSpawnArgsSchema` (`agent-spawn-args.schema.ts:6-20`) makes an unknown key a hard `safeParse` failure on both surfaces, pinned by `agent-spawn-args.schema.spec.ts:70-76`, `protocol-dispatcher.spec.ts:1647-1659` and `agent-tool.dispatcher.spec.ts:84-98`. This is the deliberate HTTP behaviour change from Decision 2 (previously HTTP cast-and-dropped).
- **A resolver failure or an oversized command line never becomes a role-less spawn that reports success.** Both dispatchers wrap `ptahAPI.agent.spawn(...)` and map `AgentRoleError`/`CliCommandLineTooLongError` to a tool error before falling through to the generic catch (`protocol-dispatcher.ts:132-162`, `agent-tool.dispatcher.ts:82-121`); neither ever calls `toolSuccess`/`createToolSuccessResponse` after a caught error.

One residual (not a defect, a documentation drift, see Moderate #2): the JSON tool description for `timeout` (`tool-description.builder.ts:544-548`, untouched by this batch) still reads "max: 3600000 = 1hr", while `AgentSpawnArgsSchema.timeout` is `z.number().int().nonnegative().optional()` with no upper bound at all — confirmed accepting `36_000_000` in `agent-spawn-args.schema.spec.ts:44-47`. This cannot cause a caller to see a *false* rejection (the schema is more permissive than advertised, not less), so it is not a silent-failure path, but a model reading the tool description would believe a value above one hour is invalid when it is not.

### 2. What user action produces unexpected behaviour?

- **An existing caller that has been sending an extra field HTTP used to accept.** Before this batch, HTTP `ptah_agent_spawn` cast `args` and read only the named keys, so any additional key (a typo, a field copied from another tool, a hallucinated `prompt` or `instruction` key) was silently ignored and the call still spawned. After this batch it is a hard `.strict()` rejection with `isError: true` and no spawn. This is Decision 2's explicitly recorded and intended change, mitigated by `implementation-plan.md`/`batches.md` documentation and by `Task 6.1` (still `PENDING`, per `batches.md:596-620`) updating `vscode-lm-tools/CLAUDE.md`. I grepped every in-repo caller (`libs/frontend/tribunal-panel/src/lib/services/tribunal-run.service.ts:414-431`, `libs/backend/rpc-handlers/src/lib/harness/config/builtin-presets.ts`, and every `agent_spawn`-mentioning file under `apps/ptah-extension-vscode/assets/plugins/**`) and none constructs or documents a key outside `AgentSpawnArgsSchema.shape` — no in-repo regression today, but the risk is real for any external MCP client or LLM improvising a key.
- **A caller naming a role AND an unknown key together** gets only the "unrecognized key" message; it never learns whether the role name itself was also going to be rejected, because the whole parse fails atomically. Cosmetic — no spawn happens on either failure. Inherited from Zod's own `safeParse` semantics, not specific to this diff.
- **A caller reading the JSON tool description for `timeout`** and clamping its own request to 3,600,000 ms because the description says that is the max, when nothing in the actual contract enforces that ceiling — see Moderate #2.

### 3. What input data produces a wrong answer?

None found that produces a wrong *answer* (as opposed to a correctly surfaced error or a correctly rendered omission) within this diff's scope.

- `role: ''` is rejected by `.min(1)` at the schema before ever reaching the resolver (`agent-spawn-args.schema.spec.ts:61-63`, `agent-tool.dispatcher.spec.ts:100-110`) — tighter than B5a's own `!== undefined` gate, which let `''` through to the resolver to fail there. Both stop at the same outcome (no role-less silent spawn), just at different layers; no double-error, since the schema is strictly upstream of `ptahAPI.agent.spawn`.
- `formatRoleLine` (`mcp-response-formatter.ts:461-473`) only renders `**Role:**` when `role.role` is truthy, so an agent that never carried a role never gets a spurious Role line in `formatAgentSpawn`/`formatAgentStatus` — verified by `mcp-response-formatter.spec.ts` (`omits the role line on a role-less spawn`, `formatAgentStatus... withoutRole`). This is a different, list-level line: `formatRoleDeliveryCapability` (`mcp-response-formatter.ts:475-479`) appends "role delivery: preamble/…" to **every** `ptah-cli` row in `ptah_agent_list`'s Capabilities cell, regardless of whether that particular running instance was spawned with a role — but that is correct by contract: `CliDetectionResult.roleDelivery/roleChannel` (B1) is a per-CLI-type *capability* stamp ("if you pass `role` to this lane, here is how it will be delivered"), not a per-instance "this agent has a role" flag; the per-instance fact is `formatRoleLine`'s `role.role`, a different field on a different type (`AgentProcessInfo`/`SpawnAgentResult`). No bug — the two lines answer two different questions and this batch keeps them cleanly separated.
- The role-content-length ceiling (100 chars, `agent-spawn-args.schema.ts:18`) matches the plan's `role 1–100 characters` exactly and is spec-pinned at both boundaries (`agent-spawn-args.schema.spec.ts:53-67`).

### 4. What happens when a dependency fails?

- **`ptahAPI.agent.spawn` rejects with `AgentRoleError`** → both dispatchers narrow with `instanceof AgentRoleError` (`protocol-dispatcher.ts:149`, `agent-tool.dispatcher.ts:87`) and return a tool error naming the code and message, never a partial success. All 7 `AgentRoleErrorCode` values (`invalid_role_name`, `no_roles`, `unknown_role`, `empty_role`, `role_too_large`, `role_read_failed`, `no_workspace`) are exercised on both surfaces via `it.each` (`protocol-dispatcher.spec.ts:156-176`, `agent-tool.dispatcher.spec.ts:112-141`), matching the contract's "each of the 7 `AgentRoleError` codes … surfaced." Both `AgentRoleError` and `CliCommandLineTooLongError` are imported by both dispatchers from the same barrel path (`@ptah-extension/cli-agent-runtime`), and `PtahAPI` is built in-process in the same host (`this.apiBuilder.build()` inside `StdioMcpServerService`, `stdio-mcp-server.service.ts:302-304`) — there is no serialization boundary between where these errors are thrown (inside `cli-agent-runtime`, reached transitively through `AgentNamespace.spawn`) and where they are caught, so the `instanceof` checks are checking real prototype identity within one bundle/module graph, not a class that crossed a process or realm boundary. This was an explicit hunt item and I did not find a divergence.
- **`ptahAPI.agent.spawn` rejects with `CliCommandLineTooLongError`** → mapped to a tool error naming `measured`/`limit` on both surfaces (`protocol-dispatcher.ts:155-160`, `agent-tool.dispatcher.ts:99-111`); stdio additionally records `command_line_too_long` in `structuredContent.state`, undocumented in `batches.md` as an exact literal but explicitly called out and accepted in the executor summary ("stdio added the latter beyond contract"). This is a superset, not a contract violation: HTTP has no structured-content channel for this tool, so the two surfaces cannot literally match here, and no spec or consumer depends on HTTP carrying the same key.
- **Any other spawn rejection** (e.g. `no slot`, a plain `Error`) falls through to the pre-existing generic failure path unchanged on both surfaces — pinned by `protocol-dispatcher.spec.ts:197-208` ("keeps the generic failure path for any other spawn error") and the equivalent stdio catch-all.
- **`ptahAPI.agent.listRoles()` rejects** → both dispatchers degrade to `roles = []` plus a logged warning, never propagate — see Q1.
- **`ptahAPI.agent.list()` itself rejects** → unchanged pre-existing behavior, a hard tool failure; confirmed `listRoles` is never called in that case on either surface (`protocol-dispatcher.spec.ts:289-304`, `agent-tool.dispatcher.spec.ts:268-281`).

### 5. What is missing that the requirements never mentioned?

- The JSON tool description's stale `timeout` ceiling (Moderate #2) — not a B5b requirement to fix (Task 5b.1's contract explicitly says "unbounded non-negative timeout", inherited verbatim from the pre-existing stdio schema and its now-deleted comment explaining why there is no ceiling), but nothing in this batch's scope updated the *description string* to match, and the parity spec (`agent-spawn-surface-parity.spec.ts`) checks only key names, not description accuracy, so nothing will catch this drifting further.
- `AgentRoleError` messages built in `agent-role-resolver.service.ts` (out of this batch's scope, B2a/B3.0b territory) embed absolute local filesystem paths (`workspaceRoot`, the `.claude/agents` directory, and `sourcePath`) — e.g. `Failed to read role "x" from D:\...\ .claude\agents\x.md (workspace D:\...)`. B5b is the layer that makes these messages reach the MCP tool caller verbatim (`Error: ptah_agent_spawn role role_read_failed: <message>` / `agent_spawn role role_read_failed: <message>`), on both surfaces, with no redaction. For a local single-user desktop/CLI tool where the calling agent already has full filesystem read access via other tools, this is low severity, but it was flagged by the hunt brief and nothing in this batch (or a prior one, based on the B5a review) makes a decision to keep or strip local paths from agent-facing error text — recorded as Moderate #1.
- Nothing in this batch documents, for a human reading `vscode-lm-tools/CLAUDE.md`, that HTTP is now strict where it used to be permissive (Task 6.1 is `PENDING`, correctly deferred per `batches.md:602`).

## Failure modes

### Role-listing failure during `ptah_agent_list` / `agent_list`

- Trigger: `AgentRoleResolver.listRoles()` throws (`no_workspace` on an empty/relative workspace root, `role_read_failed` on a directory-read error) while `ptahAPI.agent.list()` itself succeeds.
- Symptom: without this batch, the whole list call would fail; with it, the caller gets the full agent list plus "No agent roles generated for this workspace" and the host logs a warning.
- Evidence: `protocol-dispatcher.ts:917-926`; `agent-tool.dispatcher.ts:533-542` (`listRolesOrEmpty`).
- Current handling: caught, logged, degraded to `[]`. Correct per the D8 contract amendment.
- Recommendation: none.

### Unrecognized argument on `ptah_agent_spawn` / `agent_spawn`

- Trigger: any caller (LLM improvisation, stale integration, a future field renamed on one surface but not the other) sends a key outside `AgentSpawnArgsSchema.shape`.
- Symptom: HTTP now fails the call it used to silently accept (Decision 2's intended behaviour change); stdio's behaviour is unchanged (it was already strict).
- Evidence: `agent-spawn-args.schema.ts:6-20` (`.strict()`); `protocol-dispatcher.ts:86-96`; `protocol-dispatcher.spec.ts:1647-1659`.
- Current handling: `safeParse` failure → `toolErrorResponse`/`toolError` naming the offending field, no spawn.
- Recommendation: none required by this batch; Task 6.1 (docs) should call this out explicitly for any external MCP client, and confirmed the in-repo callers I found are already compliant.

### Command line over the platform limit while a role is set

- Trigger: `assertCommandLineWithinLimit` (B2b/B3, out of scope here) throws `CliCommandLineTooLongError` because a role body plus task pushes an adapter's argv/config-string past its platform ceiling.
- Symptom: tool error naming measured size and limit; nothing was spawned or truncated.
- Evidence: `protocol-dispatcher.ts:155-160`; `agent-tool.dispatcher.ts:99-111`; class definition `cli-adapter.utils.ts:242-257`.
- Current handling: correctly mapped and message-preserving on both surfaces (message text is self-contained, no path leakage — only sizes and a generic remediation sentence).
- Recommendation: none for B5b. The stdio-only `state: 'command_line_too_long'` literal is a superset addition, not a divergence a consumer could observe as broken.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

### Moderate: `AgentRoleError` messages carry absolute local paths straight through to the MCP tool caller

- File: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts:150-153`, `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-stdio/agent-tool.dispatcher.ts:88-97` (consuming messages built in `libs/backend/cli-agent-runtime/src/lib/roles/agent-role-resolver.service.ts:78,86,99,108,117` — out of this batch's file scope but forwarded verbatim here).
- Not a regression introduced by B5b (the resolver's message shape was reviewed and approved in B2a), and low severity for a local desktop/CLI tool whose caller already has full filesystem access through other MCP tools. Flagging because this batch is the point where these messages become externally observable through the tool response, and nothing in `batches.md`/`implementation-plan.md` records a deliberate decision to keep local paths in agent-facing error text versus stripping them to a relative form.

### Moderate: stale `timeout` tool-description ceiling now visibly contradicts the shared schema

- File: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts:544-548` ("Timeout in milliseconds (default: 3600000 = 1hr, max: 3600000 = 1hr)") vs `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-spawn-args.schema.ts:12` (`z.number().int().nonnegative().optional()`, no max — accepts `36_000_000` per `agent-spawn-args.schema.spec.ts:44-47`).
- Not introduced by this batch (the underlying stdio schema already had no ceiling, with a comment explaining why), but the schema consolidation is exactly the moment this drift becomes visible in one place, and the new `agent-spawn-surface-parity.spec.ts` checks key names only, not description accuracy, so nothing will catch it getting worse. A caller trusting the description would under-request timeout headroom it does not need to; harmless in the safe direction, but worth a one-line fix.

### Minor: the explanatory comment on why `timeout` has no upper bound was dropped, not relocated

- File: deleted from `mcp-stdio/agent-tool.dispatcher.ts` (previously inline above the old local `AgentSpawnSchema`), not carried into `agent-spawn-args.schema.ts`.
- Consistent with this repository's "no explanatory comments" convention, so likely intentional; flagging only because the comment recorded *why* the 1-hour ceiling was removed (a past incident: "the old 1-hour ceiling rejected the spawn a long-running job needed"), and that institutional memory now lives only in git history plus the stale tool-description text above.

## Data flow

1. `ptah_agent_spawn`/`agent_spawn` request args reach `AgentSpawnArgsSchema.safeParse` — OK, same schema object on both surfaces (`agent-spawn-args.schema.ts`), confirmed by `agent-spawn-surface-parity.spec.ts`.
2. Parse failure (unknown key, missing/oversized `task`, bad `cli` enum member, invalid `role` length, negative `timeout`) → tool error, no `ptahAPI.agent.spawn` call — OK on both surfaces.
3. Parse success → `spawnArgs.role` forwarded into the `ptahAPI.agent.spawn(...)` call object on both surfaces (`protocol-dispatcher.ts:146`, `agent-tool.dispatcher.ts:269`) and logged (`protocol-dispatcher.ts:116`, `agent-tool.dispatcher.ts:247`) — OK.
4. `ptahAPI.agent.spawn` (B5a's `AgentNamespace.spawn`, out of this batch's scope) resolves the role, spawns, and returns a `SpawnAgentResult` that may carry `role`/`roleDelivery`/`roleChannel` — OK, consumed as an opaque result here.
5. Success → HTTP renders via `formatAgentSpawn` (adds `**Role:** … (delivery via channel)` when present, `mcp-response-formatter.ts:560-579`); stdio adds `role`/`roleDelivery`/`roleChannel` to `structuredContent` only when the result carries them (`agent-tool.dispatcher.ts:277-279`, spread-guarded) — OK, both verified role-less-omits and role-present-includes.
6. Failure → `AgentRoleError` / `CliCommandLineTooLongError` mapped to a tool error before the generic catch on both surfaces; any other error falls through to the pre-existing generic path — OK, verified above.
7. `ptah_agent_list`/`agent_list`: `ptahAPI.agent.list()` awaited first; its failure short-circuits with the pre-existing tool-error path and `listRoles` is never called — OK, both surfaces pinned.
8. On `agent.list()` success, `listRoles()` is called in its own `try/catch` (HTTP inline, stdio via `listRolesOrEmpty`) → `roles` defaults to `[]` and a warning is logged on rejection, never propagated — OK, D8 satisfied on both surfaces.
9. `formatAgentList(agents, roles)` renders one "Roles in this workspace: …" / "No agent roles generated…" line and, per agent row whose `CliDetectionResult` carries `roleDelivery`+`roleChannel`, an appended "role delivery: x/y" in the Capabilities cell — OK, correctly distinguished from the per-instance `formatRoleLine` used by spawn/status (see Q3).
10. stdio's `structuredContent.roles` is populated from the same `listRolesOrEmpty()` call reused for the markdown render — OK, single source, no double-fetch.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| `AgentSpawnArgsSchema`: exact stdio shape + `role` + `.strict()` (Task 5b.1) | COMPLETE | none |
| `role` in the JSON tool schema, vendor-free, `required` stays `['task']` (Task 5b.2) | COMPLETE | none — vendor-name-free pinned by spec |
| HTTP dispatcher parses with the shared schema, forwards/logs `role`, maps `AgentRoleError`/`CliCommandLineTooLongError`, `ptah_agent_list` degrades on `listRoles` failure (Task 5b.3) | COMPLETE | none |
| Formatters: role on spawn/status, role-delivery capability + roles line on list (Task 5b.4) | COMPLETE | none |
| stdio dispatcher: shared schema, `role` forwarded, `structuredContent` role fields, `AgentRoleError` → `toolError` with `state`/`availableRoles`, same `listRoles` degradation (Task 5b.5) | COMPLETE | stdio also maps `CliCommandLineTooLongError` with `state: 'command_line_too_long'`, a documented superset, not a gap |
| Surface parity guard: key-set equality + stdio-tool-equals-HTTP-tool-except-name (Task 5b.6) | COMPLETE | parity is checked on key names and full tool-definition equality only — does not (and by design cannot cheaply) check that a shared description string stays internally consistent with the schema it describes (see `timeout`, Moderate #2) |
| D8 amendment: both dispatchers wrap `listRoles()` in their own `try/catch`, `agent.list()` failure path unchanged | COMPLETE | none |
| Spec mocks gain `listRoles` (stdio-mcp-server, protocol-dispatcher, agent-tool.dispatcher) | COMPLETE | none |
| Spawn ordering unchanged (role resolved before disabled-CLI checks) | COMPLETE (unchanged, not touched by this batch) | none — this batch does not reorder anything upstream of `ptahAPI.agent.spawn` |

Implicit requirements not addressed: whether agent-facing `AgentRoleError` messages should redact absolute local paths (Moderate #1); keeping the `timeout` description honest as the schema's bound changes (Moderate #2).

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Unknown key on `ptah_agent_spawn` (HTTP) | YES | `.strict()` rejection, no spawn | none — deliberate behaviour change (Decision 2), documented |
| Unknown key on `agent_spawn` (stdio) | YES | `.strict()` rejection, no spawn (pre-existing behaviour, now via the shared schema) | none |
| `role: ''` on either surface | YES | `.min(1)` rejects before any resolver call | none |
| `role` of exactly 100 / 101 chars | YES | boundary-pinned both directions | none |
| `cli` outside `SYSTEM_CLI_TYPES` (incl. `'ptah-cli'` itself) | YES | enum rejection | none |
| `timeout` at 0 / large / negative | PARTIAL | 0 and large both accepted, negative rejected | tool description still claims a 1-hour max (Moderate #2) |
| `listRoles()` rejects while `agent.list()` succeeds (both surfaces) | YES | degrade to `[]` + warning, list still succeeds | none |
| `agent.list()` itself rejects | YES | pre-existing tool-error path; `listRoles` never called | none |
| Role-less spawn — no `role`/`roleDelivery`/`roleChannel` keys anywhere in the response | YES | `formatRoleLine` returns `undefined`; stdio spreads conditionally | none |
| Every one of the 7 `AgentRoleError` codes on both surfaces | YES | `it.each` over both dispatcher specs | none |
| `CliCommandLineTooLongError` on both surfaces | YES | measured/limit surfaced; stdio adds a structured `state` the HTTP surface has no channel for | none — documented superset |
| A generic (non-role, non-command-line) spawn rejection | YES | falls through to the pre-existing generic failure path unchanged | none |
| Absolute local paths inside a forwarded `AgentRoleError.message` | NO (unaddressed) | forwarded verbatim to the caller | low severity for a local tool; no redaction decision recorded (Moderate #1) |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: none blocking. The most consequential thing to get right before Task 6.1 (docs) closes this delivery is stating, for any external MCP client, that HTTP `ptah_agent_spawn` now rejects unknown keys it used to silently drop — every in-repo caller I found is already compliant, but an out-of-repo integration would see a new hard failure where it previously saw a quiet success.
- What a robust implementation would add: (1) fix the `timeout` description in `tool-description.builder.ts:544-548` to say what the schema actually enforces (no upper bound, or restate the real operational ceiling if one exists elsewhere in the spawn path); (2) a decision, recorded once, on whether `AgentRoleError` messages should keep absolute local paths now that they are MCP-tool-facing text on two surfaces, or move the path detail to a server-side log line and keep the caller-facing message workspace-relative.
