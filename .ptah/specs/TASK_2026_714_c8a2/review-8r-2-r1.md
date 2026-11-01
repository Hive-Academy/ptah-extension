Verdict: APPROVE
Score: 9/10
Review family: kimi-code (reviewer) / grok (implementer)

## Defects

None.

## Notes

- **Defect 1 is fixed.** `SessionLoaderService.showResumeActivationFailure` reads `activationError` and appends the D14a text through the existing assistant-message channel at `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts:1322-1354`. The uncoded mapping returns the original refusal text at `libs/frontend/chat/src/lib/services/message-sender.service.ts:97-105`. The successful resume resolves normally, so the caller does not display a second error.
- **The bubble follows history.** The helper runs after the awaited history replay at `session-loader.service.ts:1117-1147`. A replay exception exits through the catch at `session-loader.service.ts:1126-1135`, before the helper runs. A failed replay therefore cannot add a duplicate bubble.
- **A repeated resume does not accumulate bubbles.** `applyResumingSession` clears the tab messages before each ordinary resume at `libs/frontend/chat-state/src/lib/tab-manager.service.ts:2959-2974`. History replay then rebuilds the transcript, and the helper appends one new bubble.
- **Reload does not duplicate the bubble.** `setMessages` only replaces frontend tab state at `tab-manager.service.ts:2211-2213`. That state, including messages, is saved to localStorage at `tab-manager.service.ts:3194-3199`; it is not appended to backend JSONL history. The restored-session path calls `chat:resume` without `activate` and does not replay events or call the new helper at `session-loader.service.ts:1717-1785`. The restored bubble therefore remains single.
- **Claude behavior has no duplicate path.** The helper is provider-neutral and displays an uncoded Claude `activationError` unchanged. No other frontend consumer of `activationError` exists in this worktree. Start and continue behavior is unchanged.
- **The mapping refactor is byte-identical for start and continue.** The code precedence, fixed strings, error precedence, and fallback behavior at `message-sender.service.ts:92-105` match the former private switch. Both existing call sites retain their fallbacks at `message-sender.service.ts:582-585` and `:862-865`.
- **The specs follow the requested rules.** The additions use `Object.defineProperty` for method mocks at `session-loader.service.spec.ts:2633-2644`. I found no `any`, `as unknown as`, `@ts-ignore`, `eslint-disable`, `[innerHTML]`, excess typed-literal properties, or new real timers in the changed code. No type error is visible by reading.
- The new specs directly cover ordering, one append, successful activation, absent errors, non-activated resume, and coded mapping. They do not directly exercise replay failure, repeated resume, reload, or Claude; I checked those paths by reading.
- No tests, typecheck, lint, build, or diagnostics ran, as required by the review restrictions.
