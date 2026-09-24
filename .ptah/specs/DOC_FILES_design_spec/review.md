# Cross-side review — commit `3af9d8ced`

## Verdict: PASS

## What the commit does

`libs/shared/src/lib/types/task-spec.contract.ts`:
- Adds `'design-spec.md'` to `DOC_FILES` (line 85), between `'visual-design-specification.md'`
  and `'design-handoff.md'`.
- Adds a matching doc-comment bullet (lines 64-66) in the same style as the three
  sibling bullets already there, citing `ui-ux-designer.template.md:104` and Gate 1.7.

Plus `.ptah/specs/DOC_FILES_design_spec/lane-report.md`, the author's own report (data, not
reviewed as source).

## Is widening the right fix, versus renaming assets to `visual-design-specification.md`?

Widening is correct. Evidence:

1. **`design-spec.md` is the actual, current, reconciled deliverable name across the whole
   pipeline**, not a stray typo in two files as the failure symptom might suggest in
   isolation. `git show 3af9d8ced` only touches the contract because the *assets* were
   already fixed earlier, on main, by PR #582's review cycle:
   - `.ptah/specs/TASK_2026_533/code-style-review.md` (Blocking #1) found the opposite
     mismatch — Lane A (orchestration) had already moved to `design-spec.md` while Lane B
     (`ui-ux-designer`) was still writing `visual-design-specification.md` — and its own
     recommended fix (lines 100-104) was explicitly "rename the designer's actual output to
     `design-spec.md`", *because* Gate 1.7's whole template already assumed that name.
   - `.ptah/specs/TASK_2026_533/lane-report-b-rev1.md` records that fix being applied:
     `ui-ux-designer/SKILL.md`, `DEVELOPER-HANDOFF.md`, `ui-ux-designer.template.md`,
     `.claude/agents/ui-ux-designer.md`, `team-leader.template.md` and its `.claude` mirror
     were all rewritten from `visual-design-specification.md` to `design-spec.md`.
   - Verified directly in this worktree: `ui-ux-designer.template.md:168,236`,
     `DEVELOPER-HANDOFF.md:434,487`, `frontend-developer.template.md:62`,
     `software-architect.template.md:94`, `technical-content-writer.template.md:51`, and every
     `orchestration/references/*.md` file (`strategies.md`, `checkpoints.md`,
     `agent-catalog.md`, `task-tracking.md`, `SKILL.md`) all consistently use `design-spec.md`
     today. A repo-wide grep for `visual-design-specification` (excluding archived
     `.ptah/specs/TASK_*` history and the contract module itself) turns up exactly one live
     reference: `technical-content-writer/SKILL.md:244` —
     `Glob(.ptah/specs/TASK_*/{design-spec,visual-design-specification}.md)` — a deliberate
     dual-glob fallback for old task folders, not a producer of the old name.
   - Renaming the 15 `design-spec.md` assets back to `visual-design-specification.md` would
     reverse a deliberate, reviewed rename that already shipped to main, and would reopen the
     exact "Gate 1.7 points at a file the designer never writes" defect TASK_2026_533 was
     written to close.
2. `visual-design-specification.md` staying in `DOC_FILES` is justified the same way the
   precedent comment justifies the other four admitted names (lines 54-72): it is not dead —
   `technical-content-writer/SKILL.md:244`'s glob still matches it for pre-rename task
   folders on disk, and `.ptah/specs/` is gitignored so there is no migration that can be
   trusted to have touched every existing user workspace (the module's own stated invariant
   at `LEGACY_DOC_FILES`, line 103-104, for exactly this class of problem).

Widening is the correct fix; renaming assets would fight settled, reviewed history.

## Consumers of `DOC_FILES` / `isDocFile` / rendered README / agent block — any behavior change?

- `renderSpecsReadme()` (`task-spec.contract.ts:422-487`) and
  `renderTaskSpecAgentBlock()` iterate `DOC_FILES` generically (`docList` map/join, no
  per-name special casing) — the new entry needs no additional wiring and renders as a plain
  bullet, consistent with every other entry. Confirmed by reading both functions in full.
- `isDocFile()` (line 204-206) is a bare `DOC_FILES.includes(name)` — this is the only
  behavior change: a task folder containing `design-spec.md` is now recognised as a doc file
  instead of an unrecognised extra. That is the intended effect of the fix.
- `isPlanningArtifact` / `isCompletionArtifact` (`task-spec.contract.ts:173-201`) are
  regex-pattern based (`-review.md$`, `-report.md$`, `^implementation-plan.*\.md$`,
  `^batches\.md$`, `^tasks\.md$`), independent of `DOC_FILES` membership by explicit design
  (module comment lines 159-171, written to prevent exactly the "doctor infers backlog for
  finished work" bug). `design-spec.md` matches none of these patterns before or after this
  change, so `task-doctor.service.ts` status inference is provably unaffected.
- No snapshot test pins the rendered `DOC_FILES` list length or exact bullet text —
  `task-spec.contract.spec.ts` derives its README/agent-block assertions from `DOC_FILES`
  itself (confirmed by reading the file's imports and describe blocks), and
  `task-index.service.spec.ts` compares on-disk README against `renderSpecsReadme()`
  dynamically per the lane report. `DOC_FILES[0]` / `DOC_FILES[DOC_FILES.length - 1]`
  consumers (`task-start.service.spec.ts:197`, `task-prompt-context.service.spec.ts:65`) are
  unaffected since the new entry sits mid-array, not at either end.
- `.ptah/specs/README.md` is gitignored (`.gitignore:145`) and rewritten at activation from a
  hash comparison — there is no committed copy in this repo to go stale.
- `contract.guard.spec.ts`'s `assetFiles()` only walks `AGENT_TEMPLATE_DIR` and
  `ORCHESTRATION_SKILL_DIR`, not the `ui-ux-designer` skill folder itself — consistent with
  the task's identified offenders (`ui-ux-designer.template.md`, `strategies.md`) both living
  inside the scanned trees.

## Generated files

`node scripts/generate-content-manifest.js --check` (run fresh from this worktree):

```
content-manifest.json is up to date (sha256:33850c65df177fc06ec4f2fe629047ae3f405f143b75de80858a3e0c1a85e504, 225 files).
```

Matches the lane report's claim. The commit touches no file under
`apps/ptah-extension-vscode/assets/plugins` or `libs/backend/agent-generation/templates`, so
no manifest regeneration was expected, and none was needed.

## Verification run

`npx nx run-many -t test lint typecheck -p @ptah-extension/shared @ptah-extension/task-specs
@ptah-extension/rpc-handlers @ptah-extension/tasks-ui`:

```
√  nx run @ptah-extension/task-specs:lint  [existing outputs match the cache, left as is]
√  nx run @ptah-extension/rpc-handlers:test  [existing outputs match the cache, left as is]
√  nx run @ptah-extension/rpc-handlers:lint  [existing outputs match the cache, left as is]
√  nx run @ptah-extension/tasks-ui:test  [existing outputs match the cache, left as is]
√  nx run @ptah-extension/tasks-ui:lint  [existing outputs match the cache, left as is]
√  nx run @ptah-extension/shared:typecheck
√  nx run @ptah-extension/task-specs:typecheck
√  nx run @ptah-extension/tasks-ui:typecheck
√  nx run @ptah-extension/rpc-handlers:typecheck
 NX   Successfully ran targets test, lint, typecheck for 4 projects
```

`npx nx run-many -t typecheck -p ptah-extension-webview ptah-extension-vscode ptah-electron
ptah-cli @ptah-extension/vscode-lm-tools`:

```
NX   Successfully ran target typecheck for 5 projects
```

Because 8/12 tasks above hit Nx cache, I additionally forced the specific previously-failing
guard test with `--skip-nx-cache` to remove any doubt:

`npx nx test task-specs --skip-nx-cache -t "asset document names"`:

```
Test Suites: 18 passed, 18 total
Tests:       518 passed, 518 total
```

`contract guard — asset document names › names only documents inside DOC_FILES (plus the
carrier)` — the test named in the task brief as failing on main — passes clean, uncached, in
this worktree.

## Findings

None blocking or serious. The change is a minimal, correctly-scoped widening of a
deliberately closed enum, backed by:
- A precedent comment updated in the same style as its three siblings.
- A prior, reviewed decision (TASK_2026_533) that already settled `design-spec.md` as the
  canonical name across every producer and consumer this repository ships, making the
  alternative (rename assets) a regression of already-merged work rather than a live option.
- No snapshot, doctor-inference, or generated-manifest breakage, verified by reading the
  relevant source rather than trusting the lane report's claim alone.

The only soft spot: the lane report doesn't itself surface the TASK_2026_533 history that
makes "widen, don't rename" the obviously correct call — it argues from first principles
(grep + precedent-comment style) rather than citing the settled decision. That is a
completeness gap in the report's reasoning, not a defect in the shipped diff, so it does not
change the verdict.

## Output

`WROTE: D:\projects\ptah-extension\.claude-worktrees\doc-files-design-spec\.ptah\specs\DOC_FILES_design_spec\review.md — PASS`
