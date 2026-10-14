# Gate 1 requirements review

Artifact: task-description.md  
Revision: 1  
Author: in-process (Claude, project-manager)  
Reviewer: codex lane  
Round: 1  
Verdict: REVISE

## Requirement trace

| Source requirement | Covered by task-description.md | Result |
| --- | --- | --- |
| `context.md:73-76` — optional Decision model setting, Ollama/Jev/structured-output choices, unset uses existing rules | Scope 50-51; Requirement 1, 81-102 | Covered; unset behavior conflicts with code ranking elsewhere (Finding 4). |
| `context.md:77-79` — one MCP tool, request, live lane/limit rows, preferences/outcomes, typed result | Requirement 2, 104-123; Requirement 4, 148-162 | Covered; live rows lack model IDs (Finding 1). |
| `context.md:80-81` — task/depth, phase executor and model/tier, failure classification | Requirements 2, 5 and 10, 104-184 and 262-273 | Covered; classification integration needs a bounded contract (Finding 6). |
| `context.md:82-84` — hard rules, supplied options only, low-confidence fallback logged | Requirements 3-4, 125-162; Requirement 8.4, 238-239 | Covered; rule-source ambiguity (Finding 4). |
| `context.md:85-86` — skill calls at Pre-flight and Gate 0.1, visible overridable table | Requirement 8, 225-242 | Covered. |
| `context.md:52-56` — per-lane/provider/model/role/task outcomes, review rounds, failures, duration/tokens/cost; replace uniform Success | Requirements 5 and 9, 164-184 and 244-260 | Covered; per-run telemetry premise is false (Finding 2); proposed removal reserved for user. |
| `context.md:57-60` — editable data matrix by family/model and task kind, source/asOf, public seed, local override, dynamic vendors | Requirement 6, 186-208 | Covered; public seed cannot fill all task kinds (Finding 3). |
| `context.md:61-64` — close-score rotation, confirmed room, hard rules, dynamic roster | Requirements 3, 6.5 and 7, 125-146 and 202-223 | Covered; candidate/model discovery and rule-source gaps (Findings 1 and 4). |
| `context.md:66-67` — no skill-synthesis, trajectory or learning-episode trimming | Scope 66-69; Proposed Removals 314-319 | Covered. |

## Introduced constraints

These are requirements or exclusions beyond the user's agreed shape and not mandates in `CLAUDE.md`. They may be sensible design choices, but need an explicit rationale or a design decision rather than being treated as user requirements.

| Location | Introduced constraint |
| --- | --- |
| `task-description.md:50-51` | Adds Ollama Cloud as a named decision-model option. |
| `task-description.md:70-71,76-77` | Excludes per-batch tool use and any change to lane spawn/completion delivery. |
| `task-description.md:90-100` | Requires hosted/local disclosure, credential-state UI, setup deep link and persisted selection. |
| `task-description.md:111-123` | Requires read-only MCP annotation, field-specific tool errors and explicit fallback-cause provenance. |
| `task-description.md:144-145` | An unavailable user-pinned lane may not be replaced. |
| `task-description.md:155-160` | Configurable timeout/confidence threshold and preservation of a rejected proposal. |
| `task-description.md:170-184` | Exactly one durable outcome per completion, null unknown metrics, no request text, and nonblocking write failures. |
| `task-description.md:195-206` | First-use public seeding, neutral score for unknown models, edit persistence and malformed-edit rejection. |
| `task-description.md:217-223` | Deterministic rotation state and preference for any known headroom over unknown headroom within the band. |
| `task-description.md:251-255` | Prescribes three specific Library outcome indicators and a particular empty-state phrase. |
| `task-description.md:280-290` | Restricts outbound fields, secret storage, decision-call count, and all-host compatibility. |

## Findings

1. **Blocking — `task-description.md:117-119,132-134`.** The tool assumes every `ptah_agent_list` row supplies model IDs. The formatter only emits Agent, Type, Status, Capabilities and Limit state (`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.ts:1742-1774,1802-1821`). Ptah CLI summaries expose `modelCount`, not model IDs (`libs/shared/src/lib/types/ptah-cli.types.ts:48-63`). **Fix:** specify a live model-discovery source per CLI and Ptah CLI row, its unavailable/auto-model behavior, and how IDs are validated without a fixed roster; adjust the tool input contract accordingly.

2. **Blocking — `task-description.md:178-180`.** `AgentScorecard` is aggregate data (`libs/shared/src/lib/types/rpc/rpc-skill-clone.types.ts:236-270`), and `getScorecardAggregates` groups invocation events by `skill_slug` (`libs/backend/skill-synthesis/src/lib/skill-candidate.store.ts:1471-1518`). An individual subagent run's tokens, cost and duration cannot be taken from that aggregate without misattribution; using the aggregate again risks double counting. **Fix:** point to the raw invocation event/run identifier, define its join to a subagent completion and review verdict, and state which missing metrics stay null.

3. **Serious — `task-description.md:193-196`.** A required strength value for each of six task kinds cannot be seeded from the cited public routing evidence. `research-routing-landscape.md:9-11,217-229` supports only backend implementation, and that evidence is possibly stale; the other nine surveyed columns are “no data.” **Fix:** make task-kind entries optional/unknown, seed only supported backend implementation values with `source`, `asOf` and stale status, and use neutral/no-profile behavior for other tasks until local evidence or user edits exist. Do not infer plan/review/tests/docs scores from SWE-bench.

4. **Serious — `task-description.md:83-84,146,161-162,338-340`.** “Unset means today's behavior” conflicts with Requirement 3.7 applying new code constraints to the rule result and Requirement 7's matrix rotation. Requirement 4.4 protects only task type and depth; lane selection remains undefined. The open question at lines 338-340 acknowledges this contradiction. **Fix:** choose one explicit unset path for lane/model selection, hard-constraint enforcement and spread, then make Requirements 1, 3, 4, 7 and 8 agree. Bring the choice to the user if it changes today's routing.

5. **Serious — `task-description.md:112-116,232-239`.** The System One decision models return typed choice/score/yes-no answers and probabilities, not generated prose (`research-decision-models.md:48-68,83-92,564-565`). The contract requires a reason per roster row plus `reasons`, but does not say who creates them or how provenance is checked. **Fix:** require Ptah code to compile reasons from chosen options, scores, constraints and fallback causes; define confidence aggregation and test that reasons correspond to actual choices.

6. **Serious — `task-description.md:117-119,285-287`.** The full dynamic roster cannot necessarily fit a single System One choice question: Ollama decision models permit only 2-26 choice options and up to 64 questions, with a 64 KiB request cap for some models (`research-decision-models.md:70-78`). “One decision-model call” per stage needs an overflow plan as new lanes and models appear. **Fix:** define bounded candidate pruning or staged deterministic selection that preserves all eligible rows, or permit multiple model calls with a clear limit and fallback.

7. **Serious — `task-description.md:137-139,285-287`.** A reviewer's family exclusion depends on the selected implementer, while System One questions in one request are evaluated independently against the same state (`research-decision-models.md:83-87,564`). A single call can propose an invalid reviewer, and filtering may leave no ranked alternative. **Fix:** define sequential selection or a deterministic code-side review selector after implementer selection, including what happens to confidence and the call cap.

8. **Minor — `task-description.md:217-223`.** Rotation is checkable in a narrow equal-score fixture, but “close scores,” “confirmed room,” tie-breaking and the scope of rotation state are undefined. The architect open questions at lines 333-337 defer defaults, so the acceptance criteria do not yet identify expected choices across restarts or changing limit states. **Fix:** specify the score scale, band boundary, headroom states, state key/lifetime and tie-break order in design, then add boundary fixtures.

9. **Minor — `task-description.md:251-255`.** “Delivered rate,” “review pass rate,” “average revise rounds” and “most frequent failure class” lack denominators, review-pending treatment and tie/empty handling. An agent can have completed runs but no reviewed runs. **Fix:** define each numerator and denominator, time window, pending/null display and tie rule so the UI and tests agree.

10. **Minor — `task-description.md:323-327,312`.** The open questions still present Ollama input format and Jev contract as unresearched, and the risk says Jev research is pending. `research-decision-models.md:34-68` already records the shared `POST /v1/systemone` contract and its limits. **Fix:** close those questions, cite the research, and retain only genuine unknowns such as provider support, local version checks and operational limits.

## Parity deltas

| Inventory capability | Review |
| --- | --- |
| Invocations count | Kept in Requirement 9.4 (`task-description.md:258-259`). |
| Agent-kind Success percentage | Explicit proposed removal/replacement in Requirement 9 and Proposed Removals (`task-description.md:244-260,314-319`). **User approval required; this review does not approve removal.** |
| Skills/Commands Success percentage and underlying `CloneSummary.successRate` field | Kept in Scope and Requirement 9.3 (`task-description.md:74,256-257`); field retention is explicit at `task-description.md:318-319`. |
| Last enhanced and History count | Kept in Requirement 9.4 (`task-description.md:258-259`). |
| Scorecard badge including graded result, invocations, tokens, cost and verdict dots | Kept in Requirement 9.4 (`task-description.md:258-259`); the per-run data-source claim needs correction (Finding 2). |

No inventory capability is silently removed. The single proposed removal belongs to the user.

## Decisions

- **Verdict: REVISE.** Resolve Findings 1-4 before architecture handoff; Findings 5-7 affect the decision-model contract and call budget.
- Preserve the user's decision on the Agents-tab Success percentage. The proposed removal remains pending explicit approval (`task-description.md:260,314-319`).
- `research-codebase-survey.md` was absent at review time; the telemetry and list-format checks above use repository evidence directly. No builds, tests or source edits were run.
