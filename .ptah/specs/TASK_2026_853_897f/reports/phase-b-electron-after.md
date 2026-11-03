# Phase B Electron AFTER capture

Verdict: PASS for group 3 UI (dark, light, populated, empty). Token measurement: NOT RUN (needs the real claude.ai login); offline estimate only.

## Build and run
- Rebuilt under the lock: `copy-renderer-dev ptah-electron` (exit 0) and `build-main ptah-electron --configuration=development` (exit 0). Log: /tmp/tpd-b-build.log (mostly lock-wait lines). dist main.mjs contains the `anthropic-skills` strings.
- Isolated Electron per reports/a0-electron-before.md: temp HOME/XDG/PTAH_DB_PATH/user-data-dir under /tmp/ptah-tpd-phaseB-run (kept), NODE_ENV/PTAH_E2E/ELECTRON_RUN_AS_NODE unset, CDP 9333, "Update available" dismissed with Later. Scripts in /tmp/ptah-tpd-scripts (b*.js, cap4.js, tg.js).
- Fake synced skills only in the TEMP config: `<tmp home>/.claude/skills/synced/acct1_org1/manifest.json` (pdf, docx, brand-guidelines (long description)) plus matching SKILL.md dirs. For the empty state I moved that `synced` dir aside (`.../synced-hidden`). The real ~/.claude was never touched.
- Instance sent SIGTERM; CDP port 9333 is down; no Electron left. Nothing signed in, no DB deleted.

## Screenshots (evidence/)
| File | Content |
| --- | --- |
| phase-b-dark-card.png / phase-b-light-card.png | top of the card (note, savings line, tools table, group 2 start), 1200x774 viewport |
| phase-b-dark.png / phase-b-light.png | card scrolled to bottom: group 2 and populated group 3 (brand-guidelines ~60, docx ~22, pdf ~21) |
| phase-b-dark-empty.png / phase-b-light-empty.png | group 3 with no synced skills (dashed empty block) |
| phase-b-dark-docx-on.png | docx skill checked |

The card is taller (818px) than the 774px viewport and sits in a scroll container, so a single whole-card image was not possible without resizing the window (CDP window/viewport override did not change the capture); it is shown as top and bottom views instead.

## Prototype comparison (group 3, design-spec.md section 1)
Matches:
- Heading "Skills synced from your claude.ai account (hidden by default)" and one-liner "Found in your Claude home folder. Turn one on to use it in new sessions." exact.
- Columns On / Skill / Token cost / Description (no Needs tool), same table style, ~N outline badges, muted description, rows sorted by id; aria-labels "docx skill"; test id `settings-toggle-claude-skill-anthropic-skills:docx`.
- Rows are unchecked by default; checking docx persisted and was restored to off.
- Empty: dashed rounded block, bold "No claude.ai skills found", muted "If you sync skills from your claude.ai account, they will be listed here.", no table; matches.
- No overflow: card scrollWidth/clientWidth 1028/1028, scrollHeight/clientHeight 818/818. Long description fits on one line at 1200 wide (not tested narrower).
Differences / notes (all inherited from Phase A styling, not Phase B regressions):
1. On control renders as round radio-style circle, prototype draws square checkboxes. Same as Phase A report; low.
2. Group 3 row names show the bare skill name (docx) while the id is `anthropic-skills:docx`; matches prototype.
3. Savings line did not change when docx (~22) was toggled on, because the total rounds to 100 (4,100 stays 4,100). Expected from spec rounding; not a defect.
4. Savings line with 3 fake skills hidden by default reads "about 4,100" (tools+builtin skills were 4,000-4,100 in Phase A), i.e. group 3 contributes ~100 for the fake skills as designed.
5. Light theme empty block: the dashed border is `border-base-300` which computes to rgba(255,255,255,0.5) on pale glass, so the dashes are nearly invisible in light (phase-b-light-empty.png). Class at libs/frontend/chat/src/lib/settings/pro-features/claude-builtins-config.component.ts:257. Moderate-minor; prototype light shows a visible dashed border. Not blocking.

## Defects
None blocking. One minor visual (item 5).

## Token measurement
- Main-session and subagent prefix measurement: NOT RUN. The Phase A pattern (evidence/phase-a-tokens/measure.mjs) calls the Agent SDK with the user's real CLI login and real ~/.claude (it contains two real account-synced folders). The instruction was to stop if real credentials are needed, so I stopped and ran no model call. No output in phase-b-tokens besides the estimate below.
- Offline estimate only (evidence/phase-b-tokens/estimate.mjs, estimate.json; read-only over the real manifests, no model call): 13 distinct `anthropic-skills:*` skills, about 3,601 listing tokens by the reader formula ceil(chars/2.64). That is above the 3k main-session target if all are hidden, but it is NOT a measurement; Phase A before/after main figures were 34,407 vs 30,587.
- To measure for real the user must approve running measure.mjs with their login: before = synced skills visible, after = `skillOverrides` `anthropic-skills:<name>: off` for all 13, 3 runs, compare main medians (and the subagent child).

## Process notes
- Two idle bash wrapper shells from my own tool calls (pids 908669, 913951) show in ps; no app, Electron or lock process of mine remains.

## Token measurement (run after user approval, 2026-10-30)

`evidence/phase-b-tokens/measure.mjs` (Phase A method; both sides keep the Phase A denials, only
the 13 `anthropic-skills:*` overrides differ), 3 runs, workspace `/home/amun/ptah-extension`,
real CLI login. Raw rows: `evidence/phase-b-tokens/run.log`, `phase-b.json`.

- Paired runs with equal MCP tool counts: main 33,295 → 30,142 (88 tools) and 29,938 → 26,785
  (22 tools), both **−3,153**. Subagent 25,423 → 22,270, **−3,153**. Skills listed 54 → 41.
- The raw median (`after.main` 26,785 vs `before.main` 33,295) mixes 88- and 22-tool runs and
  overstates the saving; the paired figure is the result.
- Target (main-session saving ≥ 3k vs Phase A): **PASS**.
