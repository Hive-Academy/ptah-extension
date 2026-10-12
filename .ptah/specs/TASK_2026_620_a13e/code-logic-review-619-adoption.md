# Code logic review — 619 export adoption

## Verdict: REVISE

Score: 6/10 (works with a real evidence-integrity gap). The launch, host wire protocol, retry and CI paths are preserved and exercised, which separates this from 3–4 (significant likely-path failures). It cannot score 7 because a malformed suite-result artifact can be accepted and rewritten as a success-looking scorecard with provenance fields silently erased.

## Findings

1. **Moderate — unknown nested suite-result fields are silently discarded.** `tools/mcp-bench/src/memory-skills/runner/suite-result.ts:135-168` parses the complete core through 619's non-strict `z.object` schemas and reconstructs the persisted value from `core.data`; it only checks unrecognised *top-level* keys at `:147-149`. The shared claim, ground-truth, baseline and cost objects are non-strict at `tools/mcp-bench/src/scorecard/scorecard.types.ts:10-45,53-74`. Thus an artifact containing, for example, `claim: { source: 'ledger', ref: '...', tex: 'evidence' }` is accepted and written without `tex`, rather than failing. The original 620 contract used strict nested objects (parent diff for this file), so this is a regression at the host-to-runner trust boundary. It can make a malformed suite result look successfully scored while dropping evidence/provenance; the current spec only proves rejection of a top-level `extra` key at `tools/mcp-bench/src/memory-skills/runner/suite-result.spec.ts:95-114`, not nested keys. Make the 620 boundary reject unknown nested keys (or explicitly recursively compare parsed output against input) and add nested claim/groundTruth/cost coverage. `details` is deliberately `z.unknown()` in the shared core (`scorecard.types.ts:54-56`), so it is retained at this stage rather than silently stripped; its kind validation happens later at `:125-132`.

## Required behavior trace

- The plan reaches the child without mutating the parent: `run-memory-skills.ts:518-527` passes `PTAH_BENCH_MEMORY_SKILLS_PLAN` via `HostLaunchOptions.env`; the launcher rejects only keys produced by `isolatedEnv` (`transport/host-launcher.ts:253-291`) and merges accepted extras into the child environment at `:347-373`. The plan key is not among the isolation keys. The successful and throwing-launch tests snapshot `process.env` and assert the option path at `runner/run-memory-skills.spec.ts:285-298,323-349`.
- Host wire behavior remains connected: the entry still writes ready/complete/fatal messages through `runMemorySkillsHost` and returns fatal exit 1 at `host/memory-skills-host.entry.ts:81-119`; shared shutdown wiring retains the 20-second forced exit 2 at `:90-96`. The shared helper changes the usage/boot-prefix text but not those wire shapes or exit paths.
- Completion polling still occurs before host shutdown (`run-memory-skills.ts:314-326`); safety-cap retry data is still retained in case records (`runner/suite-result.ts:49-62`) and exercised by the runner specs at `run-memory-skills.spec.ts:487-523`; the `--ci` gate is still evaluated and persisted only in CI at `run-memory-skills.ts:604-620`, and failures contribute to exit code 1 at `:622-683`.
- `mem.extraction` now honestly identifies its product-code reference as `code` at `suites/memory/extraction.suite.ts:685-691`; the shared `prompt` rule is explicitly limited to `ptah-core-prompt.ts:<line>` at `scorecard.types.ts:16-25`. Repository-wide suite-claim inspection found only `code` and `ledger` literals in 620 suites (and dynamic `doc.source` typed from suite data), all accepted by the shared enum; no remaining `prompt` reference will be refused at scorecard write time.

## Five logic questions

1. **Silent failure:** nested unknown provenance fields are stripped at `suite-result.ts:135-168`, then the run writes a valid-looking scorecard.
2. **Unexpected user action:** supplying a hand-authored or host-produced result with a typo in an optional nested claim/ground-truth/cost field silently loses that field instead of identifying the bad artifact.
3. **Wrong-answer input:** a nested typo such as `claim.tex` produces a scorecard whose claim lacks the intended evidence text, rather than an error; current suite source objects do not contain such keys.
4. **Dependency failure/timeout/bad shape:** host launch failures continue to teardown/classify at `host-launcher.ts:402-426`; completion timeout/early exit is converted to run problems at `run-memory-skills.ts:622-639`. The bad-shape gap is the nested-key finding above.
5. **Requirement gap:** the shared schema does not specify strictness for imported suite artifacts, although 620's prior file contract required it. The adopted boundary needs an explicit no-silent-loss rule.

## Tests

`npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills --runInBand` — invoked as scoped; the execution bridge returned no Jest summary or exit status. Existing batch evidence records 51 suites / 579 tests passing, but that is not substituted for a captured result here. Scoped TypeScript diagnostics for all seven changed source/spec files: 0 errors, 0 warnings.

## Scope and remaining uncertainty

Read the full eight changed files, shared scorecard/host-launcher/host-process contracts, all memory-skills suite claim sites, the 619-adoption batch report, and the relevant runner/schema specs. No source was edited. The only uncommitted path observed was the pre-existing unrelated `apps/ptah-electron/src/windows/.shell-security-QReE6X/` directory.
