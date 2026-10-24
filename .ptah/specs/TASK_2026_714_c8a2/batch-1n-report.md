# Batch 1n ? usage accounting and remaining evidence plan

Implemented within `libs/backend/codex-runtime/tools/*` and the assigned spike runner. No paid turns, real binary invocation, `--run`, source-library edits, or git operations.

## Accounting and regression evidence

- `libs/backend/codex-runtime/tools/evidence-harness.ts:562`: the supplied working tree already contained delta arithmetic in `UsageBudget`. Retained it rather than replacing it: each stable stream contributes its latest cumulative total once; each turn receives only increments over the previously observed total. Limits remain 30,000 per turn and 100,000 per run. Added the stream-identity contract at line 575.
- `libs/backend/codex-runtime/tools/evidence-harness.ts:1970`: main harness now identifies the cumulative stream by case and thread, consistently for observation and per-turn reporting.
- `libs/backend/codex-runtime/tools/evidence-cases-round.ts:332`: round accounting uses case/thread identity, retained across child restart for resume-history, instead of including the child label. Different threads still contribute independently. Per-turn deltas are recorded in `usageByTurn`, keyed by thread and turn.
- `libs/backend/codex-runtime/tools/evidence-harness.spec.ts:1244`: exact 7a2 replay: cumulative samples 11,721, 23,481, 38,926 produce turn totals 23,481 and 15,445. Turn 2 passes the 30,000 bound; cumulative is 38,926, **not 62,407**. Duplicate notifications do not add spend; another thread contributes independently.
- `libs/backend/codex-runtime/tools/evidence-cases-round.spec.ts:393`: fake-child replay includes `{last:11721,total:11721}`, `{last:11760,total:23481}`, `{last:15445,total:38926}`. It then completes a synthetic 24,000-token third turn, different-command approval and decline in the same child/thread. Final synthetic total is 62,926; deltas are `[23481,15445,24000]`. This is a mock regression, not new real evidence.
- `libs/backend/codex-runtime/tools/evidence-cases-round.spec.ts:334` and `:440`: resumed fake thread preserves cumulative usage across children; final 200 is counted once, not 100 + 200. Existing same-home regression proves two separate threads each contribute 100.
- Historical 7a2 JSON remains unchanged. Its other thread ended at 23,451; corrected historical run spend is **23,451 + 38,926 = 62,377**, rather than the artifact's 77,861.

## Remaining round plan

`libs/backend/codex-runtime/tools/evidence-round-plan.ts:9` estimates approval turns at 24,000 and approval-free turns at 16,000. The planning limit remains 85,000 per run. Resume-history currently sends two no-tool messages, so its estimate is 32,000.

Every round also includes the three zero-turn schema probes: schema-handshake, modified-input-schema, subagent-and-rewind.

| Round | Paid cases, in order                                 | Turns | Cap |          Estimated tokens |
| ----- | ---------------------------------------------------- | ----: | --: | ------------------------: |
| 7c    | always-allow-scope, all three messages in one thread |     3 |   4 |                    64,000 |
| 7d    | same-home-isolation                                  |     2 |   3 |                    48,000 |
| 7e    | resume-history; profile-inputs                       |     3 |   4 |                    48,000 |
| Total |                                                      |     8 |  11 | 160,000 across three runs |

The estimate covers planned turns; the one-turn cap reserve is not a promise of extra token headroom. Runtime token bounds still stop overspend.

## Ledger and runner

- Approved: **35**. Used before this batch: **22** = 18 earlier + 1 failed 7a + 3 in 7a2. Remaining: **13**. This batch consumed **0**.
- Planned caps total **11**, leaving **2** unallocated turns even if all caps are consumed. Planned evidence itself uses 8 turns.
- `evidence-round-plan.ts:6` encodes baseline 22; `:48` defines the replacement rounds; `:89` requires `--prior-turns-used` for 7d/7e and accepts it for a 7c retry. Old round names are rejected. `spike-runner.ts:30` documents the ledger contract.
- Supply the sum of **actual artifact `turnsConsumed` from every attempt after 7a2**, including failed attempts, retries and steers. Do not supply lifetime usage or infer usage from planned turns. The cap is rejected if it exceeds `13 - priorTurnsUsed`; CLI cap overrides are rejected. As before, artifact accounting is caller supplied, not a persistent cross-process ledger.
- `evidence-round-plan.spec.ts:85` verifies cap totals, estimates, remaining allowance and omission of already-proved cases, including refusal of an additional 4-cap run after 11 turns.

## Verification

- Scoped ptah diagnostics: 0 errors, 0 warnings.
- `npx jest -c libs/backend/codex-runtime/jest.config.ts --testPathPatterns=tools --coverage=false --maxWorkers=2`: **3 suites, 235 tests passed**. Jest reported a worker shutdown warning; Windows skipped a symlink operation because the OS forbids creation. No test failures.
- `npx nx run-many -t typecheck lint -p @ptah-extension/codex-runtime --parallel=1 --output-style=static`: **both targets passed**, lint 0 errors / 8 warnings.
- Degradation audit: exit 0; **TOTAL 276 unsuppressed sites**, no FAIL output. This reports the repository total, not zero debt.
- Prettier applied to all edited files and this report.
- Default ts-node dry runs initially failed with TS5107/TS5109. Successful dry runs and audit used command-local `TS_NODE_COMPILER_OPTIONS={"module":"CommonJS","moduleResolution":"node","ignoreDeprecations":"6.0"}`; no repository configuration changed.

Dry-run headers (later rounds conservatively assume prior caps were fully consumed):

```text
runner 7c: 4 cases, planned turns 3, cap 4, estimated tokens 64000, budget left 13, prior turns used 0
runner 7d: 4 cases, planned turns 2, cap 3, estimated tokens 48000, budget left 9, prior turns used 4
runner 7e: 5 cases, planned turns 3, cap 4, estimated tokens 48000, budget left 6, prior turns used 7
```

Commands: `npx ts-node --transpile-only .ptah/specs/TASK_2026_714_c8a2/spike-runner.ts --round 7c --dry-run`; repeat for 7d with `--prior-turns-used 4`, then 7e with `--prior-turns-used 7`. Each printed its header and dry-run JSON opening brace.

## Decisions

1. **Reuse the existing delta accountant and correct stream identity.** Options: replace arithmetic or retain the already-correct accumulator. Source at `evidence-harness.ts:562` and the replay support retaining it. Thread identity also avoids counting resumed cumulative history twice. Reversible tooling-only change.
2. **Drop usage-semantics from scheduled rounds.** Options: pay to repeat the probe or use 7a2's two-request approval sample. The last three decisions rows and recorded samples settle last=request versus total=thread. The catalog remains available for historical harness cases; no new paid probe is scheduled. Reversible plan change.
3. **Prioritize scope, then same-home, then history/profile.** All three scope messages repeat in one thread; different-home is already observed. This follows the requested evidence gaps while staying within 85k/run and 13 remaining turns. Reversible round ordering.
4. **Estimate resume as two approval-free turns.** Options: 48k for two approval turns or 32k for two no-tool turns. `evidence-cases-round.ts` explicitly prompts ?Reply OK without tools? before restart and ?Reply OK again without tools? after it. Chose 32k, plus 16k for profile. Reversible estimate.
5. **Retain caller-supplied actual artifact accounting.** Extend the existing CLI contract to sum all attempts after 7a2 rather than introduce persistent state outside batch ownership. Later rounds require the value; reruns must include it. Reversible tool interface, no product API change.

## Files written

- `libs/backend/codex-runtime/tools/evidence-harness.ts`
- `libs/backend/codex-runtime/tools/evidence-harness.spec.ts`
- `libs/backend/codex-runtime/tools/evidence-cases-round.ts`
- `libs/backend/codex-runtime/tools/evidence-cases-round.spec.ts`
- `libs/backend/codex-runtime/tools/evidence-round-plan.ts`
- `libs/backend/codex-runtime/tools/evidence-round-plan.spec.ts`
- `.ptah/specs/TASK_2026_714_c8a2/spike-runner.ts`
- `.ptah/specs/TASK_2026_714_c8a2/batch-1n-report.md`
