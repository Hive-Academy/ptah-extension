# Design elevation and visual-hierarchy audit

**Scope:** read-only audit of the webview/frontend source on 2026-10-07. No source, configuration, build, test, or Git state was changed. File/line references below are source evidence; visual observations are inferred from CSS and should be confirmed with the screenshot pass in the migration plan.

## Decision summary

The complaint is valid. Ptah has usable colour tokens, but no semantic surface/elevation contract. Components choose one of many locally composed `bg-base-100/200/300` values (often with an arbitrary alpha), an optional 10%-opacity border, and occasional unrelated Tailwind shadows. This creates ambiguous nesting: a card can be the same tone as its parent, a selected row can look like a raised panel, and a dark-theme black shadow has almost no visible edge.

Adopt four semantic surfaces, backed by a small, theme-aware elevation token set; make `section`, `card`, `tile`, `stat-card`, and `field` presentational UI primitives; then migrate one file-disjoint screen group at a time. Do not globally restyle `card` or reinterpret every `bg-base-*`: that would turn a carefully scoped visual migration into a high-regression theme change.

## Inventory and evidence

### Cross-cutting evidence

`rg` finds roughly 800 occurrences when counting `bg-base-[123]` and `shadow*` together under `libs/frontend`; the supplied focused count is approximately 700 background uses and 112 shadows. The surface spelling space is especially broad: `bg-base-200`, `bg-base-200/30`, `/40`, `/50`, `/60`, `/80`, and analogous base-100/300 forms. That is direct evidence that opacity is being used as a substitute for semantic elevation.

| Area                                               | Source evidence                                                                                                                                                                                                           | Current pattern / inconsistency                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App shell and title bar                            | `apps/ptah-extension-webview/src/app/app.html:12` page is `bg-base-100`; `libs/frontend/chat/src/lib/components/templates/app-shell.component.html` is the primary shell                                                  | Page base is clear, but shell/header boundaries depend on individual children rather than a named surface. **Unverified:** title-bar rendering may be in Electron chrome rather than this template.                                                                                                                                                     |
| Workspace and sessions sidebars                    | `workspace-sidebar.component.ts:39` `bg-base-200 border-r border-base-content/10`; `:43` header `px-3 pt-2.5 pb-1`; `:52` list `px-2`; `:59-60` selected item `bg-base-300`, default hover same                           | Sidebar is a valid panel, but has no durable panel edge beyond a translucent border. Active row uses the darkest/loudest local surface with no active inset/top highlight; spacing moves from 12/10/4px to 8px without a scale. Sessions sidebar has the same likely risk; exact session-shell locations remain **unverified** in this time-boxed read. |
| Chat canvas/grid tiles                             | `chat-view.component.html:23` `p-1 bg-base-200/30`; `:242` editable summary `bg-base-200 hover:bg-base-300 rounded px-2 py-1`                                                                                             | Canvas nesting starts with a translucent panel, so child tiles frequently lack a perceptible plane change. The grid has no shared tile primitive to impose padding, radius, border, and interaction state.                                                                                                                                              |
| Transcript bubbles, execution nodes, tool rows     | `chat-view.component.html:23,242`; styles include a special code-block shadow at `styles.css:944-953`                                                                                                                     | Message, tool, and execution surfaces use independently authored shades. Code blocks receive a one-off shadow, while adjacent execution/timeline rows often do not, so emphasis follows implementation detail rather than information hierarchy. **Unverified:** complete bubble/node inventory needs visual traversal of dynamic transcript states.    |
| Agents panel and lane cards                        | `libs/frontend/chat/src/lib/settings/ptah-ai/agent-orchestration-config.component.ts`; `lane-guards-settings.component.ts`; `styles.css:739-767` agent badge colours                                                      | Agent identity has deliberate branded accents, but no shared lane/card surface. The result risks colour-coded chips on indistinguishable parent/child planes; lane guard groups are especially dense.                                                                                                                                                   |
| Settings (session budget, lane guards, CLI matrix) | `chat-view.component.spec.ts:2253+` identifies session-budget wiring; `lane-guards-settings.component.ts`; `cli-orchestration-matrix.component.ts`; `styles.css:275-305` contains Settings-only state overrides           | Settings contains custom focus/disabled handling but lacks a shared section/field contract. Tables, forms, guards and matrix cells therefore make independent border/background/padding choices. This is a major density/alignment issue rather than merely a shadow issue.                                                                             |
| Analytics cards                                    | `dashboard/.../analytics-card.component.ts` and `.html`; `harness-card.component.ts:99` uses `card bg-base-200/40 border border-warning/30 shadow-sm`                                                                     | The analytics area mixes DaisyUI `card` with translucent custom cards. The cited harness warning card is one of the few with a shadow, but the shadow is `shadow-sm` while its border is semantic warning; comparable neutral stats do not necessarily receive the same affordance.                                                                     |
| Thoth                                              | Global brand/ornamental treatment at `styles.css:337-367` (`glass-panel`, inset highlight) and `:443-446` aura shadows; Thoth scenario sources under `libs/frontend/webview-e2e-harness/src/lib/scenarios/thoth/`         | Thoth's decorative glass/aura language creates depth, but it is not a reusable elevation system and can compete with content. **Unverified:** production Thoth component locations were not conclusively isolated from the dashboard lazy tabs.                                                                                                         |
| Marketplace (the useful “raw model” reference)     | `marketplace/ui/storefront-surface.styles.ts:12` rounded-2xl, base gradient, border, `p-6`; `ui/stat-card.component.ts:75` rounded-xl, border, solid `bg-base-200`, `p-4`; `overview-page.component.html`; shell template | Marketplace does the most right: stable solid card backgrounds, explicit border, predictable `p-4`/`p-6`, visibly differentiated hero and cards, and restrained hover translation. It still has no semantic shadow/top-highlight token, so is a strong source pattern—not an exception to standardise by copy/paste.                                    |
| Modals, popovers, dropdowns                        | `ui/overlays/dropdown/dropdown.component.ts:63` `bg-base-200 border-base-300 rounded-lg shadow-lg`; `popover.component.ts:69` same with `shadow-xl`                                                                       | Overlays are the only consistently raised family, but Dropdown uses `shadow-lg`, Popover `shadow-xl`, both use base-200. That differs from native overlay variants and makes elevation a component implementation detail.                                                                                                                               |
| Inputs, selects, toggles                           | `styles.css:290-305` has Settings-scoped disabled/focus behaviour; `workspace-indexing.component.html:77` `rounded-md border-base-300 bg-base-200 p-2`; `chat-view.component.html:242` custom edit field                  | Inputs mix DaisyUI control classes and hand-built `bg-base-200` boxes. Many field wrappers lack a consistent label/help stack or field padding; input heights are not governed by density.                                                                                                                                                              |

Other representative surface drift: Cron Scheduler stats use `bg-base-200/40 border-base-content/10 shadow-sm` (`cron-scheduler-tab.component.ts:192-255`) while Messaging Gateway duplicates the same near-pattern with `rounded-2xl` (`messaging-gateway-tab.component.ts:198-258`) and other panels use `/30`, `/50`, or `/60`. Similar intent is therefore represented by different surface and radius recipes.

### What is already healthy

The base colours themselves are not the problem. The custom Anubis theme deliberately defines `base-100 #131317`, `base-200 #1a1a20`, and `base-300 #242430` (`tailwind.config.js:91-100`), and `base-content-muted` has a measured all-theme fallback (`:15-31`). Global CSS has a disciplined `@layer components` convention (`styles.css:269-307`) and accessibility-specific overrides. Preserve those practices and add semantic elevation alongside them.

### Precedent to follow: `base-content-muted` / `--bcm`

This is the implementation pattern elevation should use. `tailwind.config.js:14-31` registers `text-base-content-muted` as `oklch(var(--bcm, var(--bc)) / <alpha-value>)`. Custom Anubis values live with custom theme definitions, while `styles.css:120-148` documents and supplies per-`[data-theme]` values for DaisyUI themes. `base-content-muted.spec.ts` enumerates configured themes, parses committed values, and measures contrast. `TASK_2026_186` therefore solved the same product problem: DaisyUI supplies a useful base variable, but Ptah needs a calibrated project semantic with an executable regression guard.

Surface/elevation should copy that architecture, rather than rely only on a `color-mix()` formula assumed to suit every theme:

1. Define generic DaisyUI-4-derived fallbacks (`--b1`, `--b2`, `--b3`, `--bc`) so a new theme degrades coherently.
2. Register Ptah semantic variables with stable names: `--pts0` through `--pts3`, `--ptsb`, `--ptsh`, `--ptse1`, and `--ptse3`. Classes consume only those project tokens.
3. Commit measured overrides in the same locations as `--bcm`: custom values in `tailwind.config.js`; named DaisyUI theme values in `styles.css` under `[data-theme='…']`. Components must not classify a theme as dark/light themselves.
4. Add `surface-tokens.spec.ts` beside `base-content-muted.spec.ts`. It should derive theme names from `tailwind.config.js`, require/document overrides or fallbacks, parse token values, and verify adjacent surface distinction plus non-text contrast for interactive borders/highlights. Screenshots remain necessary because contrast arithmetic cannot validate perceived depth.

Surface contrast has no single WCAG AA ratio. The spec should set measurable structural invariants (for example delta-lightness/delta-E between adjacent planes, and 3:1 for interactive boundaries/focus indicators) rather than falsely applying text-AA to panels.

## Root causes

1. No named `surface-*`, border, highlight, or shadow tokens exist. A search found no elevation/surface token contract; developers select raw DaisyUI bases and alpha at point of use.
2. DaisyUI gives colour primitives (`--b1`, `--b2`, `--b3`, `--bc`) and general `card`/control styles, but not Ptah’s nesting semantics. Thirty-two DaisyUI prebuilt themes plus Anubis and Anubis-light are configured (`tailwind.config.js:66-130` and later theme list), so an opaque bespoke palette is unsafe.
3. Reusable UI has overlays and selection/native controls, but not layout/surface primitives. `libs/frontend/ui/src/lib` includes `overlays`, `selection`, and `native`; legacy `ptah-dropdown`/`ptah-popover` are explicitly deprecated. Overlay panels hard-code their own recipe (`dropdown.component.ts:63`, `popover.component.ts:69`). Usage breadth of UI primitives was not reliably quantified from import aliases in this audit, so any numerical adoption rate is **unverified**.
4. Shadows were treated as a light-theme depth mechanism. In dark themes black shadows merge into `base-100`; the visual cue needs surface-lightness, a subtle edge, and a 1px top inner highlight first. Existing glass (`styles.css:341-349`) proves the product already uses an effective top highlight, but it is ornamental and theme-specific.
5. Spacing/radius are local Tailwind decisions (`rounded-md`, `rounded-lg`, `rounded-xl`, `rounded-2xl`; `p-2`, `p-4`, `p-5`, `p-6`), so aligned components do not necessarily align across pages.

## Proposed elevation contract

### Tokens

Define the following in `apps/ptah-extension-webview/src/styles.css`, before component consumers, with generic fallbacks. The names deliberately follow the `--bcm` precedent: project semantic variables layered over DaisyUI, not a competing palette. Use custom per-theme overrides when measured separation requires it. The exact `color-mix()` syntax should be smoke-tested in the supported Electron Chromium; Electron 44 is modern enough in principle, but that compatibility assertion is **unverified** here.

```css
:root,
[data-theme] {
  --pts0: oklch(var(--b1));
  --pts1: color-mix(in oklch, oklch(var(--b2)) 88%, oklch(var(--b1)));
  --pts2: oklch(var(--b2));
  --pts3: color-mix(in oklch, oklch(var(--b3)) 86%, oklch(var(--b2)));
  --ptsb: color-mix(in oklch, oklch(var(--bc)) 14%, transparent);
  --ptsb-strong: color-mix(in oklch, oklch(var(--bc)) 22%, transparent);
  --ptsh: color-mix(in oklch, oklch(var(--bc)) 10%, transparent);
  --ptse1: 0 1px 2px oklch(var(--bc) / 0.1);
  --ptse3: 0 8px 24px oklch(var(--bc) / 0.18);
}

.theme-dark,
[data-theme='anubis'],
[data-theme='dark'] {
  --ptsh: color-mix(in oklch, oklch(var(--bc)) 13%, transparent);
  --ptse1: 0 1px 1px oklch(0% 0 0 / 0.28);
  --ptse3: 0 12px 30px oklch(0% 0 0 / 0.42);
}
```

`theme-dark` is illustrative: use the actual DaisyUI dark-theme selector strategy or repeat the overrides for known dark themes. Do not rely on a class that is not currently emitted. Public aliases such as `--surface-0: var(--pts0)` are optional if third-party CSS needs them; Ptah components should normally consume `.surface-*`, keeping the token family internal and stable.

| Level     | Use                                      | Background / edge / highlight                          | Shadow strategy                                                          |
| --------- | ---------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------ |
| surface-0 | application page/canvas                  | `--surface-0`; no enclosing border                     | none                                                                     |
| surface-1 | sidebar, section, canvas well            | `--surface-1`; `--surface-border`; top inset highlight | none or level-1 shadow only                                              |
| surface-2 | card, tile, transcript node, field group | `--surface-2`; standard border + highlight             | compact shadow on light themes; on dark, border/highlight does most work |
| surface-3 | popover, modal, active/floating item     | `--surface-3`; strong border + highlight               | raised shadow; never only a black shadow in dark themes                  |

Starting calibrations (to be verified by screenshots and contrast checks):

| Theme         | Surface 0 / 1 / 2 / 3                                                                        | Border / highlight / raised shadow                                                |
| ------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Anubis (dark) | `#131317 / #1a1a20 / #20202a / #2a2a36`                                                      | `rgb(232 230 225 / 14%)`; `rgb(255 255 255 / 8%)`; `0 12px 30px rgb(0 0 0 / 42%)` |
| DaisyUI Dark  | use `--b1 / mix(--b2,--b1) / --b2 / mix(--b3,--b2)`                                          | `bc/14%`; white-ish `bc/10%`; `0 12px 30px black/45%`                             |
| Aqua (light)  | `--b1 / mix(--b2,--b1) / --b2 / mix(--b3,--b2)` (do not hard-code unknown upstream literals) | `bc/16%`; white/55%; `0 8px 22px bc/14%`                                          |

The Aqua row intentionally avoids invented literal colours: its upstream DaisyUI values can change with the pinned DaisyUI version. Resolve them from the compiled theme CSS during implementation and capture the final values in a token test/reference.

### Utilities and coexistence

Implement semantic classes in `@layer components`, not a Tailwind plugin initially:

```css
.surface-1,
.surface-2,
.surface-3 {
  border: 1px solid var(--ptsb);
}
.surface-1 {
  background: var(--pts1);
  box-shadow: inset 0 1px 0 var(--ptsh);
}
.surface-2 {
  background: var(--pts2);
  box-shadow:
    inset 0 1px 0 var(--ptsh),
    var(--ptse1);
}
.surface-3 {
  background: var(--pts3);
  border-color: var(--ptsb-strong);
  box-shadow:
    inset 0 1px 0 var(--ptsh),
    var(--ptse3);
}
.elev-0 {
  box-shadow: none;
}
.elev-1 {
  box-shadow: var(--ptse1);
}
.elev-3 {
  box-shadow: var(--ptse3);
}
```

Keep `bg-base-*` valid for deliberate local colour/semantic fills. New structural containers use one `surface-*`; avoid combining it with another `bg-base-*`. DaisyUI `card` may remain for its layout API, but its root should receive a surface class (or a Ptah wrapper); do not globally override `.card` until its usages are classified. Modals/popovers should converge on `surface-3` rather than their current hard-coded bases/shadow sizes.

## Platform choice: own elevation tokens on DaisyUI 4.12 versus DaisyUI 5 + Tailwind 4

The repository currently pins DaisyUI `^4.12.24` and Tailwind `^3.4.18` (`package.json:263,285`), uses JavaScript `tailwind.config.js` with Nx dependency globs and a `daisyui.themes` array, and has 34 compiled themes including two project themes. DaisyUI 5 exposes theme-level `--radius-selector`, `--radius-field`, `--radius-box`, `--size-selector`, `--size-field`, `--border`, `--depth`, and `--noise`; its documented configuration is CSS-first `@plugin`/`@plugin "daisyui/theme"`, unlike the current v4 JS object model. `--depth` is a theme-wide component-effect control, not a four-level Ptah information-hierarchy API. [daisyUI’s v5 theme documentation](https://daisyui.com/docs/themes/) documents these variables and CSS plugin syntax; use [Tailwind’s upgrade guide](https://tailwindcss.com/docs/upgrade-guide) as the execution authority if an upgrade is approved.

| Choice                                  | What it gives                                                                                                                                                    | Cost / risk here                                                                                                                                                                                                                                                                                                                                                                                | Recommendation                                                                                                          |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Keep DaisyUI 4.12 + add Ptah tokens now | Stable configuration; explicit four semantic planes; exact per-theme overrides and contrast-style specifications modelled on `--bcm`; no component-wide surprise | A small project token set and visual tests must be maintained; generic fallback/overrides need calibration                                                                                                                                                                                                                                                                                      | **Choose now.** It directly fixes the complaint and supports file-disjoint migration.                                   |
| Upgrade DaisyUI 5 and Tailwind 4 first  | Global theme knobs for depth/noise/radii/sizes and CSS-first theme authoring                                                                                     | Coupled framework/design-system migration across apps using Tailwind 3 configs, Nx glob discovery, custom theme configuration, and 32 prebuilt themes. Component output, utility behaviour, generated CSS, and theme contracts can change at the same time; screenshot/accessibility/build regression surface grows substantially. It does not encode Ptah surface-0…3 semantics automatically. | **Do not block elevation on it.** Make it a separate upgrade spike after surface tokens and screenshot baselines exist. |

On a later upgrade, map the project density/radius choices to DaisyUI 5 `--radius-*`/`--size-*` only after auditing `btn`, `input`, `select`, modal, and card usage. Retain `--pts0…--pts3`, border/highlight, and shadow tokens either way: they model Ptah product hierarchy while DaisyUI variables set global component defaults. Keep `--noise` off unless a separately approved texture direction requires it; it does not solve visual hierarchy.

### Spacing and density contract

Use a compact desktop-first scale: section `p-5` (20px), card `p-4` (16px), tile `p-3` (12px), field group `gap-2`, field/control row `gap-2`, section gap `gap-5`, card grid gap `gap-3`. Use `rounded-xl` (12px) for sections/cards, `rounded-lg` (8px) for tiles/fields, and retain `rounded-md` (6px) only for compact row controls. Default fields to DaisyUI `input-sm`/`select-sm`/`textarea-sm` (32px control height; preserve touch-specific exceptions). Labels: `text-xs font-medium`; help/error: `text-xs text-base-content-muted`, with 4px label-to-control and 6px control-to-help gaps. Avoid changing text contrast token behaviour.

### New presentational primitives (`libs/frontend/ui`, `type:ui`)

All are standalone, OnPush, content-projection components with signal `input()`s and no imports from chat/orchestrator libraries.

```ts
// APIs are sketches, not implementation
<ptah-section [tone]="'default'|'subtle'" [padding]="'md'|'lg'">
  <div section-header>...</div><ng-content />
</ptah-section>
<ptah-card [elevation]="1|2" [interactive]="false"><ng-content /></ptah-card>
<ptah-tile [selected]="false" [density]="'compact'|'default'"><ng-content /></ptah-tile>
<ptah-stat-card label="..." value="..." [trend]="..."><ng-content select="[actions]" /></ptah-stat-card>
<ptah-field [label]="..." [hint]="..." [error]="..."><ng-content select="input,select,textarea" /></ptah-field>
```

Expose styling via semantic inputs/classes rather than passing arbitrary Tailwind strings. `field` owns only label/help/layout—not form state or `ControlValueAccessor`—so it remains presentational and works with existing native/DaisyUI controls. Keep overlay primitives separate because portal/focus management is their concern.

## Migration plan (file-disjoint batches)

Each batch is an implementation lane, not a request to run all checks at once. For every changed project, take Electron screenshots at Anubis, a DaisyUI dark theme, and Aqua/light, at narrow and normal widths; inspect page/section/card/overlay transitions, focus rings, selected rows, and 200% zoom. Suggested manual workflow after the appropriate build lane is available: use the `serve` target specified at `apps/ptah-electron/project.json:343-353`, then `node apps/ptah-electron/scripts/launch.js --remote-debugging-port=9222 <workspace>`. The supplied launch script’s documented arguments do not itself show the remote-debugging option (`launch.js:5-35`), so forwarding support is **unverified**; confirm before relying on CDP.

| Batch                        | Files / owner boundary                                                                                                                    | Risk                                                     | Visual verification                                                                                                  |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 0: contract                  | `apps/ptah-extension-webview/src/styles.css`, token documentation; new `libs/frontend/ui/src/lib/surfaces/**`, exports                    | Medium: affects themes but no callers until classes used | Token-only gallery/stories or isolated harness: all 34 themes, surface ladder and overlay contrast.                  |
| 1: shell + sidebars          | `app.html`, app shell, `workspace-sidebar.component.ts`, sessions-sidebar files after exact discovery                                     | Medium                                                   | Canvas → panel → active row remains obvious with no double border. Resize sidebar.                                   |
| 2: chat                      | `chat-view.component.html` and transcript/execution/tool-row components only                                                              | High: high-frequency dynamic states                      | Empty, streaming, tool call, error, long code, grid/tile state. Confirm code blocks remain distinguishable.          |
| 3: agent/settings            | `settings/ptah-ai/{agent-orchestration-config,lane-guards-settings,cli-orchestration-matrix}.component.ts` plus session-budget components | High: dense forms/tables                                 | Keyboard focus, disabled/save, validation, sticky/popover settings states and narrow widths.                         |
| 4: dashboard/analytics/Thoth | analytics card, harness card, resolved Thoth tab components                                                                               | Medium                                                   | Stat-card alignment, alert state, aura does not masquerade as elevation.                                             |
| 5: marketplace               | storefront surface, stat-card, overview/connector/skill page cards, shell/nav                                                             | Low-medium: already cohesive                             | Preserve “raw model” character; compare hero → KPI → detail card and docked inspector.                               |
| 6: overlays and controls     | `ui/overlays/{dropdown,popover}`, native counterparts, provider/search fields, shared settings field wrappers                             | Medium: portal/focus                                     | Stacking, clipping, Escape/focus restoration, hover/focus/error/disabled controls.                                   |
| 7: remaining feature panels  | cron scheduler, messaging gateway, workspace indexing and remaining `bg-base-*/alpha` clusters                                            | Medium                                                   | Side-by-side before/after screenshot diff; reject substitutions that convey status rather than structural elevation. |

No build/test/lint is prescribed here because this audit was explicitly read-only and other lanes are active. When implementation begins, verify only the project modified by that batch plus CDP screenshots; do not run a workspace-wide command.

## Quick wins

1. Add tokens/classes and migrate the two legacy overlay panel roots from hard-coded `bg-base-200 border-base-300 shadow-lg/xl` to `surface-3`. High visibility, two small files, clear focus/portal regression boundary.
2. Convert Marketplace `STOREFRONT_SURFACE_CLASS` and `StatCardComponent` to `surface-1`/`surface-2` while retaining their gradient and hover behaviour. It establishes the reference look users already prefer.
3. Make workspace sidebar `surface-1`; make selected workspace row a `surface-3`/active tile rather than raw `bg-base-300`; normalize its header/list/footer to the proposed 12/16px rhythm.
4. Replace the chat canvas `bg-base-200/30` at `chat-view.component.html:23` with `surface-1` and give the first tile/card family `surface-2`. Do this only after identifying which descendant owns the tile boundary.
5. Standardize new settings fields on `input-sm`/`select-sm` plus `ptah-field`; leave existing matrix semantics untouched until its dedicated batch.

## Acceptance criteria

- Every structural page container has exactly one surface level; nested cards rise one level unless deliberately grouped.
- Every card/tile/field has the shared border, top highlight, radius and spacing of its level; overlays are surface-3.
- Dark themes demonstrate separation with surfaces/edges/highlights even if shadows are hidden; light themes use restrained shadows.
- No visual-status colour is replaced by elevation colour, and existing measured text/focus contrast rules remain intact.
- The 34 configured themes render through generic DaisyUI-derived fallbacks; only demonstrated exceptions receive named overrides.
