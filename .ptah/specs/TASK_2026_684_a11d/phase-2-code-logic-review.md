# Phase 2 code logic review — Batches 6–10

**Round-1 result: 6/10. Verdict: REVISE.** The original findings and the round-1 fix assessment are recorded below; the current verdict is in “Re-review round 1.”

**Review family: codex (implementer: Claude).** Scope: the Phase 2 source and specs, their callers, the task context and plan, and the five named commits. No tests, builds, lint, or diagnostics were run under the review's no-heavy-command rule.

## Review point 1 — Batch 6 Cloud override

**Verdict: fix required.** `decision-model.target.ts:210-220` only trims the override, while `decision-endpoint.url.ts:73-103` would reject userinfo, query and fragment. `keyTransportAllowed` checks the parsed scheme or loopback host, but does not make the base URL suitable for path joining (`decision-endpoint.url.ts:132-143`). A keyed HTTPS override with a query or fragment passes resolution. The client then appends `/v1/systemone` inside that query or fragment (`system-one.client.ts:127-141`), so the call hits the wrong path with the Cloud key in its Authorization header. A userinfo URL is likely rejected by Node fetch before transmission; `originOf` and the client debug entry omit userinfo (`system-one.client.ts:143-149`). I found no direct path that copies the stored Cloud key into the URL or sends it to a different origin solely because of userinfo, query or fragment. Nevertheless, a secret pasted into the override URL can be logged and persisted as an unsupported mark (`decision-model.config.ts:324-338`); the override must be parsed or refused before use.

## Review point 2 — Batch 8 prober and transport

**Verdict: correct on ordinary HTTP responses; incomplete on failure text.** The route's 401/403 becomes fixed `keyRequired` or `keyRefused` text (`decision-model.prober.ts:109-116`); a keyed non-loopback HTTP URL returns fixed `keyNeedsHttps` before fetch (`:75-86`); the client logs only `originOf(url)` (`system-one.client.ts:143-149`), and its transport error logs only an error name (`:213-243`). Probe errors containing a URL are replaced with `<url>` (`decision-model.prober.ts:55-56,130-147`). That replacement leaves any credential echoed outside a URL untouched, as defect 1 explains. In the reviewed resolver and prober path, keyed plain HTTP to a non-loopback host is blocked; this does not prove the behavior of an arbitrary injected fetch or redirects outside these checks.

## Review point 3 — Batch 9 status, 404 recheck, RPC

**Verdict: base-URL comparison and awaits are present, but key and selection races remain.** `isMarkedUnsupported()` awaits `currentProbeKey()` (`decision-model.config.ts:292-294`), its production method has no unawaited caller in the searched backend code, and the 404 recheck compares the newly resolved base with the failed call's base before probing (`:378-386`). Mark writes are serialized and revalidate the current key (`:314-339,635-642`). The RPC fallback uses `selection.kind !== 'structured'` only after handling `unset` separately (`agent-rpc.handlers.ts:564-571,583-591`), so its effective `reportsConfidence` rule agrees with `dto()` (`decision-model.config.ts:716-731,773-784`). The mark/recheck key omits credential identity, and a same-base selection change is not tied to the failed call; see defects 3 and 4.

## Review point 4 — Batch 10 specs

**Verdict: useful happy-path pins, incomplete boundary pins.** The table tests assert the actual route/control URLs, methods, empty bodies, headers and 401/403 details (`decision-model.config.endpoint.spec.ts:290-359`), and the sentinel test verifies both its presence in Authorization and absence from ordinary DTOs, logs and persisted values (`:735-869`). The fresh-config tests assert the stored-key indicator (`:905-977`), and the schema spec asserts model and base URL issue paths (`decision-model.types.spec.ts:149-204`). They do not pin the claimed universal secret guarantee: the prober's only throwing fake embeds userinfo in a URL (`decision-model.prober.spec.ts:49-53,318-337`), while the status sentinel cases use a generic `fetch failed` error (`decision-model.config.endpoint.spec.ts:98-101,735-856`). They also do not cover malformed Cloud overrides, key rotation during or between rechecks, or a selection change at the same base during a 404 recheck. `decision-model.config.endpoint.spec.ts:309-320` proves only that a missing version route is skipped; its fake server has no version request, so this duplicates the URL assertion at `:300-305` rather than testing a distinct failure mode. Existing specs therefore do not establish those claims.

## Defects

1. **MAJOR — A rejected probe can put a stored key in logs.** `libs/backend/lane-routing/src/lib/decision-model/decision-model.prober.ts:130-141`; `libs/backend/lane-routing/src/lib/decision-model/decision-model.config.ts:440-452`. If fetch or response-body reading rejects with text such as `Authorization: Bearer <key>`, the URL-only replacement preserves the key and `logger.warn` receives it. The new key-read catch likewise logs an arbitrary exception message. A dependency may echo a header or secret in its error, and criterion 1.6 says no key may appear in logs. Log an error type and timeout flag only, as `SystemOneClient.classifyTransportFailure` does; keep a fixed row detail. Add a sentinel error-message case that echoes the key without a URL.

2. **MAJOR — A Cloud override with query, fragment or userinfo is accepted as a base URL.** `libs/backend/lane-routing/src/lib/decision-model/decision-model.target.ts:210-220`; `libs/backend/lane-routing/src/lib/decision-model/decision-endpoint.url.ts:140-143`; `libs/backend/lane-routing/src/lib/decision-model/decision-model.config.ts:324-338`. For `https://gateway.example/gw?token=secret`, path joining produces a query rather than `/gw/v1/systemone`; with a key, the Authorization header still goes to the configured host. If the probe returns unsupported, the raw base URL including `token=secret` is logged and stored in the mark. A userinfo override can instead fail at fetch and appear as `unreachable`, obscuring the invalid setting. Run the override through `parseEndpointBaseUrl`; refuse invalid configured values with a fixed detail rather than silently using a malformed URL. Cover the three disallowed components and verify no URL secret enters logs or marks.

3. **MAJOR — Recheck evidence survives a key change at the same base.** `libs/backend/lane-routing/src/lib/decision-model/decision-model.config.ts:273-275,382-393,571-600,742-769`; `libs/backend/lane-routing/src/lib/decision-model/decision-model.probe.ts:166-171`. The probe/mark key contains selection and base URL but no credential generation. If key A produces a 404 and its recheck is cached, replacing it with key B within 60 seconds can reuse A's result. An in-flight probe under A can also finish after B is stored and pass `currentProbeKey()`, because the base is unchanged. It can mark B's endpoint unsupported, or display A's auth failure for B. Bind a probe to a nonsecret key fingerprint or generation and invalidate the cache and stale result when the effective key changes. Test rotation during an in-flight probe and inside the 60-second window.

4. **MINOR — A late 404 can attach its failure to a newly selected model at the same base.** `libs/backend/lane-routing/src/lib/decision-model/decision-model.config.ts:356-393,553-559`. `recheckAfterLiveNotFound` receives the failed base and detail, but reads the current selection after the live call. If the user switches models at that base before a 404 returns, a ready recheck stores `last call failed: http 404` under the new selection's key. The row then describes a call that the new model never made. Pass the failed call's selection or request identity to the recheck and discard or separate stale details when it differs.

5. **MINOR — The new specs do not pin the failure paths their security comment claims.** `libs/backend/lane-routing/src/lib/decision-model/decision-model.prober.spec.ts:49-53,318-337`; `libs/backend/lane-routing/src/lib/decision-model/decision-model.config.endpoint.spec.ts:735-856`. The prober fake only echoes a URL, and the sentinel table never makes a dependency echo the key. Both pass while defect 1 remains. Add failure-message, malformed-override and key-rotation cases that assert the log, persisted mark, row and request URL together.

## Five logic questions

1. **Silent success:** A cached or in-flight recheck from key A can be treated as current evidence for key B because the key omits credential identity (`decision-model.config.ts:571-600,742-769`); a status row may say ready or unsupported on stale evidence.
2. **Unexpected user action:** Entering a Cloud override with `?` or `#` sends the keyed request to an unintended path (`decision-model.target.ts:210-220`; `decision-endpoint.url.ts:140-143`). Switching models during a 404 can show the former model's failure on the new row (`decision-model.config.ts:356-393,553-559`).
3. **Wrong input answer:** A URL with userinfo, query or fragment passes the override reader and may be reported as endpoint unreachable rather than invalid (`decision-model.target.ts:210-220`; `decision-model.prober.ts:68-73,120-147`).
4. **Dependency failure or bad shape:** A rejecting probe logs untrusted exception text after masking only URLs, so an echoed key outside a URL reaches the logger (`decision-model.prober.ts:130-141`). A 401/403 HTTP response itself uses fixed detail (`:109-116`).
5. **Missing requirement detail:** The task does not define whether rotating a key at the same origin invalidates unsupported marks and 60-second recheck evidence. The per-call key-read requirement and current cache behavior make invalidation necessary (`decision-model.target.ts:169-189`; `decision-model.config.ts:571-600`).

## Verification limits and decision

Read-only inspection covered the full target, prober, URL parser and client paths, the status implementation, relevant pipeline/classifier/RPC consumers, and the Phase 2 specs. The requested no-heavy-command rule prevented a runtime check; no `ptah_get_diagnostics` or test result is represented as new verification. The existing Batch 10 fake fetch does not model redirects, so redirect behavior remains unverified (`decision-model.config.endpoint.spec.ts:87-107`).

**Decision:** Treat malformed Cloud overrides as configuration errors rather than falling back to the direct host. Options were refusal or fallback; refusal follows the custom base URL parser's fixed-error convention (`decision-endpoint.url.ts:73-119`), prevents a configured host from being silently replaced, and is reversible.

## Revise round 1 fixes

1. **Untrusted error text in logs.** `decision-model.prober.ts:130-147` now logs `{ method, timedOut, timeoutMs, errorName }`: the name only, as `classifyTransportFailure` does. The old URL mask is gone. The row detail stays fixed text. The key-read catch (`decision-model.config.ts:460-468`) and the Jev, structured and mark-persist catches now log `errorName` (`errorName()` is in `decision-model.probe.ts:178`). Tests: prober spec `a rejection that echoes the key without a URL logs only the error name (review defect 1)` and `a body read that rejects with the key logs only the error name`. Endpoint spec `review round 1 > defect 1`, both cases: fetch echoes `Authorization`, and the key store echoes the key.
2. **Invalid Ollama Cloud override.** `ollamaCloudOverride` (`decision-model.target.ts:233-254`) runs the value through `parseEndpointBaseUrl`. A refused value blocks the selection before any key is read: `BlockedDecisionEndpoint.reason = 'invalid-base-url'`, with the fixed detail `DECISION_MODEL_DETAIL.invalidCloudBaseUrl`. The config shows it as `unreachable` (`decision-model.config.ts:519-531`). The malformed URL is never requested, logged or marked. Tests: target spec `an override refused by the base URL policy (review defect 2)`, covering userinfo, query, fragment and no scheme, with and without a key. Endpoint spec `defect 2`: the userinfo, query and fragment cases each assert no request, no mark, no update, and that no `url-secret` or key appears in logs, storage or rows.
3. **Key rotation and stale evidence.** `ProbeIdentity` (`decision-model.config.ts:82`) adds a non-secret key fingerprint to the target key. The fingerprint is an HMAC-SHA256 under a random per-instance salt (`credentialFingerprint`, `:874`). It is never persisted or logged. `applyProbe`, `markUnsupported` (`:348`, which now takes the probed base URL and key) and `currentRowWithoutProbe` all compare the full identity. `coalescedRecheck` (`:647`) drops a cached result from another key, and in-flight probes are keyed by identity. A mark written this session is bound to its key (`markMatches`, `:712`). A mark loaded from storage matches any key until a probe replaces it or clears it. Tests: endpoint spec `defect 3 > a probe in flight under key A cannot mark the endpoint for key B` and `a key change inside the 60 s window re-checks with the new key`.
4. **Late 404 on a new selection.** `recheckAfterLiveNotFound(failed: DecisionLiveCall, liveDetail)` (`decision-model.config.ts:403-414`) receives the failed call's selection and base URL. When the current selection differs, nothing is recorded, probed or marked. The caller passes `caller.selection` (`route-decide.service.ts:294`; `OpenedCaller` gained `selection` in `pipeline/phase-plan.ts:62`). Test: endpoint spec `defect 4 > a 404 for model laya-1 is dropped after a switch to laya-2 at the same base`.
5. **Spec coverage.** The new cases assert together the request URL and Authorization, the log text (`loggedText`), the persisted mark or its absence (`persistedText`, storage entries) and the row. Existing log assertions now expect `errorName` instead of the message.

Verification: `nx test @ptah-extension/lane-routing` passed 24/24 suites and 701/701 tests. `nx typecheck` and `nx lint` passed. The degradation audit TOTAL is 294.

## Re-review round 1

**Score: 6/10. Verdict: REVISE.** The Cloud override is now refused before a key read and in-session key rotation is isolated by an HMAC fingerprint. The fix still permits a credential to enter logs through an error name, and a mark loaded after restart can report unsupported for a different key. Those are material correctness and secrecy gaps, keeping the score below the sound 7–8 band. The resolver and recheck guards keep it above the 3–4 band. Review family: codex (implementer: Claude).

### Status of the five original defects

1. **Fixed for the original error-message path.** The prober and key-read catches log `errorName` instead of `message` (`decision-model.prober.ts:130-143`; `decision-model.config.ts:461-470,502-515`). A new name-based leak remains, defect R1-1 below.
2. **Fixed.** The Cloud override passes `parseEndpointBaseUrl`; a refused value yields `invalid-base-url` before `readOllamaCloudKey` (`decision-model.target.ts:180-189,242-253`). The status becomes fixed-text `unreachable` and no URL is logged (`decision-model.config.ts:518-529`).
3. **Fixed for marks and rechecks made in this instance; not fixed across restart.** The random salt and HMAC fingerprint are memory-only (`decision-model.config.ts:145-150,858-880`); `applyProbe`, mark writes, and the 60-second cache compare that fingerprint (`:591-608,348-381,647-683`). A reloaded mark has no credential binding (`:181,712-718`), as defect R1-2 explains.
4. **Fixed for a 404 belonging to an earlier selection.** The caller passes its selection and base URL (`route-decide.service.ts:287-296`), and the recheck returns before probing if the selection changed (`decision-model.config.ts:403-414`). A separate snapshot race remains, defect R1-3 below.
5. **Fixed for the original five paths.** The added specs assert echoed messages, malformed Cloud overrides, in-flight key rotation, cached rechecks, and a late 404 (`decision-model.config.endpoint.spec.ts:1060-1305`). They do not cover hostile error *names*, restart followed by key rotation, or selection changing while target resolution awaits; those omissions correspond to R1-1 through R1-3. The stated 701 passing tests are implementer evidence; this read-only re-review did not rerun them.

### New defects

1. **R1-1 — MAJOR — A dependency can still place a key in logs through `Error.name`.** `libs/backend/lane-routing/src/lib/decision-model/decision-model.probe.ts:178-181`; `libs/backend/lane-routing/src/lib/decision-model/decision-model.prober.ts:130-143`; `libs/backend/lane-routing/src/lib/decision-model/decision-model.config.ts:461-465,502-507,734-740`. The replacement helper returns the exception's mutable `name` verbatim. A fetch, body reader, key store, or storage adapter that rejects with an `Error` whose `name` is `Authorization: Bearer <key>` makes the logger receive the key. The new tests use ordinary `Error` objects with `name === 'Error'` (`decision-model.config.endpoint.spec.ts:1068-1097,1102-1119`), so they do not pin this case. Use an allowlist of fixed built-in names or a fixed `DependencyError` label; test a secret-bearing `name` and a throwing `name` getter.
2. **R1-2 — MAJOR — A persisted unsupported mark is accepted under a new key after restart.** `libs/backend/lane-routing/src/lib/decision-model/decision-model.config.ts:145-150,181,327-328,603-613,711-718`. The random salt is intentionally not persisted, and a loaded mark has `markCredential === null`; `markMatches` then accepts any credential. If key A is marked, the process restarts, and key B is installed at the same custom base, `isMarkedUnsupported()` returns true before a probe. A normal `getStatus()` does probe, but if B is also unsupported, `applyProbe` skips replacing the old mark and returns its old detail; if B is unreachable, the old mark stays available to `isMarkedUnsupported()` and no probe clears it (`:599-638`). Treat loaded marks as unverified until a probe with the current key establishes the result, and replace the mark/detail on that probe. Pin restart plus key rotation for ready, unsupported, and unreachable outcomes.
3. **R1-3 — MINOR — Target resolution can pair a stale selection with a new endpoint.** `libs/backend/lane-routing/src/lib/route-decide.service.ts:331-359`; `libs/backend/lane-routing/src/lib/decision-model/decision-model.config.ts:242-247`. `openCaller` captures selection A, then awaits `resolveSystemOneTarget`, which reads the selection again. If settings change to B before that read, the returned caller carries A but calls B's target and derives the provider from A. A B 404 is then dropped by the new selection guard (`decision-model.config.ts:407-414`), and routing metadata can describe the wrong provider. Resolve the target from the captured selection, or return the selection and target from one atomic resolver result; add a deferred-key-read test that changes selection during `openCaller`.

### Five logic questions and limits

1. **Silent failure:** A reloaded mark matches any key, so `isMarkedUnsupported()` can report a success-looking unsupported determination without evidence for the current credential (`decision-model.config.ts:327-328,712-718`).
2. **User action:** Rotating the key after restart can retain the prior key's mark and detail (`decision-model.config.ts:181,603-613`). Switching selections during a key read can pair the earlier selection with the later endpoint (`route-decide.service.ts:331-359`).
3. **Wrong-answer input:** A dependency-controlled error name containing a key is copied to logs (`decision-model.probe.ts:178-181`); an old persisted mark at the same base is treated as matching the new key (`decision-model.config.ts:712-718`).
4. **Dependency failure:** A rejected fetch or secret read with a hostile `Error.name` leaks that name; ordinary rejected messages are now excluded (`decision-model.prober.ts:130-143`; `decision-model.config.ts:502-515`).
5. **Missing requirement detail:** The persisted mark format has no credential identity, so restart semantics for a rotated key need an explicit unverified state (`decision-model.config.ts:123-127,145-150,712-718`).

Read-only review covered the fix commit, the status and resolver flows, changed caller signatures, and targeted specs. Scoped `ptah_get_diagnostics` reported zero TypeScript errors; no Nx, Jest, build, lint, or git mutation was run. The runtime ordering of the new races remains untested here.

## Decisions

- **Loaded mark is unverified until reprobed.** Options: trust it for every key, persist a stable key fingerprint, or keep the memory-only salt and require a fresh probe. The last option preserves the deliberate no-persisted-fingerprint design and follows the per-key evidence rule (`decision-model.config.ts:145-150,712-718`); it is reversible.

## Revise round 2 fixes

1. **R1-1: an error name that carries a key.**
   - Fix: `errorName()` moved to `decision-model.detail.ts:64`. It returns a fixed `LoggableErrorName`. Only `AbortError`, `TimeoutError`, `TypeError`, `SyntaxError`, `RangeError` and `Error` pass the allowlist (`:48`). Any other name, a non-`Error` rejection, a non-string name and a `name` getter that throws (`readName`, `:76`) all read `'other'`. The old helper and the unused `errorMessage` were removed from `decision-model.probe.ts`.
   - Every caller now uses the allowlist: catalog `:161,415`, prober `:137`, config `:470,512,571,699,745` (the mark-read catch at `:699` used `error.name` directly and now logs `errorName`).
   - The same leak was also in the row detail and in the service logs. `system-one.client.ts:225` copied `error.name` into the `transport error (...)` detail and its log. `route-decide.service.ts:467` (`errorFacts`) logged the key store's `name` and any `code`. That function now logs the fixed name and keeps a `code` only when it has the Node shape (`NODE_ERROR_CODE`, `:459`).
   - Tests:
     - `decision-model.detail.spec.ts` covers the allowlist, a sentinel key in `name`, a throwing getter, a non-string name and non-`Error` rejections.
     - The prober spec (`:386,418`), the catalog spec (`:291,310`) and the client spec (`:537`) each use a hostile `name`.
     - Endpoint spec `round 2, R1-1` (`:1308`) covers fetch, key store, throwing getter, mark write and mark read.
     - Gate spec (`:913`) covers a hostile `name` and `code` from the key store, plus a kept `EACCES`.
2. **R1-2: a restored mark matched any key.**
   - Fix: the reviewer's decision is implemented. `markMatches` requires a non-null credential binding (`decision-model.config.ts:721`). A restored mark gets its binding from `loadedMarkCredential` (`:898`, set at `:179`).
   - For the key-capable kinds `ollama-cloud` and `custom`, a restored mark is unverified (`null`). It matches no key, so `isMarkedUnsupported()` is false and the row is not `unsupported-endpoint` until a probe under the current key runs. That probe replaces the mark and its detail (unsupported) or clears it (ready). An unreachable probe leaves it unusable.
   - A local `ollama` mark is bound to `''`, the only credential that kind can carry: `resolveDecisionEndpoint` never gives it a key. This keeps the existing restart requirement test `(b) live route missing → mark persisted and still present after a restart`.
   - No fingerprint, and no other key data, is persisted.
   - Tests: endpoint spec `round 2, R1-2` (`:1410`), with key A marked, then a restart:
     - key B before any probe gives no mark and no request;
     - key B ready clears the stored mark;
     - key B unsupported replaces the mark and detail, and A does not inherit it;
     - key B unreachable leaves no usable mark;
     - the same key A stays unverified until its probe re-establishes the mark.
3. **R1-3: a stale selection paired with a new target.**
   - Fix: `resolveSystemOneTarget(selection = this.getSelection())` (`decision-model.config.ts:244`) resolves the target for the selection it is given. `openCaller` passes the selection it captured (`route-decide.service.ts:358`), so the selection, provider, target and 404 re-check identity all come from one snapshot.
   - Tests: gate spec `selection and target come from one snapshot (R1-3)` (`:797`):
     - `getSelection` returns A and then B. The opened client gets A's base and model, and the re-check gets `{ selection: A, baseUrl: A }`. Nothing is probed or marked. This test fails on the previous code.
     - A real setting save happens inside the deferred key read. The result is the same.

Verification:
- `nx test lane-routing --parallel=1 --maxWorkers=2`: 26 suites, 764 tests passed.
- `nx typecheck lane-routing`: passed.
- `nx lint lane-routing`: passed.
- Degradation audit: TOTAL 294.

### Decisions (revise round 2)

- **A restored local `ollama` mark stays verified.**
  - Options: treat every restored mark as unverified; persist a "key used" flag (a schema change to a `.strict()` v1 mark); or bind by kind.
  - Choice: bind by kind. A local `ollama` endpoint never carries a key (`decision-model.target.ts`, `case 'ollama'` passes `null`), so its mark is already evidence for the current, empty credential. This keeps the requirement pinned by `decision-model.config.spec.ts` `(b)`.
  - Reversible.
- **`RangeError` added to the allowlist.** It is a fixed built-in name, and the existing body-read test relies on it. Reversible.
- **`resolveSystemOneTarget` keeps a default parameter.** `failure-class/decision-model-failure-classifier.ts:201` still calls it with no argument. That file is outside this round's scope and has the same two-read pattern; it should pass its own selection in a later change.
