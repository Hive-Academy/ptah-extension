# Batch 11b executor report — `TASK_2026_559_8ca9` (Lane A)

Fixes for the three open findings of `reviews/batch-11-code-logic-review-r1.md` (M1, M2, Minor). No git operations.

## Files

- MODIFIED `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts` — exports `SEARCH_FILES_DEFAULT_LIMIT` (50) and `SEARCH_FILES_MAX_LIMIT` (`Number.MAX_SAFE_INTEGER`); `ptah_search_files.limit` is now `type: 'integer', minimum: 1, maximum: SEARCH_FILES_MAX_LIMIT, default: 50`. The limit description now states the rule and that an over-limit result says so. The tool-level description was true and is unchanged (Decision 4).
- MODIFIED `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts` — the validator uses the same two constants (the local duplicate constant was removed) and applies the same rule: `Number.isInteger`, `>= 1`, `<= SEARCH_FILES_MAX_LIMIT`. This accepts exactly the old `isSafeInteger && >= 1` set. The error now names the rule: `Error: "limit" must be an integer from 1 to 9007199254740991 (omit it for the default 50).`
- MODIFIED `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.spec.ts` — adds the M1 agreement regression, updates the pinned error text, and adds the Minor notice-through-budget regression (2 cases).
- MODIFIED `libs/backend/workspace-intelligence/src/project-analysis/project-detector.service.spec.ts` — M2: bulk cases moved to an in-memory provider suite; shared fixture helpers extracted.

## M1 — schema and validator agreement

- New spec `advertises exactly the limits the handler accepts, and its default` checks these candidates: 1, 2, 50, 10,000, MAX_SAFE, MAX_SAFE+1, 1e20, 0, -1, -50, 0.5 and 2.5. For each one, it compares the published schema's verdict (type, minimum, maximum) with the handler's verdict. It also checks that `schema.default === 50` and that an omitted limit asks the provider for `default + 1`.
- **Fails before the fix**, on the old schema (`type: 'number'`, no bounds): 1 failed, 18 passed. The first mismatch was `limit: 9007199254740992`, which the schema accepted and the handler rejected. 0, -1 and 2.5 disagree the same way.
- **Passes after the fix**: 19/19 in the `search_files` filter.
- Compatibility note for the change log: the direct-MCP `limit` domain is the Batch 11 tightening, which rejects 0, negative, fractional and string values. It is unchanged here and is now published in the schema.

## Minor — truncation notice through the budget and reducer

New `it.each` at the end of `protocol-handlers › tool-result budget (TASK_2026_559 2f.1)`. It uses a temp spool root and a provider returning `limit + 1` files.

| Case             | Files  | Final text must contain                               | Trailer                           | Spool                                               |
| ---------------- | ------ | ----------------------------------------------------- | --------------------------------- | --------------------------------------------------- |
| Markdown reducer | 1,000  | `Found: more than 1000 files (showing first 1000; …)` | `[reduced: markdown-outline — …]` | byte-equal to `formatSearchFiles(first 1000, true)` |
| Prefix cut       | 10,000 | same notice for 10000                                 | `[reduced: <r> — partial, cut …]` | byte-equal                                          |

Both cases also assert that the raw text exceeds the budget and that the final text fits the default char and token budget.

**Fails before**, checked by mutation: the formatter was temporarily edited to put the notice after the list (the pre-Batch-11 order). The prefix-cut case failed (1 failed, 1 passed). The Markdown outline keeps the trailing paragraph, so that case pins survival without discriminating the order. The formatter edit was then reverted. `git diff` shows no change to `mcp-response-formatter.ts`.

## M2 — detector inspection-cap test made deterministic

- The real-disk `r1 B1` cap test (206 + 4 projects and 20 plain folders) moved to a new suite, `ProjectDetectorService — bulk monorepo fixtures (in memory)`. The suite builds the real `FileSystemService` over an in-memory `IFileSystemProvider` (`memoryFileSystemProvider`). The service already takes the provider through its constructor, so no production change and no injectable cap were needed.
- The root, `os.tmpdir()/ptah-memory-fixture-never-on-disk`, is asserted not to exist, so a stray disk read fails the test.
- The assertions are unchanged: `totalProjects === 4 + extra`, `projects.length === MAX_INSPECTED_PROJECTS`, `complete === false`, and the exact `N of M projects not inspected (limit 200)` issue.
- The timeout was not raised.
- Shared helpers `writeNxApp`, `writeNxWorkspace` and `composeMonorepo` are now used by both suites. The disk suite's base `beforeEach` produces the same fixture as before.
- Other real-disk bulk fixtures scanned in that spec:
  - `r2 B3: summarises member inspection failures…` (30 projects, 1,474 ms under slowed fs) had the same serial-read risk. It moved to the in-memory suite with the same assertions.
  - The remaining disk tests have at most about 6 projects or 12 nested directories and took ≤ 679 ms each under slowed fs. They stay on disk as real-I/O smoke coverage.

Runtime under slowed fs: a temp Jest config and setup in `%TEMP%/task559-b11b-probe/` added 30 ms to every `fs.promises.readFile` of a `ptah-monorepo-fixture-` path, as in the reviewer's probe.

| Test                  | Old, normal | Old, slowed                                          | New, slowed                |
| --------------------- | ----------- | ---------------------------------------------------- | -------------------------- |
| r1 B1 inspection cap  | 333 ms      | **5,146 ms, FAILED (5,000 ms timeout)**              | 41 ms, passed              |
| r2 B3 failure summary | 120 ms      | 1,474 ms                                             | 2 ms, passed               |
| Whole spec file       | —           | 1 failed / 22 passed (fixture filter), sum 13,423 ms | 57/57 passed, sum 6,548 ms |

## Verification

- `nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools @ptah-extension/workspace-intelligence --skip-nx-cache --parallel=2`: all 6 tasks passed ("Successfully ran targets test, lint, typecheck for 2 projects").
- `nx run-many -t typecheck -p ptah-cli ptah-electron`: "Successfully ran target typecheck for 2 projects".
- `nx run ptah-electron:validate-deps`: "Successfully ran target validate-deps for project ptah-electron and 1 task it depends on".
- `nx run degradation-audit:lint --skip-nx-cache`: `TOTAL 300 unsuppressed site(s)`, passed. No baseline was touched.
- `prettier --check` on the 4 changed files: all formatted.
- `git status --short`: the 4 files above are modified. Not mine and not touched: ` M .ptah/specs/TASK_2026_561_9e57/context.md`, ` M .ptah/specs/TASK_2026_562_4b1d/context.md`, `?? .ptah/specs/TASK_2026_559_8ca9/code-logic-review.md`, `?? .ptah/specs/TASK_2026_559_8ca9/research/diagnostics-worktree-repro.ts`.

## Plan deviations

- No explicit-timeout real-disk cap smoke test was added (batches.md suggested one). A real-disk cap check needs 200+ projects, which is the load-sensitive shape itself. The remaining small disk fixtures already cover real I/O.
- The "supported ceiling" is `Number.MAX_SAFE_INTEGER`, the handler's existing upper bound. No new, lower practical ceiling was introduced, because that would be an unrequested behaviour tightening.

## Out-of-scope observations

- The shipped `IFileSystemProvider.findFiles` still returns only `string[]` (reviewer Q1). A future provider with its own hidden cap could not be told apart from a complete result.
