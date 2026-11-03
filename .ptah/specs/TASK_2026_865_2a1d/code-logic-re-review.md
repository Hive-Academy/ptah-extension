# Code Logic Re-review — TASK_2026_865_2a1d

Reviewer family: codex. Implementer family: claude.

## Verdict

**REVISE — 5/10.** The proxy leak and exact P4 wording are fixed. Recovery handles a definite host error and a lost response, but its retry path can bind the expired launch and abort the retry. An accepted launch can still hold a tab indefinitely.

## Findings

1. **Serious — A late expired launch can bind as the retry.** After expiry, a retry creates a new pending entry (`provider-carry-over.service.ts:303-331`). `claimSessionResolution` checks that pending entry first and returns `bind` for *any* new session ID (`:339-356`), without consulting the expired marker. If the expired launch resolves first, it binds to the retry's tab and completes the retry; the actual retry's later resolution reaches `claimExpired` and is aborted (`:550-563`). This preserves one binding, but it is the wrong launch and violates the promised abort of a late expired session. **Fix:** correlate resolution events with a launch/request ID, or block retries until the previous launch is conclusively retired. Add an old-resolution-first retry test.

2. **Moderate — Successful RPC without resolution still strands the tab.** A successful result changes the pending entry to `rpcSettled: true` (`provider-carry-over.service.ts:423-429`) and installs no timer. Only a resolution or chat error releases it (`:339-381`); the renderer's send guard remains active while it is pending (`:191-201`). A host that accepts the launch but loses the resolution/error event leaves the tab busy indefinitely. **Fix:** set a bounded post-acceptance deadline and reconcile or release safely. The 30 s deadline for indeterminate responses does not cover this case.

3. **Moderate — An unauthorized folder can receive a positive offer.** For a proxy-backed active provider, the offer returns true before `prepare` performs its open-folder authorization (`chat-carry-over.service.ts:337-353`; `chat-runtime-profile.service.ts:120-130,141-155`). The check already reads the session folder and stored identity (`chat-carry-over.service.ts:271-303`) and returns the active provider ID and name (`:151-161`). It does **not** read transcript text, return secrets, or launch a provider; the click still authorizes. But a caller with a session ID and matching path can now learn that the session is eligible in a folder the host would refuse to open, whereas the former probe returned ineligible. That is a narrow metadata/privacy disclosure across the open-folder boundary, not transcript exposure. **Fix:** run the side-effect-free folder authorization before the offer's proxy shortcut.

## Focus results

1. **Finding 1:** The retained proxy is fixed: `check` passes `offer` and proxy-backed providers return before profile resolution (`chat-carry-over.service.ts:151-158,82-86,343`). `carryOver` passes `launch` and executes the full readiness path (`:176-179,343-353`). The resulting offer may show for an unready provider; clicking fails through the launch check. The authorization skip has the limited disclosure in Finding 3.
2. **Finding 2:** Definite host error envelopes release immediately (`provider-carry-over.service.ts:406-420`); unknown results install a 30 s timer (`:500-523`); expiry releases pending and records a late marker (`:526-543`); a late resolution with no retry pending is aborted (`:550-563`). Retry ordering and accepted launches retain Findings 1 and 2 above.
3. **Finding 4:** Fixed. The P4 outcome sets `errorIsFullText` (`message-sender.service.ts:266-273`), and both dispatcher paths pass that flag (`message-dispatch.service.ts:248-258,321-330`). The dispatcher renders the exact error when flagged and keeps `Message delivery failed. ` for other failures (`:430-447`).
4. **New defects:** Findings 1 and 3 arise from these commits. Finding 2 is a residual gap in the new recovery policy.

## Verification

Read both fix commits with `git show`, the implementer fix reports, the prior logic review, and the affected source paths. No source edits, tests, builds, Nx commands, or commits. The reports record scoped Jest passes (36 backend tests; 189 frontend tests); their diagnostics were unavailable, so this re-review makes no typecheck claim. Finding 3's severity assumes the existing open-folder authorization is a privacy boundary for RPC callers; the current check handler validates schema but does not enforce that boundary (`chat-rpc.handlers.ts:421-429`).

## Decisions

- Treat the open-folder check as a privacy boundary for the offer. The alternative is to regard a renderer RPC caller as already trusted for every local folder. The explicit authorization in `ChatRuntimeProfileService.prepare` supports the former; this is reversible by adding a read-only authorization check before the offer shortcut.
