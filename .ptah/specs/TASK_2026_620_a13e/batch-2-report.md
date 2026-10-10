# Batch 2 report

## Task 2.1 — Agreement metrics

Implemented pure agreement statistics in `agreement-metrics.ts`: opaque-ID set validation, raw pass/fail agreement, Cohen's kappa with a deterministic bootstrap interval, tie-aware Spearman rho, quadratic-weighted per-criterion kappa, rubric-summary construction, and the four-condition trust-bar evaluation.

Evidence:

- Constant vectors and fewer than two observations return `null` with a reason rather than a misleading number.
- Different opaque-ID sets raise `RangeError`; no silent inner join is possible.
- `agreement-metrics.spec.ts` covers tie ranks, constant and singleton cases, mismatch rejection, deterministic weighted-kappa intervals, and each trust-bar condition.

Changed paths:

- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\metrics\agreement-metrics.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\metrics\agreement-metrics.spec.ts`

## Task 2.2 — Deterministic fact matcher

Implemented a pure fact matcher with NFKC normalisation, en-US case folding, whitespace collapse, alternate-token groups, forbidden-token precedence, and safe handling of missing row fields. It searches the combined subject, content, and chunk text.

Evidence:

- `fact-matcher.spec.ts` proves alternatives across all three sources match, a forbidden token blocks an otherwise valid row, and Unicode/whitespace/casing normalisation works.

Changed paths:

- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\matching\fact-matcher.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\matching\fact-matcher.spec.ts`

## Risks handled

- All reported rates calculate `value` directly as `num / den`; empty denominators return `null`.
- Agreement metrics make undefined constant or undersized samples explicit.
- Matcher normalisation and absent values cannot throw or introduce nondeterminism.
- Bootstrap intervals use Batch 1's seeded `bootstrapInterval`.

## Verification

- `npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills/metrics/agreement-metrics.spec.ts tools/mcp-bench/src/memory-skills/matching/fact-matcher.spec.ts`
  - `Test Suites: 2 passed, 2 total`
  - `Tests:       8 passed, 8 total`
- `npx prettier --check --ignore-unknown <the four changed paths>`
  - `All matched files use Prettier code style!`
- Scoped TypeScript diagnostics for all four changed paths: `Errors: 0 | Warnings: 0`.
- `npx nx run-many -t typecheck,test,lint -p mcp-bench` was launched. It did not finish within the 30-second foreground window and one permitted 30-second completion check, and produced no completed result to report.

## Not done

No Batch 2 implementation task is left unimplemented. The project-level Nx verification needs a later completion observation because its active run did not finish in the permitted check window.
