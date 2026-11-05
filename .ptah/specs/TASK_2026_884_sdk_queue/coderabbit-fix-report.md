# CodeRabbit follow-up report

## Comment 1 — idle Codex admission

**Verdict: fixed.** `startNext` removed an immediately started item from `listFollowUps` before its asynchronous admission completed. `enqueueFollowUp` now returns an admission promise (`libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-peer-queue.ts:35`) and `sendMessageToSession` awaits it for an immediately started item (`libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts:807-824`). A rejection now reaches the existing `chat:continue` error path; held entries still emit `queued` promptly. Immediate success and rejection regression cases were added to `codex-chat-peer-queue.spec.ts`. That suite passed: 12 tests.

## Comment 2 — withdrawal lost on abort timeout

**Verdict: fixed for withdrawals observed before the failed RPC result.** The renderer now captures `withdrawn` state pushes during Stop before settling their store entries (`libs/frontend/chat/src/lib/services/chat-store/follow-up-queue.service.ts:165-190,310-318`). If `chat:abort` throws or returns failure without `data.withdrawn`, `ConversationService` restores the captured snapshots (`libs/frontend/chat/src/lib/services/chat-store/conversation.service.ts:153-202`). A successful reply uses its returned snapshots, preventing duplicate restoration. Regression cases cover a lost response and a failed response in `conversation.service.spec.ts`, and push capture in `follow-up-queue.service.spec.ts`.

## Comment 3 — withdrawal ownership across tabs

**Verdict: fixed.** The backend captures the binding's `tabId` before withdrawal clears it and returns that identity with each snapshot (`libs/backend/rpc-handlers/src/lib/chat/follow-up/chat-follow-up-queue.service.ts:204-219`). The shared abort result declares the field (`libs/shared/src/lib/types/rpc/rpc-chat.types.ts:316`), and the renderer restores each snapshot into its originating tab's composer (`libs/frontend/chat/src/lib/services/chat-store/follow-up-queue.service.ts:324-340`). Backend FIFO tests were updated and pass (15 tests); a frontend cross-tab regression case was added.

## Comment 4 — SDK manifest versions

**Verdict: disputed as already fixed at this worktree head.** Root `package.json:79`, Electron `apps/ptah-electron/package.json:14`, agent SDK `libs/backend/agent-sdk/package.json:18`, and CLI runtime `libs/backend/cli-agent-runtime/package.json:10` all pin `@anthropic-ai/claude-agent-sdk` to `0.3.318`. No manifest change or spec is needed.

## Verification and limits

- `npx jest --runInBand -c libs/backend/agent-sdk/jest.config.ts ...codex-chat-peer-queue.spec.ts`: 12 passed.
- `npx jest --runInBand -c libs/backend/rpc-handlers/jest.config.ts ...chat-follow-up-queue.service.spec.ts`: 15 passed.
- Frontend Jest suites were attempted but could not start: esbuild `spawn EPERM`.
- Scoped `ptah_get_diagnostics` was attempted twice; TypeScript checking remained unavailable after the tool's 45 second timeout. The coordinator should run type checks and frontend specs.
- The `angular-frontend-patterns` skill was named in the project guidance, but no skill loader or active skill catalogue was exposed to this lane. Existing Angular `inject()` and signal conventions were followed directly from source.

## Decisions

- Kept the provider snapshot type unchanged and added `tabId` only to the Stop RPC result. The task contract marks provider types frozen; the queue coordinator already holds the tab binding. This is reversible.
- Used state pushes already emitted during withdrawal as fallback evidence. A Stop RPC failure without a withdrawal push cannot prove which queued items the backend removed, so it does not restore speculative items. This is reversible.
