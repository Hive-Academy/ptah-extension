# Lane report R9h fix round

## Defect 1: ChatView Rail retention and dock coverage

- `libs/frontend/chat/src/lib/components/templates/chat-view.dock.spec.ts:863` adds **Rail ChatView retains two transcript DOM nodes and restores its own dock state on context round trip**. It checks two transcript nodes, DOM identity, active inputs, and the injected `DisplayDockState` open, pinned, and width state after a context round trip. The separator width assertion exercises `syncDockWidthPerTab`.
- `libs/frontend/chat/src/lib/components/templates/chat-view.dock.spec.ts:895` adds **contextual ChatView without Rail token renders exactly one transcript**.
- `libs/frontend/chat/src/lib/components/templates/chat-view.keepalive.spec.ts:233` keeps the required named retention case and removes assertions against a separately constructed dock store. The actual ChatView dock path is covered in the dock spec.

## Defect 2: Main panel destroy must preserve its tree cache

- `libs/frontend/chat/src/lib/services/transcript-retention.service.ts:69` registers retained-owner destroy cleanup only for Rail opt-in hosts. Ordinary main-panel destroy leaves its tree memo unchanged.
- `libs/frontend/chat/src/lib/services/transcript-retention.service.spec.ts:280` adds **main panel destroy leaves its retained tree cache intact** and `:287` adds **Rail host destroy releases its retained tree cache owners**.

## Defect 3: Owned agents in the Rail host

- `libs/frontend/chat/src/lib/components/templates/chat-view.dock.spec.ts:307` makes the `agentsOwnedBySession` mock filter by `parentSessionId === sid`.
- `libs/frontend/chat/src/lib/components/templates/chat-view.dock.spec.ts:853` adds **Rail host counts an owned running agent in Agents (N), shows its badge, and auto-opens the dock**. The unresolved negative case and the `SESSION_CARD_ACTIONS` tolerant case retain their required names.

## Defect 4: Closed context tab transcript

- `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:837` filters Rail retained ids through `findTabByIdAcrossWorkspaces`, and appends the context id only when it resolves. Reading `tabs()` makes a close invalidate this computed value.
- `libs/frontend/chat/src/lib/components/templates/chat-view.dock.spec.ts:909` adds **Rail ChatView removes the closed context tab transcript before context changes**. The harness emits a close notification and removes the tab while the context id still names it.

## Checks

- `node .ptah/tmp/check-run.mjs r9hf-ret -- npx nx test @ptah-extension/chat --testFile=transcript-retention.service.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`: Tests: 18 passed, 18 total.
- `node .ptah/tmp/check-run.mjs r9hf-keep -- npx nx test @ptah-extension/chat --testFile=chat-view.keepalive.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`: Tests: 2 passed, 2 total. The existing NG0101 recursive-tick messages remain in the harness output.
- `node .ptah/tmp/check-run.mjs r9hf-dock -- npx nx test @ptah-extension/chat --testFile=chat-view.dock.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`: Tests: 26 passed, 26 total. The existing SessionLoader restore and NG0956 warnings remain in the harness output.

## Decisions

- Rail transcript filtering uses the existing tab-manager resolver so retained tabs in another workspace can remain mounted while a closed id disappears immediately.
- The keepalive stub continues to test retention; dock state assertions now live in the real ChatView harness.
- M3, minors m1-m3, and formatting notes were outside this fix round and were not changed.
