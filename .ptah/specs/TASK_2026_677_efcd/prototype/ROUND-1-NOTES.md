# Prototype Round 1 notes (Gate 1.7 revise)

Source of findings: `../design-spec-review.md` (findings 1-8). Open `index.html` in a browser; every state below is a URL
(`?ask=multi&theme=light` ...) and a button in the prototype bar. Screenshots: `screenshots/<theme>-<state>.png`
(`dark` = anubis, `light` = anubis-light), regenerated with `node assets/capture.mjs shots`.

Verification tooling (prototype only, not product code): `node assets/capture.mjs checks` (real-keyboard focus paths, target sizes),
`node assets/capture.mjs measure` (layout offsets), `node assets/contrast-check.mjs` (contrast pairs).

## Finding 1 - parity surfaces (prototype side)

Shown with `?parity=1` (prototype bar: "Show retained surfaces"; "Reference view" turns them off). Hidden by default so the reference look is unchanged.

| Capability | File / selector / function | State name |
| --- | --- | --- |
| Branch and rewind on the user message | `index.html` `.cs-user-actions` (two instances), CSS `.cs-user-wrap:hover .cs-user-actions`, `body[data-parity='true']` | `parity=1` |
| Message attachments | `.cs-attach` / `.att` | `parity=1` |
| Origin line | `.cs-origin` | `parity=1` |
| Collapsed tool / file counts | `.cs-worked` header text "6 tools / 3 files" | default |
| Per-message tokens / cost / duration | `.cs-activity` (`#act1`, `#act2`), toggled by `.act-toggle` | `Show activity` pressed |
| Compaction marker, summary, continuation | `.cs-divider`, `#compSum`, `.cs-turn--cont`; `setParity()` in `app.js` | `parity=1` |
| Context / usage / budget | `orchHTML()` (`#ctxBar`, `#usage`) | default; partial `body=partial` |
| Background tray | agent row `Background` kind in `agentsHTML()` | default |
| Permission and question cards | `.q-card` (`#qCard`), request rows (see finding 2) | `ask=question`, `ask=lane*` |

Genuine removals are a spec-side decision and are not made in the prototype.

## Finding 2 - request routing states

All in `assets/app.js` (`mkReqs`, `lineHTML`, `reqHTML`, `panelHTML`, `decide`, delegated click handler) and `assets/app.css` (`.req`, `.req-panel`, `.req-msg`, `.more`, `.req-more`).

| State | How to reach | Selector / function | Screenshot |
| --- | --- | --- | --- |
| Single lane permission row | `ask=lane` | `reqHTML('gemini')`, `[data-act="review"]` | `*-collapsed-wide` |
| Review panel open (idle) | `ask=lane-open` | `panelHTML()` `.req-panel[aria-busy=false]` | `*-request-review-open` |
| Sending | click Allow / Deny | `ui.panel[key]='sending'`, `aria-busy=true`, buttons disabled | transient (520 ms) |
| Error with Retry | `fail=1` or "Simulate send failure", then Allow | `.req-msg--err[role=alert]`, `[data-act="retry"]` | `*-request-error-retry` |
| Success | Allow / Deny completes | request removed, focus to next request or lane row, live region `#announce` | n/a (row disappears) |
| Closed elsewhere | bar button "Lane finishes (close requests)" (`#laneEnds`) | `r.closed`, `.req-msg[role=status]` + `[data-act="dismiss"]` Close | `*-request-closed-elsewhere` |
| Question row | `ask=question` | request `kind:'question'`, `[data-act="answer"]`, `#qCard` | `*-request-question` |
| Several simultaneous (5) | `ask=multi` | `+N more` button `[data-act="more"]` and `.req-more` list | `*-requests-several` |
| `+N more` expanded | click `+2 more` | `ui.more[owner]`, `aria-expanded=true` | `*-requests-more-open`, `*-narrow-400-multi-more-open` |
| Electron single chat (no lane surface) | `host=electron` | `state.host==='electron'`: lane requests are answered in place in the panel (Allow / Deny), the `Open lane` link is not offered because there is no lane surface | `*-request-electron-fallback` |
| Rail / VS Code | `host=rail` | `Open lane` link `[data-act="open-lane"]` | default |

De-duplication: a request has one identity (`key`: `lane:<owner>:<n>`, `perm:<n>`, `q:<n>`). `needCount()` counts unique open
keys, so a question that also marks its lane waiting counts once. The chip text and the needs-you dot read from the same function.

## Finding 3 - data contract states

Partial and unknown presentation: `body=partial` (`orchHTML(partial)`, `agentsHTML(partial)` with `data-partial="true"`,
`todosHTML(partial)`); `body=loading` (skeleton rows `sk()`); `body=error` (Git error + `[data-act="retry-git"]`); `body=empty`.
Ahead/behind counts are not drawn in the Git section (hidden until the source exists). Spec-side acceptance gates are in design-spec.md.

## Finding 4 - overlay focus management (400 px sheet)

`assets/app.js`: `overlayNow()`, `applyModal()` (sets `main.inert`, `role=dialog`, `aria-modal`), `openInsp()` (focus to `#inspClose`),
`closeInsp(returnTo)` (single funnel for every close path), `focusables()` + keydown trap (Tab / Shift+Tab wrap), innermost-first Escape
(request panel, then sheet). Close paths covered: Esc, Close button `#inspClose`, scrim `#scrim`, completing an action (Answer),
all return focus to `#inspToggle` (or to the question card for Answer).

Evidence: `node assets/capture.mjs checks`, section A (in-page, four paths: all PASS) and section B (real keyboard at 400 px: entry,
inert, trap, panel-then-sheet Escape, Enter on Close: all PASS). Screenshot with keyboard focus ring on the Close button:
`*-narrow-400-overlay-focus`. Docked mode: tab order puts the inspector after the composer (check C).

## Finding 5 - hit targets

`.btn-sm`, `.more`, `.link-btn`, Retry: min 24 x 24 px (measured: Review 63x28, Answer 66x28, Allow/Deny 56x28, Open lane 70x24,
Retry 42x24, +N more 56x24, both at 1594 px and 400 px; check D/E in `capture.mjs checks`). Radio / checkbox inputs in `.q-opt`
are 16 px glyphs inside a 28 px-high label that is the activation target. Command text wraps; the button keeps its size.

## Finding 6 - one-to-one fidelity

Measured at 1594 px (`capture.mjs measure`) against `reference/02-session-shell-with-inspector.png`:

| Element | Reference | Prototype |
| --- | --- | --- |
| Main column content x | 273 | 273.5 |
| User bubble x | 415 | 415.5 |
| Header height | 48 | 48 |
| Composer x / width | 250 / 757 | 249.5 / 758 |
| Composer height, gap to shell bottom | 134, 18 | 135, 17 |

The 6 px offset is gone. Intentional departures from the reference images (each carries a `data-departure` attribute):

- `data-departure="codex-brand-mark"` on the Codex mark: `index.html` chips (`.chip[data-agent=codex] .mark`), log tool row, and
  `agentsHTML` through `mark()`. The reference shows a generic `>_`; the product has a Codex slug in `ptah-provider-mark`, so the
  prototype uses the branded mark. Gemini keeps the Terminal icon (no slug exists).
- `data-departure="review-button"` on the Review button in `lineHTML()`: the reference permission row has text only; the button is
  added so a waiting request is actionable (finding 2).

## Finding 7 - contrast

`node assets/contrast-check.mjs` now audits the actual ring token per theme on all four surfaces: dark `--s` gold 7.43 to 8.81:1,
light gold-strong 5.26 to 6.28:1 (UI minimum 3:1), plus `--ptah-link` text 5.26 to 8.81:1 (text minimum 4.5:1). The plain light
gold on surface-1 measures 3.71:1 and is NOT used for ring or text; the row is printed to show why gold-strong is required.
The prototype uses `outline-color: var(--ptah-gold-strong)` for `anubis-light` (`app.css` focus-visible rule). No failing pair.
Third-party themes: not audited in the prototype (spec-side decision: fallback ink rule).

## Finding 8 - icons

Lucide names used and confirmed canonical in lucide-angular 1.0.0 by the orchestrator: `PanelLeft`, `PanelRight`, `GitBranch`,
`ShieldAlert`, `LoaderCircle`, `TriangleAlert`. Prototype sprite ids: `i-panel-left`, `i-panel-right`, `i-git-branch`, `i-shield-alert`,
`i-loader-circle`, `i-triangle-alert` (`assets/sprite.js`).

## Lane-introduced constraints

none new this round (existing `[lane-proposed]` rules are tracked in README.md).

## Left / not done

- `host=electron` answers lane requests in place with no Open-lane link; the real Electron wiring (a CLI permission surface does not exist there today) remains an implementation dependency.
- Third-party theme contrast not measured.
