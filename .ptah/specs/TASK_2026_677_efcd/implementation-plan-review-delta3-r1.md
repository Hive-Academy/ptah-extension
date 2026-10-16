# Implementation plan review, Delta 3, round 1 (Gate 2 delta)

Verdict: APPROVED

Score: 9/10

Reviewer: codex

## Findings

| Round-0 finding | Resolved? | Evidence file:line |
| --- | --- | --- |
| 1. Blocking: main-panel stats disappear | Yes. The single source retains the tab-or-ChatStore resolution, active session ID, view budget, and the existing message mount rule. The chat view keeps its sole plan-limits scope and SESSION / PLAN LIMITS / LANES render in the main panel. | `plan-part-d-stats.md:221-273,337-341,375-383,418-419`; `implementation-plan.md:134-144,164-167,182`; `chat-view.component.ts:798-807,948-953,1023-1048,1061-1105,1328-1337` |
| 2. Serious: completed foreground sub-agent models lost | Yes. `agentModelsByKey` reads all sub-agent and CLI roster inputs by roster key; tray contexts retain their active-only population and supply actions separately. The C-2 `SessionAgent` type stays unchanged. | `plan-part-d-stats.md:291-329,345-348`; `implementation-plan.md:155-162`; `session-agent-roster.ts:145-176`; `background-agent-tray.component.ts:212-244` |
| 3. Serious: no main-panel Focus path | Yes. Row activation requests a lane when available, otherwise calls tray `focus` for a matching context. Rows without a tray context keep selection only and offer no Focus action. | `plan-part-d-stats.md:352-365`; `implementation-plan.md:161-162,399-403`; `plan-part-b-inspector.md:328-329,451-452`; `background-agent-tray.component.ts:338-343`; `task-description.md:948-952` |
| 4. Moderate: stale W3 status and header ownership | Yes. W3 is identified as not started; the plan explains the `batches.md` next-wave flag and retains CV-2 as the sequential header owner because its inputs depend on D-1 work in W3. | `plan-part-d-stats.md:13-23,489-492`; `implementation-plan.md:185-189,308-315`; `decisions.md:67` |

No new Blocking or Serious finding. D-1 and C-3 lane suitability matches the round-0 ruling and user row 60; other batches remain assigned to Claude (`implementation-plan.md:317-326`). W3 files are disjoint, shared barrels and chat-view edits are serialized, and the Rail board reads the chat source without reversing the canvas-to-chat dependency (`implementation-plan.md:229-244,308-315`; `plan-part-d-stats.md:402-407,451-458`). The Rail closed-state cue remains an explicit later check, as in round 0 (`plan-part-d-stats.md:478`).

## Proposed Removals

None new. R2 is user-approved: CV-1 deletes `BackgroundAgentTrayComponent` and renames its two specs onto the tray service while preserving their cases (`decisions.md:69`; `plan-part-d-stats.md:539-556`; `implementation-plan.md:368-374,490`).

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Approve the single stats source for both main and scoped hosts | One moved source with ChatStore fallback / separate host derivations / null without a tab | `plan-part-d-stats.md:221-273`; `chat-view.component.ts:948-953,1023-1042` | Yes |
| Keep AGENTS model data separate from action contexts | Join all roster inputs / derive only from active tray contexts | `plan-part-d-stats.md:307-327`; `session-agent-roster.ts:145-176` | Yes |
| Preserve Focus according to available surface and context | Lane request, then owning-tab focus, then select only / lane request only | `plan-part-d-stats.md:352-365`; `plan-part-b-inspector.md:328-329,451-452` | Yes |
| Retain serialized CV-2 header ownership | CV-2 second owner / amend A2-1 in W3 | `implementation-plan.md:185-189,308-315`; `decisions.md:67` | Yes |

## Clarifications Needed

None.
