# Cutover visual fix — round 2 code review

Reviewer: codex — GPT-6

Reviewed commit: `e0aeab566007c1d74698a38dc1e76e0e82422fb9`.

Score: **8/10**

Verdict: **REVISE**

Reviewed committed code, specs and the committed N-1–N-4 findings/author response. Application evidence below refers to that commit, not the working tree. Installed Pierre and daisyUI sources were inspected to check the integration contracts. No tests, builds or browser checks were run, as requested. The author's reported axe pass is not an independently executed check here.

| Finding N-n | fix sound? | evidence file:line |
| --- | --- | --- |
| N-1 | YES | `libs/frontend/git-ui/src/lib/renderer/pierre-config.ts:167` derives a separately named theme, copying changed comment rules and preserving other theme fields. `:207` catches base-load failures and supplies the plain dark fallback. `:241` registers the loader; `:308` selects it only for the dark side of the theme pair. The light loader and light selection remain intact. |
| N-2 | YES | `libs/frontend/git-ui/src/lib/review-canvas/file-section-header.component.ts:110` reserves path width; `:126` visually hides the rename note without removing its text from accessibility; `:142` does the same for the full comparison label. `:151` gives the decorative short label empty alternative text, while `:201` retains the full title. `:318` includes the original path in the path title. The resulting action-space problem is covered under N-3 below. |
| N-3 | PARTIAL | `libs/frontend/git-ui/src/lib/review-canvas/file-section-header.component.ts:107` prevents horizontal overflow from enlarging the scrollport, but clips overflowing controls rather than ensuring they fit. Combined with `:110` and the ineffective self-container gap query at `:135`, the fully populated narrow header can lose its rightmost action. See finding 1. |
| N-4 | YES | `libs/frontend/git-ui/src/lib/spot-editor/spot-editor.component.ts:253` clips the pane containing the absolutely inset editor host at `:262`. CodeMirror retains its internal scroller; its editor height is constrained to 100% and the focus outline points inward at `libs/frontend/git-ui/src/lib/spot-editor/codemirror-setup.ts:120` and `:127`. No change removes or clips the internal scrollbar in the inspected structure. |

Theme tracing: resource registration precedes worker initialization (`libs/frontend/git-ui/src/lib/renderer/pierre-worker-pool.ts:78`). Both named themes are registered globally and supplied as a pair; the dark theme is not substituted for light. The canvas derives the current mode from ThemeService (`libs/frontend/git-ui/src/lib/review-canvas/review-canvas.component.ts:290`), and the renderer applies mode changes to its live instance (`libs/frontend/git-ui/src/lib/renderer/pierre-diff-host.component.ts:197`). New instances read the current mode at `:237`. The copied comment settings do not mutate the source theme. No concrete runtime-switching leak was found. The explicitly documented word-emphasis contrast limitation is not re-raised here.

Accessibility tracing: Comment and Edit retain explicit names (`libs/frontend/git-ui/src/lib/review-canvas/file-section-header.component.ts:247`, `:263`), and the Open-in caret retains its name (`libs/frontend/git-ui/src/lib/open-in/open-in-button.component.ts:95`). Their inset focus outlines are compatible with clipping while the buttons remain inside the row. The Open-in menu is a descendant dropdown (`open-in-button.component.ts:110`): vertical overflow remains allowed, but horizontal overflow is still clipped, including when the anchor has been pushed outside the header.

## New findings

1. **MOD — The reserved path width plus horizontal clipping can hide the Open-in caret in a populated 300 px header.** Evidence: `libs/frontend/git-ui/src/lib/review-canvas/file-section-header.component.ts:107`, `:110`, `:135`, `:245`, `:262`, `:272`.

   **Scenario:** A roughly 300 px diff column shows a readable working-tree file with a hunk chip, Comment and Edit available, and at least one installed editor (so Open-in includes its caret). The row keeps a 33cqi path minimum, a status badge, the WT badge, a summary badge, and all three action controls. Its five outer gaps remain 8 px: the `@container` rule targeting `:host` at `:136` queries an ancestor container, not the header's own inline-size container. In a wider dock whose diff column alone is narrow, that rule therefore does not tighten the header gaps. The fixed controls and gaps plus the reserved path exceed the available row width. For example, the repository's 4 px button padding (`apps/ptah-extension-webview/src/styles.css:54`, `:1623`), 12 px icons, two icon action buttons and the joined Open-in pair already consume roughly 90 px for the actions; the reserved path is about 94 px, before toggle, status, two badges and 40 px of outer gaps. The new `overflow-x: clip` cuts off the rightmost caret and its focus indicator instead of allowing the row to expose that overflow through scrolling. This is the same user-visible action N-3 intended to preserve.

   **Fix:** Make the narrow layout's width budget fit before applying clipping. Put the gap-changing row inside the queried container (or use an externally measured compact class), and let secondary badges yield enough space for the path plus every action. Check the 300 px populated row with both Comment/Edit and an available editor; keep the caret and its full focus indicator inside the header. Do not rely on clipping alone to satisfy the no-overflow condition.
