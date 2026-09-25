# Prototype — TASK_2026_494 (Apps page)

Static, self-contained prototype of the Electron-only Apps page: the Apps tab in the
shell tab row, the two-column Apps page (conversation + surface panel), a surface
switcher between one dashboard surface and one form surface, client-side sort/filter/page
on the dashboard table, row/point selection, the full `surface.submit` state matrix, the
fail-closed text fallbacks, the empty page, and the evicted notice.

This is the visual source of truth for TASK_2026_494. The real implementation and its
completion screenshots are checked against this prototype, not against
`design-spec.md`/`implementation-plan.md` prose directly.

## How to Open

Open `index.html` directly in any browser:

```
file:///D:/projects/ptah-extension/.claude-worktrees/feat-task-494-apps-page-98c5a1802772/.ptah/specs/TASK_2026_494_ca38/prototype/index.html
```

Automated captures used a local static server (the browser tool accepts only http/https):

```bash
npx http-server . -p 4873 -s
# http://localhost:4873/index.html  (requires ptah.browser.allowLocalhost)
```

Two screens:
- `index.html` — the main Apps page (Electron shell chrome, conversation column, surface
  panel with the two-surface switcher, dashboard surface, form surface with an inline
  "submit/form state" selector for quick spot-checks).
- `states.html` — the full state/fallback strip: all 8 submit-state branches side by
  side, the rejected-spec text fallback, the render-failure text fallback, the empty
  Apps page, and the evicted notice.

## Deviations

- **Local styling build not possible.** This worktree has no `node_modules` (verified:
  `node -e "require('./node_modules/tailwindcss/package.json')"` → `MODULE_NOT_FOUND`, and
  no `node_modules` directory exists at the worktree root at all), so the project's own
  `apps/ptah-extension-webview/tailwind.config.js` could not be run through the real
  Tailwind/daisyUI build to scan `prototype/**/*.html`. Per `PROTOTYPING.md`, the fallback
  is the daisyUI 4 + Tailwind CDN pair (`daisyui@4.12.10/dist/full.min.css`,
  `cdn.tailwindcss.com`), loaded in both HTML files' `<head>`.
- **CDN theme colors are not trusted.** The CDN build ships its own generic themes, not
  the project's `anubis`/`anubis-light`. `assets/app.css` is loaded after the CDN sheets
  and redeclares every daisyUI class the prototype actually uses (`.btn-primary`,
  `.tab`/`.tab-active`, `.card`, `.input`, `.select`, `.table`, …) with the literal token
  values copied from `apps/ptah-extension-webview/tailwind.config.js:70-189` — hex for the
  dark `anubis` theme, and the native CSS `oklch()` function (no hand conversion) for the
  light `anubis-light` theme's OKLCH strings, which are already in that file verbatim. See
  the header comment and per-block source citations in `assets/app.css`.
- **`tabs-lifted` dropped from the top navbar tab row (prototype-only).** The real
  `electron-shell.component.ts:124` uses `tabs tabs-lifted`. daisyUI's "lifted" active-tab
  visual is painted through the CDN build's own internal pseudo-elements/CSS variables,
  which this file cannot reliably override without the compiled source (confirmed by
  trial: even an `!important` override of `.tab-active` background left the CDN's own
  dark pseudo-element visible until `tabs-lifted` was removed entirely — see git history
  of this file). The prototype uses a plain custom `.tab`/`.tab-active` underline instead.
  **This is a rendering workaround for the CDN-only build, not a proposal to change the
  real component** — the real app compiles its own Tailwind/daisyUI and should keep
  `tabs-lifted` as-is; a developer should not read this prototype as asking for that
  class to be removed from `electron-shell.component.ts`.
- **Mock data.** Deploy rows, cost figures, incident text and the two surface titles are
  fabricated for the prototype. They are not sourced from any real tool output.
- **Capture limitations:** none. `ptah_browser_navigate`/`ptah_browser_screenshot` and
  `ptah.browser.allowLocalhost` were available; all screenshots below were captured live
  against a local static server.

## Screens & States

- **Main screen** (`index.html`):
  - Electron shell chrome: navbar, tab row with **Apps active** between Chat and Tasks
    (`design-spec.md` "Navigation sets"; `electron-shell.component.ts:122-170`, Apps slot
    comment at `:136`).
  - Apps conversation column: transcript (user bubble, assistant text, two
    `ptah_surface_update` tool cards), composer (textarea, Stop, Send), "New conversation".
  - Surface panel: `role="tablist"` switcher with 2 live surfaces.
    - **Weekly Deploy Cost** (dashboard-spec/2): 3 stats, line chart + bar chart (inline
      SVG, each with a chart/table toggle and one with an expand/collapse control), a
      sortable/filterable/paged table (42 mock rows, page size 25, one selectable row),
      and an ordered list.
    - **Rollback Request** (surface v2 form): `card` with `text`, `select`, `radio-group`,
      `checkbox`, one `surface.submit` button, and an inline prototype-only "submit/form
      state" selector cycling through all 9 states.
- **States screen** (`states.html`): the submit/form state matrix (8 cards: pending,
  applied, 4 rejected reasons, indeterminate, unknown), the rejected-spec text fallback,
  the render-failure text fallback, the empty Apps page, and the evicted notice.
- **Themes demonstrated**: `anubis` (dark, default), `anubis-light` (light) — the
  project's real theme names (`tailwind.config.js:68-190`, `daisyui.darkTheme: 'anubis'`).
- **Viewports demonstrated**: wide desktop, embedded sidebar (~420-container toggle),
  and a real narrow browser viewport (≈400px).

## Interactive Features

- Theme toggle: `anubis` ↔ `anubis-light` (top toolbar, both screens).
- Width toggle: wide desktop ↔ embedded sidebar (~420px container, `.viewport-sidebar`).
- Surface switcher: click a tab to swap the rendered surface (`role="tablist"`).
- Table: click a column header to cycle ascending → descending → original order
  (`aria-sort` updates); type in the filter box to narrow visible rows with a live text
  count; Previous/Next page controls; click a row (or `Enter`/`Space` on a focused row) to
  select it and show the "Selection sent to agent" notice, matching Req 6.
- Chart/table toggle per chart (`aria-pressed`).
- Expand/collapse on the Cost trend chart (`aria-expanded`; `Escape` closes and returns
  focus to the opening control).
- Form: all four input kinds are live; the "submit/form state" `<select>` drives the
  button/status text through every branch of the state table, including marking the
  Reason field `aria-invalid`/`aria-describedby` for `submit-invalid`.

## Project rules applied

- `[project-rule]` One primary action per surface (`btn-primary` reserved for Send /
  Submit; Stop, New conversation, chart/table toggle and expand controls are
  `btn-ghost`/`btn-outline`). Source: `ui-ux-designer` `SKILL.md` / `PROTOTYPING.md`
  Prototype Rules, "One primary action per surface".
- `[project-rule]` Status is a hint/badge/icon, never a button. Selection state is shown
  via `aria-selected` + a left accent on the row, not a clickable status chip. Source:
  `PROTOTYPING.md` Prototype Rules, "Status is not a button".
- `[project-rule]` No `text-base-content/40|50|60|80` alpha ladder for secondary text —
  `text-base-content-muted` is used everywhere secondary/label text appears. Source:
  `apps/ptah-extension-webview/tailwind.config.js:12-31` (TASK_2026_183 removal comment).
- `[project-rule]` Colored value text sits on a neutral tile surface
  (`bg-base-300/30` + `border-{tone}/20`), never on a solid filled `badge-success`/
  `badge-info`/`badge-error`. Source: `design-spec.md` "Accessibility", measured-contrast
  table (filled badges measured 2.64–3.87:1, all failing AA).
- `[project-rule]` Chart series carry a pattern (dashed stroke / hatched fill), not hue
  alone. Source: `design-spec.md` "Accessibility", "No color-only encoding"; Req 7.4.
- `[project-rule]` Stat cell layout (`bg-base-300/30 rounded px-2 py-1.5 border
  border-{tone}/20`, label `text-[10px] uppercase tracking-wider text-base-content-muted`,
  value `text-sm font-semibold tabular-nums text-{tone}`). Source:
  `libs/frontend/dashboard/src/lib/components/session-analytics/session-stats-card.component.html:51-86`,
  cited directly by `design-spec.md` "Catalog components" for the `stat` kind.
- `[project-rule]` Tool-call chat card treatment (`border-l-2`, `bg-base-300/30`,
  `role="alert"`, `text-[11px]` uppercase header with icon + label). Source:
  `design-spec.md` "Pin flow" (citing `QuestionCardComponent` / `PermissionRequestCardComponent`).
- `[project-rule]` State spine (`NativeCardComponent` tone → left-edge accent bar), used
  on the submit-state cards in `states.html`. Source:
  `libs/frontend/ui/src/lib/native/card/native-card.component.ts:109-124`.
- `[project-rule]` No color-only encoding for tile/submit states — every state pairs an
  icon and a text label, never color alone. Source: `design-spec.md` "Accessibility".
- `[project-rule]` Selectable rows are keyboard-reachable (`tabindex="0"`, `Enter`/`Space`
  activates); a chart/table toggle is a labeled, keyboard-reachable control
  (`aria-pressed`), never hover-only. Source: `design-spec.md` "Accessibility"; Req 7.1,
  7.3.

## Lane-introduced constraints

These are choices this prototype makes where the source documents (`design-spec.md`,
`task-description.md`, `implementation-plan.md`) left the specific treatment open. They
require explicit user approval at Gate 1.7 before a developer treats them as settled.

| Constraint | Tag | Rationale |
| --- | --- | --- |
| Below ~480px (a real narrow browser viewport) or in the embedded-sidebar container toggle, the conversation column and surface panel stack vertically instead of sitting side by side, and stat/chart grids collapse to one column. | `[lane-proposed]` | Neither `design-spec.md` nor `implementation-plan.md` specifies Apps-page behavior below desktop width — the design spec's "grid ... collapses to one column below sm" line is written for the v2 `grid` layout kind, not for the page shell itself. Two side-by-side 360px+ columns cannot fit in a ~400-420px width at all (verified by capture: see `screenshots/dark-populated-narrow-before.png` for the unfixed overflow), so *some* stacking behavior is required; this is one reasonable choice, not a mandated one. |
| Submit-state message text stays in plain `text-base-content` (no color) in every branch, including the four `rejected` reasons; only the icon and the card's left spine carry `warning`/`success`/`neutral` color. | `[lane-proposed]` | No document assigns tones to the *inline submit-state* text (the "Tile states" tone table in `design-spec.md` is for pinned dashboard tiles, out of scope here, TASK_2026_495). `design-spec.md`'s own measured-contrast table shows `text-error` on `base-300` at ≈3.17:1, which fails AA for small normal text, and states the mitigation as "lean on the spine plus icon instead of the text color" — this prototype takes that literally for every rejected/error-adjacent branch rather than only the ones the table happens to name. |
| Chart series distinguished by a dashed stroke (line chart) and a diagonal-hatch SVG pattern (bar chart), rather than any other pattern language. | `[lane-proposed]` | `design-spec.md` fixes "not hue alone" (Req 7.4) but not a concrete pattern vocabulary, and D5 (`implementation-plan.md`) only fixes "hand-rolled SVG, no dependency" — the specific patterns are this prototype's proposal. |
| `tabs-lifted` dropped from the shell tab row, replaced with a plain underline tab. | `[lane-proposed]` (prototype-rendering only) | See "Deviations" above — this is a CDN-fidelity workaround, not a proposal for the real component, which should keep `tabs-lifted`. Flagged here anyway so it is not silently read as a visual target. |

## Accessibility notes

- **Focus order** follows DOM order with no tabindex reordering: prototype toolbar →
  shell navbar (logo → tab row → config/theme/notification icons) → Apps page host
  (`#appsPageHost`, `tabindex="-1"`, a landing target only, never in the tab sequence) →
  conversation column (New conversation → composer textarea → Stop → Send) → surface
  switcher tabs → active surface's controls in visual top-to-bottom, left-to-right order
  (expand/collapse → chart/table toggle → filter input → sortable column headers →
  selectable rows → pager) or, on the form surface, (Reason input → environment select →
  strategy radios → notify checkbox → Submit).
- **Roles.** Surface switcher: `role="tablist"` / `role="tab"` / `aria-selected`. Table:
  native `<table>`/`<thead>`/`<tbody>` with `aria-sort` on the active sortable header;
  selectable rows use `role="row"` + `tabindex="0"` + `aria-selected`, **not**
  `role="button"` — `design-spec.md`'s "container is the activation target" rule was
  written for card-shaped tiles; putting `role="button"` on a `<tr>` would conflict with
  the row/cell structure assistive tech relies on inside a real `<table>`, so this
  prototype keeps table semantics and layers selection on top of them, which is the more
  correct application of the same rule's intent. Expand/collapse and chart/table toggle
  are real `<button>`s with `aria-expanded`/`aria-pressed`. Filter result count and
  selection notices use `role="status"`. Rejected-spec/render-failure fallbacks are plain
  `font-mono` text blocks, not toasts. `Escape` closes the one expanded panel and returns
  focus to the button that opened it (`index.html` `keydown` handler).
- **Contrast, dark theme (`anubis`).** Cited directly from `design-spec.md`
  "Accessibility", measured-contrast table (WCAG 2.1 AA, computed against the literal
  `anubis` values in `tailwind.config.js`): `base-content` on `base-100`/`base-300` ≈14.9:1
  / ≈12.3:1 (pass); `base-content-muted` on `base-100` 5.29:1 (pass); `text-success` on
  `base-300` ≈4.65:1 (pass); `text-warning` on `base-300` ≈5.47:1 (pass); `text-error` on
  `base-300` ≈3.17:1 (fails small normal text, UI-component/large-text only) — this is why
  the prototype never sets small rejected-state body text in raw `text-error` (see "Lane-
  introduced constraints" above); filled `badge-success`/`badge-info`/`badge-error` all
  fail outright (2.64–3.87:1) — this prototype uses none of them for readable text,
  matching the "Project rules applied" entry above.
- **Contrast, light theme (`anubis-light`): not independently re-measured here.**
  `design-spec.md` "Open questions" item 4 states this theme "was never audited" and
  tracks the gap as `TASK_2026_529_b482`; this prototype inherits that same disclosed gap
  rather than inventing new numbers. The mitigation is structural, not numeric: every
  place the dark-theme table flags a risk (filled badges, small `text-error`/`text-info`
  body text), the prototype avoids the risky pattern in *both* themes by construction
  (outline/tinted "pill" style instead of filled badges; state-message text never colored
  small text), so the un-audited light-theme numbers do not gate anything this prototype
  actually renders. `base-content-muted` on `base-100` for `anubis-light` is the one
  number `tailwind.config.js:159-161` states directly in its own comment (5.01:1, pass);
  no other light-theme pair here is asserted with a number.

## Parity Mapping

No `parity-inventory.md` exists for this task (TASK_2026_494 is new-surface work, not a
migration — `task-description.md` "Scope" lists no prior UI being replaced). Instead, this
maps the prototype directly to the task's own acceptance criteria:

| Requirement | Prototype Location | Visual Treatment |
| --- | --- | --- |
| Req 1.1-1.2: Apps tab between Chat and Tasks, active state | `index.html` navbar tab row | `role="tab"`, `aria-selected`, active underline |
| Req 2.7: empty state with request input | `states.html` "Empty Apps page" | Composer visible, centered icon + copy, no blank area |
| Req 3.5: rejected spec → mono fallback, transcript still visible | `states.html` "Spec rejected" | `font-mono` block; main screen's transcript pattern shown alongside |
| Req 3.6: render failure → text fallback, no partial tree | `states.html` "Render failure" | `font-mono` `renderSurfaceText`-style output |
| Req 4.1: stat/chart/table/list visual treatment | `index.html` Weekly Deploy Cost surface | Stat cells, SVG line/bar charts, sortable table, ordered list |
| Req 4.1 (v2 kinds): section/card/stack/grid, text/select/radio-group/checkbox | `index.html` Rollback Request surface | `card` with all four input kinds + `surface.submit` button |
| Req 5.1-5.3: client sort/filter/page, page size 25 | `index.html` Recent deploys table | `aria-sort` cycling, live filter count, Previous/Next pager over 42 mock rows |
| Req 6.1: selection sent to host | `index.html` table row click | "Selection sent to agent: row N (…)" `role="status"` notice |
| Req 6.6 / D4 state table: full submit/form state matrix | `states.html` "Submit / form state matrix" + `index.html` inline selector | 8 states, each with its literal copy from `implementation-plan.md` Component 5 |
| D3 `deleted`/`evicted`: eviction notice | `states.html` "Evicted notice" | "This app was removed to free memory. Ask the agent to rebuild it." |
| Req 7.1-7.4: expand/collapse, chart/table toggle, series patterning | `index.html` Cost trend chart | `aria-expanded`, `aria-pressed`, dashed/hatched series |
