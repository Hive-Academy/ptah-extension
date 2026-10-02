# Visual Review - Gate V 50 (Advanced and Search & Voice tabs) - TASK_2026_555

Same-side, disclosed: no image-capable CLI lane. This review was written by an in-process visual-reviewer subagent, the same side as the track B authors. Screenshots were read by the model directly. No source file was edited.

## Summary

| Metric | Value |
| --- | --- |
| Verdict | **FAIL** (narrow, cheap fixes; no layout is broken) |
| Equivalent assessment | NEEDS_REVISION: 0 visual-breaking, 6 serious, 6 moderate, 3 minor |
| Overall score | 6/10 |
| Viewports tested | 1: 1024x768 (the Batch 49 capture size; no documented support policy for a second width in the pattern map) |
| Hosts and themes | vscode, electron x anubis, anubis-light (4 combinations) |
| Captures reviewed | 40 committed `current-*` captures plus 14 `gate-v50-*` captures taken here |

Why 6 and not 7-8: the structure, order, fold budgets, focus handling and Esc/backdrop behaviour are sound and evidenced (the 5-6 band: works with real gaps). What separates it from 7-8 is that the explicit Task 50.1 requirement "no `text-error` / `text-warning` / `text-primary` TEXT" is broken in the output-style drawer (D1) and that axe finds contrast, link and target-size failures in this tab's own markup (D2-D4). Why not 3-4: nothing overflows, overlaps or is unreachable, and every failure has a one-line fix.

## Environment

- Build verified: `dist/apps/ptah-extension-webview/browser/main.js` is dated 13:06:57; the newest touched source under `libs/frontend` is 12:50 and `git status` shows no uncommitted source, so the bundle is the one for head `e2032e30a`. No rebuild was needed.
- Served by the harness fixture server (`useAppBuild: true`), Playwright chromium, `--workers=2`.
- Committed scene spec `settings-advanced-search-voice.e2e.spec.ts`: 8 passed (34.7 s). It logged the fold numbers below and "all pass" for Esc-returns-focus and D15 in both hosts.
- Two throw-away probe specs (axe wcag2a/2aa/21aa/22aa, computed text colours, Tab walk, backdrop clicks, target sizes, toast geometry) were created in the harness folder, run, and deleted. `git status` shows no source change.
- Side effect to know about: the scene run rewrote three Batch 49 capture names with different bytes (`current-advanced-mcp-vscode-anubis-light`, `current-search-voice-electron-anubis`, `current-search-voice-vscode-anubis-light`). No new `current-*` name, no `baseline-*` touched. Pixel-level nondeterminism, not a visual change; the orchestrator may restore them.
- Expectation sources: pattern map `pattern-map-advanced-search-voice.md` §1 (P1-P12, deviations 3-6), §2.2, §3.2, `batches.md` Batch 50 Task 50.1. WCAG 2.2 AA is the standard (4.5:1 text, 3:1 UI, 24x24 target) because the repository declares none for these tabs.

## Fold assertions

| Check | Budget | Measured | Result |
| --- | --- | --- | --- |
| §2.2 Membership card height, community | <= 140 px | 80 (vscode), 104 (electron), both themes | PASS |
| §2.2 Agent behaviour card bottom | <= 660 px | 436 (vscode), 532 (electron), both themes | PASS |
| §2.2 no scroll on a fresh tab | 0 | 0 in all four | PASS |
| §2.2 "FAIL if any Agent behaviour row wraps" | rows single line | row heights 43/41/41/58 (vscode), 43/41/57/74 (electron): the Dynamic workflows and Ultracode descriptions wrap to 2-3 lines | **Literal clause not met** (M1); the bottom budget is met with 128 px slack |
| §3.2 provider rows | <= 48 px | 41/41/41 in all four | PASS |
| §3.2 Web search card bottom | <= 660 px | 383 (vscode), 439 (electron) | PASS |
| §3.2 Electron voice rows bottom | <= 660 px | 626 | PASS |

## Defects

Severity names follow the visual-reviewer scale. "Pattern" is what the approved map or WCAG requires.

| Id | Severity | Capture or scene | What is wrong | What the pattern requires |
| --- | --- | --- | --- | --- |
| D1 | Serious | `gate-v50-editor-errors-vscode-anubis-light.png`, `-anubis.png`; source `output-style-editor.component.ts:201`, `:237`, `:311`; `license-status-card.component.ts:357` | Name and description validation messages are `text-xs text-error` TEXT (light: pink on cream, measured 3.57:1; dark 3.84:1, 12 px). The "Turning this off removes the SDK's built-in coding instructions" warning is `text-[10px] text-warning` TEXT (light 2.46:1, 10 px). The user-initials avatar in the licensed state is `text-primary` text (not rendered in any capture because the fixture is the community state). | Deviation 6: colour only on icons, dots, badges; text stays `text-base-content`. Map A25 says the editor's banners and hints move with text `base-content`, colour on border/icon. WCAG 1.4.3 for the three messages. |
| D2 | Serious | `current-advanced-*` (all four); source `agent-behaviour-section.component.ts:137` | "Active for all sessions" is `text-xs opacity-70 text-base-content-muted`: axe 3.1:1 (dark, #6b6768 on #1a1a20) and 2.82:1 (light, #a58f96 on #faf7f5). | 4.5:1 for 12 px text; drop `opacity-70` and use the muted token alone (checked: other muted text passes). |
| D3 | Serious | `current-search-voice-electron-anubis`, `current-search-voice-vscode-anubis`; source `web-search-config.component.ts:168-172` | The "Get API key" links sit in muted 10 px text. They are `link link-hover text-base-content` with no underline until hover, so the only cue is colour at 2.79:1 against the surrounding text (axe `link-in-text-block`, 3 nodes, dark only). | WCAG 1.4.1: 3:1 link-to-text contrast or a non-colour cue. Map V3 prescribes the link class; add an underline or `link` default underline, and raise the free-tier line from 10 px to 12 px. |
| D4 | Serious | `gate-v50-toast-drawer-electron-anubis*.png`; source `elevenlabs-panel.component.ts:215` | The key show/hide button is 22x24 px (axe `target-size`, both themes). | WCAG 2.5.8: at least 24x24 (`min-w-6 min-h-6`, as go vet's switch already has). |
| D5 | Serious | `gate-v50-delete-confirm-electron-anubis.png`, `-anubis-light.png`; source `output-style-list.component.ts:313-333` | The output-style delete confirm is a red-tinted panel (`border-error/40 bg-error/10`) with a solid `btn btn-error` button, rendered inside the Description cell. In Electron it wraps to 5 lines and the filled red button competes with the card's blue "New style". It is a third confirm shape: Web search Clear and ElevenLabs Clear use the P8 outline button, localhost uses an orange outline, delete uses a solid fill. | P8: `rounded border border-base-300 p-3` panel with `btn btn-outline btn-sm border-error text-base-content`; one primary per card. Move the confirm out of the narrow Description cell (full-width row under the style) and use the P8 button. |
| D6 | Serious (marginal, shared token) | every table header in both tabs, light theme (axe, both hosts) | Column headers (`On`, `Setting`, `Value / status`, `Provider`, `Key`, `Direction`, ...) measure 4.45:1 (#7d6e81 on #faf7f5, 12 px), 0.05 under 4.5. Dark passes. | 4.5:1. Likely the shared muted token used by Providers and Orchestration, so fix once in the token if the user agrees; not a Batch 39-50 regression I could prove. |

Moderate and minor:

| Id | Severity | Capture or scene | What is wrong | What the pattern requires |
| --- | --- | --- | --- | --- |
| M1 | Moderate | `current-advanced-electron-anubis`, `-vscode-anubis` | Literal §2.2 FAIL clause: Agent behaviour rows wrap (57 and 74 px in Electron, 58 px in VS Code). The harness asserts only the card bottom, so the clause is unguarded. | Either clamp the descriptions to one line (full text in `title`) or have the map amended; the fold itself passes. |
| M2 | Moderate | Search & Voice Tab walk (all four) | The Max results slider has computed `outline: none` and no box-shadow when focused (`:focus-visible` true). The only change is daisyUI's thumb restyle (pixels differ), which is small against the 16 px track. Every other stop in both tabs (about 45 stops walked) shows a ring. | A visible focus indicator on the range input (WCAG 2.4.7); add a `focus-visible:outline` utility. |
| M3 | Moderate | `current-voice-drawer-elevenlabs-electron-anubis-light` | The "Replace key" input placeholder is clipped ("Enter a new key to repla") by the eye button and the Test connection and Save buttons. | Shorter placeholder or a wrapping action row. |
| M4 | Moderate | `current-advanced-electron-anubis*` | Output style rows are 75-85 px in Electron because the Description cell is narrow and the "Built into the agent - Ptah can select it but not change it." note repeats on every built-in row. The `table-xs` class is present but the density intent is lost. | Move the note to the disabled-button `title`/one table caption. |
| M5 | Moderate | `gate-v50-import-confirm-vscode-anubis-light.png` | When the Import confirm opens, the status badges drop below the confirm panel and the card grows past the 140 px budget; the order reads oddly. Only in the confirm state. | Render the confirm after the badge row. |
| M6 | Moderate | `current-voice-drawer-*`, `current-advanced-*-drawer-*` | Drawer panels measure 512 px wide; the pattern map P6 says 460 px. Same panel as Providers' drawer? Not verified. | Confirm against the shipped Providers drawer; if both are 512 the map line is stale. |
| m1 | Minor | `current-go-vet-electron-anubis*` | go vet description is smaller than sibling card descriptions (12 px against 14 px). | Match the card sub-line size. |
| m2 | Minor | `current-advanced-vscode-anubis*` | Primary-less cards (Web search, Voice engines, VS Code LM) are fine, but the Membership card shows five buttons of four styles in one row. | Optional: keep Export/Import in the overflow group. |
| m3 | Minor | `current-advanced-mcp-localhost-confirm-electron-anubis` | The "Allow localhost" confirm button has an orange (warning) outline; the other confirms use red. | One colour for confirms. |

## Check-by-check answers

- **One primary action per card.** PASS. Advanced: Create Account (Membership), New style (Output style), Save in MCP & browser is `btn-primary` but disabled until the port changes; Agent behaviour and VS Code LM have none. Search & Voice: Web search and Voice engines have none (Test connection is outline, as map V6); go vet's `btn-primary` exists only inside the open confirm. Drawers: Save style, and the ElevenLabs Save (disabled), each alone in its drawer.
- **Structure and order.** PASS. Advanced: Membership & data, Agent behaviour (system prompt, chat reasoning effort, dynamic workflows, Ultracode), Output style (matrix, parity `<details>` closed, footer note), MCP & browser (policy bar then namespace matrix with Allow localhost), VS Code language model. Search & Voice: Web search (matrix, max-results bar), Voice engines matrix, Diagnostics go vet. "Workflows require a paid plan" and the preset radios are absent (PR-1 and PR-2 applied).
- **table-xs density.** All 6 tables on the tabs and the 5 inside the voice drawer carry `table table-xs`. Web search rows 41 px. Output style Electron rows exceed it (M4).
- **No coloured text.** Resting state of both tabs in both hosts and themes: no `text-primary/error/success/warning/info` on any text node (the scanner reports only base-content, muted and the `btn-primary` label). Failures are the on-demand states in D1. Icons, dots, badge borders use colour as allowed.
- **Existing red-outlined "Clear" buttons.** They do not break deviation 6 as written: the label is `text-base-content` (class verified on the Web search and ElevenLabs Clear buttons) and only the border is red, which is exactly the P8 shape in the map. They do bend the intent: P8 puts the red outline on the confirm button, whereas here the resting trigger is red-outlined on every key row (two on Web search, one in the ElevenLabs drawer). Listed for the user's decision.
- **Focus visible.** PASS with M2. Tab walk of Advanced (22 stops) and Search & Voice (up to 24 stops), both hosts and themes: every stop has a ring except the slider. Focus rings are visible on the Details chevron (dark) and Edit pencil (light) captures.
- **Esc and backdrop.** PASS. Esc: the committed scene covers 10 Advanced and 5-6 Search & Voice overlays per host (system prompt drawer, membership key popover, import confirm, effort popover, new and edit output-style drawers, delete confirm, localhost confirm, web key popover, Clear confirm, voice provider popover, voice drawers, ElevenLabs Clear confirm, go vet confirm) and reports "all pass" for focus return in both hosts. Backdrop (my probe, click at 30,700): system prompt drawer, output-style drawer, effort popover, membership key popover, web key popover, voice provider popover and voice drawer all close and focus returns to the opener in every combination run. Inline confirms have no backdrop by design.
- **go vet and voice hidden on VS Code.** PASS: `ptah-voice-config` count 0 and `go-vet-consent-card` count 0 on both VS Code themes; 1 and 1 on Electron. VS Code capture sets contain no voice-drawer or go-vet files, which is correct.
- **Light-theme contrast / axe.** axe wcag2a+2aa+21aa+22aa on both tabs, four combinations, plus open parity, drawer and go vet states: no `nested-interactive`, no `aria-*`, no label or name violations. Failures are D2, D3, D4, D6; the shell items (workspace sidebar text, rail label) are outside this task and are not counted.
- **Toast does not cover drawer footers.** PASS. In the voice drawer after a write the toast spans x 729-1000, y 610-656; the footer Close spans y 724-756; no overlap (`gate-v50-toast-drawer-electron-anubis*.png`). On the go vet confirm the toast covers only empty right-hand space.
- **Prototype fidelity.** MATCHES the approved patterns at the pattern-map level (P2, P3, P4, P5, P6, P9, P10, P12, drawer footer actions, one primary). Deviations are D5 (P8 shape), the 512 px drawer (M6) and the pending items below. There is no Gate 1.7 prototype for these two tabs (task decision of 2026-09-30).

## Items for the user's review

1. Accept the two cheapest options for D1: remove the colour from validation and warning text (icon plus `text-base-content`), including the licensed-state initials avatar.
2. Table-header contrast (D6): amend the shared muted token by 0.05, or accept 4.45:1 across all four tabs.
3. M1: clamp the Agent behaviour descriptions to one line, or relax the §2.2 "row wraps" clause (the fold passes with 128 px slack in the worst case).
4. Are red-outlined resting "Clear" buttons wanted, or should the red appear only on the confirm button (P8)? And should all confirm buttons share one shape (D5, m3)?
5. Drawer width 512 px against the map's 460 px (M6): which is canonical?
6. Not rendered in any capture and therefore not measured: licensed-state membership card, key-not-active alert, Test connection result lines, output-style banners (collision, fallback, invalid files), voice download progress and ElevenLabs error/Retry states, go vet stale and error alerts. Run them in the Batch 37 close-out if their colour usage matters.

## Verdict

- Recommendation: REVISE (gate result FAIL; re-run Task 50.1 after D1-D5, which are one-line class changes plus one layout move)
- Confidence: HIGH on the measured items (folds, axe, focus, backdrop, geometry); MEDIUM on D6 provenance and M6; LOW on the unrendered states in item 6.
- Key concern: coloured TEXT in the output-style editor drawer (D1) breaks the user-requested deviation 6 and, in the light theme, fails contrast at 2.46-3.57:1.
