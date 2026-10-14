# Task Context - TASK_2026_646_136a

## User Request

> i think we could use decisions models to help make these important decisions about what task type we
> should use, what lanes and providers models and subagents models we should use for certain tasks ? we
> can let users set their decisions model like https://ollama.com/search?c=decision or jev

## Task Type

FEATURE

## Complexity

Complex

## Strategy

FEATURE, Full: PM → researcher-expert → architect → team-leader → QA. Starts after TASK_2026_441_7825
lands, because that task defines the lanes-first rules and the lane-limit fallback this model chooses
inside.

## CLI Lanes

Gate 0.1 (2026-10-14). Preference source: memory ("lanes first, codex first; review cross-side") and
the current request ("utilize all of our cli tools, not only one"). Mode `enabled`.
Approval: lane-review.

| Agent | Type | Status | Limit state |
| --- | --- | --- | --- |
| codex | cli | installed | unknown (limit lookup timed out) |
| copilot | cli | disabled (installed) | unknown (limits not tracked) |
| cursor | cli | not installed | — |
| antigravity | cli | installed | unknown (reader failed) |
| opencode | cli | installed | unknown (limit lookup timed out) |
| pi | cli | not installed | — |
| grok | cli | installed | unknown (API key, no plan) |
| Glm | ptah-cli | available (Ollama Cloud, pc-355b645d-35af-4974-84cf-9cf961ea0164) | unknown (no windows reported) |

## Scope additions (2026-10-14)

User request, same session:

> can we orchestrate and work on the decision model now ? i think it will be a great addition specially
> we have lanes like Glm, opencode, grok as implementors and executors and also codex, and claude main
> agent as capable models and that list can grow more than that as well [...] make it more focused only
> on our own ptah skills enhancements and lanes evaluations for better matrix and better agents
> providers utilizations

Agreed additions to the shape above:

1. **Lane outcome record.** Record per lane, provider, model, role and task kind: deliverable verdict
   (`delivered` / `no-deliverable` / `failed`), review verdict and revise rounds, failure class,
   duration, tokens and cost. Reuse the per-agent invocation/token/cost telemetry that the Library tab
   already shows. Its "Success 100%" figure is the same for every agent, so it carries no signal;
   replace it with these outcome signals.
2. **Capability matrix as data, not skill text.** One profile per lane family and model: strengths per
   task kind (plan, implement, review, research, tests, docs), with `source` and `asOf`. Seeded from
   public model-routing data as of October 2026; user-editable; local outcomes override the seed.
   Never a fixed vendor list in a skill.
3. **Spread rule in code.** Rotate between lanes whose scores are close instead of always picking the
   top one; prefer lanes with confirmed room. Hard constraints stay: never the implementer as
   reviewer, never AT LIMIT, the never-on-a-lane list, the batch cap. The roster must grow without
   code changes (any new `ptah_agent_list` row).

Out of scope: trimming or removing skill-synthesis, trajectory or learning-episode features. That is a
separate task with its own parity inventory and user-approved removals.

## Conversation Summary

Agreed shape (2026-10-13 session):

1. **Setting.** A "Decision model" role under Settings → Agent Orchestration → Background Model Roles
   (`libs/frontend/chat/src/lib/settings/ptah-ai/orchestration-settings.component.ts`). Choices: an Ollama
   decision model, TypeSafe Jev, or a normal model with structured output. Optional — unset means today's
   rule tables.
2. **Tool.** One MCP tool (working name `ptah_route_decide`). Input: the request text, the
   `ptah_agent_list` rows with limit state, memory preferences, past lane outcomes. Output (typed):
   `{ taskType, depth, roster[], confidence, reasons }`. A skill cannot call Ollama or Jev directly.
3. **Decisions it may make:** task type and depth; lane or subagent per phase; model or tier per phase;
   lane failure class (`usage-limit` / `auth` / `crash` / `timeout` / `bad-output`) from CLI output.
4. **Code keeps hard constraints:** never the implementer lane as reviewer, never an AT LIMIT lane, the
   "never on a lane" list, the batch cap. The model selects only from options code supplies; it never
   invents a lane or a model id. Low confidence → rule table, logged in `decisions.md`.
5. **Skill.** `orchestration` calls the tool at Pre-flight and Gate 0.1 and shows the result as a table
   (phase → executor → model → reason) the user can override.

## Open questions for research

- Ollama decision models seen 2026-10-13: tev1 (0.8b/4b, Together AI), nimble (9b, Bespoke Labs),
  clef-flash (9b) and clef (27b, Cloudflare; "a state and a schema of typed questions into decisions"),
  laya (421M, ModernBERT-large). The Ollama page does not define the category or the input format.
- Jev API contract, auth and limits: read https://docs.typesafe.ai/llms.txt (see the `typesafe-ai` skill).
- Ptah does not record lane outcomes (success, failure class, task kind) today; the model's quality
  depends on that history. Decide where it is stored.

## Scope additions 2 (2026-10-14, user "go" — after Gate 1)

User words: "go , i like retiring old and unused code that bloating everything around it".
Evidence: `.ptah/specs/TASK_2026_659_cec4/` (evaluation-report.md, parity-inventory.md, task-triage.md).
Skill synthesis is switched off (`skillSynthesis.enabled = false`) and will be purged by TASK_2026_662_3eea,
which depends on this task.

1. **Carve-out design (architect).** The plan designs ONE new home, outside `libs/backend/skill-synthesis` and
   `libs/frontend/skill-synthesis-ui`, for every part the purge keeps:
   - per-run subagent invocation telemetry (`skill_invocation_events`) — the subagent source of Requirement 5;
   - graded session verdicts (`skill_session_verdicts`) and the spec harvester — re-pointed to write review
     verdicts into the outcome record (the harvester is paused today by the master switch);
   - skill-load counting (Skill tool and prompt-expansion events);
   - the Library: manual edit, clone, history and revert of skills and agents, and its Agents-tab metrics
     (Requirement 9).
   This task IMPLEMENTS the moves of telemetry, verdicts and skill-load counting (Requirement 5 needs them).
   The Library move and every deletion belong to TASK_2026_662_3eea, which follows this plan's design.
2. **`skillsLoaded: string[]`** on every outcome record: the skill slugs loaded during the run, from the
   Skill tool and prompt-expansion events of the same session or context id. Unknown → null, never `[]`.
   Consumer: TASK_2026_661_6b5f (skill value metric).
3. **Merged tasks.** TASK_2026_535 (model discovery, lane ledger, skill rule) → Requirements 11, 5, 8.
   TASK_2026_537 (typed intake routing) → Requirement 2. 537's gate-trigger flags
   (replacesExistingSurface, touchesUiSurface, …), review classifiers and local classifier training are NOT
   in scope; they are a possible later use of the same `/v1/systemone` client. 535 §D/§E bug fixes moved to
   TASK_2026_663_50d4.
