# Test report - TASK_2026_684_a11d live eval (U1)

Run by the user locally on 2026-10-17 with their own Ollama Cloud key (no agent handled the key).

- Spec: `libs/backend/lane-routing/src/lib/decision-model/system-one.live.spec.ts`
- Command: `PTAH_LIVE_PROBES=1 OLLAMA_API_KEY=<key> npx jest -c libs/backend/lane-routing/jest.config.ts libs/backend/lane-routing/src/lib/decision-model/system-one.live.spec.ts --coverage=false --maxWorkers=2`
- Result: PASS, 7/7 tests, 28.9 s

## Printed lines

```text
DECISION_LIVE_MODEL clef:27b-cloud
DECISION_LIVE_MODEL_ID_FORMS {"clef:27b":true,"clef:27b-cloud":true}
DECISION_LIVE_LATENCY {"coldMs":438,"p50Ms":644,"p95Ms":1124,"probeMs":551}
```

## Criteria

| Criterion | Result |
| --- | --- |
| 5.1 latency | first run: 438 ms (a warmed sample, not cold: the id-form test had already made 2 inference calls), warm p50 644 ms, p95 1124 ms, probe 551 ms. The cold sample (the suite's first inference call, recorded only when it succeeds; not proof the remote worker was cold) is pending one user re-run of the updated spec |
| 5.2 / 5.3 remote timeout | Provisional: p95 1124 ms <= 3000 ms (margin 1876 ms), so `DECISION_REQUEST_TIMEOUT_REMOTE_MS` stays 3000. The cold half of the rule is pending the re-run |
| 6.10 hosted id | `POST https://ollama.com/v1/systemone` accepts both `clef:27b` and `clef:27b-cloud` |
| 6.4 / 6.5 / 6.7 | All fixtures correct in all 3 runs; confidence in [0,1]; probabilities valid; error mapping for auth, notFound (unknown model) and timeout pass |

## Assumptions (batches.md A1-A4)

| # | Result |
| --- | --- |
| A1 hosted id accepted | true |
| A2 keyed empty-body probe answers without inference | pending re-run (the first run asserted only `ready`; the updated spec prints `DECISION_LIVE_PROBE_STATUSES` and asserts route 400/422, control 404) |
| A3 unknown model maps to `notFound` | true |
| A4 clef answers pass the `.strict()` schema | true |

Task 21.3 conditional fixes: not needed for A1/A3/A4; A2 pending.

Pending: one user re-run of the updated spec to record the cold sample (`coldMs` now times the suite's first inference call, only when it succeeds; not proof the remote worker was cold) and the A2 raw statuses.
