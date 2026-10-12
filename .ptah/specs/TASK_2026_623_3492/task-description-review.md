# Requirements Review — TASK_2026_623_3492

Author: project-manager subagent  
Reviewer: codex lane  
Revision: 2  
Round: 1

## Verdict

APPROVED

## Round 0 defects

| # | Status | Evidence |
| --- | --- | --- |
| 1 | Fixed | `task-description.md:405` correctly makes unescaped `|` the separator and retains `\|` as the literal-pipe escape. |
| 2 | Fixed | `task-description.md:266-277` binds the cap to the current value of 8 and specifies 8, ninth-new-id, and ninth-update boundary cases. |
| 3 | Fixed | `task-description.md:512-535,565-575` defines ordered identity keys, merge/field precedence, aggregate semantics, and row/count fixtures including duplicate candidates. |
| 4 | Fixed | `task-description.md:32-53,55-73` uses the full `libs/shared/src/mcp-apps-contracts/` paths for the parser, fence, pipeline, types, catalog, and patch claims. |
| 5 | Fixed | `task-description.md:582-584,639-646` implements the user-approved Electron tests-row move to the panel Tests card and chip, while preserving the unchanged VS Code state. |
| 6 | Fixed | `task-description.md:680-695` makes preview conformance observable with host/theme/breakpoint screenshots, itemized visual-spec comparison, and a measured collapsed-row baseline. |

## New defects

None.

## Verified claims

- `task-description.md:267-275` — Verified. `SURFACE_STORE_LIMITS.maxSurfacesPerRoutingId` is 8 at `libs/shared/src/mcp-apps-contracts/surface-catalog.ts:157-160`.
- `task-description.md:32-45` — Verified. The revised fully qualified parser, fence, pipeline, and type paths exist in this worktree.
- `task-description.md:514-531` — Verified. `ExecutionNode.toolCallId` and `agentId` exist at `libs/shared/src/lib/types/execution/node.ts:158,171-199`; `SubagentRecord.parentToolUseId` and `agentId` exist at `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts:526-540`.
- `task-description.md:639-646` — Verified. The cited current Electron-only test-row gate is at `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.ts:580-596`.
- `parity-inventory.md:57,96,103-107` — Verified. The inventory records the approved Electron tests-row and change-set placement moves, preserves VS Code where required, and retains the footer badges.
- `task-description.md:731-790` — Reviewed. R9 names the covered component set, exact container breakpoints, collapsed/expanded keyboard and accessibility behaviour, overflow assertion, and layout assertions. `task-description.md:512-575` likewise makes R5's merge rule testable through ordered matching plus complete fixtures.
