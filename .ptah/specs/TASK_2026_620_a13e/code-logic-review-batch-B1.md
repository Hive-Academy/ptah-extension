Verdict: APPROVED

# Code logic review — B1 panel schemas and import

Same-side review, user-pinned (author grok/xAI, reviewer codex/OpenAI).

## Summary

| Metric | Value |
| --- | --- |
| Score | 4/10 |
| Assessment | REVISE |
| Blocking / serious / moderate / minor | 0 / 3 / 0 / 1 |
| Failure modes | 3 |

The CSV shape and arithmetic are preserved: `rubricScoreRowSchema` recomputes the sum and applies `total >= 64` plus every criterion `>= 6` at `label-schemas.ts:266-303`; `triggersOf` correctly uses a strict `> 12` gap at `rubric-ground-truth.ts:529-537`. The unresolved comparison also correctly keeps exactly 10% trusted (`model-panel.ts:299-324`). Those local rules do not make the panel safe in the real suite path.

This is a 4 rather than 5–6 because the three serious gaps each defeat a core B1 guarantee (non-OpenAI provenance, cap enforcement, and usable ≤10% unresolved handling). It is not 1–3: validated row arithmetic, strict schemas, and the requested scoped Jest suite completed with exit 0. The missing integration and fail-open provenance prevent the 7–8 “sound” band.

## Findings

1. **Serious — eligibility trusts a caller-supplied family and misses OpenAI o-series models.** `model-panel.ts:90-100` accepts optional resolved provider/model but retains a separately supplied `family`; `familyKey` and the distinct-family test use only that supplied value (`model-panel.ts:253-285`). `isOpenAiFamily` rejects `openai*` and `gpt-*` only (`model-panel.ts:234-250`), so a manifest such as `{ family: 'xAI', provider: 'opencode', model: 'o3' }` is eligible despite routing to an OpenAI-family model. It also has no canonical resolution for tier aliases before comparing family. This contradicts the design’s “verify actual provider/model/family” requirement and permits a forbidden OpenAI rater/adjudicator to contaminate the ground truth while its method records a non-OpenAI family. **Fix:** derive a canonical family exclusively from the resolved provider/model (after resolving OpenCode and tier aliases), reject all OpenAI identifiers including `o[0-9]`/`o-series` and Codex forms, reject a declared family that disagrees with the derived one, and test those routes.

2. **Serious — production suite calls never pass panel provenance, so the cap and model-panel method are silently bypassed.** `rubric-agreement.suite.ts:283` calls `loadRubricGroundTruth` with only `raters`; `judge-agreement.suite.ts:815-818` does the same. Consequently `rubric-ground-truth.ts:432-445` emits legacy `method: 'labelled'` and supplies no unresolved data to `untrustedReasonOf`. The former suite then hard-codes `groundTruth.method: 'labelled'` at `rubric-agreement.suite.ts:329-334`. A >10% unresolved panel result can therefore produce ordinary trusted-looking metrics rather than the required `ground-truth-untrusted`/blocked metric. **Fix:** introduce verified private-manifest provenance at the suite options/entry boundary, validate it with `panelManifestSchema` and eligibility, pass its method/population/unresolved count to every rubric consumer, and emit `truth.method`/`truth.raterCount` rather than literals.

3. **Serious — any unresolved U1 document makes loading fail, including the explicitly trusted ≤10% case.** The importer drops unresolved attempts from `rows` (`model-panel.ts:572-590`); its own boundary test proves a 1-of-10 shortfall returns nine rows and is trusted (`model-panel.spec.ts:268-276`). But the loader requires two valid CSV rows for every document and throws before it calculates the unresolved reason (`rubric-ground-truth.ts:352-358`; cap calculation is only reflected later at `rubric-ground-truth.ts:432-446`). Thus unresolved labels are neither counted as pass nor fail—which avoids direct score bias—but they also cannot remain in the denominator while allowing an at-or-below-10% metric as the revised design specifies. **Fix:** represent the frozen eligible population separately from accepted labelled documents; compute agreement/quality over accepted, adjudicated labels while reporting the full population and unresolved share, and only block when the share exceeds 10%. Add an end-to-end fixture with one unresolved document out of ten.

4. **Minor — the new specs do not cover the requested boundary and route failures.** `model-panel.spec.ts:125-163` covers a declared `OpenAI` family and provider `openai-codex`, but has no OpenCode-to-`gpt-*`, o-series, tier-alias, or declared-vs-resolved-family mismatch case. `rubric-ground-truth.spec.ts:73-100` injects counts into an otherwise complete one-document fixture, so it does not exercise real missing imported rows. The new tests also do not assert criterion exactly 6 or a total difference exactly 12; `model-panel.spec.ts:220-276` only demonstrates total 64 with all criteria 8. **Fix:** add focused tests for those cases, plus a real suite invocation carrying panel provenance.

## Five logic questions

1. **How does this fail silently?** A normal rubric or judge run omits `panel`, then reports `labelled` and never evaluates the unresolved cap (`rubric-agreement.suite.ts:283`, `rubric-agreement.suite.ts:329-334`; `judge-agreement.suite.ts:815-818`).
2. **What user action produces unexpected behaviour?** Configuring an OpenCode lane resolved to `o3` while declaring family `xAI` passes eligibility and records non-OpenAI provenance (`model-panel.ts:234-285`).
3. **What input data makes this produce a wrong answer rather than an error?** A provider/model-family mismatch produces an accepted panel and incorrect method string; it does not throw (`model-panel.ts:286-295`).
4. **What happens when a dependency fails, times out, or returns a shape it should not?** Invalid/declined CSV and JSONL rows are excluded and counted unresolved (`model-panel.ts:602-655`), but a surviving ≤10% unresolved U1 row causes the downstream loader’s missing-rater-row error rather than the intended denominator treatment (`rubric-ground-truth.ts:352-358`).
5. **What is missing that the requirements never mentioned?** A durable, validated hand-off from the private manifest into each suite invocation is absent; without it the actual provider/model verification, panel method, and unresolved population never reach scorecard results.

## Data flow

1. Private lane identity/manifest → `evaluatePanelEligibility` — **gap:** declared family controls distinctness and can mask resolved model family.
2. CSV/JSONL output → import functions — **OK locally:** strict rubric arithmetic and invalid-row accounting.
3. Accepted rubric rows → committed labels — **gap:** unresolved rows are absent, not representable to the existing all-document loader.
4. Committed labels → rubric/judge suite loader — **gap:** both callers omit panel provenance.
5. Loaded truth → scorecard ground truth — **gap:** rubric agreement hard-codes `labelled`.

## Verification and residual uncertainty

- Read in full: all six B1-changed files and their B1 diff; reviewed the B1 report, revised design addendum Part B, benchmark rubric protocol, and relevant suite call sites.
- No `ptah_*` tools were exposed in this session, so native read/search was the required fallback; no source files were edited and no git operation was run.
- Ran the requested scoped command exactly: `npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills/labelling tools/mcp-bench/src/memory-skills/ground-truth tools/mcp-bench/src/memory-skills/suites/skills/rubric-ground-truth --runInBand` — exit 0 (tail contained no emitted lines).
- Blinding/private-write check: the B1 import module is pure and writes no filesystem artifacts; the committed conversion shapes contain no stratum, slug, or family (`model-panel.ts:434-468`). The remaining concern is provenance correctness, not a demonstrated R2 data leak.

## Round 1 re-review

Same-side review, user-pinned (author grok/xAI, reviewer codex/OpenAI).

Verdict: **APPROVED**. The four prior findings are fixed; no new behavior-level defect was found in the B1-only diff.

1. **Fixed (prior serious: eligibility).** `model-panel.ts:337-395` derives family from the resolved provider/model, rejects unknown pairs, rejects all detected OpenAI-family identifiers (including `o`-series), and rejects a declared/resolved-family mismatch. OpenCode route membership and tier aliases are checked at `model-panel.ts:341-364`. Focused coverage includes OpenCode `gpt-*`, `o3`/`o4-mini`, aliases, and a mismatch at `model-panel.spec.ts:172-210`. The `@ptah-extension/shared` import is permitted: mcp-bench has `type:tool` (`tools/mcp-bench/project.json:5`) and the boundary rule lets that tag depend on `*` (`eslint.config.mjs:342-352`).
2. **Fixed (prior serious: suite provenance/cap bypass).** Both suite entry paths parse private panel manifests and pass verified provenance to the loader: `rubric-agreement.suite.ts:299-308` and `judge-agreement.suite.ts:843-850`. The loader emits the verified panel method internally (`rubric-ground-truth.ts:478-495`); scorecards intentionally retain `groundTruth.method: 'labelled'` with `raterCount: 2` (`rubric-agreement.suite.ts:357-363`, `judge-agreement.suite.ts:777-783`), while the panel string appears in `claim.text` (`rubric-agreement.suite.ts:349-355`, `judge-agreement.suite.ts:759-775`). This matches the stated closed 619 enum constraint.
3. **Fixed (prior serious: unresolved documents).** `rubric-ground-truth.ts:378-389` records incomplete panel documents as unresolved rather than throwing. Agreement is calculated only over accepted labels (`rubric-ground-truth.ts:430-450`), while `population`, `acceptedCount`, `unresolvedIds`, and `unresolvedShare` are reported (`rubric-ground-truth.ts:478-495`). The cap blocks only when strictly over 10% (`rubric-ground-truth.ts:542-545`), so unresolved rows are neither coerced to pass nor fail. Real 1/10 and 2/10 missing-row fixtures verify the behavior at `rubric-ground-truth.spec.ts:131-170`.
4. **Fixed (prior minor: boundaries/spec coverage).** Pass arithmetic is covered at total 64 and criterion 6 in `label-schemas.spec.ts:494-552`; a total gap of exactly 12 is non-adjudicated and 13 is adjudicated at `rubric-ground-truth.spec.ts:113-129`. Manifest/import artifacts retain opaque IDs and rater IDs only; the inspected import and suite paths do not persist stratum, slug, or rater family into committed artifacts. The 713/732-line warnings do not conceal a behavioral defect in this review.

The requested scoped Jest command was launched with output redirected to a temporary file, but the execution wrapper returned after 30 seconds without completion status or output; I did not loop or rerun it. The earlier review's narrower requested Jest command completed successfully. This is an execution-observation limitation, not a code finding.
