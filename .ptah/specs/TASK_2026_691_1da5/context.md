# Context - TASK_2026_691_1da5

## User request (2026-10-17)

> also we need to make sure for each session to show proper provider icon

> i think we did a mistake the previous canvas view was much better than the current one ! would it be
> hard to revert our changes and keep only the good parts if any !

The user prefers the canvas scene (radial layout, motion). TASK_2026_689_4d4f (SVG/DOM scene,
PR #749) was closed unmerged. The user chose "Revert + small PR": keep the canvas on `main` and
take only the transferable parts into this task.

## Scope

1. Provider marks for every session node: every place that shows a session's provider (overlay
   plate, work list, canvas label plates) uses `ptah-provider-mark` (`@ptah-extension/ui`) for a
   known provider and `ptah-monogram-tile` only for an unknown one. The root session gets its
   provider today only from `liveModelStats.contextCapacity.providerId`
   (`components/command-center-projection.source.ts:208`); add a fallback from the tab's own
   provider data so a restored session without live statistics still shows its provider.
2. Lucide state icons + visible state word in the DOM plate and the work list (completed
   `CircleCheck`, failed `CircleX`, cancelled `Ban`, awaiting input `MessageCircleQuestion`,
   running/starting `LoaderCircle`, queued/idle/unknown `CircleDashed`; icon `aria-hidden`).
   The canvas spheres keep their drawn marks and their radial layout and motion.
3. Overlay fixes from `TASK_2026_689_4d4f/code-logic-review.md` that also apply to the old
   overlay on `main` (check each one on `main` first): a pin outlives its node; Escape does not
   close the hover preview; `aria-expanded` without `aria-controls`; the hover preview grows the
   page (N2). Fix only the ones that exist on `main`; list the others as "not applicable".

Out of scope: the canvas layout, sprites and animation (the user likes them), the session picker
and the voice reply rule (separate follow-up task, recorded in TASK_2026_689 context.md).

## Decision (user, 2026-10-18)

Review item S1 (history-restored sessions carry no `providerId`, so the root fallback shows a
monogram) ships as a known limit in this PR. After this PR merges, fix S1 in a new PR: persist
the root session provider on the backend so restored sessions show their provider mark.

Reference branch (not merged): `feat/command-center-scene-redesign`, worktree
`.claude-worktrees/command-center-scene-redesign`.
