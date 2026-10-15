# Phase C fix round 1 — chat

| Finding | Status | File:line | Test |
| --- | --- | --- | --- |
| S3 dock/sidebar regression | Fixed: only the forced-card signal suppresses either panel. User-selected compact mode retains them. | `libs/frontend/chat/src/lib/components/templates/chat-view.component.html:268,340` | `chat-view.component.spec.ts:2270,2285,2297` |
| S2 forced-card actions | Fixed: forced open/full-output use `openSession`, and lane selection uses `openLane`. Without host actions, forced clicks leave the stored mode alone. Unforced behavior remains unchanged. | `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.ts:91,94,323,333` | `compact-session-card.component.spec.ts:357,384` |
| S1 composer draft loss | Fixed: text, selected files and pasted images survive remount by tab ID. Successful send and tab closure clear the entry. | `libs/frontend/chat/src/lib/services/composer-draft.store.ts:20,27`; `libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.ts:1535,1573` | `chat-input.component.spec.ts:244,259` |
| Chat style minors | Fixed: `showCompactCard` is protected, comments now name it, and the token has a block doc comment. | `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:841,907,922`; `libs/frontend/chat/src/lib/tokens/session-context.token.ts:46` | Typecheck and lint |

## Draft-store finding

No existing per-tab composer draft store was found in chat, chat-state or core. `queuedContent` in `libs/frontend/chat-state/src/lib/tab-manager.service.ts:491,2081` is pending send content, and `composerPrefillRequest` in `libs/frontend/core/src/lib/services/app-state.service.ts:490,723` is a one-shot prefill. The component's text, file and image signals were local at `chat-input.component.ts:660,678,679`. The new `ComposerDraftStore` at `libs/frontend/chat/src/lib/services/composer-draft.store.ts:20` uses `TabManagerService.onTabClosed` (`libs/frontend/chat-state/src/lib/tab-manager.service.ts:285`) and releases its listener on destroy. Drafts remain in memory for the life of an open tab.

## Checks

| Command | Result |
| --- | --- |
| `npx nx test @ptah-extension/chat --testFile=chat-view.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` | Passed: 91 tests |
| `npx nx test @ptah-extension/chat --testFile=compact-session-card.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` | Passed: 31 tests |
| `npx nx test @ptah-extension/chat --testFile=chat-input.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` | Passed: 77 tests |
| `npx nx typecheck @ptah-extension/chat --parallel=1 --skip-nx-cache` | Passed; one warning in unchanged peer-session-send dialog |
| `npx nx lint @ptah-extension/chat --parallel=1 --skip-nx-cache` | Passed; 0 errors, 38 warnings |

## Open items

None for this chat-side fix. No TASK_2026_628-owned files or other frontend libraries were edited.
