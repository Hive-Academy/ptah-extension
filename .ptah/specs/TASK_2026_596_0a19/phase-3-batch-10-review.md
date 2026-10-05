# Phase 3 Batch 10 Review (logic + security, cross-side) — diff 48ddcb9f9..50cd859af

Verdict: **REVISE** — 7/10

Scoped run: `jest quota` 8 suites, 143 tests, all pass. No TODO/PLACEHOLDER/STUB markers, no empty bodies, no mock data standing in for logic.

## Findings

1. **Serious** — `antigravity-plan-usage.reader.ts` `defaultRequest` (~lines 170-200): the timeout/abort can leave the promise pending forever.
   - Scenario: the LS sends headers, then stalls mid-body (or the 3 s timeout fires after headers). `signal` abort calls `request.destroy()`. After the response has started, Node does not emit `'error'` on the request. It emits `'aborted'`/`'close'` on `res`, and the `res` error is dropped because there is no `res.on('error')` listener. `'end'` never fires, so the promise never settles. The reader's `await requestStatus(...)` hangs and its `finally` never runs. The whole flight for this owner is stuck. The Ollama reader does not have this problem, because fetch rejects `response.json()` on abort.
   - Fix: add `response.on('error', reject)` and `response.on('close', () => reject(new Error('closed')))`, which is a no-op once the promise has settled. Also check `response.statusCode` (2xx) before parsing.
   - The spec injects `requestStatus`, so `defaultRequest` has no coverage at all. Add one local-server test with a stalled body.

2. **Moderate** — `antigravity-plan-usage.reader.ts:60-70` / `defaultRun`: the 3 s limit is applied twice. Process discovery (`execFile` timeout 3 s) runs before the request timer starts, so the worst case is about 6 s. The caller's `signal` is not observed while `run` is pending (it is only checked afterwards). Fix: create the controller before discovery, or pass `signal` to `execFile`.

3. **Moderate** — `findServer` (~lines 110-130):
   - It takes the first line containing both substrings (`language_server` and `antigravity`, case-insensitive) anywhere in the command line. Any unrelated process whose arguments mention both strings (an editor opened on an `antigravity/language_server` path, a shell, a test runner) could be picked. Its `--csrf_token`/`--port` pair would then be sent, with TLS verification off, to an arbitrary local port.
   - Several matching lines (multiple Antigravity windows) silently use the first one.
   - Mitigations that exist: the host is the literal 127.0.0.1 and the port is range-checked (1-65535), so there is no host injection.
   - Fix: anchor the marker to the executable token (the first argv element or its basename). Prefer a unique match. Treat several different (port, token) pairs as ambiguous, i.e. `service-unavailable`.
   - A quoted Windows token (`--csrf_token "abc"`) would capture the quote characters. Strip surrounding quotes.

4. **Moderate** — `antigravity-plan-usage.reader.ts` `toWindow`:
   - The window is labelled "Weekly · model" with kind `weekly_model`, but nothing in the provisional payload says the period is weekly. The label asserts an unverified fact. Use a neutral label, or document it as provisional.
   - The remote-supplied `model` string goes unbounded into the window key and label. Cap its length.
   - `(1 - remainingFraction) * 100` produces float noise (30.000000000000004). Round it.

5. **Moderate** — `ollama-cloud-plan-usage.reader.ts:44-47`: any non-ok response, including 401/403 (the key was rejected), maps to `service-unavailable`. A persistent bad key is an auth state. It will be retried and shown as transient. Map 401/403 to `unsupported-auth`. Also pass `redirect: 'error'` so the bearer header can never follow a redirect.

6. **Minor** — `defaultRequest` creates `new Agent(...)` per call and never destroys it. keepAlive is off, so the sockets close, but the Agent is garbage only. The POST has no body and no `Content-Type`, whereas the Connect/gRPC-web endpoints normally need `{}` JSON. This is provisional, but note it in the constants file. The response body is unbounded (local peer, low risk).

7. **Minor** — The Ollama reader itself does not return `unsupported-auth` for a placeholder key. It relies on `plan-credential.source.ts:114-116`, which batches.md confirms. That is acceptable, but a reader spec comment should say so.

8. **Minor** — `provider-owner.resolver.ts:366` runs `new URL(OLLAMA_CLOUD_DIRECT_BASE_URL)` on every call. Hoist it to a module constant. `ownerForProviderKey('ollama-cloud')` reads the provider-slot key. A session that used a Ptah CLI key for the same host resolves to the provider-key owner or an unknown one. This is conservative and is not misattribution.

## Focus checks

- **R4:** The CSRF token and the key go only into request headers. Logs carry only `{providerId, fieldPath, reason}` (zod issue code, not the value). Specs serialise `mock.calls`. `reveal()` is called only inside the fetch call. OK.
- **TLS:** `rejectUnauthorized:false` appears once, on the literal `127.0.0.1` Agent. The port is `\d+`-parsed and range-checked. OK (see finding 3 for process attribution).
- **Process args:** The argument arrays are constant and passed through `execFile` with no shell. The `Get-CimInstance … ForEach-Object` raw-line output removes the table truncation, and a 12k-character line is covered in the spec. OK.
- **AS5:** Cloud-direct resolves only for `proxy` + null `providerId` + host equal to the `ollama.com` hostname. The daemon route stays unknown (comment at lines 370-372), so local Ollama never becomes `ollama-cloud`. `hostFromBaseUrl` returns `URL.hostname` only, with no userinfo, query or auth token. `ownerForProviderKey` goes through `quotaOwnerRefFromKey`, which is parse-checked.
- **Reader contract:** Transient failures, schema mismatch, no process and abort all return `service-unavailable`. Ollama with no credential returns `unsupported-config` with no network call. Unknown used is never 0, because the schema requires the field. The `resetTime`/`resets_at` parse is guarded by `Number.isFinite`. `remainingFraction` is bounded 0..1.
- **Ollama abort:** The timer is cleared and the listener removed in `finally`. A pre-aborted signal returns early. There is no unhandled rejection. OK.

## What is correct

- Conservative provisional-payload rejection with sanitized logs, and the constants isolated in `antigravity-ls.provisional.ts`.
- The Windsurf/Codeium exclusion marker, and the local `ProbeCommandRunner` type with no barrel growth.
- Reader registration in `plan-usage.service.ts` changes no cache or flight logic.
- The AS5 resolver branch is minimal and non-guessing, and the new route field is a non-secret host. The resolver and probe specs cover it.
- Ollama window mapping and the early abort handling are sound.
