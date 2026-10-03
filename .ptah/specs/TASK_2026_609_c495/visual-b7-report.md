# Visual B-7 Report - AFTER screenshots (HEAD 7be71f54e) vs B-0 BEFORE (base 21c27d17f)

## Method and environment

- Build: `npx nx build ptah-extension-webview --configuration=development` run in this worktree at HEAD `7be71f54e`; output `dist/apps/ptah-extension-webview/browser`, served by the harness fixture server (`useAppBuild: true`). The build log ends with a successful build (52 s).
- Capture: `b0-capture/after-capture.spec.ts` (new; the B-0 spec is untouched), config `b0-capture/playwright.config.mjs`. Run with `B0_OUT=<task>/screenshots npx playwright test -c <task>/b0-capture/playwright.config.mjs after-capture.spec.ts`. 8 tests, 8 passed on the first run (33 s).
- Same method as B-0: viewport 1280x800 Chromium, `isElectron: true`, in-page RPC auto-responder, theme set via `data-theme` / `data-theme-mode` after load (dark `anubis`, light `anubis-light`). All data is mocked; the real `~/.ptah` was not touched.
- `b0-capture/package.json.disabled` was renamed to `package.json` for the run and renamed back afterwards (verified: directory lists `package.json.disabled`, no `package.json`).
- Only files inside `b0-capture/` were created. No repo source edited, no git commands that change tree or history (`git status` shows only the untracked task folder and `test-results/`, the latter written by Playwright at the worktree root; delete it if unwanted).
- New mock data (all in `after-capture.spec.ts`): `harness:health` / `harness:reconcile` (6 targets: claude source, codex edited + missing, copilot in sync, cursor not detected, opencode in sync + write-failed, antigravity unsupported), `skillSynthesis:listQuarantinedAgents` (quarantined, `source-restored`, no-snapshot, null date, one kept `notOwned` slug, `agentSync` enabled and disabled), `skillSynthesis:getAgentModels`, `agent:listCliModels`, `agent:getConfig`, `wizard:preview-generation`.
- Limits: static screenshots at one viewport (1280x800) in two themes. No narrow-width sweep, no Tab/focus-ring pass, no hover/active captures (one hover artifact is visible by accident), no horizontal-scroll measurement (judged visually only). Contrast was measured by pixel sampling of the screenshot, not by computed style.

## Files captured (all in `screenshots/`, each in `-dark` and `-light`)

| Base name | State |
| --- | --- |
| `after-agents` | Library > Agents tab, full viewport (compare with `before-agents-*`) |
| `after-wizard` | Wizard Select step, Generate button (compare with `before-wizard-*`) |
| `after-agent-card-chips-edited` | Card with chips claude source / codex **edited** / copilot in sync / cursor not detected / opencode in sync / antigravity unsupported |
| `after-agent-card-chips-missing-failed` | Card with codex **missing** and opencode **failed** (with the write-failure reason line) |
| `after-agent-sync-bar` | "Sync provider copies" bar |
| `after-agent-card-not-owned` | Card with the not-owned label ("This workspace has no source file for this agent...") |
| `after-agent-model-inherited` | Model section with inherited rows: "inherits: gpt-5 (lane default)" (Codex) and "inherits: CLI default" (Copilot, OpenCode); Cursor disabled with "Not supported for Cursor agent copies." |
| `after-agent-model-overrides` | Model section with workspace overrides, `listed` and `not in provider list` badges |
| `after-agent-model-edit-form` | Edit form open on an inherited row (scope radios, input, Save/Cancel, machine and whole-workspace copy) |
| `after-quarantine-panel`, `after-quarantine-panel-viewport` | Quarantine panel: `quarantined`, `source-restored` ("restored, not yet synced" + Finish restore), no-snapshot (disabled Restore), "date unknown"; panel crop and full viewport |
| `after-quarantine-restore-confirm` | Restore confirmation modal (agent sync enabled) |
| `after-quarantine-gate-disabled` | Quarantine panel with the gate-disabled copy ("Agent sync is off here...", Finish restore hidden for the `source-restored` row) |
| `after-quarantine-restore-confirm-gate-disabled` | Restore modal with the gate-disabled paragraph |
| `after-reconcile-guard` | Reconcile guard modal from Sync, both groups (snapshotted provider copy, Claude/overwrite-only) |
| `after-wizard-preview-modal` | Wizard preview modal: definite files, "will overwrite", the conditional group ("May also write, if ...", "will overwrite if written") |
| `after-wizard-preview-warning` | Preview modal with the `warning` banner |

34 files total (17 states x 2 themes, counting `after-agents` and `after-wizard`).

## Required states: captured or not

All required states were captured: provider chips including missing and edited (plus failed, not-detected, unsupported, not-synced); reconcile guard modal; quarantine panel including `source-restored` and the gate-disabled copy; not-owned label; model section with an inherited row (both "lane default" and "CLI default" variants); wizard preview modal including the conditional group.

Not captured (not required, noted for completeness): reconcile guard "unverified" variant, quarantine load-error / no-folder / record-unreadable variants, model editor guard-failed / confirm-unlisted / save-failed phases, wizard preview error ("Generate without preview") and "Targets changed" variants, toasts, loading states, focus rings.

## Before / after per theme

### Dark (`before-agents-dark.png` vs `after-agents-dark.png`, `before-wizard-dark.png` vs `after-wizard-dark.png`)

- Outside the Agents grid nothing changed: header, sidebar, Thoth rail, stat tiles, Library tabs, legend, bulk toolbar, divided-only toggle are pixel-identical in layout.
- New: a status line plus "Sync provider copies" button row between the bulk toolbar and the grid; per-card provider chips; per-card model section; quarantine panel below the grid. All render without overlap or clipping at 1280x800 and no horizontal scroll was visible.
- Cards are now much taller (about 2.5x for the first row). The first row's action buttons (Enhance now / Revert / Rebase to upstream / Keep mine) sit below the model section and are not visible at 1280x800 in `after-agents-dark.png` (visible in `before-agents-dark.png`). See defect 2.
- Wizard Select step: identical to before. The preview modal is legible, hierarchy is clear (agent name, definite paths, divider, conditional group), single primary button.
- Contrast and badge legibility in dark look fine (chips, badges, guard modal, quarantine panel).

### Light (`before-agents-light.png` vs `after-agents-light.png`, `before-wizard-light.png` vs `after-wizard-light.png`)

- Same structural result as dark; no layout breakage outside the new elements; wizard Select step unchanged.
- The `text-warning` orange is low contrast on the light surface in the new guard and preview modals (defect 1). Same token already shows in `before-agents-light.png` ("Rebase to upstream", "Keep mine"), so it is a theme-token issue the new surfaces now lean on, not a new regression in existing elements.

## Defects

### Serious

1. **Warning text contrast fails in the light theme on the new surfaces.**
   - Evidence: `after-reconcile-guard-light.png` ("These hand edits will be overwritten."), `after-wizard-preview-modal-light.png` ("will overwrite", "(will overwrite if written)"), `after-wizard-preview-warning-light.png` (warning banner). Sampled text colour #F77F00 on #FAF7F5 gives about 2.46:1 (small 12-14 px text, needs 4.5:1 for WCAG 2.x AA). Dark theme equivalents read fine.
   - Impact: the sentences that warn a user their hand edits or files will be overwritten are the hardest to read in light mode.
   - Fix direction: use a darker warning text token for light (or `text-warning-content` on a tinted background) for these three messages. The token is shared with pre-existing text, so fix it at theme level or give these messages a dedicated class. Re-measure with computed styles to confirm; this figure comes from screenshot pixels.

### Moderate

2. **Card actions pushed below the fold.** `after-agents-dark.png` / `after-agents-light.png` show only chips and the first model rows; Enhance now / Revert / Rebase / Keep mine are no longer visible on the first screen (they were in `before-agents-*`). Cards are about 2.5x taller, and in the 2-column grid at 1280 the model section repeats five provider rows per card. Not broken, but the diverged card's Rebase action (the primary remedy for the highlighted state) is further from the header. Consider collapsing the model section by default or placing actions above it.
3. **Model row layout wraps awkwardly in narrow (2-col) cards.** In `after-agent-model-overrides-dark.png` the `listed` badge drops to its own line under the Claude and Codex values, while the OpenCode row puts the source text on the second line and the badge beside it; row heights and alignment differ per row. Same in `after-agent-card-chips-missing-failed-light.png` (Claude row).
4. **Edit form is cramped in a half-width card** (`after-agent-model-edit-form-light.png`): radio pair, combo input, Save and Cancel plus two paragraphs of copy inside a ~290 px column; the other rows' Edit buttons turn grey while one row is edited. Usable, tight.

### Minor

5. Chips mix filled badges (claude source, codex edited, in sync, failed) with plain text chips (not detected, unsupported, not synced); in dark the plain chips are low-emphasis but readable (`after-agent-card-chips-edited-dark.png`). Consistent with intent, only noted.
6. Disabled Cursor "Edit" in light renders as a grey pill that looks like a filled button (`after-agent-card-not-owned-light.png`).
7. Accidental hover on OpenCode "Edit" is visible in `after-quarantine-panel-viewport-dark.png` (leftover pointer after the model-form step); not a defect, just do not read it as a default state.

## Verdict

NEEDS_REVISION. No visual-breaking issue at 1280x800 in either theme: no overlap, clipping, or overflow; wizard step unchanged; all new states render and are legible. One serious issue (light-theme warning text contrast on the new guard and preview modals) and three moderate layout concerns. Score 7/10. Confidence MEDIUM (single viewport, no focus or narrow-width pass, contrast from pixel samples).
