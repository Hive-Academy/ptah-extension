# Batch 7 report: message sender (offer, guard, `/compact`) and relink guard

Executor: frontend-developer subagent. I implemented Tasks 7.1 to 7.4. I ran no git command and
did not touch `libs/backend`, `libs/frontend/onboarding`, the Codex sign-in code, `batches.md`
or `task.md`.

All paths below are under
`/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/`.

## Files

- MODIFIED `libs/frontend/chat/src/lib/services/message-sender.service.ts`: offer origin, pending
  guard, `/compact` branch, P4 = A fail-closed rule.
- MODIFIED `libs/frontend/chat/src/lib/services/message-sender.service.spec.ts`: new
  `provider carry-over` block. The `AuthStateService` mock gained the banner and
  active-provider signals.
- MODIFIED `libs/frontend/chat/src/lib/services/chat-store/chat-lifecycle.service.ts`: the claim
  runs first, plus `onChatError`.
- MODIFIED `libs/frontend/chat/src/lib/services/chat-store/chat-lifecycle.service.spec.ts`
- MODIFIED `libs/frontend/chat/src/lib/services/chat-message-handler.service.ts`: the
  claimed-surface claim (F3).
- CREATED `libs/frontend/chat/src/lib/services/provider-carry-over.relink.integration.spec.ts`

## Task 7.1: `MessageSenderService`

- **Offer origin.** At the `chat:continue` refusal, `handleAuthRequired(result, origin)` gets
  `{ sessionId, tabId, workspacePath }`, but only when `resolvedWorkspacePath` is set. The
  session id and the tab id are always set at that point. With an origin, it calls
  `flagAuthRequired(providerId, message, origin)` and passes the returned generation to
  `offerFor`.
  - `offerFor` is not awaited. Its sync throws and its rejections are caught and logged with the
    error class name only.
  - The `chat:start` site passes no origin and still calls `flagAuthRequired` with two
    arguments, exactly as before.
  - The offer decision never reads `result.data.error`. The refusal handling after it
    (rollback, `markLoaded`, `markTabIdle`, the outcome text) is unchanged.
- **Pending guard.**
  - `isCarryOverPending(options)` mirrors `isHeld`. It is checked at both entries, `send` and
    `continueExistingSessionForQueueFlush`, right after the `isHeld` check. It returns
    `{ success:false, error: CARRY_OVER_BUSY_TEXT }` with no RPC.
  - Because `send` checks it before routing, it covers both the start branch and the continue
    branch.
  - A second check sits inside `runContinueConversation`, after the second `isHeld` check, for
    a carry-over that starts during the awaits (see Deviations).
- **`isCompactCommand`** (exported function) mirrors E43: `trim`, `/^\/[a-zA-Z]/`, and the name
  up to the first space must be exactly `compact`.
- **`/compact` branch.** It runs when `resolvedWorkspacePath` is set and the content is
  `/compact`. It sits after the `activeTabId` check and the second `isHeld` check, and before
  `setStatus('resuming')`, the bubble and `chat:continue`. `tryCompactCarryOver` maps each
  result:
  - `'not-eligible'`: today's path, unchanged.
  - `'busy'`: `{ success:false, error: 'A new chat is starting in this tab.' }`.
  - A launch outcome: returned as the send outcome. No bubble, no boundary, no `markResuming`
    and no `chat:continue`.
  - `'check-failed'` (B6-1): see P4 = A below. An unexpected throw from `tryCompact` also counts
    as `'check-failed'`.
  - After a fall-through, `isHeld` is checked again, because the check can take up to 5 s.
  - Arguments are never forwarded (K21): `tryCompact` gets only the session, tab, workspace and
    name.
- **P4 = A (row 38).**
  - Rule: on `'check-failed'`, `/compact` fails closed with `CARRY_OVER_CHECK_FAILED_TEXT` =
    "Couldn't check this conversation. Try /compact again." and sends nothing. This happens only
    when `sessionProviderDiffers(tabId, tab)` is true. Otherwise today's `/compact` runs.
  - "Differs" means all of the following hold:
    - the tab carries its stored session provider (`TabState.providerId`, set from the session
      list or the resume result in `session-loader.service.ts:992,1075,1082`);
    - `AuthStateService.activeProviderId()` is loaded;
    - the two are different;
    - the tab is in the active workspace, because the auth state describes only that workspace.
  - Anything unknown counts as "not known to differ". See Decisions.
  - The text reaches the tab through the existing send-failure channel
    (`message-dispatch.service.ts:251/320` `showSendFailure`). That channel prefixes it with
    "Message delivery failed.".
- **U2 = A (row 32).** No pre-send disclosure for `/compact`. The disclosure is in the notice
  after the bind (`completeBinding`, Batch 6), and the integration spec checks it (case 3).
- **A4** holds. With no workspace path there is no origin, no offer and no
  `chat:carry-over-check`, and today's `/compact` runs. A spec proves this.
- **A5** (search of `libs/frontend` and `apps/ptah-extension-webview` for `chat:start`,
  `chat:continue` and `chat:resume`):
  - `message-sender.service.ts` `send` / `continueExistingSessionForQueueFlush`: guarded.
  - `mcp-apps-page/.../apps-session.service.ts` (start and continue): these use the apps page's
    own `conversation.routingId`, not chat tabs, so a chat-tab carry-over cannot be pending
    there.
  - `chat-store/session-loader.service.ts` `chat:resume` (`:1006`, `:1830`): this loads history
    for a tab. It sends `activate: true` only when there is no `targetTabId` (opening into a new
    tab), and it carries no prompt, so it is not a prompt launch on a pending tab. I did not add
    a guard there: the file is outside the batch, and the host's AUTH_REQUIRED refusal still
    covers it. The phase review should confirm this reading.

Specs (`message-sender.service.spec.ts`, describe `provider carry-over`, real
`ProviderCarryOverService`, host RPCs mocked):

| Case | ACs |
| ---- | --- |
| AUTH_REQUIRED continue: `flagAuthRequired` gets the origin, and `offerFor` is called once with the generation | 1.1, 7.1 |
| A rejected `offerFor` keeps today's refusal outcome | 1.4 (refusal path unchanged) |
| `chat:start` refusal: two-argument flag, no offer | 7.1 (start passes no origin) |
| No workspace: no origin, no check, today's `/compact` | A4 |
| Pending tab: continue, `/compact`, start and queue flush each return the busy outcome with zero RPCs; another tab still sends | F3 Rev 1, 5.4 |
| Claude -> Codex eligible: check with `{ timeout: 5000 }`, one `chat:carry-over` with the exact params, no `chat:continue`, no bubble, no boundary, no `markResuming`, tab pending | proposed 9.1, 9.2, 9.5 |
| Codex -> Claude eligible (RPC mocked): same | 9.1, 9.2 (both directions) |
| Not eligible, check RPC error, check timeout and check throw, with no known mismatch: `chat:continue` params `toEqual` today's literal params | 1.5, proposed 9.3 |
| Not eligible with a known mismatch: today's path | 9.3 (only check failures fail closed) |
| Check error and check timeout with a known mismatch: the fail-closed text, nothing sent, no bubble, not pending | row 38 (P4 = A), amended 9.3 |
| Failed check with the same known provider, and for a background-workspace tab: today's path | row 38 ("all other cases") |
| `/compact focus on tests` redirected, arguments not in the carry-over params; `/compactx`, `/compact\nfoo` and `ultracode: /compact` not redirected | E43, K21 |
| Queued `/compact` through the flush is redirected | proposed 9.6 |
| Session busy in another tab: busy outcome, no launch, no continue | 5.4 |
| Carry-over failure (`HISTORY_UNREADABLE`, no banner) is the send failure | 5.1 (compact half) |
| A plain prompt never calls `chat:carry-over-check` | K22 |

## Task 7.2: lifecycle branch claim

- `handleSessionIdResolved` calls `claimCarryOver` first. A throw counts as `'none'` and is
  logged with ids and the error class only.
  - `'skip'`: only the existing `loadSessions()` refresh, then return. No owner attach and no
    active-tab fallback.
  - `'bind'`: the existing owner attach, then `completeBinding(tabId)`.
  - `'none'`: today's code.
- The refresh became the private helper `refreshSessionsAfterResolution`, with the same log
  text, so both exits share it.
- `handleChatError` calls `carryOver.onChatError(data.tabId)` when `tabId` is set.

Specs (`chat-lifecycle.service.spec.ts`, mocked `ProviderCarryOverService`):

- `'skip'` with the tab gone: no `attachSession`, including the sessionless-streaming fallback,
  and one refresh (AC 7.6).
- `'skip'` with the tab rebound: no attach, and the tab keeps its session (AC 7.7).
- `'bind'`: attach, then `completeBinding`, in that order (AC 4.1).
- `'none'`: today's path, with no `completeBinding`.
- A claim throw: today's path.
- `handleChatError` with a tab id calls `onChatError`. Without a tab id it does not.

## Task 7.3: claimed-surface branch claim (F3)

- In `ChatMessageHandler.handleSessionIdResolved`, `renderedSurfaceFor(tabId)` is now computed
  first. It is pure and has no ordering effect. When a surface is claimed, the claim runs
  **before** `liveness.rekey`, so P7 is satisfied (a `'skip'` does not rekey the refused tab).
  - `'skip'`: return with no rekey, no `onSurfaceCreated`, no
    `refreshQuestionTargetsForSession` and no attach. It requests one
    `chatStore.loadSessions()` refresh (A9; see Deviations).
  - `'bind'`: today's rekey, `onSurfaceCreated` and refresh, then
    `chatStore.handleSessionIdResolved({ tabId, realSessionId })`. That reaches the lifecycle
    claim, which is pure for `'bind'`, so it attaches and calls `completeBinding`. One binding
    path serves both branches (K20).
  - `'none'`: today's calls in today's order.
  - A claim throw counts as `'none'`.
- Unclaimed tabs are not claimed here. The lifecycle claims for them. This avoids a double claim
  in which a `'skip'` would delete the entry and the second claim would then return `'none'`.
- `ProviderCarryOverService` is injected with `inject()`. It depends on none of the handler's
  consumers.

## Task 7.4: relink integration spec

`provider-carry-over.relink.integration.spec.ts` wires these as real services:
`TabManagerService`, `TabWorkspacePartitionService`, `ConversationRegistry`,
`TabSessionBinding`, `StreamingHandlerService`, `StreamRouter`, `WorkflowSessionClaimService`,
`StreamingSurfaceRegistry`, `ChatMessageHandler`, `ChatLifecycleService`,
`ProviderCarryOverService`, `AuthStateService` and `MessageSenderService`.

`ChatStore` is a facade that forwards `handleSessionIdResolved` to the real lifecycle, as
`chat.store.ts:587-591` does. The accumulator is deterministic, as in
`streaming-handler.cross-workspace.spec.ts`. The host RPCs are mocked. Every assertion names the
tab id.

- **Case 1, lifecycle branch** (banner -> offer -> button -> `SESSION_ID_RESOLVED`):
  - the tab's `claudeSessionId` is NEW (AC 4.1);
  - the pending entry and the banner are cleared;
  - the notice is shown once with `carryOverNotice('Codex')`;
  - the new `generating` turn state is accepted (A2);
  - the new session's first text delta lands in the tab's streaming state while the two old
    messages stay (AC 2.2);
  - the conversation sessions are `[OLD, NEW]` (AC 4.2);
  - zero `chat:continue` and zero `chat:start` calls, and one `chat:carry-over` call (AC 4.6).
- **Case 2, claimed-surface branch:**
  - `'bind'`: the tab is bound to NEW, not pending, and `onSurfaceCreated` is called once with
    NEW. The notice appears exactly once, after the attach, and not before the resolution
    event (AC 4.3, F3).
  - `'skip'` (rebound): no attach, no `onSurfaceCreated`, no lifecycle call and no notice. The
    tab keeps OTHER. Exactly one `chat:abort { sessionId: NEW }` is sent. The tab is not
    pending, and one session-list refresh is requested (AC 7.7, A9).
  - `'none'`: `onSurfaceCreated` runs before `refreshQuestionTargetsForSession`, with no
    lifecycle call, no attach and no notice.
- **Case 3** (`/compact` through the real `MessageSenderService`):
  - eligible, then `{ success:true }`. The tab is pending and no notice is shown yet;
  - one `chat:carry-over` with `ptahUiFence: true` (Electron);
  - after `SESSION_ID_RESOLVED`, the tab is bound to NEW with one notice. The old messages are
    kept and no `chat:continue` is sent (proposed AC 9.4).

**A2**: the spec asserts that `applyTurnState(tabId, generating, NEW)` is accepted after the
attach. `acceptsTurnState` takes it because the tab is bound to NEW and the recorded revision
belongs to another session. I did not add the `markTabStreaming` fallback, because nothing here
drops the first `generating` once it arrives after the resolution. A `generating` that arrives
**before** `SESSION_ID_RESOLVED` would still be refused while the tab holds OLD
(`tab-manager.service.ts` `acceptsTurnState`, `bound !== sessionId`). Whether the host can send
one before the resolution is a host ordering question. I have not checked it, so it is a risk
for the phase review.

**A9**: refreshes are asserted in both skip paths (lifecycle unit spec and integration case 2).

## Verification

- Per decisions.md row 51, I ran no `npm run verify`, nx, jest or tsc command. CI on draft
  PR #914 runs them.
- I called `ptah_get_diagnostics` with `files` = the 6 changed files four times, and once with a
  single file. Every call returned "TypeScript check still running after 45s" (unavailable), so
  I have **no typecheck result**. I reviewed the types by hand instead:
  - I merged the duplicate `@ptah-extension/chat-types` import;
  - I wrote the `it.each` tables as typed objects;
  - I checked every API named in the specs against source: `markLoaded`, `setMessages`,
    `switchWorkspace`, `applyTurnState`, `StreamingSurfaceRegistry.register`,
    `WorkflowSessionClaimService.claim`, `createExecutionChatMessage`, `rpcSuccess`/`rpcError`,
    and the `@ptah-extension/chat-streaming` barrel exports.

## Decisions

| # | Decision | Options | Evidence | Reversible |
| - | -------- | ------- | -------- | ---------- |
| B7-1 | "Renderer knows the providers differ" = the tab's stored `providerId` and `AuthStateService.activeProviderId()` are both set and different, and the tab is in the active workspace. Anything unknown is today's path. | Compare with `effectiveProviderId`; treat an unknown stored provider as different. | Row 38 says "knows". `TabState.providerId` is documented as "Stored canonical provider for the bound session". `activeProviderId` maps the Claude-native methods to `anthropic`, as the host's `resolveActiveAuthForPath().providerId` does (`chat-carry-over.service.ts` compares the stored identity provider with that). The auth state covers only the active workspace. | Yes |
| B7-2 | The `/compact` branch sits after the second `isHeld` check and re-checks `isHeld` after a fall-through. | Before the `isHeld` check (the batch text says "before :778-797", which includes it). | A Command Center lock must stop any launch. The carry-over check can wait up to 5 s. | Yes |
| B7-3 | A throw from `tryCompact` counts as `'check-failed'` in the sender. | Let it reach the outer catch (a failed `/compact`). | A carry-over bug must not break `/compact`. Existing specs mock `rpc.call` with plain objects, which would also throw there. | Yes |
| B7-4 | The claimed-surface `'skip'` calls `chatStore.loadSessions()`. | Return with no refresh (the plan text). | Integration case 2 requires "the session list refresh is requested (A9)". The lifecycle `'skip'` refreshes too. | Yes |
| B7-5 | Only surface-claimed tabs are claimed in the handler. Unclaimed tabs are claimed in the lifecycle. | Claim every tab in the handler, before the rekey. | A second claim after a `'skip'` would return `'none'` and attach. The claim API has no peek for `'skip'`. | Yes |

## Deviations

- B7-2, B7-3 and B7-4 above.
- A second pending check inside `runContinueConversation`, after the second `isHeld` check. It
  is not in the batch text. It covers a carry-over started on the tab during
  `waitForServices` / `session:validate`.

## Risks and out-of-scope observations

- **Lifecycle-branch rekey (P7, lifecycle half).** For an unclaimed tab, the handler still runs
  `liveness.rekey(tabId, NEW)` before the lifecycle claim. So a lifecycle `'skip'` rekeys the
  tab's placeholder liveness entry to the aborted session. P7 names only the claimed-surface
  branch, and fixing it needs a claim "peek". The phase review decides.
- **DI in the existing `chat-message-handler.service.spec.ts`.** That spec does not provide
  `ClaudeRpcService`, `VSCodeService` or `AuthStateService`. `ChatMessageHandler` now injects
  `ProviderCarryOverService`, which constructs those real services and their dependencies:
  `ModelStateService`, `EffortStateService`, `PlanLimitsStore`, `ActionBannerService`. I expect
  them to construct cleanly (no constructor RPC is visible), but I could not run the spec. If CI
  shows a DI failure there, the fix is to add a `ProviderCarryOverService` stub provider to that
  spec. That spec is outside this batch.
- The P4 text is shown as "Message delivery failed. Couldn't check this conversation. Try
  /compact again." because `showSendFailure` adds the prefix. Changing that would mean editing
  `message-dispatch.service.ts`, which is outside the batch.
- `session-loader.service.ts` makes `chat:resume` calls without the guard. See A5.
