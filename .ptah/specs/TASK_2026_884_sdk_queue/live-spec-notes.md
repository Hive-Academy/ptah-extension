# Live follow-up queue spec

Run from a built Electron checkout with an existing Claude login:

```sh
cd apps/ptah-electron-e2e && PTAH_E2E_LIVE=1 npx playwright test src/specs/chat/live-follow-up-queue.spec.ts
```

The spec is opt-in and uses the real backend. `launchPtah` isolates Electron user data and `PTAH_DB_PATH` (`apps/ptah-electron-e2e/src/support/electron-launcher.ts:94-125`); this spec passes a temporary positional workspace and leaves `HOME` and `USERPROFILE` ambient. Screenshots go to `live/00-haiku-selected.png` through `live/10-restored-message-sent.png`.

## Selectors and RPCs

| Selector or RPC | Source |
| --- | --- |
| `ptah-chat-input textarea[role="combobox"]` | `libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.ts:293-327` |
| `[data-testid="chat-send-btn"]`, `[data-testid="chat-stop-btn"]` | `libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.ts:498,519` |
| `[aria-label="Queued messages"]` | `libs/frontend/chat/src/lib/components/molecules/queued-follow-ups/queued-follow-ups.component.ts:36` |
| `[data-testid="chat-user-message"]`, `[data-testid="chat-tool-output"]` | `libs/frontend/chat/src/lib/components/organisms/message-bubble.component.html:10,210` |
| `li[ptah-canvas-rail-card][data-tab-id]` | `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-card.component.ts:51,77` |
| `.rc-select` | `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-rail-card.component.spec.ts:279` |
| New session triggers | `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail.component.ts:290`; `libs/frontend/canvas/src/lib/canvas-rail/canvas-empty-board.component.ts:236`; helper `apps/ptah-electron-e2e/src/support/new-session-trigger.ts:13-23` |
| `config:models-list`, `config:model-switch` | `libs/shared/src/lib/types/rpc.types.ts:1270,1286` |
| `session:list` | `libs/shared/src/lib/types/rpc.types.ts:1137`; params `libs/shared/src/lib/types/rpc/rpc-session.types.ts:81` |
| `chat:resume` history-only | `libs/shared/src/lib/types/rpc.types.ts:1106`; `libs/shared/src/lib/types/rpc/rpc-chat.types.ts:388-430` |

## Assumptions and limits

- The scratch workspace has no preexisting sessions, so `session:list` identifies the first started session and then the second by exclusion.
- The active provider is the developer's ambient Claude/Anthropic login. The spec fails clearly if its scoped model catalog has no Haiku ID. `config:model-switch` sets the chosen model at workspace scope before either turn.
- `chat:resume` without `activate` is documented as history-only. The hidden-tab poll reconstructs assistant text from replay events; it does not activate the tab.
- This environment cannot launch the app or run Playwright. The live behavior and screenshot output remain unverified until the coordinator executes the opt-in command.
