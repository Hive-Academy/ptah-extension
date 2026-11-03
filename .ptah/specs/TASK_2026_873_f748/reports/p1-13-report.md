# P1-13 — Replay runner and quality report

## Files

Created `tools/review-eval/replay-runner.ts`, `match-findings.ts`, `report.ts`, `adjudication.schema.ts`, and focused specs beside the implementation. The runner validates fixture readiness, builds snapshots, starts the model broker, supplies a sealed Ubuntu spawner, fake GitHub port and fixed clock to a review-core orchestrator factory, reads accepted and suppressed findings from its export, and checks attestation. The current fixture manifest remains pending, so no real 15-PR replay was run.

## Matching algorithm

Adjudication version must equal the manifest version. Each of 108 root slots requires an adjudicated path, line, category, lens, summary and disposition. Candidate findings are parsed through the public review contract. A finding matches one root when PR and file agree, line distance is at most five, category or lens agrees, and Jaccard similarity of normalized failure text is at least 0.3. Matching is one-to-one; ties and unadjudicated extras are disputed. Missing roots are misses; adjudicated actionable extras are extras.

## Report format

`writeQualityReport` writes Markdown and JSON with a fixed 108-root denominator, match/miss/extra/disputed totals, suppressed count, overall and per-lens precision/recall, and per-PR isolation hashes and failures. Missing or failed attestation invalidates score values. The report states CodeRabbit remains enabled. The report contains aggregate data and hashes, not broker credentials or finding text.

## AC to spec

| Acceptance | Evidence |
| --- | --- |
| AC-17.1–17.3 fixture and replay | `replay-runner.spec.ts` refuses pending fixture before any port is touched; runner calls snapshot, broker, sealed launcher and orchestrator. |
| AC-17.4 matching | `match-findings.spec.ts` covers match, miss, extra and disputed classifications with 108 root slots. |
| AC-17.5 quality report | `report.spec.ts` checks denominator 108, suppressed count, invalid score and no credential fields. |
| AC-17.6–17.7 isolation | `report.spec.ts` checks missing attestation and failed network probe invalidate score; Ubuntu execution remains untested. |

## Decisions

- Require a separate versioned root annotation for path and line: the manifest root schema contains only category, severity and evidence text; matching needs structured coordinates. Reversible by enriching the manifest schema later.
- Unknown extra findings are disputed until adjudicated; CodeRabbit absence alone is not a false positive. Based on implementation plan replay guidance. Reversible by adjudication update.
- `type:tool` may import any lib under `eslint.config.mjs` module-boundary rule, so public review-core and review-contracts imports are permitted.
- The runner receives the review-core composition factory as a port so it can pass a fake GitHub port, fixed clock and sealed spawner without editing concurrent library files. Reversible after a shared composition seam exists.

## Verification and Ubuntu-only open issues

Scoped Ptah diagnostics reported zero errors for initial implementation files and the final changed runner, report and report spec. One intermediate diagnostic attempt timed out. Three focused suites initially had one matcher failure; the zero-score tie bug was fixed and `match-findings.spec.ts` passed on rerun. `report.spec.ts` passed 3/3 after a type correction. `replay-runner.spec.ts` passed in the initial run. No final aggregate rerun was performed. No Nx/npm verify/build/serve was run (D26). The real fixture manifest is pending per D28; no ready fixture, actual Ubuntu bubblewrap execution, end-to-end attestation, or quality score is available yet. The runner's pipeline factory must be wired to a real Ubuntu review-core composition when fixtures are ready. No matching host skill catalogue or loader was available for this task.


