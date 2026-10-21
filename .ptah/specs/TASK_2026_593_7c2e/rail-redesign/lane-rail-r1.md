# Canvas rail Needs you queue — revision 1

## Defects addressed

1. **Session identity:** `canvas-rail.component.ts:196-198` renders `item.sessionTitle || 'Session unavailable'` as the session line and keeps `item.title` as the kind label. `canvas-rail.component.spec.ts:87-104` covers a missing title and disabled Allow.
2. **Overflow opens the bell:** `canvas-rail.component.ts:332-340` checks the existing bell's `aria-expanded` before clicking its `data-testid="notification-center-bell"` trigger. A missing bell produces a visible status at line 219. Both queue and card overflow route through this method (`canvas-rail.component.ts:216,266`). `canvas-rail.component.spec.ts:106-123` checks missing bell feedback and repeated opening without closing.
3. **Outcome state:** `canvas-rail.component.ts:343-360,390-397,408-427` stores status with generation, blocks all row actions on stale or unavailable outcomes, and prunes old statuses when the request generation changes. The card receives submitting and blocked keys at `canvas-rail.component.ts:263-264` and disables its inline buttons at `canvas-rail-card.component.ts:172`. `canvas-rail.component.spec.ts:125-143` covers stale and unavailable, repeat clicks, and new generations; `canvas-rail-card.component.spec.ts:273-278` covers submitting and blocked inputs.
4. **One tile per request:** `canvas-rail.component.ts:383-389` prefers a current tile's matching tab ID. Session ID fallback selects the first matching ordered tile only. `canvas-rail.component.spec.ts:145-154` covers conflicting tab and session IDs and fallback.
5. **Primary action:** `rail-attention-action.ts:3-13` defines the shared rule. Queue and card use it at `canvas-rail.component.ts:203` and `canvas-rail-card.component.ts:172`. The card exposes the `open` action at line 171. `canvas-rail.component.spec.ts:87-104` and `canvas-rail-card.component.spec.ts:255-278` cover enabled Allow, disabled Allow, and promoted Show in canvas.
6. **Dispatcher spec:** `canvas-rail.component.spec.ts:48-81` stubs and asserts `dispatchOutcome`; the completed mock resolves the authoritative notification item. The outcome cases above cover stale and unavailable.

## Verification and scope

`ptah_get_diagnostics` found no errors in the five changed canvas source and spec files. It still reports nine errors in untouched core and shared files. `git diff --check -- libs/frontend/canvas/src/lib/canvas-rail` passed. Per instruction, no Nx, Jest, TypeScript CLI, lint, build, commit, or push was run. Only files under `libs/frontend/canvas/src/lib/canvas-rail/` were edited in this round; this report is the requested deliverable.

## Decisions

- The existing bell exposes a toggle button and no DOM callable open method. Checking its `aria-expanded` before clicking makes overflow idempotent without importing notification-center across module boundaries.
- A stale or unavailable outcome blocks the current generation's row and card actions; a new generation restores actions and drops the old status.
