# Code Logic Review — `TASK_2026_583_c0a1`

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 7/10           |
| Assessment          | APPROVED       |
| Blocking issues     | 0              |
| Serious issues      | 0              |
| Moderate issues     | 6              |
| Failure modes found | 6              |

Scope read in full: `compact-session-summary.ts`, `compact-session-activity.component.ts` (diff plus row builders), `tool-target.utils.ts`, `tool-call-header.component.ts` diff, `canvas-layout-intent.ts`, `canvas-workspace-grid.component.ts` (gesture, apply, CSS), `canvas-tile.component.ts` diff, `tab-persistence.ts`, `tab-manager.service.ts` diff, `chat-types.ts` diff. Cross-checked against `accumulator-core.service.ts`, `event-deduplication.service.ts`, `tool-node.fn.ts` and the SDK transformers for the live-input question. I did not run the test suites. Batch B3 reports canvas 218/218 and lint green; I take that as unverified by me.

## Five logic questions

### 1. How does this fail silently?

- A finalized agent whose child tool failed is ordered after the agent item (`compact-session-summary.ts:319-331`, children are collected after the agent is pushed). `selectRecapItem` scans the array newest-first (`:559-584`), so the child's failure looks "unanswered" even though the agent completed after it. The recap shows a monospace error and the status reads "Failed" when `terminalReason` is null. This is the AC3 pattern (recovered error) through a different path.
- A live running tool has no input: `tool_start` from the stream carries no `toolInput` (`stream-event.transformer.ts:417-428`). The input arrives through `toolInputAccumulators`, which the summary never reads. The row degrades quietly to the tool name, which duplicates the badge (`tool-target.utils.ts:62`). It recovers when the complete-source `tool_start` replaces the stream one (`event-deduplication.service.ts:75-112`).

### 2. What user action produces unexpected behaviour?

- After a reload, the compact tile is created with no `minH`/`maxH`. The bounds are only written inside `grid.load(...)` (`canvas-workspace-grid.component.ts:795-806`), which runs only when a node differs from its target (`:783-796`). A south drag then previews past 5 rows or below 2. The commit still clamps (`:651`), so stored state stays valid and only the preview is wrong.
- Stepping with a stored out-of-range value (for example 9) is a silent no-op: clamp(9)=5, +1 stays 5, and the stepper returns early (`canvas-tile.component.ts:650`). The stored 9 remains. This is harmless because the read clamps.

### 3. What input data produces a wrong answer?

- Bash rows show the full command, not the description. `toolTargetText` prefers `target.full` (`compact-session-summary.ts:679-682`), while the normal view's `short` prefers `description` (`tool-target.utils.ts:48-52`). This diverges from "reads like the normal view". It also puts whole commands in the feed, which can contain secrets or pasted heredocs. The row cuts the display, but `detail` and `title` carry more.
- MCP tool rows show the raw name as the target (`mcp__ptah__workspace_analyze`) beside a short badge ("workspace analyze"), because the fallback target is the raw tool name (`tool-target.utils.ts:62`).
- A failed agent (kind `agent`, `format: 'markdown'`) that is unanswered becomes recap content with kind `error`, rendered as markdown (`compact-session-summary.ts:576`, `:318`). This breaks R1 "tool error text is never markdown" for the agent case.

### 4. What happens when a dependency fails?

- `toText(output)` runs `JSON.stringify` on the whole tool output before the excerpt is sliced (`compact-session-summary.ts:226`, `:351`). The work is unbounded for object outputs. It is repeated on each live rebuild for every failed tool. A circular structure is caught and gives an empty excerpt, so the row falls back to the label (`:574`). Stringifying multi-megabyte output is the risk.
- A missing `toolCallMap` entry, an evicted start or a missing input all fall back to the name "tool" and the label. `findToolStart` tolerates all three (`:286-297`). Good.
- Gridstack `h` that is missing or fractional is rejected and reconciled (`canvas-workspace-grid.component.ts:648-650`). Good.

### 5. What is missing that the requirements never mentioned?

- No test or guard that `minH`/`maxH` are applied on first creation, only after a view change.
- Out-of-range `compactHeightUnits` is persisted as-is. `setCompactHeight` accepts any positive integer (`tab-manager.service.ts:2745-2755`) and restore keeps any positive integer (`tab-persistence.ts:168-200`). Clamping happens only in canvas on read. The AC says "clamped everywhere a value enters"; it is clamped at the drag commit and the stepper, but not at the tab boundary. No visible failure results.

## Failure modes

### Recovered sub-agent failure shown as the recap

- Trigger: finalized turn ends with an agent (complete) whose last child tool failed, and no later parent prose.
- Symptom: recap is a red snippet of the child's error; status is "Failed" (terminalReason null).
- Evidence: `compact-session-summary.ts:319-331` (order), `:559-584` (scan).
- Current handling: agent item precedes its children, so children count as newer.
- Recommendation: push the agent item after its children, or treat a complete agent as `movedOn` for its own descendants.

### Live tool row has no target until the complete message arrives

- Trigger: stream-source `tool_start` with no `toolInput`.
- Symptom: badge "Read" next to a row text that also says "Read".
- Evidence: `stream-event.transformer.ts:417-428`; `compact-session-summary.ts:189-213`; `tool-target.utils.ts:62`.
- Recommendation: fall back to parsing `state.toolInputAccumulators.get(id + '-input')`, or render no text when the target equals the tool name.

### Compact bounds absent on first creation

- Trigger: load or reload where derived geometry equals the created geometry.
- Symptom: live preview is unbounded. The committed value is clamped.
- Evidence: `canvas-workspace-grid.component.ts:783-806`, `creationOptions` at `:340-347` lacks bounds.
- Recommendation: put `...compactResizeBounds(...)` into `creationOptions`, and update it in the `else` branch beside `noResize`.

### Bash description ignored

- Evidence: `compact-session-summary.ts:679-682` versus `tool-target.utils.ts:48-52`.
- Recommendation: use `target.short` for non-path targets, keep `full` for the expanded detail.

### Unbounded stringify of failed-tool output

- Evidence: `compact-session-summary.ts:226`, `:351`, `:731`.
- Recommendation: bound by type; for strings, slice first; for objects, cap the serialization.

### Failed agent rendered as markdown

- Evidence: `compact-session-summary.ts:318`, `:576`.
- Recommendation: emit `format: 'snippet'` or `'plain'` when the agent status is error.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

- Failure modes above, all Moderate.
- Minor: unknown `viewMode` strings pass through restore unchanged (`tab-persistence.ts:200`); they render as full because `isCompactViewMode` is false. Harmless.
- Minor: the live task-tool result item reuses id `tool:<id>`, so an agent row turns into a tool row on completion. This predates the task.

## Data flow

1. Stream events go to `liveItems` (map keyed by `tool:<id>`). Start and result merge. Gap: stream start has no input.
2. `findToolStart` uses `toolCallMap`. OK; it fixes the plan's wrong `events.get(toolCallId)` lookup.
3. `toolTargetText` builds the target from input only, redacted, path shortened. Gap: Bash description ignored.
4. `errorExcerpt` bounds to 600 chars and 8 lines, then redacts. The bound is correct, but the source stringify is unbounded.
5. `selectRecapItem` walks newest-first: newest prose wins; a failed tool wins only when nothing non-failed came after. Correct for flat order; gap for finalized agent children.
6. `selectStatus` uses `content.kind === 'error'`, after prompts, compaction, streaming and terminal reason. Recovered errors no longer mark "Failed". OK.
7. `toolFeedRow` gives icon, status badge, target and check or cross. Failed rows expand to the excerpt only. Successful rows never carry output. OK.
8. Tab height: `setCompactHeight` stores; `tileViewConstraint` clamps; the fingerprint includes mode and height. OK.
9. Restore: both restore paths (`tab-manager.service.ts:2574`, `tab-workspace-partition.service.ts:510`) call `sanitizeRestoredTabs`. `compact-tall` gives 3, plain `compact` gives 2, invalid units are dropped, valid units win. OK.
10. Drag the south handle: start latches a gesture with the fingerprint. Stop queues a microtask cancel, and `change` commits first. `commitCompactHeight` clamps and writes the tab. The gesture is nulled before the write, so the fingerprint-cancel effect does not fire. Reconcile then re-applies geometry. The `_applyingLayout` guard prevents a loop. OK.
11. Lock: `onGestureStart` refuses, handles are hidden by `ui-resizable-disabled` (`noResize = frozen`), and the stepper changes the fingerprint, which the locked effect applies with frozen measurements. OK.
12. Single-tile CSS: the pin is released while `.ui-resizable-resizing` is present and re-applied after the commit changes the variable. OK; covered by a source-reading spec and e2e.

## Requirements fulfilment

| Requirement                                     | Status   | Gap                                              |
| ----------------------------------------------- | -------- | ------------------------------------------------ |
| R1 recap: newest prose, tool error bounded      | COMPLETE | Agent-child ordering, agent error markdown       |
| R2 feed rows from input only                    | PARTIAL  | Live running rows lack target; Bash description  |
| R3 drag 2..5, presets, stepper, per-tab persist | COMPLETE | Initial bounds; clamping not at tab boundary     |
| AC3 recovered error not "Failed"                | PARTIAL  | Finalized agent-child path                       |
| AC6/AC7 handles and lock                        | COMPLETE | None found                                       |
| AC8 migration                                   | COMPLETE | None found                                       |

Implicit requirements not addressed: bounded stringify of large failed output.

## Edge cases

| Case                                     | Handled | How                                  | Concern                      |
| ---------------------------------------- | ------- | ------------------------------------ | ---------------------------- |
| Failed tool then prose                   | YES     | Prose wins                           | None                         |
| Failed, then ok tool, no prose           | YES     | `movedOn`; falls to newest result    | Recap is a bare target       |
| Failed tool with circular or empty output| YES     | Label fallback                       | None                         |
| Missing input or unknown or MCP tool     | YES     | Falls back to tool name              | Duplicated name text         |
| `compact-tall` or plain compact          | YES     | 3 and 2                              | None                         |
| `compactHeightUnits` "3", 2.5, null      | YES     | Dropped, then default                | None                         |
| Stored 99                                | YES     | Clamped on read                      | Stored unclamped             |
| Drag beyond range                        | YES     | Commit clamps                        | Preview unbounded on reload  |
| Drag when locked                         | YES     | Refused at start                     | None                         |
| Toggle full then compact                 | YES     | Height kept on tab                   | None                         |
| Lock toggled mid-gesture                 | YES     | Effect cancels and reconciles        | None                         |

## Verdict

- Recommendation: APPROVE
- Confidence: MEDIUM (tests not re-run; Gridstack behaviour read from code and reports)
- Top risk: a finalized sub-agent's recovered failure can reappear as the recap and as "Failed".
- What a robust implementation would add: children-before-agent ordering; input fallback from `toolInputAccumulators`; bounds in `creationOptions`; `description`-first Bash rows; bounded stringify of output; non-markdown format for failed agents.
