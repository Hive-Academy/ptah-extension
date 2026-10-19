# Code Logic Review — `TASK_2026_699_833e`

Implementer family: Claude  
Review family: codex  
Diff range: `9d5063f43^..5fc888d16`  
Verdict: REJECTED

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 6/10 |
| Assessment | REJECTED |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 1 |
| Minor issues | 1 |
| Failure modes found | 2 |

The main integer-width paths and the cancellation/storage split are sound. The score is below the 7–8 band because an explicit layout and ARIA invariant fails for fractional shell measurements; it stays above the 5 band because the reviewed integer paths, persistence guards and modal paths have coherent handling and focused test coverage. The first finding violates AC 3.2 and should be fixed before approval.

## Findings

1. **Moderate — Fractional shell widths break the 624 px floor and ARIA range.** `inspectorMaxWidthFor` returns a fractional maximum at `inspector-shell.controller.ts:75-82`, then `inspectorDockWidth` rounds the clamped value upward at `inspector-shell.controller.ts:106-115`. The template binds that rounded width and the unrounded maximum to the same separator at `chat-view.component.html:295-297,322`. With shell width `960.5` and stored preference `560`, the maximum is `336.5`, the rendered dock and `aria-valuenow` are `337`, and the main column is `623.5` px. Thus `aria-valuenow > aria-valuemax` and AC 3.2's 624 px floor fails without an error. Use an integer effective maximum rounded **down** before rendering, clamping and ARIA binding. Existing tests use integer shell widths (`inspector-shell.controller.spec.ts:416-440`).
2. **Minor — A completed drag erases a pre-existing body cursor/selection style.** `split-handle.component.ts:227-229` overwrites `document.body.style.userSelect` and `cursor`; `split-handle.component.ts:307-309` clears both to empty instead of restoring their previous inline values. If the host or another concurrent resize had set either value, releasing, cancelling or destroying this handle silently removes that state while the other interaction continues. Save and restore the prior inline values, or coordinate ownership of these document-level styles. The destroy spec asserts empty values only (`split-handle.component.spec.ts:499-515`).

## Five logic questions

1. **How does this fail silently?** Fractional width measurement renders `337` against a maximum of `336.5` with no exception (`inspector-shell.controller.ts:75-82,106-115`); drag cleanup can erase another owner's body styles without notice (`split-handle.component.ts:307-309`).
2. **What user action produces unexpected behaviour?** Resize the host so its shell measures `960.5` px while a `560` preference is stored: the chat floor is breached and the separator's announced current value exceeds its maximum (`chat-view.component.html:295-297,322`). Starting and ending a second pointer drag during another body-level cursor interaction also clears the cursor early (`split-handle.component.ts:227-229,307-309`).
3. **What input data produces a wrong answer?** A fractional `ResizeObserver` width such as `960.5` with preference `560` produces a 337 px dock and 623.5 px chat column (`inspector-shell.controller.ts:75-82,106-115`). Integer cases 960, 1100 and 1500 match the intended 336/400/448 defaults (`inspector-shell.controller.ts:89-97`).
4. **What happens when a dependency fails?** Storage `getItem`, `setItem` and `removeItem` are caught, keeping an in-memory preference and logging once per failure kind (`inspector-dock-width.store.ts:61-94,122-130`). `ResizeObserver` absence uses the docked fallback (`inspector-shell.controller.ts:273-285`); zero measurements keep the last band (`inspector-shell.controller.ts:394-399`). These are explicit degradations rather than silent success claims.
5. **What is missing that the requirements never mentioned?** Document-level cursor and selection styles need ownership or prior-value restoration when separate handles drag concurrently (`split-handle.component.ts:227-234,295-319`).

## Failure modes

| Trigger | Symptom | Evidence | Current handling | Recommendation |
| --- | --- | --- | --- | --- |
| Fractional shell width with a high preference | Chat width dips below 624 px; separator current value exceeds max | `inspector-shell.controller.ts:75-82,106-115`; `chat-view.component.html:295-297,322` | Final width rounded upward | Floor the effective maximum once and use it everywhere |
| Body has inline cursor/selection state when drag begins, or another drag continues | Prior styles disappear at this handle's exit | `split-handle.component.ts:227-229,307-309` | Sets both to empty | Restore prior values or coordinate active owners |

## Write-path trace: `ptah.inspector-dock-width.v1`

1. **Scope and format:** root-provided `InspectorDockWidthStore` keeps one preference per `localStorage` origin/view type, as an integer string in `[300,560]` (`inspector-dock-width.store.ts:8-9,19-30,42-49`). Electron shares an origin; VS Code webview view types are separate by task decision 10 (`decisions.md:13`).
2. **Initial read:** constructor calls guarded `getItem`, parses finite nonblank numbers, rounds/clamps, then exposes `preference()` (`inspector-dock-width.store.ts:19-30,48-59,83-94`). Missing/malformed values become `null`, which selects a shell-size default in `inspector-shell.controller.ts:89-115`.
3. **Live writer:** pointer/key `sizeChange` writes only the host draft (`chat-view.component.html:298`; `chat-view.component.ts:1194-1211`); `sizeCommit` clears the draft, skips an unchanged shell-clamped width, then calls `commit`, whose sole persistent write is guarded `setItem(String(value))` (`chat-view.component.ts:1229-1239`; `inspector-dock-width.store.ts:61-71`). Drag cancellation clears the draft without a storage write (`chat-view.component.html:300`; `split-handle.component.ts:283-289`).
4. **Reset writer:** double-click clears the draft and calls guarded `removeItem`; `null` preference selects the current shell default (`chat-view.component.html:301`; `chat-view.component.ts:1241-1245`; `inspector-dock-width.store.ts:73-81`).
5. **External writer/read:** a same-key, same-`localStorage` `storage` event updates only the preference; `newValue:null` restores the default, malformed values are ignored, and the listener is removed on destroy (`inspector-dock-width.store.ts:51-59,100-120`). During a drag, the draft takes precedence; cancelling reveals the synced preference (`chat-view.component.ts:1205-1211`).
6. **Exit:** the computed width is applied to the dock and ARIA separator (`chat-view.component.html:295-297,322,337`); sheet width is left to CSS (`chat-view.component.html:322,337`; `chat-view.component.css:52-64`). The fractional clamp gap is at this last step.

## Parity and edge checks

The Session tab, header toggle, scrim, sheet `inert`, and focus return route through one controller (`chat-view.component.html:32-45,306-330,385-400`; `inspector-shell.controller.ts:293-335,433-451`). The Session tab opener is passed to `toggle` (`chat-view.component.ts:1216-1222`); a header toggle uses the attached header fallback (`chat-view.component.ts:1003-1012`; `inspector-shell.controller.ts:307-311`); the Canvas Rail board's existing no-argument use remains supported (`inspector-shell.controller.ts:293`). Docked-to-sheet, sheet-to-docked and tab-switch paths retain their existing state rules (`inspector-shell.controller.ts:338-345,401-421`). The linked signals reset draft and animation state when the handle slot disappears, including destroy mid-drag (`chat-view.component.ts:1180-1202`); the handle releases listeners and capture without emitting destroyed outputs (`split-handle.component.ts:207-210,295-319`).

The PLAN LIMITS inspector branch preserves the label, chip, value, progress semantics, footer, disclosure panel and hooks; `status`/`local-usage` have a plain face, while unknown window tiles remain expandable (`plan-limit-tile.component.ts:55-207,335-378`). The default strip branch remains separate (`plan-limit-tile.component.ts:208-331`). The parity-inventory's sections and Rail-board presentations are unchanged in the reviewed diff (`parity-inventory.md:63-101`; `git diff 9d5063f43^..5fc888d16`). Measured card overflow at 300/560 px and the 760 px sheet remains a visual-review item (`batches.md:64,341`); jsdom cannot establish it.

Search of changed behavior found no new `any`, `TODO`, stub or production `console.*`; the `console.warn` calls in `chat-view.component.ts:1520,2089` predate this diff. Focused verification: `npx nx run-many -t test -p @ptah-extension/chat-ui @ptah-extension/chat --parallel=1` succeeded; chat-ui was a local cache hit and chat ran. Nx Cloud reported a disabled organization after the successful targets. `ptah_get_diagnostics` was attempted twice on the five changed TypeScript sources, but TypeScript analysis remained unavailable after each 45-second timeout, so diagnostics do not support an additional conclusion. No build, e2e, screenshots or source edits were performed.

## Decisions

- Treat fractional CSS/ResizeObserver widths as valid runtime input: browser layout commonly yields subpixel measurements; the explicit 624 px floor and ARIA range make flooring the maximum the defensible reversible fix (`inspector-shell.controller.ts:75-82,106-115`; `task-description.md:146-167`).
- Treat pre-existing document body styles as shared state: restoring the previous inline value is reversible and does not change normal empty-style behavior (`split-handle.component.ts:227-229,307-309`).

## Verdict

- Recommendation: REVISE (deliverable verdict: REJECTED until AC 3.2 is met).
- Confidence: HIGH for the arithmetic failure; MEDIUM for the concurrent-style impact.
- Top risk: the shell-width clamp rounds a fractional maximum upward.
- A robust implementation would floor the effective maximum consistently, test fractional shell widths, and restore prior body cursor/selection styles after every drag exit.
