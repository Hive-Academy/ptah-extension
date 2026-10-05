# Batch C2b report — `ptah-ui` block snapshot input

**Status: COMPLETE** — all checks green.

## Input name

`snapshot = input<TurnSourceSnapshot | null>(null)` — the exact name the plan gives
(`implementation-plan.md`, component 9: "A `snapshot` input change updates in place
(Req 3.2)"; component 10 threads the same value into the bubble as `ptahUiSnapshot`).
Declared at `libs/frontend/chat-ui/src/lib/organisms/ptah-ui/ptah-ui-block.component.ts:150-151`.

The worktree already carried this input and its wiring when the batch resumed (the batch was
marked IN_PROGRESS). I verified it against the plan and the committed shared API
(`renderPtahUiBlock(body, { surfaceId, snapshot, countBytes })`,
`libs/shared/src/mcp-apps-contracts/ptah-ui-pipeline.ts:9-20`; `TurnSourceSnapshot`,
`libs/shared/src/lib/utils/turn-sources.utils.ts:40-46`) and made **no component change** —
what the batch still lacked were the four required specs, added below.

## How the in-place update works (live blocks)

`result` (`ptah-ui-block.component.ts:170-186`) reads `this.snapshot()` in its pipeline
options alongside `body()` and `surfaceId()`. Because the computed tracks the input signal,
a `snapshot` set on the host re-runs the pipeline once and produces a new
`RenderPtahUiBlockResult`; `renderable()` feeds the new `content` into the same
`<ptah-surface-renderer [renderable]>` binding. The `@if (renderable())` branch never toggles
for an ok→ok transition, so neither the block nor the renderer is destroyed — the update is
in place. New spec (a) asserts the same `PtahUiBlockComponent` instance plus the new
rendered text.

## How the snapshot-freeze works (non-live blocks)

When the block leaves the live window, `freeze()` (`ptah-ui-block.component.ts:244-250`)
captures the current result into the `frozen` signal and sets `snapshotMode`. From then on
`result`'s only tracked read is `this.frozen()` — the early
`if (frozen !== null) return frozen` returns before `body()`/`snapshot()` are read, so a later
`snapshot` change is not a dependency of the computed and it never re-evaluates: 0 pipeline
recomputations, the DOM keeps the frozen renderable, and `afterNextRender` detaches change
detection. New spec (b) asserts the pipeline counter stays at its mount value (1) and the DOM
still shows the frozen `unavailable` after the host sets available data. The existing
live-cap instrumented test (0 recomputations for frozen, 1 per change for live) is untouched
and still green.

## Specs added (`ptah-ui-block.component.spec.ts`, single-block describe)

Only tests were added; no existing test was modified (fallback HTML, reason line,
`renderFailed`-only binding, tab order, axe matrix, chart names and the live-cap
instrumented test are unchanged).

- (a) `updates a live block in place when $diff goes from pending to available` — starts with
  the `PENDING` snapshot (`$diff`/`$tests`/`$usage` all pending), host then sets the `EMPTY`
  snapshot: same component instance (no remount), text now contains
  `No files changed this turn`, `No tests ran this turn` and `$0.01`, and no `pending` left.
- (b) `never recomputes a frozen (non-live) block when the snapshot changes` — the block mounts
  outside the newest 8 (`PtahUiLiveWindow.register` × 8, same as the axe snapshot state),
  pipeline counter is 1 at mount and stays 1 after the host sets `EMPTY`; the DOM keeps the
  frozen `unavailable`.
- (c) `renders "unavailable" for sources while the snapshot is null` — null snapshot with a
  source body: `unavailable` present, `pending` absent, no fallback reason line.
- (d) `leaves a block without sources unaffected by snapshot changes` — literal body across
  `null → PENDING → EMPTY`: `textContent` identical, mode stays `live`, same
  `SurfaceRendererComponent` instance, no reason line.

## Verification

Command: `npx jest -c libs/frontend/chat-ui/jest.config.ts libs/frontend/chat-ui/src/lib/organisms/ptah-ui/`

- Before the edit: `Test Suites: 2 passed, 2 total` / `Tests: 29 passed, 29 total`
- After the edit: `Test Suites: 2 passed, 2 total` / `Tests: 33 passed, 33 total`
  (+4, all in `ptah-ui-block.component.spec.ts`; exit code 0)

Command: `npx nx run-many -t typecheck,lint -p @ptah-extension/chat-ui --parallel=1`

- Result: `NX Successfully ran targets typecheck, lint for project @ptah-extension/chat-ui`
  — 2/2 tasks passed, exit code 0 (run duration 1m48s, critical path 1m29s, 0 cache hits).

## Notes / not done

- No component edit was required: requirements 1–2 (input name, computed dependency,
  in-place update, frozen 0-recomputation) were already satisfied in the worktree when the
  batch resumed; I verified them against source instead of re-editing.
- Nothing was blocked; no clarifications needed.
