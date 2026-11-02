# Batch 8q-3a CodexContext mock fix

Added the required `turnPermissionLevel` property to these CodexContext mocks/fakes:

| Edited file:line | Value |
| --- | --- |
| `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.spec.ts:67` | `profile.permissionLevel` (`'ask'` in the existing profile) |
| `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-lifecycle.spec.ts:66` | `profile.permissionLevel` (`'ask'` in the existing profile) |
| `libs/backend/gateway-chat-bridge/src/lib/codex-gateway-adapter.spec.ts:46` | `'ask'` (no permission level in that mock's settings) |
| `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-native-contract.spec.ts:253` | `profile.permissionLevel` (`'ask'` in the existing profile) |

Search result: one `rg -n 'CodexContext' apps libs` pass found no other object typed as or implementing `CodexContext`, excluding `libs/backend/codex-runtime/src/lib/codex-context.ts`. The remaining hits are imports, type definitions, references, and uses of existing contexts. No additional file:line to report.

No verification ran, as instructed.