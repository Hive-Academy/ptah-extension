# Fix 5: retry blocked until the old launch retires (TASK_2026_865_2a1d)

Scope: code-logic-final-review.md Findings 1 and 2, user decision row 76 ("Block retry until
retired", no agent-sdk registry change), plus the orchestrator's extra scope (4 CI spec suites).
Executor: Claude backend-developer subagent. No git actions.

## Files

- MODIFIED `libs/shared/src/lib/types/rpc/rpc-chat.types.ts`: `CARRY_OVER_REQUEST_ID_TTL_MS`
  (210 s) removed and replaced by `CARRY_OVER_LATE_RESOLUTION_MS = CHAT_ADMISSION_RPC_TIMEOUT_MS`
  (120 s). The constant moved here from the renderer so both sides use one value. No other
  consumer existed (grep over `libs` and `apps`).
- MODIFIED `libs/backend/rpc-handlers/src/lib/chat/session/chat-carry-over.service.ts`: the ticket
  is now `{requestId, tagUntil, blockUntil}`. `carryOver` records `receivedAt` and refuses with
  `IN_FLIGHT` while the tab holds a ticket. Lapsed tickets are pruned on each launch. Any claim
  deletes the ticket (it retires).
- MODIFIED `libs/frontend/chat/src/lib/services/provider-carry-over.service.ts`: an untagged
  resolution while a launch is pending is never bound. The new `claimUntaggedPending` aborts it.
  `claimExpired` no longer aborts when the tab holds no session (a new chat started there).
  The `ExpiredCarryOver` marker has one `until`. New `CARRY_OVER_IN_FLIGHT_TEXT`.
  `ngOnDestroy` clears the deadline timers.
- MODIFIED `libs/frontend/chat/src/lib/services/provider-carry-over-launch.ts`: on `IN_FLIGHT`, a
  button launch that still owns the UI shows the short notice and keeps the offer. The marker
  uses `CARRY_OVER_LATE_RESOLUTION_MS` from shared. It is still loaded only through the dynamic
  import.
- MODIFIED specs: `chat-carry-over.service.spec.ts`, `provider-carry-over.service.spec.ts`,
  `provider-carry-over.relink.integration.spec.ts` (its resolutions now carry the latest launch's
  request ID, as the host stamps them).
- Extra scope (CI, spec-only):
  - `chat-session.host-routing.spec.ts`: `opts.activeProvider as never`, like the other mock
    arguments in the same call.
  - `chat-history-read.service.spec.ts` and `handlers/session-native-history.spec.ts`:
    `readCarryOverTranscript: jest.fn()` added to the legacy reader mock.
  - `message-sender.service.spec.ts`: `requestId` is checked with a UUID v4 matcher. That spec
    has no other exact carry-over param assertion; line ~1956 is a `not.toContain` check.

## TTL arithmetic

Times: the renderer sends the RPC at `t0`. The host receives it at `h0 >= t0` and admits the
start at `tI >= h0`. The renderer receives the accepted result at `tA >= tI`.

Renderer release of the tab:

- **Accepted:** `tA + CARRY_OVER_RESOLUTION_DEADLINE_MS` = `tA + 90 s`.
- **Indeterminate** (timeout, abort or throw): `t0 + CHAT_ADMISSION_RPC_TIMEOUT_MS +
  CARRY_OVER_RECOVERY_MS` = `t0 + 120 s + 30 s`.

Host tag (`tagUntil`) = `min(tI + 90 s, h0 + 120 s)`.

- **Accepted path:** `tagUntil <= tI + 90 s <= tA + 90 s`. The host tag ends first, by the
  admission-to-result latency.
- **Indeterminate path:** `tagUntil <= h0 + 120 s`, about `t0 + 120 s` plus the IPC latency. The
  renderer releases at `t0 + 150 s`, so the host tag ends about 30 s earlier.
- **Cost:** if admission comes more than 30 s after receipt, the tag window is shorter than 90 s.
  A resolution after the tag ends arrives untagged while the renderer is still pending. It is
  aborted, and the tab expires with "Try again". This fails closed, in rare slow admissions only.

Host retry block: `blockUntil = tagUntil + CARRY_OVER_LATE_RESOLUTION_MS` (120 s), unless a claim
retires it sooner. The renderer's late window is `release + 120 s`, and `release >= tagUntil`, so
the whole block lies inside the renderer's late window. A late untagged init during the block is
always recognised and aborted.

Arithmetic for a timed-out launch: the tag lapses at most 90 s after admission, and the block at
most 210 s after admission.

## Refusal reason

The existing `IN_FLIGHT` reason is reused, with the host's existing text "This conversation is
already being continued." No union change was needed.

- **Button:** the notice is `CARRY_OVER_IN_FLIGHT_TEXT` ("The previous new chat may still be
  starting. Try again in a moment."), shown through `actionBanner.showInfo(text, tabId,
  CARRY_OVER_NOTICE_MS)`, the same mechanism as the expiry notice. The offer and banner stay, and
  the tab is released.
- **/compact:** unchanged (`CARRY_OVER_BUSY_TEXT`).

AUTH_REQUIRED and `chat:continue` are untouched.

## How the Finding 1 sequence now ends

1. A expires in the renderer. The host's tag for A lapsed earlier, but A's block is still held.
2. Retry B is refused with `IN_FLIGHT`: notice shown, offer kept.
3. A's late init claims the ticket, gets no tag, and retires it.
4. The renderer has nothing pending. The tab is still on the refused session and the late window
   is open, so A is aborted and not bound.
5. B is then admitted and binds only with its own ID.

Remaining residual: A's init arrives more than about 210 s after admission and also after B was
admitted. That case would still take B's tag. It needs process-level ownership, which the user
ruled out (row 76).

## Tests

Backend `chat-carry-over.service.spec.ts`, in the "ticket lifetime and the retry block" group
(`Date.now` is mocked with a spy and restored in `afterEach`):

- The tag lasts `CARRY_OVER_RESOLUTION_DEADLINE_MS` after admission and not 1 ms longer.
- A late admission ends the tag at `receipt + CHAT_ADMISSION_RPC_TIMEOUT_MS`.
- A retry is refused with `IN_FLIGHT` while the ticket is held, including a retry without a
  request ID. There is one start, and A keeps its tag.
- Old init after expiry: the retry is refused, A's late claim is untagged and retires the ticket,
  then the retry is admitted and claims its own ID.
- An unclaimed ticket stops blocking after `tagUntil + CARRY_OVER_LATE_RESOLUTION_MS` (boundary
  checked).
- A ticket on one tab does not block another tab.

Frontend `provider-carry-over.service.spec.ts`:

- An untagged resolution during a tagged pending launch is skipped and aborted. The pending launch
  is kept, the old session is never aborted, and the retry binds with its tag.
- Old init after retry: the host's `IN_FLIGHT` shows the notice and keeps the offer, the late
  untagged init is aborted (never bound as B), and the retry then binds.
- An ordinary new chat in the released tab (tab reset to no session, inside the late window) gets
  `'none'` and no abort.
- An expired request ID is recognised up to `CARRY_OVER_LATE_RESOLUTION_MS` and lapses after it.
- The constants assertion: host tag after admission <= renderer hold after acceptance. Host tag
  after receipt < `CHAT_ADMISSION_RPC_TIMEOUT_MS + CARRY_OVER_RECOVERY_MS`.
  `CARRY_OVER_LATE_RESOLUTION_MS === CHAT_ADMISSION_RPC_TIMEOUT_MS`.
- Destroying the service clears an armed deadline (`jest.getTimerCount()` goes from 1 to 0).
- `IN_FLIGHT` on the button now expects the notice.
- The existing bind cases pass the launch's request ID (`requestIdOf`, moved to the top level).

## Verification

All jest runs went through `node scripts/verify.mjs --exec --task fix5-jest`:

1. `npx jest -c libs/backend/rpc-handlers/jest.config.ts .../chat-carry-over.service.spec.ts`:
   **1 suite, 48/48 passed**, no worker warning.
2. `npx jest -c libs/frontend/chat/jest.config.ts` on `provider-carry-over.service.spec.ts`,
   `provider-carry-over.relink.integration.spec.ts` and `provider-carry-over.lazy-boundary.spec.ts`:
   **3 suites, 78/78 passed**. The "worker failed to exit gracefully" warning no longer appears:
   `ngOnDestroy` clears the armed 90 s timer when `TestBed.resetTestingModule()` runs.
3. A third run, which the orchestrator's extra-scope message authorized. It ran in one lock slot:
   - rpc-handlers: `chat-session.host-routing.spec.ts`, `chat-history-read.service.spec.ts` and
     `session-native-history.spec.ts`. **3 suites, 41/41 passed.** One "worker failed to exit
     gracefully" warning was printed for this run. It comes from one of these three existing specs:
     I changed only mock shapes there, and the carry-over spec ran clean in run 1. Not
     investigated, because no runs were left.
   - chat: `message-sender.service.spec.ts`. **1 suite, 90/90 passed.**

ts-jest type-checks the specs and their imports, which is how CI reported the TS2345 and TS2741
errors. The passing suites are therefore evidence that the changed specs type-check. This is not a
project typecheck.

`ptah_get_diagnostics` was called three times with only the changed files. Each call returned
"TypeScript check still running after 45s" (unavailable). There is no diagnostics claim.

Not run: lint, typecheck targets, `npm run verify`, di-lint and degradation-audit. No new catch was
added. The only new "swallow" is the `IN_FLIGHT` notice branch, which is not a catch.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| The retry block lasts past the tag's end: `blockUntil = tagUntil + CARRY_OVER_LATE_RESOLUTION_MS`, and it ends early at the next claim. | (a) Block only while the tag lives (strict reading). (b) Keep the block after the tag lapses, until a claim or the late window ends. | With (a), the tag lapses before the renderer's release. A retry after the release is admitted, A's later init claims B's ticket, and A binds as B, so the brief's required test fails. The brief also expects the refusal to show a notice after a release, which only (b) produces. The tag itself still never outlives the release. | Yes: one line in `issueTicket`. |
| Host tag = `min(admission + 90 s, receipt + 120 s)`. | (a) `admission + 90 s` only. (b) `receipt + 150 s`. (c) The min above. | (a) can outlive the indeterminate release when admission is late. (b) ends after the renderer by the IPC latency. (c) ends first on both paths (arithmetic above), and the user preferred the host expiring earlier. | Yes. |
| Reuse `IN_FLIGHT`. | `IN_FLIGHT`, or a new additive reason. | The existing reason already means "a continuation of this is still running". The renderer branch exists, and the brief says to reuse it when it fits. | Yes. |
| New notice text `CARRY_OVER_IN_FLIGHT_TEXT`, shown through the existing notice mechanism. | Reuse `CARRY_OVER_EXPIRED_TEXT` ("didn't start"), or new text. | "Didn't start" would be wrong: the earlier launch may still start. | Yes. |
| `claimExpired` returns `'none'` for a tab with no session. It still aborts when the tab is on the refused session, or rebound to another session. | Keep today's abort-all inside the window, or treat a session-less tab as a new chat. | `resetTabToFresh` and `applyNewConversationDraft` set `claudeSessionId: null` (`libs/frontend/chat-state/src/lib/tab-manager.service.ts`). Without this change, an ordinary new chat within 120 s of a release is still aborted (Finding 2 in untagged form). | Yes. |
| An untagged resolution while pending is aborted and does not release the pending launch, unless its tab is gone or rebound. | Release on abort, or keep waiting. | This matches the existing handling of a foreign tagged resolution. The deadline releases the tab with "Try again". | Yes. |
| `CARRY_OVER_LATE_RESOLUTION_MS` moved to shared, and `CARRY_OVER_REQUEST_ID_TTL_MS` removed. The renderer marker keeps a single `until`. | Keep both constants and both fields. | The rule is to replace rather than accumulate. The 210 s ID memory no longer matches any host lifetime. | Yes. |
| `ProviderCarryOverService.ngOnDestroy` clears the timers. | Clear them in each spec, or give the service a destroy path. | Every timer needs a release path, and this also removes the jest worker warning in the touched specs. | Yes. |

## Out-of-scope observations

- An unresolved launch released by `onChatError` keeps its host ticket. Until a claim or the block
  lapses (at most about 210 s after admission), a retry on that tab gets the `IN_FLIGHT` notice.
  The host has no chat-error hook into `ChatCarryOverService`.
- The host does not stop two concurrent pre-admission launches for different sessions on the same
  tab, because `inFlight` is keyed by session. The renderer's per-tab pending entry prevents this
  in practice. This predates the change.
- One of the three rpc-handlers specs in run 3 leaves a worker open. These specs predate this task,
  and I did not identify which one.
