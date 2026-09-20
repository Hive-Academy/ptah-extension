# Batch 3 render fixes — TASK_2026_466

This batch fixes defects 3 and 5 from `TASK_2026_466`.

## Defect 3: duplicated `ptah_agent_report` text

**Cause:** `AgentReportRouter.buildEnvelope` builds the body as
`trimmedSummary + "\n\n" + message`. When the caller passes `summary === message`,
the report text appears twice inside `<agent-report>`.

**Fix (frontend):** add `deduplicateAgentReportSummary()` in
`libs/frontend/chat/src/lib/utils/agent-report.utils.ts` and apply it to the
peer/user bubble content in `message-bubble.component.ts`.

The helper removes the leading summary only when the first paragraph of the
`<agent-report>` body is identical to the rest of the body. When summary and
message differ, the envelope is returned unchanged.

**Acceptance verification:**

| Case                                  | Spec                               |
| ------------------------------------- | ---------------------------------- |
| `summary === message` renders once    | `agent-report.utils.spec.ts`       |
| `summary !== message` renders both    | `agent-report.utils.spec.ts`       |
| Component-level duplicate suppression | `message-bubble.component.spec.ts` |

## Defect 5: consecutive agent turns run together

**Cause:** Two frontend merge steps concatenated consecutive text segments:

1. `AgentMonitorTreeBuilderService.buildTreeFromSegmentsInternal` merged
   consecutive `text`/`thinking` `CliOutputSegment`s into one `ExecutionNode`.
2. `agent-card.utils.ts#mergeConsecutiveTextSegments` collapsed consecutive
   `text`/`thinking` `RenderSegment`s before rendering.

The backend already coalesces per-token output, so the incoming segments are
one per agent turn. Removing both frontend merges lets each turn become its own
rendered block. Existing CSS spacing then provides the visual separation:

- `AgentCardOutputComponent`: `space-y-1.5` between segments.
- `ExecutionNodeComponent`: `my-2` vertical margin on text nodes.

**Acceptance verification:**

| Case                                                                     | Spec                                         |
| ------------------------------------------------------------------------ | -------------------------------------------- |
| Consecutive text segments stay separate nodes                            | `agent-monitor-tree-builder.service.spec.ts` |
| Consecutive thinking segments stay separate nodes                        | `agent-monitor-tree-builder.service.spec.ts` |
| Agent card renders consecutive text segments as separate markdown blocks | `agent-card-truncation.spec.ts`              |

## Files changed

- **Created**
  - `libs/frontend/chat/src/lib/utils/agent-report.utils.ts`
  - `libs/frontend/chat/src/lib/utils/agent-report.utils.spec.ts`
- **Modified**
  - `libs/frontend/chat/src/lib/components/organisms/message-bubble.component.ts`
  - `libs/frontend/chat/src/lib/components/organisms/message-bubble.component.spec.ts`
  - `libs/frontend/chat/src/lib/services/agent-monitor-tree-builder.service.ts`
  - `libs/frontend/chat/src/lib/services/agent-monitor-tree-builder.service.spec.ts`
  - `libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card.component.ts`
  - `libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card.utils.ts`
  - `libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card-truncation.spec.ts`

## Verification run

```bash
npx nx run-many -t test -p @ptah-extension/chat @ptah-extension/chat-ui --skip-nx-cache
npx nx run-many -t lint -p @ptah-extension/chat @ptah-extension/chat-ui --skip-nx-cache
```

- `test`: 83 suites / 1318 passing (`@ptah-extension/chat`), 26 suites / 186
  passing (`@ptah-extension/chat-ui`).
- `lint`: 0 errors, only pre-existing warnings in unrelated files.
