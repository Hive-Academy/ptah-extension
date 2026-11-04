# Batch 6 report — Banner identity and `ProviderCarryOverService`

Executor: frontend-developer subagent. Tasks 6.1 and 6.2 are implemented. No git was run.

## Files

- MODIFIED `libs/frontend/core/src/lib/services/auth-state.service.ts`: banner generation and origin.
- MODIFIED `libs/frontend/core/src/lib/services/auth-state.service.spec.ts`: banner cases.
- MODIFIED `libs/frontend/core/src/lib/services/index.ts`: type-only re-export of
  `AuthRequiredBanner` and `AuthRequiredBannerOrigin`. This file is outside the batch list; see
  Deviations.
- CREATED `libs/frontend/chat/src/lib/services/provider-carry-over.service.ts`
- CREATED `libs/frontend/chat/src/lib/services/provider-carry-over.service.spec.ts`

All paths are under `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/`.

## Task 6.1 — `AuthStateService`

- The banner type is now `AuthRequiredBanner { providerId, message, generation, origin | null }`,
  with `AuthRequiredBannerOrigin { sessionId, tabId, workspacePath }`.
- `flagAuthRequired(providerId, message, origin?)` increments a private counter and returns the
  new generation. The `openai-codex` stale side effect is unchanged.
- `clearAuthRequiredBanner(generation?)` clears only when no generation is given or when it
  matches the current banner. Existing callers compile unchanged: `chat-view.component.ts` and
  `message-sender.service.ts` ignore the return value.
- The healthy-Codex `set(null)` in the auth refresh is unchanged.

Specs, and the ACs they prove:

- the generation increments, including after a clear;
- the origin is stored;
- a guarded clear with a stale generation is a no-op (AC 7.5);
- a guarded clear with the matching generation clears;
- a guarded clear with no banner showing is a no-op;
- an unguarded clear still clears;
- the healthy-Codex clear still works, also for a banner that has an origin, and it leaves a
  non-Codex banner alone (P8);
- the existing `toEqual` case now also expects `generation: 1, origin: null`.

## Task 6.2 — `ProviderCarryOverService` (`providedIn: 'root'`, chat lib)

The state has three parts:

- a private `_offer` signal;
- a public `offer` computed that exposes the offer only while its generation equals the current
  banner generation. Generations only grow, so a cleared or replaced banner can never revive an
  offer (P8). No effect is needed;
- `_pending: Map<tabId, entry>`.

`isPending(tabId)` and `isBusy(sessionId)` are the only busy predicates.

API:

- `offerFor(generation)` reads only the banner origin, never its message (AC 1.4). It calls
  `chat:carry-over-check` and sets the offer only when the session is eligible and the
  generation is unchanged after the await.
- `start(offer)` runs the click checks: the generation, then the tab (a closed tab clears the
  offer and `clearAuthRequiredBanner(gen)`), then the binding, then pending or busy (the offer is
  kept). It then adds the entry synchronously, before the RPC, and calls `launch`.
- `tryCompact(origin)` calls the check with `{ timeout: CARRY_OVER_CHECK_TIMEOUT_MS = 5_000 }`.
  An ineligible session gives `'not-eligible'`. An RPC error or timeout gives `'check-failed'`
  (see Decisions). An eligible session goes to `startFromCompact`.
- `startFromCompact(request)` returns `'busy'` when the tab is pending or the session is busy.
  When the banner origin is the same `{sessionId, tabId}`, the entry takes that banner's
  generation and providerId; otherwise both are null.
- Private `launch` calls `chat:carry-over { sessionId, tabId, workspacePath, name?,
  ptahUiFence (Electron) }` with `timeout: CHAT_ADMISSION_RPC_TIMEOUT_MS`.
  - Success sets `rpcSettled` (only if the same entry is still pending).
  - A transport error or timeout keeps the entry and returns the busy text.
  - Every data failure deletes the entry first and is then mapped through `ownsUi`: the tab
    exists, it is bound to the session, and the banner generation matches when it is not null.
- `claimSessionResolution` is pure for `'none'` and `'bind'`. A gone tab gives `'skip'` (no
  abort, AC 7.6). A rebound tab gives `'skip'` plus `chat:abort { sessionId: realSessionId }`
  (AC 7.7). Abort failures are logged with ids and the error name only.
- `completeBinding` is idempotent. It shows the notice through `ActionBannerService.showInfo(…,
  tabId, CARRY_OVER_NOTICE_MS = 15_000)`. It calls the guarded clear and clears the offer only
  when the generation is not null.
- `onChatError(tabId)` releases the entry and shows no notice.
- Notice text, the same for both triggers (U2 = A, row 32): "Continued with <provider> in a new
  chat from a summary of this conversation. The original conversation is unchanged. This
  conversation's text was sent to <provider>."
- Exported constants for Batch 7: `CARRY_OVER_BUSY_TEXT`, `CARRY_OVER_UNREADABLE_TEXT`, and the
  types `CarryOverOffer`, `CarryOverCompactResult` and `CarryOverClaim`.
- There are no timers apart from the one `ActionBannerService` already has, and no transcript
  text is held anywhere.

Specs (`provider-carry-over.service.spec.ts`) use a mocked `ClaudeRpcService` with a
deferred-promise queue for each method, the real `AuthStateService`, a stub `TabManagerService`
backed by a map, and a stub `ActionBannerService`. They prove:

- AC 1.4: the same check params and the same offer when only the refusal text differs.
- AC 7.1: the offer carries the session, tab, workspace and generation, plus the provider; the
  check params are exact.
- AC 1.2, 1.3, 1.6:
  - an ineligible session, a check error, and a newer refusal during the check each give no
    offer;
  - a stale generation or a banner without an origin sends no check;
  - P8: a cleared banner hides the offer and a later banner does not revive it.
- AC 7.2, 4.5:
  - a stale-generation click sends no RPC;
  - a closed tab sends no RPC and clears the banner and offer;
  - a rebound tab sends no RPC and drops the offer but keeps the banner.
- AC 5.4: a double click gives one `chat:carry-over` while the offer is kept.
- AC 7.3: the request names the refused tab and session, not the tab in view. The params and
  the `CHAT_ADMISSION_RPC_TIMEOUT_MS` timeout are exact.
- AC 4.3, 4.4:
  - after success the tab stays pending until the bind, and there is no notice before
    `completeBinding`;
  - after the bind there is one notice with the exact text, tab and duration, and the banner and
    offer are cleared;
  - calling `completeBinding` twice gives one notice;
  - a resolution with the old id, or for another tab, gives `'none'` and keeps the entry.
- AC 7.8, deferred races:
  - a tab switch after the click;
  - a newer refusal mid-flight survives the completion (AC 7.5);
  - a tab closed mid-flight gives `'skip'` with no abort and no notice (7.6);
  - a tab rebound mid-flight gives `'skip'` plus `chat:abort {NEW}` (7.7);
  - a resolution that arrives before the RPC returns still binds.
- AC 5.1, 5.2, failure mappings:
  - `HISTORY_UNREADABLE` gives the fixed banner text with the origin and banner provider, and the
    offer is gone;
  - `START_FAILED` flags the provider and error from the result;
  - `NOT_ELIGIBLE` drops the offer and keeps the banner;
  - `IN_FLIGHT` releases the tab and changes no UI.
- F2: a newer refusal survives a late `HISTORY_UNREADABLE` and a late `START_FAILED`, and a
  rebound tab keeps its banner on both.
- A transport timeout keeps the entry, `onChatError` for another tab does not release it, and
  `onChatError(tab)` does. An unresolved entry of a closed tab is pruned at the next launch.
- `/compact` (proposed AC 9.3, 9.4; AC 5.1, 5.2):
  - with no banner, success makes no `clearAuthRequiredBanner` call and the notice appears after
    the bind;
  - with a matching banner, success clears it and its offer;
  - another tab's banner is left alone;
  - `NOT_ELIGIBLE` gives `'not-eligible'`;
  - `HISTORY_UNREADABLE` with no banner gives the fixed-text outcome and no `flagAuthRequired`
    call; with the tab's own banner, the banner is replaced and the outcome is
    `errorAlreadyShown`;
  - `START_FAILED AUTH_REQUIRED` with no banner calls `flagAuthRequired(null, error)` with no
    origin, makes no offer, and returns `errorAlreadyShown`;
  - a non-auth `START_FAILED` with no banner becomes a send failure;
  - `IN_FLIGHT` and a transport failure give the busy text;
  - a pending tab, or a busy session in another tab, gives `'busy'` with no extra RPC;
  - `tryCompact` uses the 5 s cap and exact params; an ineligible session gives
    `'not-eligible'`; an RPC error and a timeout each give `'check-failed'` with no launch.

## Verification

- Full batch verify, `npm run verify -- -p @ptah-extension/core,@ptah-extension/chat`. The
  header read "Running targets lint, test, typecheck for 2 projects" (2 projects, as required).
  The run took 39 min under the machine lock. Result: exit 1.
  - core: 51/51 suites passed, 1660/1660 tests passed.
  - chat: 329/331 suites passed. Tests: 5859 passed, 2 skipped, 2 failed. The 2 failures were
    `chat-transcript.display.spec.ts` (16 s) and `chat-transcript.change-set.spec.ts` (10 s).
    This batch does not touch them, and neither file references `AuthStateService` or the
    banner. The run also printed "A worker process has failed to exit gracefully".
  - Lint: 0 errors (15 warnings in core, 133 in chat). My output filter did not keep which
    files the warnings are in.
  - Typecheck: my output filter did not keep the per-target lines, so I cannot tell whether the
    typecheck target passed in this run.
- Rerun of the two failing specs alone: `npm run verify -- -t test -p @ptah-extension/chat --
  --testPathPatterns=chat-transcript.display --testPathPatterns=chat-transcript.change-set`
  passed (exit 0, 32 s). The failures are timing flakes under machine load, not regressions.
- An earlier run of the new spec alone (`-t test -p @ptah-extension/chat --
  --testPathPatterns=provider-carry-over`) passed (exit 0).
- The user then moved the heavy gate to CI on a draft PR (coordinator message), so I started no
  further verify. Nothing was still running when the message arrived.
- `ptah_get_diagnostics` on the 5 changed files was tried three times. Each time it returned
  "TypeScript check still running after 45s", so it was unavailable and gave no result.

## Decisions

| # | Decision | Options | Evidence | Reversible |
| - | -------- | -------- | -------- | ---------- |
| B6-1 | `tryCompact` returns `'check-failed'` for a check RPC error or timeout, separate from `'not-eligible'`. | Return `'not-eligible'` for both, as the batch text says. | decisions.md row 38 (P4 = A) and task-description Revision 2 item 10: Task 7.1 must fail closed on a check failure when it knows the providers differ, so it has to tell the two apart. Batch 7 maps `'check-failed'` to today's path otherwise. | Yes |
| B6-2 | A compact `START_FAILED` with no owning banner flags the auth banner (no origin) only when `errorCode === 'AUTH_REQUIRED'`. Any other code returns `{ success:false, error }` as the send failure. | Flag the auth banner for every `START_FAILED`, as the plan's general wording says. | The batch spec names "START_FAILED AUTH_REQUIRED". A `CODEX_*` failure shown as a re-auth banner would be wrong. AC 5.2 is still met: no session, no notice, the tab stays bound. | Yes |
| B6-3 | `offer` is a `computed` over `_offer` and the banner generation, not a signal cleared by an effect. | An effect that clears the offer on banner change. | P8 (a cleared banner must not revive an offer) with no effect or timer. Generations are monotonic. | Yes |
| B6-4 | The pending entry of a closed tab is pruned at the next `start` or `startFromCompact`. | Keep it until the claim. | Plan: deleted on "a missing tab found at the next launch/claim". Pruning stops a closed tab's leftover entry from keeping `isBusy(sessionId)` true in other tabs. | Yes |
| B6-5 | `offerFor` uses the default RPC timeout (30 s). | The 5 s compact cap. | The plan names the 5 s cap only for `tryCompact`. A check failure means no offer and today's banner. | Yes |

## Deviations

- `libs/frontend/core/src/lib/services/index.ts` gains a type-only re-export of
  `AuthRequiredBanner` and `AuthRequiredBannerOrigin`, so the chat lib can type the pending
  origin through the `@ptah-extension/core` barrel. The change is additive and one statement.
  The alternative was a derived `NonNullable<ReturnType<…>>['origin']` type in chat.

## Out-of-scope observations / risks for the phase review

- An envelope-level `chat:carry-over` failure that is not a timeout is treated as transport and
  not definitive, as the plan says. Examples are a schema rejection or a missing handler before
  Batch 5. In that case the tab stays pending until a chat error or the tab's removal, so sends
  on that tab are refused. Batch 5 should return every host refusal as a data result (`success:
  true` envelope, `data.success: false`) so that this path is reached only by real timeouts.
- `chat-transcript.display.spec.ts` and `chat-transcript.change-set.spec.ts` are flaky under
  load (they pass alone).
