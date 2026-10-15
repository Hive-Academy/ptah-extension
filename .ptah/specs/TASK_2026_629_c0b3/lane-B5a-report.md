# Batch B5a report

## Files changed

- `libs/frontend/chat/src/lib/tokens/session-context.token.ts`: added the optional `Signal<boolean>` token `SESSION_FORCED_CARD`.
- `libs/frontend/chat/src/index.ts`: exported the new token from the public entry point.
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts`: optionally injects the token and derives `showCompactCard` from it and `resolvedViewMode`.
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.html`: uses the derived gate for the card and suppresses the sidebar in card mode.
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.spec.ts`: covers forced card rendering, unmounted transcript/sidebar, clearing the force, and absent-token full mode.
- `.ptah/specs/TASK_2026_629_c0b3/lane-B5a-report.md`: this report.

## Findings and decisions

- **A1:** `SESSION_FOCUSED` is an `InjectionToken<Signal<boolean>>` in `libs/frontend/chat/src/lib/tokens/session-context.token.ts:42` and reaches the public entry point through `libs/frontend/chat/src/lib/services/index.ts:104` and `libs/frontend/chat/src/index.ts:15`. `SESSION_FORCED_CARD` uses the same value type at `session-context.token.ts:47`; this batch exports it directly at `libs/frontend/chat/src/index.ts:35` as requested.
- **A5:** The canvas tile mounts `ChatViewComponent` at `libs/frontend/canvas/src/lib/canvas-tile.component.ts:418` with an injector whose providers at `:619-622` do not include `HIDE_AGENT_SIDEBAR`. The sidebar sits outside the compact/full branch at `libs/frontend/chat/src/lib/components/templates/chat-view.component.html:268-340`, so it can mount in a canvas tile. Both sidebar branches are gated on `!showCompactCard()` at `:268` and `:340`.
- `resolvedViewMode` remains a read of stored tab mode at `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:913-920`; `showCompactCard` is derived separately at `:922`. No stored view mode is written.

## Checks

- `npx prettier --write` on all five changed source files: passed.
- `npx nx test @ptah-extension/chat --testFile=chat-view.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`: passed, 1 suite and 89 tests. The existing compact gate block at `chat-view.component.spec.ts:2259` passed.
- `npx nx typecheck @ptah-extension/chat --parallel=1 --skip-nx-cache`: passed; one NG8107 warning in unchanged `peer-session-send-dialog.component.ts:181`.
- `npx nx lint @ptah-extension/chat --parallel=1 --skip-nx-cache`: passed; 0 errors and 36 warnings.

## Open items

- A canvas tile must provide `SESSION_FORCED_CARD` in its child injector before the automatic card rule can drive this gate. That belongs to the later canvas batch and was outside B5a's allowed files.
