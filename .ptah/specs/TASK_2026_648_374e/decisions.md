# Decisions - TASK_2026_648_374e

| #  | Decision | Options | Evidence | Reversible | By |
| -- | -------- | ------- | -------- | ---------- | -- |
| D1 | Work in the same worktree on a new branch from #732's tip and open a stacked PR against #732, instead of waiting for #732 to merge (replaces 652 D18's "from main") | merge #732 first; stack | User: "can't we continue on the same worktree and make a new PR pointing to our 732 PR"; the CLAUDE.md worktree-from-main rule is overridden by the user's explicit request | yes | user |
| D2 | Approve `implementation-plan.md` (3 batches: workflow tag, session embed, launcher and badges) | approve; change | User approval 2026-10-15 | yes | user |
| D3 | Embed extracts the post-629 canvas detail transcript injector (`canvas-detail-transcript.component.ts`), not the pre-629 tile | old tile; duplicate chat view; current injector | `canvas-tile.component.ts` no longer exists after #730 | yes | architect |
| D4 | Launcher pre-fills and does not auto-send; New Project auto-start is decided in 649 (keep-and-fix says keep it) | auto-send in 648; defer | Plan section "launch"; today's New Project starts with the seed | yes | orchestrator |
