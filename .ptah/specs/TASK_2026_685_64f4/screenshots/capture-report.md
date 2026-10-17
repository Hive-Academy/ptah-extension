# TASK_2026_685 - real-app "current state" capture report

Evidence capture of the current app, not a review verdict. 18 of the 19 listed shots were
captured (the 19th, a running CLI lane, does not exist in the profile). Two extra shots were added.

## Agents used (same in every shot of one lane kind)

- Workspace `ptah-final-run-ws`, session **S2**, orchestrator tab for main chat and inspector.
- CLI lane: `codex` (the S2 lane, finished, restored from the saved session).
- Subagent: `general-purpose` (SDK sub-agent in S2, finished).
- Running subagent: `Explore` in session **S4** (the only "running" agent in the profile; see notes).
- Main chat turn with tool and file counts: session "can you generate html stats and some..." (S2 has no
  turn with file counts).

## Shots

| File | Captured | What is visible | Notes |
| --- | --- | --- | --- |
| `current-cli-dark-1440.png` | yes | S2 codex lane: dock (selected `codex done` chip), header: `completed` badge, Resume icon, duration `74h 16m`; usage row `ctx — in ≥ 108.0k out ≥ 557 —`; `Task` / `Parent: 3646b4eb…` row; output lines; inspector open on the right | Duration reproduced: `74h 16m` in header, `74h 16m` in inspector row, no duration on the chip |
| `current-cli-light-1440.png` | yes | Same as above, light | Defect: the `PLAIN TEXT` code block stays dark with unreadable dark text in light theme (may be a side effect of switching the theme by DOM attribute, see theme method) |
| `current-cli-dark-760.png` | yes | Same, 760 wide; Sessions rail stays open, lane column ~340px; dock shows `codex done` chip and a `3` agents button; usage row fits on one line, `Parent: 3646b4eb…` truncated | No horizontal scroll (checked). Top nav labels (Chat, Apps, Tasks, Tribunal, Analytics, Setup) are clipped at the bottom of the bar at 760 |
| `current-cli-light-760.png` | yes | Same, light | Same code-block and nav-label notes |
| `current-cli-restored-dark-1440.png` | yes | Session reopened (selected S1, then S2 again, then the lane): header duration `74h 19m` and selected chip `codex done` (no duration) in one frame | All lanes in this profile are restored lanes, so this frame matches `current-cli-dark-1440` apart from the tick. Duration finding reproduced: 74h is the lane age, ticking each minute (`74h 14m` -> `74h 20m` over the session) |
| `current-cli-running-dark-1440.png` | **no** | - | Not available in profile: every codex lane is `done`; no CLI lane runs and none was started (no paid runs) |
| `current-subagent-dark-1440.png` | yes | general-purpose lane: `general-purpose done` chip, usage row `ctx — cache not reported out 1.3k`, bubble header (chevron, `G` avatar, name, task text, `5 tools`), status row (`completed` badge, task, transcript icon, `Message agent`), footer `1.3k tokens`, `$0.29`, `3ms` | Footer duration `3ms` is wrong for a run that waited 45 s; the running Explore shows `0ms` |
| `current-subagent-light-1440.png` | yes | Same, light | - |
| `current-subagent-dark-760.png` | yes | Same, 760; name wraps to two lines (`general-/purpose`), task text truncated, bubble body scrolls inside the card | Chip shown as a tab (not the menu) |
| `current-subagent-light-760.png` | yes | Same, light | - |
| `current-subagent-running-dark-1440.png` | yes (stale) | S4 `Explore running` lane: chip `Explore running`, `running` badge, status row with `Message agent`, progress/footer `225 tokens`, `$0.14`, `0ms`; S4 header shows `running` and `Stop` | The "running" state is restored and stale: no live process exists (no agent was started in this run). The status row shows no stop/background actions here (only the pending-state icon and `Message agent`); the actions appear in the inspector menu instead |
| `current-tabchip-cli-dark-1440.png` | yes | Dock strip close-up, selected chip: avatar with check, `codex`, `done`, no duration | Clip of the dock (orchestrator, subagent and codex chips plus `3 agents`) |
| `current-tabchip-subagent-dark-1440.png` | yes | Dock strip, selected `general-purpose done` chip, no duration | - |
| `current-hovercard-cli-dark-1440.png` | yes | Hover card of the codex chip: name, `CLI lane`, `done`, activity line ("I was able to spawn one subagent using…"), "Click to view this thread" | No duration in the card |
| `current-hovercard-subagent-dark-1440.png` | yes | Hover card of the general-purpose chip: name, `Sub-agent`, `done`, "Click to view this thread" | No duration, no activity line, no model |
| `current-inspector-dark-1440.png` | yes | Inspector `AGENTS` section (S2): `general-purpose` row (done, `Sub-agent` badge, `Opus 5.5`, no tokens, no cost, no duration) and `codex` row (done, `CLI lane` badge, activity text, `≥ 108.6k tokens` badge, `74h 20m`) | CLI row has token and duration badges, subagent row has neither; finished rows have no actions menu |
| `current-inspector-light-1440.png` | yes | Same, light | - |
| `current-mainchat-turn-dark-1440.png` | yes | Orchestrator turn header row: `Worked` + chevron, `14 tools · 4 files`, closed | Row text is `Worked`, not `Worked for X`: no elapsed time is shown in this build |
| `current-mainchat-turn-light-1440.png` | yes | Same, light, closed | - |
| `current-mainchat-turn-open-dark-1440.png` | yes (extra) | Same turn with the activity panel open: `ptah workspace analyze`, Bash, Skill, Read, Write rows | The listed `-open` shot |
| `current-inspector-menu-s4-dark-1440.png` | yes (extra) | S4 inspector with the actions menu open on the `Explore` row: `View transcript`, `Steer`, `Send to background` | No action was clicked. Menu overlaps the `Opus 5.5` badge and the next row's status |

## Defects seen while capturing (not a review)

1. Duration `74h NN m` on the CLI lane header and the inspector row for a finished, restored lane (the 685 finding, reproduced; ticks every minute). The tab chip and the hover card show none.
2. Subagent footer duration is `3ms` / `0ms` (S2 general-purpose, S4 Explore).
3. Light theme: `PLAIN TEXT` code block in the CLI lane keeps a dark background with unreadable text. Could be caused by switching `data-theme` in the DOM without a re-render; verify with the app's theme setting.
4. 760 wide: top navigation labels are clipped at the bottom edge of the bar.
5. Hover card shows different fields per lane kind (CLI has activity text, subagent has none; neither has a duration).

## Harness and environment

- Harness command (run from `screenshots\_harness\`): `NODE_ENV=development D:\projects\ptah-extension\node_modules\electron\dist\electron.exe launcher.mjs --remote-debugging-port=9351`
- `_harness\launcher.mjs`: copy of `clean-session-followups\.ptah\tmp\a1117-launcher.mjs`, with only the imported `main.mjs` path changed. Nothing in `clean-session-followups` was edited. Capture scripts: `_harness\lib.mjs`, `run1.mjs` ... `run4.mjs` (Playwright over CDP).
- Dist path used: `D:\projects\ptah-extension\.claude-worktrees\chat-transcript-followups\dist\apps\ptah-electron\main.mjs` (built Oct 16 21:35; nothing was built).
- Profile used: private copy `D:\projects\ptah-extension\.claude-worktrees\clean-session-followups\.ptah\tmp\a1117-appdata\Ptah Dev` (confirmed through the crashpad `--user-data-dir` of the second launch). The profile copy was used as it was; the app rewrote some of its files (global-state, caches).
- Shared state not isolated by the profile copy: with `NODE_ENV=development` the app uses `~/.ptah/state/ptah-dev.sqlite` and `sessions-dev.sqlite` (the same data the earlier 681 captures used) and shares `~/.ptah/settings.json` / `~/.ptah` files. S4's "running" Explore row and the sessions list come from the dev database.
- Theme switch method: `document.documentElement.dataset.theme = 'anubis' | 'anubis-light'` (the same method the earlier 681 harness used). I did not use the Settings UI, to avoid writing the theme into the shared `~/.ptah/settings.json`. The profile started in `anubis` (dark). Every light shot was returned to `anubis` afterwards.
- Width method: Playwright `setViewportSize` 1440x900 and 760x900. At 760 the dock showed the codex lane through the agents menu (CLI) or as a tab (subagent); no horizontal scroll at either width.
- Not started: no agent run, no CLI lane, no build, no nx target, no git change (the only new files are in `screenshots\`).

## INCIDENT (disclose to the parent)

My first launch omitted `NODE_ENV=development`. The launcher's `userData` override did not apply in that mode, so for roughly 3 minutes Electron ran against the **production** profile (`C:\Users\abdal\AppData\Roaming\Ptah`) and the **production** database `~/.ptah/state/ptah.sqlite`, with the single-instance lock bypassed while the user's own Ptah (PIDs from 16:17) was running. Actions in that window: launch, read the sessions list, open the workspaces panel, read-only screenshots. I clicked no session, sent no message and ran no agent. I killed that process tree (PID 42988) as soon as I saw the profile path. Side effects I could see: `ptah.sqlite` / `ptah.sqlite-wal`, `Preferences`, `Network`, `blob_storage` and `DevToolsActivePort` in the Roaming profile were touched, and the app may have run its startup work (migrations check, cron registration, `~/.ptah/settings.json` write at 00:47). The forced kill may leave a stale `DevToolsActivePort`. The logs of that launch are in `_harness\electron-INCIDENT-prod-launch.log` / `.err`. Recommend the user checks that the production Ptah still opens normally and that `ptah.sqlite` is intact. I did not delete or repair anything there.

## Closing state

- Electron closed (launcher PID 17688 and its children killed); no electron process with `launcher`/`9351` remains.
- **Port 9351 free: yes** (checked with `netstat` after the kill).
- Exploration screenshots deleted; only the listed shots, the two prototype PNGs and `_harness\` remain.
