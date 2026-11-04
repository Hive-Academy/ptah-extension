# P1-08 — Prompts and artifacts

## Files

- `libs/backend/review-core/src/lib/lanes/prompts/prompt-fence.ts`
- `libs/backend/review-core/src/lib/lanes/prompts/triage.prompt.ts`
- `libs/backend/review-core/src/lib/lanes/prompts/correctness-lifecycle.prompt.ts`
- `libs/backend/review-core/src/lib/lanes/prompts/contracts-callers.prompt.ts`
- `libs/backend/review-core/src/lib/lanes/prompts/security-privacy.prompt.ts`
- `libs/backend/review-core/src/lib/lanes/prompts/host-di-config.prompt.ts`
- `libs/backend/review-core/src/lib/lanes/prompts/review-prompts.spec.ts`
- `libs/backend/review-core/src/lib/lanes/review-artifact.writer.ts`
- `libs/backend/review-core/src/lib/lanes/review-artifact.writer.spec.ts`
- This report.

## Public API

- `ReviewPromptInputSchema`, `ReviewPromptInput`, `fenceReviewInput`, `OUTPUT_RULES`, `buildLensPrompt` in prompt-fence; five prompt builders `buildTriagePrompt`, `buildCorrectnessLifecyclePrompt`, `buildContractsCallersPrompt`, `buildSecurityPrivacyPrompt`, `buildHostDiConfigPrompt`.
- `ReviewArtifactFileSystem`, `ReviewPreviewInput`, `ReviewArtifactWriter`. `renderPreview` returns redacted Markdown; `writePreview` writes `review-preview.md` under a validated absolute `out/` root using an injected filesystem port.

## Required exports and DI

- Orchestrator should add these public exports to `libs/backend/review-core/src/index.ts`: the five prompt builder functions, `ReviewPromptInput` type, `ReviewArtifactWriter`, `ReviewArtifactFileSystem` type and `ReviewPreviewInput` type. `ReviewPromptInputSchema` may be exported for input validation at caller boundaries.
- DI: register `ReviewArtifactWriter` with a filesystem port implementation that supplies `realpath` and `writeFile`, or instantiate it in the stage coordinator with an existing injected filesystem port. Prompt builders are pure functions and need no DI registration. No registration or index file was edited here.
- Caller must supply known secret values in `ReviewPreviewInput.secrets` before rendering; the writer also redacts common token patterns, authorization headers, and sensitive environment assignments.

## AC to spec

| Acceptance | Spec evidence / scope |
| --- | --- |
| AC-4.1–4.2 | `review-prompts.spec.ts` checks triage walkthrough, risk map and observed/inferred headings. |
| AC-4.3–4.4 | Prompt names head SHA; publication stage owns GitHub walkthrough upsert and dedup. |
| AC-6.1–6.3 | Four canonical builders plus lane coverage metadata in preview; lane selection and unavailable states belong to P1-07/P1-09. |
| AC-6.4–6.5 | Prompt spec checks outside-diff evidence and fenced data-only rule. |
| AC-9.1–9.3 | Writer spec checks finding fields and suggested-diff omission; below-Minor suppression. Current-head verification belongs to verifier/publication stages. |
| AC-10.1–10.2 | Writer spec checks 15 eligible findings capped to 10 inline, suppression reasons, and overflow count. |
| AC-10.3–10.4 | Writer uses effective settings passed per run; previously published findings are shown separately and do not use new inline slots. Historical GitHub mutation belongs to publication stage. |

## Decisions

- Triage writes `out/lane-output.json` with `findings: []` plus `out/walkthrough.md`. The strict P1-07 `LensOutputSchema` has no walkthrough field; separate files preserve parser compatibility. Reversible: yes.
- Preview accepts `previouslyPublished` separately from new `accepted` findings so edits do not consume new inline slots. Evidence: AC-10.4. Reversible: yes.
- The artifact writer escapes Markdown and HTML metacharacters after redaction to keep untrusted PR prose from becoming active links or formatting. Reversible: yes.
- Minimum severity follows the effective policy (`Minor` by default from review contracts); Nitpick is suppressed in preview by default. Evidence: D16 and `RepoReviewConfigV1Schema`. Reversible: yes.

## Verification and open issues

- Scoped `ptah_get_diagnostics` reported zero TypeScript errors for changed production files. Nx/Jest were not run because D26 forbids Nx; orchestrator will run `npm run verify -- -p review-core`.
- The stage coordinator must supply real secret values for exact-value redaction and must keep the `out/` directory private to the attempt. Publication logic must deduplicate/upsert walkthrough comments and verify current-head evidence; those files are outside this batch.
