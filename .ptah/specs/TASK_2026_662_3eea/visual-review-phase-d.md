# Visual Review - TASK_2026_662 Phase D (pipeline purge), Electron

Score: 8/10. Verdict: APPROVED. Blocking 0, Serious 0, Moderate 2, Minor 1.

## Environment

- Worktree HEAD 53317ca66. Built with `NX_NO_CLOUD=true npx nx run ptah-electron:build-dev --parallel=1` (50.6s, success), then `copy-renderer-dev --parallel=1` (success), one at a time, output filtered with `tail`. No other build, serve, e2e or package target. No tests run.
- Playwright `_electron.launch` of `dist/apps/ptah-electron/main.mjs` with `--remote-debugging-port=9390` only. Private HOME, USERPROFILE, APPDATA, LOCALAPPDATA, `--user-data-dir` and `PTAH_DB_PATH` in a temp dir, removed on exit. The real `~/.ptah` and DB were not touched.
- Seed: one skill `demo-skill` (authored) and 4 specs in the sandbox `.ptah/specs`. For the Enhance run (run 3) a pre-boot created the DB, then 6 `skill_invocation_events` rows were inserted so the Enhance gate (5 runs) opened, then the app was relaunched.
- Three launches in total: run 1 `cap.cjs` (all screens), run 2 `cap2.cjs` (Enhance gate diagnosis: button disabled at 0/5 runs), run 3 `cap3.cjs` (events seeded, Enhance clicked). Scripts are in the temp dir `C:\Users\abdal\AppData\Local\Temp\p662d\`, outside the task folder.
- Width 1280, themes `anubis` (dark, primary) and `anubis-light`. 375px was not re-run because the Phase C r2 review already covered it and Phase D did not touch that layout (residual gap).
- Screenshots, in `visual/phase-d/`, are `pd-*.png`. Raw output is `index-raw.txt`, `index-raw-enhance.txt`, `main-stdio.txt`, `main-stdio-enhance.txt` and `applog-*.log`. Do not commit them.
- Cleanup: `app.close()` ran in `finally` for all runs. After the last run, `netstat` shows nothing on 9390 and `tasklist` shows no electron process.

## Checks

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 1 | Skills Library cards | PASS | `pd-skills-1280-dark.png`, `pd-skills-1280-light.png`, `pd-card-dark.png`. One card, "demo-skill authored, 0/5 runs". Tabs Skills 1, Agents 0, Commands 0. Legend, Refresh and the diverged toolbar render. |
| 2 | Card detail drawer | PASS | `pd-detail-dark.png`, `pd-detail-light.png`. Status "authored". Enhance and Edit buttons present. At 0/5 runs Enhance is disabled with the title "Needs 5 recorded runs...". |
| 3 | Editor | PASS | `pd-editor-dark.png`. `clone-body-editor` opens, Cancel closes it. |
| 4 | Enhance preview, no credentials | PASS with a Moderate finding (M1) | `pd-enhance-preview-card-dark.png`. Preview drawer shows the verdict "No change proposed", the code `empty-candidate`, and "There is no candidate body to compare. Nothing is written until you press Save." Save is disabled. A DOM scan for stack patterns (`at x (`, `Traceback`, `node_modules`, `.ts:N`) found nothing. No `preview-error` element, no raw exception message. Main log had 0 `[ERROR]` during the run. Only the expected `SDK auth not configured` info line appears. |
| 5 | Pause and telemetry controls | PASS | Pause switch shows "Skills On" and the help text. The telemetry toggle is present and on. `pd-skills-1280-dark.png`, `pd-skills-1280-light.png`. |
| 6 | Orchestration specs card | PASS | `pd-specs-card-dark.png`, `pd-specs-card-light.png`. "4 specs, 2 stale", "Harvest now" and "Clear stale (2)" buttons present, same as Phase C r2. I did not click the buttons again. |
| 7 | Routing map, 3 roles | PASS | `pd-routing-map-dark.png`, `pd-routing-bg-node-dark.png`. "BACKGROUND ROLES, 3 roles: Memory curator, Enhancement, Decision, each Default, 0 set, 3 default", plus the Inspect link. |
| 8 | Agent Orchestration, 3 roles | PASS | `pd-agent-orchestration-dark.png`. "BACKGROUND MODEL ROLES, 3 roles, Memory curator, enhancement, decision". Consumer rows: `consumer-row-memory-curator`, `consumer-row-enhancement`, `consumer-row-decision`. |
| 9 | Other Thoth tabs | PASS | Memory (`pd-tab-memory-dark.png`), Schedules (`pd-tab-cron-dark.png`) and Messaging (`pd-tab-gateway-dark.png`) all render with titles and empty states. No alert or error element in any tab. |
| 10 | Main log | PASS | `[ERROR]` count 0 in `main-stdio.txt`, `main-stdio-enhance.txt` and the app log. "DI verification: 5/5 tokens resolved". No "No handler registered". No unknown-method message. No `skillSynthesis:*` string in the log, and no DI resolution error. |
| 11 | Renderer console | PASS (warnings only) | Verbatim, listed below. No `error` entries and no `pageerror`. |

Renderer console, verbatim:

1. `[warning] NG0914: The application is using zoneless change detection, but is still loading Zone.js. Consider removing Zone.js to get the full benefits of zoneless. In applications using the Angular CLI, Zone.js is typically included in the "polyfills" section of the angular.json file.` Seen in all three runs.
2. `[warning] NG0956: The configured tracking expression (track by identity) caused re-creation of the entire collection of size 1. This is an expensive operation requiring destruction and subsequent creation of DOM nodes, directives, components etc. Please review the "track expression" and make sure that it uniquely identifies items in a collection. Find more at https://v22.angular.dev/errors/NG0956` Seen only in run 3 (after Enhance was opened and the drawer or list refreshed).

## Defects

### Moderate

- M1. The Enhance preview shows the internal skip code `empty-candidate` as the visible reason (`pd-enhance-preview-card-dark.png`). The code sits in a pill with the sentence under it. The sentence is clean, but "empty-candidate" is an identifier and not user copy. This is a presentation gap in `preview-skip-reason`. Fix: map skip codes to human text.
- M2. With no credentials the preview says "No change proposed / There is no candidate body to compare". It does not say that no model was available. The user cannot tell a missing-credentials case from a judge that saw nothing to change. The brief expected a "clean error". This is clean, with no stack and no raw message, but it is not an error state. Fix: surface a "no provider configured" reason.

### Minor

- m1. The NG0956 warning comes from a `@for` that tracks by identity over a 1-item collection. It is not an error. I have no Phase C console baseline, so I cannot say whether it is new in Phase D. Fix: `track` by id or slug.

## Regressions against Phase C r2

None. The Orchestration specs card, pause and telemetry controls, 3-role routing node and Agent Orchestration are unchanged. The Phase C r2 log findings (retired pipeline jobs, the `task_specs` warning) did not recur: the main log has 0 errors, and the deleted pipeline RPCs produce no "No handler registered" or unknown method messages. The Phase C Moderate finding (the stale count against the 7-day retention window) was not re-tested.

## Prototype fidelity

No prototype is in scope for this phase. Before and after (light and dark): `visual/phase-c-r2/r2-skills-1280-dark.png` against `visual/phase-d/pd-skills-1280-dark.png`, and `r2-skills-1280-light.png` against `pd-skills-1280-light.png`. The structure matches apart from the Library card now being populated with the seeded skill.

## Residual uncertainty

- 375px was not re-run in Phase D.
- The Enhance success path (a real candidate with a judge verdict and diff) was not exercised because there are no credentials. Only the no-provider outcome was seen.
- Providers were left at default, so the "N set" count for the background roles was not exercised.

## Verdict

APPROVED, confidence MEDIUM-HIGH. Key concern: the Enhance preview shows the raw code `empty-candidate` and does not tell the user that no provider is configured (M1, M2). Neither blocks.
