# Batch B4 report: Components 5 and 6 (TASK_2026_655)

- Worktree: `D:\projects\ptah-extension\.claude-worktrees\feat-session-handoff-b4` (branch `feat/session-handoff-b4`, base cb01a5f16).
- Not committed. Nothing in the main checkout was edited apart from this report.
- Stack: Angular 20 standalone, signals. Services are `@Injectable` with `inject()`. The webview reaches the host only through `ClaudeRpcService.call`, typed by `@ptah-extension/shared`, and through `MESSAGE_TYPES` pushes. These changes add no component and no template.

## Changed files

Every path is relative to the worktree root. Line numbers are taken after prettier.

### `@ptah-extension/chat-state`

- MODIFIED `libs/frontend/chat-state/src/lib/tab-manager.service.ts`
  - `:108` adds `SessionHandoffAdoptionResult`, with the values `'adopted' | 'exists' | 'source-absent' | 'invalid'`.
  - `:116` adds `firstUserTurn()`. It is the optimistic `msg_` first user turn, now shared by the child tab and the handoff tab. The child tab's behaviour does not change.
  - `:1059` adds `adoptHandoffTab(payload)`, which does the following:
    - It parses the tab id with `TabId`.
    - It is idempotent: it uses `locateTabInPanel`.
    - It finds the source tab by `fromTabId`, then by session id (`fromTabId`, then `fromSessionId`).
    - It places the new tab after the source with `insertTabAfter`, or with `addTabToWorkspace` when the source is in a background partition.
    - It focuses the new tab only when the source is the active tab, and then calls `saveTabState`.
  - `:1099` adds `locateSessionTab(tabId, sessionId)`, generalised from the private `locateAgentSessionParent`. `adoptAgentSessionTab` now calls it too.
  - `:1175` adds `buildHandoffTab()`. It builds an ordinary tab:
    - `name` and `title` are set to `label`, and `titleOrigin` is `'user'`.
    - `status` is `'streaming'` and `hasLiveSession` is `true`.
    - `claudeSessionId` is `null`.
    - It has no `agentOrigin`.
- MODIFIED `libs/frontend/chat-state/src/index.ts:17`: exports `type SessionHandoffAdoptionResult`.
- CREATED `libs/frontend/chat-state/src/lib/tab-manager.handoff-adoption.spec.ts`, with 10 tests:
  - placement after the source, the tab shape, and that there is no `agentOrigin`;
  - focus when the source is active;
  - no focus theft when another tab is active;
  - idempotency;
  - `source-absent`;
  - finding the source by session id;
  - rejecting an `invalid` tab id;
  - a background partition, where focus does not change;
  - no active workspace;
  - persistence of the new tab and the active tab across a reload.

### `@ptah-extension/chat`

- MODIFIED `libs/frontend/chat/src/lib/services/agent-session-adoption.service.ts`
  - `:96` adds `parseSessionHandoffOpenedPayload()`, a hand-written validator in the same style as `parseAgentSessionOpenedPayload`.
  - `:309` adds `adoptHandoff()`. It never throws. On `adopted` it requests a canvas tile with `focus` equal to `activeTabId() === tabId`, so the tile takes focus exactly when the tab bar did.
  - `:349` changes `requestCanvasTile(tabId, label, focus)` into a general helper. The child path still passes `false`.
- MODIFIED `libs/frontend/chat/src/lib/services/chat-message-handler.service.ts`
  - `:145` adds `SESSION_HANDOFF_OPENED` to the handled types.
  - `:219` adds the switch case.
  - `:231` adds `handleSessionHandoffOpened`. It parses the payload, then either warns and drops it with `describePayload`, or calls `adoptHandoff`.
- MODIFIED `libs/frontend/chat/src/lib/services/session-budget-actions.service.ts`
  - `:59` adds `SESSION_HANDOFF_COMMAND = '/session-handoff'`.
  - `:65` adds `buildHandoffCommand(budget)`, which returns `/session-handoff This session has used {used} tokens.` and reuses `usedFigure`.
  - `:178` changes `sendWrapUp()`:
    - The one-send guard is still set before any await.
    - The probe and the send run inside the existing try block.
    - It sends the slash command when the skill is present, otherwise the inline prompt.
  - `:208` adds `handoffSkillAvailable()`. It calls `ClaudeRpcService.call('autocomplete:commands', { query: 'session-handoff', maxResults: 10, ...pickerWorkspaceScope(workspaceRoot) })`. It returns true only when the call succeeds and the result contains a command whose name is exactly `session-handoff`. A failure or a throw returns `false`. The class and method doc comments were updated.
- MODIFIED specs:
  - `agent-session-adoption.service.spec.ts:364` and `:425`: handoff adoption cases (focus true/false; no tile for `exists`, `source-absent` or `invalid`; no throw on a fault; no RPC), plus parser accept and reject cases.
  - `chat-message-handler.service.spec.ts:477`: routing to `adoptHandoff`, and dropping 5 kinds of invalid payload with a warning.
  - `session-budget-actions.service.spec.ts:221`, with 7 cases:
    - the command text;
    - the skill is present: the probe arguments are checked and the command is sent once;
    - only a similarly named command exists: the prompt is sent;
    - the probe fails: the prompt is sent;
    - the probe throws: the prompt is sent and no error banner is shown;
    - a double click during the probe: exactly one send;
    - a rejected send re-enables the button.
  - The `setup()` in that spec now provides `ClaudeRpcService` and `VSCodeService` fakes.

Prettier `--write` was run on the touched files. In `tab-manager.service.ts`, `chat-message-handler.service.ts` and two specs it also reflowed a few lines this batch did not write. lint-staged would make the same change at commit.

## Autopilot / permission level of the handoff tab (new requirement)

- **This webview has no per-tab autopilot state.**
  - `TabState` (`libs/frontend/chat-types/src/lib/chat-types.ts:538`) has no permission or autopilot field.
  - The composer pill (`chat-ui/.../autopilot-popover.component.ts:191`) and the composer tint (`chat-input.component.ts:462,646-651`) read the root singleton `AutopilotStateService` (`core/.../autopilot-state.service.ts:61-92`).
  - That service loads once from `config:autopilot-get` (`:255-275`). It changes only when the user toggles it (`:147`, `:195`) or on `PLAN_MODE_CHANGED` (`:64-71`).
  - Nothing calls it on tab create, tab switch or adoption.
- **The handoff tab therefore shows the same level the source tab showed, and nothing resets it.**
  - `adoptHandoffTab` and `adoptHandoff` write no autopilot state and make no RPC. The spec "makes no RPC: the autopilot level is never written or reset" pins this.
  - On the backend, B2 starts the session at the caller record's `permissionLevel` (batch-B2-report.md, "Permission level / autopilot inheritance"). The actual gating matches the source session.
- **No code to "set the tab's level" was added.**
  - There is no per-tab slot to set.
  - Writing the level into `AutopilotStateService` would call `config:autopilot-toggle`, which rewrites the global config. That is a side effect the user did not ask for.
  - The payload (`SessionHandoffOpenedPayload`, B1) also does not carry the level.
- **Residual risk, outside B4.** The display could differ from the real gating only if the source session's record level had already drifted from the global toggle. This can happen because `config:autopilot-toggle` with no `sessionId` reaches only `getActiveSessionIds()[0]` (`rpc-handlers/.../config-rpc.handlers.ts:369-380`), and the popover never passes a `sessionId` (`autopilot-popover.component.ts:231-250`). The same gap applies to switching between any two tabs; it is not specific to handoff. Fixing it would need per-tab autopilot state, which is a design change, and a session-targeted toggle.

## A2: does a slash command queued during a running turn reach the router?

Yes, from code, as long as nothing else is already queued on that tab.

1. The banner calls `ChatStore.sendOrQueueMessage`. While the tab streams, `message-dispatch.service.ts:183-198` calls `conversation.queueOrAppendMessage(content, options)`.
2. That stores the trimmed text as `queuedContent` (`conversation.service.ts:117,127-135`).
3. When the turn ends, `chat.store.ts:419-431` calls `messageDispatch.sendQueuedMessage(tabId, content)`.
4. `sendQueuedMessage` (`message-dispatch.service.ts:222-250`) calls `messageSender.continueExistingSessionForQueueFlush(...)` (`message-sender.service.ts:553-568`). That calls `runContinueConversation`, which calls `claudeRpcService.call('chat:continue', { prompt: content, sessionId, tabId, ... })` at `message-sender.service.ts:691-696`.
5. On the backend, `chat-session.service.ts:944` checks `SlashCommandInterceptor.isSlashCommand(prompt)`. The regex is `/^\/[a-zA-Z]/` on the trimmed text (`slash-command-interceptor.ts:39,47-48`). Then `:970-977` calls `routeFollowUpSlashCommand`.
6. In the router, `chat-slash-command-router.service.ts:80,114-137` intercepts with `new-query` and calls `sdkAdapter.executeSlashCommand`.

Caveats to check manually in Electron:

- **The command can be appended to text already queued.** If the tab already has queued text, the command is appended after it as `${existingQueue}\n/session-handoff …` (`conversation.service.ts:122-126`). The merged prompt does not start with `/`, so the router passes it through as a plain message (a `passthrough` result) and the skill is not invoked as a command.
- **Pending permission prompts are denied.** While the turn streams, any pending permission prompt of that tab is answered `deny_with_message` with the command text as the reason (`message-dispatch.service.ts:187-196`). This is the same as for any typed follow-up.
- **A background tab keeps the command queued.** `sendQueuedMessage` looks the tab up in `tabManager.tabs()`, the active partition only (`:226`). If the tab sits in a background partition when the flush fires, the message stays queued (`:228-238`).

## Checks (cwd = worktree, one at a time)

- `npx jest -c libs/frontend/chat-state/jest.config.ts libs/frontend/chat-state/src/lib/tab-manager.handoff-adoption.spec.ts libs/frontend/chat-state/src/lib/tab-manager.agent-adoption.spec.ts --coverage=false --maxWorkers=1`: 2 suites, 26 of 26 tests passed. Re-run after prettier with the same result.
- `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/services/session-budget-actions.service.spec.ts libs/frontend/chat/src/lib/services/agent-session-adoption.service.spec.ts libs/frontend/chat/src/lib/services/chat-message-handler.service.spec.ts --coverage=false --maxWorkers=1`: 3 suites, 125 of 125 tests passed. Re-run after prettier with the same result.
- `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/components/templates/chat-view --coverage=false --maxWorkers=1`: 4 suites, 98 of 98 tests passed. These are the specs that construct `SessionBudgetActionsService`, now with its new `inject()` calls.
- `ptah_get_diagnostics` on the 4 changed source files: none of the requested files has a diagnostic. Errors in sibling spec files are older than this batch; examples are `session-identity.spec.ts:194` and `tab-manager.lifecycle.spec.ts:382`.
- `npx eslint <9 changed files>`: 0 errors and 1 warning. The warning is `max-lines` on `tab-manager.service.ts` (1594 lines, limit 700). The file was already well over the limit before this batch, which added about 100 lines. `@nx/enforce-module-boundaries` was skipped because there was no cached project graph. New imports are `core` and `shared` only.
- Not run, as instructed: `nx test`, `nx typecheck` and `nx lint` on whole projects (the orchestrator runs `npx nx run-many -t test -p @ptah-extension/chat-state @ptah-extension/chat --parallel=1`), and any build, serve or e2e target.

## Decisions

- **Focus.** Focus moves only when the source tab is the active tab, as the plan requires. The canvas tile gets `focus = (activeTabId === new tab)`, not a hard-coded `true`, so the canvas and the tab bar always agree. When the source is in a background partition, neither the tab bar focus nor that partition's active tab changes.
- **No `settled` set for handoffs.** The message is push-only, with no late `chat:agent-sessions` re-adoption, so the tab manager's idempotency is enough. A missed handoff tab is still reachable from the sidebar.
- **No tile for `exists`.** Only `adopted` requests a tile. A duplicate push would otherwise re-request one. The canvas dedups requests, but this avoids the request entirely.
- **The source partition decides placement.** The tab goes into the source tab's partition, as with child tabs. `payload.workspaceRoot` and `payload.cwd` are validated but not used for placement.
- **Probe result handling.** The probe matches the name exactly, not as a substring, because `autocomplete:commands` filters with `includes` and the spec covers a similarly named command. A probe failure falls back silently, with no banner, because the inline prompt does the same job.
- **No per-tab autopilot state.** It was not introduced, for the reasons given in the autopilot section above.
- **Generalised helpers.** `locateAgentSessionParent` was generalised to `locateSessionTab`, and the first-turn builder was extracted. Both are used by the child flow and the handoff flow; the child specs (16 tests) still pass.

## Out-of-scope observations (not touched)

- `libs/shared/src/lib/types/rpc/host-source-registry.baseline.ts:424+` lists `agentSession:opened` in `BASELINE_MESSAGE_TYPES`, but not `sessionHandoff:opened`. The file says that any change needs a Gate 2 exception (TASK_2026_610). It belongs to B1/shared, so the orchestrator should check whether a spec compares it with `MESSAGE_TYPES`.
- The queue-append caveat in A2 means the banner's slash command can be swallowed into a prior queued draft. A possible fix belongs in `conversation.service.ts` (keep a slash command as its own queued message) and is not part of this plan.
