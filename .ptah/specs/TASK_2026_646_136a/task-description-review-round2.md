# Gate 1 requirements review

Artifact: task-description.md  
Revision: 2  
Author: in-process (Claude, project-manager)  
Reviewer: codex lane  
Round: 2  
Verdict: REVISE

## Round-1 findings

| # | Status | Evidence |
| --- | --- | --- |
| 1 | CLOSED | `task-description.md:19-26,417-440` acknowledges absent model IDs and specifies model sources, provenance, `lane-default`, and validation. |
| 2 | CLOSED | `task-description.md:242-275` separates lane completion data from subagent invocation rows, requires a one-to-one run join, and leaves unavailable metrics null. The join key is explicitly assigned to the architect at `task-description.md:571`. |
| 3 | CLOSED | `task-description.md:279-299` limits public seeding to evidenced implementation values and keeps unsupported cells `unknown`. |
| 4 | CLOSED | `task-description.md:111-113,204-205,227-230,314-316,357-370` consistently applies user decision #12: code ranking selects lanes when unset; the skill table supplies task type and depth. |
| 5 | CLOSED | `task-description.md:476-498` requires code-compiled reasons and a consistency test. A separate confidence contradiction is listed below. |
| 6 | OPEN (serious) | `task-description.md:45-47` records the 64-question provider limit, but `task-description.md:460-470` puts every non-review phase into request 1 and every review phase into request 2 without a question-count cap or overflow behavior. P and payload-size checks bound options and bytes, not questions. **Fix:** bound questions per request and define ranking fallback or additional bounded requests for overflow phases, with a >64-question fixture. |
| 7 | CLOSED | `task-description.md:191-194,460-466` selects implementers first, then filters review options against their families. |
| 8 | CLOSED | `task-description.md:318-348` requires fixed spread parameters and adds boundary, restart, changing-limit, and first-option fixtures. |
| 9 | CLOSED | `task-description.md:382-401` defines the Library window, denominators, pending treatment, empty displays, tie rule, and counts. |
| 10 | CLOSED | `task-description.md:550-579` closes researched endpoint and Jev questions and isolates remaining unknowns. |

## New findings

1. **Serious — `task-description.md:157-166,458-459,485-488`.** Requirement 2.3 requires every roster entry to carry a model, provenance, score, confidence, and a reason describing the chosen executor/model, matrix cell, and limit state. Requirement 12.3 also requires an `unavailable` entry when no candidate exists; that entry has none of those facts. **Fix:** define a separate `unavailable` schema branch with null or omitted choice-specific fields and an exclusion reason; test zero-candidate and invalid-pin cases.
2. **Serious — `task-description.md:139-140,495-498`.** Requirement 1.8 permits a structured-output model with no native confidence and exempts it from low-confidence fallback, while Requirement 13.5 requires every model-sourced entry's confidence to be a provider value in 0–1. **Fix:** make confidence nullable for that model class, define overall confidence for mixed known/unknown entries, and test the structured-output path.
3. **Serious — `task-description.md:209-226,473-474`.** The fallback section says task type and depth fall back to the skill's Pre-flight table, but criteria 4.1–4.3 prescribe the ranking's choice for timed-out, errored, or low-confidence answers. Requirement 12.8 now asks task type and depth as model questions; the ranking has no such choices. **Fix:** specify that these Pre-flight failures return null with source `skill-table` and the relevant cause, while Gate 0.1 entries use ranking; test each cause at both stages.

## Parity deltas

`parity-inventory.md:9-15` and `task-description.md:397-400` retain Invocations, Last enhanced, History, the scorecard badge, the Skills/Commands Success metric, and `CloneSummary.successRate`. The Agents-tab Success replacement is explicit at `parity-inventory.md:10,17-22` and `task-description.md:543-546`; user approval is recorded at `decisions.md:16`. No silent removal found.

## Decisions

- **REVISE:** Round-1 Finding 6 remains serious; the three new contract contradictions are serious. Resolve them before architecture handoff.
- User decisions #12 and #13 are final and reflected in revision 2. The approved Agents-tab replacement is not reopened.
- Review was read-only on source and artifacts except this file. No builds, tests, or git state changes were run.
