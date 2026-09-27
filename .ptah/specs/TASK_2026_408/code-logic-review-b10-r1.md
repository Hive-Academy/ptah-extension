# Code Logic Review — `TASK_2026_408`

Verdict: REJECTED
Score: 7/10

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 7/10 |
| Assessment | REJECTED |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 1 remaining |
| Failure modes found | 1 documentation proof overstatement |

Batch 10 re-review, round 1 of 2. Three prior findings are fully resolved. The fourth is substantially corrected, but its new test-proof sentence still needs qualification. All requested new code citations are correct. Paths below are relative to `D:/projects/ptah-extension-task-408`.

## Prior findings

| Prior finding | Resolved? | Revised location and checked evidence |
| --- | --- | --- |
| 1. Absolute loop isolation | YES | `ownership.md:3`, `:9`, `:41` now distinguish entry surfaces and inherited limits. `apps/ptah-cli/src/services/proxy/anthropic-proxy.service.ts:494–505` sends no `ptahCliId`; `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:447` gates the native branch, `:543` resolves the workspace provider, and `:555` starts its SDK session. |
| 2. Path C header omitted structured MCP forwarding | YES | `ownership.md:40` and `apps/ptah-cli/src/services/proxy/anthropic-proxy.service.ts:43–46` explicitly describe the exception. Service `:423–433` parses the header; `:500–501` forwards the override. Receiver `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:536–537` consumes it and `:571` passes it to the SDK session. |
| 3. Overflow wording implied guaranteed compaction | NO — partial resolution | `ownership.md:21` now correctly limits HTTP mapping to 400/413 and assigns recovery to host policy, but adds “The integration test proves this for the HTTP 400 case.” The current S6a test also passes without compaction: `libs/backend/auth-providers/src/lib/translation/translation-proxy.sdk.integration.spec.ts:900–934`. See remaining finding below. |
| 4. Codex MCP destination omitted CODEX_HOME | YES | `ownership.md:8`, `:30` now document the environment override, default and separate adapter source. `libs/backend/harness-sync/src/lib/targets/mcp/codex-home.ts:51–58`, `codex-toml-mcp-facet.ts:113`, and `libs/backend/harness-sync/src/lib/targets/rival-targets.ts:122` support the destination claim. `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.ts:610–612` introduces the conditional SDK config; `:613–621` supplies Ptah's server and `:643` assigns it. |

## Five logic questions

### 1. How does this fail silently?

A green S6a run can be read as proof of compaction under `ownership.md:21`, even when the test follows its no-compaction branch at `translation-proxy.sdk.integration.spec.ts:915`. The test result would not expose that documentation mismatch.

### 2. What user action produces unexpected behaviour?

A maintainer relies on the stated integration proof when assessing recovery. The test may pass with only a prompt-too-long error (`translation-proxy.sdk.integration.spec.ts:920–932`). The revised entry-surface and MCP-forwarding descriptions otherwise match the examined paths.

### 3. What input data produces a wrong answer?

No additional wrong-input claim was found in the revisions. HTTP status qualification matches `libs/backend/auth-providers/src/lib/translation/responses-error-mapping.ts:193`; parsed error fields are selected at `:200–208`. Responses error classification is separately supported at `:217–222`.

### 4. What happens when a dependency fails?

The revised doc correctly assigns recovery to the host. `libs/backend/agent-sdk/src/lib/helpers/auto-compact-control.ts:81` can disable automatic compaction. S6a accepts error propagation without recovery at `translation-proxy.sdk.integration.spec.ts:915–934`; therefore its passing assertion set does not require the compaction outcome.

### 5. What is missing that the requirements never mentioned?

The remaining distinction is between a recorded run's observation and a property enforced by the test. `integration-observations.md:90–103` reports compaction for the recorded S6a run; the test's alternative passing branch does not pin that outcome. The intentional placeholder at `ownership.md:44–46` is accepted and is not a finding.

## Failure modes

### 1. Moderate — HTTP compaction observation is still presented as test proof

- Document: `.ptah/specs/TASK_2026_408/ownership.md:21`.
- Trigger: S6a completes through its no-compaction branch.
- Symptom: the suite passes, while the ownership note suggests the HTTP compaction outcome is proven by the test.
- Evidence: `libs/backend/auth-providers/src/lib/translation/translation-proxy.sdk.integration.spec.ts:895–898` searches for a compaction boundary. `:900–914` checks compaction only if one exists; `:915–934` instead accepts a prompt-too-long error. `.ptah/specs/TASK_2026_408/integration-observations.md:90–103` supports an observed outcome for the recorded run, not a mandatory test invariant.
- Current handling: HTTP status limits and host-policy ownership are now accurate. The sentence “The integration test proves this for the HTTP 400 case” leaves the evidence stronger than the assertions, particularly immediately after the discussion of whether compaction happens.
- Impact: future passing runs could be cited as evidence that HTTP recovery still works even when they only verify error propagation.
- Recommendation: replace that sentence with: “The recorded Batch 9 S6a run observed reactive compaction for HTTP 400 (`integration-observations.md:90–103`); the current test also accepts prompt-too-long propagation without compaction (`translation-proxy.sdk.integration.spec.ts:915–934`).” If the intended claim is only about error translation, explicitly say the test verifies the translated error contract. No production or test change is required in Batch 10.

## New findings

None separate from the remaining portion of prior finding 3. Findings 1, 2 and 4 are closed.

## Blocking issues

None in this re-review scope.

## Serious issues

None in this re-review scope.

## Moderate and minor issues

One remaining moderate issue above; no additional minor or style findings.

## Data flow

1. C → `chat:start` without a native CLI ID → workspace SDK session: OK; service `:494–505`, chat-session service `:447`, `:543–555`.
2. MCP header → parsed override → host session: OK; proxy service `:423–433`, `:500–501`, chat-session service `:536–537`, `:571`.
3. HTTP 400/413 or Responses error → prompt-too-long mapping → host recovery decision: implementation citations OK; `responses-error-mapping.ts:189–211`, `:217–222`. Test-proof wording remains overstated at `ownership.md:21`.
4. Harness-sync Codex facet → CODEX_HOME/default path: OK; `rival-targets.ts:122`, `codex-toml-mcp-facet.ts:113`, `codex-home.ts:51–58`. Native adapter config is correctly identified as an additional source at `codex-cli.adapter.ts:610–643`.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Resolve loop-isolation wording | COMPLETE | None |
| Disclose Path C MCP override | COMPLETE | None |
| Qualify overflow/recovery claim | PARTIAL | Distinguish observed HTTP compaction from a required test outcome |
| Document CODEX_HOME and separate adapter source | COMPLETE | None |
| Verify requested new citations | COMPLETE | All supplied anchors match the code |
| Accurate comment-only headers | COMPLETE | Revised C header `anthropic-proxy.service.ts:43–46` is accurate; B header `codex-cli.adapter.ts:8–11` remains accurate. Whole-file comment-only purity accepted from the orchestrator's explicit git confirmation |
| Keep Batch 9 placeholder intentional | COMPLETE | Excluded from findings |

Implicit requirement still outstanding: test-proof wording must match the assertions, as detailed above.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| C uses a proxied workspace provider | YES | Conditional inheritance documented at `ownership.md:3`, `:41` | None in revision |
| Valid MCP header alongside dropped tools[] | YES | Exception documented at `ownership.md:40` | None in revision |
| Blank/unset CODEX_HOME | YES | Default documented at `ownership.md:30`, implemented at `codex-home.ts:52–53` | None in revision |
| HTTP status other than 400/413 | YES | Excluded explicitly at `ownership.md:21`, classifier `:193` | None in revision |
| S6a passes without compaction | NO (documentation proof) | Test fallback at integration spec `:915–934` | Remaining moderate finding |

## Verification limits

Re-read the entire revised ownership doc and both header paragraphs, and checked every requested new citation plus the S6a assertion branches and recorded observations. Full source-file reads from the previous review remain the baseline for this focused re-review. Accepted the orchestrator's confirmation that both source diffs contain only five added comment lines; no git operation was performed here.

No network, source edits, or test execution. The previous scoped Ptah diagnostics attempt was unavailable because this worktree is outside that tool's attached workspace; repeating it would not verify the documentation revisions. Concurrently edited reference code may change after this snapshot. Only this deliverable was overwritten, using a native filesystem write because no Write tool is exposed.

## Verdict

- Recommendation: REJECT pending the single evidence-qualification edit at `ownership.md:21`.
- Confidence: HIGH for the cited code and current assertion branches.
- Top risk: a passing HTTP overflow test is interpreted as mandatory compaction coverage.
- What a robust implementation would add: a precise observation-versus-assertion sentence; no implementation work within this batch.

Score rationale: 7/10 reflects three fully resolved findings and correct new citations. The remaining recovery-proof overstatement prevents the sound, fully qualified documentation expected for 8/10; the corrected ownership and configuration descriptions lift this above the prior 6/10.