Verdict: REVISE

Reviewer: independent Gate 1.7 review (read-only). Scope: design-spec.md, prototype/index.html, 8 screenshots, task-description.md, parity-inventory.md, real theme sources.

## Findings

1. **Blocking: `prototype/README.md` is missing.** `prototype/` holds `index.html` and 8 PNGs only. The role contract requires `index.html`, `README.md`, `screenshots/` and a `## Lane-introduced constraints` section in the README (list `[lane-proposed]` rules or `none`, tag project rules `[project-rule]` with sources, cross-reference parity-inventory). Fix: add README.md with those sections. The screenshots are also not in a `screenshots/` subfolder; move them or state the deviation.

2. **Blocking: no `## Lane-introduced constraints` section anywhere.** `grep` finds it in neither design-spec.md nor a README. Gate 1.7 cannot confirm which rules are project-derived. Fix: add the section. See my candidate list below.

3. **Serious: invented token `border-surface-border-strong` (design-spec.md, Markdown reader spec, blockquote rule).** `tailwind.config.js:37-41` defines only `surface-0..3` and `surface-border`. No "strong" border exists. The prototype computes `--strong` itself (`color-mix(... bc 22% ...)` in index.html line ~10). The spec says every value traces to a token. Fix: use `border-surface-border` or `border-base-content/20`, or flag it as `[lane-proposed]`.

4. **Serious: board lane count/width claim and horizontal scroll.** The spec says "six status lanes at 240px minimum" at 1280px (6x240+5x16 = 1520px). Screenshots board-*-1280.png show 5 lanes cut off, with Done clipped and Cancelled hidden. The spec admits scroll "belongs to the board only", but the user asked for a design that does not feel broken, and the Done count "7" is clipped at the edge. Fix: pick one of (a) collapse empty or terminal lanes (Cancelled) into a narrow rail or toggle, (b) `minmax(200px,1fr)` lanes so 6 fit at 1280 (6x200+80 = 1280 minus padding; tight, so combine with (a)), (c) keep scrolling but add edge fade or scroll-snap and a visible "Cancelled" count in the header. State the choice in the spec.

5. **Serious: card footer cramped (board-dark-1280.png, board-light-1280.png, featured card).** "Discovery", "8 files + folder" and "Open →" sit in three narrow columns; "8 files + folder" and "Open →" wrap onto two lines. Fix: footer as two rows (stage + file summary on row 1, Open as a `btn btn-ghost btn-xs` aligned right on row 2), or drop "Open →" because the whole card is the open target (cards already carry `role=button`). Keep the file summary on one line (`8 files`, with the folder in the tooltip or detail view). Note that nested "Open" inside a role=button card is a nested-interactive a11y problem; remove it or make the card a link with a separate checkbox.

6. **Serious: prototype shows its own app chrome (PTAH wordmark, "Light theme" toggle, "Tasks / Spec folder" title) that production does not own.** In Electron the global navbar owns branding and theme, and the chat shell hides its own header (`app-shell.component.html:117`, `[class.hidden]="isElectron"`). A gold Cinzel "PTAH" lockup plus a theme toggle in the Tasks header duplicates the shell and is not in the token map or parity inventory. Fix: remove them from the prototype or label them "prototype-only" in the README. Do not let the spec imply they ship.

7. **Minor: native `select` controls are taller than the sibling buttons (board-*-1280.png, filter row; selects about 38px vs buttons 32px, with larger font).** This reads as inconsistent controls. Fix: `select select-bordered select-sm` and `input input-bordered input-sm`, same 32px height and `text-sm`.

8. **Minor: dark-theme horizontal scrollbar renders white (board-dark-1280.png, bottom of board).** This is a prototype omission (`color-scheme`). Fix: `color-scheme: dark|light` per theme in the prototype so the screenshot is faithful.

9. **Minor: light-theme button radius is not faithful.** `tailwind.config.js:221` sets `--rounded-btn: 2rem` (pill) and `--rounded-badge: 1rem` for `anubis-light`, but the prototype's light buttons and badges show about 8-10px radius. The spec's `rounded-btn` is right; the prototype and screenshots are not. Fix: use `--rbtn:2rem` in the prototype's light theme, or note it. The 760px light screenshot's chips will become pills.

10. **Minor: citation inaccuracies.** Token map row "Primary/secondary actions" cites `cli-matrix-styles.ts:14,16`, but those lines are `CLI_MATRIX_CELL_BASE` and `CLI_MATRIX_ACTION` (`btn btn-ghost btn-sm` only). `btn-primary` is not used there; it comes from daisyUI theme `primary` (`tailwind.config.js:89-91,161`). Cite that instead. The `Link` row cites `styles.css:137-146`, which holds the `--ptah-link` variable, while the underline rule is the spec's own, so tag it as such. The `Canvas` row cites `styles.css:159`, which is correct for `--surface-0`.

11. **Minor: accessibility measurement missing.** The spec says muted text "meets the theme contrast ladder" and cites the config comments (anubis 5.66:1 on base-200, anubis-light 5.39:1), but records no measured pairs for the new combinations the spec introduces: `--link` on `surface-2` and `surface-3` in both themes; `state-*` ink on `surface-2`; `primary-content` on `primary` (spec relies on config comments: light 6.99:1); gold focus/selected edge. The role requires the criterion and measured pairs. Fix: add a small table (WCAG AA 4.5:1 text, 3:1 UI).

12. **Minor: focus outline colour.** Using `outline-base-content` on `bg-primary` buttons (light teal) is fine, but on selected cards with the gold ring (`ring-2 ring-primary` on dark = blue) the featured card in the screenshots shows a gold border, not `ring-primary`. Make the prototype match the spec (spec says `ring-2 ring-primary`; prototype uses gold `--gold`).

## Checks requested

- **1 Token fidelity: pass with the notes above.** The primary button is blue (`#2563eb`) in dark and teal (`oklch(85% .138 181)`) in light. That is exactly what `anubis` and `anubis-light` define (`tailwind.config.js:89` and `:161`). It is not a prototype error; light uses dark `primary-content`, and the prototype copies it.
- **2 Design-language fit:** surfaces, borders, shadows, mono IDs, and button hierarchy match chat/Settings. Mismatches: findings 6, 7, 9.
- **3 Spec-folder fidelity and markdown reader (AC 2, 3, 3a, 4): met in design.** On-disk vs expected split, Present/Missing/Legacy, `prototype/` as Folder (not markdown), the folder-name-identity note and the five rejection states are specified. The reader uses `ptah-markdown-block` with `variant='auto'` (`markdown-block.component.ts:27-58`, verified). `task.md` is labelled machine-owned. Rapid-switch ordering is specified. Traversal/symlink/allowlist/size-cap rules appear in the file-list section (3a). Add the explicit extension allowlist and size cap values for the developer, since they are not given. The light-theme prose is shown rendered (detail-light-1280.png) with headings, link, list, table, code. Link is gold-strong and underlined: good.
- **4 Parity:** all 24 inventory rows map to a location (16 grouped rows in the mapping table; none omitted). "Proposed Removals: None" matches. No user-approval flags needed. Weak spot: "Disk-change push ... visible refresh state as needed" is vague; state the indicator (the "Updated just now" text in the status rail serves).
- **5 Layout:** findings 4, 5. At 760px (board-light-760.png) the toolbar wraps cleanly, with no page-level horizontal scroll, and only 2.5 lanes are visible (acceptable, list mode is the alternative). detail-dark-760.png stacks well (file rail, then reader) but the reader is pushed below the fold by the full file list; consider collapsing the file list to a select or disclosure at narrow widths so the reader is visible without scrolling.
- **6 Accessibility:** focus class is correctly sourced (`cli-matrix-styles.ts:11-12`) and applied universally; labels and text-with-colour status are good; light muted text is on the measured ladder. Gaps: findings 5 (nested interactive) and 11 (measurements).
- **7 Phase 2 placeholder:** dashed border, "Planned for Phase 2" badge, no buttons, no fake progress: clearly inactive. The label is `TASK_2026_358`, which is the correct id (the runner, per task-description.md). `TASK_2026_606` is the CLI label task and belongs to Phase 1, not the placeholder, so its absence there is correct. The Phase 1 CLI label shows "Run through codex v0.155.1." once (AC 6). Add the `''` fallback to the design (existing no-version text), since the spec omits it.
- **8 Lane-introduced constraints (candidates, needs the README section):**
  - `[lane-proposed]` minimum 32px keyboard targets, 36px primary actions (no project rule found).
  - `[lane-proposed]` 24px heading gap, 16px/1.6 body, `text-base leading-relaxed`; chat prose uses `prose-sm` (`markdown-block.component.ts:51-58`), so a 16px body is a deviation from the shared renderer and would need a `prose-base` variant, which changes the shared component.
  - `[lane-proposed]` "avoid alpha text classes" (the project does use `base-content-muted`; this is acceptable, but is a lane rule).
  - `[lane-proposed]` lane width 240px and 16px gutters, 248/268px rails.
  - `[lane-proposed]` Cinzel "PTAH" header lockup and in-view theme toggle (finding 6).
  - `[project-rule]` focus class (`cli-matrix-styles.ts:11`), `bg-surface-*` tokens, no unsanitized HTML, shared marked/DOMPurify (task-description NFRs).
  None of these removes a capability, so no user approval is required. The 16px prose point should be reconciled with the shared component before implementation.

## Token spot-check results (13 checked)

| Citation | Result |
| --- | --- |
| `tailwind.config.js:37-41` surface-0..3, surface-border | OK |
| `tailwind.config.js:31` base-content-muted via `--bcm` | OK |
| `tailwind.config.js:32-36` state-run/need/err/done/idle | OK |
| `tailwind.config.js:89-91` dark primary `#2563eb` | OK (prototype matches) |
| `tailwind.config.js:161-167` light primary teal, content dark | OK (prototype matches) |
| `tailwind.config.js:117,195` `--bcm` values | OK (prototype `--muted` values identical) |
| `tailwind.config.js:118-122,196-200` state inks | OK (prototype identical) |
| `tailwind.config.js:146-148` dark radii 0.75rem/0.375rem/0.25rem | OK |
| `tailwind.config.js:220-222` light radii 1rem/2rem/1rem | OK in config; prototype button radius wrong (finding 9) |
| `styles.css:159-163` surfaces/border formulas | OK (prototype `--s1`, `--s3`, `--border` match) |
| `styles.css:166-173` elevation shadows | OK |
| `styles.css:141-146` `--ptah-link` (gold dark, gold-strong light) | OK; prototype dark `#d4af37`, light `oklch(48% .12 70)` match |
| `cli-matrix-styles.ts:11-16` focus + action classes | Focus OK; btn-primary claim wrong (finding 10) |
| `app-shell.component.html:117` `bg-surface-1 border-b border-surface-border` | OK |
| `markdown-block.component.ts:27-58` `variant='auto'` | OK |
| `border-surface-border-strong` | Does not exist (finding 3) |

## Re-review (round 1)

Verdict: APPROVED

Scope: fixes for findings 1-12 only. Checked design-spec.md (incl. Revision log), prototype/README.md, prototype/index.html, all 8 screenshots (viewed board-dark-1280, board-light-1280, board-light-760, detail-dark-1280) and `apps/ptah-extension-webview/tailwind.config.js` (light radii at lines 220-222).

| # | Status | Evidence |
| --- | --- | --- |
| 1 | FIXED | `prototype/README.md` exists with Open, Screenshot index, Lane-introduced constraints and Parity sections; screenshots are in `prototype/screenshots/` (8 PNGs). |
| 2 | FIXED | `## Lane-introduced constraints` in design-spec.md (5 `[lane-proposed]`, 1 `[project-rule]`) and in README (5 `[lane-proposed]`, 4 `[project-rule]` with sources). README cross-references parity-inventory.md. |
| 3 | FIXED | `border-surface-border-strong` appears only in the Revision log row; reader blockquote now `border-l-2 border-surface-border`. Prototype no longer defines `--strong`. |
| 4 | FIXED | Spec Layout: five 220px lanes plus a 58px terminal Cancelled rail at 1280px; scrolling 242px lanes below 1100px. board-*-1280.png show all six statuses with counts (Done 7, Cancelled 0) fitting with no clipping. Cancelled is retained, not removed (parity intact). |
| 5 | FIXED | Footer is one line ("Discovery ... 8 files") in board-*-1280.png and board-light-760.png; nested Open button removed; title is a button sibling of the checkbox (index.html line 16); spec Lane/card row states this. |
| 6 | FIXED | PTAH wordmark gone; only a labelled "Prototype controls - Theme preview" strip remains, declared prototype-only in the spec and README constraints. |
| 7 | PARTIAL (Minor only) | `select select-bordered select-sm` / `input-sm` in index.html and the spec Filter bar row. In board-dark-1280.png the selects render about the same height as buttons; text still looks slightly larger. Not blocking. |
| 8 | FIXED | `color-scheme:dark` / `color-scheme:light` per theme in index.html; board-dark-1280.png scrollbar/native controls are dark. |
| 9 | FIXED | Light theme sets `--rbtn:2rem; --rbadge:1rem`, matching tailwind.config.js:221-222; light screenshots show pill buttons and chips. |
| 10 | FIXED | Primary action cites `tailwind.config.js:89-91,161-167`, ghost cites `cli-matrix-styles.ts:16`; Link row tags underline as "this specification". |
| 11 | FIXED | Accessibility section now states WCAG AA 4.5:1 text / 3:1 non-text and a table of measured pairs (link, muted, state inks, primary-content, ring, outline) for both themes. Measurements come from the prototype's copied theme values; spec says production must keep semantic tokens. |
| 12 | FIXED | `.card.featured` uses `box-shadow: 0 0 0 2px var(--primary)` plus a `--bc` outline; spec says `ring-2 ring-primary outline ... outline-base-content`; board-light-1280.png shows a teal ring with a dark outline (the 1.25:1 ring weakness is disclosed and covered by the outline). |

New problems introduced: no Blocking or Serious. Token claims spot-checked against tailwind.config.js (light radii, surfaces, `--bcm`, state inks) hold; no new invented token; no capability removed (Cancelled status kept as a rail, status rail text and parity table unchanged); no layout regression seen at 1280 or 760.

Non-blocking leftovers (already within the original Minor list, for the implementer): the Decisions table row "Keep 240px lanes scrollable at 760px" is stale against the 242px/220px/58px layout; align the number when implementing.
