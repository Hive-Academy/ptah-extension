# Parity Inventory - TASK_2026_646_136a

Surface being changed: the per-agent metrics on the Thoth Library Agents tab, which is the agent clone card and its
detail drawer (`libs/frontend/skill-synthesis-ui/src/lib/components/clones/`). Only the metrics are in scope. The rest
of the card (actions, model guard, sync chips) is not touched.

| Capability | Where today (file:line) | Backing RPC / API | Decision (keep / move / remove-proposed) | New location | Test that proves it |
| --- | --- | --- | --- | --- | --- |
| Invocations count, all kinds | `clone-card.component.ts:405-411`; `clone-detail-drawer.component.ts:556-558` | skillSynthesis clone list → `toCloneSummary` (`skills-synthesis-rpc.handlers.ts:2299-2323`), `invocationCount` | keep | unchanged | `clone-card.component.spec.ts`, `clone-detail-drawer.component.spec.ts` |
| "Success" %, agent kind | `clone-card.component.ts:413-420`; `clone-detail-drawer.component.ts:559-560`; `formatSuccessRate` `clone-action-gating.ts:240-245` | `CloneSummary.successRate` = `succeeded/total` (`skills-synthesis-rpc.handlers.ts:2305`; `skill-candidate.store.ts:1430-1456`) | replace (approved by the user 2026-10-14, `decisions.md` #13; Requirement 9) | Agent card and drawer: delivered rate, review pass rate with average revise rounds, most frequent failure class, each defined in Requirement 9.1 and computed from the outcome record (Requirement 5), not from `successRate` | New spec cases in `clone-card.component.spec.ts` and `clone-detail-drawer.component.spec.ts` (architect to name) |
| "Success" %, skill and command kinds | Same lines as above, `kind !== 'agent'` | Same as above | keep | unchanged | Existing `clone-card.component.spec.ts`, `clone-action-gating.spec.ts` |
| Last enhanced | `clone-card.component.ts:422-428`; `clone-detail-drawer.component.ts:561-566` | `CloneSummary.lastEnhancedAt` | keep | unchanged | `clone-card.component.spec.ts` |
| History snapshot count | `clone-card.component.ts:430-434`; `clone-detail-drawer.component.ts:567-569` | `CloneSummary.historyCount` | keep | unchanged | `clone-card.component.spec.ts` |
| Scorecard badge: graded "% ok", invocations, tokens, cost, last-5 verdict dots | `scorecard-badge.component.ts:25-79`; mounted at `clone-card.component.ts:193-194`, `clone-detail-drawer.component.ts:260-265` | skillSynthesis getScorecards → `AgentScorecard` (`rpc-skill-clone.types.ts:236-271`) | keep (unchanged display; the subagent outcome record takes per-run tokens, cost and duration from the run's own `skill_invocation_events` row, never from this aggregate, Requirement 5.4) | unchanged | `scorecard-badge.component.spec.ts` |
| `CloneSummary.successRate` field | `rpc-skill-clone.types.ts:25` | Same RPC | keep (still used by the Skills and Commands tabs) | unchanged | `skills-synthesis-rpc.handlers.spec.ts` |

## Proposed Removals

- "Success" % on Agents-tab cards and drawer (`kind === 'agent'`). Reason: the user reports that it reads 100% for
  every agent, so it carries no signal. It is replaced with outcome signals from the lane and subagent outcome record.
  Requires explicit user approval.
  **Approved by the user on 2026-10-14** (decisions.md #13).
