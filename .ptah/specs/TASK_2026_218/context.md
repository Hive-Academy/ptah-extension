# Context — `git:applyHunks` never exercised end-to-end in Electron

# STATUS: HIGH — REQUIRED BEFORE D2 IS DONE

## Origin

`TASK_2026_173` (Editor panel — git-diff correctness, measured performance, hunk-level stage/revert),
Batch 9 register, **item 12 of 17**. This is the one item on the register that is **not discretionary**.
It is a **named Batch 8 exit criterion** (`batch-8-dispatch.md` §7) that **no pass met**. `TASK_2026_173`
DoD item 1 explicitly states: **"Do not sign off DoD item 1 for D2 until item 12 is discharged."**

## Finding (from the register, verbatim)

> **`git:applyHunks` has NEVER been exercised end-to-end in Electron — a NAMED BATCH 8 EXIT CRITERION
> THAT NO PASS MET, and D2 IS NOT DONE UNTIL IT IS RUN.** Not discretionary polish; do not file it as
> though it were. 8A could not run it (no frontend caller existed yet), 8B could not (jsdom only), and
> 8C attempted it and stopped, judging Electron GUI-driver setup from scratch unaffordable within its
> budget. Commit `3d6145863` was taken anyway, deliberately, with the gap stated in its body: every
> data-safety guard is proven against real git, `ptah-electron` was red from concurrent out-of-scope
> work, and leaving the batch uncommitted in a tree other sessions were writing to was the riskier
> state. **What is unproven is that a click wires through to the RPC correctly in a running app** — not
> that the write path corrupts anything.

## The honest framing (verbatim from 8C, must travel with this record)

> _every corruption-risk guard is proven; the UI's live wiring is not._

## Why it was committed anyway (so this record does not read as negligence)

- **AC2–AC7, AC9, AC10, AC12 and both halves of AC6** are proven against **real git
  2.54.0.windows.1** in throwaway repositories. Not mocked git.
- The unmet criterion is **UI wiring in a live host, not data safety** — a real, different class of
  risk.
- It **could not be run** at the time: `ptah-electron` was red from deliberate concurrent work in
  `cli-agent-runtime`, `agent-sdk`, `vscode-lm-tools` and `tribunal-panel` on the same branch.
- The work sat **uncommitted in a tree other sessions were actively writing to**, and Batch 8B had
  already misread a `lint-staged` hide-window as catastrophic loss. **Committing was the safer state.**

**A branch commit is not a release.** The commit body of `3d6145863` states this plainly, and this
record must too.

## Why three passes could not close this

- **8A**: could not run it — no frontend caller existed yet at that point in the batch.
- **8B**: could not run it — its verification ran under jsdom only, which cannot exercise a real
  Electron window.
- **8C**: attempted it and stopped, judging that building Electron GUI-driver setup from scratch was
  unaffordable within its remaining budget.

## Fix

Add a Playwright `_electron` smoke test under `apps/ptah-electron-e2e/src/specs/editor/` that:

1. Opens a `worktree` diff on a scratch git repository.
2. Stages one hunk via the keyboard toolbar (not the mouse — the keyboard toolbar is what Batch 8B
   actually shipped and verified in jsdom).
3. Asserts `git diff --cached` contains that hunk and only that hunk.

**This is shared infrastructure — register items 15 (`TASK_2026_221`, floating hunk-action widget) and
16 (`TASK_2026_222`, glyph-margin visual verification) should be verified in the same harness.**
Whoever picks up this item is building infrastructure two other filed items depend on; all three
records cross-reference each other for exactly this reason.

## Source

`TASK_2026_173/tasks.md` Task 9.3 register item 12 (table), and the Batch 9 intro block calling it out
by name; `TASK_2026_173/batch-9-dispatch.md` §4.1 ("Item 12 is not like the others — do not flatten
it"); `TASK_2026_173/batch-8-dispatch.md` §7 (the original exit criterion); `TASK_2026_173/tasks.md`
Final Definition of Done, item 1 and the "DoD ITEM 1 IS NOT YET SATISFIABLE" block; commit `3d6145863`.
