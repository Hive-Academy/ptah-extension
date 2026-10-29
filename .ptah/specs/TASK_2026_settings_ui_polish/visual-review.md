# Visual Review - TASK_2026_settings_ui_polish (round 3, final)

## Summary

| Metric            | Value                                                        |
| ----------------- | ------------------------------------------------------------ |
| Overall score     | 7/10                                                         |
| Assessment        | NEEDS_REVISION                                               |
| Visual breaking   | 0                                                            |
| Serious           | 3                                                            |
| Moderate          | 4                                                            |
| Viewports tested  | 2 (1024x768, 1440x1000) x 3 themes (anubis-light, anubis, ptah-glass) |
| Screenshots taken | 57 (`screenshots/after-r3/`)                                 |
| Components tested | Main agent section, Connections, CLI matrix, Reassign popover, catalog modal, Context Management tab, focus rings (4 targets) |

## Environment

- Real Electron (`_tmp-settings-after-shots.spec.ts`, Playwright `_electron`), the app already built from this worktree. Run through `node scripts/verify.mjs --exec --task settings-shots`.
- Workspaces panel open. Window resized with `BrowserWindow.setContentSize`.
- Mocks: `baseSettingsFixtures()` plus `config:getScopes`, `provider:listAccounts`, `provider:getModelTiers`, `settings:get` (all keys), `workspace:getInfo`. Mutating resolvers are no longer evaluated (see Decisions).
- Themes: `ptah-theme-v2` in localStorage, then a reload. Glass: `data-glass="on"`, `data-glass-mode="dark"` was asserted and logged. Light and dark have no `data-glass`.
- Unmocked RPCs seen (shell/chat only, none in the Settings regions): `chat:*`, `config:models-list`, `config:pricing-get`, `config:autopilot-get`, `update:get-state`, `boot:getReadiness`, `attention:getSnapshot`, `session:list`, `git:*`, `provider:getPlanLimits`, `plugins:*`, `wizard:list-analyses`, `analytics:spendSummary`, `indexing:getStatus`, `tasks:board`, `memory:stats`, `cron:list`, `gateway:*`, `provider:getAmbientClaudeStatus`. No region of the Providers or Context tabs is left in skeleton/error state. The `[role=alert]` count is 0 visible alerts.
- Console noise unrelated to Settings: 11x `ModelStateService Failed to load models`, `RecentSessionsStore`, `UsageVitalsCache`, 3x `Cannot read properties of undefined (reading 'state')` (shell, not Settings).
- The viewport set is an audit selection (1024 and 1440 are the widths named in the task), not a support contract.

## Decisions

- Open problems 2 and 3 were test-harness artefacts. My capture spec `buildMocks()` called every stateful resolver with `{}`, including `ptahCli:create`. That pushed a nameless agent `created-2` into the fixture state, so `connectionUsage()` (`connection-usage.ts:113`, `agent.providerId.trim()`) threw in every change detection pass (59 `Cannot read properties of undefined (reading 'trim')` errors) and the connection cards rendered empty. Evidence: the `DUMP` of `state.cliAgents()` showed `{id:'created-2'}` with no `providerId`. After skipping mutating resolvers the cards were populated on first mount (`FIRSTMOUNT` = Claude (Subscription), Kimi Code, OpenAI Codex, Ollama Cloud, sovereigneg, in all 3 themes). Not a branch defect. Reversible: only the temp spec changed.
- "Add Ptah CLI Instance" is enabled in light with full mocks (`isDisabled()` = false in all 3 themes). The earlier faded look was the old `!canWrite()` mock gap.

## Findings by severity

### Visual breaking

None.

### Serious

#### 1. Glass theme at 1024 px: the CLI matrix is clipped by 22 px and the Actions column is cut off

- File/class: `libs/frontend/chat/src/lib/settings/ptah-ai/cli-orchestration-matrix.component.ts` (table wrapper, `overflow-x-auto`) inside the glass `chrome` card. The glass card padding and frame leave the wrapper narrower than the table.
- Viewport: 1024x768, ptah-glass only. Measured table `scrollWidth` 613 against wrapper `clientWidth` 591 (light and dark: 631 and 631, no overflow). 1440 is fine in all themes (1007/1007).
- Screenshot: `providers-glass-1024x768-p2.png`. The header reads "ACTION", the Glm row's Tiers/Test/... buttons are clipped to ".." and the table scrolls horizontally.
- Problem: the matrix does not fit when the Workspaces panel is open in glass. The row actions (Tiers, Test, Delete menu) are not reachable without a horizontal scroll inside the card.
- Also seen in that shot: an extra horizontal scrollbar at the bottom of the Settings scroller at 1024 in glass (`providers-glass-1024x768-p1/p2/p3.png`, catalog and popover shots). Light and dark show none.
- Fix: size the matrix to the glass card (a smaller `px` on the matrix card, or `table-fixed`/narrower columns at that container width), so it has at least 22 px of slack. Check it with `wrapScrollW <= wrapClientW`.

#### 2. Size scale: all badges still render at 10 px, which breaks "no 10/11 px text"

- File/class: `apps/ptah-extension-webview/src/styles.css:1999-2004` (global `.badge { font-size: 10px; height: 16px }` and `.badge-xs { 9px }`). It is an unlayered rule, so it beats the Tailwind `text-xs` that the components carry (`main-agent-section.component.ts:63`, `provider-connection-card.component.ts`, the matrix badges).
- Viewports: all. Measured on the Providers tab: 29 to 34 text elements below 12 px per theme/size. Examples: `Active`, `Workspace override`, `5 configured · 10 available in catalog`, `CLI`, `OAuth`, `API key`, `Custom`, `Ready`, `Full auto`, `Key set`, `Ptah CLI`, tier chips. The Context tab has none. In glass at 1024, `not reachable` renders at 9 px and `Retry` at 11 px.
- Screenshots: `providers-light-1024x768-p1.png`, `providers-dark-1440x1000-p1.png`.
- Fix: in the Settings badges use a size the global rule cannot override (`!text-xs !h-auto`, or scope the rule with `:not(.text-xs)`). Better, make `.badge`'s 10 px sidebar-only (`.sidebar .badge`). The second option touches app CSS outside the stated scope, so the product owner decides.

#### 3. btn-xs is still in many Settings controls (Providers tab: 3 visible, plus the Advanced, Search & Voice and Output styles tabs)

- Files (none touched by this branch): `ptah-ai/copilot-auto-approve-toggle.component.ts:47`, `providers/decision-model-row.component.ts:198` and `decision-model-key-field.component.ts`, `providers/add-cli-instance-modal.component.ts`, `providers/cli-tier-mapping-modal.component.ts`, `providers/connection-drawer/*-tab.component.ts`, `ptah-ai/cli-model-effort-popover.component.ts`, `ptah-ai/{elevenlabs,local-stt,local-tts,voice-config,web-search-config}`, `output-style/*`, `pro-features/*`.
- Measured: `.btn-xs` in `ptah-settings`: 3 on the Providers tab (every theme and size), 0 on Context Management. Not measured on the other tabs.
- Problem: against the task goal "no btn-xs", the Providers and Context tabs are mostly clean, but the Providers tab still shows 3 (copilot toggle, 2 decision-model row buttons). The other tabs were out of the capture scope.
- Fix: switch the 3 Providers-tab buttons to `btn-sm`. Decide whether the other tabs are in scope, or record it as follow-up.

### Moderate and minor

- Moderate: the Reassign popover title truncates ("Reassign main ...") at 1024 next to "Check connection" (`popover-*-1024x768.png`, `main-agent-reassign-popover.component.ts` header). Give the title room or move the link.
- Moderate: the "Context Management" tab label truncates at 1024 ("Context Managem...", `providers-*-1024x768-p1.png`) and the "Runs 100% locally..." line truncates. Use `min-w-0` with a smaller gap, or let the label wrap.
- Moderate: at 1024 the matrix switches to a stacked layout (the Status and Provider columns fold under the name, the order strip shows "1. Codex -> +5"). The Provider column is gone, so the provider is only an icon (`providers-glass-1024x768-p2.png`). Add the provider name or a tooltip.
- Moderate (unverified measurement): the contrast probe reported 1.32:1 (Reassign) and 1.39:1 (Connect provider) on glass. The probe hides the text by setting `color: transparent`, and the buttons keep a gradient/inset-shadow face, so this is most likely a probe artefact. Screenshots show dark ink on amber. A direct computed-colour check is still needed.
- Minor: leftover "Loading CLI agents... / Loading CLI instance models... / Loading delegated CLI models..." lines were seen under the matrix in the pre-fix run (`agent:listCliModels` unmocked at the time). They are a mock gap, but they render as unstyled text in the page, so give them a muted `text-sm` style if they can show in production.
- Note (out of scope, as agreed): raw `content` cards on the Advanced and Search & Voice tabs stay non-blurred next to blurred `chrome` Settings cards.

## Prototype fidelity

- Approved prototype: none in this task folder (design-spec.md only). Compared with `design-spec.md` and the user's round-2 correction.
- Fidelity assessment: MATCHES for the Main agent section and Connections. DEVIATES for the 10 px badge text (finding 2).
- Before/after (dark/light/glass): `screenshots/before/` was captured in the harness, not the real shell, so the pairs are indicative only. After pairs: `providers-light-1440x1000-p1.png`, `providers-dark-1440x1000-p1.png`, `providers-glass-1440x1000-p1.png`. No regression in light or dark.

## Check results (the six requested checks)

1. Main agent: `main-agent-section` sits first on the Providers tab. At 1024 it starts at y about 165 and is 115 px tall. The Provider "Claude (Subscription)" is 16 px semibold and the Model is 14 px mono. Badges (Active, Workspace override) and the "Operational" pill are on the same row. Reassign is the only primary action: `btn btn-primary btn-sm`, 95x32 px, with a 2 px outline on focus-visible. No `Routing map`, `Background roles` or `CLI agents & matrix` tiles were found (`LEFTOVER`: 0 nodes and no text, in all themes). PASS.
2. Open problems 2 and 3: see Decisions. Not defects.
3. Glass: `data-glass="on"`, mode dark. Section cards carry `data-glass-surface="chrome"`. The host has `background: transparent` and no `backdrop-filter`. The blur and fill live on `::after` (`styles.css:2890`, `--glass-filter`). Cards read as translucent over the scene gradient. The scene behind is a soft gradient, so the blur is not distinguishable by eye. Text contrast (ink against the effective background, hidden-text probe, 30 elements at 1440): light min 5.39, dark min 5.65, glass min 10.03 on all body and label text, so all above 4.5:1 (the two glass button values are described above). Reassign popover (`topmostInside` = [true,true,true,true] in all 3 themes, `popover-*.png`) and the catalog modal (1014x768, centre hit test inside, `catalog-modal-*.png`) are above the next card, and no card paints over them. PASS.
4. CLI matrix: light and dark at 1024 with Workspaces open: table 631 into 631, no overflow. At 1440: 1047/1047 (light/dark) and 1007/1007 (glass), readable. Glass at 1024: FAIL, see finding 1. `docOverflow` = 0 everywhere.
5. Size scale: partial. `btn-xs`: 0 on Context Management, 3 on Providers (finding 3). 10 px text from the global `.badge` rule (finding 2).
6. Light/Dark regressions: none found. Focus: Reassign, Connect provider, a connection row and a matrix control all show a 2 px solid outline in the three themes (`focus-*.png`, `:focus-visible` true). The outline colours are `oklch(0.236 0.066 313)` light, `oklch(0.925 0.007 88)` dark and `oklch(0.961 0.001 106)` glass.

## Viewport results

| Screen | Size | Light | Dark | Glass | Screenshots |
| ------ | ---- | ----- | ---- | ----- | ----------- |
| Providers | 1024x768 | OK (badge text 10 px) | OK (same) | matrix clipped 22 px, h-scrollbar | `providers-{light,dark,glass}-1024x768-p1..p3` |
| Providers | 1440x1000 | OK | OK | OK | `providers-*-1440x1000-p1..p2` |
| Context Management | 1024x768 | OK | OK | OK | `context-*-1024x768-p1..p5` |
| Context Management | 1440x1000 | OK | OK | OK | `context-*-1440x1000-p1..p3` |

## Component and interaction results

| Component | States tested | Status | Screenshot |
| --------- | ------------- | ------ | ---------- |
| Reassign popover | open, z-order, escape | OK (title truncates) | `popover-*-1024x768.png` |
| Catalog modal | open, z-order, esc | OK | `catalog-modal-*-1024x768.png` |
| Focus rings (4 targets) | focus-visible | OK | `focus-*-*-1024x768.png` |
| Add Ptah CLI Instance | enabled | OK | `providers-light-1440x1000-p2.png` |

## Design system compliance

- Glass roles: chrome for section cards and tile for nested blocks, as the user decided. No new tokens.
- Type scale: expected `text-xs` (12 px) floor, observed 10 px (and 9 px) from `styles.css:1999`.

## Accessibility audit

- Contrast: see check 3 (all above 4.5:1 except the unverified glass buttons).
- Target size: Reassign 95x32, Connect provider about 34 px high, both above the 24x24 AA minimum.
- Focus order and ring: visible on every target tested.

## Visual performance

- No layout shift was observed after first mount once the mocks were complete. Skeletons were not captured (they cleared before the 5 s settle).

## Verdict

- Recommendation: REVISE (NEEDS_REVISION, 7/10)
- Confidence: MEDIUM-HIGH
- Key concern: the glass theme at 1024 px with the Workspaces panel open clips the CLI matrix by 22 px and cuts off the row actions. The global `.badge { font-size: 10px }` also defeats the "no 10/11 px text" goal.
- Housekeeping: the `_tmp-*` spec files in `apps/ptah-electron-e2e/src/specs/settings/` still exist and must be deleted before commit. `.ptah/specs/TASK_2026_555` was not changed by this run (git status clean).

---

## Round 3 fix re-check

Captured with `_tmp-fix-shots.spec.ts` (copy of the round-3 spec, real Electron, locked run) into `screenshots/after-r3-fix/`. Same mocks, same 3 themes, 1024x768 and 1440x1000. Light, dark and glass all ran. `.ptah/specs/TASK_2026_555` was not touched.

| # | Fix | Result | Evidence |
| - | --- | ------ | -------- |
| 1a | Glass 1024 matrix, table width vs wrapper | FIXED | table 591 / wrapper 591 (was 613 / 591). The Actions header is fully visible and the Glm row menu "..." is visible (`providers-glass-1024x768-p2.png`). Tiers and Test are no longer inline at this width (their rects are 0-0 in all themes at 1024), so they must be reachable through the "..." menu. I did not open that menu. |
| 1b | No horizontal scrollbar on the Settings scroller in glass at 1024 | NOT FIXED | `scrollerOverflowX` = 39 px in glass 1024 only. The bottom scrollbar is still visible in `providers-glass-1024x768-p1/p2.png`. Light and dark are 0. The matrix is no longer the cause; some other element in the glass layout is 39 px too wide (find the element where `scrollWidth > clientWidth` under the scroller). |
| 1c | Light and dark at 1024, and all themes at 1440 | OK | light/dark 1024: 631/631, scroller overflow 0. 1440: 1047/1047 (light, dark), 1007/1007 (glass), overflow 0. The Actions header and the Tiers/Test/menu buttons are all on screen at 1440 (for example glass Glm row: Tiers 1195-1242, Test 1246-1288, menu 1292-1324, wrapper right 1333). |
| 2a | Copilot "Check saved setting again" no longer btn-xs | FIXED | it is gone from the `.btn-xs` list. |
| 2b | btn-xs on the Providers tab | PARTIAL | still 3: `add-cli-instance-modal` and `cli-tier-mapping-modal` (closed modals present in the DOM) and a visible "Retry" in `decision-retry` (decision-model-row, 38x24 px). Switch the Retry to `btn-sm` (and the two modals, if they count as Settings). |
| 2c | Decision-model Close, beside the label, btn-sm btn-square, no overlap with the select | NOT VERIFIED | the Close button only appears when the row is in its open state, which my capture did not reach. In the closed state the row's select/button (318x32) and Retry (38x24) do not overlap (`decision-row-*-1024x768.png`). |
| 3a | Reassign popover title | FIXED | panel 336 px wide (21rem); the title "Reassign main agent" has `scrollWidth - clientWidth` = 0, not truncated, in all 3 themes (`popover-*-1024x768.png`). Hit test: still above the next card ([true,true,true,true]). |
| 3b | "Context Management" tab label wraps | OK | light and dark at 1024: one line, height 37, no overflow. Glass at 1024: the label wraps to two lines and the tab row grows from 37 to 53 px, icon left of the text (`providers-glass-1024x768-p1.png`). It looks acceptable but it is a taller row than in the other themes. |
| 4 | Glass button contrast measured on the button face | CONFIRMED artefact | direct measurement (computed text colour against the sampled face pixel): glass Reassign 10.64:1, Connect provider 10.53:1; light 6.81:1 (both); dark 4.82:1 (both, white on blue). The earlier 1.32 and 1.39 readings came from the hidden-text probe, so that probe still shows glass min 1.32 and should be ignored. |

Still open from round 3 (unchanged by these fixes):
- Serious: the global `.badge { font-size: 10px }` (`apps/ptah-extension-webview/src/styles.css:1999`) still makes 30 to 31 text elements per theme render below 12 px on the Providers tab (`smallCount` 30/31).

### Updated findings

- Serious: glass 1024 horizontal scroll of 39 px on the Settings scroller (1b).
- Serious: 10 px badge text (carried over).
- Moderate: one visible btn-xs "Retry" in `decision-model-row.component.ts` (plus two closed modals).
- Moderate: truncated "Runs 100% locally..." line at 1024 (unchanged); matrix at 1024 has no Provider column text (icon only).
- Resolved: glass matrix clipping (round-3 finding 1), popover title, Copilot btn-xs, glass button contrast (artefact).

### Updated verdict

- Score: 7.5/10 (was 7).
- Assessment: NEEDS_REVISION (REVISE). No visual-breaking issues. Two serious issues remain: the 39 px glass scroller overflow at 1024 and the 10 px badge text.
- Confidence: MEDIUM-HIGH. The decision-row Close overlap check is not done.
- Housekeeping: delete `_tmp-fix-shots.spec.ts`, `_tmp-settings-after-shots.spec.ts` and `_tmp-fixtures-copy.ts` before commit.

---

## Round 4

Captured with `_tmp-r4-shots.spec.ts` (real Electron, locked runs) into `screenshots/after-r4/`: light, dark and ptah-glass (`data-glass="on"` asserted; light and dark have none), at 1024x768 with Workspaces open and 1440x1000, on Providers, Context Management, Advanced and Search & Voice. One extra glass capture with zero Ptah CLI instances (`empty-state-glass-1440x1000.png`). The first light and dark runs used a window that did not shrink to the requested size. I fixed the resize helper in the temp spec and re-ran both, so the figures below are from the corrected runs. `.ptah/specs/TASK_2026_555` was not touched.

| # | Check | Result | Evidence |
| - | ----- | ------ | -------- |
| 1a | System CLI table, hairline, "Ptah CLI instances" heading, one explanation line, one card per instance | PASS | `providers-glass-1024x768-p3.png` and `empty-state-glass-1440x1000.png`. The Glm card shows name, provider, Ready and Key set, toggle, Model (Direct, Effort), "Last test: Not run yet", "MODEL TIERS · 3 of 3 set" with Sonnet/Opus/Haiku chips, Tiers, Test, "...", and an Add button next to the heading. |
| 1b | Overflow at 1024 and readability at 1440 | PASS | matrix table/wrapper: light 631/631, dark 631/631, glass 591/591 at 1024; 1047/1047, 1047/1047, 1007/1007 at 1440. `ptah-cli-instances` descendants past its right edge: 0 in every theme and size. |
| 1c | Focus rings on instance actions | PASS | `:focus-visible` true with a 2px solid outline on Tiers, Test, "..." and the toggle in all 3 themes (`focus-tiers-*`, `focus-toggle-*`). The toggle has no box-shadow in light and dark; the outline is its ring. |
| 1d | Empty state | PASS | text "No Ptah CLI instance yet. Add one to give the orchestrator another lane on a provider you already connected." plus an "Add Ptah CLI Instance" button. The testid `cli-matrix-add` is absent in this state (the button has another testid), so it does not collide with the populated card. |
| 2 | Glass page background | PASS | in glass no ancestor of `ptah-settings` paints a background (all four tabs: empty fill list). The scene gradient shows behind the blurred chrome cards (`context-glass-1440x1000-p1.png`, `advanced-glass-1440x1000-p1.png`). Light and dark keep solid `bg-base-100` (oklch 0.978 and 0.189). Header and tab bar contrast (hidden-text probe, 1440): light 5.46 to 15.92; dark 5.65 (tab labels) to 14.86; glass 9.79 to 14.63. |
| 3 | Settings scroller `scrollWidth` / `clientWidth` | PASS | 1024: light 730/730, dark 730/730, glass 690/690. 1440: 1146/1146 in all three. Document overflow 0. No overflowing ancestors. |
| 4a | `.btn-xs` on the Providers tab | PASS | 0 in all themes and sizes (including the decision Retry and the two modals). Remaining btn-xs are on Advanced and Search & Voice (known, out of scope). |
| 4b | Decision-model open state, Close vs select | PASS | Close is `btn btn-ghost btn-sm btn-square`, 32x32, overlap with every other control in the editor 0 px in all 3 themes (`decision-open-*-1024x768.png`). |
| 4c | Add Ptah CLI Instance modal and Tiers modal in glass | PASS | both open above the page (hit test at the modal centre inside the dialog), 0 btn-xs inside, 1014x768 backdrop (`modal-add-glass-1024x768.png`, `modal-tiers-glass-1024x768.png`). "Add Ptah CLI Instance" is enabled in all themes. |

### Remaining findings (none serious)

- Moderate: the Sonnet/Opus/Haiku tier chips truncate the model name at 1024 ("glm-5.3:cl..."), so the model is not readable without the Tiers modal (`providers-glass-1024x768-p3.png`). Give the chips two lines or a title/tooltip.
- Moderate: the connection card sub-line truncates the provenance text before "Used by N" ("CLI su...", "OA...", `empty-state-glass-1440x1000.png`). Truncate the "Used for" part first.
- Minor: the glass tab row is taller at 1024 than in light and dark (the "Context Management" label wraps), noted in the previous section.
- Minor: the contrast probe reports 2.46 (dark) and 1.00 (glass) for the "Runs 100% locally." container. This is a probe artefact on the element that wraps the green dot. The text itself measures 14.86 (dark) and 13.20 (glass).
- Known, out of scope: the global `.badge { font-size: 10px }` rule; btn-xs on the Advanced and Search & Voice tabs; the raw `content` cards on Advanced and Search & Voice stay non-blurred next to the blurred chrome cards.

### Updated verdict

- Score: 8.5/10 (was 7.5).
- Assessment: APPROVED. No visual-breaking and no serious issues remain in scope. The glass 1024 scroller overflow is 0, the matrix fits in all themes and the instance cards do not overflow.
- Confidence: HIGH for layout and overflow. MEDIUM for the glass blur, which cannot be told apart by eye over a soft gradient (the fill and filter are on the `::after` layer per `styles.css:2890`).
- Housekeeping: delete `_tmp-r4-shots.spec.ts`, `_tmp-fix-shots.spec.ts`, `_tmp-settings-after-shots.spec.ts` and `_tmp-fixtures-copy.ts` before commit.

---

## Round 5

Captured with `_tmp-r5-shots.spec.ts` (real Electron, locked run via `verify.mjs --exec --task settings-shots`, 3 passed) into `screenshots/after-r5/`: light, dark, ptah-glass (`data-glass="on"` asserted), at 1024x768 with Workspaces open and 1440x1000. `.ptah/specs/TASK_2026_555` untouched.

| # | Check | Result | Evidence |
| - | ----- | ------ | -------- |
| 1 | Main agent + Connections in one card | PASS | `providers-main-connections-card` contains `providers-connections-card` (true in all 6 runs). Hairline: `border-t` 0.67px, light oklch .916, dark oklch .266, glass rgba(255,255,255,.06). Visible in `providers-light-1024x768-p1.png` and `providers-glass-1440x1000-p1.png`; faint in glass and dark (see Minor). Reassign popover at 1024: 336x375 px dialog, 3 of 3 hit-test points inside the dialog in all themes (`reassign-*-1024x768.png`). |
| 2 | Context Management matches Providers | PASS | First card L/R: Providers = Context in every theme and size (light/dark 284-950 at 1024, 284-1366 at 1440; glass 308-934 / 308-1350). Diff 0 px. Context top offset equals Advanced (122 / 126 px; glass 156 / 144). Section titles on Context: 16px / 600, same as Providers. |
| 3 | Advanced py-3 | PASS | Advanced first block top equals Context (122 px at 1024, 126 at 1440) and has the same L/R. Search & Voice sits 12 px higher (110 px), as intended by the fold budget. |
| 4 | Connection sub-lines | PASS (with a nit) | First segment no longer collapses (`sub` clientWidth 92 to 100 px, none clipped). Lines wrap between segments: "CLI subscription · Used by 2" then "· Used for: Main agent, Enhancement" (`providers-light-1024x768-p1.png`). Rows are 65 or 77 px tall; at 1024 each row is full width, so alignment is clean. |
| 5 | Ptah CLI tier chips | PASS | At 1024 the 3 chips ("glm-5.3:cloud") are 32 px tall, none clipped (`scrollWidth <= clientWidth`), parents 57 px, equal. At 1440 they are 16 px, equal. |
| 6 | Regressions | PASS | Settings scroller scrollWidth == clientWidth in all themes and sizes (730/730, 690/690 glass; 1146/1146, 1106/1106 glass); document overflow 0; ancestors none. Providers `.btn-xs` = 0 in every run. Glass: scene gradient visible around and behind the chrome cards (`providers-glass-1440x1000-p1.png`), no opaque page fill. Light and dark fine. |

### Findings (none serious, none visual-breaking)

- Moderate: at 1440 (2-column connection grid) a short row stays shorter than its row neighbour. Kimi Code (65 px) sits beside Claude (77 px), so bottoms are ragged (`providers-glass-1440x1000-p1.png`, `providers-light-1440x1000-p1.png`). Likely the grid wrapper in `providers-settings.component.ts` (add `items-stretch`, or put `h-full` on `provider-connection-card`).
- Minor: a wrapped sub-line starts with a leading separator dot ("· Used for: ..."), at `provider-connection-card.component.ts` near line 80. Hide the separator when the segment is first on its line, or drop it and rely on the wrap.
- Minor: the hairline between Main agent and Connections is faint in glass (rgba white .06) and dark (oklch .266 on a similar card). It is visible but low contrast (under 1.3:1); raise it to `border-base-300/…` or a glass border token if a clearer divider is wanted.
- Known, out of scope: global `.badge { font-size: 10px }`; btn-xs on Advanced and Search & Voice (4 each); non-blurred `content` cards on Advanced and Search & Voice.

### Updated verdict

- Score: 8.7/10 (was 8.5).
- Assessment: APPROVED. All six requested changes verified with measurements. No visual-breaking and no serious issues.
- Confidence: HIGH for layout, overflow and hit-testing. MEDIUM for glass hairline visibility (by eye).
- Housekeeping: delete `_tmp-r5-shots.spec.ts`, `_tmp-r4-shots.spec.ts`, `_tmp-fix-shots.spec.ts`, `_tmp-settings-after-shots.spec.ts` and `_tmp-fixtures-copy.ts` before commit.

## Round 6

Electron only, via `_tmp-r5-shots.spec.ts` (output folder switched to `after-r6`, Providers tab only). Screenshots: `screenshots/after-r6/providers-{light,dark,glass}-{1024x768,1440x1000}-p*.png`. Playwright run: 3 passed, under the verify lock.

| Check | Result | Evidence |
| --- | --- | --- |
| 1. Usage sub-line (`used-by-segment`) | PASS, one Minor | Sub-line is at most two lines. No wrapped line starts with "·". Long text truncates with an ellipsis ("Used for: Main agent, Enhan…", "Glm (Ptah CLI ag…") at 1440 in `providers-dark-1440x1000-p1.png`. The title attribute was not probed. |
| 2. Equal row bottoms at 1440 | PASS | Measured: Claude and Kimi both at top 441, 78 px tall; Codex and Ollama both at top 527, 78 px tall. Pairs end on the same bottom edge. The odd last row (66 px) is alone. |
| 3. Hairlines | PASS | Main agent / Connections hairline is visible but quiet in light, dark and glass (glass computed: 1px oklch(.96 / .15)). The hairline above "Ptah CLI instances" shows in `providers-dark-1440x1000-p2.png`. |

Findings:
- Minor: the subtitle keeps a trailing separator at the end of line 1 when usage drops to line 2 ("CLI subscription ·", "OAuth ·", "Key stored locally ·"). It is a dangling dot, not a leading one. Screenshot: `providers-light-1024x768-p1.png`. Suggested fix: render the "·" inside the usage segment only when it shares a line, or drop it.
- No Blocker or Major findings. No horizontal overflow (docOv 0, no ancestor scrollers). The reassign popover hit tests pass.

Verdict: APPROVED.

`git status --short .ptah/specs/TASK_2026_555` is empty.
