# Code Logic Review — TASK_2026_707 PR 1

## Summary

| Metric | Value |
| --- | --- |
| Score | 5/10 |
| Verdict | REVISE (NEEDS_REVISION) |
| Blocking / major / minor defects | 0 / 3 / 3 |
| Failure modes | 5 |

The primary selection, BigInt formatting, per-owner refresh flow, Grok local usage merge, and additive DTO transport are present. The score is above 3–4 because the core flow is implemented and tested, but below 7–8 because provider failures can appear as successful or actionable states with the wrong cause. This is a logic review, not a style review.

## Numbered defects

1. **Major — Ollama auth rejection is hidden by the other endpoint's data.** `libs/backend/auth-providers/src/lib/quota/readers/ollama-cloud-plan-usage.reader.ts:268-281` returns `available` as soon as either result has windows or local usage; the `unsupported-auth` check is after that return. If `/api/balance` returns 401/403 while `/api/usage` returns counts, the tile presents a successful account reading. The same happens with the endpoints reversed. The plan calls for 401/403 to identify rejected auth (`implementation-plan.md:50`). **Fix:** give auth failure precedence in `combine`, while deciding explicitly whether separately fetched data may accompany a rejected-auth status; test both mixed directions.

2. **Major — a failed Ollama balance read looks like a plan with no limits, and 429 can freeze that impression for ten minutes.** `ollama-cloud-plan-usage.reader.ts:268-276` marks usage-only results `available` with no failure detail; `plan-tile-view.model.ts:603-620` then uses the generic no-bar pill rather than saying the balance source failed. `ollama-cloud-plan-usage.reader.ts:177-189` caches that result for the maximum `Retry-After`, although only one of the two endpoints may have requested backoff. A user refreshing after `/api/balance` recovers still sees counts and no quota. **Fix:** carry a typed partial-read cause or independent endpoint states into the snapshot; retain counts, show that plan limits are unavailable, and retry each endpoint according to its own cooldown.

3. **Major — Antigravity CLI failure reason is never shown for the main failure path.** The adapter emits `cli-parse-failed` at `libs/backend/auth-providers/src/lib/quota/readers/antigravity-cli-usage.adapter.ts:91-96`, and the reader propagates it at `antigravity-plan-usage.reader.ts:77-80`. Yet `plan-tile-view.model.ts:522-526,560-563,615-620` gives the generic “Open Antigravity” notice precedence over the typed reason. A malformed response therefore instructs the user to open an app that may already be open. **Fix:** prefer `statusReason` for Antigravity's no-window failure notice and pill, then fall back to the generic app message.

4. **Minor — CLI failures with different remedies collapse into `cli-unavailable`.** `antigravity-cli-usage.adapter.ts:82-96` continues on all execution errors other than output overflow and returns one reason after candidates fail. Thus binary missing, sign-in failure, timeout, and process error are indistinguishable, contrary to the typed causes requested at `implementation-plan.md:52`. **Fix:** classify spawn error, exit status, and timeout without parsing arbitrary stderr as usage; add distinct typed reasons and corresponding tile text. Keep the current ten-second abort, argument array, output cap, and fail-closed tab parser.

5. **Minor — the Ollama response body cap applies only after full buffering.** `ollama-cloud-plan-usage.reader.ts:301-305` awaits `response.text()` before measuring 256 KiB. A very large or unending response can consume unbounded memory or wait for the five-second abort, so this does not enforce the stated body cap. **Fix:** read the response stream with a byte counter and cancel on overflow; preserve the independent endpoint outcome.

6. **Minor — per-model Ollama request detail has no presentation path.** The reader populates `PlanLocalUsage.models` at `ollama-cloud-plan-usage.reader.ts:415-430`, and the shared DTO carries it at `libs/shared/src/lib/types/plan-limit.types.ts:157-168`. `plan-tile-view.model.ts:693-733` reads only the total `requests`, range, and source for the secondary line and tooltip; the tile renders only that mapping (`provider-account-tile.component.html:100-116`). No frontend dashboard reference to `localUsage.models` was found. **Fix:** add a bounded “top models” tooltip/detail line or document this field as transport-only until PR 2, so users can reach the detail collected by the reader.

## Five logic questions

1. **Silent failure:** a 401/403 or 503 from one Ollama endpoint is hidden when the other returns usable data (`ollama-cloud-plan-usage.reader.ts:268-287`).
2. **Unexpected user action:** Refresh during a balance 429 reuses the usage-only cached result for up to ten minutes (`ollama-cloud-plan-usage.reader.ts:141-143,177-189`); a malformed `agy` result tells the user to open Antigravity (`plan-tile-view.model.ts:560-563`).
3. **Wrong answer from input:** mixed successful usage and rejected balance returns `available`, and an oversized response is buffered before rejection (`ollama-cloud-plan-usage.reader.ts:268-281,301-305`). The allowance formula itself correctly requires positive `allowance_usd` (`:349-371`), legacy remaining percentage is inverted (`:375-397`), and purchased balance is not converted to a percent (`:75,:349-371`).
4. **Dependency failure:** fetch errors and timeout become `service-unavailable` at `ollama-cloud-plan-usage.reader.ts:251-257`, but partial failure loses the cause in `combine`; CLI process failures are bounded by `execFile` timeout and maxBuffer (`antigravity-cli-usage.adapter.ts:184-203`) but collapse to one reason (`:82-96`).
5. **Missing requirement:** the plan says preserve near-limit and source facts and says Ollama model detail may enter an additive DTO (`implementation-plan.md:46-50`), but no user-facing path for `models` exists (`plan-tile-view.model.ts:693-733`). A concurrent-read policy is also unspecified: the Ollama cache is populated after both requests (`ollama-cloud-plan-usage.reader.ts:153-189`), so simultaneous reads for the same owner can issue duplicate request pairs despite the 10/min/user limit. Add an in-flight promise keyed by owner.

## Data flow and requirements

- Ollama: credential and owner key → independent fetches (`ollama-cloud-plan-usage.reader.ts:138-173`) → Zod parsing (`:58-106,325-430`) → `combine` (`:261-288`, defects 1–2) → service snapshot (`libs/backend/auth-providers/src/lib/quota/plan-usage.service.ts:425-438`) → store structural validation (`libs/frontend/core/src/lib/services/plan-limits.store.ts:305-343`) → tile model (`plan-tile-view.model.ts:760-855`). The new optional fields are not stripped by a Zod or RPC schema on this path; `provider:getPlanLimits` and the push use `PlanLimitsSnapshot` (`libs/shared/src/lib/types/rpc/rpc-providers.types.ts:226`, `libs/shared/src/lib/types/messages/payload-map.ts:424`). Ptah symbol search returned zero indexed hits, so this transport check used targeted native search.
- Antigravity: OAuth → local server → CLI (`antigravity-plan-usage.reader.ts:72-86,89-101`); Windows `%LOCALAPPDATA%/agy/bin/agy.exe` is considered (`antigravity-cli-usage.adapter.ts:52-64`), and the parser rejects malformed lines (`:103-173`). The documented captured sample is at `implementation-plan.md:178-189` and appears in the adapter fixture (`antigravity-cli-usage.adapter.spec.ts:12-13`). An account-changed local-server result stops fallback (`antigravity-plan-usage.reader.ts:74`) to avoid mixing account identities.
- Grok: API-key readers emit a typed reason (`grok-account-plan-usage.reader.ts:32-41,68-72,115-120`); credential identity is handled in the service (`plan-usage.service.ts:298-317`); local session usage is preserved by `mergeLocalUsage` (`:454-467`). A grok.com subscription key continues to the billing fetch (`grok-account-plan-usage.reader.ts:122-145`). No regression found in this trace.
- Frontend: primary window selection follows highest finite percentage, nearest future reset, then stable key (`plan-tile-view.model.ts:383-415`); invalidated Claude generic weekly is hidden only when a model weekly exists (`:424-435`); secondary chips use the 90% threshold (`:786-806`); integer token strings use BigInt (`:138-150`); the tile consumes the store's shared clock, with no own timer (`provider-account-tile.component.ts:92-116`). These paths match the plan, subject to defects 3 and 6.

## Coverage loss from the 1717-line card spec

The old card spec's state matrix was replaced by 451 lines in the card spec plus tile/model specs. The new specs cover primary ties, duplicate weekly, 90% chips, BigInt, status pill, refresh, and store push. These surviving behaviors lost focused assertions:

- Old spec `provider-account-card.component.spec.ts` in `HEAD`: lines 725–754 separately asserted reset-passed and next-reset facts; the new model maps both at `plan-tile-view.model.ts:284-293`, but the new specs test only the duplicate-weekly tooltip, not this passage case.
- Old spec lines 1113–1177, 1262–1333 asserted state-specific bar colours and the 90% marker for aged, estimate-only, and not-confirmed windows; the new specs assert the 90% chip and one primary bar, while `plan-tile-view.model.ts:43-63,809-821` and `provider-account-tile.component.ts:70-87,130-140` still implement these states.
- Old spec lines 1357–1438 distinguished active, expired, and estimated owner evidence; new tile/model specs assert only active evidence, although `plan-tile-view.model.ts:735-754` still contains all three branches.
- Old spec lines 427–487 covered converting a CLI ISO date range to “last N days” with an exact-range tooltip; `plan-tile-view.model.ts:679-690,710-713` remains but no new spec exercises that range conversion.
- Old spec lines 804–852, 910–948 tested distinct Ollama key/missing-key, Antigravity sign-in, and status sentences. New specs test typed reason mapping abstractly (`plan-tile-view.model.spec.ts:403-421`), which misses the real Antigravity priority defect at `plan-tile-view.model.ts:522-526,560-563`.

## Verification and uncertainty

Backend batch reports 7 suites/125 tests passing (`batch-pr1-backend.md:24-31`); frontend batch reports 3 suites/47 tests passing (`batch-pr1-frontend.md`, Test results). A targeted Ollama Jest invocation was started but produced no completion result within the allowed single check, so this review does not claim that run passed. `ptah_get_diagnostics` returned unavailable because its TypeScript check was still running; no diagnostic result is asserted. The reader tests cover individual HTTP statuses (`ollama-cloud-plan-usage.reader.spec.ts:434-437`) and usage-only success, but no mixed 401/403 plus successful other endpoint or concurrent same-owner refresh case was found. No source files were edited.

## Decisions

- **Mixed endpoint failures:** preserve independently valid data, but expose the failed balance/auth state; alternatives were discarding all data or treating partial data as fully available. Evidence: `implementation-plan.md:50` and `ollama-cloud-plan-usage.reader.ts:261-287`. Reversible by extending the reading/snapshot.
- **Antigravity sample:** accept the parser's tab-separated shape because the orchestrator captured a logged-in sample in `implementation-plan.md:178-189`; requesting another sample is unnecessary. Reversible if the CLI format changes.

Review family: codex; implementer families: antigravity, ptah-cli (Ollama Cloud).
