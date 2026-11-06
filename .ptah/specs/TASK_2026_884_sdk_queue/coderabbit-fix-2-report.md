# CodeRabbit follow-up 2

## CI failures

**Fixed.** The two exact-equality Stop assertions still expected withdrawn items without `tabId`, while `withdrawAllForStop` now returns the originating tab. Updated the expected FIFO items at `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.follow-up-queue.spec.ts:365-384`. The focused queue/session suites pass (28 tests).

## Review comments

1. **Adapter listener isolation — fixed.** `emitFollowUp` called subscribers directly at `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts:885`, so a synchronous throw could interrupt queue settlement. It now catches and logs each listener failure, then continues to the next subscriber (`:885-896`). Regression spec at `codex-chat-adapter.spec.ts:196` verifies another listener sees `queued` and `delivered` and the next turn starts. Adapter suite passes (113 tests).

2. **Typed turn-change refusal — fixed.** The serialized expected-turn guard threw a plain error even though the adapter maps only `CodexRequestRejectedError` to `TURN_CHANGED` (`codex-chat-adapter.ts:914-923`). `codex-context.ts:884` now throws the existing `codexTurnNoLongerActive` variant. `-1` is a local sentinel for this preflight rejection; `rpcCode` is a number and the adapter checks the type, not its numeric value. Regression spec at `codex-context.spec.ts:164` verifies no steer request is sent. Context suite passes (5 tests).

3. **Codex session ownership — fixed.** The queue owner lookup used Claude registration or held-item bindings (`chat-follow-up-queue.service.ts:284-290`), so an idle Codex session with no held item had no owner. Electron now registers an explicit resolver from its Codex session tab map (`apps/ptah-electron/src/di/codex-runtime-composition.ts:910-912`, `libs/backend/rpc-handlers/src/lib/chat/tokens.ts:51`). The queue checks it before fallback registration or binding ownership (`chat-follow-up-queue.service.ts:285-286`); the resolver returns `undefined` for unowned sessions and never uses the session-ID fallback. Regression spec at `chat-follow-up-queue.service.spec.ts:127` rejects another tab with no held item. Queue/session suites pass (28 tests).

## Decisions

- Used the existing `CodexRequestRejectedError` variant with `-1` as the local preflight sentinel. The alternative was a new error class; the existing adapter mapping and numeric `rpcCode` contract support the smaller, reversible change.
- Used an optional host owner resolver token so the shared queue remains host neutral. Electron's explicit `tabs` map is the source of truth for live Codex ownership. This registration is reversible.

## Verification limits

Focused Jest suites passed: 146 tests total. Ptah diagnostics found zero errors or warnings in the three changed source files it completed. Diagnostics for the Electron composition file and changed specs remained unavailable after two 45-second checks; each check reported TypeScript still running. No Nx or workspace-wide check was run. No matching skill-loading tool was listed for this lane, so no skill was loaded.
