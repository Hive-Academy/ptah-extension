# Design revision 1 — attention notifications

Review: `design-spec-review.md`. All ten findings addressed in the spec, prototype and 27 recaptured screenshots.

| ID | Severity | Fix | Status |
| --- | --- | --- | --- |
| S1 | Serious | Permission snackbar and Needs you rows now name provider and tool (`Claude · Tool: Bash · ptah-extension`); spec disables Allow when tool name is unavailable and retains Deny/Open. | Fixed |
| M1 | Moderate | Parity map moves canvas chip actions to bell Needs you and snackbar, with TASK_702 removal sequencing. | Fixed |
| M2 | Moderate | Git snackbar appears only when git surface is hidden; visible git surface uses one local strip with Retry, while Recent notices keeps history. Added `git-open` capture. | Fixed |
| M3 | Moderate | Clear all notices clears Recent notices and transient failure/warning snackbars; live requests and their snackbars remain until answered or individually dismissed. | Fixed |
| M4 | Moderate | Added light question, stack, failure, git warning, empty panel, VS Code and 800px captures. Measured icon and edge contrast in both themes; adjusted light semantic colors and badge text. | Fixed |
| M5 | Moderate | Added 400×800 sidebar snackbar and panel captures; one card plus overflow and full width panel with 10px gutters. | Fixed |
| m1 | Minor | Git warning now uses Lucide TriangleAlert path in snackbar and panel. | Fixed |
| m2 | Minor | Snackbar context text raised from 11px to 12px. | Fixed |
| m3 | Minor | Existing `prefers-reduced-motion: reduce` media query verified in prototype; spec states snackbar host is a plain container without a live role. | Verified |
| m4 | Minor | Failed turn context now reads `Claude · ptah-extension · Turn failed`. | Fixed |

## Verification

`node prototype/capture-screenshots.js` produced 27 PNGs, passed viewport/composer/tab collision checks, and measured text pairs at 4.5:1 or greater and semantic icon pairs at 3:1 or greater. All 27 captures were visually inspected in contact sheets, with sidebar captures inspected at full size. No production code changed.
