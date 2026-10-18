# Batch 40c report - P4 fix round: fixed decision-model row detail

Source: P4 visual review Moderate 1 ("Detail: fetch failed"), HANDOFF.md "Open problems".

## Files

- CREATED `libs/backend/lane-routing/src/lib/decision-model/decision-model.detail.ts` -
  `DECISION_MODEL_DETAIL` (fixed text per failure class) and `asLoggableError(error)` (the
  original `Error`, or an `Error` wrapping a non-Error throw).
- MODIFIED `libs/backend/lane-routing/src/lib/decision-model/decision-model.config.ts`
- MODIFIED `libs/backend/lane-routing/src/lib/decision-model/decision-model.config.spec.ts`

## Changed sites (decision-model.config.ts)

| Site | Before | After (detail) | Log |
| --- | --- | --- | --- |
| `jevStatus` catch, :393-404 | `credential store unavailable: ${errorMessage(error)}` | `The credential store could not be read.` | warn `[lane-routing] Jev credential lookup failed` `{ error: <original Error> }` |
| `structuredStatus` catch, :431-442 | `errorMessage(error)` | `The provider readiness check failed.` | warn `[lane-routing] structured provider readiness failed` `{ providerId, error: <original Error> }` |
| `send` (probe) catch, :580-596, signal aborted | `probe timed out after N ms` | `The request timed out.` | warn `[lane-routing] decision model probe request failed` `{ method, timedOut: true, timeoutMs, error }` |
| `send` (probe) catch, not aborted | `errorMessage(error)` (e.g. `fetch failed`) | `The model endpoint could not be reached.` | same warn, `timedOut: false` |

Classification is by `signal.aborted` (its only source is the probe budget), never by message
substring, as `system-one.client.ts` `classifyTransportFailure` does. The probe URL is not
logged: an Ollama base URL can carry userinfo credentials. No API key reaches these logs (the
probe runs only for Ollama; the Jev path logs only the secret-store error, never the key).

The `send` detail flows into `checkVersion`/`discriminate` (`decision-model.probe.ts`), so the
version-check failure, the route failure and the composed control-failure detail
(`... control request failed: The model endpoint could not be reached.)`) now carry only fixed
text. `decision-model.probe.ts` itself was not changed.

Not changed: `persistMark` (:~655) still logs `errorMessage(error)`; it is a log line only, never
a row detail, and its existing spec pins `{ error: 'disk full' }`.

## Spec cases (decision-model.config.spec.ts)

Updated:
- `route network error is not route evidence` (it.each, :281-290) - detail now
  `The model endpoint could not be reached.` (was `fetch failed`).
- `control request failing while the route answered 404` (:249-266) - detail contains
  `control request failed: The model endpoint could not be reached.` and not `fetch failed`.
- `the shared budget expiring` (:341-371) - detail `The request timed out.`, not `aborted`;
  warn receives `{ timedOut: true, error: <Error> }`.

Added (describe `DecisionModelConfig row detail never carries a raw error`, :373+):
- `a TypeError('fetch failed') shows fixed text; the logger gets the original error` - fetch
  throws one `TypeError('fetch failed')` instance; the row is `unreachable` with
  `The model endpoint could not be reached.`, the detail does not contain `fetch failed`, the
  warn meta holds the same instance (`error: thrown`, `timedOut: false`), and the logged calls
  contain neither the host nor the userinfo of the base URL `http://user:pw@127.0.0.1:1`.
- `a non-Error rejection is logged as an Error and not shown` - a thrown string is logged as
  `new Error('socket hang up')`; the row shows the fixed text.
- `a Jev credential lookup failure ...` - `secrets.get` rejects; detail
  `The credential store could not be read.`, warn receives `{ error: thrown }`.
- `a structured readiness failure ...` - `isReady` rejects; detail
  `The provider readiness check failed.`, warn receives `{ providerId: 'ollama', error: thrown }`.

## Verification

- `ptah_get_diagnostics` on the three files: 0 errors, 0 warnings.
- Jest, Nx, tsc and lint were not run (batch rule: the orchestrator runs all checks).

## Out-of-scope observations

- An unsupported mark persisted by an older build under `ptah.decisionModel.unsupported.v1` can
  still hold a raw detail (e.g. `... control request failed: fetch failed)`); it is shown until
  the mark is cleared or rewritten. Not migrated here.
- `checkVersion` echoes the server-reported version string (`Ollama <version> < 0.35.0`); it is
  schema-checked as a non-empty string only, not length-capped (`decision-model.probe.ts`).
