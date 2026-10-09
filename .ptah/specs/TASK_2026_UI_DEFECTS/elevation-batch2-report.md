# Design elevation — Batch 2 (chat)

## Delivered

| Element                       | Before → after                                                                                                                                      | Source                                                                                          |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Canvas grid                   | no stable canvas selector → `data-testid="canvas"`                                                                                                  | `libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts:109`                           |
| Canvas tiles                  | generic bordered `rounded-lg` tile → one conditional structural surface: `surface-2` normally, `surface-3` when focused, preserving the accent ring | `libs/frontend/canvas/src/lib/canvas-tile.component.ts:153-159`                                 |
| Tile header                   | `bg-base-300` → `bg-surface-1`; stable header test id                                                                                               | `canvas-tile.component.ts:164-165`                                                              |
| Chat canvas layer             | removed the nested `bg-base-200/30`; the Batch 1 shell remains the canvas surface-0                                                                 | `libs/frontend/chat/src/lib/components/templates/chat-view.component.html:23`                   |
| Transcript bubbles            | `bg-base-*` plus `shadow-card` → `surface-1` grouped blocks; peer bubbles promote to surface-2                                                      | `message-bubble.component.html:35,212-213`                                                      |
| Transcript scroller           | no stable selector → `data-testid="chat-transcript-scroller"`                                                                                       | `transcript/chat-transcript.component.html:3`                                                   |
| Tool and execution rows       | tool call rows use `bg-surface-1 border-surface-border`; agent execution groups use surface-1 and a surface-2 header/active strip                   | `tool-call-item.component.ts:125-129`; `execution/agent-execution.component.ts:66-70,131-135`   |
| Inline agents                 | neutral inline agent block uses surface-1; status tones remain semantic                                                                             | `execution/inline-agent-bubble.component.ts:86`                                                 |
| Change sets and turn tests    | base backgrounds/shadows → surface-2 cards, retaining change/status accents                                                                         | `chat-ui/.../change-set-card.component.ts:131`; `turn-tests-row.component.ts:68`                |
| Composer                      | outer base background → surface-0; raised card → surface-2; controls remain 32px (`h-8 w-8`)                                                        | `chat-input.component.ts:124-125,633,371-392`                                                   |
| Budget and compaction notices | translucent base/shadow cards → surface-2 while retaining warning/error/success borders and ink                                                     | `session-budget-banner.component.ts:111`; `chat-ui/.../compaction-notification.component.ts:20` |
| Agent panel                   | panel root now surface-1                                                                                                                            | `agent-monitor-panel.component.ts:214`                                                          |

The queued-message preview also now uses `bg-surface-1` / hover `bg-surface-2` at `chat-view.component.html:242`.

## Performance constraint

No wrapper component or DOM level was added in a per-message, per-node, or per-tool-row list. The migration uses plain classes, and no shadow was added to any repeated row. Existing code-block treatment remains distinct from its containing surface.

`content-visibility` was deliberately **not** added to `.chat-msg-slot`. The transcript has a render-window with persistent slots, measured placeholders, native scroll anchoring, saved scroll offsets, and rAF auto-follow (`chat-transcript.component.ts:776-905`). Skipping containment avoids mismatched intrinsic heights and scroll-height/anchor errors in the hot path.

## Test IDs

- `canvas` — grid root
- `canvas-tile` — each tile host (existing, retained)
- `canvas-tile-header` — tile drag/header bar
- `chat-composer` — composer root
- `chat-transcript-scroller` — transcript scroll container

## Specs and verification

- Updated composer-card intent assertion: `chat-input.component.spec.ts:237` verifies surface-2.
- `npx jest -c libs/frontend/chat/jest.config.ts ...chat-input... ...tool-call-item... --coverage=false --maxWorkers=2`: **66 passed**.
- `npx jest -c libs/frontend/chat-ui/jest.config.ts ...compaction... ...change-set... ...turn-tests... --coverage=false --maxWorkers=2`: **55 passed**.
- `npx nx typecheck @ptah-extension/chat --parallel=1`: exit 0 (no tail output).
- `npx nx typecheck @ptah-extension/chat-ui --parallel=1`: succeeded; Nx Cloud reported the organization disabled, which did not affect the target.

## Not done

No unrelated settings, shell/sidebar, marketplace, dashboard/Thoth, or shared UI work was changed. No visual/e2e run was performed, per the memory-safe verification constraint.
