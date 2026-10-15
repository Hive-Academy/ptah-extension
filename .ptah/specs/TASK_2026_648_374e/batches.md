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

## Code-logic review (grok, implementer codex) - APPROVED WITH FINDINGS, 7/10

`code-logic-review.md`: 0 Blocking, 0 Serious, 3 Moderate, 1 Minor. Fix round (one, codex):

- **M2 fixed in the fix round**: `conductor-tile.component.ts` registered and unregistered two
  different reads of `correlationId`; with the reference count this left an orphan visible tab
  and could drop another host's only count. Now an effect pairs register/unregister on one id.

Deferred as named follow-ups (no data loss, no lane config impact):

- **FU-648-1 (M1)**: `WorkflowSessionIndexService.warning` has no UI reader, so a storage write
  failure loses the history badge after reload with no notice. Bind it in the sidebar or toast.
- **FU-648-2 (M3, owner 649)**: in grid layout at the tile cap, `WorkflowTabLauncherService.open`
  returns `landed` while `adoptTab` refuses the tab and the prefill has no consumer. 649 (first
  caller) must surface the refusal or retarget the prefill.
- **FU-648-3 (Minor)**: the collapsed rail card shows no workflow name.
