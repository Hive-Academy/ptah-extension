# Batch 25.1 — accepted memory ground truth

## Delivered fixtures

- `memory-facts.v1.jsonl`: 129 accepted facts.
- `merge-pairs.v1.jsonl`: 98 accepted, non-dangling pairs: 50 `should-merge` and 48 `should-not-merge` (both exceed 40).
- `update-cases.v1.jsonl`: 28 accepted cases.
- `temporal-cases.v1.jsonl`: 21 accepted cases.
- `abstention-cases.v1.jsonl`: 18 accepted-abstention cases (exceeds 15); the read-side suite's `abstentionFile` loader consumes this strict schema.
- `MANIFEST.json`: hashes added or refreshed for all changed/new fixtures.
- `read-side.suite.spec.ts`: its compact deterministic fixture now derives from accepted rows and loads the committed abstention file.

Only accepted U2 rows were committed. Rejected facts, pairs, and updates were excluded; rater notes and the private panel manifest were not copied.

## Integrity decisions

- F-005 was replaced by its accepted U2 fact row. Its forbidden token is now `all moves`, which does not occur in its statement; this fixes the prior self-forbidding `google account` defect. The read-side assertion confirms `F-005` is answerable.
- Reference audit found one rejected fact reference: `M-094` cited absent `F-038`. I dropped `M-094` rather than retain a dangling `should-not-merge` pair. Final audit: 0 dangling fact references.
- The accepted merge split after that repair is 50 should-merge / 48 should-not-merge. Abstention count is 18.

## Verification

- `npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills/ground-truth/fixture-manifest.spec.ts tools/mcp-bench/src/memory-skills/suites/memory/read-side.suite.spec.ts --coverage=false --maxWorkers=2 > %TEMP%\620-b25-1-jest.txt 2>&1`
  - Tail: 2 suites passed, 20 tests passed.
- `npx tsc -p tools/mcp-bench/tsconfig.json --noEmit > %TEMP%\620-b25-1-tsc.txt 2>&1`
  - Tail: exit 0.
- `npx prettier --check --ignore-unknown` on all changed fixture and spec files.
  - Passed before the final one-line dangling-pair removal; the final `merge-pairs` and manifest were regenerated from the same canonical JSONL format and formatted.

## Revise round 1

- Removed the UTF-8 BOM from `MANIFEST.json`; byte checks confirm that it and every U2 fixture written in this task are BOM-free. This restores `JSON.parse`, manifest verification, seeded-session generation, and the rubric committed-fixture checks.
- Replaced draft-era seeded-session assertions with accepted-U2 invariants: 129 facts, public source plus `sourceCommit`, accepted labeller (`r1+r2` or `adj-glm`), and `labelledAt`. The session date-order assertion now derives the earlier and accepted dates from F-005, confirming the generator stamps each planting's date rather than pinning the retired October draft date.
- Retention fixture assertions now derive the 127 durable facts from the frozen JSONL. Lifecycle expected rates are independently calculated with the pure age-only policy over that seed; roster case count derives from the same useful rows. This preserves policy and suite-wiring coverage without freezing draft-era counts.
- Extraction still asserts that clamped middle sessions fail and head sessions reach the curator, but no longer pins a corpus-dependent head recall. Its rate checks retain exact numerator/denominator checks; abstention false positives derive from the two accepted abstention facts. The extract-all long-middle expectation independently models the fixture and matcher.
- The accepted fact corpus changes the next live extraction recording volume: it plans 129 one-fact seeded sessions (including 2 abstention cases) plus 63 paired/grouped durable long sessions in each placement, for 255 recording cases total. The 127 durable facts occur once in seeded sessions and once in each long placement (381 durable target presentations). This is larger than the prior 10-fact draft and should be budgeted accordingly.

### Checks

- `npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills/ground-truth/committed-u4-labels.spec.ts tools/mcp-bench/src/memory-skills/ground-truth/fixture-manifest.spec.ts tools/mcp-bench/src/memory-skills/ground-truth/seeded-session-generator.spec.ts tools/mcp-bench/src/memory-skills/host/plan.schema.spec.ts tools/mcp-bench/src/memory-skills/runner/ground-truth-freshness.spec.ts tools/mcp-bench/src/memory-skills/runner/run-memory-skills.spec.ts tools/mcp-bench/src/memory-skills/runner/runner-plan.spec.ts tools/mcp-bench/src/memory-skills/suites/memory/extraction.suite.spec.ts tools/mcp-bench/src/memory-skills/suites/memory/read-side.suite.spec.ts tools/mcp-bench/src/memory-skills/suites/memory/retention.suite.spec.ts tools/mcp-bench/src/memory-skills/suites/skills/rubric-agreement.suite.spec.ts --coverage=false --maxWorkers=2 > %TEMP%\620-b25-1r1.txt 2>&1`
  - Tail: `Test Suites: 11 passed, 11 total`; `Tests: 149 passed, 149 total`; `Time: 192.421 s`.
- `npx tsc -p tools/mcp-bench/tsconfig.json --noEmit > %TEMP%\620-b25-1r1-tsc.txt 2>&1`
  - Tail: empty; exit 0.
- `npx prettier --check --ignore-unknown` on every changed fixture, manifest, and memory-suite spec.
  - Tail: `All matched files use Prettier code style!`
