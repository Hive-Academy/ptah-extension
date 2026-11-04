# Fix 4: bounded correction (R1, R2, R3): TASK_2026_865_2a1d

Scope: code-logic-re-review.md findings 1-3, user decisions rows 67 and 68. Executor: Claude
backend-developer subagent. No git actions.

## Contract change (additive, optional-safe)

`libs/shared/src/lib/types/rpc/rpc-chat.types.ts` (inside the existing carry-over block, per row 39):

- `ChatCarryOverParams.requestId?: string`: a UUID the renderer creates for each launch.
- `CARRY_OVER_RESOLUTION_DEADLINE_MS = 90_000`: the R2 deadline after the host accepts the launch.
- `CARRY_OVER_REQUEST_ID_TTL_MS = CHAT_ADMISSION_RPC_TIMEOUT_MS + CARRY_OVER_RESOLUTION_DEADLINE_MS`
  (210 s). The host keeps an unclaimed request ID for this long, and the renderer remembers an
  expired one for the same time.
- `interface CarryOverResolutionTags { claimResolutionRequestId(tabId): string | undefined }`:
  the host port that the `SESSION_ID_RESOLVED` broadcaster reads.
- New optional field on the wire, `SESSION_ID_RESOLVED` payload `carryOverRequestId?: string`.
  It has no typed payload in shared. The renderer reads it defensively: a value that is not a
  string counts as absent.

Zod (`libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.schema.ts`): `requestId:
uuidString('requestId').optional()` on the strict `ChatCarryOverParamsSchema`. An older renderer
that sends no ID still passes the schema.

## R1: correlate the resolution with its launch

How the resolution travels: the SDK adapter calls its single-slot `setSessionIdResolvedCallback`
with `(tabId, realSessionId)`. The callback is wired in
`libs/backend/cli-agent-runtime/src/lib/wiring/sdk-callbacks.ts`, which broadcasts
`SESSION_ID_RESOLVED`. That lib cannot import rpc-handlers, which depends on it, and the adapter
port is shared by every host. So the tag is added at the broadcaster through a token. This
follows the existing `CHILD_CHAT_SESSION_HOST` pattern.

Host:

- `chat-session.service.ts`: `CarryOverLaunch.onAdmitted?: () => void`, passed to
  `launchSdkSession` as `onCarryOverAdmitted`. It is called synchronously right after
  `assertCarryOverProvider`, at the point marked "No await between this pin and the adapter
  call". It never runs if the pin refuses the start. `chat:start` is unchanged.
- `chat-carry-over.service.ts`: implements `CarryOverResolutionTags`. It keeps a per-tab
  `resolutionTickets` map of `{requestId, until}`. `onAdmitted` issues the ticket, which also
  prunes expired tickets. A refused or throwing start drops its own ticket and never a newer
  one. `claimResolutionRequestId(tabId)` returns the ID once and deletes it. An expired ticket
  returns `undefined`. Without a `requestId`, no hook is passed (old behavior).
- `libs/backend/cli-agent-runtime/src/lib/di/tokens.ts`: `CARRY_OVER_RESOLUTION_TAGS`.
- `sdk-callbacks.ts`: `claimCarryOverRequestId(...)` resolves the token lazily when it is
  registered and spreads `carryOverRequestId` into the payload. If the token is missing or the
  lookup throws, the payload goes out untagged; a throw is logged with a degradation-audit
  justification.
- `libs/backend/rpc-handlers/src/lib/chat/di.ts`: binds `CARRY_OVER_RESOLUTION_TAGS` with
  `useToken: CHAT_TOKENS.CARRY_OVER`, so both tokens share one singleton.

Renderer (`libs/frontend/chat`):

- `provider-carry-over-launch.ts` (still lazy): each `PendingCarryOver` gets `requestId:
  crypto.randomUUID()` in `start` and in `startFromCompact`, and the ID is sent in the
  `chat:carry-over` params.
- `provider-carry-over.service.ts`:
  - `claimSessionResolution(tabId, realSessionId, requestId?)`.
  - Tagged resolutions:
    - If the ID matches the pending entry, the existing rules apply (`claimPending`: old id is
      `'none'`, a closed tab is `'skip'`, a rebound tab is abort plus `'skip'`, otherwise
      `'bind'`).
    - If the ID is an expired one within its TTL, the session is aborted and the claim is
      `'skip'`. The marker is used once.
    - If a different launch is pending, the resolution is aborted and the claim is `'skip'`.
      The pending launch keeps the tab.
    - Otherwise the claim is `'none'`.
    - The session the tab is already bound to is never aborted.
  - Untagged resolutions follow today's rules unchanged: a pending entry binds any new session,
    and the tab-based late window applies.
  - `expired` is now keyed by request ID. It holds `{tabId, sessionId, until,
    requestIdUntil}`, and `pruneClosedTabs` prunes it on `requestIdUntil` or when the tab
    is closed.
- `chat-message-handler.service.ts`, `chat-store/chat-lifecycle.service.ts`, `chat.store.ts`:
  `carryOverRequestId` is passed through both claim paths, the surface-claimed branch and the
  lifecycle branch, including the re-claim on `'bind'`, which stays pure.

## R2: deadline after the host accepts

- `provider-carry-over-launch.ts`: on `data.success`, the accepted entry (`rpcSettled: true`) now
  arms `armDeadline(..., CARRY_OVER_RESOLUTION_DEADLINE_MS)`. The indeterminate path shares the
  same helper with `CARRY_OVER_RECOVERY_MS`. Each tab has one timer, and `deletePending`
  clears it.
- When the deadline fires, `expire` runs, as the indeterminate path already does:
  - the tab is released;
  - `CARRY_OVER_EXPIRED_TEXT` ("The new chat didn't start. Try again.") is shown while the tab is
    still on the old session;
  - the offer and banner are kept, so a retry is possible;
  - the request ID is marked expired, so a late tagged resolution is aborted. A late untagged
    one is also aborted, within `CARRY_OVER_LATE_RESOLUTION_MS`.
- Why 90 s: a success result means `startSession` already returned, so the adapter has started
  the query and the SDK `init` normally follows within seconds. A cold CLI spawn with slow MCP
  servers can take tens of seconds. 90 s equals `NAMED_ACCOUNT_ADMISSION_BUDGET_MS`, the host's
  own admission bound. That is long enough not to cut off a slow but healthy start, and short
  enough that a lost event frees the tab in under two minutes.

## R3: open-folder authorization before the proxy shortcut

- `chat-runtime-profile.service.ts`: new public method `assertAuthorizedFolder(folder)`. It calls
  the existing private `authorize` (open folder plus `isUnsafeWorkspacePath`), so the rules are
  not duplicated. It is read-only: no profile build, no proxy.
- `chat-carry-over.service.ts` `newSessionReady`: for an `'offer'` on a proxy-backed provider,
  `assertAuthorizedFolder(folder)` runs first. A refusal throws, `evaluate` catches it, the
  failure is logged by class name ("readiness probe failed"), and the result is
  `{eligible: false}`. If no runtime profile service is bound, the offer fails closed. No proxy
  is acquired on either path (Fix 1 is kept). `prepare` is unchanged; the launch path still
  authorizes through it.

## Tests added or changed

- `provider-carry-over.service.spec.ts`:
  - R1 block (7 tests): unique UUID per launch; old resolution first, where the expired launch
    is aborted and the retry binds; an unknown tag while a launch is pending is aborted; a
    tagged resolution with nothing pending is `'none'`; an untagged resolution keeps today's
    behavior; an expired ID is still recognised after the untagged window; an expired ID
    lapses after its TTL.
  - R2 block with fake timers (6 tests): release at exactly 90 s with the notice, offer kept;
    a late tagged resolution is aborted once; a late untagged resolution is aborted; a retry
    after the deadline launches again; a bind cancels the deadline; a chat error before the
    deadline shows no notice.
  - Two params assertions now expect `requestId` to be a UUID v4.
- `provider-carry-over.relink.integration.spec.ts`: case 4, through the real handler and
  lifecycle: a foreign tag is aborted without changing the binding, and the matching tag binds
  with one notice. Case 3's params assertion now includes `requestId`.
- `chat-lifecycle.service.spec.ts`: claim call assertion gains the third (`undefined`) arg.
- `chat-carry-over.service.spec.ts`:
  - R3: an unauthorized folder with openrouter or github-copilot gives `{eligible: false}`,
    with no prepare, no profile resolution, no start, and a class-name log; an authorized
    proxy offer runs the check without `prepare`; with no runtime profile the offer fails
    closed (the earlier test expected eligible and is updated).
  - R1 tags: a tag exists only after admission, is claimed once, and is per tab; a refused
    start leaves no tag; a tag lapses after its TTL; a launch without an ID passes no hook.
- `chat-session.carry-over-launch.spec.ts`: `onAdmitted` runs once, before
  `startChatSession`, and not when the pin refuses.
- `chat-rpc.schema.spec.ts`: a UUID request ID is accepted, a missing one is accepted, and a
  non-UUID string, an empty string, a number or null is rejected.
- `sdk-callbacks.spec.ts` (cli-agent-runtime): stamps the claimed ID; untagged when no ticket,
  when no tag source is bound, and when the source throws (with a warning).

## Verification

- rpc-handlers (1 locked run): `node scripts/verify.mjs --exec --task fix4-jest-backend -- npx jest
  -c libs/backend/rpc-handlers/jest.config.ts <carry-over service, carry-over-launch, schema,
  handlers specs>`: 4 suites, **246/246 passed**. Jest printed "A worker process has failed to
  exit gracefully".
- chat (2 locked runs): first run 170/172 passed. The 2 failures were mistakes in the tests'
  expectations, not in the code: the expiry notice of the first launch is also a `showInfo`
  call, and a marker is used once by design. After fixing the expectations, `--task
  fix4-jest-frontend2`: 5 suites (carry-over service, relink integration, lazy-boundary,
  chat-lifecycle, chat-message-handler), **172/172 passed**. The same "worker failed to exit
  gracefully" note appeared. A likely cause is the real-timer 90 s deadline that tests ending
  with an accepted launch leave armed. In production the timer is cleared when its entry
  leaves `pending`.
- cli-agent-runtime (1 locked run, in the same exec): `sdk-callbacks.spec.ts`, **21/21 passed**.
- The lazy-boundary spec passes. The eager service file has no new import; the shared constants
  are imported only by the lazy launch module.
- `ptah_get_diagnostics`, scoped to the 13 changed source files, timed out three times ("still
  running after 45s"). **No typecheck result.** The ts-jest runs compile the touched files.
- Not run, per instruction: `npm run verify`, lint, typecheck targets, build, the
  di-lint/degradation-audit hooks. These run in CI or pre-push.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Stamp the request ID at the `SESSION_ID_RESOLVED` broadcaster through a token that `ChatCarryOverService` serves | (a) token in cli-agent-runtime, bound by rpc-handlers; (b) carry the ID through the shared `IAgentAdapter` callback port and agent-sdk; (c) put the session id in the RPC result | The broadcast is only in `cli-agent-runtime/wiring/sdk-callbacks.ts`. rpc-handlers depends on cli-agent-runtime, so the reverse import is not allowed. The `CHILD_CHAT_SESSION_HOST` precedent uses (a). (b) would break the shared port and touch agent-sdk, Codex and routing adapters. (c) cannot work because the resolution usually arrives before or apart from the RPC result. | Yes |
| Issue the ticket at the provider pin, synchronously before the adapter call, through `CarryOverLaunch.onAdmitted` | Issue before `startSession`; issue after it returns | Issuing earlier widens the window in which an older launch's init would get the new ID. Issuing after return could miss an early init. The pin site has no await before `startChatSession`. | Yes |
| A tagged resolution of a different launch while another is pending is aborted, even without an expiry marker | Abort; `'none'` | `'none'` would attach the stray session while the pending launch keeps the tab, leaving it inconsistent. Tab ids are per renderer, so the stray belongs to a launch this tab no longer waits for (for example one released by `onChatError`). | Yes |
| Offer fails closed for proxy providers when `ChatRuntimeProfileService` is not bound | Fail closed; skip authorization; duplicate `isAuthorizedWorkspace` | Row 68: an unauthorized folder gets no offer. The task says to reuse and not duplicate. `registerChatServices` always binds the service, so this only changes a hypothetical host. | Yes |
| R2 deadline is 90 s; ID TTL is 210 s | 60-120 s range in the brief | See R2. The TTL covers the longest renderer wait (120 s RPC) plus the deadline, so the host ticket and the renderer marker expire together. | Yes, one constant each |

## Out of scope and not done

- **Additional lib touched**: `libs/backend/cli-agent-runtime` (token + broadcaster stamp + spec).
  This was needed because the broadcast lives there. The change is additive: a host that
  does not bind the token, such as the benchmark `cli-engine`, broadcasts untagged.
  `cli-engine` calls `registerChatServices`, so it gets the binding too; it takes effect only
  if it also wires `wireSdkCallbacks`. VS Code is not touched.
- Host-side, pre-existing and not changed: `SessionRegistry.bindRealSessionId` accepts the first
  init for a record with a null id without checking the token. If an older launch's SDK
  process inits after a retry registered the tab, the host binds that session to the retry's
  record and announces it with the retry's tag. The renderer then binds the session the host
  considers the tab's, which keeps host and renderer consistent. The retry's own process init
  is refused by the host as `stale-mismatch`. This is agent-sdk adapter behavior, outside this
  fix.
- A host ticket that nothing claims, for example an accepted session whose init never comes,
  could tag an unrelated new session on the same tab within 210 s. That needs a fresh
  `chat:start` in that tab within the window. Retries replace the ticket. This is noted as a
  limit.
- `apps/ptah-electron/src/di/expected-resolvable.ts` and `rpc-surface.spec.ts` were not changed.
  No new RPC method was added. The new token is an alias binding, and the existing
  `CHILD_CHAT_SESSION_HOST` alias is not listed there either. CI's container smoke spec will
  confirm.
- Moderate 3 from the first review (unclaimed-tab rekey before skip) is still a named later
  task (row 59).
