# mcp-bench

## Ground truth: model panel

Labels for the memory and skills benchmark come from a cross-family model panel, not from human raters.

- **Rater families:** xAI and Google (two raters).
- **Adjudicator family:** GLM. The adjudicator is not a third rater. It runs only when the two raters disagree.
- **Blinding:** a rater never sees the stratum, the slug, the source path, the product score, provenance, or any other rater's labels. Packets are shuffled.
- **Not human ground truth.** A panel agreement is not a human judgment. When the labels come from the panel, `groundTruth.method` is `model-panel` and `groundTruth.panel` names the families (`xAI+Google; adjudicator=GLM`). A suite whose label file has no panel stays `labelled` and omits `panel`. `skill.trigger-eval` keeps the suite id `skill.trigger-eval.human` and sets `displayLabel` to `skill.trigger-eval.panel`.
- **Models, versions, and timestamps.** No panel run is frozen yet, so no resolved model id, model version, or rating timestamp is published here. Each run records them in the private manifest (provider, model, model version, packet count, prompt hash, response count, failure count, unresolved share, and timestamp). Those values stay private and are never committed. Until a manifest exists, treat every panel-labelled metric as pending, not as a completed panel.
- **Unresolved share.** A second invalid or declined rater answer is `unresolved-model-panel`. It stays in the frozen-population denominator and in the private manifest. When more than 10% of a panel activity is unresolved, that activity is ground-truth-untrusted and the affected metric is blocked pending escalation. The current unresolved share is pending: no frozen manifest exists yet.
- **Private data.** Panel inputs, outputs, and manifests stay in `C:\Users\abdal\AppData\Local\ptah-mcp-bench` or in a disposable child home. They are never committed. Repository artifacts keep opaque ids, hashes, aggregates, provenance, and reviewed synthetic cassettes only.
- **Live cassettes** are recorded through the product's openai-codex provider with gpt-5.6-terra.

These metrics change meaning once the labels are the panel's:

| Metric                      | What it measures now                                                                                                                                                                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `skill.rubric.inter-rater`  | Agreement between the model-panel raters, not human inter-rater agreement.                                                                                                                                                                       |
| `skill.judge-agreement`     | Agreement with panel labels, not with human judges.                                                                                                                                                                                              |
| `skill.enhancer`            | Panel accept, edit, and reject decisions, not human edits.                                                                                                                                                                                       |
| R-M4 matcher gate           | Panel-labelled matches. The legacy `humanMatch` field is panel-labelled. `mem.extraction` stays `na` (`matcher-unvalidated`) until that gate is met.                                                                                             |
| `mem.extraction` real slice | Facts taken from the panel labels, not from human labellers.                                                                                                                                                                                     |
| `skill.trigger-eval`        | Panel should-trigger and near-miss prompts. Display label `skill.trigger-eval.panel`. Suite id `skill.trigger-eval.human` is kept for compatibility. Method is `model-panel` with `panel` when the label file records one, otherwise `labelled`. |
