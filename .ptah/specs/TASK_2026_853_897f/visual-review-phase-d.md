# Visual Review - Phase D (TASK_2026_853_897f) - Electron

## Verdict: REVISE

Two findings block approval: (1) the chat migration notice cannot render in Electron at all, (2) the consent dialog's focus trap makes the Cancel and Install buttons unreachable with forward Tab once the scope field is present. Everything else visible matches the design spec in both themes.

| Metric | Value |
| --- | --- |
| Blocking (Serious+) | 2 |
| Moderate | 3 |
| Minor / nits | 5 |
| Viewport | Electron window 1200x774 only (single-window desktop app; no narrow sweep) |
| Themes | ptah-glass (dark), ptah-glass-light |
| Screenshots | 29 PNG under `evidence/` (table below) |

## Environment and method

- Fresh build of this worktree: `node scripts/verify.mjs --exec --task electron-screenshot-build -- npx nx run ptah-electron:build` (exit 0, 5m59s, log `/tmp/tpd-d-electron-build.log`), then `node apps/ptah-electron/scripts/copy-renderer.js` (the `build` target does not copy the renderer; log `/tmp/tpd-d-copy-renderer.log`). Renderer bundle confirmed to contain "Install servers for".
- Launch: `dist/apps/ptah-electron/main.mjs` of THIS worktree with the main checkout's electron binary, `--user-data-dir`, HOME, XDG_*, PTAH_DB_PATH all under `/tmp/tpd-d-run`, workspace = `/tmp/tpd-d-run/ws` (git repo). Driven over CDP with playwright-core (scripts `/tmp/tpd-d-scripts`). Real `~/.ptah`, `~/.claude`, DB and `/home/amun/projects/.ptah` untouched. All Electron instances terminated (0 left).
- Review-only shim (not a source edit): the live MCP registry now serves details at `/v0.1/servers/{name}/versions/latest` in a new schema, so every registry entry shows "Could not auto-detect configuration" in the install panel even without Phase D (finding 8). To render the panel I started a second instance with `NODE_OPTIONS=--require /tmp/tpd-d-scripts/patch-fetch.cjs`, which rewrites that one details request and adds the `version_detail` shape the UI expects. The scope field, target list and buttons are the real UI; only the server data was adapted.
- Nothing that runs commands was confirmed. The one install I confirmed (skills.sh "Find Skills", then "Make global") only copied files into `/tmp/tpd-d-run/ws/.ptah/plugins` and the temp HOME `~/.ptah/plugins`.
- Expectations come from `design-spec.md` sections 2-3, `decisions.md` #74-#76 and batch-36..40 reports.

## Screenshot table

| File (under `evidence/`) | Theme | Surface | Result |
| --- | --- | --- | --- |
| f-d4-before-dark.png | dark | consent dialog BEFORE (A0) | reference |
| f-d4-before-light.png | light | consent dialog BEFORE (A0) | reference |
| f-d4-after-dark.png | dark | "Install dotnet-msbuild?" AFTER | PASS (nit 9) |
| f-d4-after-light.png | light | "Install dotnet-msbuild?" AFTER | PASS (nit 9) |
| pd-consent-focus-dark.png | dark | consent dialog, keyboard focus after Shift+Tab | FAIL (finding 2) |
| pd-consent-allws-focus-dark.png | dark | consent dialog, All workspaces selected by arrow key, focus ring | PASS (ring visible) |
| pd-mcp-install-workspace-dark.png / -light.png | both | MCP registry panel, This workspace (above the fold) | PASS (nit 6) |
| pd-mcp-install-workspace-targets-dark.png / -light.png | both | same, scrolled: 4 targets on, Copilot/Codex/Antigravity disabled with "Global only" | PASS |
| pd-mcp-install-global-dark.png / -light.png | both | All workspaces selected (above the fold) | PASS |
| pd-mcp-install-global-targets-dark.png / -light.png | both | All workspaces: seven targets checked, badges gone, "Install to 7 targets" | PASS |
| pd-mcp-radio-focus-dark.png / -light.png | both | radio group focus after ArrowRight | PASS |
| pd-skillssh-install-workspace-dark.png / -light.png | both | skills.sh install panel, "Install to this workspace" | PASS |
| pd-skillssh-install-global-dark.png / -light.png | both | skills.sh panel, "Install to all workspaces" | PASS |
| pd-skillssh-installed-badge-light.png | light | skills.sh card after install: "Installed" + "This workspace" badges + Remove | PASS (nit 7) |
| pd-installed-skills-light.png | light | Installed skills: workspace row with Make global, global row "Available everywhere" | PASS (finding 4) |
| pd-installed-skills-makeglobal-focus-light.png | light | Make global focused | PASS |
| pd-installed-skills-working-light.png | light | right after Enter on Make global | PASS |
| pd-installed-skills-converted-light.png / pd-installed-skills-dark.png | light / dark | after conversion: success line, focus ring on row name | PASS with findings 4, 5 |
| pd-installed-servers-light.png / -dark.png | both | Installed servers "Where they are installed" | PASS with finding 3 |
| pd-chat-notice-dark.png | dark | chat view with the migration complete and the notice expected | FAIL (finding 1) |

## F-D4 BEFORE / AFTER

Compared `f-d4-before-dark.png` with `f-d4-after-dark.png`, and the light pair. Same plugin, same 1200x774 window, plan request only, Cancel pressed.

| Aspect | BEFORE | AFTER |
| --- | --- | --- |
| Warning copy | "Ptah will NOT register or run these servers. Installing only puts the plugin's files on disk. Nothing below executes unless you add it yourself." | "Ptah adds these servers to the scope you choose below. Review each command before you continue." |
| "NOT register or run" text | present | absent (checked in dialog text and both images) |
| Scope field | none | "INSTALL SERVERS FOR" legend after the server list, segmented radios "This workspace" (selected) / "All workspaces", help "This workspace writes only project files. Tools that keep settings in your home folder need All workspaces." |
| Dialog height | ~425 px, header at y=175 | ~515 px, header at y=130 (taller, still fits, re-centred) |
| Header, file chips, Cancel, "Install dotnet-msbuild" | unchanged | unchanged |
| Warning block | amber, 3 text blocks | same amber block now contains the field; selected segment is gold, unselected neutral; contrast good in both themes |
| Footer status text | "1 community skills" | "1 community skill" (list content differs, unrelated) |

Keyboard (dialog, dark): Escape and click Cancel close it; ArrowRight/ArrowLeft move and select between the two radios and the focus ring is visible on the label (2px gold outline); Tab from a radio goes to the X, not to Cancel/Install (finding 2). Dialog top shifts by about 8 px when the help line changes ("This workspace" help is two lines, "Every workspace will get this server." one) - nit 10.

## Findings

### 1. Migration notice never renders in Electron (Serious / blocks approval)
- Component: `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:357-359` (`showInstallMigrationNotice = !this._sessionContext && !SESSION_READ_ONLY`) and `session-embed.component.ts:96`.
- Evidence: Seeded `~/.ptah/plugins/ptah-skillssh-legacydemo` in the temp HOME before first launch. Electron's boot migration ran and completed (`~/.ptah/migrations/install-scope.json`: item `skills-sh:ptah-skillssh-legacydemo` retired, outcome `onDisk`, `completedAt` set, so `readNotice()` is non-null). I then opened a real session. DOM probe: `ptah-chat-view` 1, `ptah-chat-session-layout` 1, `ptah-install-scope-migration-notice` 0, `[data-test=install-migration-notice-slot]` 0 (screenshot `pd-chat-notice-dark.png`, the empty hero state `Day 1` also had no card).
- Cause: Electron mounts every chat view through `SessionEmbed`, which always provides `SESSION_CONTEXT`. The notice is gated on `!_sessionContext`, so it is false for every Electron chat view. `chat-view` is never created outside `SessionEmbed` in the app (`<ptah-chat-view` appears only in specs).
- Impact: The one-time notice (design-spec section 3, decision #16) is unreachable in Electron, the priority host. Users lose retired items with no explanation. Focus-on-"Got it" and Open Marketplace cannot be reached either; they could not be verified.
- Fix: Mount the card in a host that exists in Electron (the canvas/rail shell above the session tiles, or `SessionEmbed` for the focused/first tile only), or gate on "first visible session" rather than "no session context". Update decision #75's placement note. Re-verify focus: Tab to buttons, "Got it" moves focus to the composer.

### 2. Consent dialog focus trap skips Cancel and Install once radios exist (Serious / blocks approval)
- Component: `libs/frontend/marketplace/src/lib/kept-items-repair-prompt.component.ts:258-330` (`ModalFocusTrap.focusable()` selects only `button:not(:disabled)`), used by `external-consent-dialog.component.ts:686` with the new `ptah-install-scope-field` inside the box (line 343).
- Evidence (CDP key presses, dark): focus on "This workspace" radio, Tab x7 gives `X(Cancel install) > radio > X > radio > X > radio > X`. Shift+Tab x7 gives `Install > Cancel > radio > Install > ...`. A radio is not in the trap's stop list, so the trap treats it as "outside" and sends forward Tab to the first stop (the X) every time. Cancel and Install dotnet-msbuild can only be reached with Shift+Tab. Screenshot `pd-consent-focus-dark.png`.
- Impact: A keyboard user cannot Tab to the primary action or Cancel (WCAG 2.1.1/2.4.3). Escape still cancels. Before Phase D there were no inputs in the box so the trap was complete; the new field exposes it.
- Fix: Make `focusable()` select `button:not(:disabled), input:not(:disabled), [href], select, textarea, [tabindex]:not([tabindex="-1"])` in DOM order and, for radios, treat the checked radio (one stop per group) as the stop. Add a spec with the scope field present.

### 3. Installed servers: Ptah's own server shows "This workspace" with no Make global (Moderate)
- Component: `libs/frontend/marketplace/src/lib/pages/servers/installed-servers-page.component.ts` plus `libs/frontend/chat-ui/.../installed-mcp-groups.ts` (scope derivation).
- Evidence `pd-installed-servers-light.png`: row `ptah` / badge "This workspace" / targets "Antigravity CLI, Claude Code, Codex CLI", no Make global button, while the "Use in sessions" card directly below lists `Global - Config file`, `Workspace - Config file`, `Global - Config file` for the same server. The badge and the global entries contradict each other, and no convert action is offered. Likely the built-in `ptah` server is treated as protected, but the page does not say so.
- Impact: Confusing scope label; the new section's contract (workspace item has Make global, global item says "Available everywhere") is not met for this row.
- Fix: Show "Built in" or "Available everywhere" for Ptah-managed entries, or derive scope as global when any home-file target holds it.

### 4. Retired legacy skills.sh root still listed as "All workspaces / Available everywhere" (Moderate, needs confirmation)
- Component: `libs/frontend/marketplace/src/lib/pages/skills/installed-skill-rows.ts` (and the skills.sh list RPC it reads).
- Evidence `pd-installed-skills-light.png`: `legacydemo` (the seeded retired root, ledger outcome `onDisk`, reason `metadata-missing`) appears under Community skills with badge "All workspaces", "Available everywhere", Uninstall. The migration notice copy says retired items "no longer load in every workspace".
- Caveat: my seed has no `.ptah-skillssh.json` sidecar, which is why it was kept `onDisk`. A real legacy install would have one and be deleted. Confirm whether retired-but-on-disk roots should be hidden or labelled "inactive".
- Impact: The page claims availability the migration says it removed.

### 5. After Make global the harness status stays "Harness sources not installed yet" (Moderate)
- Component: `installed-skills-page.component.ts` / marketplace store `makeSkillGlobal` follow-up refresh.
- Evidence: before conversion the header chip read "Harness in sync across 5 targets" (`pd-installed-skills-light.png`); after `Make global` it reads the amber "Harness sources not installed yet" (`pd-installed-skills-converted-light.png`, `-dark.png`, still present more than a minute later).
- Impact: A successful conversion looks like a fault. Check whether the status is stale or the new global root really lacks a harness source.

### 6. "Install for" legend sits tight under the configuration block (Minor)
- Component: `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/mcp-directory-browser.component.ts` (field placement), `install-scope-field`.
- Evidence `pd-mcp-install-workspace-targets-light.png`: about 6 px between the stdio command box and "INSTALL FOR", versus about 12 px between other groups.

### 7. Skills.sh card badge truncates the install count (Minor)
- Component: `skill-sh-browser.component.ts` card meta line. `pd-skillssh-installed-badge-light.png` / dark: "vercel-labs/skills - 4..." is cut once the "Installed" badge appears.

### 8. Live MCP registry details no longer load (Moderate, pre-existing, not Phase D)
- Component: `libs/backend/cli-agent-runtime/src/lib/mcp-directory/mcp-registry.provider.ts:15,191` (`/v0.1/servers/{name}` returns 404; `/versions/latest` and a `packages`/`remotes` schema are served) and the `version_detail` use in `mcp-directory-browser.component.ts:709`.
- Evidence: all 14 popular and 8 search results showed "Could not auto-detect configuration" in the unpatched app; `curl` of the registry confirms the 404. This is outside Phase D scope but blocks the whole MCP directory install flow (and therefore the new scope field) for real users today. Report separately.

### 9. Warning block: help text sits close to the box bottom edge (Minor)
- `f-d4-after-*.png`: second help line bottom is about 10 px from the amber border; top padding is about 12 px. Acceptable, flagged for symmetry.

### 10. Dialog height jump when help text changes (Minor)
- Switching radios changes help from 2 lines to 1 line and shifts the whole centred dialog by ~8 px (`pd-consent-allws-focus-dark.png` vs `f-d4-after-dark.png`). Reserve two lines of help height.

### 11. Success line is outside the row layout (Minor)
- `pd-installed-skills-converted-*.png`: "find-skills is now available in all workspaces." is flush left under the row, not aligned to the row text column (x=321 vs name at x=365). No toast service in marketplace (batch 38 deviation), so this is the accepted fallback; align it to the name column.

### 12. Selected radio dot is gold on gold in the focused state (Minor)
- `pd-consent-allws-focus-dark.png`: the checked segment fill carries the state; the inner dot is low contrast against the gold. Selected vs unselected remains distinguishable by fill, so not a failure.

## Surface checks

### MCP directory install panel (spec section 2, AC4-AC6)
- Light and dark: legend "INSTALL FOR", segmented radios, default This workspace; help copy as spec; "INSTALL TO" below with VS Code, Claude Code, Cursor, OpenCode checked and Copilot, Codex, Antigravity disabled with "Global only" badge while workspace is selected; helper "Global-only targets are greyed out while This workspace is selected." Button "Install to 4 targets".
- Selecting All workspaces: all seven checked, badges gone, help "Every workspace will get this server.", button "Install to 7 targets". PASS.
- Keyboard: ArrowRight moves and selects "All workspaces", ArrowLeft back; 2px outline plus ring on the focused segment; Tab leaves the group to "VS Code" (focus ring is a 3px outline on the checkbox). PASS.
- Not captured: the no-folder state (needs closing the workspace; skipped for cost, spec text for that state not verified in the running app). The unit specs cover it per batch-36.

### skills.sh install panel (spec section 2)
- Both themes: opening Install shows "Install Find Skills" panel, legend "INSTALL TO", radios, help "Only ws will get this skill. You can make it global later.", primary "Install to this workspace"; All workspaces gives "Every workspace will get this skill." and "Install to all workspaces". Installing state shows spinner "Installing..." with the radios still enabled (spec said radios disabled while installing; they appear dimmed but this was not verified as disabled) - minor.
- After install: card shows "Installed", scope badge "This workspace", Remove. Files written under the temp workspace only. PASS.

### Installed skills page
- Workspace row: badge "This workspace" and `Make global` (aria-label "Make find-skills global", 2px focus ring visible); Enter shows working state, then badge "All workspaces", text "Available everywhere", success line, and focus moves to the row name with a ring. Matches spec section 2 except findings 4, 5, 11.

### Installed servers page
- "Where they are installed" section present with intro "A workspace install loads only in this workspace. Make it global to load it in every workspace." and badge row. Only the built-in `ptah` row existed, so the Make global conversion state (note, Also add to checkboxes) was not exercised. See finding 3.

### Chat migration notice
- NOT captured: finding 1. Seeding was feasible and worked (boot migration completed, ledger shows completedAt), but the card is never mounted. Tab/"Got it"/focus-to-composer unverified. Retained temp dir: `/tmp/tpd-d-run`.

## Accessibility notes
- Radios are native inputs inside `label.btn`; arrow keys behave as native in both the dialog and the panels. Focus ring present on radios, Make global and the row name.
- Contrast was judged visually only (no computed ratios taken); gold-on-dark and dark-on-gold segments read clearly in both themes.
- Focus trap: finding 2.

## Not captured / not verified
- Chat migration notice and its keyboard behaviour (finding 1).
- No-folder state for MCP and skills.sh scope fields.
- Make global conversion state for a workspace MCP server (no workspace-scoped server row in the temp profile).
- Narrow viewport: Electron window is fixed at 1200x774 in this harness; not swept.

## Decisions
- Applied the registry fetch shim only to render the panel (reversible, process-local, in `/tmp`); recorded in Environment.
- Copied `renderer/` with the repo's own `copy-renderer.js`, since `ptah-electron:build` does not do it.
