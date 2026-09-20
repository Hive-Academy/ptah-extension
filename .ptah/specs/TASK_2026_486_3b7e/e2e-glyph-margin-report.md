# Electron glyph-margin E2E diagnosis

## Classification

**A — flake: a Monaco/Chromium paint-readiness race under xvfb load.**

This is not a rendering regression from PR #539. The failing head was
`ca61fcde9edf35d5283a039691cee110a55ba846`; the two immediately preceding
Electron E2E runs on the branch passed at `6678637e...` and `3901e907...`.
The exact change from the last passing head to the failing head is confined to
`libs/backend/agent-sdk/**` plus task reports. Neither
`apps/ptah-electron-e2e/**` nor `libs/frontend/git-ui/**` changed. The broader
`origin/main...HEAD` diff also contains no change in either of those trees.

The failed trace shows this order:

1. Hunk navigation completed and the label became `Hunk 1 of 3`.
2. The light Monaco class (`vs`) was observed.
3. At least one marker already carried `ptah-hunk-glyph-selected`.
4. The test immediately read marker geometry and started its screenshot.
5. The captured marker pixels were only partially present.

The DOM/class readiness checks therefore completed before Chromium's xvfb
compositor had committed the matching decoration pixels. The failed image and
zoom from `trace.zip` visually corroborate the missing/partial marker paint.

## Exact failure

The assertion requires an unbroken marker run covering at least 90% of one
19 px Monaco line:

- Contrast gate used to count a pixel row: **3:1** (unchanged).
- Required run: `floor(19 * 0.9)` = **17 px**.
- Measured run: **9 px**.
- Miss: **8 px**.

This was the `light/selected` sample. It was a marker-height/paint-completeness
failure, not evidence that the 3:1 contrast requirement should be lowered.

## Change made

Changed only
`apps/ptah-electron-e2e/src/specs/git/glyph-margin-visual.spec.ts`.

`measureTheme()` now polls screenshots until Monaco's marker pixels reach the
existing 3:1 and 90%-of-line criterion, then saves and asserts against that
ready capture. This waits on the rendered output the visual test consumes; it
does not add a timeout sleep, fixed delay, retry the whole test, or weaken the
17 px / 3:1 legibility assertion. A stable unreadable marker still fails after
the readiness poll times out.

## Main-branch check

Classification C is not supported. `.github/workflows/electron-e2e.yml` runs on
`pull_request` (and manual dispatch), not pushes to `main`. Consequently there
are no recent direct-main Electron E2E runs after this spec was introduced on
2026-09-07 to cite as a main failure. The available recent PR runs overwhelmingly
pass this spec, including the two prior pushes of this branch.

## Verification versus inference

Verified:

- Read failed run `35528018213` logs, `error-context.md`, failure screenshot,
  and Playwright `trace.zip`.
- Confirmed **9 px received versus 17 px required**, with the unchanged 3:1
  row contrast gate.
- Confirmed the two preceding branch Electron E2E runs (`35526714740` and
  `35524580642`) passed.
- Confirmed the last-pass-to-failure diff only changes agent-sdk backoff code
  and task reports.
- Confirmed no `origin/main...HEAD` changes under the failing E2E or git-ui
  trees.
- `npx nx run ptah-electron-e2e:typecheck --skip-nx-cache` passed.
- `npx nx run ptah-electron-e2e:lint --skip-nx-cache` passed with nine existing
  warnings in unrelated files and zero errors.
- `git diff --check` passed.

Not verified locally:

- The single Electron spec did not reach Playwright on Windows. Its prerequisite
  build failed because this checkout's installed dependencies lack
  `web-tree-sitter.wasm`, Prism assets, and daisyUI theme CSS. No source failure
  from this change was reported. I do not claim a local E2E pass.
- Linux/xvfb behavior after the fix is inferred from the failed trace's ordering
  and the branch's pass/fail history; it requires CI to reproduce directly.

