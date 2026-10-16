# Implementation plan review (Gate 2, round 1)

Verdict: APPROVED
Score: 9/10
Reviewer: codex

## Round-0 findings

| # | Status | Evidence |
| --- | --- | --- |
| 1. Shared barrel ownership (Serious) | FIXED | `implementation-plan.md:118-119,139-147` names the exception and append-only rule. The same C-1 → A1-1 → A2-2, C-2 → B-3, and C-2 → B-3 → B-4 owners appear in the file lists (`:167-178`); dependencies enforce those orders (`:222-230`). CV-1 → CV-2 → CV-3 remains serial (`:231-233`). No pair sharing a barrel or chat-view can run in parallel. |
| 2. Turn-item stagger (Serious) | FIXED | `implementation-plan.md:126,179,230,232` assigns A1-3 five `.st-t` hooks before CV-2's index pass. `plan-part-a2-header.md:69-92,98-99` specifies DOM-order indexing, a capped 45–360 ms delay, late-mounted fallback, and reduced-motion override. The current transcript mounts a message bubble inside each slot (`chat-transcript.component.html:35-49`); A1's planned template defines separate user article, disclosure, answer, chips and action row (`plan-part-a1-turn.md:110-141`). |
| 3. Empty TASK requirement (Moderate) | FIXED | `task-description.md:640-641,853` now says to render no TASK section when unlinked, matching user decision `decisions.md:49` and plan deviation `implementation-plan.md:368`. |

## New findings

None at Blocking or Serious severity. The item cap is an acceptable reading of the specification: `design-spec.md:750-756` calls each of the five DOM-order elements one item, assigns `--i` 1..8, and caps `min(i,8)`. Its phrase “turns beyond the eighth” and `task-description.md:503-504` use “turn block” less precisely; the table supplies the explicit indexing rule. This does not require a plan revision.

The R1 removal is recorded as USER approved in `decisions.md:50`, the plan's §4 row A1 4 (`implementation-plan.md:195`), §8 R1 (`:370`), and §9 risk 6 (`:416-417`); `parity-inventory.md:75` has B-25.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Accept the stagger cap per DOM item, with items 8 onward sharing 360 ms | Cap per turn, or cap per item | `design-spec.md:750-756` explicitly says each element is one item and uses `min(i,8)`; `plan-part-a2-header.md:74-92` implements that rule. | Yes; change the index pass if the product specifies per-turn grouping later. |
| Approve the revised plan | APPROVED or REVISE | All three round-0 findings are fixed above; no new Blocking or Serious finding arose from the fixes. | Yes; implementation remains reviewable batch by batch. |
