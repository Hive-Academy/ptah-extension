Verdict: APPROVED

same-side review, user-pinned (author grok/xAI, reviewer codex/OpenAI)

## Round 1 re-review

Both prior findings are fixed.

1. **Fixed (was Major) — CI refusal terminology.** [namer-and-trigger.suite.ts:84-90](D:/projects/ptah-extension/.claude-worktrees/task-620-memory-skills-bench/tools/mcp-bench/src/memory-skills/suites/skills/namer-and-trigger.suite.ts:89) now identifies model-panel labels, supplies the `skill.trigger-eval.panel` display label, and explains that the legacy id remains for compatibility. The exact `--ci` refusal is asserted and explicitly checked not to contain `human labels` at [namer-and-trigger.suite.spec.ts:746-760](D:/projects/ptah-extension/.claude-worktrees/task-620-memory-skills-bench/tools/mcp-bench/src/memory-skills/suites/skills/namer-and-trigger.suite.spec.ts:750).

2. **Fixed (was Minor) — model-panel audit disclosure.** [README.md:11-12](D:/projects/ptah-extension/.claude-worktrees/task-620-memory-skills-bench/tools/mcp-bench/README.md:11) states that no panel manifest is frozen, names the pending model/version/timestamp disclosure, and prevents pending metrics from being presented as completed. It also defines `unresolved-model-panel`, retains it in the denominator, and blocks affected metrics when unresolved labels exceed 10%. That matches the design’s invalid/declined-answer and `>10%` ground-truth-untrusted rule at [design-addendum-codex-recording-and-model-panel.md:47](D:/projects/ptah-extension/.claude-worktrees/task-620-memory-skills-bench/.ptah/specs/TASK_2026_620_a13e/design-addendum-codex-recording-and-model-panel.md:47), and satisfies its README disclosure requirement at [design-addendum-codex-recording-and-model-panel.md:62](D:/projects/ptah-extension/.claude-worktrees/task-620-memory-skills-bench/.ptah/specs/TASK_2026_620_a13e/design-addendum-codex-recording-and-model-panel.md:62).

Verification: `npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills/suites/skills/namer-and-trigger --runInBand` passed: 1 suite, 18 tests, 0 snapshots, exit 0 (40.824 s). Scoped TypeScript diagnostics were requested for the two changed TypeScript files but remained unavailable because the checker exceeded its 45-second service window; Jest supplies execution evidence for the altered host and assertion path.

The prior review is retained below as the round-zero record.

Score: 6/10 — the changed result truthfully preserves the closed `labelled` enum while placing the model-panel disclosure and compatibility note in persisted `claim.text`, and correctly sets `raterCount: 2`. That is above the 3–4 band because the actual result is not silently mislabelled as human ground truth. It is below the 7–8 band because a reachable suite error still represents the labels as human, and the required audit disclosures are incomplete.

1. **Major — a reachable trigger-suite failure still calls the panel “human labels.”** [tools/mcp-bench/src/memory-skills/suites/skills/namer-and-trigger.suite.ts:83-89](D:/projects/ptah-extension/.claude-worktrees/task-620-memory-skills-bench/tools/mcp-bench/src/memory-skills/suites/skills/namer-and-trigger.suite.ts:88) registers the same `skill.trigger-eval.human` suite and, on `--ci`, throws “it scores human labels with the real embedder.” This contradicts the B2 rule that the trigger suite must never call the labels human. The B2 assertions exercise `runTriggerEvalHuman` directly, not this host entry, so this user-visible failure path remains untested. Fix the refusal message to identify model-panel labels and retain the legacy id only with its compatibility note; add a host-suite assertion for the `--ci` error.

2. **Minor — README omits required provenance/audit disclosures for the model panel.** [tools/mcp-bench/README.md:3-23](D:/projects/ptah-extension/.claude-worktrees/task-620-memory-skills-bench/tools/mcp-bench/README.md:3) names the rater families and blinding but does not disclose the models, timestamps, or unresolved-label share required by the design’s “Scorecard honesty” section ([design-addendum-codex-recording-and-model-panel.md:60-62](D:/projects/ptah-extension/.claude-worktrees/task-620-memory-skills-bench/.ptah/specs/TASK_2026_620_a13e/design-addendum-codex-recording-and-model-panel.md:60)). Without them, a reader cannot distinguish a fresh, fully adjudicated panel from an old or materially unresolved one. Fix the README to state where each value is reported (and, until records exist, explicitly say it is pending rather than imply a completed panel).

## Required checks

- `groundTruth.method` remains the closed-enum-compatible `labelled`; [trigger-human-eval.ts:530-535](D:/projects/ptah-extension/.claude-worktrees/task-620-memory-skills-bench/tools/mcp-bench/src/memory-skills/suites/skills/trigger-human-eval.ts:532) persists `raterCount: 2`, correctly excluding the conditional GLM adjudicator. Its persisted `claim.text` includes the model-panel method, panel display label, and legacy-id compatibility note at [trigger-human-eval.ts:537-545](D:/projects/ptah-extension/.claude-worktrees/task-620-memory-skills-bench/tools/mcp-bench/src/memory-skills/suites/skills/trigger-human-eval.ts:541). Thus a normal scorecard result has the necessary contextual note even though its legacy `suiteId` contains `human`.
- The changed test is strengthened rather than weakened for the persisted result: it asserts the legacy id, panel display label, closed enum, count two, disclosure text, compatibility note, and no `human` word in `claim.text` at [namer-and-trigger.suite.spec.ts:603-617](D:/projects/ptah-extension/.claude-worktrees/task-620-memory-skills-bench/tools/mcp-bench/src/memory-skills/suites/skills/namer-and-trigger.suite.spec.ts:603).
- No tracked or untracked changes were found under the 619-owned `scorecard/`, `transport/`, `corpus/`, or `bench-data.ts` paths. Target-file scan found no session payload, API key, bearer token, or prompt content; the README contains policy/provenance only.
- Scoped TypeScript diagnostics for the two changed TypeScript files: 0 errors, 0 warnings. I launched the required scoped Jest command; its process exited, but this execution wrapper returned before preserving a tail or exit code. The author report records 5 suites / 59 tests passing; that result was not independently confirmable from my invocation.

## Five logic questions

1. **Silent failure:** the persisted result does not silently call the labels human: `claim.text` carries the model-panel disclosure. The remaining defect is an explicit but misleading CI refusal, not a silent score.
2. **Unexpected user action:** running this selected suite with `--ci` produces the stale “human labels” error from `namer-and-trigger.suite.ts:88`.
3. **Wrong-answer input:** panel labels with a nonzero unresolved share have no disclosed share or timestamp/model identity in the README, so consumers can overread the metric as fully resolved/current.
4. **Dependency failure/shape:** the B2 code adds no external panel call; missing or malformed labels continue through the existing `na`/schema paths. The new disclosure is constructed before label-file handling, so it is retained on normal result shapes.
5. **Requirement gap:** the design requires models, timestamps, and unresolved-share disclosure; the README currently documents only families, conditional adjudication, and blinding.

## Scope and uncertainty

Read in full: both changed TypeScript files, the new README, B2 report, design addendum, scorecard method schema, and the host registration containing the reachable stale message. Examined the requested target diff and 619-owned-path status. No source was edited. The code-path finding is independent of live panel data; no live cassette or benchmark was run.
