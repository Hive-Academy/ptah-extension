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

Decide at Gate 0.1 when this task starts.

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
