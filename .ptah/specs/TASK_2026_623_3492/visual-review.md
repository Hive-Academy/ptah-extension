# Visual Review - TASK_2026_623_3492 (Batch 33, Task 33.3 / V1)

Verdict: FAIL (one serious defect D1 that makes the Displays/Agents tabs stack; one serious narrow-width wrap D2; V1 is only partially exercised, see "Not exercised")

Environment: built Electron app (dist/apps/ptah-electron), attached over CDP 127.0.0.1:9333, renderer file:///.../dist/apps/ptah-electron/renderer/index.html. No rebuild, no relaunch. App window is 892x735 (tiled chat tiles are ~184-292 px wide). Provider is rate limited (HTTP 429, ollama session usage limit visible in session "Session 10/2/2026"), so no new agent turn could be generated. Content comes from existing sessions (116 Read, 125 Bash, 20 Edit, 15 Write real tool cards in DOM).
Widths 360/1024 were produced by cloning real `ptah-tool-call-item` nodes (tailwind/daisy classes are global) into a fixed wrapper of that width, with `data-theme` set to `dark` / `light` on <html>. Scripts: %TEMP%\task623-vr.

## Group 1: collapsed row height (R7.9, #123/#131) - PASS
Measured with getBoundingClientRect on `ptah-tool-call-header button[aria-expanded]`, 8 cards (longest + median per tool), 4 width/theme combos:
| Tool | Width | Theme | Toggle row px | Whole collapsed card px | Result |
| --- | --- | --- | --- | --- | --- |
| Bash | 360 / 1024 | dark, light | 31.6 | 76 | PASS (<= 36) |
| Read | 360 / 1024 | dark, light | 31.6 | 44 | PASS |
| Write | 360 / 1024 | dark, light | 31.6 | 44 | PASS |
| Edit | 360 / 1024 | dark, light | 31.6 | 44 | PASS |
- Prototype collapsed Bash card (previews, w=360, dark): card 86 px, header 37 px. App Bash card 76 px <= 86. PASS.
- Merge-base height: not measurable without a second build (decision #17).
- Long Read/Write/Edit path: `[data-testid=tool-file-path]` is one line (16 px), `scrollWidth > clientWidth` (ellipsised) at 360 for 193-char titles and 52/76-char titles; at 1024 only the 193-char ones ellipsise; `title` attribute carries the full path (length 193). No horizontal scroll on the wrapper. Evidence: visual-review/collapsed-360-dark.png, collapsed-360-light.png, collapsed-1024-dark.png, collapsed-1024-light.png.
- Live app at tile width 184 px (not a target width): Read/Write/Edit toggle row wraps to 44.5 px (> 36), Bash 30.5. This is below the 360 minimum width and outside the spec'd widths; recorded as a note.

## Group 2: prototype R9.5 width script (?check=1) - PASS (prototype side)
All six screens x dark/light: roots 360/1024 and 300/960 report `ok`, bad=[] . (This validates the prototype baseline only.)

## Group 3: dock + Agents empty tabpanel - DEFECT (serious)
Dock opened on session "Session 10/2/2026" (no turns, so Displays empty, Agents empty). Measured at dock widths 292 and 481 (viewport 892 and 1700), dark and light:
- Displays empty state text "Nothing to show yet" + sentence: present, matches design-spec.md:61 (prototype empty screen reads "No displays yet" + sample prompt; the copy differs from the prototype PNG but follows design-spec.md:61, so recorded as note, not defect).
- Agents tabpanel empty state "No agents in this session": renders, BUT it renders at the same time as the Displays tabpanel, under it.
- DEFECT D1 (serious): in `ptah-display-dock` the inactive tabpanel keeps `hidden` attribute (`hasAttribute('hidden') === true`) but computed `display: flex`, height 249 px at 292 wide / 369 px at 481 wide. The panel class `flex ...` overrides the UA `[hidden]{display:none}` rule. With Displays selected the Agents panel is visible below; with Agents selected the Displays panel is visible above. Tabs no longer switch content; two panels stack and halve the height, against design-spec.md:31-40 ("one dock, two tabs"). Source: libs/frontend/chat/src/lib/components/organisms/display-dock/display-dock.component.ts:168-175 (displays panel, `class="flex min-h-0 min-w-0 flex-1 flex-col"` + `[hidden]`) and :190-196 (agents panel, same). Suggested fix: add `hidden:` guard e.g. `[class.hidden]` / `[class.flex]="active"` or `[style.display]`, or use `@if`. The jsdom specs cannot see this (no CSS), which is why it passed 32 batches.
- Evidence: visual-review/dock-292-dark-displays.png, dock-292-dark-agents.png, dock-292-light-*.png, dock-481-{dark,light}-{displays,agents}.png.
- Same pattern in display-panel.component.ts:211-215 (`dp-tabpanel` + `[hidden]`): that class is custom CSS; not exercised because no surfaces could be generated (see Not exercised).

## Group 4: live tool previews, chips, code-output (real data, clones at 360/1024, dark + light)
| Check | Width | Theme | Result | Evidence |
| --- | --- | --- | --- | --- |
| Turn summary chip collapsed (toggle 36 px high, no hscroll) | 360, 1024 | both | PASS (structure matches prototype chip; real data only has test counts) | chip-{360,1024}-{dark,light}.png |
| Turn summary chip expanded | 360 | both | DEFECT D2: "unavailable" values in Tokens/Cost/Time tiles break mid-word ("unavailab/le") | chip-exp-360-dark.png, chip-exp-360-light.png |
| Turn summary chip expanded | 1024 | both | PASS (156 px, one row of tiles) | chip-exp-1024-*.png |
| Expanded Read/Write/Edit/Bash previews | 360, 1024 | both | PASS, no horizontal scroll; header path wraps (`break-all`, 96-144 px at 360, 16-32 px at 1024), command wraps expanded | expanded-{360,1024}-{dark,light}.png |
| Edit diff gutter labelled (#132) | 360, 1024 | both | PASS: visible "Snippet lines" label; region aria-label "Diff of dive.spec.ts, line numbers count within the replaced snippet"; no "Lines 41-46" (approved) | diff-{360,1024}-{dark,light}.png |
| Shared path link (#128) in diff header | 360 | both | RECORDED (later task): `ptah-file-path-link` uses `truncate`; a ~90-char path shows as ".../packa..." in about 9 visible chars at 360, one line, title carries the full path; no wrap as design-spec.md:140 wants. Not a defect of this task. | diff-360-dark.png |
| Code-output no overflow / no clipping | 360, 1024 | both | PASS: 299 real code-output blocks cloned: 0 with `scrollWidth > clientWidth`, 0 clipped, 0 with a visible vertical scroll in the `max-h-48` fallback, wrapper no hscroll | codeout-{360,1024}-{dark,light}.png |

Code-output row estimate (#118, #121(a)), real data, not the three synthetic inputs (see Not exercised):
- 299 blocks: 136 show "Show full output"; 163 stay non-collapsible with the `max-h-48` vertical-scroll fallback, none of which actually needed to scroll (scrollHeight == clientHeight).
- (1) six short lines: 7 real samples with 5-7 lines of 60-100 ASCII chars (e.g. 6 lines, max 75 chars): all use the fallback (no toggle), content fully visible, no overflow. Fallback accepted.
- (2) wide/CJK: only one real shape, a 19,709-char single-line CJK/Arabic-mixed Read output: toggle shown, block clipped to 96 px (9.6em) with fade, no overflow. Six lines of CJK text could not be produced.
- (3) structural markdown: 6 real Bash outputs with markdown tokens; one (4 lines) uses the fallback, five long ones show the toggle. No overflow, no clip.
- No sample was judged unacceptable, so no later width-aware-estimate item is raised by this evidence (the synthetic wide-text case remains unverified).

## Group 5: axe-core (4.x from node_modules, injected through CDP Runtime.evaluate because the page CSP blocks script tags)
Scope: all 11 `ptah-chat-transcript` roots (about 336 expanded tool cards, 299 code outputs, chips) and the `ptah-display-dock`, in dark and light.
- Serious/critical: 0 in all four runs (chat dark/light, dock dark/light).
- Moderate: `landmark-unique` x15 (code-output `role="region"` blocks share the label "<Tool> output", code-output.component.ts:~84, blockLabel at ~207) and `heading-order` x1 (chat-view). Not blocking; recorded as moderate.
- Note: color-contrast produced no violations. The dock contained only empty states, so axe of populated panel surfaces was not run.

## Defects
| # | Severity | Defect | Source | Evidence |
| --- | --- | --- | --- | --- |
| D1 | serious (bordering blocking: the R1.3 single dock with two tabs does not work) | Inactive dock tabpanel is visible: `flex` class beats `[hidden]` | libs/frontend/chat/src/lib/components/organisms/display-dock/display-dock.component.ts:168-175, 190-196 | dock-292-*.png, dock-481-*.png |
| D2 | serious (narrow only) | Chip stat values "unavailable" break mid-word at 360 (3-column tiles, `break-words text-lg`) | libs/frontend/chat-ui/src/lib/molecules/turn-recap/turn-summary-chip.component.ts:183 | chip-exp-360-{dark,light}.png |
| M1 | moderate | 15 duplicate `role="region"` labels for code-output (axe landmark-unique) | code-output.component.ts ~84, ~207 | axe |
| M2 | minor/note | Displays empty-state copy "Nothing to show yet" differs from the prototype empty PNG ("No displays yet" + sample prompt) but follows design-spec.md:61 | display-panel.component.ts | disp2.png |
| M3 | note | At the live tile width of 184 px (below the spec's 300/360 minimums) Read/Write/Edit header rows wrap to 44.5 px | tool-call-header.component.ts | measured |

## Later items (not defects of this task)
- #128 shared `ptah-file-path-link` ellipsises where design-spec.md:140 wants wrapping (named later task on the shared atom).
- Width-aware row estimate for code-output (#118/#121(a)): not triggered by real data; synthetic wide-text case unverified.
- VS Code R7.8/R7.10: not visually verified, covered by host-branch specs (the VS Code webview cannot be launched here).

## Not exercised, with reasons
- Turn summary, states, agents ($agents), atoms, dock with surfaces, display strip pills, expanded display chip, Files/Tests tabs, evicted chip: the provider is rate limited (HTTP 429, ollama session limit) so no agent turn or `ptah-ui` fence could be produced, and existing sessions contain no display surfaces (Displays (0), Agents (0)). Panel widths 300/960 were therefore only observed for the empty dock (292 and 481 px). Prototype comparison for those screens is unverified.
- Real window widths 360/1024: the Electron window is 892 px and cannot be resized through CDP (`Browser.getWindowForTarget` unsupported); widths 360/1024 were produced by cloning real nodes into a fixed-width wrapper, so container-driven layout in the real tile was not exercised beyond the 184-340 px tiles.
- Synthetic code-output inputs (6 short lines, 6 CJK lines, structural markdown): component inputs could not be injected without mutating the app; natural samples used (see Group 4).
- Merge-base heights: not measurable without a second build (decision #17).
- Prototype comparison of dock tabs with real Agents: only empty states.
- Focus/keyboard pass, hover and loading states, contrast on populated panels: not run.
- Theme switching was done by setting `data-theme` to `dark`/`light` on <html>, not through the theme toggle.

## Verdict
FAIL for V1 sign-off: D1 and D2 are serious and open; the surfaces listed above are unverified. Passing: R7.9 collapsed heights (31.6 px toggle for all four tools, Bash card 76 px vs prototype 86 px), long-path ellipsis/wrap with title, #132 diff gutter label, axe zero serious/critical, no overflow in 299 code outputs, prototype R9.5 script clean. Confidence: MEDIUM (partial coverage).
