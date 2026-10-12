# Visual Review - tool-call-redesign (PR #716, branch feat/tool-call-redesign)

## Verdict: ISSUES

The redesign matches Direction A + the C status rail structurally. The collapsed log line, no "Input"/"Output" headings, one tool name per row, the chips and the rail colours all render as designed. There is no horizontal page scroll in any of the 56 captures. The long-output block has exactly one scroll container, with visible text. Focus rings are visible in both themes.

Eight issues are listed below: 3 serious (issues 2, 3 and 4; issue 4 is in an unchanged component), 2 moderate (1 and 5) and 3 minor (6, 7 and 8). Nothing is "visual breaking".

Scope and limits of this review:
- Fixtures are synthetic `ExecutionNode` trees injected into the real Angular webview, so the cards are the real components.
- Chromium only.
- The "panel width" is the browser viewport width. The 24 px Sessions and Agents rails of the shell sit inside it, so the chat column is about 48 px narrower than the nominal width.
- There is no `prototype/` folder for this task. The reference is `style-options.md` and `style-options.html` (Direction A + C rail). I compared against the markdown spec and did not open the HTML mockup side by side.

## Screenshots (all in `.ptah/specs/tool-call-redesign/visual/`)

Naming: `<scene>-<collapsed|expanded>-<dark|light>-<360|800>.png`. Dark = theme `anubis`, light = `anubis-light`. That makes 7 scenes x 2 states x 2 themes x 2 widths = 48 files for the main set.

| File pattern | What it shows |
| --- | --- |
| `shell-*` | Bash with a 4-line command, `run_in_background`, timeout 3600000 (renders as a `60 min` chip) and a "started" marker. Also PowerShell with a multi-line command and timeout, a failed Bash (red rail, "failed" chip, Error block), and a running Bash (blue pulsing rail). |
| `files-*` | Read of a `.ts` file with `lines 1-60`, Write of a 41-line `.md` file, Edit rendered as a diff. |
| `search-*` | Grep (pattern, path, glob, `-i`, output_mode chips), Glob, TodoWrite, and a Task/Agent (rendered by the separate agent card). |
| `mcp-*` | Ptah MCP (`ptah_agent_list`, `ptah_search_files`) with the gold chip, a generic `playwright` MCP call with arguments, and a generic no-arg `github.ListAgents` with long plain-text lines. |
| `longout-*` | Bash with 80 lines of output. The expanded shot has "Show full output" clicked, so the button reads "Show less". |
| `permission-*` | Bash awaiting permission (orange rail, permission card). |
| `focus-stop0-*`, `focus-stop2-*` (dark and light, 360 and 800) | Tab sequence on the shell scene. `.focus()` was called on the first header, so stop 0 shows no ring. This is a harness artifact; see the focus section. |
| `focus-keyboard-header-dark-360.png`, `focus-keyboard-header-light-360.png` | Real keyboard (Shift+Tab, Tab) focus on the first header. The ring is visible. |
| `capture-log.txt`, `probe2-log.txt` | Raw measurements: overflow, scrollers, contrast, targets, focus style. |

Total: 58 PNG files.

## Checks against the chosen design

| Check | Result | Evidence |
| --- | --- | --- |
| Nothing repeats | Mostly passes. | See issue 6 (the "Bash" language label next to the "Bash" tool name) and the fixture caveat below. |
| No generic "Input"/"Output" headings | Pass. | `genericLabels` contained only "Result", which is a content-naming label allowed by the spec. No Input or Output in any shot. |
| Rail colours | Pass. | done = oklch green (success), failed = red, running = blue, awaiting permission = orange. The Ptah body has a gold left border at 40% alpha (`ptah-gold-border`, `tool-call-item.component.ts:154`). The Ptah rail itself stays success-green. See issue 7. |
| Contrast, both themes | Mostly passes. | See issues 3 and 8. Body, chip and muted text measure 5.65 to 14:1 in dark. In light, everything except issues 3 and 8 passes. |
| No horizontal overflow at 360 | Page-level pass. | `scrollWidth` = 360 in every shot. Header-level clipping is real: issue 2. |
| No blank output | Pass. | Every expanded card has text. The MCP `ListAgents` body wraps and is visible (issue 4 concerns only its line breaks). |
| One scroll container | Pass. | Long-output expanded: `scrollers = [1]`. |
| Focus rings visible on Tab | Pass. | Header, Copy and output-region stops all show a 2 px outline. Dark ring is near-white, light ring is dark purple (oklch 0.236), offset 2 px. A real keyboard Tab onto the header gives `:focus-visible` true. |
| Targets | Pass. | Header toggle 217x28, Copy 28x28. Nothing is under 24x24. |

## Issues

1. **Moderate: the tool-name text and the folder path drop below 4.5:1 on hover or focus.**
   - Screenshots: `files-expanded-dark-360.png`, `search-expanded-dark-360.png`.
   - Measure: `Grep`, `Read` and `D:/projects/...` measure 4.06:1 in dark and 4.48:1 in light while the header is focused or hovered (`probe2-log.txt`). At rest they measure 5.71:1.
   - Cause: `text-base-content-muted` on the `--surface-highlight` hover background.
   - Source: `libs/frontend/chat-ui/src/lib/molecules/tool-execution/tool-call-header.component.ts:113` (tool name) and `:122-128` (directory). The hover class is on the button at `:80`.
   - Fix: use a muted token that clears 4.5:1 on `--surface-highlight`, or lighten the highlight.
   - Also in light, the gold "Ptah" chip text measures 4.04:1 at 10 px effective size (`:90-95`).

2. **Serious: at 360 px the Grep and Glob headers hide their key info and push the chevron out of view.**
   - Screenshots: `search-expanded-dark-360.png`, `search-collapsed-dark-360.png` and the light equivalents.
   - Observed: the Grep header reads `Grep [in libs/frontend] [*.ts] [c…`. The pattern `ToolCallItem` is invisible because its span collapses to zero width.
   - Measure: the `-i` chip ends at x=370 and the chevron at x=390, both past the 360 viewport (`capture-log.txt`).
   - Observed in the expanded Grep card: the pattern appears nowhere in the body either, so the user cannot see what was searched.
   - Cause: every chip is `flex-shrink-0` and the primary target is `min-w-0 truncate`, so chips win the space.
   - Source: `tool-call-header.component.ts:144-150` (chips) and `:134-141` (target).
   - Fix: let the chips shrink or wrap, or hide chips beyond the first at narrow widths (the spec says B shows at most two inline chips under 520 px). Alternatively give the primary a `min-w-[6ch]` and let the chips overflow-hidden.
   - Read has the same pressure: `Read tool-c… lines 1-60`, with the file name cut to 6 characters (`files-expanded-dark-360.png`).

3. **Serious: syntax-highlighted code is washed out in the light theme.**
   - Screenshot: `files-expanded-light-800.png` and `files-expanded-light-360.png` (Read of a `.ts` file).
   - Measure: token colours measure 1.3 to 2.2:1 against the block background (`probe2-log.txt`: `import` 1.89, `{` 1.30, `'@angular/core'` 1.63, `ToolCallItemComponent` 1.30).
   - Cause: the global `prism-tomorrow.css` (a dark Prism theme) is applied in both themes, with no light overrides. The code block also carries `prose-invert` in both themes.
   - Source: `apps/ptah-extension-webview/project.json:30` and `libs/frontend/chat-ui/src/lib/molecules/tool-execution/code-output.component.ts:128`.
   - Note: this is probably older than the redesign. It matters because the redesign makes code the main body content.
   - Fix: add light-theme token colours scoped to `.tool-output-markdown`, and drop `prose-invert` when the theme is light.

4. **Serious at 360 px, but the card is not part of this diff: the permission card's Deny... button is clipped.**
   - Screenshot: `permission-expanded-dark-360.png`. At 800 the card's right border is also slightly clipped (`permission-expanded-light-800.png`).
   - Cause: the action row is `flex gap-1.5` with no wrap.
   - Source: `libs/frontend/chat-ui/src/lib/molecules/permissions/permission-request-card.component.ts:104`.
   - Fix: add `flex-wrap`.
   - Fixture caveat: the `NaNs` badge in these shots comes from my fixture, which gave no deadline. It is not a product bug.

5. **Moderate: plain-text MCP results lose their line breaks.**
   - Screenshots: `mcp-expanded-dark-360.png`, `mcp-expanded-light-360.png`.
   - Observed: the three-line `ListAgents` and `ptah_agent_list` output renders as one run-on paragraph (`...team Agent: codex...`). It wraps, it is visible and it is not blank, but the line structure is gone.
   - Cause: all `mcp__*` outputs are routed to the markdown renderer, so single newlines collapse.
   - Source: `libs/frontend/chat-ui/src/lib/utils/tool-language.utils.ts:86-87`, which returns `'markdown'`.
   - Fix: render with `breaks: true` or `whitespace-pre-wrap` when the text has no markdown syntax.

6. **Minor: the language label repeats the tool name, and plain output is highlighted as bash.**
   - Screenshots: `shell-expanded-dark-800.png`, `shell-expanded-light-360.png`.
   - Observed: the output header reads `Result Bash 2 lines` and `Error Bash 3 lines`, directly under a header that already says Bash.
   - Observed: plain English output gets bash colouring ("running **in** background", "Cannot **find**" in orange).
   - Source: `code-output.component.ts:84` (language span) and the language detection in `tool-language.utils.ts`.
   - Fix: hide the language label when it equals the tool name, and treat non-script output as `text`.

7. **Minor: the Ptah rail stays green.**
   - Screenshot: `mcp-expanded-dark-800.png`.
   - Observed: the rail is the status colour (success green). The spec's C direction suggested a gold rail for Ptah tools. Gold appears only as a 40% alpha 1 px body border and as the "Ptah" chip.
   - This is consistent with "A + C status rail" and is a judgment call. Confirm it is intended.

8. **Minor: at 360 px the Show-full-output row crowds and clips.**
   - Screenshots: `files-expanded-dark-360.png` (Read) and `longout-expanded-dark-360.png`.
   - Observed: "8 lines" and "80 lines" wrap to two lines, and the `Show full output` label is clipped to "Show full o".
   - Source: `code-output.component.ts:77-103` (header row is `flex gap-2` with no wrap or shrink rule).
   - Fix: add `flex-wrap`, or shorten the label under 420 px.

Fixture and harness caveats (not product issues):
- The duplicate Error block in the failed Bash card (`shell-expanded-*`) comes from my fixture, where the output began with the error text rather than ending with it. The dedup in `tool-text.utils.ts:91-101` handles exact and trailing matches, as real Bash output does. I did not re-run it with a trailing-match fixture.
- The Task/Agent card shows "No execution data". The fixture has no children or summary, and the agent card is a separate component outside this redesign.
- The stop-0 focus screenshots are from a programmatic `.focus()` and show no ring. The real keyboard Tab test, in `focus-keyboard-header-*`, passes.

## How it was run (repeatable)

All files are under `.ptah/specs/tool-call-redesign/visual/` and nothing tracked was modified. The harness lib's own e2e specs render a hand-built DOM, not the real components, so they cannot show the redesign. This approach uses the real webview.

```bash
# from D:\projects\ptah-extension\.claude-worktrees\tool-call-redesign
npx nx build ptah-extension-webview --configuration=development --parallel=1 --skip-nx-cache
#   output: dist/apps/ptah-extension-webview/browser   (about 1 min; dist is gitignored)

# one static SPA server on :4399 (stop it afterwards)
node .ptah/specs/tool-call-redesign/visual/serve.mjs dist/apps/ptah-extension-webview/browser

# in another shell: fixtures + capture
#   fixtures.mjs holds the ExecutionNode trees. capture2.mjs stubs acquireVsCodeApi,
#   sets localStorage 'ptah-theme' and data-theme,
#   finds the Angular app shell via ng.getComponent (dev build only),
#   switches layout to single, creates a tab, calls tabManager.setMessages(...),
#   sets a permission request through chatStore.permissionHandler for the permission scene,
#   then expands every header and saves the screenshots.
node .ptah/specs/tool-call-redesign/visual/capture2.mjs        # all 56 captures, about 25 min
#   narrow with env vars: W=360|800  T=dark|light  S=shell,files,search,mcp,longout,permission
node .ptah/specs/tool-call-redesign/visual/probe2.mjs          # contrast, targets, gold border, keyboard-focus checks
```

All processes started (the static server, the capture and probe scripts, and the Playwright Chromium instances) are stopped. Port 4399 has only TIME_WAIT sockets left.
