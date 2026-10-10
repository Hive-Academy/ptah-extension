# Code-logic re-review (r2) — B25.1 fix

Reviewer: Glm (Ollama Cloud), cross-family
Scope: uncommitted working-tree fix for the 6 defects in `code-logic-review-batch-25-1.md` (commit 673c7f278 + this diff). Read-only; no tests re-run (orchestrator already ran the 11 fixture specs, 150/150). Independent verification: I replicated `normalizeFactText` + `containsToken` (`tools/mcp-bench/src/memory-skills/matching/fact-matcher.ts:13-49`) in a standalone script and ran it over both the HEAD fixture and the working-tree fixture.

## Verdict: APPROVED — 9/10

All six round-1 defects are fixed with derived expectations, not re-pinned observations. I independently confirm: exactly 22 facts changed, all changes are label-only, no keyToken group was dropped or weakened, the old file fails content-only self-match on exactly the 22 facts my round-1 review named, and the new file passes both self-match invariants (content-only and subject=question) for all 127 durable facts. The MANIFEST hash matches my own sha256. Two minor items remain: the new self-match invariant test still does not cover the question-as-subject row (the exact failure mode round 1b demonstrated), and a stale docblock in the extraction spec now states a falsehood about the ground truth.

## Defect status

| # | Round-1 defect | Status | Evidence |
|---|---|---|---|
| 1 | Blocking — 22 of 127 durable facts cannot match their own statement | **Fixed** | All 22 relabels in `tools/mcp-bench/fixtures/memory-skills/memory-facts.v1.jsonl`; my replica: old file fails on exactly `F-001, F-008, F-016, F-017, F-019, F-029, F-050, F-060, F-061, F-076, F-079, F-083, F-084, F-085, F-086, F-087, F-088, F-089, F-090, F-096, F-100, F-129`; new file: 0/127 fail content-only and 0/127 fail with `{subject: fact.question, content: fact.statement}`. New all-durable self-match test at `tools/mcp-bench/src/memory-skills/ground-truth/fixture-manifest.spec.ts:152-160`. |
| 2 | Major — tautology: `unanswerable` = 2 re-pinned the symptom | **Fixed** | `read-side.suite.spec.ts:277-278`: `unanswerable` = 0 (the true invariant) and `recallAt10.den` = `cases.length`, a metric-definition invariant anchored by the exact 9-id caseId list at `:250-262`. No observed number remains pinned. |
| 3 | Major — fixture-db test's positive path gone | **Fixed** | `read-side.suite.spec.ts:402-405` seeds F-001's verbatim current statement; `:445-448` asserts `inject.F-001` pass with last-n pass and no-memory fail; F-008 kept as the negative case at `:449-451`. I verified by hand that the session text (`:416`) satisfies all three of F-001's keyToken groups and neither forbidden token. |
| 4 | Minor — last-n recall numerator dropped | **Fixed** | `read-side.suite.spec.ts:318`: `{'recall.num': 9, 'recall.den': 9}` — follows from the "last-50 sees every fact" invariant plus the compact 9-fact list, not an observation. |
| 5 | Minor — longHead weakened to `toBeGreaterThan(0)` | **Fixed** | `extraction.suite.spec.ts:345-352`: exact `verbatimRecallFor(planned, 'long-head')`. The model (`:97-118`) matches content-only while the pipeline writes `subject: fact.question` (`:188`), so the model diverges from the implementation on any question-collision regression — it is a guard, not a mirror. |
| 6 | Minor — fact-id assertion became count-only | **Fixed** | `seeded-session-generator.spec.ts:99-106`: uniqueness asserted plus set equality with `F-001..F-130` minus `F-038`, derived independently of the file. |

## New defects

1. **Minor — the self-match invariant test omits the question-as-subject row, the failure mode round 1b actually demonstrated.**
   `tools/mcp-bench/src/memory-skills/ground-truth/fixture-manifest.spec.ts:158-159` asserts only `matchesFact(fact, { content: fact.statement })`. Round 1b proved this form insufficient: extraction writes `fact.question` as the row subject (`extraction.suite.spec.ts:188`) and the matcher joins subject and content (`fact-matcher.ts:29-33`), so F-029's question-borne forbidden phrase passed the content-only invariant while every extracted row was rejected. The implementor fixed the fixture but left the guard in the form that missed it. Current fixture is clean (I verified 0/127 fail with subject=question), and `extraction.suite.spec.ts:436` (`recall.seeded === selfMatchingShare` over all durable facts) plus the long-head expectation catch a recurrence at suite time — but only in the slow extraction suite, not in the fast fixture invariant whose whole purpose was "so the class cannot return."
   **Fix**: add `expect(matchesFact(fact, { subject: fact.question, content: fact.statement })).toBe(true)` to the same loop.

2. **Minor — stale docblock claims the self-match share is below 1 because of F-005.**
   `extraction.suite.spec.ts:85-91`: "Below 1 today because F-005 lists 'google account' as forbidden while its own statement says 'not the active Google account'". F-005 was fixed in 673c7f278 and this relabelling brings the share to exactly 1 (verified: 0/127 fail). The comment now states a falsehood about the ground truth and misleads the next maintainer about the extract-all ceiling asserted at `:436`. Pre-existing relative to this diff, but this fix is where it became fully false.
   **Fix**: update the docblock to say the share is 1 since the label repairs.

## Checked and OK

- **The 22 relabels keep meaning (spot-checked 11 of 22 in depth, including all 6 required).** Group counts are unchanged for all 22 facts — no group dropped; every change either adds full word-form alternatives next to the retained originals (F-001 `promot`→`promote/promotes/promoting/promotion`, F-061 `disclos`→`disclose/disclosed/disclosure`, F-076 `warn`→`warn/warns/warning`, F-079, F-100, F-017, F-019) or replaces a dead stem/identifier with the correct one (F-083/F-084/F-085/F-086/F-087/F-088/F-089/F-090/F-096/F-129 `613`→`task_2026_613` — correct because `_` is a word character so `\b613\b` can never match `TASK_2026_613`; F-019 `withslugl`→`withsluglock` corrects the identifier). Nothing was weakened to a trivially matching word; the new alternatives are all topic-bearing.
  - **F-001**: statement contains "promoting"; all three groups still pin the decision topic ("intended", "gates/empirical"). ✓
  - **F-008**: added "not with subagents" — the statement's exact negated-executor wording; the four old alternatives are kept. ✓
  - **F-016**: "mangling" added alongside "mangle"; group 2 keeps `translatetoolsforresponses` (the `562`→`562-owned` change was unnecessary — `\b562\b` already matched "562-owned" at the hyphen boundary — but is harmless and still topic-bearing). ✓
  - **F-029**: forbidden now `separate branches per defect`, absent from statement, question and expectedAnswer (verified by token test). See Decisions for the forced trade-off. ✓
  - **F-050**: forbidden `direct Anthropic path` frees the previously dead keyToken `isdirectanthropic` (old forbidden `isDirectAnthropic` normalises to the same string, so group 3 could never match anything), and the new phrase is a faithful paraphrase of the rejected direct-branch variant. Semantics improved, not weakened. ✓
  - **F-083**: `task_2026_613` matches the statement's "TASK_2026_613" after normalisation; group still requires the shipping-task identifier. ✓
  - **F-096**: `task_2026_304` matches "the cancelled TASK_2026_304 plan"; forbidden `TASK_2026_304 shipped` still rejects the wrong variant. ✓
  - F-019, F-061, F-100: full-form alternatives match the statements' actual morphology ("sequentially", "disclosed", "resumed-run"). ✓
- **Label-only diff**: my parsed-field comparison of old vs new across all 13 fields of all 129 facts finds exactly the 22 keyTokens/forbiddenTokens changes and nothing else — statements, questions, expectedAnswers, sources, labellers are parsed-identical (the `'`→`'` re-encoding lines are parsed-neutral, confirming the orchestrator's evidence).
- **MANIFEST**: the diff touches only the `memory-facts.v1.jsonl` hash line; my sha256 of the working-tree file is `88813d569988bbca6a1fca4afbe380f8d6f803103947280bcb106aeddf94003b`, matching the manifest. No BOM; no duplicate ids; `F-038`/`M-094` appear nowhere in the fixture.
- **No tautologies introduced**: every changed expectation is an invariant or an independently computed value (see defect status table). The compact `unanswerable` = 0, the exact id set, and `verbatimRecallFor` are all derived without reference to the observed output.
- **No B18-facing regressions**: merge-pairs, update-cases, temporal-cases, abstention-cases and distractors are untouched (their manifest hashes are unchanged), and the relabels only widen or repair the matcher acceptance for the 22 facts — no fact that previously matched can now fail except via the two forbidden-token paraphrases (F-029, F-050), both verified absent from all of each fact's own text.

## Decisions

- **F-029's forbidden token is a forced trade-off, not a defect.** The statement itself quotes the rejected variant ("chose this over a branch per defect") and the question repeats it ("rather than one branch per defect"). Because extraction writes the question as the row subject, any forbidden token phrased as the question's own words rejects every extracted row — this is precisely the round-1b failure. Under the frozen statement/question/matcher constraints, a paraphrase ("separate branches per defect") is the only workable label. Residual risk, accepted: a wrong model memory echoing "one branch per defect" would not be forbidden and could satisfy group 1 via "one branch" — the discrimination for that one phrasing now rests on keyToken group 2. Removing the risk fully would require rewording the question, which the frozen-set decision excludes. Recorded so the next relabelling pass knows the boundary.
- **Defect-status rubric**: "Fixed" means the code change addresses the defect as specified in round 1 and my independent verification confirms the behavioural claim — not merely that the tests pass.

## Method notes

- Tests were not re-run (orchestrator evidence: 11 fixture specs, 150/150; extraction suite PASS per the round-1b report). Instead I re-derived the matcher semantics from `fact-matcher.ts` and executed them over both fixture versions; my old-file failure list reproduces round-1 defect 1 exactly, which cross-validates the replica.
- Tool budget: 10 of 30 calls used.