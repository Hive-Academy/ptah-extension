# Test report - TASK_2026_684_a11d live eval (U1)

Run by the user locally with their own Ollama Cloud key (no agent handled the key).

- Spec: `libs/backend/lane-routing/src/lib/decision-model/system-one.live.spec.ts`
- Command: `PTAH_LIVE_PROBES=1 OLLAMA_API_KEY=<key> npx jest -c libs/backend/lane-routing/jest.config.ts libs/backend/lane-routing/src/lib/decision-model/system-one.live.spec.ts --coverage=false --maxWorkers=2`
  (in PowerShell, set `$env:PTAH_LIVE_PROBES` and `$env:OLLAMA_API_KEY` first; the inline form
  skips every test there)

## Run 2 (final, updated spec) - PASS, 8/8 tests, 28.8 s

```text
DECISION_LIVE_MODEL clef:27b-cloud
DECISION_LIVE_MODEL_ID_FORMS {"clef:27b":true,"clef:27b-cloud":true}
DECISION_LIVE_PROBE_STATUSES {"route":400,"control":404}
DECISION_LIVE_LATENCY {"coldMs":1518,"p50Ms":665,"p95Ms":977,"probeMs":715}
```

## Run 1 (2026-10-17, earlier spec) - PASS, 7/7 tests, 28.9 s

```text
DECISION_LIVE_MODEL clef:27b-cloud
DECISION_LIVE_MODEL_ID_FORMS {"clef:27b":true,"clef:27b-cloud":true}
DECISION_LIVE_LATENCY {"coldMs":438,"p50Ms":644,"p95Ms":1124,"probeMs":551}
```

Run 1's `coldMs` was a warmed sample (the id-form test had already made 2 inference calls), and
the run did not assert A2 statuses. Run 2 supersedes both.

## Criteria

| Criterion | Result |
| --- | --- |
| 5.1 latency | first inference call 1518 ms (the suite's first call, recorded only when it succeeds; not proof the remote worker was cold), warm p50 665 ms, p95 977 ms, probe 715 ms |
| 5.2 / 5.3 remote timeout | p95 977 ms <= 3000 ms (margin 2023 ms) and cold 1518 ms <= 3000 ms (margin 1482 ms), so `DECISION_REQUEST_TIMEOUT_REMOTE_MS` stays 3000 |
| 6.10 hosted id | `POST https://ollama.com/v1/systemone` accepts both `clef:27b` and `clef:27b-cloud` |
| 6.4 / 6.5 / 6.7 | All fixtures correct in all 3 runs; confidence in [0,1]; probabilities valid; error mapping for auth, notFound (unknown model) and timeout pass |

## Assumptions (batches.md A1-A4)

| # | Result |
| --- | --- |
| A1 hosted id accepted | true |
| A2 keyed empty-body probe answers without inference | true: route 400, control 404 |
| A3 unknown model maps to `notFound` | true |
| A4 clef answers pass the `.strict()` schema | true |

Task 21.3 conditional fixes: not needed (A1, A2 and A4 all true).
