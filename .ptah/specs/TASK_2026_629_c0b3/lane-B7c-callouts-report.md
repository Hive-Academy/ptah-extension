# B7c card callouts report

## Files changed

- `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.ts` and `.spec.ts`: build one timestamp-sorted pending queue and route Answer/Open actions.
- `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-lane.types.ts`, `compact-session-activity.component.ts` and `.spec.ts`, `compact-session-callout.component.ts` and `.spec.ts`, plus `libs/frontend/chat-ui/src/index.ts`: question callout type, fixed-height rendering, outputs, and tests.

## Tab resolution and decisions

- The card reads `PermissionHandlerService.questionRequests()` in `compact-session-card.component.ts:236-243`. `targetsTab()` at lines 430-450 uses `questionTargetTabsFor(request.id)` first, then the request's session ID through `TabManagerService`; it applies the same routing rule to session permissions.
- The card combines routed session permissions, routed questions, and permissions on `agentsOwnedBySession()`; it sorts by ascending `timestamp` at lines 153-201. Equal timestamps put permissions first. The selected callout gets `moreCount = pending.length - 1`; an error appears only when no request waits. This resolves the handoff's oldest-request rule while preserving permission priority for ties.
- Question text is plain Angular interpolation. Answer and session-permission Open use `openFullView()`, which invokes `SESSION_CARD_ACTIONS.openSession()` on a forced card and keeps the existing unforced fallback. CLI-permission Open uses `openLane(laneKey('cli', agentId))`. Allow and Deny retain their responder paths.
- The chat-ui callout is a small standalone component with a fixed `h-20` host and content. Chat-ui receives data and emits outputs; it does not import chat or canvas.

## Checks

- `npx nx test @ptah-extension/chat-ui --testFile=compact-session-callout.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`: 1/1 passed.
- `npx nx test @ptah-extension/chat-ui --testFile=compact-session-activity.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`: 44/44 passed.
- `npx nx test @ptah-extension/chat --testFile=compact-session-card.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`: 33/33 passed.
- `npx nx typecheck @ptah-extension/chat-ui --parallel=1 --skip-nx-cache`: passed.
- `npx nx lint @ptah-extension/chat-ui --parallel=1 --skip-nx-cache`: passed, 0 errors and 8 warnings, including the existing activity-component max-lines warning.
- `npx nx typecheck @ptah-extension/chat --parallel=1 --skip-nx-cache`: passed with one warning in `peer-session-send-dialog.component.ts`.
- `npx nx lint @ptah-extension/chat --parallel=1 --skip-nx-cache`: passed, 0 errors and 38 warnings in existing files.
- A mistyped activity-spec command ending in `.spec.ts.ts` ran no tests; the corrected command above ran 44 tests. Scoped `ptah_get_diagnostics` reported no diagnostics in requested source files, but unrelated sibling spec diagnostics, including an existing line in the card spec.

## Open items

- No B7c implementation items remain. Existing project lint warnings and unrelated sibling spec diagnostics remain outside this batch's allowed files.
