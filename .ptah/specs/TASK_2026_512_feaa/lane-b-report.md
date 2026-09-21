# Lane B — frontend

## Changes

- `libs/frontend/chat-state/src/lib/tab-manager.service.ts:69` — `TerminalTurnPulse` gains `lastAssistantMessage: string | null`.
- `libs/frontend/chat-state/src/lib/tab-manager.service.ts:1295` — pulse construction populates it from `state.lastAssistantMessage ?? null`. Line 1283's classification expression was left untouched, as instructed.
- `libs/frontend/chat-state/src/lib/tab-manager.notification-pulse.spec.ts:12` — `turnState()` helper takes a `lastAssistantMessage` parameter (default `null`) so every existing call site still compiles against the now-required field.
- `libs/frontend/chat-state/src/lib/tab-manager.notification-pulse.spec.ts:63` — new test `carries the last assistant message onto the pulse`, asserting the field reaches `terminalTurnPulses()`.
- `libs/frontend/chat-state/src/lib/tab-manager.notification-pulse.spec.ts:93` (pre-existing, now confirmed) — the `it.each` error-classification table already contained `['idle', null]` asserting `'error'` before this change; it pins the exact production shape (`phase: 'idle'`, `terminalReason: null` → `'error'`) named in the brief. I did not duplicate it.
- `libs/frontend/notification-center/src/lib/notification-center.types.ts:21` — `CompletionNotificationEntry` gains `lastAssistantMessage: string | null` and `outcomeLabel: string`.
- `libs/frontend/notification-center/src/lib/notification-center.store.ts:29` — new exported `deriveOutcomeLabel(reason: SdkTerminalReason | null): string`, exhaustive `switch` over all 19 `SdkTerminalReason` members per the brief's table, `null` → `'Finished (unknown outcome)'`, `assertNever` on the default branch.
- `libs/frontend/notification-center/src/lib/notification-center.store.ts:157` — `appendCompletion` carries `lastAssistantMessage: pulse.lastAssistantMessage` and sets `outcomeLabel: deriveOutcomeLabel(pulse.terminalReason)`.
- `libs/frontend/notification-center/src/lib/notification-center.component.ts:163` — bare `entry.classification === 'error' ? 'Failed' : 'Finished'` replaced with `entry.outcomeLabel`.
- `libs/frontend/notification-center/src/lib/notification-center.component.ts:166` — session name (`entry.title`) now carries `link link-hover` classes so it reads visually as the link.
- `libs/frontend/notification-center/src/lib/notification-center.component.ts:169` — recap rendered with `@if (entry.lastAssistantMessage)` as an interpolated `{{ entry.lastAssistantMessage }}` in a `block truncate` span (no `[innerHTML]`, no markdown pipe).
- `libs/frontend/notification-center/src/lib/notification-center.component.ts:147` — the row button gets `[attr.aria-label]="'Open session ' + entry.title"` for an explicit accessible name; cursor and hover already came from the button/`hover:bg-base-200`, and the focus-visible ring was already present on the same button.
- `libs/frontend/notification-center/src/lib/notification-center.store.spec.ts` — fixture literals updated for the new required fields; added `deriveOutcomeLabel` table test (all 19 members + `null`), a recap-carried test, and a recap-null test.
- `libs/frontend/notification-center/src/lib/notification-center.component.spec.ts` — fixture updated; added tests for the outcome label replacing "Failed", the recap appearing/disappearing, and the session-name link affordance (`aria-label`, `.link` element, click still calls `activateCompletion`).
- `libs/frontend/notification-center/src/lib/notification-center.injector.spec.ts` — updated a `TerminalTurnPulse` literal that would otherwise fail to typecheck against the new required field.

## Card anatomy

```
┌─────────────────────────────────────────┐
│ ● [icon]  Hit the turn limit             │  ← entry.outcomeLabel (was bare "Failed")
│           Refactor the parser            │  ← entry.title, styled as a link (session-name affordance)
│           Split the grammar into two...  │  ← entry.lastAssistantMessage, truncated, omitted when null
│                                    [X]    │  ← dismiss, unchanged
└─────────────────────────────────────────┘
```

The whole left region (dot, icon, outcome label, title, recap) is one `<button>` whose click already calls `activateCompletion(entry)` through `NOTIFICATION_FOCUS_ROUTER`; it now also carries `aria-label="Open session <title>"`.

## Verification

Run from `D:\projects\ptah-extension\.claude-worktrees\feat-notification-recap-d23df5594475`:

```
npx nx run-many -t typecheck -p @ptah-extension/notification-center @ptah-extension/chat-state
```
`Running target typecheck for 2 projects` — both succeeded, no errors.

```
npx nx run-many -t test -p @ptah-extension/notification-center @ptah-extension/chat-state
```
`Running target test for 2 projects` — both succeeded.
- `@ptah-extension/chat-state`: Test Suites 19 passed/19, Tests 405 passed/405.
- `@ptah-extension/notification-center`: Test Suites 4 passed/4, Tests 48 passed/48.

```
npx nx run-many -t lint -p @ptah-extension/notification-center @ptah-extension/chat-state
```
`Running target lint for 2 projects` — both succeeded.
- `@ptah-extension/notification-center`: all files pass linting, 0 problems.
- `@ptah-extension/chat-state`: 0 errors, 2 pre-existing warnings unrelated to this change (`no-non-null-assertion` in `tab-manager.cross-workspace.spec.ts:115`, and the `max-lines` soft-ceiling warning on `tab-manager.service.ts`, which was already over 700 lines before this task and grew by two lines from this change).

## Notes

- The brief's instruction to "add a case for `terminalReason: null` on an `idle` phase asserting `'error'`" in `tab-manager.notification-pulse.spec.ts` was already satisfied on this branch before I touched the file — the existing `it.each` error table at line ~93 already includes `['idle', null]`. I left it in place rather than adding a duplicate, and added the one test the brief did not yet have: `lastAssistantMessage` reaching the pulse.
- `lastAssistantMessage` on `TerminalTurnPulse` and `CompletionNotificationEntry` was made a required field (`string | null`, not `?: string | null`), matching how the sibling `terminalReason` field is already modeled on both types. This meant updating every existing test literal that builds one of these two shapes by hand (all inside my scope, under `chat-state` and `notification-center`).
- No typecheck errors surfaced from `libs/backend/agent-sdk` (Lane A's file) — `SessionTurnState.lastAssistantMessage` from the frozen `libs/shared` contract was directly usable.
