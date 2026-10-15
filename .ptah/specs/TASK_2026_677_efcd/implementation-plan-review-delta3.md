# Implementation plan review, Delta 3 (Gate 2 delta)

Verdict: REVISE

Score: 5/10

Reviewer: codex

## Findings

1. **Blocking — main-panel stats disappear.** `plan-part-d-stats.md:220-233` makes `inputs` null whenever `tab()` is null; CV-1 passes `resolvedTab()` (`:297-299`). In the main panel, `chat-view.component.ts:948-953` *always* returns null because there is no `SESSION_CONTEXT`, while today's strip reads `chatStore.sessionStats()`, `liveModelStats()` and `compactionCount()` (`:1023-1042`) and still mounts with messages (`chat-view.component.html:35-49`). Consequently the proposed inspector omits SESSION, PLAN LIMITS and LANES in the primary chat view (`plan-part-d-stats.md:275-279,339-344`), violating req 21.1, 21.3-21.21 and 21.28 (`task-description.md:841-939,972-976`). `D-O5` (`plan-part-d-stats.md:381`) defers a path that the current code proves is reachable. Specify a single source that preserves the main-panel ChatStore fallbacks, session ID, and budget while using tab state for a scoped tile. Keep the one scope per chat view.

2. **Serious — known models of completed foreground sub-agents are lost.** `plan-part-d-stats.md:252-267,280-283` obtains AGENTS extras from tray contexts; the moved tray mapper filters foreground sub-agents to running/pending/paused (`background-agent-tray.component.ts:212-222,241-244`). The roster includes completed foreground records (`session-agent-roster.ts:145-157`), and the approved design requires the known `SubagentRecord.usage.model` in that agent's AGENTS entry (`design-spec.md:1509-1514`; req 21.11 at `task-description.md:891-894`). Specify an independent model join over *all* roster records by `parentToolUseId`, while keeping tray contexts restricted to their current population and actions. This does not require changing the C-2 roster type.

3. **Serious — Focus action has no main-panel path.** The plan lists `SessionAgentTrayService.focus(ctx)` (`plan-part-d-stats.md:254`) but says the AGENTS row keeps Part B's `laneRequested` behavior (`:280-285`). Part B emits `laneRequested` only when `hasLaneSurface` (`plan-part-b-inspector.md:328-329`); the main panel has no lane surface (`:452`). Today's tray Focus switches to the agent's owning tab (`background-agent-tray.component.ts:338-343`), and req 21.23 requires the same action (`task-description.md:948-952`). Bind the row activation to the tray service's `focus` when no lane surface exists, and retain the lane request where one exists. Specify the behavior for a row without a tray context.

4. **Moderate — W3 status and ownership rationale are stale.** Part D and the merged plan say B-3/A2-1 are in progress, using that as the reason to reserve header changes for CV-2 (`plan-part-d-stats.md:14,18-19,395-396`; `implementation-plan.md:295-302`). `decisions.md:67` says W3 has not started, while `batches.md:387,442,493` marks three W3 batches IN_PROGRESS. Reconcile the authoritative execution state before assigning owners. The serialized second owner is technically safe if retained; the review does not require moving that work.

The remaining mapping is substantially complete: D10 maps C-2..C-6, C-19..C-50, C-48b and C-49 to D-1/B-4/A1-3/CV-1/CV-2/B-5 (`plan-part-d-stats.md:418-437`), and §3.3 names their files (`implementation-plan.md:227-231`). The limit summary covers session indicator plus lane subgroups and specifies pending > at > near > workflow precedence (`plan-part-d-stats.md:127-149`; `implementation-plan.md:140-143`). The chat-ui and chat barrels are serialized (`implementation-plan.md:188-196`); CV-1→CV-2→CV-3 and the header's A2-1→CV-2 second ownership are sequential (`:164-176,289-292`). D-1's chat-ui edits are file-disjoint from B-3/C-3/A2-1 (`:223-228,281-285`). The source has no second `registerScope`, and the existing scope releases on destroy (`chat-view.component.ts:1044-1048,1329-1337`; `plan-limits.store.ts:144-164`). Rail `[stats]` is assigned to B-5 (`plan-part-d-stats.md:316-320`); showcase scene breakage is disclosed as R-D6 (`:413-414`). Existing specs to preserve or update are named at `plan-part-d-stats.md:365-371`; no new spec file is requested. The model badge removal is assigned to A1-3 (`:312-315`) and the composer remains untouched. Keyboard disclosures, heading focus, menu keys and focus return are specified (`:165-176,184-193,286-289`).

## Lane suitability

| Batch | Lane-suitable | Reason |
| --- | --- | --- |
| D-1 | Yes | Mostly new, self-contained chat-ui files; strip delegation and one mechanical append to `chat-ui/src/index.ts`; disjoint from the other W3 owners. The existing strip and tile specs are named. |
| C-3 | Yes, with ownership guard | Canvas-only dock work, file-disjoint from other W3 batches (`implementation-plan.md:225,281-284`). It replaces a component and touches several canvas files, so assign one lane the whole batch and one separate reviewer; row 60 permits self-contained batches that mostly add new files (`decisions.md:65`). |
| B-3 | No | Existing chat services, shared barrels and webview app provider; the current plan assigns it to Claude (`implementation-plan.md:223,295-302`). |
| A2-1 | No | Header contract is revisited by CV-2, so one owner family avoids contract drift (`implementation-plan.md:174-176`). |
| B-4 / A1-3 / CV-1..3 / B-5 | No | Inspector composition, execution-tree edit, serialized chat-view chain or Rail integration; follow the merged ownership plan. |

## Proposed Removals

Part D proposes removing `BackgroundAgentTrayComponent` and its two specs (`background-agent-tray.component.spec.ts`, `background-agent-tray.scope.spec.ts`) after its only mount leaves chat-view (`plan-part-d-stats.md:439-449`). Options for the user are (a) move the two spec cases onto the new tray service then delete the component and old specs, (b) delete and cover the service later, or (c) keep an unmounted thin delegate. No ruling here. Until approval, B-4 delegates through the component and CV-1 keeps it and both specs; the plan works under that default (`implementation-plan.md:228,230,456`).

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Require a main-panel fallback in `injectSessionStatsSource` before approval | Preserve ChatStore fallback / accept null stats | `chat-view.component.ts:948-953,1023-1042`; `plan-part-d-stats.md:220-233` | Yes |
| Derive model extras from all roster agents, separately from active tray contexts | All roster records / tray context only | `session-agent-roster.ts:145-157`; `background-agent-tray.component.ts:217-222`; `design-spec.md:1513` | Yes |
| Route AGENTS row activation by available surface | Lane request when available, owning-tab Focus otherwise / lane request only | `plan-part-b-inspector.md:328-329,452`; `background-agent-tray.component.ts:338-343` | Yes |
| Keep serialized W3 and CV-2 ownership while reconciling status | Retain current owners / amend A2-1 before start | `decisions.md:67`; `batches.md:387,493`; `implementation-plan.md:174-176` | Yes |

## Clarifications Needed

None for the plan corrections. The proposed removal remains a separate user decision.
