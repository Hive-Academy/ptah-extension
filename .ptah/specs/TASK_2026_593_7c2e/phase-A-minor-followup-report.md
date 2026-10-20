# Phase A minor follow-up (M1–M3)

## Changes

| Item | Change | Spec |
| --- | --- | --- |
| M1 | `libs/frontend/chat/src/lib/services/chat-attention-host-message-handler.service.ts:164` waits for the scheduled backoff timer before draining a queued reconcile after snapshot failure. | `libs/frontend/chat/src/lib/services/chat-attention-host-message-handler.service.spec.ts:148` queues a reconcile during an in-flight failed fetch and checks that the next call occurs only after 2 seconds. |
| M2 | `libs/frontend/core/src/lib/services/notification.service.ts:95` compares the union of old and new item keys while retaining structural action comparison. | `libs/frontend/core/src/lib/services/notification.service.spec.ts:73` confirms an absent optional `context` replaces the old item. |
| M3 | `libs/frontend/chat/src/lib/components/templates/electron-shell.notification-center.spec.ts:56` renders the Electron shell with a delayed bell, requests an open before it mounts, and checks `openPanel()` runs exactly once after the view child appears. | Same behavioural spec. |

## Decisions

- Kept focus and visibility reset behaviour in `reveal()`. The queued run waits only when a failed fetch has already scheduled a retry; a fresh focus after exhaustion still resets the counter and starts a reconcile. This is reversible and follows the existing timer and focus paths.
- Used a narrow overridden Angular template in the Electron spec to control when the real `NotificationCenterComponent` appears. This exercises the shell's `viewChild` and effect without changing production markup. This is reversible and follows the nearby shell TestBed pattern.

## Not done

- No Nx, Jest, TypeScript compiler, lint, build, or other test command was run, as requested. Read-only Tree-sitter parsing reported zero syntax errors in all five edited files. The orchestrator owns scoped verification.
- `electron-shell.component.ts` needed no change.
