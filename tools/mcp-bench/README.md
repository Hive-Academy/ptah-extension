# mcp-bench

Benchmark for the Ptah MCP tools and the memory and skills features. It drives a bench host:
`cli-headless` (the `cli-engine` and `platform-cli` libraries) or `electron`
(`src/bench-hosts.ts`). Targets are in `project.json`: `bench`, `gate`, `record-baseline`,
`measure-noise`, `generate` and `test`.

## Ground truth: model panel

Labels for the memory and skills benchmark come from a cross-family model panel, not from human
raters (`src/memory-skills/labelling/model-panel.ts`).

- **Raters:** two distinct non-OpenAI model families. A lane is identified by its resolved model
  family, not by its CLI name.
- **Adjudicator:** a third family. It is not a third rater and runs only when the two raters
  disagree.
- **Blinding:** raters get shuffled packets and never see another rater's labels.
- **Not human ground truth.** A panel agreement is not a human judgment. `groundTruth.method` is
  `model-panel` and `groundTruth.panel` names the families as
  `<raterA>+<raterB>; adjudicator=<family>`. A suite whose label file has no panel stays
  `labelled`. `skill.trigger-eval` keeps the suite id `skill.trigger-eval.human` and sets
  `displayLabel` to `skill.trigger-eval.panel`. The committed key `humanMatch` is panel-labelled.
- **Unresolved share.** A second invalid or declined rater answer is `unresolved-model-panel`. It
  stays in the denominator. When more than 10% of an activity is unresolved
  (`PANEL_UNRESOLVED_SHARE_CAP`), the activity is ground-truth-untrusted and the affected metric
  is blocked.
- **Private data.** Panel inputs, outputs and manifests, snapshots and cassettes stay in the bench
  data folder, never in the repository: `PTAH_MCP_BENCH_DATA_DIR` when set, otherwise
  `%LOCALAPPDATA%\ptah-mcp-bench` on Windows and `~/.cache/ptah-mcp-bench` elsewhere
  (`src/bench-data.ts`).

Metrics whose meaning follows the panel labels: `skill.rubric.inter-rater` (agreement between
panel raters), `skill.judge-agreement`, `skill.enhancer`, the R-M4 matcher gate (`mem.extraction`
stays `na` with `matcher-unvalidated` until it is met) and `skill.trigger-eval`.

## Tests

```bash
npm run verify -- -t test -p mcp-bench
```
