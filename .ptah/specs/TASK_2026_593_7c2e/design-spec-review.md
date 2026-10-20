# Design review - TASK_2026_593_7c2e (cross-side reviewer)

Verdict: **REVISE** (1 Serious, 5 Moderate, 4 Minor, 0 Blocking). The Serious item is a small copy and spec fix. After it, I expect APPROVED without another visual round.

Reviewed: context.md, decisions.md, design-spec.md, parity-inventory.md, prototype/README.md, prototype/notifications.html (CSS and markup greps), 11 of the 17 screenshots, and the user's current-app screenshot `images/1.png`. The screenshots I did not open are the dark question, lane, focused, empty, notice-info and bell-badge captures plus the light 800px capture, which does not exist. The dark/light permission, panel, stack, git-warning, failed-turn, 800px, OS and VS Code captures were all inspected.

## Checks against the approved requirements

| Check | Result |
| --- | --- |
| Badge counts only Needs you (permission, question, lane permission) | Pass. `dark-snackbar-stack.png` shows 5 for 5 live requests. `dark-git-warning.png` and `dark-failed-turn.png` show no badge. design-spec.md:27 |
| Failures and git warning go to snackbar and Recent notices, no count | Pass. `dark-panel.png` has "Recent notices 2" separate from "Needs you 3" |
| Routine info stays out of the bell | Pass. design-spec.md:18, 48 |
| No finished-turn rows | Pass |
| Clear all | Pass, with caveat M3 |
| Max 3 snackbars plus "+N more", 800px shows 1 | Pass. `dark-snackbar-stack.png` and `dark-800.png` |
| No snackbar for a focused visible session | Specified (design-spec.md:35) and has a `focused` state |
| Canvas dock gone | Pass in all captures. There is no dock bar, chip or "New Session" in the board area. But see M1 for parity-map text that still says "canvas" |
| OS text uses only fixed labels, workspace, agent and tool name | Pass. design-spec.md:56. The OS and VS Code mocks match: "Permission needed / ptah-extension · Claude · Tool: Bash" |

## Findings

### Serious

**S1. The snackbar and bell permission copy hides which tool is being allowed, while one-click Allow is offered.**
- Evidence: `dark-snackbar-permission.png` and `light-snackbar-permission.png` show "Claude wants to use a workspace tool · ptah-extension" with **Allow** as the primary button. The lane row in `dark-panel.png` does show "Tool: Bash". The OS notice (fixed by decision #10) shows the tool name, so the in-app surface carries less than the OS surface.
- Why it matters: Allow/Deny on a security prompt without seeing the tool is unsafe. The privacy limits in decision #10 apply to host/OS text only. In-app, a tool name is fine, and the user needs it to decide. "a workspace tool" is also unrealistic mock text.
- Fix:
  1. Snackbar title stays "Permission needed". The context line becomes "Claude · Tool: Bash · ptah-extension" for chat and lane requests alike. Update `request()` and the row markup in notifications.html:21-26, then recapture the permission and panel PNGs in dark and light.
  2. State in design-spec.md that the in-app tool name is always shown.
  3. Add one rule. If the tool name is unavailable, disable Allow in the snackbar and keep only "Open session", so the user has to see the full request. Deny and Open stay available.

### Moderate

**M1. The parity map still says "canvas" for surfaces that decision #13 removes.**
- Evidence: design-spec.md parity map has "Pending row opens target session: Bell, snackbar, canvas, and host Open route" and "Canvas permission Allow/Deny: Keep in canvas; equivalent safe action in snackbar/panel". parity-inventory.md:20-23 says the chip, Allow/Deny and dock are removed and moved to the bell.
- Fix: change both rows to "moves to bell Needs you row and snackbar; canvas chip removed by TASK_702 after this task merges (decision #14)". The same wording in the spec also lists "canvas, and host Open route"; replace it. This is a spec-consistency issue and the architect will read it.

**M2. N4: git status timeout has three presentations, and the snackbar and strip are visible at the same time. That is too much.**
- Evidence: design-spec.md:17 says the keyed snackbar shows "while git surface is open" and a "dismissable local strip remains". Those are the same moment, so the user sees the strip and the snackbar for the same condition, plus a Recent notices row (`dark-panel.png`).
- Judgment: decisions #12 and #14 force the strip, the snackbar and the row to exist, but nothing forces them to show at once. Apply the same rule as the focused-session suppression.
- Fix:
  1. Show the git snackbar only when the git surface is not visible. While the strip is visible, the strip is the presentation and the bell row is the history.
  2. When the git surface is not open, the snackbar shows once, 10s.
  3. Retry lives in the strip and the row. Dismissing the strip does not clear the row; Clear all or recovery does.
  4. Write this as a one-line rule in the event table and add the "git surface open" state to the capture list.

**M3. "Clear all" semantics are surprising.**
- Evidence: design-spec.md:36 says Clear all "removes ... live request snackbars" but leaves their Needs you rows. It is also disabled when no dismissible notices exist, even when a live snackbar is still showing.
- Fix: Clear all clears only Recent notices and transient (failure and warning) snackbars. It leaves live request snackbars, because hiding a pending permission without answering it is exactly the attention failure this task prevents; per-snackbar X already offers that. If the lane keeps its behavior, enable Clear all whenever any snackbar is visible, and label it "Clear all notices".

**M4. Light-mode coverage is not enough for Gate 1.7.**
- Evidence: only `light-panel.png` and `light-snackbar-permission.png` exist. The light primary is pastel teal with dark text (`light-panel.png`), and the panel has failure and warning rows in light.
- Fix: add light captures for the failure snackbar, the git warning, the 3-card stack and 800px, and the VS Code host mock. I do not need more than four more, since the measured contrast table covers the pairs. Also add a contrast row for the failure/warning icons and 3px edge (3:1 non-text) in light, not only dark.

**M5. VS Code webview mapping is mostly host-message mapping. The in-webview layout is not shown.**
- Evidence: `dark-vscode.png` is a host toast mock on the Electron layout. The sidebar webview is roughly 300-400px wide, and design-spec.md:31 only says `min(348px, viewport - 20px)`. Nothing shows a snackbar over a 320px sidebar, where the composer sits low and the 3-line stack would consume a large share of the height.
- Fix: add one 360px capture, dark, showing one card plus "+N more", and state that at 420px wide or less there is a one-card limit (today the one-card limit is "900px and below", which already covers this, so say so explicitly for the sidebar). Also say whether the bell panel becomes full-width at 360px (340px panel plus margins does not fit under 360px).

### Minor

- **m1.** Warning icon mismatch. design-spec.md:66 names `TriangleAlert` for warnings, but the prototype uses the circle-i `info` glyph for git (`icon('info')` at notifications.html:23, and `dark-git-warning.png`, `dark-panel.png`). Use the triangle in the prototype or change the spec; the triangle is better because Info is reserved for routine messages.
- **m2.** Snackbar context line is 11px (`.snack .meta{font-size:11px}`). It passes contrast but is small beside 13px base text. Raise to 12px if the 348px width allows it.
- **m3.** The prototype has no `prefers-reduced-motion` rule (`grep` shows only the README/spec mention). The spec text is implementable (design-spec.md:52), but a one-line media query in the prototype makes the claim checkable.
- **m4.** Failed-turn context line "inspect the failed turn" (`dark-failed-turn.png`) is filler. Use "Claude · ptah-extension · Turn failed" or the real failure class if the event carries one; do not invent a reason field.

## Checks 3 to 6 in short

- **Visual and app fit:** good. `surface-3` card, 3px semantic edge, 9px radius, compact top-right placement and a clean bell panel match the current app (`images/1.png`). Top-right placement does not cover the composer in any capture (checked by the capture script). At 800px the one-card plus "+4 more" pill overlays the board's subtitle row but no controls (`dark-800.png`). Acceptable.
- **Contrast:** the table (design-spec.md:77-86) meets 4.5:1 on every pair, lowest 4.82 (dark primary button) and 5.00 (light muted on panel). No `text-base-content/NN` text is used. Production `surface-3` must be remeasured, which the spec already says.
- **Keyboard, aria-live, reduced motion:** specified and implementable. Single shell announcer, no autofocus on arrival, timeout pause on hover and focus, Escape restores focus. Add that the host region for the snackbars is a plain container with no live role (the spec implies this at design-spec.md:50; state it explicitly).
- **Data honesty:** no invented fields beyond S1 and m4. Lane text "Codex · Tool: Bash" is realistic.
- **Parity:** every inventory row has a map entry (the first table's 21 rows and the three added rows); the only wrong entries are the two in M1.

## Must-fix before Gate 1.7

S1 (copy and spec rule), plus M1 and M2 (small spec edits). M3 to M5 should be done in the same pass since they need recaptures anyway.

## Round 1 re-review

Verdict: **APPROVED** (0 Blocking, 0 Serious; 9 of 10 findings closed, 1 Minor regression noted, 2 Minor new notes). I opened all 27 screenshots (including `dark-sidebar-snackbar.png`, `dark-sidebar-panel.png`, `dark-git-open.png`, and the light question, stack, failure, git, empty, VS Code and 800px captures) and re-read the changed spec lines and revision table.

| ID | Status | Evidence |
| --- | --- | --- |
| S1 | Closed | Snackbars and Needs you rows read "Claude · Tool: Bash · ptah-extension" (`dark-snackbar-permission.png`, `light-snackbar-permission.png`, `dark-panel.png`, `light-panel.png`, `dark-snackbar-stack.png`). design-spec.md:33 says every permission shows provider, tool name and workspace, never args or paths, and disables Allow when the tool name is unavailable while keeping Deny and Open session. `dark-focused.png` carries the same context line. |
| M1 | Closed | Parity rows at design-spec.md:116, 124, 125 now say "Moves to bell Needs you row and snackbar; canvas chip removed by TASK_702 after this task merges (decision #14)". |
| M2 | Closed | design-spec.md:17: git snackbar only while the git surface is hidden; when visible, the strip is the sole presentation. `dark-git-open.png` shows only the strip with Retry and no snackbar. `dark-git-warning.png` and `light-git-warning.png` show the snackbar with the bell showing no badge. |
| M3 | Closed | design-spec.md:25 and the panel header read "Clear all notices"; it clears Recent notices and transient failure/warning snackbars and leaves live requests. `dark-panel-empty.png` and `light-panel-empty.png` show it disabled when empty. |
| M4 | Closed | Added light captures: question, stack, failure, git, empty panel, VS Code and 800px. Light semantic icons, edges and badge look legible (dark amber on cream). Enough light coverage for Gate 1.7. |
| M5 | Closed | `dark-sidebar-snackbar.png` (400px: one card plus "+4 more", composer unobstructed) and `dark-sidebar-panel.png` (full-width panel with gutters, actions wrap cleanly). design-spec.md:31 states the one-card rule at 420px and below. |
| m1 | Closed | `TriangleAlert` glyph in the git snackbar and panel row (`dark-git-warning.png`, `dark-panel.png`). |
| m2 | Closed | Context line is visibly 12px. |
| m3 | Closed | Spec states the snackbar host is a plain container with no live role (design-spec.md:50). |
| m4 | Closed | `dark-failed-turn.png` reads "Claude · ptah-extension · Turn failed". |

### New notes (Minor, do not block Gate 1.7)

- **n1. Prototype bug: git strip dismiss control renders a literal "?".** In `dark-git-open.png` the strip's dismiss button shows "?" instead of an X icon. The button markup in notifications.html (`<button class="close" aria-label="Dismiss git warning strip">?</button>`) uses the character "?" instead of the `X` symbol the snackbar uses. A user would read it as a help button. Replace it with the same close icon (or "×") and recapture `dark-git-open.png` before the user's Gate 1.7 look.
- **n2. In-app failure snackbar shows a session title** ("Session "Voice page polish"", `dark-snackbar-failure.png`). That is fine in-app and does not break decision #10 (which governs host text only), but state it in design-spec.md so the implementer does not apply the host privacy filter to in-app text, or the reverse.
- **n3. Light VS Code and OS mock frames stay dark** (`light-vscode.png`). They are host-owned frames, so this is accurate; just keep the note that these are illustrative.

Remaining Gate 1.7 coverage: no further captures needed beyond the n1 recapture.
