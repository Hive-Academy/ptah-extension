# Frontend implementation — `TASK_2026_712_5d7c`, batch 26d

Compatibility for Batch 26, which appended `'claude'` as the 8th `SYSTEM_CLI_TYPES` member
(`libs/shared/src/lib/types/agent-process.types.ts:78-87`).

**Tasks completed**: items 1-5 of the orchestrator's typecheck sweep.

**Files** (worktree `D:/projects/ptah-extension/.claude-worktrees/provider-accounts-p1e`; 6 files):

- MODIFIED `libs/shared/src/lib/types/rpc/rpc-agents.types.ts` — `AgentListCliModelsResult` is now
  `Record<SystemCliType, CliModelOption[]>` (type-only import from `../agent-process.types`). The keys come
  from the tuple, so the type cannot drift again. This fixes TS7053 at `apps/ptah-cli/src/cli/commands/agent-cli.ts:448`,
  `lane-model-listing.adapter.ts:143` and `cli-model-effort-popover.component.ts:347/362`, plus their TS7006 cascades.
- MODIFIED `libs/backend/rpc-handlers/src/lib/services/cli-model-list.service.ts` — this is where the value is
  built. The `AgentListCliModelsResult` literal (`:83`) now has `claude: modelMap['claude'] ?? []`. That value
  comes from `CliDetectionService.listModelsForAll()`, which calls `ClaudeCliAdapter.listModels()` →
  `getNativeClaudeModels()`, the ambient native catalog. It runs no inference and no named-account query. The
  required key would otherwise give a TS2741 here.
- MODIFIED `libs/frontend/chat/src/lib/settings/ptah-ai/cli-orchestration-matrix.component.ts` — new
  `CLI_INSTALL_GUIDES.claude` entry: `command: null` and a note. The lane needs no separate install, because
  `ClaudeCliAdapter.detect()` (`claude-cli.adapter.ts:94-107`) reports it installed once the Claude Agent SDK
  (cli.js path plus query function) loads. The note ends with "Re-detect", as `cli-orchestration-matrix.component.spec.ts:756` requires.
- MODIFIED `libs/frontend/chat/src/lib/settings/ptah-ai/cli-permission-notes.ts` — new `FIXED_NOTES.claude`
  with the "Follows Autopilot" / `info` note. The wording is the same as `ptah-cli`'s, because the lane uses the same
  mapping: `resolveClaudeLanePermissionOptions` in `cli-agent-runtime/src/lib/claude/claude-sdk-lane-options.ts:193-252`
  maps yolo → `bypassPermissions` + `allowDangerouslySkipPermissions`, auto-edit → `acceptEdits`, plan → `plan`,
  and anything else → `default` with the `canUseTool` approval callback.
- MODIFIED `libs/frontend/tribunal-panel/src/lib/services/tribunal-run-framing.ts` — `spawnArgsFor` gets
  `case 'claude': return \`cli: "claude"${modelArg}\``. That follows the codex/copilot/grok model-arg shape and fixes TS2366.
  It passes no account argument, so the framing never selects a named account (D7 stays fail-closed in the runtime).
- MODIFIED `libs/shared/src/lib/types/provider-account-binding.spec.ts` — `:174` used to assert `not.toContain('claude')`.
  It now asserts the whole tuple with `toEqual`: the original seven in order, then `claude` last. It also asserts
  `not.toContain('ptah-cli')`.

`lane-model-listing.adapter.ts` was NOT edited. Its value path is `listed[cli]` from `CliModelListService.listAll()`,
which now carries `claude`. Its spec fixture already has `claude: []` (`lane-model-listing.adapter.spec.ts:48`).

**Stack observed**: Angular standalone components. The edited UI files are plain `Readonly<Record<…>>` constant
maps, with no template or state change. Shared types come from `@ptah-extension/shared`.

**Design fidelity**: no design handoff. The copy follows the neighbouring rows: the grok/cursor install notes and the
ptah-cli permission note.

**States covered**: none changed. The matrix row for `claude` still renders only when detection reports it
(`cli-matrix-rows.ts:177-184`).

**Verification**: per the brief, I ran no nx/jest/tsc/lint. `ptah_get_diagnostics` on the 6 changed files twice returned
"TypeScript check still running after 45s" (unavailable, 6 unchecked), so no diagnostics result was obtained.
The orchestrator's typecheck/test sweep is the verification of record.

## Decisions

- **Type shape**: I used a `Record<SystemCliType, CliModelOption[]>` type alias instead of adding a `claude` field to the interface.
  The alternatives were adding the field by hand, or an empty interface extending Record (`no-empty-interface` lint).
  Evidence: `agent-cli.ts:438` already documents that the keys "ARE `SYSTEM_CLI_TYPES`". Reversible.
- **File swap within the 6-file cap**: the value fix belongs in `cli-model-list.service.ts`, not in
  `lane-model-listing.adapter.ts`, which needed no change. That makes the file count 6. Reversible.
- **Not adding `claude` to `PENDING_USER_REVIEW_IDS`**: the copy is new and should be reviewed, but
  `cli-permission-notes.spec.ts:102-108` pins that list to `['copilot','grok','ptah-cli']` and I do not own the spec.
  The source comment flags the copy as NEW. Follow-up below.

## Plan deviations

- I edited `cli-model-list.service.ts` instead of `lane-model-listing.adapter.ts` (see Decisions).

## Follow-ups needed outside my ownership (file:line)

1. `libs/backend/rpc-handlers/src/lib/services/cli-model-list.service.spec.ts:21-29` — the `modelMap: AgentListCliModelsResult`
   fixture has no `claude` key, which is a TS2741 under a type-checked spec run. Add `claude: []`, or a sample and
   assert `listAll().claude`.
2. `libs/frontend/chat/src/lib/settings/ptah-ai/cli-model-effort-popover.component.spec.ts:51-61` — the `CATALOGUE` fixture
   is missing `claude`. It was also already missing `grok` before this batch. Add `grok: [], claude: []`.
3. Optional, for copy review: add `'claude'` to `PENDING_USER_REVIEW_IDS` (`cli-permission-notes.ts:17-21`) and update
   `cli-permission-notes.spec.ts:102-108` (and its test title) to match.

## Existing specs that pin these maps, switches and types

- `libs/frontend/chat/src/lib/settings/ptah-ai/cli-permission-notes.spec.ts:7,10-17,76-83,110-119` — tuple-driven `ALL_IDS`.
  `claude` now gets a non-empty badge, tone and detail, is not affected by the Copilot value, and has no "quota" wording. All of these hold.
  `:102-108` pins `PENDING_USER_REVIEW_IDS` (unchanged).
- `libs/frontend/chat/src/lib/settings/ptah-ai/cli-orchestration-matrix.component.spec.ts:749-757` — the codex/copilot
  commands, plus every guide note containing "Re-detect". Both hold.
- `libs/frontend/chat/src/lib/settings/ptah-ai/cli-matrix-rows.spec.ts:348,496` — permission equality for codex and ptah-cli (unaffected).
- `libs/frontend/tribunal-panel/src/lib/services/tribunal-run-framing.spec.ts:36` and
  `tribunal-run.service.spec.ts:84,182-185,229-230,476,496` — exact spawn strings for codex/copilot/cursor (unaffected).
  No spec has a claude case yet.
- `libs/frontend/tribunal-panel/src/lib/services/tribunal-discovery.service.ts:34,51,202` uses `keyof AgentListCliModelsResult`.
  That key now includes `claude` (widening only).
- `libs/backend/rpc-handlers/src/lib/services/lane-model-listing.adapter.spec.ts:34-48` — `emptyListed()` already has `claude`.
- `libs/backend/rpc-handlers/src/lib/services/cli-model-list.service.spec.ts:141-161,167-168` — `listForClassification` key
  order and `claude: []`. Unchanged by this batch; fixture gap at `:21` (see above).
- `apps/ptah-cli/src/cli/commands/agent-cli.spec.ts:147-166,461,788,1099-1105` — tuple-driven `it.each`, so claude is a case
  (per the Batch 26 report). The type fix covers `agent-cli.ts:441-456`.
- `libs/shared/src/lib/types/provider-account-binding.spec.ts:162-185` — updated here.

## Out-of-scope observations

- `libs/frontend/skill-synthesis-ui/src/lib/components/clones/agent-models.store.ts:49-60` reads only codex/copilot/cursor/opencode
  from the lists. It still compiles and does not need claude.
