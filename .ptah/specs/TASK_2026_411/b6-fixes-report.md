# B6 review fixes report

Verdict: **PASS - every B6 review finding is fixed and regression-covered.**

## Finding resolution

| Finding | Status | Production change | Regression evidence |
|---|---|---|---|
| SSE malformed usage recorded as success | Fixed | `responses-stream-translator.ts:168` exposes terminal state and signals translation failure; `translation-proxy-base.ts:795,901` records `invalid-response` without changing the client SSE error frame. | `translation-proxy-base.spec.ts:582` covers malformed SSE and exactly-one safe record; `codex-stream-parity.spec.ts:163` asserts `invalid-response` through the real SDK consumer. |
| Forced-stream malformed usage lost timing | Fixed | `responses-stream-collector.ts:6,175` wraps validation failures as `ResponsesStreamError('invalid_response')`; `translation-proxy-base.ts:813,817` guarantees an `invalid-response` finalizer and preserves the existing 502 response. | `translation-proxy-base.spec.ts:648` asserts 502, one timing record, status, and redaction. |
| `overlapCount` always zero | Fixed | Per-proxy live counter at `translation-proxy-base.ts:103,630-637`; overlap is other attempts in flight at start, and the idempotent finalizer decrements once. Existing `compactionCorrelation: 'inexact'` remains explicit. | `translation-proxy-base.spec.ts:761` overlaps two real loopback requests and asserts counts `[0,1]`, two records, and two successes. |
| Pre-write disconnect missing cancellation timing | Fixed | `translation-proxy-base.ts:857` finalizes `cancelled` before destroying the upstream request; the ordinary mid-stream close remains at line 850. | `translation-proxy-base.spec.ts:711` proves pre-write cancellation; line 735 proves mid-stream cancellation; each asserts exactly one record. |
| Insufficient timing coverage | Fixed | Added an overridable test-only timeout seam whose production default is still exactly `600_000` (`translation-proxy-base.ts:145,678`) and added terminal-state propagation for early EOF. | `translation-proxy-base.spec.ts:582-779` covers stream success, missing usage, malformed SSE, forced-stream malformed usage, early EOF, rate limit, timeout, network error, both cancellations, overlap, exactly-once records, and payload redaction. |

## B6 files

- `libs/backend/auth-providers/src/lib/translation/index.ts`
- `libs/backend/auth-providers/src/lib/translation/responses-stream-collector.ts`
- `libs/backend/auth-providers/src/lib/translation/responses-stream-translator.ts`
- `libs/backend/auth-providers/src/lib/translation/translation-proxy-base.ts`
- `libs/backend/auth-providers/src/lib/translation/translation-proxy-base.spec.ts`
- `libs/backend/auth-providers/src/lib/providers/codex/codex-stream-parity.spec.ts` (**also listed in B7**, where only its auth-service mock contract changed)
- `.ptah/specs/TASK_2026_411/b6-code-logic-review.md`
- `.ptah/specs/TASK_2026_411/b6-report.md`
- `.ptah/specs/TASK_2026_411/b6-fixes-report.md`

No B7 production file was changed for these review fixes.

## Focused verification

- `translation-proxy-base.spec.ts`: 1 suite / **31 tests passed**.
- `responses-stream-translator.spec.ts`: 1 suite / **30 tests passed**.
- `responses-stream-collector.spec.ts`: 1 suite / **31 tests passed**.
- `codex-stream-parity.spec.ts`: 1 suite / **6 tests passed**.

The parity spec continues to assert request model and system instructions. The base timing spec asserts the production timeout default is `600_000`; request translation was not changed.

## Aggregate gates

- `npx nx run-many -t test -p @ptah-extension/auth-providers @ptah-extension/agent-sdk`: Nx header confirmed **2 projects**. Auth-providers: 40 suites / **730 tests passed**. Agent-sdk: 87 suites / **1,521 tests passed**; 1 suite / 2 tests skipped. Command passed.
- `npx nx run-many -t typecheck -p @ptah-extension/auth-providers @ptah-extension/agent-sdk @ptah-extension/rpc-handlers`: Nx header confirmed **3 projects**. Command passed for all three.

All HTTP/SSE coverage used unauthenticated loopback fake servers. Timing-record assertions reject credential, body, prompt, tool, header-value, and malformed upstream payload fragments.

## Residual fix (re-review)

Finding: **Fixed** — forced-stream terminal content/validation failures no longer bypass the existing `ResponsesStreamError('invalid_response')` 502 path.

- Production change: `responses-stream-collector.ts:179-209` now separates upstream EOF parsing/translation from the injected usage observer. Incomplete frames, malformed terminal content, and translation failures are normalized to `ResponsesStreamError('invalid_response')`; the existing `upstream_incomplete` classification is preserved. Observer/programming failures remain ordinary errors rather than being misclassified as upstream payload failures.
- Collector regressions: `responses-stream-collector.spec.ts:89-124` now requires `invalid_response` for completed calls with omitted, non-string, or malformed arguments and for empty refusal content, while retaining `upstream_incomplete` for incomplete tool input.
- Proxy regression: `translation-proxy-base.spec.ts:670-705` covers malformed function arguments, a wrong content shape, and an invalid JSON SSE frame on the forced-stream path. Every case asserts HTTP 502, an `invalid_response` error body, exactly one timing record with status `invalid-response`, and absence of credential, prompt, tool, header, and malformed payload fragments from the record.
- B6 file-list addition: `libs/backend/auth-providers/src/lib/translation/responses-stream-collector.spec.ts`. No B7 file was changed.

Focused verification:

- `npx nx test @ptah-extension/auth-providers --testPathPatterns=responses-stream-collector.spec.ts --runInBand`: 1 suite / **33 tests passed**.
- `npx nx test @ptah-extension/auth-providers --testPathPatterns=translation-proxy-base.spec.ts --runInBand`: 1 suite / **34 tests passed**.

Aggregate gates:

- `npx nx run-many -t test -p @ptah-extension/auth-providers @ptah-extension/agent-sdk`: Nx header confirmed **2 projects**. Auth-providers: 40 suites / **743 tests passed**. Agent-sdk: 87 suites / **1,521 tests passed**; 1 suite / 2 tests skipped. Command passed. Jest emitted its existing worker-force-exit teardown warning for auth-providers, but reported no failed suite or test.
- `npx nx run-many -t typecheck -p @ptah-extension/auth-providers @ptah-extension/agent-sdk @ptah-extension/rpc-handlers`: Nx header confirmed **3 projects**. All three typechecks passed.
- `git diff --check -- libs/backend/auth-providers/src/lib/translation`: passed.

The production upstream timeout remains exactly `600_000` ms (`translation-proxy-base.ts:146`). This residual change does not touch request construction, the request model, or system-instruction translation; those request-shape pins remain unchanged.
