# Batches - TASK_2026_648_374e

Source of truth for each batch: `implementation-plan.md` section "File-disjoint implementation
batches" (file lists, tests, check commands). Run order 1 -> 2 -> 3, then one code-logic review.

| Batch | Scope | State |
| ----- | ----- | ----- |
| 1 | Workflow metadata: `TabState.workflow`, `WorkflowSessionIndexService`, tab-manager facade, persistence | COMPLETE (573 chat-state tests) |
| 2 | `SessionEmbedComponent` in chat; canvas detail transcript uses it; owner-aware visibility | COMPLETE (chat 3940, canvas 371, chat-state 574) |
| 3 | `WorkflowTabLauncherService`; badges in tab bar, sidebar rows, rail card/header (D5: focus-header badge as its own element; chat-view edit additive only) | COMPLETE (chat 3948, canvas 374) |

## Notes

- Batch 1 lane (2026-10-15): session deletion is observed in feature code, not chat-state:
  `chat/src/lib/components/templates/app-shell.component.ts:955-968` (sidebar delete) and
  `chat/src/lib/components/templates/chat-view.component.ts:1914-1922` (delete-original path).
  Batch 1 exposes and tests `forgetWorkflowSession`. **Batch 3 owns both call sites**: call
  `forgetWorkflowSession` after a successful delete in each (`chat-view.component.ts` is added to
  Batch 3's file list).
