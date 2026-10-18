# Batch 7 (A1b) report — row `family` + spawn routing fields

Worktree: `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing`
Status: implemented. Not verified by Jest/Nx in this lane (decision #53) — the
team-leader runs the Batch 7 verification.

## Files created or modified (absolute paths)

1. `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\agent-spawn-args.schema.ts` (MODIFY)
2. `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\agent-spawn-args.schema.spec.ts` (MODIFY)
3. `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\agent-namespace.builder.ts` (MODIFY)
4. `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\agent-namespace.builder.spec.ts` (MODIFY)
5. `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\mcp-response-formatter.ts` (MODIFY)
6. `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\mcp-response-formatter.spec.ts` (MODIFY)

No other file was touched. No git command was run.

## IA-1 result (grep `effort` along the `ptah_agent_spawn` path)

The args → `SpawnAgentRequest` mapping is NOT in Batch 7's file set. There are
two mapping sites, one per transport surface, and both files belong to
Batch 29 (A9a/A9b, `implementation-plan-part-a.md:931`):

- HTTP: `mcp-core/protocol-dispatcher.ts:1212-1227` — parses with
  `AgentSpawnArgsSchema` at `protocol-dispatcher.ts:1156` and builds the request
  at `protocol-dispatcher.ts:1226` (`effort: spawnArgs.effort`, the `role`
  sibling is `protocol-dispatcher.ts:1225`).
- stdio: `mcp-stdio/agent-tool.dispatcher.ts` — parses at line 384, reads
  `effort` at line 399, and builds the request in `ptahAPI.agent.spawn({...})`
  at `agent-tool.dispatcher.ts:434-448` (`effort: p.effort` at line 448).

Per the validation note, neither was edited. The team-leader must move the
`taskKind`/`routingSource` copy lines to Batch 29 (AB9), which already owns both
files. Until then the schema accepts both fields (they parse) but no surface
forwards them into `SpawnAgentRequest`.

The stdio `agent_list` surface needs no Batch 29 change for the family:
`mcp-stdio/agent-tool.dispatcher.ts:786-792` calls `ptahAPI.agent.list()` and
renders through the shared `formatAgentList`, so it inherits both the row
stamping and the new column as is.

## Task 7.1 evidence

### `family` on agent rows

- `agent-namespace.builder.ts:479-486` — the `list` row builder now stamps
  `family: laneFamilyOf(r)` on every row it returns (SC-5: the row builder is
  the one place family is computed), before the preferred-rank mapping. Import
  added at `agent-namespace.builder.ts:32-37`.
- `mcp-response-formatter.ts:1742-1746` — `agentListRow` computes
  `const familyCell = agent.family ?? 'N/A'`; the cell is added after `Type` in
  both branches (`mcp-response-formatter.ts:1751`, `:1777`).
- `mcp-response-formatter.ts:1808` — table headers gain `'Family'`:
  `['Agent', 'Type', 'Family', 'Status', 'Capabilities']`; `Limit state`
  stays appended last, so its header logic is unchanged.
- Contracts used (commit c51b98335, verified before writing):
  - `CliDetectionResult.family?` — `libs/shared/src/lib/types/agent-process.types.ts:409-415`
    ("Computed by the row builder, so rows it did not fill in carry no family").
  - `laneFamilyOf` — `libs/shared/src/lib/utils/lane-family.ts:32-42`, exported
    through the barrel (`libs/shared/src/index.ts:61` → `./lib/utils`).

### `taskKind` / `routingSource` on spawn

- `agent-spawn-args.schema.ts:42-50` — inside the `.strict()` object, following
  the `role`/`effort` neighbours:
  - `taskKind: z.enum(OUTCOME_TASK_KINDS).optional()`
  - `routingSource: z.enum(['model', 'ranking', 'pin']).optional()` — plan
    verbatim (SC-6, `implementation-plan.md:238-240`); `'not-routed'` is
    rejected because the write edge records it when the field is absent.
  Import at `agent-spawn-args.schema.ts:2`. `OUTCOME_TASK_KINDS` is exported
  via `libs/shared/src/index.ts:26` → `./lib/types/lane-outcome.types`
  (`libs/shared/src/lib/types/lane-outcome.types.ts:17-25`), same `as const`
  shape as the already-imported `SYSTEM_CLI_TYPES`
  (`agent-process.types.ts:74-82`), so `z.enum` accepts it.
- Copy into `SpawnAgentRequest`: intentionally not done — see IA-1.

### Spec changes

- `agent-spawn-args.schema.spec.ts`
  - "accepts the full documented shape" now includes
    `taskKind: 'review'` / `routingSource: 'ranking'`.
  - New tests: `taskKind` accepted for every `OUTCOME_TASK_KINDS` value and
    parsed back; rejected outside the enum; `routingSource` accepted for
    `model`/`ranking`/`pin` and parsed back; `'not-routed'` rejected;
    both fields left `undefined` when the spawn did not name them.
- `agent-namespace.builder.spec.ts`
  - The strict `toEqual` list fixture ("preferredRank: 0 when no registry")
    now expects `family: 'codex'` on the row.
  - New test "stamps every row with its lane family": a detected CLI row →
    its cli value, a Ptah CLI row with `providerId` → the provider id, and
    one without → the `ptah-cli:<id>` fallback
    (`lane-family.ts:32-42`).
- `mcp-response-formatter.spec.ts`
  - F52 byte-lock re-locked for the deliberate new column: fixtures gained
    `family`, expected table now
    `| Agent | Type | Family | Status | Capabilities |` with matching
    json2md separator `| ----- | ---- | ------ | ------ | ------------ |`.
  - New test: family printed per row, `N/A` for a row that carries none.

## Validation notes handled

- IA-1 done first; result above. Mapping lines left for Batch 29 as the note
  instructs.
- Byte-lock survey: the only code-level locks on the agent-list table are in
  `mcp-response-formatter.spec.ts` (F52, updated) and the self-referential
  `agent-spawn-limits.transport.spec.ts:585` (both sides computed from the
  same rows, so it stays green without an edit; that file is not Batch 7's).
  `mcp-contract.sweep.spec.ts` fixtures put their marker in the first `cli`
  cell, so the appended column cannot move it; its rows carry no family and
  print `N/A`.
- Not run in this lane, per decision #53 (team-leader verifies):
  `J(libs/backend/vscode-lm-tools, mcp-response-formatter.spec.ts,
  agent-namespace.builder.spec.ts, agent-spawn-args.schema.spec.ts)` and
  `npx nx typecheck @ptah-extension/vscode-lm-tools`.
- Risk noted: until Batch 29 copies the two fields into the request, a spawn
  that passes `taskKind`/`routingSource` parses but silently drops them at the
  mapping site. That is the designed sequencing, not a gap in this batch.