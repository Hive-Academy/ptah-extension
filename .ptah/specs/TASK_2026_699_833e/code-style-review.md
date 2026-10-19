# Code Style Review — `TASK_2026_699_833e`

## Summary

| Metric | Value |
| --- | --- |
| Implementer family | Claude |
| Review family | codex |
| Diff range | `9d5063f43^..5fc888d16` |
| Overall score | 5/10 |
| Verdict | REJECTED |
| Blocking issues | 1 |
| Serious issues | 1 |
| Moderate issues | 1 |
| Minor issues | 0 |

The score reflects a mostly conventional Angular implementation with one incomplete public contract and a substantial addition to an already oversized component. It is above the 3–4 band because the new store and existing handle defaults follow nearby patterns; it is below the 7–8 band because a consumer cannot name the new appearance type through the library entry point. Scope: the changed Angular source and tests, the chat-ui entry point, two nearby stores, the existing Electron resize handle, the task plan, design spec, project tags, and repository guidance. I inspected the full new handle and width store; the large chat view was inspected through its structure, diff, and affected sections, so this is a rejection rather than an approval of its unreviewed legacy sections.

## Numbered findings

1. **Blocking — Export the new appearance type through the public entry point.** `SplitHandleAppearance` is a named exported type in `libs/frontend/chat-ui/src/lib/atoms/split-handle.component.ts:14` and types the public `appearance` input at `:117`, but `libs/frontend/chat-ui/src/index.ts:17-20` re-exports only the component and orientation type. Cross-project consumers must use the `@ptah-extension/chat-ui` entry point, so a typed host cannot import the appearance contract without crossing the declared library boundary. Add `type SplitHandleAppearance` beside `SplitHandleOrientation` in the barrel.

2. **Serious — Move the new dock orchestration out of the oversized chat view.** `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:1162-1245` adds the persistence binding, transient width state, responsive width calculation, tab opener lookup, commit policy, and reset action directly to `ChatViewComponent`. The file grew from 2,041 to 2,135 physical lines in this diff and was already far beyond `eslint.config.mjs:558-561`'s 700-line warning. The task explicitly treats that warning as a hard limit for new code. A small inspector dock controller or store adjacent to `inspector-shell.controller.ts` would keep the view as a binding surface and give these related policies one home. This is an incremental structure finding, not a demand to refactor unrelated legacy code.

3. **Moderate — The two appearance branches duplicate the separator contract.** `libs/frontend/chat-ui/src/lib/atoms/split-handle.component.ts:44-95` repeats role, tab stop, aria values, label, title, pointer handlers, keyboard handler, and double-click reset across the grip and line branches. A later accessibility or interaction change can reach one variant only. Keep one separator element with shared bindings and branch only for its visual children and appearance classes. The existing line appearance remains the default at `:117`, so this can be changed without altering consumers.

## Five style questions

1. **What breaks in six months?** A new separator attribute or interaction may be added to only one branch at `split-handle.component.ts:44-95`; a typed consumer of a third appearance cannot import the current appearance type from `chat-ui/src/index.ts:17-20`.
2. **What would a new team member misread?** `SplitHandleAppearance` appears exported at `split-handle.component.ts:14`, but that is not the library's public surface (`chat-ui/src/index.ts:17-20`). The `planCardClass` export at `stats-tile.styles.ts:66` is an internal module export used by its sibling tile at `plan-limit-tile.component.ts:16,354`, not a barrel API.
3. **What does this cost to maintain?** The 84-line dock block at `chat-view.component.ts:1162-1245` increases the navigation and change cost of a 2,135-line component; the duplicated separator contract at `split-handle.component.ts:44-95` requires paired edits.
4. **Where is this inconsistent with the repository?** `chat-ui/src/index.ts:17-20` already re-exports the handle's other named type, while `inspector-open-state.service.ts:16-26` and `composer-draft.store.ts:15-23` keep related inspector or draft state in root-provided, signal-based services. The new width store follows that service pattern at `inspector-dock-width.store.ts:42-49`.
5. **What would I do differently, and why?** Re-export the missing type, extract the cohesive dock state/policy from `chat-view.component.ts:1162-1245`, and render one separator with appearance-specific children. These steps reduce API surprise, component growth, and duplicated accessibility work while preserving the planned defaults.

## Pattern compliance

| Rule | Status | Evidence |
| --- | --- | --- |
| Standalone, OnPush, `input()`/`output()` | PASS | `split-handle.component.ts:40-43,107,109-125`; `plan-limit-tile.component.ts:46-49,333-343` |
| `inject()`, root DI, signals | PASS | `inspector-dock-width.store.ts:42-56`; `chat-view.component.ts:1165,1194-1214` |
| Existing handle defaults and consumers | PASS | `split-handle.component.ts:110,116-117`; `agent-lane-grid.component.ts:62`; `compact-session-activity.component.ts:559` |
| Public alias and complete public type surface | FAIL | `chat-ui/src/index.ts:17-20`; `split-handle.component.ts:14,117` |
| Project boundary tags | PASS | `libs/frontend/chat/project.json:6`; `libs/frontend/chat-ui/project.json:6` both carry `scope:webview` and `type:feature` |
| Filename and test pairing | PASS | `inspector-dock-width.store.ts:43`; `inspector-dock-width.store.spec.ts:10`; `split-handle.component.ts:109`; `split-handle.component.spec.ts:70` |
| Design tokens and card surface | PASS | `stats-tile.styles.ts:66-68`; `split-handle.component.ts:130-167`; design spec sections 2–4 |
| No new `any`, unsafe double casts, decorators, or deep cross-project imports | PASS in reviewed additions | `inspector-dock-width.store.ts:1-6`; `plan-limit-tile.component.ts:1-21`; `chat-view.component.ts:45-68` |
| New code respects file-size limit | FAIL | `chat-view.component.ts:1162-1245`; `eslint.config.mjs:558-561` |

## Verification and uncertainty

`ptah_get_diagnostics` was requested for four affected TypeScript files. Its compiler check remained unavailable after 45 seconds and reported all four unchecked. Tests and builds were intentionally not run because another lane owns them. Existing `console.warn` calls at `chat-view.component.ts:1520,2089` are outside the changed lines and were not counted as findings. No new `as any`, `as unknown as`, `@Input`, or `@Output` appeared in the reviewed production additions.

## Decisions

- Treat `planCardClass` as an internal named export, because its only observed import is the adjacent `plan-limit-tile.component.ts:16`; adding it to the chat-ui barrel would enlarge the public API without an external consumer. Reversible.
- Keep the `InspectorDockWidthStore` name and location: it persists only the inspector dock width and sits beside the inspector shell and open-state services (`session-inspector/index.ts:20-22`). Reversible.

## Verdict

**REJECTED**, confidence medium. Resolve finding 1 before exposing the new handle API; address findings 2 and 3 to keep the shipped Angular structure maintainable. Diagnostics and the parallel test lane remain outstanding verification.
