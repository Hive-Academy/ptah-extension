# Context label round 3

## Changes and spec cases

1. **Unpartitioned host routing:** `chat-attention-host-message-handler.service.ts:197,287-290` keeps a validated null-path owner's projection and Open target at `workspacePath: ''`; the matching root supplies only the workspace label and provider. `chat-attention-host-message-handler.service.spec.ts:88,100,316` checks both local-root sources and the Open target. `notification-focus-coordinator.service.spec.ts:83` checks that a null-path owner with a tab id is adopted without switching workspaces.
2. **Shared context safety:** `attention-context.util.ts:1` rejects single-segment absolute paths only at the specified well-known roots, case-insensitively and as whole tokens. It still rejects multi-segment paths and the existing key patterns. Host and source title and question cases at `chat-attention-host-message-handler.service.spec.ts:155` and `chat-attention-source.service.spec.ts:180,203` cover slash commands and rejected paths.
3. **Context cap:** `attention-context.util.ts:5-19` trims the session title or question text with an ellipsis before any whole-string fallback, preserving the provider and `Tool: X` when they fit. `chat-attention-host-message-handler.service.spec.ts:171` and `chat-attention-source.service.spec.ts:105,232` check the 80-character cap, ellipsis, and intact tool suffix.
4. **Canvas adoption outcome:** `notification-focus-coordinator.service.ts:48-50` maps a false tab-bridge result to `missing`. `notification-focus-coordinator.service.spec.ts:94` covers the refusal. The boolean bridge cannot identify a tile-cap refusal; that requires a change in the out-of-scope canvas bridge.
5. **Lane default title:** `chat-attention-host-message-handler.service.ts:192` and `chat-attention-source.service.ts:138` filter `Lane permission required` from session context. `chat-attention-host-message-handler.service.spec.ts:189` and `chat-attention-source.service.spec.ts:243` cover it.
6. **Unpartitioned action dispatch:** `chat-attention-action-dispatcher.service.ts:55` allows Open and Answer when `workspacePath` is `''` and `tabId` identifies an owner, while refusing an empty path with no tab id. `chat-attention-action-dispatcher.service.spec.ts:91,97` checks that focus receives the tab id and that the ownerless case reports `Target unavailable`. `notification-focus-router.token.ts:11` already types `workspacePath` as `string`, which accepts `''`; no target type change was needed.
7. **Canvas action label:** `chat-attention-source.service.ts:160` and `chat-attention-host-message-handler.service.ts:213` label chat-owned `open` actions "Show in canvas" and surface-owned actions "Open"; action ids and routing remain unchanged. `chat-attention-source.service.spec.ts:77,278,288` checks chat-owned, ownerless, and surface-owned labels; `chat-attention-host-message-handler.service.spec.ts:84,333,344` checks the host equivalents. The search of `libs/frontend` found one other production site for a chat-oriented `open` action with label "Open": `chat-failed-turn-attention.service.ts:44` (source `chat-turn`), left unchanged under the requested scope. Other matches were test fixtures in the dispatcher, core notification service, and notification-center specs; none of the notification-center specs assert a chat-owned label.

## Decisions

- The projection's label root remains validated against the target workspace ID; it is not used as the routing path of a null-path owner.
- A false canvas tab adoption is reported as `missing` until the bridge returns a distinct cap result.
- The dispatcher uses the same guard for Open and Answer, so both reach the null-path coordinator branch when an owner tab id is present.
- No Nx, Jest, TypeScript, lint, or build commands were run, per task instruction. `git diff --check` found no whitespace errors.

## Not done

- The canvas bridge and canvas consumer remain outside this lane's permitted edit scope.
