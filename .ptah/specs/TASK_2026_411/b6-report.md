# B6 report — Codex stream usage parity and proxy timing

Verdict: **PASS**.

The logic-review findings were resolved before handoff: malformed stream/JSON translation now records `invalid-response`, pre-write disconnect records `cancelled`, and `overlapCount` is computed from live in-flight attempts rather than fixed at zero.

## PR #490 audit

| B6 instruction | Classification | Evidence |
|---|---|---|
| Share one uncached/cache/output mapper across stream and non-stream paths | ALREADY DONE | `translation-proxy-helpers.ts:25` defines `translateResponsesUsage`; it is consumed by the collector (`responses-stream-collector.ts:188`), stream translator (`responses-stream-translator.ts:458`), and ordinary JSON translation. Existing tests are `responses-stream-collector.spec.ts:39`, `responses-stream-translator.spec.ts:68`, and `translation-proxy-base.spec.ts` Responses JSON cases. |
| Emit complete terminal usage on `message_delta` without widening stream-event types | ALREADY DONE | `responses-stream-translator.ts:510` emits the mapper result. `responses-stream-translator.spec.ts:107` uses the installed Anthropic SDK accumulator; `agent-sdk` coverage at `stream-transformer.spec.ts:637` proves the existing consumer handles terminal delta input/cache fields. No production transformer typing was changed in B6. |
| Metadata-only phase timing with fake clocks and correlation labels | TO DO — COMPLETED | Added `ProxyPhaseTimingRecord` at `translation-proxy-base.ts:64`, attempt instrumentation, exact request/inexact compaction labels, byte and terminal-token counters, and a fake-clock/redaction spec at `translation-proxy-base.spec.ts:331`. Records contain no body, header, credential, prompt, or tool payload. The upstream timeout remains exactly `600_000` ms. |
| Real-consumer integration matrix | TO DO — COMPLETED | Added `codex-stream-parity.spec.ts:67`: fake Responses HTTP/SSE → `CodexTranslationProxy` → real `@anthropic-ai/sdk` stream consumer → `SdkMessageTransformer` usage tracker. It covers cached, uncached, tool, split frames, duplicate terminal plus `[DONE]`, missing usage, malformed usage, and early EOF. It also pins model and system-instruction forwarding. |

## Files changed for B6

- `libs/backend/auth-providers/src/lib/translation/index.ts`
- `libs/backend/auth-providers/src/lib/translation/responses-stream-collector.ts`
- `libs/backend/auth-providers/src/lib/translation/responses-stream-translator.ts`
- `libs/backend/auth-providers/src/lib/translation/translation-proxy-base.ts`
- `libs/backend/auth-providers/src/lib/translation/translation-proxy-base.spec.ts`
- `libs/backend/auth-providers/src/lib/providers/codex/codex-stream-parity.spec.ts` (new)
- `.ptah/specs/TASK_2026_411/b6-report.md` (this report)

The collector and translator production edits only expose already-mapped terminal usage to the timing recorder; their wire output is unchanged.

## Tests added

- Six real-consumer parity cases in `codex-stream-parity.spec.ts`.
- One fake-clock phase-timing/redaction case in `translation-proxy-base.spec.ts`.

## Gate results

Focused commands (one auth-providers project each):

- `codex-stream-parity.spec.ts`: 1 suite, 6 tests passed.
- `translation-proxy-base.spec.ts`: 1 suite, 31 tests passed after the review regressions were added.
- `responses-stream-translator.spec.ts`: 1 suite, 30 tests passed.
- `responses-stream-collector.spec.ts`: 1 suite, 31 tests passed.

Aggregate commands:

- `npx nx run-many -t test -p @ptah-extension/auth-providers @ptah-extension/agent-sdk`: final Nx header confirmed **2 projects**. Auth-providers: 40 suites / 730 tests passed. Agent-sdk: 87 suites / 1,521 tests passed; 1 suite / 2 tests skipped. Command passed.
- `npx nx run-many -t typecheck -p @ptah-extension/auth-providers @ptah-extension/agent-sdk`: Nx header confirmed **2 projects**. Command passed for both projects.

An initial aggregate-test invocation reached the five-minute shell timeout before Nx flushed output; the exact command was rerun with a longer shell allowance and passed as reported above.
