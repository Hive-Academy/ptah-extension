# Test Report - TASK_2026_381

Closing the two verification gaps the implementers flagged at commit
`9a25208be`: component 7 (truncation marker rendering) had no component spec,
and component 8 (measurement harness) was never built.

## Scope

- **User request** (`context.md:1-14`): the renderer held 2474 MB private with
  one live session; bound it, and make the bound visible and measurable.
- **Criteria tested**, taken from `implementation-plan.md` component 7
  "Verification seam" (`:715-720`) and component 8 "Gate A / Gate B"
  (`:731-742`). The plan states these as verification seams rather than as an
  acceptance-criteria list; there is no `task-description.md` in the folder, so
  the criteria below are read from the plan and from `context.md`:
  1. The marker renders when `ExecutionNode.retention` is set, and nothing
     renders when it is absent.
  2. The marker renders OUTSIDE the content guard — it appears when the fold
     preserved no payload at all.
  3. `foldFailed: true` changes the copy to "could not be preserved", not
     "truncated".
  4. The marker text contains the dropped-character count.
  5. The recovery copy promises no re-fetch and no click-to-expand, and names
     the reload's own limit.
  6. The marker is real text in the document flow, readable in place by a
     screen reader.
  7. **Gate A** — mounted message bubbles are bounded, and do not grow with the
     number of messages.
  8. **Gate B** — a finalized message serializes below a stated ceiling.
- **Regressions covered**: none — this task added a mechanism, it did not fix a
  reported bug.
- **Review findings covered**: none. `code-style-review.md` and
  `code-logic-review.md` do not exist in this task folder.
- **Deliberately not tested**:
  - The visual appearance of the marker (colour, spacing). `chat-ui` is
    presentational and has no visual-regression harness; the specs assert
    structure, text and accessibility only.
  - The acceptance memory measurement. See _Not executed_ below — it is a
    human step and no figure has been fabricated here.

## Suites

### `ToolOutputDisplayComponent — retention marker` — unit (component)

- **Requirement**: criteria 1-6 on the Output section.
- **Cases**: no `retention` → no marker and the existing output is unchanged;
  empty node → renders nothing; `retention` set → marker with the
  locale-formatted dropped count; **marker present with no `toolOutput` at all,
  and the in-guard "Output" header absent** (the boundary the whole component
  exists for); a notice that capped only `toolInput` is ignored; `foldFailed`
  copy with a recorded reason and with none; recovery copy asserted positively
  (transcript on disk, reopen the session, "before the last compaction") and
  negatively (no `click to expand`, no `/re-?fetch/i` — mirroring the write-side
  assertion in `execution-tree-retention.spec.ts:92-98`); accessibility — not
  `aria-hidden`, not `title`-only, not `hidden`, non-empty `textContent`, and no
  `aria-hidden` ancestor between the marker and the host; coexistence with the
  error alert.
- **File**:
  `D:\projects\ptah-extension\.claude-worktrees\transcript-memory\libs\frontend\chat-ui\src\lib\molecules\tool-execution\tool-output-display.component.spec.ts`
  (13 cases)

### `ToolInputDisplayComponent — retention marker` — unit (component)

- **Requirement**: criteria 1-6 on the Input section.
- **Cases**: the same matrix, plus two specific to this component — a notice
  capping both payloads still renders the Input line, and **the marker is
  visible without expanding the collapsed Input section**, because a user who
  never expands would otherwise never learn the payload was cut.
- **File**:
  `D:\projects\ptah-extension\.claude-worktrees\transcript-memory\libs\frontend\chat-ui\src\lib\molecules\tool-execution\tool-input-display.component.spec.ts`
  (14 cases)

Both suites use `TestBed` + `provideMarkdown()` in the style of the one existing
neighbour, `code-output.component.spec.ts:31-37`. No service is injected, no
dependency added, no `index.ts` touched.

### `ChatTranscriptComponent — Gate A: mounted bubbles are bounded` — unit

- **Requirement**: criterion 7, implemented in Jest rather than as the planned
  e2e spec. See _Gate A: why Jest and not e2e_ below.
- **Cases**: with 50, 200 and 1000 messages and a simulated 12-slot viewport in
  the middle of the transcript, mounted bubbles equal exactly
  `ALWAYS_MOUNTED_TAIL + VIEWPORT_SLOTS` (6 + 12 = 18) and slot count equals the
  message count, so the scroll container keeps its real extent; mounted at 1000
  equals mounted at 50 (the claim in one assertion — before the render window,
  mounted equalled total at every N); with no `IntersectionObserver` on the
  platform everything mounts, i.e. the failure mode is today's behaviour.
- The ceiling is derived from `ALWAYS_MOUNTED_TAIL`
  (`transcript-render-window.ts:17`) and the harness's own viewport size. There
  is no wall-clock and no byte threshold in it, per the plan's determinism
  requirement (`:768-770`).
- **File** (appended to the existing spec, reusing its `makeHarness` and
  `FakeIntersectionObserver`):
  `D:\projects\ptah-extension\.claude-worktrees\transcript-memory\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.component.spec.ts`
  (5 cases)

### Gate B — already present, not re-implemented

`message-finalization.retention.spec.ts:169-190`, "keeps the finalized message
under a stated serialized ceiling", already asserts exactly what the plan
specifies for Gate B (`:737-739`): a fixture message over budget serializes
below a stated ceiling after capping. Adding a second copy in the e2e project
would have duplicated it, so nothing was written for Gate B.

## Execution

- **Command run** (verbatim, from the worktree root):
  `npx nx run-many -t test -p @ptah-extension/chat-ui @ptah-extension/chat-streaming @ptah-extension/chat --skip-nx-cache`
  — header confirmed `Running target test for 3 projects`.
- **Result**:

  | Project          | Before (`9a25208be`) | After           | Delta               |
  | ---------------- | -------------------- | --------------- | ------------------- |
  | `chat-ui`        | 20 suites / 98       | 22 suites / 123 | +2 suites, +25      |
  | `chat-streaming` | 22 suites / 447      | 22 suites / 447 | unchanged           |
  | `chat`           | 64 suites / 973      | 64 suites / 978 | +5 (existing suite) |

  0 failed. 3 skipped (1 in `chat-streaming`, 2 in `chat`) — all pre-existing,
  none added or changed here. No existing assertion was weakened, widened or
  skipped.

- Also run and clean: `npx nx run-many -t lint typecheck -p @ptah-extension/chat-ui @ptah-extension/chat`
  → **0 errors** (22 pre-existing warnings, all `max-lines` / non-null-assertion
  in files this task did not touch).

- **Failures**: none. One failure occurred during authoring and was fixed in the
  test, not in the product: the "does not grow with N" case builds two harnesses
  inside one `it`, which threw `Cannot configure the test module when the test
module has already been instantiated`. `TestBed.resetTestingModule()` now runs
  at the top of the harness factory.

- **Not executed**:
  - **The planned e2e spec `apps/ptah-electron-e2e/src/specs/perf/transcript-memory.spec.ts` was not written.** See below.
  - **The acceptance memory measurement.** `context.md:10-14` names the
    instrument (`Get-CimInstance Win32_Process -Filter "Name='Ptah.exe'"`) and
    the before figure (renderer, 2474 MB private). Producing the "after" needs a
    packaged build driven through a comparable session by a human. No figure is
    reported here, and none was estimated.

## Gate A: why Jest and not e2e

`npx nx e2e ptah-electron-e2e` cannot run in this worktree without a build, and
writing a spec that never runs is worse than no spec. Facts, all in the worktree:

- `apps/ptah-electron-e2e/project.json:11-14` — the `e2e` target `dependsOn`
  `ptah-electron:build-dev` and `ptah-electron:copy-renderer-dev`.
  `copy-renderer-dev` (`apps/ptah-electron/project.json:237-246`) runs the full
  `nx build ptah-extension-webview` — the multi-minute Angular build, with no
  cache entry available here.
- `apps/ptah-electron-e2e/src/support/build-precheck.ts:15-30` is the Playwright
  `globalSetup` and hard-requires `dist/apps/ptah-electron/{main.mjs,preload.js,renderer/index.html}`.
  This worktree's `dist/apps/ptah-electron/` has `main.mjs` only — **`preload.js`
  and the whole `renderer/` directory are missing**, as is
  `dist/apps/ptah-extension-webview`, so `copy-renderer.js` has no source. The
  launcher resolves the entry relative to the spec file
  (`electron-launcher.ts:44-56`), so the complete build in the main checkout is
  never used.
- `electron-launcher.ts:76-108` sets `PTAH_E2E=1` and a temp `PTAH_DB_PATH`, and
  passes `--no-sandbox` **only under CI**. There is no headless or xvfb path:
  a run opens a real visible Electron window on the developer's desktop, and the
  suite is `workers: 1` over ~100 spec files at up to 60 s each.
- `better-sqlite3` being rebuilt for the Electron ABI is true and necessary but
  not sufficient — the missing renderer and preload are what block `globalSetup`.

So Gate A was implemented at the seam where it executes in CI on every run: the
`ChatTranscriptComponent` render window, with a fake `IntersectionObserver`. What
the Jest gate gives up versus the e2e version is real layout — jsdom performs
none, so intersection is simulated rather than observed. What it gains is that it
runs. The e2e reported figure (`performance.memory.usedJSHeapSize`) is
informational by the plan's own wording (`:740-742`) and is not a gate, so
nothing deterministic was lost.

**Left for a human step** (not blocked on code):

1. Build the worktree (`nx build-dev ptah-electron && nx copy-renderer-dev ptah-electron`)
   and, if the e2e reported figure is still wanted, add the informational spec
   modelled on `startup-tti.spec.ts`.
2. Take the "after" renderer private-bytes reading on a packaged build with a
   session comparable to the 2474 MB one, and record it in `context.md`.

## Inaccuracies found in the plan

1. **Component 8's Gate B was already delivered by component 4.** The plan lists
   Gate B under the measurement harness as if it were new work
   (`implementation-plan.md:737-739`), but it is the same assertion component 4
   was asked for, and it exists at `message-finalization.retention.spec.ts:169`.
   Only the location was open.
2. **Component 8 assumed the e2e suite was runnable.** `:754-758` cites the
   existing `perf/` folder and the streaming spec as evidence that "seeding and
   DOM counting are existing capabilities" — true — but never checks the build
   precondition. In a fresh worktree the target needs a full webview build and a
   visible desktop session, which makes it a poor home for a gate that is
   supposed to run on every change.
3. **Component 7's plan was accurate.** Both components render the marker
   outside the guard exactly as specified, and the copy matches. The only thing
   missing was the spec, which the implementers said themselves.

## Verdict

- **Criteria proven**: 1, 2, 3, 4, 5, 6 (both components, 27 cases); 7 (Gate A,
  5 cases, bounded at N = 50 / 200 / 1000); 8 (Gate B, pre-existing).
- **Criteria not proven**: the acceptance memory measurement — no "after" figure
  exists, and none was invented.
- **Risks a reader should know about**:
  - The marker is located in the specs by its `bg-warning/10` class, since the
    component exposes no test hook. A restyle that drops that class breaks the
    specs loudly rather than silently, which is the acceptable direction, but a
    `data-test` attribute would be sturdier if the team wants one.
  - Gate A simulates intersection. It proves the render window's decision logic
    is bounded; it does not prove the browser's real `IntersectionObserver`
    reports the window the code expects. That part remains covered only by
    manual use.
  - The `chat-transcript.component.spec.ts` file is now 643 lines, still under
    the 700-line soft ceiling, but the next addition should split the render
    window cases into their own file.
