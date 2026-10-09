# Batch 13 report — known-failures evaluator and ledger renderer

## Task 13.1 — Known-failures evaluator

Implemented `evaluateKnownFailures` in the task-620 memory-skills gate. It evaluates the committed `KnownFailureEntry` schema from Batch 3 without redefining it, compares values in the entry's required direction, and uses an explicit suite-ID adapter because the shared 619 scorecard suite contract does not itself carry a suite ID.

Implemented semantics:

- unchanged or within-tolerance listed failures report cleanly;
- improvements that remain failures require tightening `recordedValue`;
- worsening, a new failure, `na`, zero cases, a now-passing listed failure, missing suite/metric, duplicate entry, cassette miss, guard trip, and network hit fail the gate;
- findings are sorted deterministically;
- an empty recorded-failure list succeeds when all observed suites pass.

Evidence: `known-failures.spec.ts` has 12 cases covering all recorded-failure rules, including the required empty-list, duplicate-entry, and removed-suite/metric cases.

## Task 13.2 — Feature evidence ledger renderer

Implemented the Markdown ledger renderer and its verdict calculation for the primary-intent verdicts: `proven`, `no effect`, `regressed`, and `not measurable yet`.

- `proven` requires a trusted ground truth, all configured baselines, MinE improvement against every baseline, and a positive paired interval for every baseline.
- `no effect` covers insufficient effect or an interval including zero, and requires a fix-or-delete proposal before rendering.
- `regressed` covers wrong-direction MinE changes, guard regressions, and invariant failures whose freeze baseline held.
- `not measurable yet` covers a missing suite, `na`, untrusted ground truth, or absent metric/baseline values.
- invariant rows reject missing baselines, satisfying R-L5.
- rows render in deterministic feature-name order.

Evidence: `ledger-render.spec.ts` covers each ledger verdict, the no-effect proposal, and invariant-baseline requirement.

## Paths changed

- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\gate\known-failures.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\gate\known-failures.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\gate\ledger-render.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\gate\ledger-render.spec.ts`

## Risks handled

- No 619-owned scorecard or transport files were changed. The gate accepts an explicit suite-ID adapter so Batch 16 can bridge from its runner's suite identifiers without changing the shared scorecard schema.
- `na` cannot become a pass in either evaluator or ledger rendering.
- The feature evidence renderer rejects invalid invariant/no-effect configurations rather than silently claiming evidence.
- No files in `tools/mcp-bench/src/memory-skills/ground-truth/` were changed.

## Verification

`npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills/gate/known-failures.spec.ts tools/mcp-bench/src/memory-skills/gate/ledger-render.spec.ts --runInBand`

`Test Suites: 2 passed, 2 total`; `Tests: 18 passed, 18 total`.

`npx eslint <four changed files>`

Exit code 0; no output (0 errors, 0 warnings).

`npx nx run mcp-bench:typecheck`

`NX   Successfully ran target typecheck for project mcp-bench`.

`npx prettier --check --ignore-unknown <four changed files>`

`All matched files use Prettier code style!`

`ptah_get_diagnostics` over the four changed files: `Errors: 0 | Warnings: 0 — No issues found.`

## Not done

Nothing within Batch 13 remains. No commit was created, and no 619-owned, scorecard, transport, or ground-truth-generator path was changed.
