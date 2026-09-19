## Outcome

The Angular notification center is implemented and mounted once in each product shell: beside the VS Code header actions for the non-Electron shell, and beside the Electron global theme control. It presents live permission/question prompts derived directly from `PermissionHandlerService`, plus a bounded 75-record completion ledger fed only by accepted terminal turn-state transitions.

Completion identity is `sessionId + revision`; replayed/equal revisions cannot create history, terminal healing remains possible without a pulse, and every non-completed terminal outcome is classified as an error. Prompt routing metadata is reactive through the published `routingTargetRevision` signal and prompt rows disappear with their source request.

Notification activation uses the core inversion token and a workspace-addressed FIFO `AppStateManager` bridge. The chat coordinator serializes view/layout/workspace/canvas work; the component-scoped canvas store focuses, adopts, or opens the target and acknowledges after a render turn. Completion read state changes only after a successful result. Canvas-cap results fall back to the full single-chat surface.

The bell is an accessible native button with exact-count labelling, a visual `9+` cap, dialog linkage, focus transfer/restoration, native keyboard activation, textual state labels, reduced-motion styling, and one polite live region. Sound is a generated Web Audio oscillator/gain envelope, created only after a trusted gesture, suppressed under automation, muted only through the versioned localStorage key, coalesced per 350 ms burst, and limited by a two-second cooldown.

## Files changed

| Path                                                                                         | Change                                                                                                                                          |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/frontend/notification-center/project.json`                                             | Created the Nx feature-library project and test/lint/typecheck targets.                                                                         |
| `libs/frontend/notification-center/eslint.config.mjs`                                        | Created Angular standalone/template lint configuration matching canvas.                                                                         |
| `libs/frontend/notification-center/jest.config.ts`                                           | Created Jest preset-angular configuration.                                                                                                      |
| `libs/frontend/notification-center/tsconfig.json`                                            | Created strict Angular base configuration.                                                                                                      |
| `libs/frontend/notification-center/tsconfig.lib.json`                                        | Created production compilation boundary.                                                                                                        |
| `libs/frontend/notification-center/tsconfig.spec.json`                                       | Created Jest compilation boundary.                                                                                                              |
| `libs/frontend/notification-center/src/test-setup.ts`                                        | Created Angular Jest setup.                                                                                                                     |
| `libs/frontend/notification-center/src/index.ts`                                             | Published only the standalone component and presentation types.                                                                                 |
| `libs/frontend/notification-center/src/lib/notification-center.types.ts`                     | Added completion, prompt, group, and row view models.                                                                                           |
| `libs/frontend/notification-center/src/lib/notification-center.store.ts`                     | Added derived prompts, bounded/deduplicated ledger, grouping, unread/read behavior, focus activation, announcement and sound burst aggregation. |
| `libs/frontend/notification-center/src/lib/notification-center.store.spec.ts`                | Added cap, dedupe, grouping, routing projection, source disappearance, read-on-success, and twelve-record storm coverage.                       |
| `libs/frontend/notification-center/src/lib/notification-sound.service.ts`                    | Added trusted-gesture Web Audio envelope, cooldown, automation suppression, and localStorage mute.                                              |
| `libs/frontend/notification-center/src/lib/notification-sound.service.spec.ts`               | Added gesture, suspended-context, cooldown, mute, and automation tests.                                                                         |
| `libs/frontend/notification-center/src/lib/notification-center.component.ts`                 | Added the OnPush bell, panel, rows, focus behavior, live region, and mute control.                                                              |
| `libs/frontend/notification-center/src/lib/notification-center.component.spec.ts`            | Added native-button, exact count, `9+`, ARIA, focus restoration, and live-region tests.                                                         |
| `libs/frontend/chat-state/src/lib/tab-manager.notification-pulse.spec.ts`                    | Added busy-to-terminal, background workspace, replay, classification, sleeping/waiting, and terminal-heal tests.                                |
| `libs/frontend/core/src/lib/tokens/notification-focus-router.token.ts`                       | Added the focus target/result/outcome/router contracts and DI token.                                                                            |
| `libs/frontend/chat/src/lib/services/notification-focus-coordinator.service.ts`              | Added the serialized cross-workspace focus transaction and canvas-cap fallback.                                                                 |
| `libs/frontend/chat/src/lib/services/notification-focus-coordinator.service.spec.ts`         | Added strict ordering, missing, cap fallback, and rapid-click serialization tests.                                                              |
| `libs/frontend/chat/src/lib/components/templates/app-shell.notification-center.spec.ts`      | Added VS Code placement and provider-wiring assertions.                                                                                         |
| `libs/frontend/chat/src/lib/components/templates/electron-shell.notification-center.spec.ts` | Added Electron global-nav placement and provider-wiring assertions.                                                                             |
| `tsconfig.base.json`                                                                         | Added the `@ptah-extension/notification-center` path alias.                                                                                     |
| `libs/frontend/chat-state/src/lib/tab-manager.service.ts`                                    | Published accepted terminal pulses after the tab update.                                                                                        |
| `libs/frontend/chat-state/src/index.ts`                                                      | Type-exported the terminal pulse and classification.                                                                                            |
| `libs/frontend/chat-streaming/src/lib/permission-handler.service.ts`                         | Added the readonly reactive routing-target revision and complete target cleanup invalidation.                                                   |
| `libs/frontend/chat-streaming/src/lib/permission-handler.service.spec.ts`                    | Pinned permission/question attachment and cleanup invalidation.                                                                                 |
| `libs/frontend/core/src/index.ts`                                                            | Exported the narrow focus-router token and types.                                                                                               |
| `libs/frontend/core/src/lib/services/app-state.service.ts`                                   | Added the FIFO workspace-addressed acknowledged canvas-focus request queue.                                                                     |
| `libs/frontend/core/src/lib/services/app-state.service.spec.ts`                              | Added FIFO, exact resolver, timeout removal, and all-outcome preservation tests.                                                                |
| `libs/frontend/chat/src/lib/components/templates/app-shell.component.ts`                     | Imported the component and provided the coordinator for the core token.                                                                         |
| `libs/frontend/chat/src/lib/components/templates/app-shell.component.html`                   | Placed the bell in the non-Electron app action group.                                                                                           |
| `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts`                | Placed the bell in Electron global actions and provided the coordinator.                                                                        |
| `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts`                                 | Consumed matching focus requests serially, focused/adopted/opened targets, and acknowledged structured outcomes after render.                   |
| `libs/frontend/canvas/src/lib/orchestra-canvas.component.spec.ts`                            | Extended bridge mocks and pinned cap acknowledgement/no-load behavior.                                                                          |

Every path above is in the closed Implementer A manifest. `package-lock.json` was already modified by dependency installation and was left untouched. No compact-session or `chat-ui` compact-card file was changed.

## Contracts published

```ts
export type TerminalTurnClassification = 'success' | 'error';

export interface TerminalTurnPulse {
  readonly seq: number;
  readonly tabId: string;
  readonly sessionId: string;
  readonly workspacePath: string;
  readonly revision: number;
  readonly phase: 'idle' | 'failed';
  readonly terminalReason: SdkTerminalReason | null;
  readonly classification: TerminalTurnClassification;
  readonly title: string;
  readonly occurredAt: number;
}

readonly terminalTurnPulse: Signal<TerminalTurnPulse | null>;
```

```ts
// PermissionHandlerService — Implementer B should consume this exact seam.
readonly routingTargetRevision: Signal<number>;

attachPromptTargets(promptId: string, tabIds: readonly string[]): void;
targetTabsFor(promptId: string): readonly string[];
attachQuestionTargets(questionId: string, tabIds: readonly string[]): void;
questionTargetTabsFor(questionId: string): readonly string[];
clearQuestionTargets(questionId: string): void;
```

`routingTargetRevision` changes after `attachPromptTargets()`, after `attachQuestionTargets()`, and after every successful permission/question target cleanup, including timeout/session cleanup. Consumers read it in their computed before reading either map accessor.

```ts
export type NotificationFocusOutcome = 'focused' | 'adopted' | 'opened' | 'cap-reached' | 'missing';

export interface NotificationFocusTarget {
  readonly workspacePath: string;
  readonly tabId?: string;
  readonly sessionId: string;
}

export interface NotificationFocusResult {
  readonly success: boolean;
  readonly outcome: NotificationFocusOutcome;
}

export interface NotificationFocusRouter {
  focus(target: NotificationFocusTarget): Promise<NotificationFocusResult>;
}

export const NOTIFICATION_FOCUS_ROUTER: InjectionToken<NotificationFocusRouter>;
```

```ts
export interface CanvasFocusRequest {
  readonly id: number;
  readonly target: NotificationFocusTarget;
  readonly resolve: (result: NotificationFocusResult) => void;
}

readonly canvasFocusRequests: Signal<readonly CanvasFocusRequest[]>;

requestCanvasFocus(
  target: NotificationFocusTarget,
): Promise<NotificationFocusResult>;

takeCanvasFocusRequests(
  workspacePath: string,
): readonly CanvasFocusRequest[];
```

## Acceptance evidence

| Track R criterion                                                                         | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 9. A background-workspace completion produces exactly one entry and replay produces none. | `tab-manager.notification-pulse.spec.ts` proves the accepted background busy→terminal edge, same-revision replay suppression, waiting/sleeping non-terminal behavior, total error classification, and terminal healing without a pulse. `notification-center.store.spec.ts` separately proves session+revision dedupe and the 75-record bound.                                                                                                                               |
| 10. Cross-workspace click switches/focuses and marks read only on success.                | `notification-focus-coordinator.service.spec.ts` proves strict view→grid→workspace→canvas ordering, missing handling, cap fallback, and serialized rapid activations. `app-state.service.spec.ts` proves FIFO resolver ownership and structured outcomes. `orchestra-canvas.component.spec.ts` proves cap acknowledgement without an extra session load. `notification-center.store.spec.ts` proves failed focus leaves `readAt` null and successful focus stamps it.        |
| 11. Keyboard bell and twelve completions produce one announcement and one sound.          | `notification-center.component.spec.ts` proves the native keyboard-operable button, exact accessible count, `9+` visual cap, dialog linkage, initial focus, Escape restoration, and single polite live region. `notification-center.store.spec.ts` proves twelve independently navigable records coalesce to one announcement and one `playBurst()` call. `notification-sound.service.spec.ts` proves one generated envelope per eligible burst and the two-second cooldown. |

## Verification

`npx nx reset` was run before the new project was tested. The first complete test run correctly reported six projects and found one failing test mock; the mock was fixed and the required six-project test command was rerun successfully.

Test command output (copied from the successful run):

```text
 NX   Running target test for 6 projects:

- @ptah-extension/notification-center
- @ptah-extension/chat-state
- @ptah-extension/chat-streaming
- @ptah-extension/core
- @ptah-extension/chat
- @ptah-extension/canvas

 NX   Successfully ran target test for 6 projects

@ptah-extension/core: Test Suites: 30 passed, 30 total
@ptah-extension/core: Tests:       727 passed, 727 total
@ptah-extension/chat-streaming: Test Suites: 24 passed, 24 total
@ptah-extension/chat-streaming: Tests:       1 skipped, 506 passed, 507 total
@ptah-extension/chat-state: Test Suites: 19 passed, 19 total
@ptah-extension/chat-state: Tests:       402 passed, 402 total
@ptah-extension/notification-center: Test Suites: 3 passed, 3 total
@ptah-extension/notification-center: Tests:       13 passed, 13 total
@ptah-extension/canvas: Test Suites: 9 passed, 9 total
@ptah-extension/canvas: Tests:       162 passed, 162 total
@ptah-extension/chat: Test Suites: 85 passed, 85 total
@ptah-extension/chat: Tests:       2 skipped, 1317 passed, 1319 total
```

Typecheck command output:

```text
 NX   Running target typecheck for 6 projects:

- @ptah-extension/notification-center
- @ptah-extension/chat-state
- @ptah-extension/chat-streaming
- @ptah-extension/core
- @ptah-extension/chat
- @ptah-extension/canvas

> nx run @ptah-extension/core:typecheck
> nx run @ptah-extension/chat-state:typecheck
> nx run @ptah-extension/chat-streaming:typecheck
> nx run @ptah-extension/notification-center:typecheck
> nx run @ptah-extension/chat:typecheck
> nx run @ptah-extension/canvas:typecheck

 NX   Successfully ran target typecheck for 6 projects
```

Lint command output:

```text
 NX   Running target lint for 6 projects:

- @ptah-extension/notification-center
- @ptah-extension/chat-state
- @ptah-extension/chat-streaming
- @ptah-extension/core
- @ptah-extension/chat
- @ptah-extension/canvas

@ptah-extension/notification-center: ✔ All files pass linting
@ptah-extension/canvas: ✔ All files pass linting

 NX   Successfully ran target lint for 6 projects
```

The successful lint run also printed existing warning-only findings in `chat-state`, `chat-streaming`, `core`, and `chat` (max-lines, non-null assertions, unused types, and empty functions). It reported zero errors and exited 0. The successful test run printed Jest worker forced-exit warnings for notification-center and canvas after all assertions passed; no suite failed.

## Gaps

- The architect's unverified host-level checks remain unproven here: actual AudioContext/autoplay behavior in a packaged VS Code webview and Electron renderer, and real Gridstack keyboard-focus transfer after a cross-workspace remount. No suitable multi-workspace host e2e fixture was in this lane's manifest.
- Unit/component coverage verifies the existing two-unit compact geometry is not mutated; this lane deliberately did not duplicate a browser pixel-height assertion owned by the compact-card lane.
- The worktree changes were not committed. The frontend-developer execution contract reserves staging/committing for the invoking workflow, so no git mutation beyond read-only status/diff checks was performed. `package-lock.json` remains the pre-existing dependency-install modification.
