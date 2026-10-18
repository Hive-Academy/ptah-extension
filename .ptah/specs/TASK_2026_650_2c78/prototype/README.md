# TASK_2026_650 prototype: Setup Wizard generation pages

Static, dependency-free prototype of the internal wizard pages described in `../design-spec.md`: the wizard landing, the Generate agents page, the Generate project guidance page, the context source status component, and an excerpt of the Setup Hub (`hub.html` is a content and wiring illustration, not a pixel-accurate Hub and not a new grid rule). All data is example data. It uses the app's real Anubis tokens (`assets/tokens.css`, dark `anubis` and light `anubis-light`, copied from the approved 649 prototype) and a Lucide sprite (`assets/sprite.js`). The chat column is a labelled stand-in because the real `<ptah-session-embed>` (chrome `bare`) is not part of this design.

## Open it

No build step, no server. Double-click `index.html` (or open it in any browser). It links every page. Fonts fall back to system fonts when offline.

| File | Page |
| ---- | ---- |
| `index.html` | Index with links and a theme toggle |
| `landing.html` | Wizard landing: the entry for the `setup-wizard` route and the old VS Code panel |
| `agents.html` | Generate agents: chat tab plus sidebar |
| `guidance.html` | Generate project guidance: chat tab plus sidebar |
| `source.html` | Context source status component, every state |
| `hub.html` | Setup Hub excerpt: a content and wiring illustration of the two new cards, not a pixel-accurate Hub layout. The Hub keeps its design (649 D10 and D12) |

## Prototype controls (the dark bar at the top of every page, not part of the design)

- **State** and the other lists change the example data. Every state is also a URL query string, e.g. `agents.html?s=partial&src=expired&theme=light`.
- **Width** (Fill, 960, 720, 400, 360) sets the width of the page host, so the narrow layout (peek bar and sheet under 720 px) can be checked without resizing the window. The layout reacts to the host width, not the viewport, as in the app.
- **Theme** toggles dark (`anubis`) and light (`anubis-light`).
- Clicking works for the main flow: landing cards open the pages; Generate opens the preview dialog (Cancel, Escape and Confirm Generate work); Confirm shows the running state; **Stop generation** (Run section, or beside the peek bar when narrow) and the chat stand-in's Stop both go to Stopping, then Cancelled, with focus kept on the Stopping button and then moved to the result heading; in `done-flow` the 5 s countdown runs (Skip guidance stops it, Start now or the end of the countdown starts guidance); agent checkboxes, Select Recommended and Deselect All update the counts and the Generate button; community packs load on demand; Install shows a spinner then Installed; the Use project guidance switch toggles; Hide on a saved analysis removes the row.

## URL parameters

Parameters you omit take the first value of each list.

### `agents.html`

| Param | Values | What it sets |
| ----- | ------ | ------------ |
| `s` | setup, loading, empty, resume, confirm, confirm-loading, confirm-changed, confirm-error, starting, rejected, tabmismatch, blocked, running, running-quiet, running-fail, retrying, cancelling, stop-failed, stop-unconfirmed, stop-unknown, cancelled, interrupted, run-failed, partial, done, stop-late, done-flow, partial-flow, done-flow-started, done-flow-skipped | Run state (spec 2.3.2). `running-quiet` = run active, chat idle (no chat Stop, Stop generation stays). `stop-failed` = the host refused the stop request and the run is verified as still active ("The run is still active. Try stopping again."). `stop-unconfirmed` = the stop request got no answer; the page is re-reading the run state (Stop shows "Checking..."). `stop-unknown` = the re-read failed too ("Run state could not be confirmed", "Check again", no Stop). `stop-late` = it finished before the stop took effect. `cancelling&pend=1` = a stop pressed during `starting` and queued; `rejected&pend=1` and `blocked&pend=1` = the start was rejected or blocked after a queued stop `done-flow` and `partial-flow` are shorthands for `done` or `partial` with `flow=1`; `done-flow-started` and `done-flow-skipped` add `fs=started` or `fs=skipped` |
| `src` | (by state), ok, no-analysis, unreadable, legacy-v3, incomplete, expired, workspace-changed, output-mismatch, not-latest, failed, checking, unchecked | Context source state (spec 2.5). By state: `unchecked` before the run starts, `no-analysis` after |
| `pk` | closed, loading, list, empty, error | Community packs panel |
| `guid` | none, saved, late | Project guidance state: none yet, saved before the run, created after the run started |
| `flow` | 0, 1 | Independent start, or part of the setup flow (continuation card, spec 2.9.2; with `run-failed` the Continue and Skip pair) |
| `fs` | countdown, started, skipped | State of the continuation card in the setup flow |
| `gm` | same, diff | Model of the Project Prompt tab: the same as the agent run, or another one it already had selected. The countdown names this model (spec 2.9.2, 2.9.3), and names the agent run's model too only when they differ |
| `gt` | tab, new | A Project Prompt tab is already open, or none exists yet (created at the start point; the countdown then says "the default model for a new Project Prompt tab") |
| `pend` | 0, 1 | A stop was queued while the start was pending (use with `cancelling`, `rejected`, `blocked`) |
| `err` | 0, 1, many | Completion-level errors block (spec 2.3.5): none, two entries, seven entries (three shown, four behind "Show 4 more") |
| `ver` | 1, 0 | Outcome check: counts verified, or could not be confirmed (spec 2.9.4); on `run-failed` |
| `cm` | same, diff | Composer model equals the run's model, or differs (spec 2.9.3) |
| `prov` | ok, none | A provider is connected or not |
| `sel` | some, none | Seven agents selected, or none |
| `sb` | open, closed | Sidebar docked panel or sheet. Default: open at 720 px host width and up, closed below |

### `guidance.html`

| Param | Values | What it sets |
| ----- | ------ | ------------ |
| `s` | setup, starting, rejected, tabmismatch, blocked, running, running-quiet, cancelling, stop-failed, stop-unconfirmed, stop-unknown, cancelled, stop-late, complete, existing, regenerating, failed, trace-failed, ended, skipped | Run state (spec 2.4.1). `starting` = the pending-start state (run id not yet known) with Stop generation on the page and beside the peek bar; a stop pressed there goes to `cancelling&pend=1`. The three stop outcomes (`stop-failed`, `stop-unconfirmed`, `stop-unknown`) are those of the agents page |
| `src` | as above | Context source state |
| `prev` | (by state), saved, none | A previously saved guidance exists |
| `flow` | 0, 1 | Independent start, or part of the setup flow (Skip guidance shows for setup, rejected, blocked and failure states, never while running) |
| `ver` | 1, 0 | Guidance committed state verified, or could not be confirmed (spec 2.9.4) |
| `gm` | same, diff | Model of this Project Prompt tab: Sonnet 4.5, or Opus 4.1 (the tab already had another selection, which a combined-flow start submits). The page prints it before the submit and in the model select (spec 2.9.3) |
| `pend` | 0, 1 | A stop was queued while the start was pending (use with `cancelling`, `rejected`, `blocked`) |
| `cm` | same, diff | Composer model equals the run's model, or differs |
| `fb` | 0, 1 | One guidance section used the authored fallback |
| `prov`, `sb` | as above | |

### `landing.html`

`s` = default, saved, loading, list-error, resume-analysis, resume-agents, running-agents, running-both, blocked, guidance-saved. `host` = app, panel (the panel shows Close instead of Back).

### all pages

`theme` = dark, light. `w` = 960, 720, 400, 360 (omit for fill).

## Re-capture screenshots and run the checks

Needs Playwright from a worktree's `node_modules` (set `PLAYWRIGHT_ENTRY=<path to playwright/index.mjs>`; the 649 worktree has one). These are local tools, not build steps.

```
node assets/capture.mjs shots [name-filter]   # writes screenshots/*.png, lists console errors per page
node assets/capture.mjs checks                # keyboard and layout checks
node assets/contrast-check.mjs                # contrast of every colour pair the pages use (no Playwright needed)
LUCIDE_DIR=<node_modules/lucide-angular/esm2020/icons> node assets/gen-sprite.mjs   # rebuild sprite.js
```

`checks` drives a real keyboard: preview dialog role, aria, initial focus on Cancel, focus trap, Escape, inert page behind, focus return; sheet Escape and `inert` on the covered chat column; Stop generation in every active state (also with the chat idle, and beside the peek bar at 400 px), Stopping then Cancelled with its focus handling; the combined-flow handoff (countdown card, Skip before 5 s means guidance never starts, automatic start after 5 s with no Skip left, partial continues, run-failed shows Continue and Skip); stop-failed and stop-late on both pages; the completion error block (count, three shown, four behind a disclosure); the unverified `run-failed` never says no files were written; composer Stop present while the chat streams; no horizontal scroll at 400 and 360 px on every page including the new states; every visible control at least 24 x 24 px. Round 2 adds: the failed-stop wording on both pages (no "did not reach the run"; `stop-unconfirmed` disables Stop; `stop-unknown` offers only Check again and no Stop, also at 400 px), the guidance `starting` state (Stop available, a queued stop ends in cancelled, a rejected start after a queued stop says the stop was dropped), and the countdown naming the guidance tab's model (also when it differs, and when no tab exists yet). Last run: all passed (84 checks). `contrast-check.mjs` last run: 80 theme-pair rows, 0 unexpected failures (rows marked REJECTED document alternatives that fail on purpose; round 1 added the Stop icon and outline-edge pairs).

## Screenshots

`screenshots/` holds dark and light captures. Wide = 1280 x 820, narrow = 400 x 860.

| Screenshot | Design-spec section |
| ---------- | ------------------- |
| `*-landing-default`, `*-landing-saved`, `dark-landing-resume-agents`, `dark-landing-running-blocked`, `dark-landing-narrow-400` | 2.2 Landing |
| `*-agents-setup-catalog`, `dark-agents-setup-analysis`, `dark-agents-setup-expired` | 2.3.1, 2.3.2 (setup, sources) |
| `dark-agents-resume-offer`, `dark-agents-blocked`, `dark-agents-rejected` | 2.3.2 |
| `*-agents-confirm`, `dark-agents-confirm-changed`, `dark-agents-narrow-confirm` | 2.3.7 (preview dialog) |
| `*-agents-running`, `*-agents-running-quiet`, `dark-agents-running-fail`, `dark-agents-retry-waiting`, `dark-agents-cancelling`, `*-agents-cancelled` | 2.3.2, 2.3.4, 2.9.1 (progress, retry, Stop generation, cancel; running-quiet also shows the composer model differing) |
| `*-agents-stop-failed`, `*-agents-stop-unconfirmed`, `*-agents-stop-unknown`, `*-agents-narrow-stop-unknown`, `*-agents-stop-late` | 2.9.1, 2.9.4 (stop refused with the run verified as active, no answer and re-reading, re-read failed, narrow, finished before the stop) |
| `*-agents-starting`, `*-agents-cancelling-queued` | 2.3.2, 2.9.1 (pending start with Stop, queued stop) |
| `*-agents-run-failed`, `dark-agents-run-failed-unverified`, `dark-agents-run-failed-flow`, `*-agents-errors-many` | 2.3.2, 2.3.5, 2.9.4 (run failed with no item, unverified counts, Continue and Skip, completion error block with a disclosure) |
| `*-agents-partial`, `*-agents-done` | 2.3.2, 2.3.5, 2.3.6 (result, completion errors, next steps) |
| `*-agents-done-flow`, `*-agents-partial-flow`, `*-agents-done-flow-started`, `*-agents-done-flow-skipped`, `*-agents-done-flow-model-differs`, `*-agents-done-flow-new-tab` | 2.9.2, 2.9.3 (combined-flow handoff: countdown, started, skipped; the countdown naming the guidance tab's model when it differs from the agent run's, and the new-tab default) |
| `dark-agents-packs` | 2.3.3 (community packs) |
| `dark-agents-narrow-closed`, `*-agents-narrow-sheet`, `dark-agents-narrow-sheet-setup`, `*-agents-narrow-stop`, `dark-agents-narrow-cancelling` | 2.7, 2.9.1 (peek bar, sheet, Stop beside the peek bar, and its stopping state) |
| `*-guidance-setup`, `*-guidance-running`, `*-guidance-running-quiet`, `dark-guidance-cancelling`, `*-guidance-cancelled`, `*-guidance-stop-failed`, `*-guidance-stop-unconfirmed`, `*-guidance-stop-unknown`, `*-guidance-stop-late`, `*-guidance-narrow-stop`, `*-guidance-starting`, `*-guidance-narrow-starting`, `*-guidance-cancelling-queued`, `*-guidance-rejected-queued`, `*-guidance-blocked-queued`, `*-guidance-setup-tab-model`, `*-guidance-done`, `dark-guidance-existing`, `dark-guidance-failed-flow`, `dark-guidance-trace-failed`, `dark-guidance-trace-failed-unverified`, `dark-guidance-narrow-sheet` | 2.4, 2.9.1, 2.9.4 |
| `*-source-gallery` | 2.5 (source status component) |
| `*-hub-excerpt` | 2.6 (content and wiring illustration, not a pixel-accurate Hub) |

## Notes

- The pages open with seven agents already selected so the selected state is visible. In catalog mode (no analysis) the product preselects nothing: set Selection to "none selected" to see that.
- `assets/app.css` and `assets/tokens.css` are copied unchanged from the approved 649 prototype (`TASK_2026_649_33c4/prototype/assets`). `assets/wizard.css` only adds what these pages need. Class names are prototype-only.
- The tab bar and the chat column are stand-ins (labelled in the page). The prototype does not design chat internals.

## Lane-introduced constraints

Rules this designer lane proposes. They are not user decisions. Each is reversible and listed with its reason in `../design-spec.md` section 7 (Decisions). The user or the cross-side reviewer accepts or drops them at Gate 1.7.

- `[lane-proposed]` Landing order: Generate agents, Generate project guidance, then Workspace analysis marked Optional (decision 1).
- `[lane-proposed]` One cancel, two controls: **Stop generation** in the Run section (and beside the peek bar when narrow) works in every active state, also when the chat is idle; the composer's Stop calls the same cancel through a small additive chat change C1 (decision 6, spec 2.9.1).
- `[lane-proposed]` Combined flow: after the agent result commits, a visible 5 s countdown with Skip guidance and Start now; the guidance tab and run begin at the start point (decisions 13 and 20, spec 2.9.2). The countdown names the Project Prompt tab's own model (not the agent run's) and prints the agent run's only when it differs (decision 25, spec 2.9.3).
- `[lane-proposed]` The guidance page has a pending-start state with Stop; a stop pressed there is queued and applied when the run id exists, or dropped with an explicit sentence when the start is rejected or blocked (decision 26, spec 2.4.1, 2.9.1).
- `[lane-proposed]` A stop that is not confirmed is never reported as "did not reach the run": refused and verified active, no answer (re-reading), or re-read failed (Check again, no Stop) (decision 24, spec 2.9.1).
- `[lane-proposed]` One model per tab, snapshotted into the run; the composer governs chat replies only during a run and is labelled when it differs (decision 8, spec 2.9.3).
- `[lane-proposed]` Completion `errors` shown as a safe block (first three, rest behind a disclosure); the absolute "nothing was written" sentence only for pre-execution rejections (decisions 21 and 22, spec 2.3.5, 2.9.4).
- `[lane-proposed]` Without an analysis, agent scores and the recommended count are not shown; the list says it is a catalog (decision 9).
- `[lane-proposed]` The context source card shows "Checked when the run starts" until the run reports a source (decision 10).
- `[lane-proposed]` "Not now" on the resume offer hides it for the current open only (decision 12).
- `[lane-proposed]` The saved-analysis row action is labelled "Hide this analysis from the list" (decision 14).
- `[lane-proposed]` Analysis pages keep a two-step indicator (Scan, Analysis) (decision 3).
- `[lane-proposed]` Copy for the states the task description does not word (listed in design-spec section 5, marked "designer copy").

## Deviations

- Fonts (Inter, JetBrains Mono) load from Google Fonts when online and fall back to system fonts offline. Icons are a local Lucide sprite (`assets/sprite.js`), generated by `assets/gen-sprite.mjs`.
- The tab bar, the chat column and its composer are labelled stand-ins: the real `ptah-session-embed` (`chrome="bare"`) is existing product code and not designed here. The composer stand-in shows a Stop only while the chat streams, as the real one does, and its Stop runs the same cancel as Stop generation (design-spec change C1).
- No departure from the project tokens: `assets/tokens.css` and `assets/app.css` are the approved 649 prototype files; `assets/wizard.css` only adds what these pages need.

## Project rules applied

Parity: every state maps to design-spec section 4 (the 35 capabilities of `../parity-inventory.md`); the Screenshots table above names the spec section of each capture.

Each is a `[project-rule]` with its source in `../design-spec.md`: Setup Hub home keeps its design (649 D10 and D12); generation workflows are normal chat tabs tagged `setup-agent-generation` and `setup-project-prompt`; sidebar pattern, 336 px width, 720 px breakpoint and scrolling sidebar from the approved 649 design (D11); freshness messages are the exact strings from the task-description table; no capability is removed (keep-and-fix); existing theme tokens only.
