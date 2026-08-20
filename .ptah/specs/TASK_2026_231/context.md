# perf-m1-diff-redisplay waits for a diff tab that never opens

## Origin

First hit during `TASK_2026_222`'s live-Electron run. Re-encountered by
`TASK_2026_227` and `TASK_2026_229`, both of which were told to skip it so it
would not be mistaken for a regression they had caused.

Three tasks have now routed around it. That is the reason for this carrier:
each skip was individually correct and collectively they mean nobody has
looked at it.

## Provenance — this is not ours

The `TASK_2026_222` agent proved it pre-existing properly rather than
assuming: it reverted **both** of its changed lib files to `HEAD`, rebuilt,
re-ran, and got the identical failure. So it predates the glyph-margin theme
fix, the top-layer dialog work, and the renderer-build changes.

## Why it matters more than a red test

This is a **perf-measurement** spec. While it fails, the M1 diff-redisplay
budget is not being measured at all — there is no number, and no regression on
that path would be caught.

That is the same shape of gap `TASK_2026_218` was filed to close for
`git:applyHunks`: a claim that nothing was verifying. It is worth remembering
how that one turned out — once a live host was actually reached,
`TASK_2026_222` found the diff editor had been pinned to `vs-dark` in every
Electron theme, and `TASK_2026_227` found a confirmation dialog no mouse could
answer. Unmeasured paths on this surface have a track record.

## What is not known

- Whether the diff tab genuinely fails to open (an app defect), or
- whether the spec's wait condition has drifted from the current UI (a spec
  defect). The editor surface has changed repeatedly since this spec was
  written — glyph-margin decorations, the roving-tabindex toolbar, the
  floating hunk widget (`TASK_2026_221`), and the native `<dialog>` conversion
  (`TASK_2026_227`) all landed in this area.

Establish which before changing anything. If it is spec drift, the fix is to
re-anchor the wait; if the tab genuinely does not open, that is a user-facing
bug and the perf budget is the lesser finding.

## Build note

`TASK_2026_229` (commit `fe70fd689`) changed how the dev renderer is built.
Use `nx copy-renderer-dev ptah-electron`, not `copy-renderer` — the latter is
now the production path and is `package`'s dependency only. `build-dev` no
longer builds the webview at all.

Before this change, `nx e2e` could serve a production-configured bundle into
the Electron renderer. If this spec has been failing since before
`fe70fd689`, re-run it on a known-good development bundle before assuming the
failure is real — that is cheap and rules out the whole class of problem
`TASK_2026_226` / `TASK_2026_229` were about.
