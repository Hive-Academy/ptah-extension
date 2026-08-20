# TASK_2026_158 — Context

## User Request

Link the task-management system (TASK_2026_157) to the earlier skill-synthesis judge/enhance work in the Thoth Skills tab. Task specs should become the evaluation substrate for **subagents and orchestration skills** in the Library tab: evaluate each subagent individually and optimize its definition for performance, success rate, and token consumption.

## Linked Prior Work (the "task we tried before")

Predates the formalized spec system, so no `.ptah/specs` folder exists — reconstructed from memory + code:

- **TASK_2026_113 — skill-synthesis overhaul**: `SkillJudgeService` (5-criteria LLM judge at promotion + suggestion gates), `SkillCuratorService`, cluster dedup, 17 `skillSynthesis.*` config fields editable from the Thoth UI.
- **TASK_2026_THOTH_SKILL_CLONE_ENHANCE**: judge-gated auto-enhancer for skills/**agents**/commands with the Library (Clones) UI. Eligibility = `getInvocationStats(slug).total ≥ MIN_INVOCATIONS_TO_ENHANCE` + cooldown.
- **Skills-tab redesign (3 rounds)**: wired subagent usage recording — `Task` tool use records `source:'subagent'` events keyed by `subagent_type` slug so agent clones accrue invocations and become enhance-eligible.
- **Spec Harvester** (`libs/backend/skill-synthesis/src/lib/spec-harvester.service.ts` + `spec-extractor.ts`): reads `.ptah/specs/TASK_*`, reconciles optimistic `succeeded:true` subagent events against graded `tasks.md` batch verdicts (per-batch `**Recommended Executor**` slug + COMPLETE/FAILED), feeds review findings into the enhancer via `SpecFindingsPort` (`getRecentFindings(slug)`). Already frontmatter-only after TASK_2026_157 (`parseTaskFile` from `@ptah-extension/task-specs`).

## Existing Signal Sources (all present, never joined)

1. **Graded quality** — spec folders: per-batch executor verdicts in `tasks.md`, review findings in `code-logic-review.md`/`test-report.md`; task-level `status`/`executor` in `task.md` frontmatter; SQLite derived task index (migration 0029, `task-specs` lib).
2. **Usage + success rate** — `skill_invocation_events` (persistence-sqlite, slug-keyed): `source:'subagent'`, `succeeded` boolean, reconciled by the harvester. **No token/cost/duration columns.**
3. **Tokens/cost/duration per agent** — execution tree only: `libs/shared/src/lib/utils/subagent-cost.utils.ts` (`getAgentCostBreakdown` → per-`agentType` tokens, cost, depth, toolCount) computed from `streamingState` for display. **Never persisted per subagent slug.**

## Identified Gaps (candidate scope)

1. **Persist per-invocation metrics**: extend `skill_invocation_events` (or a sibling table, forward-only migration) with input/output/cache tokens, cost, duration, tool count — captured at SubagentStop (hook already flows through `SkillTriggerService.onPostToolUse` → `SkillInvocationRecorder`) or from the execution-tree breakdown keyed by `subagent_type`.
2. **Precise task↔invocation join**: harvester currently joins by slug + time-window heuristic. TASK_2026_157's task index + `executor` frontmatter field enable an exact `task_id` attribution on events.
3. **Per-subagent scorecard in the Library tab** (`skill-synthesis-ui`): success rate (reconciled), avg/total tokens, avg cost, invocation count, recent spec verdicts + findings — surfaced on agent clone cards.
4. **Metrics-aware enhancer**: `SkillEnhancerService.generateCandidate` prompt for agents should include the scorecard (failure patterns from spec findings, token-heaviness) so enhancement targets success rate AND token efficiency, not just generic best practices.
5. **Judge criteria for agents**: `SkillJudgeService` scores skill-authoring criteria; agent enhancement verdicts could weigh measured outcomes (did post-enhancement success rate/tokens improve — requires before/after snapshot on the clone history).

## Constraints / Guardrails

- Hexagonal: `skill-synthesis → task-specs` dependency already exists and is acyclic; keep `agent-sdk` free of `skill-synthesis` imports.
- New RPC methods (if any) follow the dual-registration rule (shared types + `ALLOWED_METHOD_PREFIXES`).
- Files remain source of truth; SQLite stays a rebuildable derived index.
- Migrations are forward-only, appended to the MIGRATIONS tuple in `persistence-sqlite`.
- Library tab ships in both VS Code + Electron (`skill-synthesis-ui`); scorecard must degrade gracefully where the spec harvester is a no-op (runtimes without `.ptah/specs`).

## Task Type / Strategy

- **Type**: FEATURE — Full workflow (project-manager → software-architect → team-leader → QA)
- **cli_delegation**: ENABLED, RESTRICTED (Checkpoint 0.1, 2026-07-15) — ptah-cli "ollama cloud" (ptahCliId: pc-d8f4e156-fa15-4dc6-92ba-8e088e7e9ae9) is the primary junior helper; copilot allowed for SMALL tasks only; codex FORBIDDEN. Max 3 concurrent; orchestrator/sub-agents own quality of CLI output.

## Decisions Log

- 2026-07-15: Task created in `backlog`, linked via `depends_on: [TASK_2026_157]`; scope above is a proposal — PM/architect refinement happens when the task is started from the board.
- 2026-07-15: Checkpoint 0.1 — CLI delegation enabled restricted to ollama-cloud ptah-cli + copilot (small tasks); codex excluded (user decision).
- 2026-07-15: Checkpoint 1 APPROVED by user (no changes). R1–R10; groups A–D MUST, E deferred with R10 enabler hook.
- 2026-07-15: Checkpoint 1.5 skipped — established codebase patterns cover the architectural forks (migration style, telemetry capture point, port seams).
- 2026-07-15: Checkpoint 2 APPROVED by user (no changes). D1–D9 stand: migration 0030 widens skill_invocation_events; SubagentMetricsExtractor at SubagentStop seam via JsonlReaderService (agent-sdk untouched); task_id from specs-path in subagent first prompt; harvester exact (slug, task_id) reconcile with window fallback; 2 new skillSynthesis: RPC methods + AgentScorecard DTO (prefix already allowlisted); enhancer ≤1200-char scorecard block for agent kind; R10 = no-gap.
