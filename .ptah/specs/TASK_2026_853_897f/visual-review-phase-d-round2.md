# Visual Review - Phase D round 2 (TASK_2026_853_897f) - Electron

## Verdict: PASS

All five round-1 re-checks (V1-V5) and minors 9 and 11 are fixed in the running Electron build, in dark (ptah-glass) and light (ptah-glass-light). No new defects found. Window 1200x774 only.

## Results

| Item | Check | Result | Screenshots (under `evidence/`) |
| --- | --- | --- | --- |
| V1 | Install-scope migration notice shows in the focused full-chrome chat view | PASS. Notice card rendered above the empty orchestrator state ("Installed items no longer load in every workspace", counts, "Show the 1 shared source left on disk", Open Marketplace, Got it). Seed gave the ledger `completedAt`, 1 retired item, 1 on-disk item. Card is 720x222 at (348,107). Round 1 showed no card at all. | pd-r2-chat-notice-dark.png, pd-r2-chat-notice-light.png |
| V2 | Consent dialog keyboard focus (plugin "Install dotnet-msbuild?") | PASS. Tab order: Close X ("Cancel install") > scope radio group (one stop) > Cancel > Install > wraps to Close X. Shift+Tab: reverse, wraps from Close X to Install. Same in both themes. Radios are a single tab stop. Install shows a 2px solid outline ring in the light capture; Cancel, radio and X reached with a visible ring. Note: the Close X is an extra stop before the radios (expected, not a defect). | pd-r2-consent-focus-tab1-dark.png, -tab3-dark.png, -tab4-dark.png, -tab5-dark.png, pd-r2-consent-focus-tab1-light.png, -tab3-light.png, -tab4-light.png |
| V3 | Built-in `ptah` MCP server row is global | PASS. "Where they are installed" row: `ptah`, badge "All workspaces", "Available everywhere"; no "This workspace" badge and no Make global. | pd-r2-ptah-server-global-dark.png, pd-r2-ptah-server-global-light.png |
| V4 | Retired skills.sh root not listed as installed global skill | PASS. Seeded `ptah-skillssh-legacydemo` (no sidecar, ledger outcome `onDisk`, `metadata-missing`; present in `~/.ptah/plugins` and in the retired registry). Installed skills page: Community skills "Nothing installed yet", header count 0. (Round 1 listed it as "All workspaces".) Folder remains on disk and the notice reports it as left on disk. | pd-r2-installed-skills-no-legacy-dark.png, pd-r2-installed-skills-no-legacy-light.png |
| V5 | Make global keeps skill selected, no sources-missing | PASS. Workspace in `selected` mode (`state.json` `enabledSkillSlugs: []`). Installed skills.sh "Find Skills" to this workspace (row "This workspace" + Make global; chip "Harness in sync across 5 targets"). After Make global: row "All workspaces / Available everywhere", success line, chip still "Harness in sync across 5 targets", 1/7 enabled. `state.json` now `enabledSkillSlugs: ["find-skills"]`; `ws/.claude/skills/find-skills` still present. | pd-r2-skill-workspace-before-dark.png / -light.png, pd-r2-skill-after-make-global-dark.png / -light.png |
| Minor 9 | Warning block padding | PASS. Light: help text bottom 563.5 vs box bottom 576.5 (13 px; box `p-2.5`), top gap about 11 px; reads symmetric (round 1: about 10 vs 12). | pd-r2-consent-warning-padding-light.png, pd-r2-consent-focus-tab4-light.png |
| Minor 11 | Success line in row layout | PASS. "find-skills is now available in all workspaces." sits under the row name in the name text column (x=365, same as name and source line), inside the row card. Round 1: flush left at x=321. | pd-r2-skill-after-make-global-light.png, pd-r2-skill-after-make-global-dark.png |

## Environment and method

- Fresh build: `node scripts/verify.mjs --exec --task electron-screenshot-build -- npx nx run ptah-electron:build > /tmp/tpd-d-electron-build2.log` (waited in the lock queue; exit 0, 307 s once it ran), then `node apps/ptah-electron/scripts/copy-renderer.js` (exit 0, log `/tmp/tpd-d-copy-renderer2.log`; bundle contains "Install servers for").
- Launch: `dist/apps/ptah-electron/main.mjs` of this worktree with the main checkout's `node_modules/.bin/electron`, `--no-sandbox --user-data-dir=/tmp/tpd-d-run2/udd --remote-debugging-port=9355 /tmp/tpd-d-run2/ws`; HOME, XDG_CONFIG/DATA/CACHE, PTAH_DB_PATH all under `/tmp/tpd-d-run2`. Workspace is a fresh temp git repo. Driven over CDP with playwright-core (scripts in `/tmp/tpd-d-scripts2`). Real `~/.ptah`, `/home/amun/projects/.ptah`, credentials and settings not touched.
- Seed (V1/V4): before first boot created `/tmp/tpd-d-run2/home/.ptah/plugins/ptah-skillssh-legacydemo/skills/legacydemo/SKILL.md` with no `.ptah-skillssh.json`; boot migration then wrote `~/.ptah/migrations/install-scope.json` with `completedAt` and the notice. Then New session to open the full-chrome focused chat.
- Registry fetch shim (process-local, in `/tmp/tpd-d-scripts/patch-fetch.cjs`, via `NODE_OPTIONS=--require`) was enabled again at launch as allowed; it only rewrites the MCP registry details response. This round's checks did not open the MCP registry install panel, so the shim had no effect on any screenshot.
- Installs performed: skills.sh "Find Skills" into the temp workspace (then Make global) and nothing else. The dotnet-msbuild consent dialog was opened and cancelled; no plugin or MCP server was installed.
- App closed with `pkill -f user-data-dir=/tmp/tpd-d-run2`; no run2 process left. Files under `/tmp/tpd-d-run2` retained.

## Not checked

- V1 keyboard behaviour of the notice (Tab to Got it, focus return to composer) and the unfocused / read-only / Command Center variants (amended rule in decision #80): only the positive case in the focused full-chrome view was captured.
- V5 in the `ptah` MCP conversion state (Make global for a workspace MCP server): no workspace MCP server existed in the temp profile.
- V3: only the case "Ptah intent row absent" (fresh profile).
- Dark-theme Install/Cancel focus captures exist for tab1, tab3, tab4(Install not captured by regex; tab5 shown); light has the Install ring. Order itself was logged for both themes.
- No narrow viewport sweep (fixed Electron window).
- Initial Overview showed "Harness sources not installed yet" on a fresh profile with no skills (before any install); after the install it reads in sync. This is the baseline, not a regression.

## Decisions

- Used the dotnet-msbuild plugin dialog for V2 (the one with the scope radios), same surface as round 1.
- Treated the extra Close X stop as acceptable: it is a real button in the dialog and the trap wraps correctly.
- Kept the shim enabled at launch for continuity; recorded above as inert for this round (reversible, /tmp only).
