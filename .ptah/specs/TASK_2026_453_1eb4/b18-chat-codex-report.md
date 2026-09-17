# Batch 18 Chat Unit-Spec Quality Report

## Result

- Task 18.1: **COMPLETE**. Shared transcript spec setup is consolidated in
  `libs/frontend/chat/src/lib/components/organisms/transcript/testing/transcript-spec-harness.ts`.
- Task 18.2: **CANCELLED (not feasible on branch)**. The current Angular Jest/jsdom harness does
  not expose the transient `animate.enter` class, and making it observable requires a different
  animation/browser harness or configuration outside this branch-safe batch.
- Blocking findings: none.

## Task 18.1 pre-edit duplicate-block inventory

This inventory was recorded before the first source edit. Line numbers in this section are the
pre-edit locations.

| Duplicated block                                                                                                                                       | Pre-edit locations                                                                                                                                                                                                | Disposition                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MessageBubbleStub` and `EmptyStateStub`                                                                                                               | `chat-transcript.component.spec.ts:70-93`; `chat-transcript.component.replay-motion.spec.ts:51-74`; `chat-transcript.component.replay-mount.spec.ts:59-82`; `chat-transcript.older-history.spec.ts:47-66`         | Moved once to the harness. The replay specs import `TranscriptMessageBubbleStub` when they need to inspect inputs.                                                                                                                |
| Transcript TestBed service stubs (`VSCodeService`, `TabManagerService`, `ExecutionTreeBuilderService`, `SESSION_CONTEXT`) and child-component override | `chat-transcript.component.spec.ts:151-171`; `chat-transcript.component.replay-motion.spec.ts:115-132`; `chat-transcript.component.replay-mount.spec.ts:201-218`; `chat-transcript.older-history.spec.ts:137-157` | Moved to `configureTranscriptTestBed`; icon URI, tabs signal, tree builder, and session context are explicit options/defaults.                                                                                                    |
| Fake `IntersectionObserver`                                                                                                                            | `chat-transcript.component.spec.ts:320-355`; `chat-transcript.component.replay-mount.spec.ts:84-120`; `chat-transcript.older-history.spec.ts:68-97`; `transcript-render-window.spec.ts:17-55`                     | Moved once to the harness. Its `emit` overload preserves both array-entry and target/boolean driving styles.                                                                                                                      |
| Fake `ResizeObserver`                                                                                                                                  | `chat-transcript.component.replay-mount.spec.ts:122-136`; `chat-transcript.older-history.spec.ts:99-111`                                                                                                          | Moved once to the harness.                                                                                                                                                                                                        |
| Observer global install/reset/cleanup                                                                                                                  | component render-window suites around `chat-transcript.component.spec.ts:357-381` and `:556-584`; replay mount `:257-280`; older history `:113-127`, `:180-184`; render-window unit spec `:57-67`, `:103-106`     | Moved to explicit harness install/remove functions. Per-suite timer/RAF lifecycle remains local.                                                                                                                                  |
| Message/tree factories                                                                                                                                 | `chat-transcript.component.spec.ts:95-118`; `chat-transcript.component.replay-mount.spec.ts:140-158`                                                                                                              | Moved to `makeTranscriptMessage` / `makeTranscriptTree`. Replay-mount keeps two thin local wrappers solely to choose its distinct `history` / `replayed content` values explicitly.                                               |
| Tab fixtures/signals                                                                                                                                   | component `:136-149`; replay motion `:106-114`; replay mount `:181-200`; older history `:129-136`                                                                                                                 | Kept local because behavior differs: writable messages and streaming state, status transitions, replay revisions, and older-history paging are separate test controls. Silently unifying these would weaken the seams under test. |
| `ngx-markdown` Jest module mock                                                                                                                        | component `:25-51`; replay motion `:11-39`; replay mount `:12-40`; older history `:19-45`                                                                                                                         | Kept spec-local. Jest module mocks must be hoisted in each consuming spec, and the component spec intentionally renders `data` while the replay specs use an empty template.                                                      |
| Immediate `requestAnimationFrame` spy                                                                                                                  | component `:199-205`, `:367-372`, `:570-575`, `:683-689`                                                                                                                                                          | Kept in its owning describes because restoration/lifecycle and the behavior being driven are describe-specific.                                                                                                                   |
| Prepend-anchor host/geometry harness                                                                                                                   | `transcript-prepend-anchor.directive.spec.ts:25-102`                                                                                                                                                              | Kept local. It tests directive DOM geometry and contains none of the transcript component stubs, service setup, tab/tree fixtures, or fake observer blocks above.                                                                 |

Convention cited: `libs/frontend/core/src/testing/test-bed-setup.ts:1` and
`libs/frontend/core/src/testing/signal-store-harness.ts:1` establish the frontend `src/testing/`
convention and descriptive `*-harness.ts` naming. The chat helper follows that convention locally
without creating a public secondary entry point.

## Acceptance-criteria checklist

### Task 18.1

- [x] AC 1 — copied stubs, TestBed service setup, fixture factories, and observers live once:
      `transcript-spec-harness.ts:20`, `:36`, `:47`, `:87`, `:135`, `:156-172`, `:176`, `:192`.
      Behavior-specific tab controls remain local as listed in the inventory.
- [x] AC 2 — spec-only: harness imports occur only in five `*.spec.ts` files
      (`chat-transcript.component.spec.ts:62-70`, replay motion `:43-46`, replay mount `:51-61`,
      older history `:10-18`, render window `:16-21`). `rg` found no production or `src/index.ts`
      reference. `tsconfig.spec.json:15` includes specs and therefore their imported helper;
      `tsconfig.lib.json:11` excludes specs. The helper is not exported from `src/index.ts` and is
      unreachable from the library entry point.
- [x] AC 3 — counts are unchanged (table below); `rg` found no `it.skip` or `xit`; a zero-context
      diff scan found no added/removed `expect`, `it`, or `test` lines. Only imports and setup/factory
      calls changed.
- [x] AC 4 — no product file, `project.json`, Jest config, tsconfig, or `src/index.ts` change.
      Temporary product mutations used for mutation checks were reverted and `git diff --exit-code`
      confirmed both the product component and message-bubble spec were clean.

### Task 18.2

- [x] AC 1 — feasibility was attempted first in the current Jest/jsdom setup.
- [ ] AC 2 — not feasible; no replacement assertion was retained.
- [x] AC 3 — `message-bubble.component.spec.ts` has no final diff. Task status is
      **CANCELLED (not feasible on branch)**. B10 remains under Batch 18's existing
      "Out-of-branch follow-ups" entry in `batches.md` and needs an animation-capable browser/test
      harness.

## Per-file test counts

Counts came from Jest JSON `assertionResults` before edits and after the final refactor.

| Spec file                                         | Before | After |
| ------------------------------------------------- | -----: | ----: |
| `chat-transcript.component.spec.ts`               |     18 |    18 |
| `chat-transcript.component.replay-motion.spec.ts` |      4 |     4 |
| `chat-transcript.component.replay-mount.spec.ts`  |     11 |    11 |
| `chat-transcript.older-history.spec.ts`           |      6 |     6 |
| `transcript-render-window.spec.ts`                |     21 |    21 |
| `transcript-prepend-anchor.directive.spec.ts`     |     13 |    13 |
| `message-bubble.component.spec.ts`                |     13 |    13 |

The final affected transcript run was 73/73. The message-bubble suite remained 13/13 after the
feasibility probe was reverted.

## Mutation checks

Each mutation changed production behavior, ran the named original transcript spec, demonstrated a
red result, and was immediately reverted with `apply_patch`.

| Guarded spec                                      | Temporary mutation                                                                                                | Observed result                                                                    |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `chat-transcript.component.spec.ts`               | Replaced the hidden-transcript `if (!this.active())` VM gate with `if (false)` in `chat-transcript.component.ts`. | Exit 1: 1 failed / 17 passed; expected one build-tree call, received two.          |
| `chat-transcript.component.replay-motion.spec.ts` | Changed `replayMotionHold.set(true)` to `set(false)`.                                                             | Exit 1: 1 failed / 3 passed; expected motion suppression `true`, received `false`. |
| `chat-transcript.component.replay-mount.spec.ts`  | Changed `renderWindow.setReplayRetention(true)` to `false`.                                                       | Exit 1: 4 failed / 7 passed; retained mount and replay-boundary assertions failed. |

An initial duration-only probe (`300` ms to `0` ms) did not fail because Jest fake-timer scheduling
still preserved the asserted transition sequence; it was reverted and replaced by the effective
hold-removal mutation above. No production mutation remains.

## Task 18.2 feasibility evidence

The existing test already captures `requestAnimationFrame` and inspects the DOM during its callback.
Two temporary enabled-case assertions were tried independently after `detectChanges()`:

1. `rafSawEnterClass === true` — failed 1/13 (`expected true`, `received false`).
2. A synchronous DOM query for `.bubble-fade-enter` — failed 1/13 (`received null`).

The suppressed case continues to prove that the class is absent and no frame is scheduled, but the
enabled transient class is not observable in this environment. The temporary assertions were
reverted; `git diff --exit-code -- message-bubble.component.spec.ts` passed. A rendered positive
assertion therefore needs Angular animation test support that exposes `animate.enter`, or the
Playwright `webview-e2e-harness`; either adds a harness/config surface forbidden by this batch.

## Files changed

- Created `libs/frontend/chat/src/lib/components/organisms/transcript/testing/transcript-spec-harness.ts`.
- Modified `chat-transcript.component.spec.ts`.
- Modified `chat-transcript.component.replay-motion.spec.ts`.
- Modified `chat-transcript.component.replay-mount.spec.ts`.
- Modified `chat-transcript.older-history.spec.ts`.
- Modified `transcript-render-window.spec.ts`.
- Created this report.

Intentionally unchanged: `transcript-prepend-anchor.directive.spec.ts`,
`message-bubble.component.spec.ts`, all product files, `project.json`, Jest/tsconfig files, and
`src/index.ts`.

## Verification output

- Pre-test process check (quoted):
  `Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^node(\.exe)?$' -and $_.CommandLine -match 'jest-worker|run-executor' }`
  returned count **0** immediately before the final full run.
- `npx nx run-many -t test -p @ptah-extension/chat --parallel=1 --maxWorkers=2`
  - Header: **Running target test for project @ptah-extension/chat** (1 project).
  - Result: **82 suites passed; 1,312 tests passed; 2 skipped; 1,314 total**.
  - Meets the Batch 15 floor exactly (not lower).
- `npx nx run-many -t typecheck -p @ptah-extension/chat --parallel=1`
  - Result: success.
- `npx nx run-many -t lint -p @ptah-extension/chat --parallel=1`
  - Result: success, **0 errors / 17 warnings**. All warnings are in unchanged files; none names the
    harness or modified transcript specs.
- `npx prettier --check` over the created harness and five modified specs
  - Result: all matched files use Prettier style.
- `git diff --check`
  - Result: clean.
- Final affected transcript run
  - Result: **6 suites passed; 73 tests passed**.

## Deviations and environment notes

- The requested `ptah_*` tools were not available in this session. Inspection used read-only
  PowerShell/`rg`; edits used `apply_patch` as required.
- Passing several paths through one `nx test ... --runTestsByPath` invocation caused Nx/Jest to run
  only the last path. Per-file baseline/post counts and mutation probes therefore used the same
  project Jest config directly (`npx jest --config libs/frontend/chat/jest.config.ts ...`). The
  mandated full verification used the literal Nx command above.
- `git status --short` also shows `.ptah/specs/TASK_2026_453_1eb4/followups/`, created by the
  concurrent Electron e2e lane. Those files were not read, edited, or included in this work.
- No test assertion was weakened, skipped, or widened to obtain green results.

## Blocking findings

None. Task 18.2's branch-local infeasibility is documented as a cancellation and follow-up, not a
blocker for Task 18.1 or Batch 18 verification.
