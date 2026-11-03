---
name: humanize-library
description: 'Behavior-preserving refactor that makes an existing library, module or folder readable — small focused files, no duplication, clear names, SOLID. Use when asked to humanize, clean up, split large files or remove duplication at a path. Not for new features or bug fixes.'
---

# Humanize Library

Behavior-preserving refactor of one existing folder. Framework, layout, DI, test runner and names come from the repo in front of you. Never substitute conventions from another codebase.

## Rules that break silently

1. **Behavior-preserving only.** No new features, no bug fixes, no API shape changes unless the user explicitly asks. Found a real bug? Write it down for the user. Do not silently fix it.
2. **Learn this repo before you cut.** Steps 1–2 are the learning. A refactor that violates a rule you never discovered is worse than no refactor.
3. **Never refactor without a working gate.** If typecheck, lint and test do not actually run over the target, repairing that is batch 0 — before a single line of source moves. Home: [references/discover-the-repo.md](references/discover-the-repo.md) Part B.
4. **Plan before you cut.** Produce the audit and the plan, and get user sign-off before editing.
5. **Small reversible batches.** One concern per batch. Verify after each. Never one giant rewrite.
6. **Commit each green batch.** Stage explicit paths only — never `git add -A`, never touch uncommitted work you did not create. Full rule: [references/discover-the-repo.md](references/discover-the-repo.md) §Git safety.

## Step 1 — Scope the target

Confirm the exact path with the user. Then establish what kind of unit it is:

- Read the unit manifest. It names the unit, its scripts or targets, and its dependencies.
- Find the public entry point. **The entry point is the refactor's contract.** Everything behind it is yours to move; everything it exports must keep its name and shape unless dependents are updated in the same batch.
- Read local instruction files in the folder and in every parent directory up to the repo root. Which files count: [references/discover-the-repo.md](references/discover-the-repo.md) Part A2.

## Step 2 — Discover the repo's contract and gate

Read [references/discover-the-repo.md](references/discover-the-repo.md) and follow it. It produces two artifacts used in every later step:

- **A contract card** — the rules this repo actually enforces, each with the evidence that proves it is real (a lint rule, a CI step, a test, a written doc). Rules with no enforcement are preferences; label them as such.
- **A verified gate** — the exact commands that typecheck, lint and test *this specific target*, each one run once and observed to pass or fail. A command that silently skips the target is not a gate.

## Step 3 — Audit

Run the analyzer:

```bash
node <skill-dir>/scripts/analyze_library.mjs <path> --json
```

It reports per file: code lines, export count, max nesting depth, longest function, whether an adjacent test file exists, and a **shape** (`logic` / `registry` / `types` / `generated`).

Score the flagged files with [references/quality-rubric.md](references/quality-rubric.md). Calibrate shape before any line-count judgement — §0 of that file is the only home for the weights.

## Step 4 — Produce the plan

Write ordered batches. For each: the smell, the target shape, the files touched, the risk, and the exact gate command for that batch. Pick the move from [references/refactor-recipes.md](references/refactor-recipes.md).

Order across the plan follows [references/quality-rubric.md](references/quality-rubric.md) §Severity ordering (gate repair, characterization tests, and behavior changes each have their place there). One constraint that section does not state: batches that touch the same file are strictly serial. Say so.

Present the plan and **wait for approval**.

## Step 5 — Execute, batch by batch

1. Make the change. Prefer mechanical, reviewable edits.
2. Keep the public entry point exporting the same symbols — or update every dependent in the same batch. Find every dependent before moving or renaming an exported symbol. How: [references/refactor-recipes.md](references/refactor-recipes.md) Recipe 9.
3. Run this batch's gate. Green → commit with a clear message. Red → fix or revert the batch.
4. Never declare a batch done on red. Report failures with the actual output.

Before commit, walk the safety checklist at the end of [references/refactor-recipes.md](references/refactor-recipes.md).

## Step 6 — Summarize

Give the user: what changed, before/after numbers on the worst offenders, duplication removed, bugs spotted-but-not-fixed, behavior changes that needed sign-off, and the final gate status.
