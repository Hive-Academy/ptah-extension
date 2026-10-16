# Visual Review P4 - TASK_2026_646_136a - Batch 22 "Decision model" card

## Summary

| Metric | Value |
| --- | --- |
| Verdict | **NEEDS_FIX** (PASS once the two Serious findings are fixed or consciously accepted as inherited theme debt) |
| Overall score | 7/10 |
| Blocking (visual breaking) | 0 |
| Serious | 2 |
| Moderate | 3 |
| Minor | 4 |
| Viewports tested | 2 (1100 x 700 wide; 784 x 700 narrow, the smallest the window allows) |
| Themes | `anubis` (dark), `anubis-light` (light) |
| Screenshots taken | 98 PNG in `visual\batch-22-after\` (+ the 6 BEFORE PNG reused) |
| Components tested | the Decision model card (7 states), its editor (4 kinds), key field, 7-stop Tab walk, the six existing role cards |

Why 7: layout, the six old rows, state wording, locality sentences, secret handling, labels and focus rings are all sound and
match the siblings token for token. The score is held back by light-theme contrast of the editor controls (control borders
1.21:1, placeholders 3.28:1), which the new component itself intends to be stronger (it sets `border-base-content-muted`) and which
fails only in light. 8 would need those two fixed; 5-6 would need a layout or behaviour regression, and there is none.

## Environment

- Build verified: built in `D:\projects\ptah-extension\.claude-worktrees\646-after-shots` at `d8675a544` (contains `4a3b758c9`) with
  `npx nx build-dev ptah-electron` (exit 0) and `npx nx copy-renderer-dev ptah-electron` (exit 0). The renderer chunk contains
  `consumer-row-decision`, and the capture log lists 7 `consumer-row-*` and "7 roles", so the bundle under test is the feature code.
  BEFORE = `646-base-shots` at `c57a9a1e7` (not rebuilt).
- App: Electron driven by Playwright `_electron`, isolated profile (temp HOME, user-data-dir, DB, workspace). Real `~/.ptah` untouched.
- Viewports: 1100 x 700 dpr 1 (actual, logged); narrow request 700 x 700 was clamped by the window to 784 x 700.
- Standard: no accessibility standard is declared in the repository files read; WCAG 2.2 AA applied as the brief says (4.5:1 text,
  3:1 components and focus, 24 x 24 CSS px targets, 2.5.8). Colours measured in sRGB after alpha compositing (oklch resolved through a canvas).
  Details of method, seeding and limits: `visual\batch-22-after.md`.

## Findings by severity

### Visual breaking

None. No layout break, horizontal document scroll, overlap, clipped content or unusable control at 1100 or 784 px
(`docScrollW` = `innerW` in every measurement; no clipped element except the intended truncated cell label, see Moderate 3).

### Serious

#### S1. Light theme: editor control borders are 1.21:1 against their surround (WCAG 1.4.11 needs 3:1)

- File: `libs/frontend/chat/src/lib/settings/providers/decision-model-row.component.ts:45-46` (`SELECT` and `INPUT` classes, `border-base-content-muted`).
- Viewport / theme: 1100 and 784, `anubis-light` only. Dark passes (no control below 3:1).
- Screenshots: `after-decision-default-editor-jev-light.png`, `after-decision-default-editor-unset-light.png`,
  `after-decision-ollama-unreachable-editor-light.png`; numbers in `after-decision-metrics-run1.json` (`select#decision-kind border 1.21`,
  `input#decision-model border 1.21`, `input#decision-jev-key border 1.21`).
- Problem: in light the kind select and the model/key inputs sit on `#faf7f5` inside a `#faf7f5` popover; the border is nearly the same
  colour, so the field boundary is barely visible (see the pale outlines in the Jev light shot). The class that is meant to make the border
  readable does not take effect in light.
- Impact: low-vision users in the light theme cannot see where the picker and the fields are, including the write-only key field.
- Same pattern exists on the shipped sibling: the Synthesis editor selects and manual-ID input measure 1.21:1 in light and 1.07 to 1.42 in dark
  (`after-decision-sibling-synthesis-editor-light.png`, metrics `after-decision-metrics-sibling.json`). So this is inherited, but the
  new card can fix itself without waiting for the shared change.
- Fix: give `SELECT` and `INPUT` a border colour with at least 3:1 in both themes (a theme token that resolves darker in light, for example
  the stronger `base-content` mix), then re-measure in light.

#### S2. Light theme: placeholder text is 3.28:1 (WCAG 1.4.3 needs 4.5:1)

- File: `decision-model-row.component.ts:46` (`INPUT`, no placeholder colour) and the placeholders at `:234-236` ("jev-1.13.0") and `:265` ("Enter a new key to store it").
- Viewport / theme: 1100 and 784, `anubis-light` (`#928594` on `#faf7f5`). Dark: not flagged.
- Screenshot: `after-decision-default-editor-jev-light.png`, `...-jev-light-700.png`.
- Problem: both Jev placeholders are faint. "Enter a new key to store it" is the only inline cue for the key field; the "Empty uses jev-1.13.0."
  help line below (6.04:1) restates the model default, which softens the model placeholder but not the key one.
- Impact: the instruction for the key field is hard to read in light. Sibling manual-ID placeholder has the same 3.28:1 (inherited token).
- Fix: set an accessible placeholder colour on `INPUT` (at least 4.5:1 in light), or move the key hint into the help text only.

### Moderate and minor

Moderate

1. **Raw runtime text as the status detail** (`decision-model-row.component.ts:318-324`, shot `after-decision-ollama-unreachable-card-dark.png`):
   the `unreachable` state shows "Detail: fetch failed", the Node error message from the host (`decision-model.probe.ts:169-173`
   passes `error.message` through). It is plain text, short and holds no secret or URL, and the contract allows `detail`, but the user cannot act on it.
   Suggest a host-side mapping to a sentence ("connection refused") or hiding generic runtime strings.
2. **No focus containment in the editor popover**: Tab after "Save decision model" leaves the editor for the page behind (the Subagent TTL select)
   while the editor stays open, and Escape no longer closes it once focus is outside (log: `editor still open: true`). Evidence:
   `after-decision-default-focus-07-dark.png`. The existing Synthesis popover behaves the same (Tab walk ends on `consumer-edit-judge`), so this is
   the shared `ptah-native-popover` behaviour, not this batch; report for the follow-up list.
3. **Truncated cell label at 784 px**: "Unset · code rank..." and "Ollama · tev1" ellipsise in the 202 px cell (`consumer-summary-decision`
   scrollW 118 > clientW 109/111). Matches the siblings ("Follows main age..."); the full text is the `title`/`aria-label`. Acceptable, listed so it is not a surprise.

Minor

4. "Remove stored key" is always rendered, also when no key is stored (`after-decision-jev-nokey-editor-dark.png`), because the status carries no
   "key stored" flag; clicking it then deletes nothing. Consider disabling or hiding it when the state is `no-credential`.
5. The editor footer "Unset saves at once ... Other choices save with Save, with Undo." (`:304-306`) also shows for Jev, but a Jev key write offers no Undo
   (`:532-533`). Copy is slightly wrong for the key case.
6. In dark the focus ring of "Remove stored key" touches the adjacent "Save decision model" button (no gap between them), `after-decision-default-focus-05-dark.png`.
7. All state badges ("unset", "ready", "not reachable", "not supported", "no credential") use the same neutral grey as "haiku tier" on the siblings, so the
   not-ready states are told apart by wording only (the message paragraph carries `role="alert"` for those, `:313`). Consistent with the siblings; no colour cue.

## Prototype fidelity

- Approved prototype: none required for this batch (an added row and its editor on an existing surface); no `prototype/` consulted.
- Fidelity assessment: NOT APPLICABLE. Compared instead against the siblings and against BEFORE.
- Before/after comparison (dark and light, 1100 x 700):
  - `batch-22-before\before-roles-viewport-dark.png` vs `batch-22-after\after-roles-viewport-dark.png`: the six old cards are identical (pixel compare of the card block:
    10 of 152 368 pixels differ, max channel delta 1; light 18 of 152 368, max delta 1). Differences in the page: badge "6 roles" to "7 roles", summary text gains "decision", a seventh card, and the time-limit row and the sections below move down by the card height.
  - `before-roles-viewport-light.png` vs `after-roles-viewport-light.png`: same result.
  - `before-roles-row-open-{dark,light}.png` vs `after-roles-row-open-{dark,light}.png`: the Synthesis popover content is identical (dark popover body 8 of 115 500 pixels, delta 1; light 0). The top card row in light differs by delta at most 4 (hover transition timing), in dark by 0.
  - `before-roles-section-*.png` vs `after-roles-section-*.png`: 702 x 342/344 vs 702 x 487/490, the 145 px added by the new card.
  - Result: Req 1.7 (six rows keep look and behaviour) holds visually.

## Viewport results

| Viewport | Screen | Checked | Status | Screenshot |
| --- | --- | --- | --- | --- |
| 1100 x 700 dark | Roles section, 7 cards | grid, summary "7 roles", no overflow, no doc scroll | PASS | `after-roles-viewport-dark.png`, `after-decision-default-viewport-dark.png` |
| 1100 x 700 light | same | same | PASS | `after-roles-viewport-light.png` |
| 784 x 700 dark | roles section | 2-column grid (new card alone in the fourth row), label ellipsis, doc scroll none | PASS | `after-decision-default-viewport-dark-700.png` |
| 784 x 700 light | same | same; Jev editor fits (`after-decision-default-editor-jev-light-700.png`) | PASS | `after-decision-default-viewport-light-700.png` |

The 700 px width could not be tested: the window is clamped to 784 px. At 784 px the shell navbar labels overlap a divider ("hub" row) and the page shows inner
horizontal scrollbars; these exist outside this batch's files (navbar and panes), `docScrollW` stays 784.

## Component and interaction results

| Component / state | Checked | Status | Screenshot |
| --- | --- | --- | --- |
| Card, unset (default) | badge "unset", cell "Unset · code ranking", sentence, 7th card in grid | PASS | `after-decision-default-card-{dark,light}.png` |
| Editor, four kinds | exactly Unset, Ollama decision model, TypeSafe Jev, Structured-output model (log and shot) | PASS | `after-decision-kinds-editor-kinds-{dark,light}.png` |
| Jev editor, key field | password input, value length 0 on open, "Enter a new key to store it", never prefilled; typed key masked; dropped on close; card still Unset after cancel | PASS | `...-editor-jev-*`, `...-jev-typed-*` |
| Ollama editor | free-text model with datalist, help line | PASS | `after-decision-default-editor-ollama-*` |
| Structured editor | provider select + model input, helper "Choose a provider to list its models." | PASS (no providers seeded) | `after-decision-default-editor-structured-*` |
| State unreachable | message + "Detail: fetch failed" + local sentence + "Set up Ollama" | PASS (Moderate 1) | `after-decision-ollama-unreachable-*` |
| State unsupported-endpoint | message + "Detail: Ollama 0.34.2 < 0.35.0" + local sentence + "Set up Ollama" | PASS | `after-decision-ollama-unsupported-*` |
| State ready (local) | message + local sentence, no set-up link | PASS | `after-decision-ollama-ready-*` |
| State no-credential (Jev, remote) | message + detail + "sent to TypeSafe Jev" sentence, no set-up link | PASS | `after-decision-jev-nokey-*` |
| Save / Undo toast, hover, loading, status-read-failed ("not reachable" + Retry) | not captured (see Limits) | NOT TESTED | - |

Req 1.1 to 1.5 and 1.7 are confirmed visually (row beside the six, "7 roles", four kinds, locality sentences local and remote, five states with set-up link where a provider has one).
Req 1.3, 1.6 and 1.8 are behaviour or backend items and were not exercised here (no save, no restart, no structured model).

## Design system compliance

Computed style of the new card against the Synthesis card (dark, `styleCompare` in the metrics): padding 12 px, radius 8 px, gap 8 px, background
`oklch(0.220459 0.011628 285.407)` (surface-2), name 12 px/700/16 px, badge 9 px/12 px with the same `base-300` fill, cell 12 px, padding-left 4 px, gap 4 px, cell width 202.7 px
(identical on both). The open card uses the `surface-3` shade like the siblings. No deviation. The only differences are content-driven (card height 137 vs 83 px, badge width).
No hard-coded hex colours in the template (token classes only); `text-[9px]` badge and `text-[11px]` action buttons follow the sibling convention.

## Accessibility audit

Contrast (WCAG 1.4.3, text; foreground on composited background; both themes, all states):

| Pair | Dark | Light |
| --- | --- | --- |
| Card name / cell / state message | 13.89:1 | 14.21:1 to 15.92:1 |
| Badge text (9 px) | 12.29:1 | 13.18:1 |
| Detail and locality paragraphs (muted) | 5.65:1 | 5.39:1 |
| Editor labels and help text (muted) | 5.07:1 | 6.04:1 |
| "Set up Ollama", "Retry", "Remove stored key" | 13.89:1, 13.89:1, 12.46:1 | 14.21:1, 14.21:1, 15.92:1 |
| "Save decision model" (enabled) | 4.82:1 (white on `#2563eb`) | 6.81:1 |
| Placeholders (Jev model, Jev key) | not flagged | **3.28:1 (S2)** |
| Control borders (select, inputs) | >= 3:1 | **1.21:1 (S1)** |
| Icons in the card (mark, chevron) | >= 5.65:1 | >= 3:1 |

- Focus (WCAG 2.4.7 and 1.4.11): every stop shows a solid 2 px outline with 2 px offset, `oklch(0.925 0.007 88.6)` in dark and `oklch(0.236 0.066 313)` in light, both far above 3:1 against their surface (about 14:1 and 16:1).
- Focus order (Jev editor, from the cell): Close, Decision model select, Jev model input, API key input, Remove stored key, Save decision model, then out of the popover (Moderate 2). DOM order equals visual order. `:focus-visible` true at every stop.
- Labels: every field has a `<label for>` (Decision model, Provider, model label that changes by kind, TypeSafe Jev API key) and `aria-describedby` to its help text; dialog has `aria-label="Choose the decision model"`; the cell button has `aria-label` "Decision model: <state>. Change", `aria-expanded`, `aria-haspopup=dialog`; the close button is labelled "Close"; not-ready messages carry `role="alert"` (source `:313`).
- Targets (2.5.8, 24 x 24 minimum): Close 24 x 24, Remove stored key 110 x 24, Save 137 x 32, selects and inputs 32 high, cell 202.7 x 32. All pass the minimum; the 24 px buttons are below the 44 px guidance (guidance only, not an AA failure).
- Secrets: the key input is `type=password`, `autocomplete=new-password`, value length 0 on open and after reopen, nothing from the host fills it; the card text for every state was captured (`cardText` in the metrics) and contains no key, URL or token. The only host text shown is the one-line `detail`.
- Text clipping and overflow: card and editor have no clipped text at 1100; at 784 only the cell label truncates (by design, full text in `title`/`aria-label`); `detail` uses `break-words`.

## Visual performance

- The card first shows "loading" with a "Loading…" `role=status` line, then settles; the capture waits for the badge to leave "loading" and it did in every scenario (the Ollama probe has a 1.5 s budget, the unreachable case answers at once).
- No layout shift was observed after settling. A first-paint shift of the cards below when the seventh card appears is expected (the section grows by 145 px).
- No animation jank was observed (no animation on the card beyond the shared hover transition).

## Verdict

- Recommendation: REVISE (NEEDS_FIX). Fix S1 and S2 in the new component's `SELECT`/`INPUT` classes and re-measure in light; everything else may be tracked.
- Confidence: HIGH for the card, the six old rows and the states captured; MEDIUM for save, Undo and structured-output behaviour (not exercised).
- Key concern: in the light theme the editor's field boundaries (1.21:1) and placeholders (3.28:1) fall under WCAG AA, on the same fields that take the write-only Jev key.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Rate S1/S2 Serious although the Synthesis editor has the same token result | Serious (new component fails AA on its own) / Moderate (inherited debt) | The card sets `border-base-content-muted` expressly for contrast and passes in dark only; the rule is not to soften a severity | Yes: the owner may accept it as inherited and file one shared token fix |
| Use the isolated `HOME/.ptah/settings.json` for the Ollama base URL | config.json / settings.json | `provider.<id>.baseUrl` is a file-based key (`file-settings-keys.ts:724,775`); run 1 proved the config.json seed ignored | Yes |
| Treat 784 px as the narrow viewport | 700 requested / 784 actual | window minimum clamps the content size, logged `docScrollW 784` | Yes |

## Limits

- Not captured: a successful save and its Undo toast, the status-read-failed state ("not reachable" + Retry; the shots labelled "not reachable" are the host-reported `unreachable`
  state), a stored Jev key, a configured structured-output provider with models, a non-loopback Ollama URL (remote locality), hover and active styles, restart persistence (Req 1.6).
- The four-kinds shot uses a screenshot-only `size=4` DOM tweak on the native select.
- Ollama and Jev probes ran against a throw-away local mock, a refused port and an empty isolated secret store; no real provider and no network call to Jev.
- Other sessions' processes ran in parallel during the capture (Nx, Jest, other Electron windows, an Ollama server); only this run's Electron instances were started, one at a time, and all closed (0 left from `646-after-shots`).

## Files

Review: `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\.ptah\specs\TASK_2026_646_136a\reviews\p4-visual-review.md`.
Capture notes: `...\visual\batch-22-after.md`. Screenshots, scripts, logs and metrics: `...\visual\batch-22-after\`.
