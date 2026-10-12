# Peer Review — Decision #136

## Verdict: ACCEPT WITH CONDITIONS

Scope: decision #136 and its stated downstream work, Batch 29's hint and spec, the R8 requirements, the component-12 plan, and Batches 30–31. This was a read-only review; no tests or builds were run. The referenced commit changes the hint/spec plus unrelated sentinel coverage (`git show 36a8b37f9 --stat`); this review assesses only the hint ruling.

### 1. Is omitting an in-hint example consistent with the requirements?

Yes. R8.1 requires the hint to name the display target/id-update rule, name the sources, point to the skill, remain at most 100 tokens, and record/pin its text and count; it does **not** require a worked example in the hint (`task-description.md:839-852`). Conversely, R8.3 explicitly assigns worked examples to `references/ptah-ui.md`, including the dashboard and id update (`task-description.md:854-862`), and requires every worked example to be a parser-validated corpus case (`task-description.md:866`). Component 12 says the same: the compact hint names/pointers stay within 100 tokens, while the skill owns worked examples (`implementation-plan.md:1150-1162`).

Therefore the no-example result is consistent with the requirements, provided the skill work lands. The current hint meets the enumerated compact-hint content in practice (`ptah-ui-hint.ts:7`; assertions at `ptah-ui-hint.spec.ts:24-47`).

### 2. Is the substitute test a real guard or vacuous?

It is both, in different respects. The test named "uses only parseable ptah-ui examples" can pass with zero examples because it loops over a possibly empty extraction (`ptah-ui-hint.spec.ts:50-59`); as evidence that the current hint contains parseable examples, it is vacuous. It is a limited future guard only for fences matching its narrow newline-delimited regular expression (`ptah-ui-hint.spec.ts:52`).

The following test is non-vacuous component coverage: it extracts the actual `display [id]` text, constructs a display fence, verifies the segmentation target/id, and parses one stat line for each named source (`ptah-ui-hint.spec.ts:61-78`). It does not prove an in-hint worked example exists, nor that a future malformed fence outside the regular expression is caught. This is acceptable only because R8 puts worked examples in the skill, not because it redefines "examples parse."

### 3. Are the Batch 30/31 obligations correct and sufficient?

Batch 30 is correct and sufficient for the displaced examples: it requires the three specified worked examples, requires the two skill copies to be byte-identical, and requires each skill example to appear in `ptah-ui.corpus.ts` (`batches.md:2050-2077`). That implements R8.3's placement and parser-validation contract (`task-description.md:854-866`).

Batch 31 is correct for the measurement record: it requires hint text, character and token counts plus the other R8 measurements (`batches.md:2093-2103`), matching the plan's measurement responsibilities (`implementation-plan.md:1164-1169`). Recording 371 characters/87 tokens, no in-hint example, and 85 tokens without `$limits` is compatible with R8.1; the 85-token counterfactual is additional audit information, not an R8 omission (`decisions.md:140`).

### 4. Is there a cheaper compliant alternative?

Yes. The claim that a minimal example necessarily makes the hint about 106 tokens is not established by the implementation. Using the same `gpt-tokenizer` mechanism imported by the existing spec (`ptah-ui-hint.spec.ts:1,24-25`), this complete compact replacement measured **75 tokens / 272 characters**:

```text
Use ```ptah-ui blocks. ```ptah-ui display [id] opens the panel; reusing an id updates it. Example:
```ptah-ui display x
stats
  Cost | $usage.cost
```
Sources: $diff $tests $usage $agents $limits. Host supplies values. Load ptah-surface-authoring for grammar and examples.
```

The fence uses the same display opener and a `stats` scalar shape exercised by the current spec (`ptah-ui-hint.spec.ts:65-77`). A one-line un-fenced string can be cheaper, but is not a parser example: display behavior is recognized from a `ptah-ui` fence (`task-description.md:326-331`). No in-hint example is required, so this is an available alternative rather than a condition to add one.

## Conditions

1. Amend decision #136's rationale before later batches rely on it: retain the compliant no-example choice, but remove the unsupported implication that an in-hint example cannot fit below 100 tokens. Cite R8.1/R8.3's actual allocation instead (`task-description.md:839-866`).
2. Relabel the zero-or-more fence test as a future-fence guard, and describe the opener/source test as component syntax coverage. Do not record either as proof that the current hint contains a parseable example (`ptah-ui-hint.spec.ts:50-78`).
3. Preserve Batch 30's corpus-membership verification for every worked example and Batch 31's exact token measurement; these are the evidence that makes omission from the hint safe (`batches.md:2074-2077`, `batches.md:2093-2103`).

## Five logic questions

1. **Silent failure:** calling the zero-item loop an example-parse test could report success while no current example is parsed (`ptah-ui-hint.spec.ts:50-59`).
2. **Unexpected user action:** none in Batch 29; an author adding a malformed fence that does not match the narrow extractor could evade that particular future guard (`ptah-ui-hint.spec.ts:52`).
3. **Wrong-answer input:** a future non-newline/otherwise non-matching fence yields a misleading green test rather than parser coverage (`ptah-ui-hint.spec.ts:52-58`).
4. **Dependency failure/shape:** no runtime dependency is introduced by the compact constant; the parser is exercised only in test code (`ptah-ui-hint.ts:7`, `ptah-ui-hint.spec.ts:67-77`).
5. **Unstated requirement gap:** the documents do not require a hint example; they do require skill examples to be corpus cases, which Batch 30 must verify (`task-description.md:854-866`, `batches.md:2076-2077`).
