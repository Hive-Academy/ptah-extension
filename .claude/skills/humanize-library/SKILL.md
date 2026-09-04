---
name: humanize-library
description: 'Refactor an existing library, package, module or app folder so it reads like it was written by a human for humans — SOLID, small focused files, no duplication, clear names, behavior preserved. Works in any repo, any language, any architecture: the skill discovers the project own rules and verification gate instead of assuming them. Use when the user asks to "humanize", "clean up", "refactor for readability or maintainability", "make this follow SOLID", "split large files", "remove duplication", "improve code quality", or points at a specific path and wants it brought up to the team craftsmanship bar. NOT for adding features or fixing functional bugs — this is behavior-preserving structural refactoring only.'
---

# Humanize Library

Transform a target folder so a new developer can read it top-to-bottom and understand it:
single-responsibility files, clear names, no copy-paste — **without changing observable behavior**.

This skill is repo-agnostic. It carries no assumptions about your framework, folder layout, DI
style, test runner or naming convention. Steps 1 and 2 exist to *learn* those from the repo in
front of you. Never substitute conventions from another codebase you have seen.

## Operating principles (read first)

1. **Behavior-preserving only.** No new features, no bug "fixes", no API shape changes unless the
   user explicitly asks. Found a real bug? Write it down for the user. Do not silently fix it.
2. **Learn the repo before you cut.** Steps 1–2 are not ceremony. A refactor that violates a rule
   you never discovered is worse than no refactor.
3. **Never refactor without a working gate.** If typecheck/lint/test do not actually run over the
   target, repairing that is batch 0 — before a single line of source moves. See
   [references/discover-the-repo.md](references/discover-the-repo.md) §Verification gate.
4. **Plan before you cut.** Produce the audit + plan and get user sign-off before editing. Large
   refactors have large blast radius.
5. **Small reversible batches.** One concern per batch. Verify after each. Never one giant rewrite.
6. **Commit each green batch.** Stage explicit paths only — never `git add -A`, never touch
   uncommitted work you did not create. Assume other sessions share this working tree.

---

## Step 1 — Scope the target

Confirm the exact path with the user. Then establish what kind of unit it is:

- Is there a manifest? (`package.json`, `project.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`,
  `build.gradle`, `*.csproj`). Read it — it names the unit, its scripts/targets, and its deps.
- Is there a public entry point? (`index.ts`, `__init__.py`, `lib.rs`, `mod.rs`, a barrel export).
  **The entry point is the refactor's contract.** Everything behind it is yours to move; everything
  it exports must keep its name and shape unless dependents are updated in the same batch.
- Are there local instruction files? (`CLAUDE.md`, `AGENTS.md`, `README.md`, `CONTRIBUTING.md`,
  `.cursorrules`) — in the folder *and* in every parent directory up to the repo root.

## Step 2 — Discover the repo's contract and gate

Read [references/discover-the-repo.md](references/discover-the-repo.md) and follow it. It produces
two artifacts you will use in every later step:

- **A contract card** — the rules this repo actually enforces, each with the evidence that proves
  it is real (a lint rule, a CI step, a test, a written doc). Rules with no enforcement are
  preferences; label them as such.
- **A verified gate** — the exact commands that typecheck, lint and test *this specific target*,
  each one run once and observed to pass or fail. A command that silently skips the target is not
  a gate.

> Do not skip this because the repo "looks like" one you know. The most common failure mode of
> this skill is importing another project's conventions. The second most common is trusting a gate
> command that never touched the code.

## Step 3 — Audit

Run the analyzer for an objective inventory:

```bash
node <skill-dir>/scripts/analyze_library.mjs <path> --json
```

It reports per file: code lines, export count, max nesting depth, longest function, whether an
adjacent test file exists, and a **shape** classification (`logic` / `registry` / `types` /
`generated`).

Then read the flagged files and score them against
[references/quality-rubric.md](references/quality-rubric.md).

**Calibrate before you score.** Line count alone is a bad signal and will mislead you:

| Shape | What it looks like | How to weight it |
| --- | --- | --- |
| `logic` | branching, state, nesting depth ≥ 4, methods calling each other | Full weight. This is what "god file" means. |
| `registry` | a flat list — routes, tool schemas, command definitions, a long `switch` where arms don't interact | **Down**-weight. 2000 navigable lines of one-symbol-per-concept is not a defect. |
| `types` | interfaces, enums, DTOs, a barrel | **Down**-weight. Split only if the entry point forces consumers to import implementation to get a type. |
| `generated` | codegen output, lockfile-adjacent, `@generated` header | **Exclude entirely.** Never refactor generated code — fix the generator. |

The axes that actually separate a broken unit from a big one, in order:

1. **Concern count** — how many unrelated reasons to change live in one file.
2. **Test safety net** — is the code you want to move pinned by a test? Beware aggregate coverage
   ratios: in most repos the largest file is the *least* tested one. Check per-file, not per-project.
3. **Duplication that has already diverged** — two copies that now behave differently is a shipped
   defect. Two identical copies is only debt.
4. **Contract violations** — measured against the card from step 2, not your taste.

## Step 4 — Produce the plan

Write ordered batches. For each: the smell, the target shape, the files touched, the risk, and the
exact gate command for that batch. Use [references/refactor-recipes.md](references/refactor-recipes.md)
to pick the move.

Ordering rules:
- Gate repair first, if step 2 found a hole.
- Then extractions that *shrink the diff* of later batches (lift types out, lift primitives out)
  before the batch that splits the class.
- Batches touching the same file are strictly serial. Say so.
- Any step that changes observable behavior gets its **own** batch, sequenced last, gated on
  explicit user sign-off — not on a green suite.
- Untested code gets a characterization test as its own committed batch *before* it is touched.

Present the plan and **wait for approval**.

## Step 5 — Execute, batch by batch

1. Make the change. Prefer mechanical, reviewable edits.
2. Keep the public entry point exporting the same symbols — or update every dependent in the same
   batch. Find dependents before moving an exported symbol (`ptah_get_dependents`,
   `ptah_lsp_references`, or a plain grep for the symbol across the repo).
3. Run this batch's gate. Green → commit with a clear message. Red → fix or revert the batch.
4. Never declare a batch done on red. Report failures with the actual output.

## Step 6 — Summarize

Give the user: what changed, before/after numbers on the worst offenders, duplication removed, bugs
spotted-but-not-fixed, behavior changes that needed sign-off, and the final gate status.

---

## What "human-written" means here

- A file does one job and is named for that job. Size follows from that — a cohesive 900-line
  registry is fine; a 400-line class with four reasons to change is not.
- One level of abstraction per function. No mixing orchestration with string munging.
- Names state intent, not mechanism. No `data2`, `handleStuff`, `tmp`.
- Shared behavior lives in one place, in a location the dependency rules actually allow.
- Comments explain *why*. Dead code is deleted, not commented out.
- Dependency arrows point the way this repo's contract says they should.
