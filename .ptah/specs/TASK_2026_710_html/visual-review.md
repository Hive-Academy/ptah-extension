# Electron HTML artifact visual review

**Verdict: ISSUES** — 1 medium visual defect. Reviewed the existing dev build at 1440 × 900 in the real Electron renderer with an isolated profile and database. The fixture rendered through `ptah-artifact://visual-dashboard-demo/index.html`; no build or test target was run.

| Screenshot | Theme | State and result |
| --- | --- | --- |
| [dark-sheet](visual/dark-sheet.png) | Anubis (dark) | **PASS:** Display sheet open, artifact selected, dashboard visible. The compact sheet has a scrollable frame. |
| [dark-fullscreen](visual/dark-fullscreen.png) | Anubis (dark) | **ISSUE:** Full-screen overlay opens, but the frame remains about 160 px tall. |
| [dark-escape](visual/dark-escape.png) | Anubis (dark) | **PASS:** Escape closes full screen, retains the sheet and selection, and restores visible focus to Full screen. |
| [light-sheet](visual/light-sheet.png) | Anubis Light | **PASS:** Dashboard and host both switch to light mode, with legible foreground and tile text. |
| [light-fullscreen](visual/light-fullscreen.png) | Anubis Light | **ISSUE:** Same short frame and large blank overlay. |
| [light-escape](visual/light-escape.png) | Anubis Light | **PASS:** Escape returns to the selected artifact in the open sheet with a focus ring on Full screen. |

## Finding

**Medium — Full screen does not expand the artifact frame.** In both full-screen screenshots, only the title and first KPI row are visible in a roughly 160 px iframe; the SVG chart remains behind the frame's scrollbar while most of the overlay is empty. The viewer switches its container to `fixed inset-0` at `libs/frontend/chat-ui/src/lib/organisms/artifacts/artifact-viewer.component.ts:219-224`, but the iframe retains `[style.height.px]="height()"` at line 150; `height` starts at `ARTIFACT_HEIGHT_MIN` at line 187. This self-contained fixture does not send a height request, which is a valid artifact state. Full screen should give the frame the available vertical space. The same screenshots show no blank frame, content overflow outside the frame, or obvious text contrast failure.

## Method and limits

- Confirmed `dist/apps/ptah-electron/main.mjs` and `renderer/index.html` existed, then used the supplied dev build. Command run: `node .ptah/specs/TASK_2026_710_html/visual/drive.cjs` (five iterations while completing the welcome → folder → New session → Create flow). No `nx` command, install, Playwright spec, or source edit was run.
- The script used `playwright-core` `_electron` with one fresh `mkdtemp` profile, `PTAH_DB_PATH` inside that directory, `PTAH_E2E=1`, the fixture directory, and `--remote-debugging-port=9347`. It closed the Electron application handle it launched and removed the temporary directory in `finally`. The final run exited successfully with no recorded errors; machine-readable [evidence](visual/evidence.json) records the active tab id, selected theme names, frame URL and state.
- Opened this worktree through Ptah's folder dialog, created a session, and inserted the schema-shaped artifact record into that active tab's `ArtifactStore` through Angular's renderer debug API. Selected the artifact from the Display strip. Switched themes through Ptah's **Change theme** menu, choosing **Anubis** then **Anubis Light**. The frame text reported `dark theme` and `light theme` respectively.
- A transcript artifact card was not reachable without a real agent run, so it was not fabricated or reviewed. This pass covers the 1440 × 900 window only; it does not claim narrow viewport, other browsers, or packaged Electron behavior. The fixture has no network requests and does not test the security containment matrix.

## Decisions

- Used the active session's tab id for `sessionId`, as required by `artifact.store.ts:29-41` and the Display sheet's tab bucket. This is reversible and affected only the isolated renderer session.
- Classified the short full-screen frame as medium: content remains reachable by scrolling, but full screen fails its primary sizing purpose in both themes. The behavior is directly visible in the cited screenshots and traceable to the viewer height binding.

## Orchestrator re-run after the fix (2026-10-20)

The medium finding is fixed in `artifact-viewer.component.ts`: in full screen the iframe gets
`flex-1 min-h-0` and no fixed pixel height; on exit the reported height returns. Spec added
(`lets the frame fill the overlay and restores the reported height on exit`). The renderer was
rebuilt with `copy-renderer-dev` and `visual/drive.cjs` ran again with no errors. The new
`dark-fullscreen.png` and `light-fullscreen.png` show the frame filling the overlay with the full
chart. Verdict after the fix: PASS. Still not checked: the transcript card (needs a real agent
publish), narrow viewports, and the packaged build.
