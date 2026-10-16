# Batch 31 (A15) — orchestration skill routing and outcomes

## PA-5

**Holds.** `content-manifest.json:8,41,53,58` names `apps/ptah-extension-vscode/assets/plugins` as the plugin source and lists all three edited skill paths. Harness sync consumes the plugin paths supplied at `apps/ptah-extension-vscode/src/activation/plugin-activation.ts:85-89`. The named asset files are the source; no synced copy was edited.

## Acceptance evidence

| Item | Evidence |
| --- | --- |
| Route at Pre-flight and Gate 0.1 | `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/orchestration/SKILL.md:30-36` calls `ptah_route_decide` at `pre-flight`, uses non-null answers, and records the result. `.../orchestration/references/lane-assignment.md:20-30` calls `gate-0.1` with the schema fields and records the chosen roster or disclosed fallback. |
| Lane spawn fields | `.../agent-lanes/SKILL.md:48-49,54-58` passes the chosen row's `taskKind` and `source` as `taskKind` and `routingSource` on `ptah_agent_spawn`; both are omitted without a routed row. Allowed values match `libs/shared/src/lib/types/lane-outcome.types.ts:17-24` and `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-spawn-args.schema.ts:45-50`. |
| Subagent deliverables | `.../orchestration/SKILL.md:138-145` calls `ptah_outcome_report` after each Agent run with `kind:'deliverables'`, the Ptah tag's `runId` or the Agent result's `agentId`, paths and optional task metadata. It keeps separate IDs for concurrent and repeated runs; `held` and `queued` count as reported. Contract: `libs/backend/lane-outcomes/src/lib/lane-outcome.schema.ts:7-27`; statuses: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tools/outcome-report.tool.ts:25-31`. |
| Review verdicts | `.../orchestration/SKILL.md:146-149` calls `ptah_outcome_report` with `kind:'review'`, the kept reviewed-run `runId` (or a lane `agentId`), and schema verdict `approved`, `rejected` or `revise`. |
| Optional tools | `.../orchestration/SKILL.md:30,138,146-149`, `.../orchestration/references/lane-assignment.md:20,29-30`, and `.../agent-lanes/SKILL.md:54-58` condition use on tool listing and skip silently when absent. |
| Family column | `.../agent-lanes/SKILL.md:20-23` names the `Family` column in the `ptah_agent_list` sample table. |
| Vendor-to-task tables | None in the three files. The roster table in `.../orchestration/references/lane-assignment.md:117-124` uses live lane rows, not named vendors. |

## Grep evidence

- `rg -n 'ptah_route_decide|ptah_outcome_report|taskKind|routingSource|runId|held|queued|Family' <three files>`: route hits at orchestration `SKILL.md:30`, lane assignment `:20`, agent lanes `:55-57`; report hits at orchestration `SKILL.md:138,146`; `Family` at agent lanes `:20`; `held`/`queued` at orchestration `SKILL.md:144-145`.
- `rg -n -i 'vendor|provider|claude|codex|cursor|gemini|grok|opencode|antigravity|glm|copilot' <three files>`: references at orchestration `SKILL.md:3`, lane assignment `:117,126`, agent lanes `:9,23,30-31,44,154,196,226,248,261`; none maps a named vendor to a task type.
- `rg -n -i '^\|[^\n]*(claude|codex|cursor|gemini|grok|opencode|antigravity|glm|copilot)[^\n]*\|[^\n]*(plan|implement|review|research|tests|docs|feature|bugfix)' <three files>`: no hits (exit 1).

## Validation

`npx prettier --check <three files>` passed after `--write`. `ptah_get_diagnostics` was called with the three changed Markdown paths; it returned unavailable because no requested file could be checked. Per decision #53, no Nx, Jest or build ran.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Use the plugin asset files as the only skill source edits. | Edit asset source only; also edit synced copies. | PA-5, `content-manifest.json:8,41,53,58`, `plugin-activation.ts:85-89`. | Yes. |
| Use the Gate 0.1 chosen row's `taskKind` and `source` for lane spawn metadata; omit both without a routed row. | Pass a guessed value; omit when unknown. | `route-decide-result.schema.ts` chosen entry and `agent-spawn-args.schema.ts:45-50`; latter keeps both optional. | Yes. |
| Report each subagent run once using the Ptah run tag first; treat `held` and `queued` as reported. | Retry those statuses; report by agent ID first. | R3 at `implementation-plan.md:657`, §13 at `implementation-plan-part-a.md:564-576`, outcome tool result at `outcome-report.tool.ts:25-31`. | Yes. |

## Anything not done

None within Batch 31 scope. Diagnostics do not analyze Markdown; Prettier and content checks are the verification evidence.
