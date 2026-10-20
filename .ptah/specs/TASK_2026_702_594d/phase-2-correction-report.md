# Phase 2 bounded correction

## M2: repeated layout write failure

- `libs/frontend/canvas/src/lib/canvas-layout-persistence.service.ts:159-160,334`: Exposed a read-only `writeFailureCount` signal and incremented it on each failed write.
- `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts:278`: Included the count in the notice source key so a later failure refreshes a dismissed notice while `writeFailed` remains true.
- Covering specs: `libs/frontend/canvas/src/lib/canvas-layout-persistence.service.spec.ts:177-189` checks the counter progresses from 0 to 2 across two failures; `libs/frontend/canvas/src/lib/orchestra-canvas.component.spec.ts:412-426` checks a dismissed write-failure notice returns after another failure.

## Minor: empty-board recent-session reload

- `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts:398,441-444`: The load effect reads a boolean computed for the zero-tile state and keeps `load` inside `untracked`.
- Covering spec: `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.spec.ts:1156-1163` checks that replacing an empty tile array does not reload recent sessions.

## Verification

- Final focused Jest result: `Tests:       159 passed, 159 total`.
- Scoped `ptah_get_diagnostics` was unavailable because its TypeScript check remained in progress past the tool timeout.

## Decisions

- Used a monotonic failure count rather than toggling `writeFailed`: the review specifies a counter, and it preserves the existing true failure state. Reversible.
- Used a boolean computed over `orderedTiles()` because Angular's computed equality keeps an unchanged empty state from triggering the load effect. Reversible.
