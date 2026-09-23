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

- Table `lane_runs`: `run_id` (primary key; `agent_id` nullable and indexed),
  agent_id, parent_session_id, workspace_root, cli, ptah_cli_id,
  provider_id, model (resolved, not requested), model_tier, role, task_hash +
  task_excerpt, task_folder, started_at, completed_at, duration_ms, status,
  exit_code, verdict (including `role-conflict`, distinct from `no-deliverable`),
  report_channel, mcp_available, adapter_error (real message),
  failure_kind (`task`, `quota`, `adapter`, `timeout`, `role-conflict`; NULL on
  success or when unknown),
  deliverables_json (declared + existence/size), reports_json
  (bodies of `ptah_agent_report`, today only counted at
  `agent-process-manager.service.ts:880`), cli_session_id, sdk_session_id,
  resumed_from_agent_id, output_ref (key of `ptah.agentOutput:<agentId>`).
- Written on spawn, spawn-time role-conflict rejection and terminal status
  (same hook as the completion notifier,
  `lane-completion-notifier.service.ts`). Never NULL-coalesce unknowns
  (repo rule: unknown stays NULL).
- Read API: RPC `lanes:listRuns` (filters: parent session, cli, model, role,
  verdict, date) for later UI and for TASK_2026_536/537.
- Retention setting; excerpt only, full task text not stored by default.

### C. Skill rule (plugin source `ptah-core/skills/agent-lanes/SKILL.md` §1–§2)

- Call `ptah_agent_list({ includeModels: true })` before choosing lanes for a phase.
- Pick only ids returned by discovery: strongest suitable listed model for
  design/architecture/review/write-path tracing; a suitable listed model for
  implementation; fastest suitable listed model for mechanical/mirroring work.
  `modelTier` is valid only for a ptah-cli lane that lists a tier mapping. If no
  listed id fits, use the lane's configured default and say so, or pick another
  lane — never invent an id. State lane + model + reason in the cost announcement
  and summary. No model names in skill text.
- Mirror to `.claude/skills`, regenerate `content-manifest.json`.

### D. Role contract vs declared deliverables (found in TASK_2026_534)

- A `code-logic-reviewer` lane refused the declared deliverable
  `code-logic-review-r2.md` because its role contract names
  `code-logic-review.md`, overwrote its round-1 review, and the completion signal
  reported `no-deliverable` for work that was done. The declared `deliverables`
  must win over a role's default file name (tell the lane so in the role
  preamble), or `ptah_agent_spawn` must reject the conflict at spawn time. A
  role must never silently overwrite an earlier deliverable; append or version.
- Record `verdict: role-conflict` and `failure_kind: role-conflict` in `lane_runs`;
  scorecards exclude it from lane failures. A spawn-time rejection still writes
  a row with its own `run_id`, `status: rejected`, those conflict values and NULL
  `agent_id`/process fields, so audits see it even though no process was started.

### E. OpenCode MCP reporting and adapter errors (found in TASK_2026_533, PR #582)

- OpenCode lanes do not receive the Ptah MCP server: their tool catalog has no
  `ptah_*` tools, so completed work cannot call `ptah_agent_report` and shows
  "Reports sent: 0".
- Root cause (confirmed): OpenCode v2 (`opencode run`, v2.0.12 here) attaches to
  the shared background service unless `--standalone` is passed ("Run with a
  private server instead of the background service"). The adapter sets
  `OPENCODE_CONFIG_CONTENT` only on the spawned client
  (`opencode-cli.adapter.ts:~555-561`), so the service that runs the session never
  sees the `mcp.ptah` entry. The OpenCode log shows one server process
  (`run=0b608f22`, `role=server`) serving every worktree, including these lanes —
  lanes also share state across worktrees. Fix: pass `--standalone` when the
  installed version supports it (v1 lacks the flag; detect via version or
  `run --help`), test the spawn args, and correct the adapter's v1-era header
  comment.
- Probe MCP availability per run; show it in `ptah_agent_list` next to `messaging:`
  and persist it in `lane_runs`. Until reporting is available, record
  `report_channel: none`; scorecards do not penalise a missing report.
- OpenCode failed twice with "[Error] Unknown error" in session
  `ses_f30756f2affeWVWDVqx2F4ne8S` (once mid-run, once 16 s after resume). The
  real cause was the user's OpenCode usage limit: the adapter replaced a
  provider quota error with a generic wrapper, so the orchestrator retried a lane
  that could not succeed. Capture the real message in `lane_runs.adapter_error`,
  classify quota/limit failures (`failure_kind: quota`) separately from task
  failures, surface them in the completion signal, and do not resume a lane that
  failed on quota — reassign or wait. Scorecards do not count quota failures
  against the model's task quality.

## Out of scope

UI for the ledger; judging trajectories (TASK_2026_536); classification (TASK_2026_537).

## Acceptance

- `ptah_agent_list({includeModels:true})` on this machine lists models for codex,
  antigravity, opencode and the configured ptah-cli agent, within a bounded time
  even when one adapter hangs (test with a stub adapter).
- A spawn → completion cycle produces one `lane_runs` row with resolved model,
  verdict and reports; resume links `resumed_from_agent_id`.
- A role/default-filename conflict records `role-conflict`, not `no-deliverable`,
  as the verdict and failure kind. A spawn-time rejection writes a `lane_runs`
  row with its own `run_id`, `status: rejected` and NULL `agent_id`/process fields;
  multiple rejected rows can coexist. Neither case increases the scorecard's
  lane-failure count.
- An OpenCode run with the Ptah MCP server can call `ptah_agent_report`; an
  unavailable server shows the probe result next to `messaging:` and records
  `report_channel: none` without a missing-report penalty. A provider
  usage-limit failure is recorded with its real message and `failure_kind: quota`,
  is shown as such in the completion signal, and is not counted as a task failure.
- Specs for formatter, validator, migration, ledger writer. Scoped
  `nx run-many -t typecheck,test,lint` on changed projects.

## Process

Full orchestration with the new gates (TASK_2026_533). Write-path trace required
for the ledger writer.
