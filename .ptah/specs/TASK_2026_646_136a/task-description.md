# Requirements - TASK_2026_646_136a

Revision 3 (2026-10-14). Revises revision 2 after the round 2 Gate 1 review (`task-description-review.md`, verdict
REVISE: round-1 Finding 6 and new Findings 1-3). Revision 2 revised revision 1 after the round 1 review
(`task-description-review-round1.md`, Findings 1-10) and the user decisions in `decisions.md` #12 and #13. Changes are
listed in `## Revision log`.

## Context

Orchestration routing today is skill text. The `orchestration` skill classifies a request with a keyword
table and picks a depth by judgment (`apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/orchestration/SKILL.md:12-41`).
At Gate 0.1 it chooses lanes "by capability and availability" from the live `ptah_agent_list` rows
(`.../orchestration/references/lane-assignment.md:96-120`). The hard constraints live only in prose: a reviewer
from a different family than the implementer (`lane-assignment.md:83,93,100-102`; family is defined in
`.../skills/agent-lanes/SKILL.md:30,189-195`), `AT LIMIT` lanes are unavailable (`lane-assignment.md:36-37`), the
"Never on a lane" list (`lane-assignment.md:60-73`) and the batch cap of 6 files and 2 libs
(`lane-assignment.md:84`). The skill names no fixed vendor list. Nothing scores lanes, so in practice the same lane is
picked again and again. `ptah_agent_list` reports each row's limit state
(`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts:1402-1423`), and the shared
engine already names four lane limit states, `at-limit | near-limit | confirmed-room | unknown`
(`libs/shared/src/lib/utils/plan-limits/lane-state.ts:158-159`). The rows carry no model ids: the formatter emits
Agent, Type, Status, Capabilities and Limit state (`mcp-response-formatter.ts:1742-1774,1802-1821`), and Ptah CLI
summaries carry only `modelCount` (`libs/shared/src/lib/types/ptah-cli.types.ts:61`). Model lists exist elsewhere:
`CliModelListService` returns provider-reported ids for codex and copilot and Ptah's shipped fallback lists for cursor
and opencode (`libs/backend/rpc-handlers/src/lib/services/cli-model-list.service.ts:35-49`), backed by
`CliDetectionService.listModelsForAll` (`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-detection.service.ts:181-221`);
Ptah CLI agents carry `selectedModel` and `tierMappings` (`ptah-cli.types.ts:21-29`). `ptah_agent_spawn` takes
`model` (default `'default'`) and, for Ptah CLI lanes, `modelTier` (`protocol-dispatcher.ts:1160-1166`).

Ptah keeps no record of how each lane performed. `LaneCompletionNotifier` signals each terminal lane run with status,
a disk-derived verdict (`delivered | no-deliverable | failed | unverified`), duration, exit code and role, but persists
nothing and carries no tokens or cost (`libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-notifier.service.ts:132-145,258-269,499-530`;
`research-codebase-survey.md` §2). Subagent runs are recorded per run in skill-synthesis's `skill_invocation_events`
table (`id`, `skill_slug`, `session_id`, `context_id`, nullable token columns, `cost_usd`, `duration_ms`, `task_id`;
schema mirrored in `libs/backend/skill-synthesis/src/lib/spec-harvester.service.spec.ts:276-297`). The Thoth Library
Agents tab shows `AgentScorecard` aggregates of those events grouped by `skill_slug`
(`libs/shared/src/lib/types/rpc/rpc-skill-clone.types.ts:236-271`; `skill-candidate.store.ts:1471-1518`) and a
"Success" percentage (`clone-card.component.ts:413-420`, `clone-detail-drawer.component.ts:559-560`) computed as
`succeeded / total` (`skills-synthesis-rpc.handlers.ts:2305`; `skill-candidate.store.ts:1430-1456`), which the user
reports reads 100% for every agent. The Settings screen has a "Background Model Roles" table with six roles
(`libs/frontend/chat/src/lib/settings/ptah-ai/orchestration-settings.component.ts:30-37,114-168`). No decision-model
client exists anywhere (`research-codebase-survey.md` Gap 8).

The user wants an optional "decision model" to help make routing decisions: task type and depth, the lane or subagent
for each phase, and the model for each phase, backed by a local outcome record, a capability matrix held as data, and a
spread rule in code (context.md "Scope additions (2026-10-14)"). Research is complete: every Ollama decision model and
TypeSafe Jev share `POST /v1/systemone`, return typed choice, score and yes/no answers with probabilities and no
generated text, allow 2-26 choice options on Ollama (up to 255 on Jev) and 1-64 questions per request, cap Ollama
request bodies at 64 KiB, and evaluate the questions of one request independently against the same state
(`research-decision-models.md:52-58,66-78,86,91,553-566`). Public routing data fills only "implement (backend)", from
SWE-bench Verified results published on or before 2026-02-19 and marked possibly stale; every other task column is
"no data" (`research-routing-landscape.md:9-11`). The user then decided that, with no decision model set,
deterministic code ranking always chooses lanes, and that a decision model, when set, refines that ranking
(`decisions.md` #12). The user also approved replacing the Agents-tab "Success" figure with outcome signals
(`decisions.md` #13).

## Classification

- Type: FEATURE. It adds a setting, an MCP tool, a persisted outcome record, a data-driven capability matrix, a
  deterministic ranking with a spread rule, and a change to the orchestration skill.
- Estimate: XL, the carrier's own value. Size comes from the number of surfaces involved: shared types, a backend
  tool, persistence, a new decision-model client, per-lane model discovery, a settings row, a Library card change,
  and skill text, in the VS Code, Electron and stdio hosts.
- Priority: not defined here.

## Scope

In scope:

- A "Decision model" role in Settings → Agent Orchestration → Background Model Roles. It can be left unset; when set,
  it is an Ollama decision model, TypeSafe Jev, or a configured model with structured output (context.md:73-76).
- One MCP routing tool (working name `ptah_route_decide`) with two stages, Pre-flight and Gate 0.1.
- A deterministic code ranking (matrix, outcome record, spread rule, hard constraints) that chooses lanes and models
  whether or not a decision model is set (`decisions.md` #12); the decision model, when set, chooses among options the
  ranking offers.
- Per-row model discovery at call time, because `ptah_agent_list` rows carry no model ids.
- Hard constraints enforced in code on every routing result, whatever its source.
- A timeout, a bounded number of decision-model requests and a fallback, so that routing never blocks orchestration.
- Reasons and confidence compiled by Ptah code from structured facts.
- A lane and subagent outcome record built from per-run events, joined to review verdicts.
- A capability matrix held as data, with `source`, `asOf` and a stale flag per value, `unknown` where no evidence
  exists, user-editable, and overridden by local outcomes.
- A spread rule in code that rotates between eligible lanes with close scores and prefers lanes in `confirmed-room`.
- Classifying why a lane failed, into the five classes given below.
- `orchestration` skill integration at Pre-flight and Gate 0.1: a routing table the user can override, decision
  logging in `decisions.md`, and reporting of subagent deliverables and review verdicts for the outcome record.
- Replacing the per-agent "Success" percentage on the Library Agents tab with outcome signals (approved by the user,
  `decisions.md` #13).

Out of scope:

- Trimming or removing skill-synthesis, trajectory or learning-episode features. TASK_2026_659_cec4 evaluates that
  separately with its own parity inventory (context.md:66-67, `decisions.md` #5).
- Calling the routing tool at per-batch executor selection inside team-leader. The agreed shape names only Pre-flight
  and Gate 0.1 (context.md:85-86). Extending it to batches is a follow-up task.
- Changing lane spawn, resume, limit lookup, or the content and transport of the completion signal. Those belong to
  TASK_2026_441_7825 and `cli-agent-runtime`. Adding an outcome-record write at the point where a lane completes is in
  scope; it does not change what the signal delivers.
- Changing the hard-constraint rules themselves: the reviewer-family rule, `AT LIMIT`, the "Never on a lane" list and
  the batch cap. This task enforces them in code and does not redefine them.
- The "Success" metric on the Library Skills and Commands tabs, and the `CloneSummary.successRate` field. Only the
  Agents tab is named by the user, and the approval in `decisions.md` #13 covers only that tab.
- Finding why the existing `succeeded` flag reads 100% for every agent. The Agents-tab figure is replaced, not fixed;
  the Skills and Commands tabs that still use it are out of scope (above).
- Deriving matrix values for task kinds that have no public evidence. See Requirement 6.3.
- Removing the rule tables from the `orchestration` skill. They stay for task type and depth when no decision model
  is set and for all routing when the tool is not listed (Requirement 8.5).

## Requirements

### 1. Decision-model setting

Requirement: the user can choose an optional decision model under Background Model Roles. With none chosen, no
decision-model request is ever made; deterministic code ranking chooses lanes and models (`decisions.md` #12), and
task type and depth come from the skill's Pre-flight table (Requirement 4.4).

Acceptance criteria:

1. When the user opens Settings → Agent Orchestration → Background Model Roles, the system shall list a "Decision
   model" row beside the existing six roles, and the role count shown in the summary shall go up by one.
2. When the Decision model row is opened, the system shall offer exactly these choices: unset (the default); an Ollama
   decision model served by the user's configured Ollama endpoint; TypeSafe Jev; and any configured provider model that
   supports structured output. The Ollama choice shall not be limited to a list of model names fixed in code (the
   research lists tev1, nimble, clef-flash, clef and laya, `research-decision-models.md:38-44`). Rationale: the three
   kinds are the user's agreed shape (context.md:75); no separate "Ollama Cloud" choice is offered because serving of
   decision models on Ollama Cloud is not documented (`research-decision-models.md:209,545`).
   > Correction (2026-10-17, TASK_2026_684_a11d): `clef:27b` is served on Ollama Cloud with the `decision`
   > capability, so this rationale no longer holds. Source: `.ptah/specs/TASK_2026_684_a11d/context.md`,
   > "Ollama Cloud API".
3. When the selection is unset, the system shall make no decision-model network request during orchestration. A test
   asserts zero outbound decision requests across a Pre-flight and a Gate 0.1 call.
4. When the selected model is served off the machine (Jev, a remote Ollama endpoint, or a hosted structured-output
   provider), the row shall state that the request text and lane data are sent to that provider. When it is served by
   an Ollama endpoint on the local machine, the row shall state that the data stays on the machine. Rationale: the
   outbound payload contains the request text (Non-functional requirements, Security), and the research treats a
   hosted model as an explicit user choice because state leaves the machine (`research-decision-models.md:560`).
5. When the selected provider has no credential, cannot be reached, or the Ollama endpoint does not serve
   `/v1/systemone` (it needs Ollama 0.35 or later, 0.40 for laya, `research-decision-models.md:39-43`), the row shall
   show that state and offer the existing set-up-provider deep link (`orchestration-settings.component.ts:317`), as the
   existing six rows do. Routing shall then fall back as described in Requirement 4.
6. When the application restarts, the system shall restore the selected decision model.
7. When the Decision model row is added, the existing six roles shall keep their values and behaviour. Their existing
   specs pass unchanged.
8. When the selected model is a structured-output model with no native confidence (`research-decision-models.md:44`),
   the row shall state that it reports no confidence; its answers shall carry confidence null and the overall
   confidence follows Requirement 13.5; and the low-confidence rule (Requirement 4.3) shall not apply to them.

### 2. Routing tool contract

Requirement: the orchestrating agent calls one MCP tool at two stages and gets back a typed routing result. Ptah code
gathers every candidate itself; the caller supplies only the request and the decisions already confirmed.

Acceptance criteria:

1. When the Ptah MCP server lists its tools in any host that serves Ptah MCP tools, the system shall include the
   routing tool.
2. When the tool is called with stage `pre-flight` and a request text, the system shall return a result that validates
   against a published schema and carries: the task type (one of the task contract's types) or null; the depth
   (`Full` | `Partial` | `Minimal`) or null; for each, its source (`model` or `skill-table`), its confidence (Requirement
   13.5) and any fallback cause (Requirements 4.6 and 12.7). Null with source `skill-table` means the skill applies its
   Pre-flight table.
3. When the tool is called with stage `gate-0.1`, a request text, the confirmed task type and depth, the list of
   phases to staff, and optional user pins per phase, the system shall return a result that validates against a
   published schema and carries exactly one roster entry per requested phase. Each entry takes one of two schema
   branches:
   - A chosen entry carries: the phase; the executor (a lane id, `cli` or `ptahCliId`, or a subagent role); the model
     (Requirement 11); the model's provenance (`reported` | `fallback` | `configured` | `tier` | `lane-default`); the
     score on the scale of Requirement 7; the source (`model` | `ranking` | `pin`); the confidence or null
     (Requirement 13.5); the fallback cause or null; and the reason (Requirement 13).
   - An unavailable entry carries: the phase; executor `unavailable`; a required exclusion reason, one of
     `no-eligible-candidate` (Requirement 12.3), `reviewer-family` (Requirement 3.3) or `pin-unavailable`
     (Requirement 3.6); the rule that excluded each candidate for that phase, and for `pin-unavailable` the rule the
     pinned lane broke or `not-listed` when the pin names no row read for the call; a flag that the skill's disclosed
     fallback is needed (set for `reviewer-family`, `lane-assignment.md:114-120`); the source (`pin` for
     `pin-unavailable`, otherwise `ranking`); and the reason (Requirement 13.2). Its model, provenance, score,
     confidence and fallback cause shall be null.
   The schema shall reject an unavailable entry without an exclusion reason or with a non-null model, provenance,
   score, confidence or fallback cause, and shall reject a chosen entry whose executor is `unavailable`. The result
   also carries an overall confidence, an overall source (`model` when every entry came from the model, `ranking` when
   none did, otherwise `mixed`), `reasons`, the excluded candidates with the rule that excluded each, and the number of
   decision-model requests made with their tokens and cost, or null when the provider does not report them.
4. The candidate options shall be gathered by Ptah code at call time: the `ptah_agent_list` rows with their status,
   family and limit state; each row's model list (Requirement 11); the subagent roles and model tiers Ptah offers; the
   outcome records (Requirement 5); the matrix (Requirement 6); and the preferences the caller passes. How a stored
   preference changes the ranking is set by the architect; whenever it changes a choice, the entry's reason says so,
   and it never overrides a hard constraint.
5. When the tool is called with missing or invalid arguments, the system shall return a tool error that names the
   invalid field and shall not call the decision model. Rationale: the repository's boundary-validation idiom
   (`protocol-dispatcher.ts:667-728`).
6. When the decision model returns output that fails schema validation, or names an option that was not offered, the
   system shall discard that answer and apply the stage's fallback (Requirement 4.6) to the affected answers, with
   fallback cause `bad-output`.
7. A schema test shall cover the unavailable branch with these fixtures, with and without a decision model set: a
   zero-candidate phase (every row for that phase excluded, for example all `at-limit`) returns exclusion reason
   `no-eligible-candidate` and each excluded row's rule; and invalid pins, one naming a lane id absent from the rows
   (`not-listed`), one naming an `at-limit` lane and one naming a same-family reviewer, each return exclusion reason
   `pin-unavailable` with that rule. Each entry shall validate against the published schema with its choice-specific
   fields null, no decision-model question shall be sent for those phases, and the entry shall not enter the overall
   confidence.

### 3. Hard constraints enforced in code

Requirement: no routing result can break the lane rules, whatever its source. Code applies these rules to model,
ranking and pinned entries alike.

Acceptance criteria:

1. Every lane id in the tool's output shall be one of the `ptah_agent_list` rows read for that call, and every model
   shall satisfy Requirement 11.4. A test feeds a fake model that invents a lane id and a model id and asserts that
   neither appears in the output.
2. The system shall never choose a row whose limit state is `at-limit`, or a row that is disabled or not installed.
   A test with an `at-limit` row that scores highest asserts that the row is not chosen.
3. A review phase's lane shall never be the same family as the executor of an implement phase it reviews (every
   implement phase, when the phase list does not say which one a review covers). Requirement 12.4 defines the order of
   selection. When no other-family lane is eligible, the system shall return the review entry as `unavailable` with
   exclusion reason `reviewer-family` (Requirement 2.3), marked as needing the skill's disclosed fallback
   (`lane-assignment.md:114-120`), and shall not return a same-family lane.
4. The system shall never assign a lane to a role or action on the "Never on a lane" list (`lane-assignment.md:60-73`).
   A test requests visual-review and design phases and asserts the executor is not a lane.
5. The result schema shall contain no batch-size field, so no model answer can change the batch cap; the cap stays
   enforced where it is today (`lane-assignment.md:84`).
6. When the caller passes a user pin for a phase, the system shall return the pinned lane if it is spawnable and breaks
   no rule in criteria 2-4. Otherwise it shall return the entry as `unavailable` with exclusion reason
   `pin-unavailable` (Requirement 2.3), naming the rule, or `not-listed` when the pinned lane is not among the rows,
   and shall not substitute another lane. Rationale: the user's override is part of the agreed shape
   (context.md:85-86); a silent substitute would hide that the override did not take effect. The user may still
   override in the turn (Requirement 8.3).
7. When no decision model is set, the system shall apply these same constraints to the ranking result. A test runs
   the criteria 1-6 fixtures with the model unset.

### 4. Non-blocking fallback

Requirement: orchestration never waits indefinitely and never fails because the decision model is slow, absent or
wrong. The fallback for lanes and models is the code ranking; the fallback for task type and depth is the skill's
Pre-flight table. At Pre-flight a fallback returns the affected task type or depth as null with source `skill-table`
and the cause; at Gate 0.1 a fallback entry takes the ranking's choice and the cause (criterion 6).

Acceptance criteria:

1. When a decision-model request does not answer within the timeout, the tool shall stop waiting and apply the stage's
   fallback (criterion 6) to every answer that request covered, with fallback cause `timeout`, and return within the
   timeout plus a margin the architect states. This is tested with a fake clock. The architect sets the timeout value
   from the research latency evidence (`research-decision-models.md:96,192`).
2. When the decision model is unreachable, rejects the credential, or returns an error, the tool shall apply the
   stage's fallback (criterion 6) to every answer that request covered, with fallback cause `unreachable`, `auth` or
   `provider-error` respectively, and shall not raise a tool error.
3. When the model's confidence for an answer is below the threshold, the tool shall apply the stage's fallback
   (criterion 6) to that answer, set fallback cause `low-confidence`, and include the model's proposal and its
   confidence in the result so that it can be logged. The architect sets the threshold (the research recommends 0.5,
   `research-decision-models.md:562`). Rationale: "Low confidence → rule table, logged" is the user's agreed shape
   (context.md:84). This criterion does not apply when the model reports no confidence (Requirement 1.8).
4. When no decision model is set, a `pre-flight` call shall return task type and depth as null with source
   `skill-table` and make no request, and the skill shall classify with the existing Pre-flight table
   (`SKILL.md:14-41`); a `gate-0.1` call shall return the ranking's roster (`decisions.md` #12). A spec fixture checks
   both calls with zero outbound requests.
5. When an input other than the lane rows is unavailable (no outcome store in this host, an unreadable matrix, a
   failed model listing), the tool shall still return a roster from the inputs it has, with neutral scores where data
   is missing, and `reasons` shall name each missing input. It shall not return a tool error for missing data.
6. The stage's fallback is: at `gate-0.1`, the affected roster entry takes the ranking's choice for that phase, with
   source `ranking` and the cause; at `pre-flight`, the affected answer (task type, depth, or both when the whole
   request failed) is returned as null with source `skill-table` and the cause, no ranking choice is returned for it,
   and the skill classifies with its Pre-flight table (`SKILL.md:14-41`). Neither stage raises a tool error for a
   fallback. A table-driven test runs every cause of Requirement 12.7 at both stages and asserts these outcomes, with
   the cause recorded on each affected answer; `question-limit` is run at `gate-0.1` only, because a `pre-flight`
   request holds two questions (Requirement 12.8).

### 5. Lane outcome record

Requirement: Ptah records how every lane run and every subagent run ended, from per-run events, so that the ranking and
the Library can use real outcomes.

Acceptance criteria:

1. Each terminal lane completion, the same event that produces the `<agent-lane-completed>` signal and deduplicated the
   way the notifier deduplicates it (agent id plus completion time, `lane-completion-notifier.service.ts:256,293-297`),
   shall produce exactly one outcome record, whatever the end state. A test with N distinct completion events plus one
   duplicate asserts N records.
2. Each record shall carry: a run id; the executor (lane id `cli` or `ptahCliId`, or `subagent`); family; provider;
   model as spawned (`lane-default` when spawned without one); role; task kind (plan, implement, review, research,
   tests, docs, or null when the run was not routed with one); task id; deliverable verdict (`delivered` |
   `no-deliverable` | `failed` | `unverified`, the completion signal's own values, `lane-completion-notifier.service.ts:132-145`);
   failure class (Requirement 10); start and end times; duration; input and output tokens; cost; and the routing source
   of the run (`model` | `ranking` | `pin` | `not-routed`). Unknown values shall be stored as null, never as 0.
   Rationale for null: the repository's "never a fabricated zero" rule (`scorecard-badge.component.ts:14-16`;
   `skill-scorecard.service.ts:262-266`). Rationale for the routing source: the user wants evidence for "lanes
   evaluations for better matrix" (context.md:46-48), which needs model choices to be comparable with ranking choices.
3. For lane runs, tokens and cost shall be null unless a per-run source for that lane reports them; they shall never
   be estimated or taken from an aggregate. The completion signal carries neither today
   (`lane-completion-notifier.service.ts:499-530`).
4. When a subagent run completes, the system shall create one record with executor `subagent` and the agent's slug as
   role. Tokens, cost and duration shall come from that run's own `skill_invocation_events` row, joined one-to-one by a
   run key the architect defines, and never from `AgentScorecard` or `getScorecardAggregates`. When no row matches, or
   more than one row matches, those metrics shall be null and the record shall say `unmatched` or `ambiguous`. A test
   with two runs of the same agent in one session asserts that each record carries its own row's figures and that the
   records' token sum equals the two rows' sum.
5. When the orchestrating agent declares a subagent run's deliverable paths, the system shall set the run's
   deliverable verdict with the same disk rules the notifier applies to lanes (`lane-completion-notifier.service.ts:109-120,132-145`).
   With no paths declared the verdict shall be `unverified`; a run whose event row marks an error shall be `failed`.
6. When a review of a run concludes, the system shall attach the review outcome to that run's record by run id and
   shall not create a second record. Each `revise` verdict adds one to the record's revise-round count; an `approved`
   or `rejected` verdict sets the final review verdict. A record with no final verdict is "not reviewed". A verdict
   that names an unknown run id shall be rejected with an error naming the id, and nothing shall be written.
7. Outcome records shall persist across application restarts, and the routing tool shall be able to read them.
8. Outcome records shall contain no request text, prompt text or file contents. Rationale: aggregated outcomes are
   sent to the decision model (Non-functional requirements, Security).
9. When writing a record fails, the lane's result shall still reach the orchestrating session, and the failure shall
   be logged. Rationale: the same non-blocking rule the limit lookup follows (`lane-limit-lookup.service.ts:21`).

### 6. Capability matrix as data

Requirement: lane strengths are data that the user can see and edit, not text in a skill. Only evidenced values are
seeded; everything else is `unknown` until local outcomes or a user edit supply it. Precedence is user edit, then local
outcomes, then seed.

Acceptance criteria:

1. The matrix shall hold one profile per lane family and model, plus a family-level profile used when the model is
   `lane-default` or unknown. For each task kind (plan, implement, review, research, tests, docs) a profile holds either
   `unknown` or a value on the score scale of Requirement 7 with `source`, `asOf` and a `stale` flag.
2. On first use, the matrix shall be seeded only with values the cited public evidence supports. On 2026-10-14 that is
   the implement kind from SWE-bench Verified under mini-SWE-agent (`research-routing-landscape.md:9-11`). Each seed
   value shall record the dataset or URL as `source`, the result's publication date as `asOf`, a note that it measures
   backend implementation only, and `stale` set when `asOf` is older than the staleness age the architect sets. A seed
   row whose model cannot be matched to one family and model id without guessing shall not be seeded. The architect
   sets how the research's strong, good and weak labels map onto the score scale.
3. No value for plan, review, research, tests or docs shall be derived from the implement value, from SWE-bench, or
   from any other task kind. A test asserts that a freshly seeded matrix holds `unknown` in every non-implement cell.
4. When a cell is `unknown`, or `ptah_agent_list` returns a row whose family has no profile, the system shall treat the
   row as eligible with the neutral score the architect sets, and the reason shall say "no profile". No code or skill
   change shall be needed for that row to be chosen (context.md:63-64). A test uses a fixture row with an unseen `cli`
   value.
5. When the user edits a value, the system shall use it from the next routing decision on, mark its `source` as user,
   and keep it when the shipped seed or the local value later changes.
6. When at least the minimum sample count of outcome records (architect sets the count) exists for a family, model
   and task kind, the system shall use the locally derived value in place of the seed, with `source` local outcomes,
   the sample count, and `asOf` equal to the newest contributing record. The architect sets the derivation from the
   Requirement 9.1 rates and documents it; a fixture checks one derived value.
7. When an edited value is malformed, the system shall reject the edit with a message naming the entry and keep using
   the last valid matrix. Rationale: editable data must not stop routing (Requirement 4).
8. The user shall be able to see every value's `source`, `asOf` and `stale` flag where the matrix is shown or edited.
9. The `orchestration` and `agent-lanes` skills shall contain no table that maps named vendors or lanes to task kinds.
   A grep of their routing text for lane names finds no such mapping.

### 7. Spread rule

Requirement: work is spread across lanes of comparable strength instead of always going to the top-scored lane, and
lanes in `confirmed-room` are preferred (context.md:61-62). The rule is part of the code ranking and therefore applies
whether or not a decision model is set.

Before implementation the architect shall set, and document in `implementation-plan.md`, these values; the criteria
below test them:

- S — the score scale (its range and direction).
- B — the closeness band, and whether a difference exactly equal to B is inside or outside it.
- T — a deterministic, total tie-break order.
- K — the rotation-state key, which includes at least the phase and the task kind.
- L — the rotation-state lifetime (one process, or persisted across restarts).
- The order of `near-limit` against `unknown` within the band. `confirmed-room` always ranks first; `at-limit` is
  excluded (Requirement 3.2).

Acceptance criteria:

1. When N (N ≥ 2) eligible lanes have equal scores and the same limit state, N consecutive decisions for the same key
   K shall choose N different lanes. A deterministic test checks this.
2. When two lanes score within B and only one is in `confirmed-room`, the system shall choose that one. `unknown`
   shall never count as room (`lane-state.ts:158-159`).
3. When one lane scores above the others by more than B, the system shall choose it; rotation shall not demote it.
   Boundary fixtures shall check a difference just inside B, exactly B, and just outside B, against the documented
   treatment of the edge.
4. Given the same inputs and the same rotation state, the system shall return the same choice.
5. When the application restarts between two decisions for the same K, the next choice shall follow L: it continues
   the rotation when L is persisted, and restarts from the first lane in T when L is one process. A fixture checks the
   chosen lifetime.
6. When a lane's limit state changes to `at-limit` between decisions, it shall leave the rotation, and the remaining
   lanes shall keep their rotation order; when it returns to an eligible state, it shall re-enter without resetting the
   others. A fixture checks this.
7. When a decision model is set, the final choice for a phase shall be one of the options the ranking offered
   (Requirement 12.2), so model choices stay inside the ranked set.
8. When a fake decision model always picks the first option offered (the first-option bias the research reports for
   Jev, `research-decision-models.md:91,566`), criterion 1 shall still hold across N decisions.

### 8. Orchestration skill integration

Requirement: the `orchestration` skill uses the routing tool at Pre-flight and Gate 0.1, shows its choice, lets the
user override it, and reports what the outcome record needs.

Acceptance criteria:

1. When the routing tool is listed, the skill shall call it once at Pre-flight and once at Gate 0.1, whether or not a
   decision model is set (`decisions.md` #12). When the tool is not listed, the skill shall follow today's rule tables
   unchanged.
2. At Gate 0.1 the skill shall pass the confirmed task type and depth, the phases to staff, the user's pins, and the
   preference source it found.
3. The Gate 0.1 notice shall show a table with the columns phase → executor → model → reason, plus each row's source
   and confidence ("—" when null), and the overall source and confidence.
4. When the user overrides any row in the current turn, the override shall win, and it shall be recorded in
   `decisions.md` with its source.
5. Every routing result shall be logged as a row in the task's `decisions.md` with the stage, the source, the
   confidence, the reasons and, for a fallback, its cause. A low-confidence fallback shall also log the model's
   proposal and its confidence.
6. The rule tables in `SKILL.md:14-41` and `lane-assignment.md` shall remain: for task type and depth when the
   Pre-flight result is null, and for all routing when the tool is not listed.
7. After each subagent run, the skill shall report the run's declared deliverable paths (Requirement 5.5). After each
   review verdict, it shall report the verdict and the reviewed run's id (Requirement 5.6). Lane records need no skill
   action (Requirement 5.1).

### 9. Library Agents tab outcome signals

Requirement: the per-agent figure on the Library Agents tab shows outcome signals that differ between agents. The
uniform "Success" percentage is replaced on the Agents tab only (approved, `decisions.md` #13).

Acceptance criteria:

1. When an agent card or its detail drawer is shown on the Agents tab and outcome records exist in the window W (the
   architect sets W; the card labels it), the system shall show these signals in place of "Success":
   - Delivered rate = runs with verdict `delivered` ÷ runs with verdict `delivered`, `no-deliverable` or `failed`.
     `unverified` and running runs count in neither. With a denominator of 0 it shows "no verified runs".
   - Review pass rate = runs with final verdict `approved` ÷ runs with final verdict `approved` or `rejected`. Runs not
     reviewed count in neither. With a denominator of 0 it shows "not reviewed yet".
   - Average revise rounds = the mean revise-round count over runs with a final verdict, to one decimal; hidden when
     the review pass rate shows "not reviewed yet".
   - Most frequent failure class = the class with the most runs among runs with a non-null class; on a tie, the class
     whose latest occurrence is newest. With none it shows "no failures recorded".
   - Each rate shows a whole-number percentage with its numerator and denominator (for example "80% (4/5)").
     Rationale: the user's complaint is a figure that carries no signal (context.md:55-56); the counts tell 100% of one
     run from 100% of forty.
2. When an agent has no outcome records in W, the system shall show "no data yet", the existing pattern in
   `scorecard-badge.component.ts:84`, and never a fabricated 0% or 100%.
3. On the Skills and Commands tabs, the "Success" metric shall be unchanged, and `CloneSummary.successRate` keeps its
   type and value. The existing `clone-card` and `clone-detail-drawer` specs for those kinds pass.
4. The Invocations, Last enhanced and History metrics and the scorecard badge (tokens, cost, graded result, verdict
   dots) shall remain on agent cards, as `parity-inventory.md` records.
5. A fixture with two agents whose outcome records differ shall show different signals for each.

### 10. Lane failure class

Requirement: when a lane ends without a deliverable, its record says why, using a fixed set of classes.

Acceptance criteria:

1. When a run ends with `no-deliverable` or `failed`, its record shall carry one failure class from `usage-limit`,
   `auth`, `crash`, `timeout` and `bad-output`, or null when the class cannot be determined.
2. When the existing deterministic classifier (`lane-limit-classifier.ts`) or the process exit state identifies the
   class, the system shall use it and shall not call the decision model.
3. When the decision model is set and asked to classify, the five classes shall be offered as one choice question, an
   answer below the threshold of Requirement 4.3 or outside the five classes shall store null, and at most one request
   shall be made per run (Requirement 12.5).

### 11. Lane model discovery

Requirement: each lane row's selectable models come from a live listing at call time, because `ptah_agent_list` rows
carry no model ids (`mcp-response-formatter.ts:1742-1774,1802-1821`). No list of model ids is fixed in the routing
tool.

Acceptance criteria:

1. For each eligible lane row, the system shall obtain the row's model list at call time from the model-listing
   source Ptah already has for that row type: for CLI rows, the per-CLI listing behind `CliModelListService` and
   `CliDetectionService.listModelsForAll`; for Ptah CLI rows, the agent's configured `selectedModel` and
   `tierMappings` and its provider's model discovery. Each id shall carry its provenance: `reported` (a live provider
   or host answer), `fallback` (Ptah's shipped list, `cli-model-list.service.ts:39-48`) or `configured` (the user's
   Ptah CLI configuration). Subagent and Ptah CLI tiers carry provenance `tier`.
2. When a row's listing is empty, unsupported, fails, or does not answer within the call's time budget, the row shall
   stay eligible with model `lane-default`, which means the lane is spawned without a model and uses its own default
   (`protocol-dispatcher.ts:1165`), and the reason shall say "models unknown".
3. When the chosen model is `lane-default` or a listed entry that selects a model automatically (such as an `auto`
   entry), the matrix lookup shall use the family-level profile (Requirement 6.1).
4. Every model in the output shall be an id in that row's list at call time, a supplied tier, or `lane-default`. A
   test with a fake decision model that names an unlisted model asserts that the id does not appear and the entry
   falls back with cause `bad-output`.
5. A listing failure or delay for one row shall not delay past the time budget or fail any other row. Rationale: the
   same per-lane isolation the limit lookup uses (`lane-limit-lookup.service.ts:12-21`).

### 12. Decision pipeline and request budget

Requirement: code ranks first; the decision model, when set, chooses among a bounded set of ranked options in a bounded
number of requests, each holding a bounded number of questions, and the reviewer is chosen after the implementer
(`decisions.md` #12; `research-decision-models.md:74,86,380,564`).

Acceptance criteria:

1. At `gate-0.1` the system shall, in this order: gather candidates (Requirement 2.4); remove candidates that break a
   hard constraint, recording each with its rule; score the rest and apply the spread rule to produce a ranking per
   phase; and then, with no decision model, return the top of each ranking, or, with a decision model, offer options
   to the model as below.
2. For each phase sent to the model, the offered options shall be the top P of that phase's ranking. The architect
   sets P, which shall not exceed the selected provider's documented choice-option limit (2-26 on Ollama, up to 255 on
   Jev, `research-decision-models.md:70-78`). The ranking's top candidate shall always be offered. Candidates below P
   shall appear in the excluded list with rule `pruned`.
3. A phase with exactly one eligible candidate shall not be sent to the model; its entry has source `ranking` and the
   reason "only eligible candidate". A phase with none is an unavailable entry with exclusion reason
   `no-eligible-candidate` (Requirement 2.3) and is not sent to the model.
4. Request 1 shall hold every non-review phase. After its answers are validated, the review phases' candidates shall be
   filtered to exclude the family of each implement phase's chosen executor, whatever that choice's source, re-ranked,
   and sent as request 2. When request 1 fails, the ranking's implementer choice stands and request 2 still uses its
   family. A test with a fake model that proposes a same-family reviewer asserts that the option was never offered.
   Both requests are subject to the question cap of criterion 9.
5. The system shall make at most one decision-model request at `pre-flight`, at most two at `gate-0.1`, and at most one
   per run for failure classification (Requirement 10.3), with no retries beyond this budget. A fake client counts the
   requests.
6. Before sending a request, the system shall check it against the provider's request-size limit (64 KiB for Ollama
   decision models, `research-decision-models.md:77`). When it is over, the system shall either offer fewer options per
   phase (never fewer than two) until it fits, or not send it, applying the stage's fallback (Requirement 4.6) with
   cause `payload-too-large` to the answers it covered.
7. The fallback causes shall be exactly: `timeout`, `unreachable`, `auth`, `provider-error`, `bad-output`,
   `low-confidence`, `payload-too-large`, `question-limit`. Every fallback entry or answer shall carry one of them.
8. At `pre-flight`, task type and depth shall be asked as two choice questions in one request, over the task contract's
   types and the three depths. When that request or either answer falls back for any cause in criterion 7, the
   affected field shall be null with source `skill-table` and that cause (Requirement 4.6); the ranking supplies no
   task type or depth.
9. Every decision-model request shall carry at most Q questions. The architect sets Q, which shall not exceed 64 for
   any provider kind: 64 is the documented per-request limit of the Ollama decision models, and Jev's limit is not
   documented (`research-decision-models.md:74`). Every question counts toward Q, whatever question layout per phase
   the architect chooses, and one phase's questions are never split across requests. When the phases due in request 1
   or in request 2 (criterion 4) need more than Q questions, the system shall send, in the caller's phase order, the
   phases that fit, and shall not send the rest; each phase not sent shall take the ranking's choice with source
   `ranking` and fallback cause `question-limit`. No extra request is made for the overflow, so the budget of
   criterion 5 holds. A fixture with 70 non-review phases to staff, each with at least two eligible candidates (more
   than 64 questions), shall assert that no request carries more than Q questions, that at most two requests are made,
   that the phases beyond those that fit carry the ranking's choice and cause `question-limit`, and that the result
   still holds one entry per phase.

### 13. Reasons and confidence compiled by code

Requirement: every reason and every confidence in the result is produced by Ptah code from the result's own facts,
because decision models return typed answers and no text (`research-decision-models.md:565`).

Acceptance criteria:

1. No model-generated text shall appear in the result. Free text returned by a structured-output model shall be
   discarded.
2. Each chosen roster entry's reason shall state at least: the chosen executor and model; its score and the matrix
   provenance of that cell (seed with `asOf` and `stale`, user, local with sample count, or "no profile"); its limit
   state; whether rotation or a preference changed the choice; for a model-sourced entry, the model's probability for
   the chosen option, or "no confidence reported" when the model reports none (Requirement 1.8); and for a fallback,
   its cause. An unavailable entry's reason shall state its exclusion reason and the rule that excluded each candidate
   (Requirement 2.3).
3. `reasons` shall also list every excluded candidate with its rule (`at-limit`, disabled, not installed,
   never-on-a-lane, reviewer family, pruned, pin unavailable with the pin's rule or `not-listed`) and every missing
   input (Requirement 4.5).
4. A consistency test over fixtures for every source (`model`, `ranking`, `pin`), every fallback cause and every
   unavailable exclusion reason shall assert that each fact in a reason matches the result's own fields: the executor
   named equals the entry's executor; the probability equals the one the fake model returned for that option, or the
   reason says "no confidence reported" when the fake model returned none; and no reason names a candidate absent from
   the input rows.
5. A model-sourced answer's confidence shall be the provider's confidence for that answer (0-1) when the provider
   reports one, and null when the selected model reports no native confidence (Requirement 1.8). A `ranking`, `pin` or
   `skill-table` answer and an unavailable entry shall carry confidence null and do not count as model-sourced. The
   overall confidence shall be null when there are no model-sourced answers; null when any model-sourced answer has
   null confidence, because a minimum over only the known part would overstate the result's reliability; and
   otherwise the minimum over the model-sourced answers (the roster entries at `gate-0.1`; the task-type and depth
   answers at `pre-flight`). Tests: model-sourced entries at 0.9 and 0.6 expect 0.6; a model-sourced 0.8 beside a
   `ranking` entry expects 0.8; a model-sourced 0.8 beside a model-sourced null expects null; and on the
   structured-output path, a fake structured-output model that returns valid answers with no confidence, run at both
   stages, expects model-sourced answers with confidence null, overall confidence null, no `low-confidence` fallback,
   the reason "no confidence reported", and "—" in the Gate 0.1 table (Requirement 8.3). Rationale: a roster is only
   as reliable as its least certain model choice.

## Non-functional requirements

- Performance: every decision-model request is bounded by the timeout of Requirement 4.1, the number of requests is
  bounded by Requirement 12.5, and the number of questions per request by Requirement 12.9. Without a decision model,
  the tool makes no decision-model request.
- Security and privacy: the payload sent to a decision model is limited to the request text, the offered options (lane
  id, family, model, limit state, score) and aggregated outcome figures. It never includes file contents, deliverable
  paths, credentials, environment variables or full prompts. A test asserts the outbound payload's field set. The
  setting discloses where the data goes (Requirement 1.4). Rationale: Jev and remote endpoints receive the payload
  off the machine (`research-decision-models.md:560`). Credentials for Jev and remote endpoints are stored in the same
  secret storage as other provider keys and are never written in plain text to settings, as for existing providers.
- Token cost: each routing result reports the requests' tokens and cost, or null when the provider does not report
  them (Requirement 2.3).
- Compatibility: the tool works wherever Ptah MCP tools are served (the VS Code extension, the Electron desktop app and
  stdio MCP hosts; stdio exposure follows `mcp-stdio/tool-builders.ts:28,117`). A host without outcome persistence
  still routes, using the seed matrix and neutral scores, and says so in `reasons` (Requirement 4.5).

## Stakeholders

| Stakeholder | What they need from this change | How they will judge it |
| --- | --- | --- |
| User running `/orchestrate` | Better lane choices across all installed CLIs, visible and overridable | Gate 0.1 shows a routing table with reasons; runs use more than one lane; an override is respected |
| User with privacy concerns | Control over where request text goes | The setting states where data goes; unset sends nothing |
| Ptah skill maintainers | Routing evidence as data, not hand-edited vendor lists | Matrix values with `source`/`asOf`/`stale`; `unknown` where no evidence; skills free of vendor routing tables |
| Library tab users | A per-agent figure that tells agents apart | Agent cards show differing outcome signals with counts, or "no data yet" |
| Reviewers / QA | Checkable guarantees | The constraint (3), spread (7), pipeline (12) and reason-consistency (13.4) tests pass |

## Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Little or no outcome history at first, and five of six task kinds have no public evidence, so most scores are neutral | HIGH | MEDIUM | Architect sets the minimum sample count (Requirement 6.6); "no profile" and seed provenance appear in every reason (13.2); the spread rule still rotates among neutral lanes (7.1) |
| A hosted decision model receives sensitive request text | MEDIUM | HIGH | Unset by default; the setting shows the disclosure (1.4); a payload test pins the field set (owner: architect and QA) |
| The model proposes ids that do not exist or were not offered | HIGH | MEDIUM | Options are pre-filtered and answers re-validated (2.6, 11.4), covered by fake-model tests (owner: QA) |
| Jev's first-option bias concentrates work on one lane | MEDIUM | MEDIUM | Architect specifies the option order; QA adds the always-first fixture of Requirement 7.8 |
| The spread rule sends a critical phase to a weaker lane | MEDIUM | MEDIUM | Rotation only within B (7.3); boundary fixtures at B (owner: QA) |
| A seed row is matched to the wrong family or model | MEDIUM | LOW | Unmatched rows are not seeded (6.2); each seed value shows `source`, `asOf` and `stale` (owner: architect) |
| Subagent telemetry joins to the wrong `skill_invocation_events` row | MEDIUM | MEDIUM | One-to-one join with `unmatched`/`ambiguous` markers and the two-run fixture (5.4) (owner: QA) |
| TASK_2026_659_cec4 proposes removing the `skill_invocation_events` data this task reads | LOW | HIGH | Architect names that table as a dependency in `implementation-plan.md`; the orchestrator flags it to TASK_2026_659_cec4 before that task's removals reach the user |
| TASK_2026_658_advanced_settings edits the same settings files at the same time | MEDIUM | LOW | Team-leader checks that task's file list before assigning the settings batch and sequences any overlap |
| The user's Ollama endpoint is older than 0.35 or does not serve `/v1/systemone` | MEDIUM | LOW | The row shows the unsupported state (1.5) and routing falls back to the ranking (owner: frontend and backend developers) |

## Proposed Removals

- **Library → Agents tab "Success" percentage** (`clone-card.component.ts:413-420`, `clone-detail-drawer.component.ts:559-560`,
  for `kind === 'agent'` only): replaced with outcome signals (Requirement 9). Reason: the user reports the same 100%
  for every agent, so the figure carries no signal. The underlying `CloneSummary.successRate` field and the metric on
  the Skills and Commands tabs stay. **Approved by the user on 2026-10-14 (`decisions.md` #13).**

## Open questions

Closed by research or user decision:

- Ollama decision-model input format and suitability: shared `POST /v1/systemone` with `state` and typed questions;
  limits recorded (`research-decision-models.md:38-44,52-78`). Closed.
- Jev API contract, authentication, rate limits and cost: `research-decision-models.md:38,70-78` (Bearer key, 80
  requests per second, USD 0.042 per million input tokens). Closed.
- Public datasets for the seed: only SWE-bench Verified for implement (backend), possibly stale
  (`research-routing-landscape.md:9-11`; `decisions.md` #7). Closed; reflected in Requirement 6.2-6.3.
- Which lane CLIs report tokens and cost on completion: none through the completion signal
  (`research-codebase-survey.md` §2). Closed; reflected in Requirement 5.3.
- What "confirmed room" means: the shared `confirmed-room` lane state (`lane-state.ts:158-159`). Closed.
- Unset behaviour for lane selection: deterministic code ranking always (`decisions.md` #12). Closed.
- Replacing the Agents-tab "Success" figure: approved (`decisions.md` #13). Closed.

Still open, none blocking the architect:

- Architect: the values S, B, T, K, L and the near-limit/unknown order (Requirement 7); P (12.2); Q (12.9); the
  timeout and margin (4.1); the confidence threshold (4.3); the neutral score, minimum sample count, staleness age and
  seed-label mapping (Requirement 6); the window W (9.1).
- Architect: where outcome records live (`research-codebase-survey.md` "Decisions" 1), and whether the VS Code host
  has that persistence (the Library RPC reports desktop-only at `skills-synthesis-rpc.handlers.ts:2285`).
- Architect: the subagent run join key to `skill_invocation_events` (Requirement 5.4).
- Architect: where the matrix is shown and edited, a settings UI or a data file. A new UI surface would add the
  designer and Gate 1.7.
- Architect: the decision-model call path (`research-codebase-survey.md` "Decisions" 3; the research recommends one
  raw System One client with a configurable base URL, `research-decision-models.md:563`).
- Architect: how a stored preference changes the ranking (Requirement 2.4).
- External, unresolved by research: whether any decision model is served on Ollama Cloud, the Ollama decision
  endpoint's error codes and retry contract, and the disagreeing score-level limits
  (`research-decision-models.md:544-547`). These matter only if the architect relies on them.

## Handoff

- Next specialist: software-architect.
- Why: the external unknowns are answered by the three research files (`decisions.md` #14 skips a separate synthesis),
  and the user decisions #12 and #13 settle the behaviour; what remains is the shape — the store, the call path, the
  ranking values and the matrix surface.

## Revision log

Revision 2, against `task-description-review.md` round 1 and `decisions.md` #12-#13.

| Item | Change |
| --- | --- |
| Finding 1 (blocking): rows have no model ids | New Requirement 11 (per-row live model listing, provenance, `lane-default` for unknown or auto models, validation). Context paragraph 1 cites the formatter, `modelCount`, `CliModelListService` and the spawn `model` default. Requirement 2.3-2.4 and 3.1 point to it. |
| Finding 2 (blocking): scorecard is aggregate | Requirement 5.2-5.6 rewritten: lane records from the completion event; lane tokens and cost null (5.3); subagent metrics from the run's own `skill_invocation_events` row with a one-to-one join, `unmatched`/`ambiguous` markers and a double-count test (5.4); subagent deliverable verdict (5.5); review verdict join by run id (5.6). Context paragraph 2 corrected. `parity-inventory.md` scorecard row updated. |
| Finding 3: seed cannot fill all task kinds | Requirement 6.1-6.4 rewritten: cells are `unknown` or evidenced values with `source`, `asOf`, `stale`; seed only implement from SWE-bench; no inference to other kinds (6.3, with test); unmatched seed rows skipped. |
| Finding 4: unset path contradiction | Applied `decisions.md` #12. Requirement 1 statement, 3.7, 4.4, 7 statement and 8.1 now agree: ranking always chooses lanes; type and depth fall to the skill table when unset. Out of scope bullet on rule tables and the open question at revision 1 lines 338-340 updated or closed. |
| Finding 5: who writes reasons | New Requirement 13: code-compiled reasons, required facts, exclusion list, consistency test, confidence aggregation (minimum over model-sourced entries). |
| Finding 6: roster may not fit one question | Requirement 12.2-12.3 and 12.6: top-P pruning bounded by provider option limits, single-candidate phases not sent, request-size check with `payload-too-large`. |
| Finding 7: reviewer depends on implementer | Requirement 12.4: request 1 for non-review phases, then family filter and request 2; 12.5 caps requests at 1 / 2 / 1; Requirement 3.3 references it. |
| Finding 8: spread values undefined | Requirement 7 now lists S, B, T, K, L and headroom order for the architect to set, uses the existing `LaneLimitState` values, and adds boundary, restart and limit-change fixtures (7.3, 7.5, 7.6) and the first-option-bias fixture (7.8). |
| Finding 9: Library metrics undefined | Requirement 9.1 defines each numerator, denominator, exclusion, empty text, tie rule and window W, and shows counts beside each rate. |
| Finding 10: open questions already answered | Open questions split into closed (with research citations) and still open. The Jev research risk is replaced by the Ollama-version risk. |
| `decisions.md` #13 | Requirement 9 statement updated; former 9.5 (blocking until approval) replaced by a two-agent fixture; Scope, Risks and Proposed Removals mark the approval. |
| Introduced constraint: Ollama Cloud as a named option | Dropped. Requirement 1.2 offers the three kinds in the user's shape; Ollama Cloud serving of decision models is undocumented. |
| Introduced constraint: per-batch exclusion, spawn/completion exclusion | Kept with rationale (context.md:85-86; TASK_2026_441_7825 ownership); clarified that a record write at completion is in scope. |
| Introduced constraint: disclosure, credential state, deep link, persisted selection | Kept with rationale in 1.4-1.6 (payload leaves the machine; same behaviour as the existing six rows; a setting must persist). |

Revision 3, against `task-description.md` review round 2 (`task-description-review.md`). Only these four findings
were changed; closed findings and `decisions.md` #12-#13 were not reopened.

| Item | Change |
| --- | --- |
| Round-1 Finding 6 (open, serious): no question cap per request | New Requirement 12.9: at most Q questions per request, Q ≤ 64 for every provider kind (`research-decision-models.md:74`; Jev's limit undocumented); phases never split across requests; overflow phases, in caller order, take the ranking's choice with new cause `question-limit`; no extra request, so 12.5 holds; 70-phase fixture. 12.4 points to the cap; 12.7 adds `question-limit`; Requirement 12 statement, Non-functional Performance and the architect open question (Q) updated. |
| New Finding 1 (serious): `unavailable` entries cannot carry choice facts | Requirement 2.3 split into a chosen-entry branch and an unavailable-entry branch (required exclusion reason `no-eligible-candidate` / `reviewer-family` / `pin-unavailable`, excluding rules, `not-listed` for unknown pins, disclosed-fallback flag, choice fields null, schema rejects mixed shapes). New 2.7 tests the zero-candidate and invalid-pin cases. 3.3, 3.6, 12.3, 13.2, 13.3 and 13.4 reference the branch. |
| New Finding 2 (serious): confidence for structured-output models without native confidence | Requirement 13.5 rewritten: model-sourced confidence is nullable; overall confidence is null when any model-sourced answer has null confidence, the minimum otherwise, null with no model-sourced answers; mixed and structured-output-path tests at both stages. 1.8 aligned to 13.5; 13.2 and 13.4 cover "no confidence reported". |
| New Finding 3 (serious): Pre-flight failures prescribed the ranking | Requirement 4 statement and new 4.6 define the stage fallback: Pre-flight answers become null with source `skill-table` and the cause; Gate 0.1 entries take the ranking's choice. 4.1-4.3 now apply "the stage's fallback". 2.2, 2.6, 12.6 and 12.8 aligned. 4.6 adds a table-driven test of every 12.7 cause at both stages (`question-limit` at Gate 0.1 only). |
