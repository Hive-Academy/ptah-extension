# Batch 10 report — Apps pure state: operation ids and overlays

Executor: CLI lane (Batch 10, Task 10.1). Branch `feat/task-494-apps-page`.
Worktree root: `D:/projects/ptah-extension/.claude-worktrees/feat-task-494-apps-page-98c5a1802772`

## Files created (4)

- `D:/projects/ptah-extension/.claude-worktrees/feat-task-494-apps-page-98c5a1802772/libs/frontend/mcp-apps-page/src/lib/state/surface-operation-id.ts`
- `D:/projects/ptah-extension/.claude-worktrees/feat-task-494-apps-page-98c5a1802772/libs/frontend/mcp-apps-page/src/lib/state/surface-operation-id.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/feat-task-494-apps-page-98c5a1802772/libs/frontend/mcp-apps-page/src/lib/state/apps-operation-overlays.ts`
- `D:/projects/ptah-extension/.claude-worktrees/feat-task-494-apps-page-98c5a1802772/libs/frontend/mcp-apps-page/src/lib/state/apps-operation-overlays.spec.ts`

`mcp-apps-page/src/index.ts`, other libs and configs were not touched. The `state/` folder was new.

## Requirement handling

### `surface-operation-id.ts`

- `createSurfaceOperationId(now = Date.now(), random = randomAlphanumeric(16))` returns `op-${now}-${random}`
  (plan signature, implementation-plan.md:524). `SURFACE_OPERATION_RANDOM_LENGTH = 16`.
- The result matches `SURFACE_OPERATION_ID_PATTERN` (`/^op-[0-9]{13}-[A-Za-z0-9]{8,40}$/`,
  `surface-catalog.ts:76`); the spec pins it for a 13-digit fixed clock with both an injected and the
  default random part.
- Clock and random source are optional injectable parameters (A2): the id takes `now` and the random
  string; `randomAlphanumeric(length, randomBytes?)` takes a `RandomByteSource` (`(count) => Uint8Array`)
  so byte-level behaviour is pin-able without any global.
- No modulo bias: the alphabet has 62 characters; bytes `>= 248` (62 x 4) are drawn again instead of
  folded, so every accepted byte maps uniformly via `byte % 62`.
- Never hangs: a source that yields zero bytes ends the draw; a non-positive length returns `''`.

### A2 (`globalThis.crypto.getRandomValues` in jest)

Resolved: jest DOES provide `globalThis.crypto.getRandomValues` in this lib's environment. The spec's
default-path cases ("creates a distinct id per call at the same clock", the 200-character alphabet
draw, `createSurfaceOperationId()` with both defaults) call the un-injected default and passed. The
injection is kept regardless — both parameters stay optional, so specs never depend on the global.

### `apps-operation-overlays.ts`

- Pure, immutable `AppsOperationOverlays` (Rule 4, implementation-plan.md:574-582): overlays live in a
  `Map<operationId, overlay>` in send order (Map insertion order); every operation returns a NEW
  instance and leaves the source untouched (spec-pinned).
- Each overlay carries `operationId`, `path`, `value: SurfaceDataValue`, `baseRevision`, plus
  `settledRevision: number | null` (the ack revision once the operation settled).
- Operations: `add` (send order, duplicate id and invalid shape ignored), `retire(operationId)`
  (removes exactly that overlay), `retireSettledUpTo(revision)` (retires every settled overlay whose
  ack revision is at or below the materialized revision), `retireAllSettled()` (a read retires every
  settled overlay; pending ones stay for a later settle), `pendingValues()` (latest unretired overlay
  per path). Plus read-only `size`, `list()` (send order), `has`, `get`.
- Deliberate addition: `settle(operationId, ackRevision)`. The batch prompt names
  add/retire/retireSettledUpTo/retireAllSettled, but `retireSettledUpTo` retires "every settled
  overlay whose ACK REVISION is at or below the materialized revision" (plan :580-581), which requires
  recording the ack revision at settle time (the `applied` result, plan :549-551). `settle` is that
  recording step; it settles an operation once and never retires by itself.
- `pendingValues(): SurfaceInteractionState['pendingValues']` — the return type IS the renderer's
  pending-value type (type-only import from `@ptah-extension/declarative-dashboard`, sanctioned by
  D-4/R4; type imports erase at runtime). The spec also assigns the result into a
  `Pick<SurfaceInteractionState, 'pendingValues'>` object to pin compatibility.
- Never throws: invalid overlays (`null`, empty id/path, non-finite baseRevision), unknown ids and
  non-finite revisions are no-ops returning the same state; all pinned by `it`-level specs. No timers,
  no Angular DI, no signals.

### Spec pins (all present)

- Id: exact string for a fixed clock + injected random; pattern match for the fixed clock with the
  default source; pattern match from the default clock; distinct ids per call at the same clock;
  injected-byte mapping, rejection of bytes >= 248, refill until length, zero-byte termination,
  alphabet-only 200-character default draw.
- Overlays: send order (`list()`); latest-wins per shared path; `retire` of one overlay reveals the
  older value for the path and leaves a newer overlay untouched; `retireSettledUpTo` at / below /
  above the ack revision; `retireAllSettled` keeps pending overlays; reconciliation case 6 (older
  overlay settles while a newer edit to the same path is pending — the newer value stays displayed
  until it settles and a read retires it); duplicate id ignored; single settle; never-throws matrix;
  immutability of discarded instances; every `SurfaceDataValue` kind overlays.

## Repo rules

- No `catch` was needed, so no `catch (error: unknown)` question arises.
- No `as any`, no `@ts-ignore`. The spec uses `null as unknown as SurfaceValueOverlayInput` for the
  never-throws pin; the guard uses `as Record<string, unknown>` with bracket access because
  `noPropertyAccessFromIndexSignature` is on (first typecheck run failed on dot access; fixed).
- Strict mode on (`tsconfig.json` of the lib); no stubs, no TODOs.

## Verification

Command (from the worktree root):

```
npx nx run-many -t lint,typecheck,test -p @ptah-extension/mcp-apps-page --skip-nx-cache
```

Result: 3/3 targets green. Direct jest run: `Test Suites: 2 passed, 2 total; Tests: 22 passed, 22 total`.

Last 10 lines of the run:

```
>  NX Successfully ran targets lint, typecheck, test for project @ptah-extension/mcp-apps-page


Output of 3 successful tasks were not shown. Run with --verbose or --output-style=static to see it.

  Run duration:      20.3s
  Cache:             Skipped (--skip-nx-cache)
  Critical path:    15.7s (1 task)
  Recoverable time:   4.5s (22% of the run)
```

## Not done / deviations

- Nothing skipped. One deviation from the prompt's operation list: `settle(operationId, ackRevision)`
  was added (justified above); the prompt's own spec pin "an older overlay SETTLING while a newer one
  on the same path is pending" requires it.
- `batches.md` and every other task-folder file untouched; no git commands run.