# Task Context - TASK_2026_857_f660

## User Request

"lets do this with our subagents and cli lanes to cover each piece please" — referring to the
orchestrator's proposal in chat:

1. Learning integrity: confirm failures are recorded; set taskKind on the host (never null);
   record subagent outcomes in the production DB.
2. Host-side routing: per-turn background System One scope check (engineering? scope settled?
   new task? scope changed?); pre-flight route_decide at "scope agreed"; inject a `Routing:`
   reminder; Electron first. gate-0.1 stays at "plan approved".
3. Quality signals and blending: host-captured review verdicts attached to the reviewed run
   (CI/PR signals optional later); blend learned rates toward seeds, e.g. (s + k*seed)/(n + k).

Prompt/rule text changes are handed to another machine (spec given in chat). Our side must not
add a "call route_decide yourself" prompt rule.

## Evidence gathered before the task (orchestrator, read-only)

- `~/.ptah/state/ptah.sqlite` `lane_outcome_records`: 108 rows (2026-10-29..30), 108/108
  verdict `delivered`, 0 `final_review`, ~23 `task_kind` NULL, 106/108 `routing_source`
  `not-routed`, 0 subagent rows.
- `local-derivation.ts:129` drops null taskKind; `cellFrom` (:247) needs 5 runs and scores
  delivered/review rates, which replace seed cells (layer order user > local > seed,
  `capability-matrix.store.ts:186`).
- `delivered` = declared files exist and non-empty (`lane-completion-notifier.service.ts:672-678`).
- Review verdicts and subagent taskKind come only from `ptah_outcome_report`, which only the
  orchestration skill asks for.
- Routing call budget ~8.5 s (`routing-constants.ts:135`); warm System One p50 ~665 ms.

## Task Type

FEATURE

## Complexity

Complex

## Strategy

FEATURE, Full: PM → architect → team-leader → QA. Pre-flight: route_decide taskType null
(low-confidence, skill-table fallback → FEATURE by keywords "add/implement"), depth Full
(model, 0.5264).

## CLI Lanes

- Preference source: memory (`orchestration-executor-preference`: lanes-first, codex first,
  reviews from a different family). A conflicting memory (`cli-lane-executor-preferences`:
  never codex/copilot) exists; outcome DB shows codex lanes used heavily on 2026-10-29..30, so
  the codex-first preference is treated as the most recent. Decision logged.
- Mode: enabled
- Approval: lane-review
- ptah_agent_list rows (2026-10-30 ~15:52 UTC):
  | codex | cli | codex | installed | confirmed room (Weekly 37%) |
  | copilot | cli | copilot | disabled (installed) | unknown |
  | cursor | cli | cursor | not installed | unknown |
  | antigravity | cli | antigravity | installed | unknown (reader failed) |
  | opencode | cli | opencode | installed | AT LIMIT (Monthly 100%, resets 2026-11-04 11:44 UTC) |
  | pi | cli | pi | not installed | unknown |
  | grok | cli | grok | installed | near limit (Weekly 95%) |
  | claude | cli | claude | disabled (installed) | unknown |
  | Glm | ptah-cli | ollama-cloud | available, ptahCliId pc-355b645d-35af-4974-84cf-9cf961ea0164 | near limit (Weekly 90%) |
  | kimi code | ptah-cli | kimi-code | available, ptahCliId pc-10e5a6b5-b237-4c72-a213-3202bd30d1fe | unknown |

  Limit record (this run): Glm (ptahCliId pc-355b645d-35af-4974-84cf-9cf961ea0164, family
  ollama-cloud) hit `429 weekly usage limit` on 2026-10-31 during the Phase A cross-family review
  (agent 3cc3d9b6, no deliverable). Reset 2026-11-02 00:00 UTC (provider-api). Skip Glm until then.
  Fallback: codex (other family, confirmed room).

## Worktree

`D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing` on branch
`feat/lane-learning-routing` from origin/main 1d2fbd4b5. node_modules is a junction to the
main checkout (never npm install here).

## Conversation Summary

User agreed with: routing must not fire on the first vague message; learning must measure
quality, not "files exist". Electron first.
