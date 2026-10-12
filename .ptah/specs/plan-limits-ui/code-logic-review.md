# Code Logic Review - plan-limits-ui

Verdict: REVISE (score 5/10). Nothing is a data-loss or security blocker. There are several Serious silent-failure and misattribution defects, and goals 1, 2 and 5 are only partly met.

Scope: I read the full diff and the new reader files. I did not run tests. Lane A owns provider-owner.resolver, plan-limit-owner-discovery, codex/*, libs/shared. Lane B owns libs/frontend. Lane C owns plan-usage.service, readers/*, plan-owner-read.ts.

## Orchestrator defects

- **A is confirmed.** `plan-limit-owner-discovery.service.ts:543-556` derives `unknownReason` from `owner.label` with regex and `includes()`. Only `known(...)` snapshots get a reason. Read-kind entries have none, and `PlanUsageService.assemble` never sets one.
  - The `'unresolved-route'` branch is a catch-all. Any unknown label that matches `route unresolved` or `key unavailable` text is classified by string.
- **B is confirmed.** `provider-account-card.component.ts:~604-612` reads `owner.owner.unknownReason` through an `'unknownReason' in owner.owner` check. That field is not on `QuotaOwnerRef`; it is on the snapshot (`libs/shared/.../plan-limit.types.ts:161`). The lookup is always `''`.
  - Every reason therefore falls to `'Account identity unavailable'`. All five map to the same string anyway.
- **C is partly confirmed.**
  - `plan-limit-tile.component.ts:75-91` no longer renders `t.chip`. The chip appears only in the expanded panel, as "Status".
  - Near-limit, at-limit and stale are conveyed on the closed face only by the `faceClass(tone)` colour. That is a colour-only cue (a11y). The progress fill is uniform `bg-base-content/70`.
  - The chevron is rendered for every non-status tile, including `local-usage`. `expandable()` is false there, so the button is disabled but still shows a chevron.
  - `aria-expanded` and `aria-controls` are correctly omitted when not expandable. The progressbar values are clamped. Unknown shows '—', never 0%.

## Defects

1. **Serious - Lane C.** `plan-usage.service.ts:~406-416` (`mergeLocalUsage`) turns any account failure into `status:'available'`.
   - If the account reader returns `service-unavailable`, `unsupported-auth` or `no-usage-source` and local usage exists, the result becomes `available` with `windows:[]`.
   - Because it is no longer a transient failure, `settle` (`:~330-345`) skips the stale-from-cache path. The last good windows disappear and the real error is hidden.
   - This applies to OpenCode Go and Grok.
   - Fix: keep `account.status` and its windows. Attach `localUsage` and only promote the status when the account reading is itself `available`. Otherwise preserve the account status with `localUsage` attached, and let `settle` handle stale fallback on the account part.

2. **Serious - Lane C.** `plan-usage.service.ts:~262` and `opencode-go-plan-usage.reader.ts:~24-38` read the wrong credential.
   - The service skips `credentials.resolve(target.credentialRef)` for `opencode-go`. The reader instead uses the OpenCode CLI `auth.json`, `OPENCODE_AUTH_CONTENT` or `OPENCODE_API_KEY`.
   - The owner for `opencode-go` is a Ptah-stored-key credential owner (`STORED_KEY_PROVIDERS` in discovery). The quota is therefore attributed to an owner whose key was never used.
   - If the CLI login differs from the stored key, the card shows another account's quota.
   - Fix: for a `credential` owner, use `credential.reveal()`. Use the CLI auth file only for a cli-store owner. Alternatively, return `no-usage-source` when the identity kinds do not match, as Grok does.

3. **Serious - Lane C.** `antigravity-plan-usage.reader.ts:~72-76` makes the OAuth result pre-empt the local probe.
   - `readOAuth` returns `unavailable()` for any failure: network error, 5xx, bad JSON, or a token refresh 400. `noPlan()` is returned on a 403. Only ENOENT returns `undefined`.
   - The reader returns that result without falling back to the language-server probe that previously worked. The file header says a missing profile leaves the local probe in charge, but any present-but-failing profile kills it.
   - Fix: on a non-`available` OAuth reading, fall through to the local probe, and compose them if both succeed.

4. **Serious - Lane A.** Dedup rule at `plan-limit-owner-discovery.service.ts:236-256` is narrow and string-keyed.
   - It matches only the exact label `'Claude identity unavailable (no email)'`.
   - An anthropic session with an unresolved route has the label `'Claude (owner unknown) (route unresolved)'` (`provider-owner.resolver.ts:~527`). It is not suppressed. That is the same "Claude (owner unknown)" card the user complained about.
   - If a lane or ledger yields an anthropic unknown owner with the default label (`quotaOwnerRefFromKey` gives "Claude (owner unknown)"), it is also not suppressed. Ledger-only sources skip unknowns, so the lane/session sources are the ones that matter.
   - It can also hide a real second account. A transient `readAccount` failure for session B gives a no-email unknown. While exactly one verified account exists, that unknown (and its session read target) is dropped silently.
   - With two or more verified accounts the duplicate stays by design, so goal 1 is not met for multi-account users.
   - Fix: add a typed marker or reason on the owner or entry, not a label compare. Suppress by `providerId==='anthropic' && identityKind==='unknown'`, and only for entries whose origin is a native Claude route. Keep the entry when it came from a session whose `readAccount` positively returned no email, versus a failed read.

5. **Serious - Lane A.** `codex-account-usage.service.ts:~257` sets `this.ownerKey = ownerKey` before the `rate-limits` stage succeeds.
   - If the user switches Codex accounts and `rateLimits/read` then fails, `performRead` returns `{...this.cached, status:'stale'}`. That is the previous account's quota, now owned by the new account's key.
   - Fix: update `ownerKey` and `cached` together. If the owner changed and the read fails, drop `cached`.

6. **Serious - Lane B.** `provider-account-card.component.ts:~690-700` (`statusNotice`) misreports Ollama and other `unsupported-auth` owners.
   - `!hasData && status==='unsupported-auth'` now returns "No plan limits (API key)".
   - Ollama Cloud returns `unsupported-auth` for a rejected key (401/403), so a bad key reads as a benign "no limits" message.
   - Fix: choose the text by provider. Keep "API key" only for Codex apiKey/bedrock. Use a "key rejected" sentence for Ollama.
   - The `no-usage-source` branch keyed on `providerId==='opencode'` ("Sign in to OpenCode Go") is also presumptuous when the OpenCode Go reader returns `no-usage-source` after a 403.

7. **Moderate - Lane B.** `provider-account-card.component.ts:~282` shows a visible '—' when `row.percent===null` but `showValue` is true.
   - For count or token-based windows (`used.kind !== 'percent'`), `valueText` ("1,234 requests used") is only in an `sr-only` span.
   - Sighted users lose the number. The old code showed `valueText`.
   - Fix: show `valueText` when it is non-percent. Use '—' only for `Used: unknown`.

8. **Moderate - Lane B.** The dashboard tone cue is lost.
   - `barTone` is still computed (`:~756`) but unused. The `radialClass` colouring was removed, and the bar is uniform `bg-base-content/70`.
   - The per-row state chip keeps limit-reached visible on the dashboard. The session tile does not (see C).
   - Fix: apply tone classes to the bar fill and tile face, and render a compact chip or glyph on the closed tile face.

9. **Moderate - Lane A.** `codex-account-usage.service.ts:~262-272` swallows every error from `account/usage/read`.
   - That includes an abort via `signal` and a child crash.
   - After an abort, the result is still returned as `available` and cached.
   - Fix: rethrow when `signal?.aborted`. Optionally mark the result so a missing activity is distinguishable from a failure.

10. **Moderate - Lane A.** Unknown owners with default labels render identically.
    - `provider-account-card.component.ts:~577` uses `owner.owner.label` verbatim for unknowns, with no key suffix.
    - Two "Claude (owner unknown)" cards cannot be told apart, which defeats the separation intent.
    - Fix: append the short key suffix for unknown owners too.

11. **Moderate - Lane C.** `antigravity-oauth-plan-usage.reader.ts` has several smaller gaps.
    - It refreshes the access token on every poll with no in-memory reuse, so there is one extra OAuth call per refresh. Nothing is written to disk, which is good.
    - An already-aborted `signal` is not checked up front, so no fetch is cancelled.
    - It does not distinguish a revoked refresh token (400 `invalid_grant`) from a transient failure. Both read as `service-unavailable`, which retries forever.
    - Response bodies have no size cap.
    - The reader is not bound to an account. The token file has no email, so it assumes one profile per cli-store owner.

12. **Moderate - Lane C.** Smaller points in the Grok reader.
    - `grok-account-plan-usage.reader.ts` returns `unavailable` on a 401 (expired token) instead of an auth-needed state.
    - Skipping the account read for `credential` owners (`plan-usage.service.ts:~277`) is correct.
    - The credential `email` is parsed but never compared to the owner.
    - `planOwnerRead` now creates a Grok read target without a `cliSessionId`. The session reader rejects it cleanly (`grok-session-usage.reader.ts:30`). That is OK, but the local usage then silently disappears with no explanation.

13. **Minor - Lane B.** `plan-limit-tile.component.ts`: the chevron should be hidden when `!expandable()`, and the progressbar needs an `aria-valuetext` (stale or at-limit).

14. **Minor - Lane A.** `provider-owner.resolver.ts`: labels are built by string concatenation (`${owner.label} (key unavailable)`). They must stay at or under 64 chars with no '@' (`quota-owner-ref.schema.ts`). This holds today but is fragile. Use a typed reason field on the owner.

## Verified clean

- The Codex path uses `rateLimitsByLimitId?.codex ?? rateLimits` as required.
- Activity failure no longer fails the whole read. The log has only a stage and an error class, with no payload.
- Ollama still returns `unsupported-config` for a missing key and `unsupported-auth` for 401/403.
- All new HTTP readers use `redirect:'error'`, a timeout, an abort bridge, zod parsing, and no secret logging. Windows are clamped to 0..100. The Antigravity OAuth reader does not persist refreshed tokens.
- Dashboard and tile progressbar values are clamped. Unknown values render as '—' and not 0%.

## Fix order

Defects 1, 2, 3 and 5 first (Lane C and Lane A). Then 4 and 6. The rest can follow.

## Re-review (round 2)

Verdict: REVISE (score 7/10). The round-1 defects are fixed or mitigated, and I found no Blocking issues. Two Moderate regressions remain, plus a few Minor points. I did not run tests; I read the current diff and the round-2 reports.

### Round-1 status

| # | Status | Evidence |
|---|---|---|
| A | Fixed | Typed `OwnerResolutionDetails` (`provider-owner.resolver.ts:117,405-420`). Discovery no longer regexes labels (`plan-limit-owner-discovery.service.ts:~549-580`). The orchestrator handoff copies it onto read snapshots (`plan-limits-snapshot.service.ts:156-166`). |
| B | Fixed | `dashboard/.../provider-account-card.component.ts:~616-628` reads `owner.unknownReason`. Five distinct strings. |
| C | Fixed | `plan-limit-tile.component.ts:~80-116, 200-207`: tone-coloured fill, a face status text ("Near limit", "Limit reached", "Stale"), `aria-valuetext`, and the chevron is hidden when not expandable. Stale detection compares `chip.text === 'Stale'` (brittle, Minor). |
| 1 | Fixed | `plan-usage.service.ts:~418-432` keeps the account status and windows. `localOnly` promotion applies only to Grok credential owners. The stale path keeps fresh `localUsage` (`:~345-352`). |
| 2 | Fixed | The service resolves `credentialRef` for `opencode-go` (`:261`). `opencode-go-plan-usage.reader.ts` uses the credential for credential owners and the CLI store only for cli-store owners. |
| 3 | Fixed | `antigravity-plan-usage.reader.ts:~72-80` returns the OAuth reading only when `status==='available'`, otherwise falls through to the local probe. |
| 4 | Mostly fixed | Suppression is typed: read entries only, native Claude route, exactly one verified account, and either a confirmed missing email or `unresolved-route` (`discovery:~239-262`). A null/failed read stays visible. See R3 for a residual. |
| 5 | Fixed | `codex-account-usage.service.ts:~257-262` clears `cached` when the owner key changes. |
| 6 | Fixed | Ollama-specific chips and notices (`provider-account-card.component.ts:~640-670`). |
| 7 | Fixed (unverified in detail) | Per the lane B table, amount and token windows now show a value. |
| 8 | Fixed | Warning and error fills on both surfaces. |
| 9 | Fixed, with a regression (R1) | Abort is rethrown. |
| 10 | Fixed | Unknown labels now use `ownerDisplayLabel`. |
| 11 | Mostly fixed | In-memory token cache with a 60s skew (`antigravity-oauth-plan-usage.reader.ts:~108-160`), an up-front abort check, a body cap, and `invalid_grant` mapped to `unsupported-auth`. Tokens are not written to disk. Residual R4. |
| 12 | Partly fixed | Grok is bound to cli-store owners (`grok-account-plan-usage.reader.ts:~58`). See R5. |
| 13 | Fixed | |
| 14 | Fixed | The label is no longer parsed. A WeakMap holds the metadata. |

### New and remaining defects

R1. **Moderate, Lane A.** A Codex abort now rejects, and it also rejects the joiners that did not abort.
- `codex-account-usage.service.ts:~193` (`if (signal?.aborted) throw error` in `performRead`) rejects the shared `readInFlight` promise. `getAccountUsage` joins it at `:~167` via `joinWithCallerAbort`.
- A joiner without a signal receives the initiator's abort as an error. Before this round it received a stale or unavailable result.
- Joiners without a signal:
  - `provider-owner.resolver.ts:~530` (`resolveCodexHomeOwner`, no signal). Discovery's `fromSource` swallows the rejection, so the Codex owner is dropped for that refresh.
  - `provider-rpc.handlers.ts:~231` (`getAccountUsage({refresh:false})`). It has no try/catch visible, so the RPC can fail.
- `PlanUsageService` and the Codex reader are safe: `read()` converts to `abortError()` when its own signal is aborted.
- Also, the thrown value is a `CodexReadStageError`, not an `AbortError`, so callers cannot recognise it.
- Fix: in `getAccountUsage`, wrap the joiner path. If the initiator aborted and the joiner's own signal is not aborted, start a fresh read (or return the cached/stale/unavailable result). Throw a proper `AbortError` only to the aborting caller.

R2. **Moderate, Lane C.** `plan-usage.service.ts:~296-298`: for Grok with no `cliSessionId`, `unavailableReason:'no-open-session'` is stamped onto the merged reading even when the account reading is `available`.
- `settle` then skips caching (`:~355`), so the good account windows are not cached and get no stale fallback.
- The snapshot is `available` but carries an "unavailable reason".
- Fix: set `no-open-session` only when the account reading is not `available` (or when local-only, for the credential-owner path).

R3. **Minor, Lane A.** `missing-account-email` is stamped even when `readAccount` returned null (an unconfirmed read), at `provider-owner.resolver.ts:~475-485`.
- The dashboard subtitle (`provider-account-card.component.ts:~618`) then says "Signed in · account email not shared", which is false for a failed read.
- Suppression is correctly gated on `confirmedMissingEmail`; only the copy is wrong.
- Fix: use a separate reason (or `unresolved-route` copy) when `account === null`.

R4. **Minor, Lane C.** Antigravity token cache.
- `cachedAccess` is not cleared on a 401 from the quota endpoints, so a token revoked inside its validity window yields `unavailable` until the cache expires.
- The cache is a single module-level slot keyed by refresh token and fetcher identity. That is fine for one profile.
- Fix: clear `cachedAccess` on a 401 and retry once.

R5. **Moderate, Lane C.** The Grok account reader looks unreachable.
- `grok-account-plan-usage.reader.ts:~58` returns `no-usage-source` unless `identityKind==='cli-store'`.
- I found no producer of a Grok cli-store owner. `ownerForCliStore` and `CLI_STORE_CLIS` cover only `opencode` and `antigravity` (`provider-owner.resolver.ts:536`, discovery `:370`), and the resolver has no other Grok owner method.
- Grok owners that do exist are credential or unknown, so Grok billing quota is never read and goal 4 is not met for Grok.
- This is not proven: owners from the ledger or `parseOwnerKeys` could be cli-store. Check this, and add a Grok cli-store owner source (or a resolver method) plus a discovery entry.
- The OpenCode Go CLI-login path has the same shape, because the cli-store owner provider is `opencode`. That is acceptable since Go works through the stored key.

R6. **Minor, Lane A.** The WeakMap metadata is keyed on object identity, so any spread or copy of the owner loses it.
- Current paths are fine: discovery passes the same object, and the Codex home owner is cached as the same instance.
- `completedCodexHomeOwner` retains the object and its metadata, so a stale `codex-not-read` can persist for one refresh after the key resolves. It is cleared on use.
- Document the invariant, or add a spec that asserts metadata survives the `entryFor` path.

### Round-2 checks that came out clean

- `noPropertyAccessFromIndexSignature` edits are behaviour-neutral. `rateLimitsByLimitId?.['codex']` is still preferred first.
- `mergeLocalUsage` semantics are right: account status is preserved, and promotion applies only to Grok credential owners.
- Readers: `redirect:'error'`, timeouts, an abort bridge, zod parsing and a body cap. No secret logging, and no token written to disk.

### Fix order

R1 and R2 first, then R5 (verify). R3, R4 and R6 can be follow-ups.

## Re-review (round 3)

Verdict: APPROVE (score 9/10). All six round-2 items are fixed. I found no Blocking or Serious issues and no new Moderate ones. I read the code and specs only; I did not run tests.

| # | Status | Evidence |
|---|---|---|
| R1 | FIXED | `codex-account-usage.service.ts:167-177`. A joiner retries only when its own signal is not aborted, and an aborted caller gets a real `AbortError` (`:73-77,172,207`). The retry loop is bounded: each retry starts a fresh read or joins a new one, and a loop needs a new aborting initiator each time. `readInFlight` is cleared only when it still equals the shared promise (`:175,184`), so no stale join. A failed or aborted read is not cached (`:201-203` sits after the awaited read). The child is owned by the initiator and `performRead` rethrows on abort, so no extra process leaks. Spec: `codex-account-usage.service.spec.ts:361` (2 spawns, joiner `available`). |
| R2 | FIXED | `plan-usage.service.ts:296-300` sets `no-open-session` only when `reading.status !== 'available'`. Spec at `plan-usage.service.spec.ts:452`. |
| R3 | FIXED | `provider-owner.resolver.ts:493-498` gives `unresolved-route` when `account === null`, and `confirmedMissingEmail: account !== null`. An account object without an email keeps `missing-account-email`. Specs at `provider-owner.resolver.spec.ts:607,620`. |
| R4 | FIXED | `antigravity-oauth-plan-usage.reader.ts:184-198` clears `cachedAccess` on 401/403 and recurses once with `retryUnauthorized=false`. The second 401/403 maps to `unavailable` (401) or `noPlan` (403), so it is never infinite. The outer `finally` clears its own timer and listener, and the inner call sets its own. The inner call is not awaited inside the `try`, which is harmless because it is a tail `return` and the outer timer is released only after the inner promise is created. |
| R5 | FIXED | `CliStoreOwner` includes `'grok'` (`provider-owner.resolver.ts:114`). `cliStorePath('grok')` resolves `GROK_HOME` or `~/.grok` (`:642-645`). Discovery adds the owner only when the CLI is installed and `hasGrokCliLogin()` is true (`plan-limit-owner-discovery.service.ts:165-190,403-407`). The two credential keys it checks are identical to those in `grok-account-plan-usage.reader.ts:~110-112`, including the `auth_mode: 'api_key'` exclusion. Reader and owner agree that only a `cli-store` identity reads. Key `grok#cli-store:<fingerprint>` differs from `grok#credential:` and `grok#unknown:`, so there is no key collision. The key is a fingerprint of the path (`:333-339`) and the label is generic (`ownerLabel`), so no path or token reaches snapshots (F71 holds). The spec uses a fake token only inside a temp dir and asserts no token in the output. |
| R6 | FIXED | Identity comment at `provider-owner.resolver.ts:405`. Discovery spec at `plan-limit-owner-discovery.service.spec.ts:148-165` asserts the same owner object reaches `detailsFor` and the read target. |

### New defects

None at Moderate or above. Minor only:
- M1 (Minor). `hasGrokCliLogin` (`discovery:~170`) and `cliStorePath` use `homedir()`. The reader uses `HOME || USERPROFILE || homedir()` (`grok-account-plan-usage.reader.ts:~72`). They differ only when `HOME` is overridden without `GROK_HOME`, which would show a card that reads `no-usage-source`.
- M2 (Minor). Discovery requires `auth.json`, but the reader also honours the `GROK_AUTH` env. A `GROK_AUTH`-only login is not discovered. This is fail-closed.
- M3 (Minor). A Grok session whose owner is credential or unknown could appear next to the new cli-store card. The two have different keys and different statuses, and I did not trace dedupe in the UI. It is not a regression of this round.

Residual uncertainty: I did not run tests (the stated results are 110/110, 9/9 and typecheck), and the UI-level Grok card dedupe is unverified.
