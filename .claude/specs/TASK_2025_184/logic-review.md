# Code Logic Review - TASK_2025_184 (Reasoning Effort Configuration)

## Review Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall Score       | 6/10           |
| Assessment          | NEEDS_REVISION |
| Critical Issues     | 1              |
| Serious Issues      | 3              |
| Moderate Issues     | 3              |
| Failure Modes Found | 6              |

## The 5 Paranoid Questions

### 1. How does this fail silently?

**Effort level silently ignored on follow-up messages to active sessions.** When `chat:continue` is called on an already-active session (not needing resume), the handler calls `sendMessageToSession(sessionId, enhancedPrompt, { files, images })` at `chat-rpc.handlers.ts:980-987`. The `effort` parameter from `ChatContinueParams` is never passed to `sendMessageToSession`. Since `effort` is a query-level SDK option (set when the query is created, not per-message), this is architecturally correct -- but the user has no way to know their effort selection is being ignored. They change the dropdown, send a message, and nothing changes.

**Queued messages lose effort level.** In `ChatStore.sendOrQueueMessage`, when the user sends a message during streaming, the code calls `this.conversation.queueOrAppendMessage(content)` which only preserves the text content. The `effort`, `files`, and `images` parameters are silently dropped. When the queued message is later drained and sent, it goes out without the user's selected effort.

### 2. What user action causes unexpected behavior?

**Changing effort mid-conversation has no effect.** User selects "max" effort, sends first message (creates session with max effort). User then selects "low" effort and sends a follow-up. The SDK query was already created with "max" effort -- the "low" selection is ignored because `effort` is a query-level config, not a per-message config. The UI gives no feedback that the change won't take effect until a new session starts.

**Rapid effort changes before first message.** User selects "max", immediately clicks send. Because `_selectedEffort` is a signal that's read at send time, this should work correctly. No race condition here.

### 3. What data makes this produce wrong results?

**Invalid effort values from RPC deserialization.** The `EffortLevel` type is `'low' | 'medium' | 'high' | 'max'`, but RPC deserialization from the webview does not validate this at runtime. A malformed webview message with `effort: "extreme"` would pass TypeScript compilation (since it crosses the RPC boundary as `unknown` and is only typed at the interface level) and be sent to the SDK, which may reject it or silently ignore it.

**ThinkingConfig with budgetTokens <= 0.** The `ThinkingConfig` type allows `{ type: 'enabled', budgetTokens: number }` with no minimum bound. A value of `budgetTokens: 0` or negative would be passed through to the SDK. The SDK may handle this gracefully, but there's no validation at the Ptah layer.

### 4. What happens when dependencies fail?

**SDK rejects unsupported thinking/effort combinations.** The `EffortLevel: 'max'` is documented as "Opus 4.6 only". If the user selects "max" with a Sonnet model, the SDK behavior is undefined from Ptah's perspective. There's no validation that the selected effort is compatible with the selected model. The SDK may return an error, which would surface as a generic chat failure.

**Third-party provider (Ptah CLI) doesn't support thinking/effort.** The effort and thinking params are threaded through to PtahCliAdapter, which passes them to the SDK query options. If the third-party provider's Anthropic-compatible API doesn't support these parameters, the behavior depends on how the provider handles unknown fields.

### 5. What's missing that the requirements didn't mention?

- **No persistence of effort selection.** When the user closes and reopens the webview, the effort selector resets to "Default". There's no localStorage or VS Code config persistence.
- **No visual indicator of active session effort.** Once a session is created with "max" effort, there's no UI showing what effort the current session is running at. The dropdown shows the user's current selection, which may differ from the session's actual effort.
- **No effort display in session history/stats.** When reviewing past sessions, there's no way to see what effort level was used.
- **No keyboard shortcut for effort.** Unlike the model selector, the effort selector has no keyboard shortcut for quick toggling.
- **No thinking budget UI.** The `ThinkingConfig` type supports `{ type: 'enabled', budgetTokens: number }` but there's no UI to configure this. It's dead type surface -- the only path to set it would be through a custom extension contributing to `ChatStartParams`.

## Failure Mode Analysis

### Failure Mode 1: Effort Ignored on Active Session Continue

- **Trigger**: User changes effort dropdown and sends message to an already-active session
- **Symptoms**: User sees no change in Claude's response behavior
- **Impact**: Medium -- user confusion, wasted time adjusting settings that don't apply
- **Current Handling**: Silently ignored; `sendMessageToSession` at `chat-rpc.handlers.ts:980-987` does not accept effort
- **Recommendation**: Either (a) disable effort selector when session is active with a tooltip "Effort is set per session, start a new chat to change", or (b) show a toast/warning when effort changes mid-session

### Failure Mode 2: Queued Message Drops Effort

- **Trigger**: User sends a message while Claude is streaming, message gets queued
- **Symptoms**: Queued message eventually sends but with whatever effort the session was created with (not the user's current selection)
- **Impact**: Low-Medium -- effort was already fixed at session creation, so this is consistent with FM1, but the queue also drops files and images which is a broader issue
- **Current Handling**: `conversation.queueOrAppendMessage(content)` only takes content string
- **Recommendation**: Track that this is a known limitation, or pass full message context to queue

### Failure Mode 3: Model-Effort Incompatibility

- **Trigger**: User selects "max" effort with a non-Opus model (e.g., Haiku)
- **Symptoms**: SDK error or unexpected behavior
- **Impact**: Medium -- session may fail to start
- **Current Handling**: None; no validation at Ptah layer
- **Recommendation**: Either validate effort vs model compatibility before SDK call, or handle SDK error gracefully with model-specific messaging

### Failure Mode 4: QueryOptionsInput Redundant Fields

- **Trigger**: Developer adds `thinking`/`effort` to the `QueryOptionsInput` object passed to `build()` instead of putting them in `sessionConfig`
- **Symptoms**: Values silently ignored because `build()` reads from `sessionConfig?.thinking`, not `input.thinking`
- **Impact**: Low (developer confusion, not user-facing)
- **Current Handling**: The `QueryOptionsInput` interface has `thinking` and `effort` fields (lines 257-262) that are never read by `build()`. The builder reads from `sessionConfig?.thinking` instead.
- **Recommendation**: Remove the redundant `thinking`/`effort` fields from `QueryOptionsInput` or wire them up. Currently they're dead fields that create confusion.

### Failure Mode 5: EffortSelector Doesn't Reset on Session Switch

- **Trigger**: User has "max" effort selected, switches to a different tab/session
- **Symptoms**: The effort selector still shows "max" even though the new session may have been created with "Default"
- **Impact**: Low -- confusing UX but functionally harmless since effort is set at session creation
- **Current Handling**: `_selectedEffort` signal is component-level state, never synced with session state
- **Recommendation**: Consider showing the session's actual effort (if trackable) when switching tabs

### Failure Mode 6: No Runtime Validation of EffortLevel at RPC Boundary

- **Trigger**: Malformed RPC message from webview or extension API
- **Symptoms**: Invalid string passes through to SDK
- **Impact**: Low -- SDK likely validates and returns error
- **Current Handling**: Type-only safety (no runtime validation)
- **Recommendation**: Add runtime validation in RPC handler: `if (effort && !['low','medium','high','max'].includes(effort)) throw`

## Critical Issues

### Issue 1: QueryOptionsInput.thinking/effort Fields Are Dead Code

- **File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\sdk-query-options-builder.ts:257-262` (interface) and `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\session-lifecycle-manager.ts:618-630` (usage)
- **Scenario**: `QueryOptionsInput` interface defines `thinking?: ThinkingConfig` and `effort?: EffortLevel` fields. The `SessionLifecycleManager.executeQuery()` method at line 618 calls `this.queryOptionsBuilder.build({...})` WITHOUT passing `thinking` or `effort` from the input. The builder's `build()` method reads these from `sessionConfig?.thinking` and `sessionConfig?.effort` instead (lines 475-476). Since `sessionConfig` is the full `AISessionConfig` that contains these fields, the data DOES flow correctly -- but the standalone fields on `QueryOptionsInput` are dead code that a future developer might try to use, expecting them to work.
- **Impact**: Future maintenance confusion; a developer might add `thinking: someValue` to the `build()` input expecting it to be used, when it's silently ignored. This is a code design issue that could lead to real bugs.
- **Evidence**:

  ```typescript
  // QueryOptionsInput defines these (dead fields):
  thinking?: ThinkingConfig;
  effort?: EffortLevel;

  // build() reads from sessionConfig instead:
  thinking: sessionConfig?.thinking,
  effort: sessionConfig?.effort,

  // executeQuery() doesn't pass them:
  await this.queryOptionsBuilder.build({
    userMessageStream, abortController, sessionConfig,
    // NO thinking or effort here
  });
  ```

- **Fix**: Either (a) remove `thinking`/`effort` from `QueryOptionsInput` since they're read from `sessionConfig`, or (b) update `build()` to use `input.thinking ?? sessionConfig?.thinking` to support both paths.

## Serious Issues

### Issue 1: Effort Change Mid-Session Is Silently Ignored (UX Mismatch)

- **File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\chat-input\effort-selector.component.ts` and `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\chat-rpc.handlers.ts:980-987`
- **Scenario**: The effort selector is always visible and interactive, even when the current session already has a fixed effort level. User changes effort from "Default" to "Max" and sends a follow-up message. The `chat:continue` handler processes the effort param only when the session needs to be resumed (inactive session path at line 830-831). For active sessions, `sendMessageToSession` is called without effort.
- **Impact**: Users think they can dynamically adjust effort per-message, but they can't. This is a fundamental UX/architecture mismatch -- the SDK treats effort as a query-level setting.
- **Fix**: Add a disabled state or informational tooltip to the effort selector when a session is active: "Effort is fixed for this session. Start a new chat to change."

### Issue 2: Queued Messages Drop All Context (effort, files, images)

- **File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat.store.ts:421`
- **Scenario**: When streaming is active and user sends a message, `queueOrAppendMessage(content)` is called with only the text content. Files, images, and effort are all dropped.
- **Impact**: This is a pre-existing issue NOT introduced by TASK_2025_184, but the effort parameter surfaces it. Effort loss here is actually consistent with the session-level nature of effort, but files/images loss is a real data loss bug.
- **Evidence**: `this.conversation.queueOrAppendMessage(content);` -- only `content` string, no other params
- **Fix**: Either document this limitation or extend `queueOrAppendMessage` to accept the full message context.

### Issue 3: No Model-Effort Compatibility Validation

- **File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\sdk-query-options-builder.ts:475-476`
- **Scenario**: `effort: 'max'` is documented as "Opus 4.6 only" but there's no validation preventing it being used with Sonnet/Haiku models. The SDK will receive an unsupported configuration.
- **Impact**: Session may fail to start with a generic error, or SDK may silently downgrade the effort level.
- **Fix**: Add validation in the builder: if `effort === 'max'` and model doesn't contain 'opus', log a warning and potentially downgrade.

## Moderate Issues

### Issue 1: No Persistence of Effort Selection

- **File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\chat-input\effort-selector.component.ts:42`
- **Scenario**: `selectedEffort` is a component-level signal initialized to `''`. When the webview reloads or the panel is hidden/shown, the selection resets.
- **Impact**: Minor UX annoyance -- user who always wants "low" effort must re-select it each time.
- **Fix**: Persist to localStorage or VS Code settings.

### Issue 2: Empty String as Default Sentinel

- **File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\chat-input\effort-selector.component.ts:42,54`
- **Scenario**: The component uses `''` (empty string) as the sentinel for "use SDK default". This works because the HTML `<option value="">Default</option>` maps to empty string, and line 54 converts it: `value || undefined`. However, mixing `EffortLevel | ''` as a type is a code smell -- TypeScript allows it but it relies on JavaScript truthiness behavior.
- **Impact**: Minor -- works but fragile.
- **Fix**: Consider using `null` or a dedicated `'default'` string instead of empty string.

### Issue 3: ThinkingConfig Type Exposed but No UI Path

- **File**: `D:\projects\ptah-extension\libs\shared\src\lib\types\ai-provider.types.ts:89-92` and `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc.types.ts:78`
- **Scenario**: `ThinkingConfig` (with `adaptive`, `enabled`, `disabled` variants) is defined and threaded through the entire stack, but there's no UI component to configure it. The effort selector only controls `EffortLevel`. The `thinking` field in `ChatStartParams.options` is unreachable from the frontend.
- **Impact**: Dead code path -- adds complexity without value. A future developer might wonder why `thinking` exists but is never populated.
- **Fix**: Either add a UI for ThinkingConfig or remove it from the RPC params until it's needed.

## Data Flow Analysis

```
Frontend                          RPC Boundary                    Backend
--------                          ------------                    -------

EffortSelector
  |
  | effortChanged output()
  v
ChatInputComponent
  |
  | _selectedEffort signal
  | handleSend() reads signal
  v
ChatStore.sendOrQueueMessage()
  |
  | effort param passed through
  v
MessageSenderService.send()
  |
  |--- startNewConversation() ---> RPC: chat:start
  |    effort in options.effort        |
  |                                    v
  |                              ChatRpcHandlers.registerChatStart()
  |                                    |
  |                              options.effort --> AISessionConfig.effort
  |                                    |
  |                              SdkAgentAdapter.startChatSession()
  |                                    |
  |                              SessionLifecycle.executeQuery()
  |                                    |
  |                              SdkQueryOptionsBuilder.build()
  |                                    |
  |                              sessionConfig.effort --> SdkQueryOptions.effort
  |                                    |
  |                              SDK query() called with effort
  |
  |--- continueConversation() --> RPC: chat:continue
       effort at top level            |
                                      v
                               [Session active?]
                                /            \
                           YES                NO (resume)
                              |                    |
                    sendMessageToSession()   sdkAdapter.resumeSession()
                    EFFORT NOT PASSED! [*]   effort in AISessionConfig
                                                   |
                                             New query with effort
```

### Gap Points Identified:

1. **[*] Active session continue path**: `effort` from `ChatContinueParams` is present but not forwarded to `sendMessageToSession`. This is architecturally correct (SDK doesn't support per-message effort) but creates a UX gap.
2. **Queue path**: `queueOrAppendMessage(content)` drops `effort`, `files`, `images`.
3. **PtahCliAdapter continue path**: `handlePtahCliContinue` at line 502 calls `sendMessageToSession` without effort -- same gap as the main adapter.

## Requirements Fulfillment

| Requirement                             | Status   | Concern                                        |
| --------------------------------------- | -------- | ---------------------------------------------- |
| EffortLevel type definition             | COMPLETE | Clean discriminated union                      |
| ThinkingConfig type definition          | COMPLETE | No UI path to configure                        |
| AISessionConfig extended                | COMPLETE | Types are correct                              |
| RPC params updated (ChatStart/Continue) | COMPLETE | Both params include thinking/effort            |
| SdkQueryOptions extended                | COMPLETE | Matches SDK Options interface                  |
| Query builder threads values            | COMPLETE | Reads from sessionConfig                       |
| PtahCliAdapter threads values           | COMPLETE | Both start and resume paths                    |
| Chat RPC handlers thread values         | COMPLETE | Both chat:start and chat:continue resume paths |
| MessageSenderService threads effort     | COMPLETE | Both start and continue                        |
| ChatStore threads effort                | COMPLETE | Via sendMessage and sendOrQueueMessage         |
| EffortSelector component                | COMPLETE | Clean, minimal, accessible                     |
| ChatInputComponent integrates selector  | COMPLETE | Properly wired with output                     |

### Implicit Requirements NOT Addressed:

1. Effort selection persistence across webview reloads
2. Visual indicator of current session's effective effort level
3. Model-effort compatibility validation
4. User feedback when effort change won't take effect (mid-session)
5. Queue path preservation of effort (and files/images -- pre-existing)

## Edge Case Analysis

| Edge Case                           | Handled     | How                                           | Concern              |
| ----------------------------------- | ----------- | --------------------------------------------- | -------------------- | --------------------------------------------------------- | ----- |
| undefined effort (default)          | YES         | `effort                                       |                      | undefined`in component,`sessionConfig?.effort` in builder | Clean |
| effort='max' with non-Opus model    | NO          | Passed through to SDK without validation      | SDK may reject       |
| Effort change mid-session           | PARTIALLY   | Ignored on active sessions, applied on resume | No user feedback     |
| ThinkingConfig without effort       | YES         | Independent optional fields                   | Fine                 |
| Invalid effort string via RPC       | NO          | No runtime validation                         | SDK likely rejects   |
| Webview reload resets selection     | YES (reset) | Signal initialized to ''                      | No persistence       |
| Multiple tabs with different effort | YES         | Each ChatInputComponent has own signal        | Independent per-tab  |
| Ptah CLI adapter effort threading   | YES         | Both start and resume paths                   | Matches main adapter |

## Integration Risk Assessment

| Integration                            | Failure Probability | Impact | Mitigation                                 |
| -------------------------------------- | ------------------- | ------ | ------------------------------------------ |
| Frontend -> RPC (effort serialization) | LOW                 | LOW    | Simple string, JSON-safe                   |
| RPC -> AISessionConfig mapping         | LOW                 | LOW    | Direct field pass-through                  |
| AISessionConfig -> SdkQueryOptions     | LOW                 | MEDIUM | Works but via sessionConfig indirection    |
| SdkQueryOptions -> SDK query()         | LOW                 | MEDIUM | Types match SDK, but no runtime validation |
| EffortSelector -> ChatInput            | LOW                 | LOW    | Clean output() binding                     |
| Effort on Ptah CLI adapters            | MEDIUM              | MEDIUM | Third-party providers may not support      |

## Verdict

**Recommendation**: NEEDS_REVISION
**Confidence**: HIGH
**Top Risk**: Users will be confused that changing the effort selector mid-conversation does nothing. The UI presents effort as a per-message control but it's actually a per-session control.

## What Robust Implementation Would Include

1. **Session-level effort indicator**: Show the current session's configured effort level (read-only badge) next to the selector, so users understand what's in effect.
2. **Selector disabled state**: Disable the effort dropdown when an active session exists with a tooltip explaining it's per-session.
3. **Effort persistence**: Store selected effort in localStorage or VS Code settings so it persists across reloads.
4. **Model-effort validation**: Warn or prevent selecting "max" with non-Opus models.
5. **Remove dead `QueryOptionsInput` fields**: The standalone `thinking`/`effort` fields on `QueryOptionsInput` are never read -- remove them to prevent future confusion.
6. **Remove or defer ThinkingConfig from RPC types**: Since there's no UI to configure it, removing it from `ChatStartParams`/`ChatContinueParams` reduces dead surface area. Keep the type definition for future use.
7. **Runtime validation at RPC boundary**: Validate that `effort` is one of the four valid values before forwarding to SDK.
8. **Queue message context**: Extend `queueOrAppendMessage` to preserve effort, files, and images (broader pre-existing issue).
