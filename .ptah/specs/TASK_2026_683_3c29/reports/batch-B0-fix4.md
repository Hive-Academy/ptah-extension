# Batch B0 fix 4 — Electron motion recorder probes

Only `apps/ptah-electron-e2e/src/specs/perf/nav-session-motion.perf.spec.ts` changed. The spec was **not run**; M0 must be recorded again before M1.

| Item | Fix | File:line |
| --- | --- | --- |
| B0-1, view transitions | `Sample.viewTransition` now uses Chromium's `:active-view-transition`. Capturing animation events on `::view-transition*` pseudo-elements records starts and ends across the full window. M1 S1 uses `viewTransitionStarted`; S6 requires no start and no active sample. | `nav-session-motion.perf.spec.ts:171`, `:211`, `:460`, `:667` |
| B0-2, split panes | Capturing `animationstart`/`animationend` on the pane `section` records the animation name, pane-side selector and time from click. S8 open requires a start; reduced split windows require none. Late `at50` samples no longer decide these assertions. | `nav-session-motion.perf.spec.ts:180`, `:461`, `:651`, `:663` |
| B0-3, S4 layout shift | Each non-split M1 window compares `layoutShiftAll` with its matching M0 scenario/name row plus 0.001 tolerance. The old absolute zero check rejected the recorded S4 first-open baseline (up to 0.004658). | `nav-session-motion.perf.spec.ts:639`, `:643` |
| B0-4, transcript entrance | Record `ptahTurnEnter` starts on `.chat-msg-slot.ptah-turn-enter`, with slot ID, `data-enter-i`, computed delay, click-relative time, and visibility. M1 uses these events for entrance count, viewport, first visible index and delay. Record old `ptahStaggerUp` starts on `.st-t`; first post-click rAF also observes scheduled old animations so M0 retains delays when the start falls late. M1 requires zero old stagger records in every window. | `nav-session-motion.perf.spec.ts:147`, `:154`, `:262`, `:448`, `:653`, `:660` |
| Stale baseline | Top-level `probeVersion: 2` is written to partial and complete JSON. M1 rejects an M0 JSON with any other or missing version before recording. | `nav-session-motion.perf.spec.ts:31`, `:335`, `:355` |

## New JSON fields

- Top level: `probeVersion`.
- Per window: `viewTransitionStarted`, `viewTransitionEvents[]`, `splitPaneEvents[]`.
- `entrance.events[]`: `source` (`start` or `observed`), `name`, `selector`, `id`, `entranceIndex`, `delayMs`, `atMs`, `visibleAtSwitch`, `visibleAtStart`. `firstVisibleIndex` and `firstVisibleDelayMs` now derive from visible `ptahTurnEnter` start events. Existing sample and placement fields remain for frame inspection.

## Evidence and checks

- Current M0 JSON has 102 windows and no `probeVersion`; all 408 view-transition samples are true. S8 open `at50` samples arrived at 315.4 and 226.2 ms with zero pane animations. S4 first-open shifts are 0.0000905, 0.0046582 and 0.0046582. Its old stagger targets include `.st-t` / `ptahStaggerUp`.
- Current transcript code has `ptahTurnEnter` on `.ptah-turn-enter` and sets `--i` plus `data-enter-i` on the slot (`chat-transcript.component.css:1-8`, `.ts:1139-1143`). The slot has `data-ptah-transcript-message-id` (`.html:39-42`).
- Scoped `ptah_get_diagnostics`: 0 errors, 0 warnings.
- `npx nx typecheck ptah-electron-e2e --parallel=1`: exit 0.
- `npx nx lint ptah-electron-e2e --parallel=1`: exit 0; 17 project warnings, 0 errors. Nx Cloud also emitted a nonblocking 401 plan notice.
- Playwright, Electron, build, serve, e2e and the recorder spec were not run, as instructed. Event behavior therefore awaits the orchestrator's fresh M0 and M1 recordings.

## Decisions

- **View-transition evidence:** use pseudo-element animation events for the window-level start flag and `:active-view-transition` for sampled state. Options were the stale computed `viewTransitionName`, point-in-time animation polling, or events plus active state. The old M0's 408 false positives rule out the computed name; animation events preserve a short transition missed by a delayed sample. Reversible.
- **Entrance evidence:** derive M1 assertions from captured starts on the current slot, while observing old scheduled `.st-t` animations in the first rAF. Options were the old computed-style placement sample or event records. M0 sampled after classes had gone, and old stagger starts can occur after a long delay. Reversible.
- **Shift tolerance:** compare the same scenario/name to M0 plus 0.001. Options were absolute zero or excluding all S4 rows. Matching the baseline preserves a regression check while accepting the recorded first-open movement. Reversible.
