# Batch 4.5 report — showcase and perf close-out

Written by the orchestrator. The executing agent completed the file work but
stalled waiting on the full e2e suite and never wrote its report, so the
verification below was run and recorded directly.

## Files deleted

- `apps\ptah-electron-e2e\src\showcase\editor-tour.scene.ts`
- `apps\ptah-electron-e2e\src\showcase\scripts\editor-tour.json`
- `apps\ptah-electron-e2e\src\specs\editor\perf-m3-watcher-churn.md`
- `apps\ptah-electron-e2e\src\specs\editor\perf-m3-watcher-churn.script.mjs`
- The now-empty `apps\ptah-electron-e2e\src\specs\editor\` directory

**The batch's file list was out of date.** It named seven files under
`specs\editor\`; five were already deleted in `51ae5525e` during Phase 3
(`editor.spec.ts`, `file-ops-dialogs-top-layer.spec.ts`,
`file-tree-windowing.spec.ts`, `perf-m2-electron-spotcheck.spec.ts`,
`perf-m4-drag-cd.spec.ts`) because removing `'editor'` from the `ElectronView`
union made them fail to compile. Only the two `perf-m3-watcher-churn` files
remained. Those are stale — Batch 4.3's constants spec replaces them.

## Files modified

- `apps\ptah-electron-e2e\src\showcase\_harness\prewarm.ts` — **90 lines
  deleted.** `prewarmEditor` and the leaf-file helpers are gone. The doc it
  carried named the editor as **"the known worst offender (~31 s)"** — that is
  the saving this batch banks, and it is now unreachable code removed rather
  than a measurement.
- `apps\ptah-video-studio\FOLLOW-UP.md` — exemplar replacement, see below.
- `apps\ptah-docs\SCREENSHOTS.md` — needed no edit; its only editor reference
  (`:213`) already reads as history ("was `@ptah-extension/editor`'s own
  left-sidebar panel, and that library is …"), which is still true.

## The exemplar decision

`FOLLOW-UP.md` named `editor-tour` as the hand-written exemplar the other
scenes were modelled on. That scene is deleted, so the sentence needed a new
one. The batch proposed `chat-code-edit.scene.ts`; the executing agent verified
the claim against the scenes rather than transcribing it, and agreed:
`chat-code-edit`'s **ask → edit → see-the-diff** arc is the closest structural
analogue to the retired **open-file → edit → see-the-diff**, and it is likewise
a single-surface walkthrough with a body and a payoff.

Three further statements in that file were left false by the edit and were
corrected afterwards:

1. An instruction to re-render `editor-tour` to verify a pan fix — impossible
   once the scene is deleted. Retargeted to `chat-code-edit`.
2. "the full 13-scene re-capture" — the same edit had already reduced the scene
   list to 12.
3. "run the serial driver … for ALL 13 scenes" — same count error.

The document also claimed 13 scenes while 14 existed on disk; with
`editor-tour` retired the re-capture batch is 12, and `landing-page-tour` is a
separate later addition that was never part of that batch.

## Startup TTI re-baseline

The batch asks for this spec to be **re-run and its figures recorded**. It
asserts no budget, so "re-baseline" means record the numbers — no assertion was
added or changed.

Measured after the Phase 4 deletions, run in isolation:

```
[startup-tti] fixture-boot paint entries:
  [{"name":"first-paint","startTime":260},
   {"name":"first-contentful-paint","startTime":260}]
  domContentLoadedEventEnd(ms): 211  loadEventEnd(ms): 0
[startup-tti] second-boot wall-clock reload -> canvas interactive (ms): 307
```

## Verification

`npx nx build ptah-docs` → **exit 0, green.**

`npx nx run ptah-electron-e2e:e2e` (full suite) → **exit 1: 154 passed, 2
failed, 8 skipped, 25.3 minutes.** Both failures were investigated and neither
is attributable to this task:

**1. `perf/startup-tti.spec.ts:78` — flaky under full-suite load, not a
regression.** It failed on `expect(fixtureBootTiming.paint.length)
.toBeGreaterThan(0)` with an empty paint array. Re-run in isolation it
**passes** with paint entries present (the figures above). The full run had
already booted Electron 77 times before reaching it; the paint-timing capture
does not survive that load. This is a symptom of the harness problem filed as
**TASK_2026_389** (one full app boot per test), not of the editor deletion.

**2. `rpc-new-features.spec.ts:175` — foreign.** It asserts
`mcpDirectory:listOAuthConnected` returns an empty servers array on a fresh
launch, and received a non-empty one. That surface belongs to another session's
MCP work (`e4dc3c03c`); nothing in TASK_2026_385 touches `mcpDirectory`. The
owning session was notified.

## Post-edit re-read confirmation

`prewarm.ts`, `FOLLOW-UP.md` and `SCREENSHOTS.md` were re-read after all edits
and after the e2e run; every change is present on disk. `specs\editor\`,
`editor-tour.scene.ts` and `editor-tour.json` are confirmed absent. This check
matters because a killed pre-commit hook does not restore `lint-staged`'s
stash, which reverts tracked files to HEAD — see `future-enhancements.md` §8.
