# Code-logic review — B25.1 (673c7f278)

Reviewer: Glm (Ollama Cloud), cross-family

## Verdict: REVISE — 5/10

The mechanical integrity of the frozen set is clean: counts, ids, references, hashes, encoding and labeller fields all check out, and the manifest verifies byte-for-byte. But the commit fixes the self-forbidding-token defect for F-005 only, while the same defect class — a fact whose own statement can never match it under `matchesFact` (`tools/mcp-bench/src/memory-skills/matching/fact-matcher.ts:25-49`) — survives in 22 of the 127 durable facts. That is 17% of the corpus that the B18 recording will score as a permanent failure no model can pass. One spec then pins the observed symptom as an expected number. The set needs a relabelling pass before it is frozen as ground truth.

## Defects

1. **Blocking — 22 of 127 durable facts cannot match their own statement.**
   `tools/mcp-bench/fixtures/memory-skills/memory-facts.v1.jsonl`. Verified by running the exact `matchesFact` semantics (normalize + word-boundary token test) over every non-abstention fact against its own statement:
   - Forbidden-token self-containment, the exact defect class the commit claims fixed for F-005: **F-029** (`memory-facts.v1.jsonl:29`, statement contains "a branch per defect", its own forbidden token) and **F-050** (`:49`, statement contains "isDirectAnthropic", its own forbidden token). The matcher checks forbidden tokens first and always rejects.
   - KeyToken groups with no match in the statement, in 20 more facts: **F-001** (`:1`, `\bpromot\b` never matches "promoting"), **F-008** (`:8`, no alternative matches "not with subagents"), F-016, F-017, F-019, F-060, F-061, F-076, F-079, **F-083** (`:82`), F-084, F-085, F-086, F-087, F-088, F-089, F-090, **F-096** (`:95`), F-100, F-129. Two systematic sub-patterns:
     - **Stem tokens**: labels like "promot", "disclos", "warn", "mangle", "resume" look like stems, but `containsToken` wraps single-word tokens in `\b…\b` (`fact-matcher.ts:45-47`), so "promoting", "disclosure", "warning" never satisfy them.
     - **Task-number tokens**: keyTokens like "613", "533", "585", "588", "595", "377", "441", "562", "561", "511", "304", "597" can never match the only phrasing the statements use, "TASK_2026_613", because `_` is a word character in JS regex `\b`.
   **Impact**: read-side insert mode seeds each statement as its own row (`read-side.suite.ts:233-235`), so these 22 facts are structurally unanswerable — recorded as failing cases, dropped from ranking denominators. The extraction baseline "extract-all writes every statement: its recall is the matcher ceiling" (`extraction.suite.spec.ts:93,432`) is therefore capped at 105/127 ≈ 0.827 for a perfect extractor. Every B18 case built on these facts is silently wrong: it fails regardless of the system under test.
   **Fix**: relabel the keyTokens/forbiddenTokens (or statements) of the 22 facts so that `matchesFact(fact, { content: fact.statement })` holds for every durable fact; add an all-facts self-match assertion to the committed-fixture specs so the class cannot return.

2. **Major — tautology: the read-side spec re-pins the observed symptom of defect 1.**
   `tools/mcp-bench/src/memory-skills/suites/memory/read-side.suite.spec.ts:277-278`: `expect(result.metrics['unanswerable']).toBe(2)` and `'recallAt10.den'` = 7. The old code documented *why* the number was 1 (F-005's forbidden token, named as a fixture finding); the new pin names no cause. The 2 unanswerable facts in the compact seed are exactly F-001 and F-008 from defect 1 — the implementor observed the number and froze it instead of investigating it. This assertion also keeps passing if further facts break.
   **Fix**: after defect 1, assert `unanswerable` = 0; meanwhile name the facts and assert the cause, not the count.

3. **Major — the fixture-db test's positive path is gone.**
   `read-side.suite.spec.ts:445-448`: `inject.F-001` flipped from `pass`/last-n `pass` to `fail`/`fail`. The seeded row and session text (`:402-426`) still describe the *draft* F-001 topic ("CLI tool, not subagents"), which is now F-008's content. The test is titled "reads a fixture DB under its own key", but no case anywhere in the suite now demonstrates that a row read under its own workspace key is actually found. Only cost and negative outcomes remain asserted.
   **Fix**: seed the row with the current F-001 statement, or assert `inject.F-008` = 'pass' (its keyTokens are satisfied by the existing row text), and keep one negative case.

4. **Minor — weakened assertion: last-n recall numerator dropped.**
   `read-side.suite.spec.ts:318`: the previous `{'recall.num': 8, 'recall.den': 9}` became `{'recall.den': 9}` only. The numerator was dropped because defect 1 lowers it to 7, hiding the degradation instead of confronting it.
   **Fix**: assert the exact numerator (7 today; 9 after defect 1 is fixed).

5. **Minor — extraction head recall weakened while middle recall got an exact model.**
   `extraction.suite.spec.ts:345-346`: `recall.longHead` went from an exact value to `toBeGreaterThan(0)` plus greater-than-middle. The same commit added `verbatimRecallFor` (`:97-116`) and uses it for the exact `long-middle` expectation (`:439`), so an exact, independently modelled head expectation was available and not used.
   **Fix**: `expect(extractAll['recall.longHead']).toBe(verbatimRecallFor(planned, 'long-head'))` (or the equivalent for the product metric asserted at `:420`).

6. **Minor — fact-id assertion became count-only.**
   `ground-truth/seeded-session-generator.spec.ts:99-101`: the exact id list became `toHaveLength(129)` plus `arrayContaining(['F-001', 'F-005'])`. A swapped or duplicated id now passes this test (uniqueness is only checked incidentally elsewhere).
   **Fix**: assert the parsed id set is unique and equals `F-001..F-130` minus `F-038`.

## Five logic questions

1. **Silent failure**: 22 facts pass schema validation, load cleanly, and are then unmatchable at scoring time — the suites report them as ordinary failing cases (defect 1). Nothing logs that the fixture, not the system under test, caused the failure.
2. **User action**: running the B18 recording or any read-side/extraction/retention bench produces ~17% structurally unwinnable cases and a deflated matcher ceiling.
3. **Input data**: any fact row whose keyTokens are stems or bare task numbers (defect 1) produces a wrong verdict rather than an error.
4. **Dependency failure**: not applicable in scope — no external dependency changes in this commit; the manifest and loaders fail loudly (BOM was already fixed in revise round 1).
5. **Requirements never mentioned**: the acceptance criteria audit dangling references and F-005's token, but no criterion requires a fact to match its own statement. That invariant is implied by the read-side design ("a row is relevant to a fact when the R-M4 matcher accepts it") and by the F-005 fix itself, and it is the one this commit misses at scale.

## Checked and OK

- Counts match the stated numbers exactly: 129 facts, 98 merge pairs (50 should-merge / 48 should-not-merge), 28 update, 21 temporal, 18 abstention cases.
- Fact ids span F-001..F-130 with only F-038 absent (the rejected fact); no duplicate ids in any file; no duplicate (factIds, kind) merge pairs.
- Reference integrity: every `factIds` entry in merge pairs exists in memory-facts.v1.jsonl; zero dangling references; the tokens `F-038` and `M-094` occur nowhere in the five fixtures.
- Schema-level refinements hold: should-merge pairs cite one fact on both sides, should-not-merge cite two; update cases have `v1.at < v2.at`, and bait differs from both values; every temporal question contains its date; abstention `baitKind` covers all three enum values.
- `MANIFEST.json`: all 53 recorded sha256 hashes (raw file bytes, as `buildManifest`/`sha256File` computes, `ground-truth/fixture-manifest.ts:54-73`) match the files on disk; no unlisted or missing files; schemaVersion 1.
- No UTF-8 BOM in any file under `fixtures/memory-skills/` (including MANIFEST.json); LF-only line endings; trailing LF on all five JSONL files; strict key sets on every row match the zod `strictObject` schemas exactly (optional `bait` present on 4 facts).
- Labeller provenance: all 294 rows carry `labeller` and `labelledAt`; values are only `r1+r2` (254) and `adj-glm` (40); every `labelledAt` is ISO-8601.
- F-005 itself is fixed: its forbidden token is now "all moves", which does not occur in its statement; F-005 self-matches.
- Retention spec rewires are genuine invariants: durable ids (127) derive from the committed JSONL, lifecycle rates are recomputed from the age-only policy over that seed, and no draft-era count remains pinned (`retention.suite.spec.ts:382-396, 412-426, 492-505`).
- Extraction spec rewires preserve intent: clamped middle sessions still assert 0 recall and head sessions still assert reach, abstention false positives derive from the fixture's abstention-category count (F-107, F-108), and the extract-all long-middle expectation is independently modelled (`extraction.suite.spec.ts:339-347, 407, 437-440`).
- The seeded-session date-order test now derives the prior date from F-005's accepted date, so it asserts the generator's stamping behaviour instead of the retired draft date (`seeded-session-generator.spec.ts:256-281`).
- The read-side compact fixture correctly derives from accepted rows and loads the committed abstention file (18 + 1 held-out = 19 abstention cases in the file-loading test).

## Decisions

- **Retention's recomputation accepted as non-circular.** The lifecycle expectations call the same `simulatePolicy`/`summarizeLifecycle` the suite uses. The tested invariant is the suite's wiring over the committed seed, not the policy math, and the policy math itself is cross-checked against the oracle policy in the same test. Not counted as a tautology.
- **Tests not re-run.** The orchestrator already ran the 11 fixture-reading suites (149 tests) and the extraction suite is out of my scope. Instead I replicated the matcher semantics and cross-validated against the suite's own outputs: my independent computation finds exactly F-001 and F-008 unanswerable in the compact seed, matching the spec's `unanswerable: 2` pin — which confirms both my replica and that the pin encodes defect 1.
- **Remaining uncertainty**: the merge pairs' `left.session`/`right.session` values ("seed-A" etc.) have no consumer I could find in the mcp-bench suites today. If the B18 merge suite keys sessions by these names, that mapping is currently untested.