# Implementation Plan Review — Gate 2

- **Author:** software-architect, claude family
- **Reviewer:** code-logic-reviewer, kimi-code family
- **Plan revision reviewed:** 3
- **Round:** revise 2 (final)

## Verdict

**APPROVED**

All revision-2 items are resolved. The new and changed batches satisfy the batch contract. The revision-3 edits preserve the earlier resolutions and decisions.md #5–#9. No build, test, lint, or typecheck command was run.

## Revision-2 item status

| Item | Status | Evidence |
| --- | --- | --- |
| Serious 1 — no-snapshot carry-forward | RESOLVED | R15 and Component 19 cover both resume branches, use normalized model equality, and pin F12 at 15% (`implementation-plan.md:30,158-165,609-623,857-864`). The current no-snapshot branch erases the reading (`libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts:1248-1287`), and the host returns no snapshot at a latest compact boundary (`libs/backend/agent-sdk/src/lib/session-history-reader.service.ts:1281-1285`). |
| Serious 2 — sidechain context records | RESOLVED | C4 and Component 20 skip sidechain assistant frames and compact boundaries before boundary handling. F13 and F14 pin both cases (`implementation-plan.md:31,174-177,625-633,838-845`). The current scan has no sidechain check (`libs/backend/agent-sdk/src/lib/session-history-reader.service.ts:1281-1296`), while the projected message carries the flag (`libs/backend/agent-sdk/src/lib/helpers/history/history.types.ts:83-84`). |
| Serious 3 — builder context view | RESOLVED | Component 23 routes the collapsed summary through `sessionContextCue`, and HB1 owns the component and spec with F2 and F6 tests (`implementation-plan.md:32,200-225,658-670,875-882`). The component currently reads `contextPercent` directly (`libs/frontend/harness-builder/src/lib/components/sidebar/builder-session-section.component.ts:57-59`). The existing cue rejects an unknown window (`libs/frontend/chat-ui/src/lib/molecules/session/session-stats-view.ts:42-59`). |
| Serious 4 — provisional turn count | RESOLVED | R18 assigns accepted turns only to the authoritative contribution and `turnCount: 0` to the provisional estimate. Incomplete runs omit both. TC2 pins 4 + 2 + estimate = 6 (`implementation-plan.md:33,559-566,592-599,820-826`). The owner currently emits separate authoritative and provisional contributions (`libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts:864-891`) through `runContribution` (`session-stats-owner.service.ts:1091-1136`). |
| Serious 5 — compact-summary projection | RESOLVED | Component 22 adds the raw field, the typed projection, and literal-`true` conversion. TC1 then forwards it into the resume ledger. TC0 and TC1 include the parity coverage (`implementation-plan.md:34,567-570,643-656,802-818`). The field is absent from both current interfaces (`libs/backend/agent-sdk/src/lib/helpers/history/history.types.ts:16-52,77-116`), the converter does not forward it (`libs/backend/agent-sdk/src/lib/helpers/history/jsonl-reader.service.ts:925-959`), and the resume projection is the required consumer (`libs/backend/agent-sdk/src/lib/session-history-reader.service.ts:1323-1342`). |
| Minor 1 — parallel file overlap | RESOLVED | R20 now prohibits overlap only between batches that can run in parallel. It names the serial B2 → CX1 and TC1 → CX2 exceptions (`implementation-plan.md:35,738-746,1142-1149`). This is a plan-only batch-rule correction. |

## Blocking issues

None.

## Serious issues

None.

## Minor issues

None.

## Batch contract check

| Batch | Files / libs | Dependencies and verification | Result |
| --- | --- | --- | --- |
| TC0 | 3 / 1 | No dependencies. Scoped agent-sdk verify plus host typecheck (`implementation-plan.md:802-809`). | PASS |
| TC1 | 6 / 2 | Depends on TC0. Scoped shared and agent-sdk verify plus host typecheck (`implementation-plan.md:811-818`). | PASS |
| TC2 | 2 / 1 | Depends on TC1. Scoped agent-sdk verify plus host typecheck (`implementation-plan.md:820-827`). | PASS |
| CX2 | 4 / 1 | Depends on CX1 and TC1. Scoped agent-sdk verify plus host typecheck (`implementation-plan.md:838-846`). | PASS |
| CX4 | 4 / 1 | Depends on CX1 and CX3. Scoped chat verify (`implementation-plan.md:857-864`). | PASS |
| HB1 | 2 / 1 | Depends on CX3. Scoped harness-builder verify (`implementation-plan.md:875-882`). The Nx project name is valid (`libs/frontend/harness-builder/project.json:2`). | PASS |

Every listed batch has acceptance criteria and named tests. No listed batch uses a workspace-wide check or a forbidden target. The dependency graph has no cycle. TC1 → CX2 remains serial. HB1 and TC0 share no files with another batch. The only shared files remain behind explicit dependencies (`implementation-plan.md:745,1149`). No command was executed for this check.
