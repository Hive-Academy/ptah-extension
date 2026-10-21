# HANDOFF — TASK_2026_710 phase 3: Ptah glass theme implementation

Written 2026-10-21. Read this file first. The earlier design handoff is
`D:\projects\ptah-extension\.claude-worktrees\aurora-card-prototypes\.ptah\specs\TASK_2026_710_aurora-cards\HANDOFF.md`
(design history; its section 6 steps 4-6 are the phase-3 plan this file continues).

## 1. Goal

Ship an app-wide glassmorphism DaisyUI theme pair, `ptah-glass` (dark) and `ptah-glass-light`, as the
NEW DEFAULT theme of the Angular webview (Electron first), built as one shared `data-glass` CSS layer
with surface roles, plus a primary-accent setting. Then visual review in Electron, independent review
by a different model family, push and PR.

## 2. User decisions (all final)

1. Design = **C4** (`aurora-card-prototypes/.ptah/specs/TASK_2026_710_aurora-cards/glass/c4/`), approved as
   C3 + two changes (new accents, more glass inside panels).
2. Dark backdrop: more color (C3/C4 strong glows). Static SVG backdrop, no animated aurora.
3. Accents: **gold (default), rose quartz (`rose`), moonstone (`moonstone`)**. Violet and teal were rejected
   as "too common". Only primary follows the accent (secondary and the accent role do not).
4. More glass inside panels: dark pane under-scrim .18 with local `plate` / `bar` scrims behind text
   (user rejected .66).
5. Glass ON for stock themes: only dark, nord, cupcake, dracula. black, lofi, wireframe, cyberpunk and all
   untested themes opt out.
6. Gold as primary in the Ptah themes (accent setting covers the "variations" question).
7. Orchestrator choices not yet confirmed by the user: header keeps the denser `bar` role; rose stays the
   designer's pastel/raspberry. Mention both in the PR.

## 3. Where everything is

| Item | Value |
|---|---|
| Phase-3 worktree | `D:\projects\ptah-extension\.claude-worktrees\ptah-glass-theme` |
| Branch | `feat/ptah-glass-theme` from main `0fc0c3a09`. **Local only, NOT pushed, no PR yet.** |
| Commit | `882cbe756 feat(webview,core,chat): add ptah-glass theme pair as the default` |
| node_modules | junction to `D:\projects\ptah-extension\node_modules` (git-ignored). Remove with `cmd /c rmdir <worktree>\node_modules` before `git worktree remove`. Never `npm install` in the worktree. |
| Prototype branch | `feat/aurora-card-prototypes`, draft PR #799 (pushed; C3 `de8feda78`, C4 `b618631fc`). Keep draft; close or merge after phase 3 as the user decides. |
| Task folder | `.ptah/specs/TASK_2026_710_ptah-glass-theme/` in the phase-3 worktree |

### Uncommitted in the phase-3 worktree

- `.ptah/specs/TASK_2026_710_ptah-glass-theme/shots/`, `shots-workspace/` — Electron screenshots (≈12 MB,
  stale; retake after the fixes; decide whether to commit a small subset for the PR).
- This `HANDOFF.md` and `code-logic-review.md` (grok review, landed).
- Note: the orchestrator CSS fixes from section 4.2 ARE in 882cbe756 (`git add -u` staged them).

## 4. What is done

### 4.1 Implementation (commit 882cbe756, by two codex CLI lanes)

- Lane A (`lane-a-theme-layer.md`): both themes in `apps/ptah-extension-webview/tailwind.config.js`
  (`darkTheme`/`themeRoot` = ptah-glass); `index.html` pre-paint script (default ptah-glass, data-glass,
  data-accent from `localStorage['ptah-accent']`); glass layer appended to `styles.css` in one
  `@layer components` block (only the 6 opted-in scenes); `libs/frontend/core/src/lib/services/theme.service.ts`
  (ThemeName, `glass` flag, DAISYUI_THEMES, EAGER_THEMES, default, data-glass/data-glass-mode,
  `AccentName`/`ACCENTS`/`ACCENT_COLORS`/`setAccent`, state key + localStorage hint `ptah-accent`);
  accent radiogroup in `libs/frontend/chat-ui/src/lib/atoms/theme-toggle.component.ts`; guard specs
  `accent-contrast.spec.ts` (core), `accent-css.spec.ts`, `glass-scrim.spec.ts`, `glass-roles.spec.ts`
  (webview app) and updates to `theme-boot-lists`, `state-ink-contrast`, `base-content-muted`,
  `status-badge-contrast`, `theme.service.spec`.
- Lane B (`lane-b-surface-roles.md`): `data-glass-surface` roles on ~26 component files (electron shell
  header `bar`, workspace sidebar `chrome`, chat view, docked inspector, chat input, modals, dropdown,
  message bubble, setup card, stats, tool calls, execution node, command center, 8 settings/marketplace
  cards); aurora hidden under glass in `chat-empty-state` and `canvas-rail-board` via `:host-context`.
  No chat date separator exists, so no pill was added. `ptah-dialog-host` does not exist.

### 4.2 Electron visual review (orchestrator) and fixes

Build (done, both compile): `npx nx build-dev ptah-electron` then `npx nx copy-renderer-dev ptah-electron`
(build-dev does NOT build the renderer). Screenshots: `node .ptah/specs/TASK_2026_710_ptah-glass-theme/shoot-electron.cjs [workspaceDir]`
(with a workspace arg it writes `shots-workspace/`; it sets theme attributes directly, then shoots home,
settings, and the theme picker scrolled to the accent swatches).

Fixed and verified in Electron: settings screen was opaque (`.bg-surface-0` now transparent under glass);
theme picker painted under settings tabs (`bar` gets `z-index: 30`).

Fixed in `styles.css` (committed in 882cbe756) but **NOT yet rebuilt/verified**, and per review
finding 2 and 5 these rules sit in `@layer components` and so LOSE to Tailwind utilities — that is why the
first attempt did not change the render. They must move to unlayered CSS:
- picker panel see-through: overlay fill now wins over `bg-base-*` utilities, and `.dropdown-content`
  inside the `bar` is `oklch(var(--b1) / 0.97)` (Chromium cannot blur a backdrop-filter nested in the
  bar's backdrop-filter);
- opaque rectangle to the right of the active header tab: `.tabs-lifted > .tab { --tab-bg: var(--glass-plate) }`.

Looked correct: welcome screen, chat empty state with setup card, settings, in dark and light, gold and
rose accents, dracula/nord/lofi regression shots.

Not covered yet: a busy chat (messages, code block, tool calls) and a modal, both in dark and light.

## 5. In progress at handoff

- Nothing is running. No lanes or subagents are active.
- **Machine check queue**: other sessions (e.g. analytics-v2, PR #801) coordinate heavy checks by
  cross-session message ("checks: free"). Before a renderer rebuild, ask peers via ListAgents/SendMessage or
  confirm no heavy `nx`/`node` process runs. This session told analytics-v2 it is free and wrapping up.

## 6. Open problems

1. Theme picker preview dots show the same colors for lazy (non-eager) themes. Likely pre-existing
   (lazy themes are not in the initial sheet); confirm against main before treating as a regression.
2. Guard specs were written by the lane but never run (user's temporary rule: CI runs checks). CI may
   fail on them; fix only the failing spec, reproduce with the scoped Jest command below.
3. `accent-contrast` uses token values, not rendered pixels; rendered-pixel contrast was checked only
   in the prototype (`measure.cjs`).
4. The section-3 comment header in the glass block of `styles.css` is not closed before the section-4
   header (harmless, but tidy it).

## 7. Exact next steps

1. Read `code-logic-review.md` and section 8. Verify each finding at its `file:line`. Send the confirmed
   findings 1-7 plus the user defects 8-10 as one numbered defect list to a codex lane (`ptah_agent_list` first; workingDirectory = the
   phase-3 worktree; brief must repeat the memory-safe and Electron-first rules, no git writes, load
   `impeccable` + `angular-frontend-patterns`). After the fix, re-review by grok (different family), max 2
   revise rounds.
2. When the machine is free, rebuild and reshoot:
   ```bash
   cd /d/projects/ptah-extension/.claude-worktrees/ptah-glass-theme
   npx nx copy-renderer-dev ptah-electron --parallel=1 2>&1 | grep -iE "error|failed" | head
   node .ptah/specs/TASK_2026_710_ptah-glass-theme/shoot-electron.cjs "$(pwd -W)"
   ```
   Check `shots-workspace/ptah-glass-gold-home.png` (no opaque tab rectangle) and
   `*-theme-picker.png` (solid panel). Extend the script for a busy chat and a modal if possible.
3. Commit the fixes in the foreground (scopes from `.commitlintrc.json`: webview, core, chat, chat-ui,
   ui, marketplace, command-center, task-specs are valid; subject ≤ 72 chars; body lines ≤ 100, wrap 72;
   end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`).
4. Push and open the PR in ONE background command:
   ```bash
   git push -u origin feat/ptah-glass-theme && gh pr create --base main --title "feat(webview,core,chat): Ptah glass theme pair as default" --body-file <file>
   ```
   PR body: summary, decisions in section 2, screenshots (dark + light, compared with C4 shots), the
   review family line (reviewer grok, implementer codex), test plan; end with
   `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. The pre-push hook runs di-lint and
   the Electron validate-deps gate; a failure needs a fix commit, then push again.
5. Let CI run the checks (user's temporary rule until 2026-10-24). Only to reproduce a CI failure:
   ```bash
   npx jest -c libs/frontend/core/jest.config.ts libs/frontend/core/src/lib/services/<spec> --coverage=false --maxWorkers=2
   npx jest -c apps/ptah-extension-webview/jest.config.ts apps/ptah-extension-webview/src/app/<spec> --coverage=false --maxWorkers=2
   npx nx test core --parallel=1    # confirm project names first: npx nx show projects | grep -iE "core|webview"
   ```
6. Show the user the Electron screenshots and the PR link. After merge, the user decides on draft PR #799;
   remove worktrees only when the user says so.

## 8. Review result

`code-logic-review.md` — reviewer grok, implementer codex. **Score 6/10, verdict REVISE**, 0 blockers.
The orchestrator has not yet verified each finding against the code; verify, then fix.

1. Major — dark escape hatches (`@supports not (backdrop-filter)`, reduced-transparency / more-contrast)
   lose to the more specific `[data-glass-mode='dark']` token block (`styles.css:2587` vs `:2627`, `:2639`);
   `glass-scrim.spec.ts` passes anyway. Fix: add the mode attribute to the hatch selectors, keep them after.
2. Major — role fills and the bg overrides are inside `@layer components` (opens `styles.css:2511`) and lose
   to Tailwind utilities (`bg-base-200`, `bg-surface-1`, `bg-base-100`) on settings cards, the Electron header,
   the command-center header and the theme menu. Fix: move the neutralisation rules to unlayered CSS after the
   utilities, or drop the conflicting `bg-*` classes where a role is set.
3. Major — `ThemeService.toggleTheme` (`theme.service.ts:433-436`) turns any non-`ptah-glass` theme (incl.
   stored `anubis`) into `ptah-glass`, so the command-center "Switch to light theme" stays dark and overwrites
   the saved theme. Fix: dark non-pair → `ptah-glass-light`, light non-pair → `ptah-glass`; update the spec at
   `theme.service.spec.ts:228-234`.
4. Major — `accent-css.spec.ts:10-14` picks the scene-URL rule (`styles.css:2719`) as the gold block, so its
   `--g-ptah-focus` assertions FAIL. Fix: select the block that declares `--g-ptah-focus`.
5. Minor — lifted Electron tabs: unlayered `styles.css:2494-2505` sets `--tab-bg` on `.electron-tabs`; the
   layered override at `:2831` never wins. Fix in that unlayered block, gated on `:root[data-glass='on']`.
6. Minor — corrupt stored accent in vscode state is never rewritten (`theme.service.ts:294-298`). Write the
   resolved accent back when state is present but invalid; add a spec.
7. Minor — `index.html:96-101` pre-paint reads only the localStorage accent hint, not
   `vscode.getState()['ptah-accent']` like the theme path. Prefer state, then hint.

### User feedback after the review (2026-10-21, from `shots-workspace/ptah-glass-gold-home.png`)

8. **Right sidebar has no glass background.** The Sessions pane on the right of the chat (title "Sessions",
   "0 / 9 running", "No sessions yet", bottom "New session" / "Previous sessions") sits bare on the
   backdrop over the teal glow: no `chrome` pane fill, rim or blur, and its text is not on a plate. Find the
   component that renders that pane inside the Electron shell (the right session pane, not
   `ptah-docked-inspector`, which lane B already marked) and give it `data-glass-surface="chrome"`, with
   `plate` on its title row and list area per C4 NOTES section 2. Check the C4 shot: the right pane is a
   framed glass card like the left one.
9. **Rounded corners collide where panes touch.** The Electron shell panes are docked flush (header bar,
   left workspace sidebar, the vertical "WORKSPACES" tab with the gold rule, chat area, right pane, "GIT"
   rail). Each glass role applies `--glass-radius`, so adjacent rounded corners leave notches and wedges:
   top-left where the header bar meets the sidebar, the sidebar's bottom (a second rounded edge shows
   under "Add Folder"), and the header's own corners. Decide one rule and apply it everywhere in the shell:
   (a) recommended, matching C4: float the panes as separate cards with a small gap (e.g. 8px padding on
   the shell body and between panes) so every rounded corner has backdrop around it; or (b) keep panes
   flush and set the radius to 0 on every edge that touches another pane (only outer window corners
   round). Also remove the duplicate rounded surface at the bottom of the workspace sidebar.
10. The opaque rectangle right of the active "Chat" tab is still visible (review finding 5; the layered
    `--tab-bg` override does not win).

Also noted (not a finding): first launch in VS Code light sets `ptah-glass-light` only in memory, so cold
start paints dark until Angular boots (same shape as the old anubis default).

## 9. Rules to keep

- CLAUDE.md: worktree per task, memory-safe checks (one heavy check at a time, scoped), Electron first,
  commit in foreground, push in background, every branch gets a PR.
- ~/.claude/CLAUDE.md temporary rule until 2026-10-24: orchestrate only; CLI lanes via `ptah_agent_spawn`
  (load the agent-lanes skill, run `ptah_agent_list`, never an AT LIMIT lane); Claude subagents only when the
  user asks (the user approved the `ui-ux-designer` subagent for design rounds). No local checks before push.
- Lanes do not get the Ptah system prompt: name the skills to load and the rules in every brief.
- Separate follow-up task (not started, only on request): `lane-system-prompt-task.md` in the
  aurora-card-prototypes task folder.
