---
status: planned
type: feature
title: 'Lanes: model discovery in ptah_agent_list and a persisted lane outcome ledger'
depends_on: []
blocks: [TASK_2026_536, TASK_2026_537]
---

# TASK_2026_535 — Lane model discovery + lane outcome ledger

## Why

1. The orchestrator cannot choose a model for a lane. `ptah_agent_list` shows
   type/status/capabilities only (`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.ts:491-546`),
   yet `ptah_agent_spawn` accepts `model` / `modelTier`, and `agent-lanes` §2 says
   "read ids from that lane's own model list" — a list no tool exposes.
2. Nothing remembers how lanes performed. `AgentProcessInfo`
   (`libs/shared/src/lib/types/agent-process.types.ts:111-153`) and the
   `LaneCompletionSignal` verdict (`:449-475`) live in an in-memory Map
   (`cli-agent-runtime/.../agent-process-manager.service.ts:135`). Only a thin
   `CliSessionReference` is persisted into `ptah.sessionMetadata[parent].cliSessions`
   (`wiring/agent-events.ts:305-438`) — no model, role, exit code, verdict,
   deliverables or reports. Routing by evidence (TASK_2026_537) needs this history.

## Scope

### A. Model discovery
- `ptah_agent_list` gains optional `includeModels: boolean` (default false).
  - System CLI rows: configured default model + reasoning effort
    (`agentOrchestration.<cli>Model` / `<cli>ReasoningEffort`) and available ids
    from the adapter's `listModels?()` (`cli-adapter.interface.ts:209`), same source
    as the `agent:listCliModels` RPC. Per-adapter timeout, cache with TTL, capped
    list; a failing adapter shows `models: unavailable (<reason>)`, never blocks the list.
  - ptah-cli rows: tier → model mapping (effective, via `resolveEffectiveTiers`,
    `ptah-cli-registry.ts:1479-1523`) and pinned `selectedModel`.
- `ptah_agent_spawn` validates `model` against the adapter list when one is
  available; clear error instead of a CLI-side failure. Unknown list → pass through
  with a warning.
- Keep `vendor-roster-drift.spec.ts` / `lane-rule-single-home.spec.ts` green (no
  hard-coded rosters or model names in tool descriptions).

### B. Lane outcome ledger (SQLite, new migration in `libs/backend/persistence-sqlite`)
- Table `lane_runs`: agent_id, parent_session_id, workspace_root, cli, ptah_cli_id,
  provider_id, model (resolved, not requested), model_tier, role, task_hash +
  task_excerpt, task_folder, started_at, completed_at, duration_ms, status,
  exit_code, verdict, deliverables_json (declared + existence/size), reports_json
  (bodies of `ptah_agent_report`, today only counted at
  `agent-process-manager.service.ts:880`), cli_session_id, sdk_session_id,
  resumed_from_agent_id, output_ref (key of `ptah.agentOutput:<agentId>`).
- Written on spawn and on terminal status (same hook as the completion notifier,
  `lane-completion-notifier.service.ts`). Never NULL-coalesce unknowns
  (repo rule: unknown stays NULL).
- Read API: RPC `lanes:listRuns` (filters: parent session, cli, model, role,
  verdict, date) for later UI and for TASK_2026_536/537.
- Retention setting; excerpt only, full task text not stored by default.

### C. Skill rule (plugin source `ptah-core/skills/agent-lanes/SKILL.md` §1–§2)
- Call `ptah_agent_list({ includeModels: true })` before choosing lanes for a phase.
- Pick model by task weight from LISTED ids only (design/architecture/review/
  write-path tracing → strongest listed or `opus`; implementation → default or
  `sonnet`; mechanical/mirroring → fastest or `haiku`). State lane + model + reason
  in the cost announcement and summary. No model names in skill text.
- Mirror to `.claude/skills`, regenerate `content-manifest.json`.

### D. Role contract vs declared deliverables (found in TASK_2026_534)
- A `code-logic-reviewer` lane refused the declared deliverable
  `code-logic-review-r2.md` because its role contract names
  `code-logic-review.md`, overwrote its round-1 review, and the completion signal
  reported `no-deliverable` for work that was done. The declared `deliverables`
  must win over a role's default file name (tell the lane so in the role
  preamble), or `ptah_agent_spawn` must reject the conflict at spawn time. A
  role must never silently overwrite an earlier deliverable; append or version.
- Record the conflict in `lane_runs` so scorecards do not count it as a failure.

## Out of scope
UI for the ledger; judging trajectories (TASK_2026_536); classification (TASK_2026_537).

## Acceptance
- `ptah_agent_list({includeModels:true})` on this machine lists models for codex,
  antigravity, opencode and the configured ptah-cli agent, within a bounded time
  even when one adapter hangs (test with a stub adapter).
- A spawn → completion cycle produces one `lane_runs` row with resolved model,
  verdict and reports; resume links `resumed_from_agent_id`.
- Specs for formatter, validator, migration, ledger writer. Scoped
  `nx run-many -t typecheck,test,lint` on changed projects.

## Process
Full orchestration with the new gates (TASK_2026_533). Write-path trace required
for the ledger writer.
