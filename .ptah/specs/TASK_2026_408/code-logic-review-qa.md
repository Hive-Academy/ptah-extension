# Code Logic Review — `TASK_2026_408`

Verdict: REJECTED
Score: 6/10

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 6/10 |
| Assessment | REJECTED |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 1 |
| Failure modes found | 1 |

Scope: final QA additions in the two supplied spec files, both read in full. This verdict concerns the explicit requirement for independently computed expected bodies, not the previously approved production implementation. Actual raw-string comparisons and both provider lanes are present, but the text-only oracle shares production translation logic. That central acceptance gap places this below the sound 7–8 band; working HTTP captures and retry assertions distinguish it from the significant implementation failures of the 3–4 band.

Paths below are relative to `libs/backend/auth-providers/src/lib/` unless prefixed with `.ptah` or `libs/shared`.

Read context, the relevant Batch 6 and implementation-plan sections, prior Batch 6 review, test-report, CONVENTIONS.md and CONTRIBUTING.md. No applicable AGENTS.md/CLAUDE.md or task-description.md was found. The existing style review covers unrelated Batches 7–8.

## Five logic questions

### 1. How does this fail silently?

A translator change can alter the complete wire body while the text-only tests stay green: both expected values call the same translator and name guard used by the proxy (`providers/codex/codex-stream-parity.spec.ts:338`, `providers/opencode/opencode-translation-proxy.spec.ts:503`, `translation/translation-proxy-base.ts:554`). Finding 1 identifies the shared-oracle gap. These checks still detect changes introduced solely by transport or the image downgrade; they are not entirely vacuous.

### 2. What user action produces unexpected behaviour?

No new application behaviour is introduced by these test additions. The relevant reviewer action is treating a green text-only comparison as independent evidence of a fixed wire contract; that conclusion exceeds what the oracle proves (`providers/codex/codex-stream-parity.spec.ts:340`, `providers/opencode/opencode-translation-proxy.spec.ts:505`).

### 3. What input data produces a wrong answer?

The plain tool-result fixtures already expose the oracle weakness: reordering the translator's top-level `model`, `input`, and `store` properties changes raw bytes on both actual and expected sides without failing these tests (`translation/responses-request-translator.ts:150`). OpenCode's separate literal output check protects the selected function result, but not the entire body (`providers/opencode/opencode-translation-proxy.spec.ts:510`).

### 4. What happens when a dependency fails?

The added retry coverage scripts a first 401 then success and compares two real captures (`providers/codex/codex-stream-parity.spec.ts:306`, `providers/opencode/opencode-translation-proxy.spec.ts:522`). Codex disables SDK retries at `providers/codex/codex-stream-parity.spec.ts:260`, isolating the proxy retry. OpenCode recovery is deliberately synthetic: the test subclass overrides it at `providers/opencode/opencode-translation-proxy.spec.ts:26`, whereas production returns false at `providers/opencode/opencode-translation-proxy.ts:55`. This proves base retry mechanics for each provider configuration, not real OpenCode key refresh.

### 5. What is missing that the requirements never mentioned?

Byte equality does not prove that a cached serialized string was reused: deterministic reserialization also produces equal bytes. The Codex retry comment overstates that conclusion (`providers/codex/codex-stream-parity.spec.ts:311`); production serializes in the forwarding method (`translation/translation-proxy-base.ts:791`). This does not invalidate the requested equality assertion and is not counted as another failure mode. Live upstream compatibility is outside these loopback fixtures (`providers/codex/codex-stream-parity.spec.ts:235`, `providers/opencode/opencode-translation-proxy.spec.ts:257`).

## Failure modes

### 1. Moderate — shared production oracle cannot pin independent text-only wire parity

- Trigger: change property order or another unpinned field in the production translator/name guard.
- Symptom: the expected body changes alongside the upstream body; all three text-only cases can remain green despite changed wire bytes.
- Evidence: `providers/codex/codex-stream-parity.spec.ts:338`; `providers/opencode/opencode-translation-proxy.spec.ts:503`; production uses the same pair at `translation/translation-proxy-base.ts:554`.
- Current handling: runtime `JSON.stringify(guardResponsesToolNames(translateAnthropicToResponses(...)).request)` supplies the expected body. OpenCode additionally checks one literal function output at `providers/opencode/opencode-translation-proxy.spec.ts:510`.
- Recommendation: compare the complete captured string with an explicitly authored literal wire fixture, or serialize a hand-authored expected object with deliberately fixed field order. Do not call production translators/guards to construct that expectation. Keep the two-capture retry equality checks: the first capture is a valid baseline for the relational retry requirement.
- Impact: the explicit independent-expectation criterion is not met. This is a test coverage defect, not evidence of a current production data-loss defect.

## Blocking issues

None demonstrated within this test-only review.

## Serious issues

None demonstrated within this test-only review.

## Moderate and minor issues

Finding 1 above is the sole counted issue. The comment limitation described under question 5 does not change the measured parity result.

## Data flow

1. **OK:** Codex sends the fixture through the real SDK client and proxy, with SDK retry disabled (`providers/codex/codex-stream-parity.spec.ts:257`). OpenCode constructs a real proxy with the parameterized provider ID; only the upstream origin is redirected (`providers/opencode/opencode-translation-proxy.spec.ts:154`, `:35`).
2. **OK:** OpenCode uses `gpt-5.6-luna` (`providers/opencode/opencode-translation-proxy.spec.ts:438`). Both catalog entries select Responses (`libs/shared/src/lib/providers/entries/opencode-model-routes.ts:79`, `:139`), through the unchanged resolver (`providers/opencode/opencode-translation-proxy.ts:68`). Existing route tests assert exact Zen/Go Responses paths (`providers/opencode/opencode-translation-proxy.spec.ts:304`, `:307`, `:326`).
3. **OK:** Production translates, guards names, applies the capability choice, and serializes (`translation/translation-proxy-base.ts:554`, `:567`, `:791`).
4. **OK:** HTTP listeners retain received strings before parsing: Codex UTF-8 accumulation at `providers/codex/codex-stream-parity.spec.ts:237` and `:242`; OpenCode concatenated buffers at `providers/opencode/opencode-translation-proxy.spec.ts:261`. Raw assertions never compare reserialized captures.
5. **OK:** Retry checks require two captures and compare their raw strings (`providers/codex/codex-stream-parity.spec.ts:308`, `:314`; `providers/opencode/opencode-translation-proxy.spec.ts:537`, `:538`).
6. **GAP:** Full text-only equality uses a shared production oracle (finding 1).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Codex retry compares captured raw strings | COMPLETE | Spec:314 |
| Codex full text-only raw comparison | COMPLETE | Spec:338; oracle limitation tracked separately |
| Zen and Go full text-only comparisons | COMPLETE | OpenCode spec:491, :503 |
| Zen and Go retry comparisons | COMPLETE | OpenCode spec:518, :538 |
| Both OpenCode configurations actually use Responses | COMPLETE | Route catalog:79, :139; real resolver retained |
| Independently computed complete expected body | MISSING | Finding 1 |
| No production changes in the QA pass | PARTIAL verification | Reported at `.ptah/specs/TASK_2026_408/test-report.md:3`; no baseline comparison available under the no-git constraint |

The reported +3 tests agrees with one new Codex case and two single-provider cases expanded into two rows (`.ptah/specs/TASK_2026_408/test-report.md:42`). The prior count and exact uncommitted diff were not independently verified. No implicit production requirement is added by this review.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Field-order/whitespace changes between retry attempts | YES | Raw string equality, Codex spec:314 / OpenCode spec:538 | Equal deterministic reserialization is allowed |
| Shared translator field-order change | NO | Actual and expected change together | Finding 1 |
| Two OpenCode subscriptions | YES | Both `it.each` tables, OpenCode spec:491, :518 | Recovery is a test override |
| Client retries mask Codex proxy retry | YES | `maxRetries: 0`, Codex spec:260 | None for the scripted fixture |
| Fixture isolation and cleanup | YES | Codex spec:234, :273; OpenCode spec:176, :275 | No new persistent fixture state found |
| Arbitrary malformed/non-UTF-8 wire bytes | Not claimed | UTF-8 string captures | The requested contract explicitly accepts string comparisons |

## Verification

- Ran the installed local Jest binary once with the supplied auth-providers config, the two named suites, `--runInBand --no-cache`. **2 suites passed, 37 tests passed, exit 0; 37.638 seconds.** Output was tailed. An ES-module config warning did not prevent completion.
- Scoped `ptah_get_diagnostics` returned unavailable: none of the requested files are inside its workspace root. No independent clean diagnostics claim is made.
- No git commands, external network requests, source edits, or live-provider probes were performed. Only this deliverable was intentionally written. Production-change scope is an explicitly unverified constraint, not an invented finding.

## Verdict

- Recommendation: REJECT the final QA additions until finding 1 is corrected; no production fix is requested.
- Confidence: HIGH for assertion/oracle and provider-routing analysis; limited for change-scope verification without a baseline.
- Top risk: a green test run can conceal a shared translator regression in complete text-only wire bytes.
- What a robust implementation would add: independently authored complete wire expectations for Codex, Zen and Go; retain current real HTTP captures and raw retry comparisons.
