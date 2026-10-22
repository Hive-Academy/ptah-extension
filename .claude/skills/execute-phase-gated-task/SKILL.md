---
name: execute-phase-gated-task
description: Execute a complex, multi-phase project from a detailed specification with checkpoint validation, strategic commit boundaries, and status tracking. Use when a task requires sequential batches with acceptance criteria (build/lint/visual gates), specifications cite exact file paths, and work spans multiple phases that must not be mixed in commits.
---

## Steps

1. **Read the implementation plan and the batch you are executing.** Locate and read: implementation plan (phase breakdown, file manifest, constraints) and the current batch's entry. Open context/decisions, task description and reference docs (design specs, content, examples) only when the batch cites them. Note the phase/batch order and any dependency graph.

2. **Verify current state matches specification baseline.** Check git branch name, HEAD commit, and `git status --short`. Confirm you're on the intended branch and worktree is clean or only contains the expected in-flight changes. If unrelated files are staged/modified, note them for exclusion from later commits.

3. **Understand the batch structure.** From the plan, identify: (a) phase/batch ID and scope, (b) exact file paths and changes (new files to create, existing files to edit, line-specific changes), (c) acceptance criteria (build gate, lint, grep verification, visual inspection, test results), (d) status (PENDING/IMPLEMENTED/COMPLETE), (e) recommended executor if delegating.

4. **Survey the source files mentioned in the batch** before writing. Use absolute paths. Start with `ptah_ast_analyze` / `ptah_context_enrich_file` for structure and signatures; read a file in full only when you will edit it. For files you'll edit, scan for style (naming, error handling, comment density, async patterns) to match surrounding code. For reference files (specs, existing sections), extract the actual patterns and selectors from a targeted read, not the whole file.

5. **Implement the batch in the specified order.** Create new files and edit existing files exactly as the plan prescribes. Make additive changes only — extend signatures with optional params, add new fields to types, create new methods. Do not refactor unrelated code.

6. **Validate after the batch.** Run all verification commands the plan specifies (e.g., `npx nx build <app>`, `npx nx lint <app>`, grep checks for guard patterns, visual inspection of rendered output or video frames), scoped with `-p` to the projects the batch changed — never workspace-wide — with the output tailed or filtered to the summary and failures. Document the results from that one run; do not re-run a suite just to re-read its output. If validation fails, diagnose and fix before proceeding.

7. **Identify unrelated changes.** Run `git status --short` and `git diff --stat` to list modified files. Filter to ONLY the batch-intended files (use explicit paths, never `-A` or `.`). If unrelated files appear, note them for stashing or separate commits.

8. **Commit by logical grouping.** Stage ONLY the batch files: `git add <file1> <file2> ...`. Use `git status` after staging to verify nothing unexpected is included. Write a conventional commit message (e.g., `feat(module): description`) referencing what was implemented (not which files). Do NOT use `--no-verify` to bypass hooks; diagnose and fix instead.

9. **Update status tracking.** In the task-tracking file (e.g., `tasks.md`), mark the batch status PENDING → IMPLEMENTED → COMPLETE. Assign the next batch per the dependency graph and note its executor and scope.

## Gotchas

- **Specification is authoritative**: Every field name, type signature, file path, and constraint in the plan is exact. Do not simplify, refactor, or re-architect. Adapt to real code drift only, and document the adaptation.
- **Unrelated working-tree pollution**: A dirty worktree with files from other tasks is a trap for accidental inclusion. Always inspect `git status` before staging and use explicit file paths, never `-A`.
- **Batch boundaries respect dependency graph**: Do not reorder or combine batches unless the plan allows. A logically "later" task may be gated on an earlier batch; respect that ordering.
- **Validation gates are hard**: Build/lint/test failures block progression. Do not skip; diagnose and fix the root cause, then re-run — the same scoped `-p` command with tailed output, once per fix, not to re-read output you already have.
- **Visual verification is mandatory for rendering/UI changes**: Linting and typecheck prove syntax, not correctness. Extract frames, screenshots, or build artifacts to verify the fix is visually present.
- **Commit per batch, not per file**: Group all related files in one batch into one commit. Do not split a batch into multiple commits unless the plan explicitly says so.
