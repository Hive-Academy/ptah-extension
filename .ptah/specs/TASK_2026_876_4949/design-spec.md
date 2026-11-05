# Design specification — TASK_2026_876_4949

Visual contract for one addition on the existing Electron (and shared webview) session UI: a Linked sessions section in the expanded stats sidebar. Nothing else is redesigned. The compact inspector rail (`w-14`), the canvas rail, and the previous-sessions list stay as they are.

Design system in force: Anubis / DaisyUI, `docs/design-system/designs-systems.md` (tone only) and the tokens in `apps/ptah-extension-webview/tailwind.config.js` plus `apps/ptah-extension-webview/src/styles.css`. Those sources win over the marketing spacing examples in the design-system doc. This sidebar is the existing dense inspector, not a landing page.

Prototype: `.ptah/specs/TASK_2026_876_4949/prototype/index.html` in this worktree. Gate 1.7 has not approved this revision yet.

## Surfaces

### A. Linked sessions (expanded stats sidebar only)

Shown when the expanded session inspector is docked (`presentation` other than `rail` or `sheet`) or a sheet. Both presentations share `#body` in `session-inspector.component.html` (sheet at lines 73–81, docked aside at lines 82–89, shared body from line 92).

The section sits in the stats area, immediately after the stats switch (`session-inspector.component.html` lines 163–183) and before `ptah-inspector-agents-section` (line 185). It is its own bordered block, the same seam as Agents. It is not inside the `@if (s)` stats switch: a chain still shows when the metrics snapshot is missing.

Absent when the open session has no handoff chain. The compact rail (`session-inspector.component.html` lines 1–72, class `w-14`, 56px) does not gain a list, a heading, or a metric button. The task calls this the 14px rail; the class is `w-14`, not a 14px width.

The canvas rail and the previous-sessions list are out of this specification. After a successful handoff the old session is stopped, so it is not Running. It keeps its normal row and its normal card, in its existing group and order. This design does not add a Handed off label, an indent, a shorter card, or a change to grouping.

## Reused tokens

Citations are the worktree files a frontend change will edit. Do not introduce a new color, type size, radius, or focus ring.

| Token | Value in use | Source |
| --- | --- | --- |
| Page / inspector fill | `bg-base-100` | `session-inspector.component.html` lines 4, 78, 86 |
| Section seam | `border-t border-surface-border` | `session-inspector.component.html` lines 167, 177, 188 |
| Surface border | `--surface-border` = `color-mix(in oklch, oklch(var(--bc)) 14%, transparent)` | `styles.css` lines 157–164 |
| Stronger rule | `--surface-border-strong` at 22% | `styles.css` line 164 |
| Secondary text | `text-base-content-muted` via `--bcm` | `tailwind.config.js` lines 13–31; anubis `--bcm` lines 113–117; anubis-light `--bcm` lines 191–195. The comment records ≥4.5:1 on base-100, base-200, and base-300 in both Anubis themes. |
| Body text | `base-content` `#e8e6e1` (anubis) / `oklch(23.574% 0.066 313.189)` (anubis-light) | `tailwind.config.js` lines 112 and 190 |
| Section label | `sec-label text-[10.5px] font-semibold uppercase` | `inspector-agents-section.component.ts` lines 94–97. Same string on Task, Git, Todos, Plan limits. No separate `.sec-label` rule in `styles.css`; the utilities are the style. Visible words use title case in this section (see Decisions). |
| Section padding | `px-3 py-3` on the stats section; Agents uses `pb-1.5 pt-3` and `px-3` on the heading row | `inspector-session-stats.component.ts` lines 45–48; `inspector-agents-section.component.ts` lines 88–93 |
| Metric caption | `text-[10.5px] text-base-content-muted` | `inspector-session-stats.component.ts` lines 52–53 and 201 (`this session`) |
| Row title | `truncate text-[13px] leading-[18px]`, `title` = full name | `session-list-row.component.ts` lines 222–228 |
| Current title weight | `font-semibold` when current, `font-medium` otherwise | `session-list-row.component.ts` lines 421–423 |
| Meta line | `text-[11px] leading-4 text-base-content-muted` | `session-list-row.component.ts` lines 232–233 |
| Inspector row hover | `hover:bg-base-content/5` | `session-inspector.component.html` line 12 |
| Selected inspector row | `bg-surface-2` plus `w-0.5` `bg-secondary` bar | `inspector-agents-section.component.ts` lines 147–154 |
| Link ink, not used here | `--ptah-link`: dark `--ptah-gold` `#d4af37`; light `--ptah-gold-strong`. Gold is under 4.5:1 as small text on anubis-light. | `styles.css` lines 58–61 and 137–146. Relation text and the current bar do not use it. |
| Focus, inspector controls | `focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content` | Close button `session-inspector.component.html` line 131; stats disclosure `inspector-session-stats.component.ts` line 265; agents “Show more” `inspector-agents-section.component.ts` line 220 |
| Focus, global | `outline: 2px solid oklch(var(--s)); outline-offset: 2px`. anubis-light overrides to `--ptah-gold-strong`. Other themes use `--ptah-accent-ink`. | `styles.css` lines 1053–1093 |
| Rename field ring, not copied | `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(var(--s))]` | `session-list-row.component.ts` lines 52–53. Linked-session buttons use the `outline-base-content` ring above so anubis-light stays ≥3:1. |
| Sidebar rhythm | `--sidebar-font-size: 13px`, spacing 4 / 8 / 12 / 16 | `styles.css` lines 70–75 |
| Dock width | default 336px, min 300, max 560 | `libs/frontend/chat/src/lib/services/session-inspector/inspector-dock-width.ts` lines 6–25 |
| Font | `Inter, system-ui, -apple-system, sans-serif` | `tailwind.config.js` lines 43–46 |
| Motion | 120ms color only. No scale, no entrance travel. | Agents row `transition-colors duration-[120ms]` at `inspector-agents-section.component.ts` line 145. `--ptah-motion-*` in `styles.css` lines 40–55 is for page switches, not this section. |

## Layout and states

### A. Linked sessions

**Structure**

```
section  border-t border-surface-border px-3 pb-3 pt-3
  h3     sec-label text-[10.5px] font-semibold
         visible text: "Linked sessions"
  ul     mt-2, role list, max-height 10.5rem, overflow-y auto
    li
      button  w-full min-h-8 rounded-md px-1.5 py-1 text-left
              grid: title (minmax(0,1fr)) + relation (shrink-0)
```

Chain order is chronological, root first, newest last. For A → B → C the list is A, then B, then C on every session in the chain.

Relation, only on the other entries:

- An earlier session: visible text `Continued from`.
- A later session: visible text `Continued in`.

The open session's relation slot says `This session` (same words as the stats caption at `inspector-session-stats.component.ts` line 201). Title weight is `font-semibold` on that row and `font-medium` on the others.

**Default (chain of three, viewing the newest).** Three rows. The current row has `bg-surface-2` and a 2px `bg-secondary` bar on the left (the selected-agent treatment, not a gold inset). Relation text is `text-[11px] leading-4 text-base-content-muted`, nowrap.

**Hover.** `hover:bg-base-content/5` on the button. The current row keeps `bg-surface-2` underneath; the 5% wash may layer on top. No border-width change, no translate.

**Focus.** The `outline-base-content` ring, 2px, offset 2px. The list scrolls the focused button into view (`scroll-margin-block: 4px`).

**Current.** `aria-current="true"` on that button. Activating it focuses the session that is already open (no second tab). The other buttons open that session. On B in A → B → C, A says `Continued from`, B says `This session`, and C says `Continued in`.

**Empty / absent.** The section element is not in the DOM. No heading, no “none”, no skeleton. The compact `w-14` rail is unchanged.

**One predecessor.** Two rows, in chain order. Same row metrics. No empty slot for a missing third hop.

**Long label.** The title is one line, `truncate`, `min-w-0`. The `title` attribute and the button's accessible name carry the full label. The relation label does not shrink and does not wrap. A 13px title plus an 11px relation still fits the 300px minimum dock: relation is about 92px (`Continued from`), title takes the rest.

**Long chain (5 or more).** Every session is in the list, in order. The list viewport caps at 10.5rem (five 32px rows). Further rows scroll inside the section. The inspector body still scrolls as it does today. Do not collapse, paginate, or “show more” — the chain on A, on B, and on C lists every session.

**Docked and sheet.** Same section. Sheet keeps `role="dialog"` `aria-modal="true"` `aria-label="This session"` (`session-inspector.component.html` lines 74–78). The section does not become a second dialog. Docked is the aside at lines 82–89.

**Loading and error.** This surface has no spinner and no alert. Until a chain is known, render absence. A malformed record is dropped and the section stays absent. Do not invent links. The prototype's Loading and Error choices show that absence plus a caption outside the product chrome.

**Missing record.** A chain entry whose stored id has no session name renders the fallback title `Session ` plus the first 8 characters of that id (example `Session 9f3c2a10`). The title uses `text-base-content-muted`, keeps `truncate` and a `title` attribute of the same fallback string, and stays a button. The row is still in the chain. This is not the dropped-record case: the link is valid, the label is not.

## Accessibility

- Linked sessions is a `section` labelled by its `h3` (`aria-labelledby`). The heading text is “Linked sessions”.
- The list is `ul` / `li`. Every row is a native `button type="button"`.
- Accessible name of another session: `Open {full label}, continued from` or `Open {full label}, continued in`. The visible relation is shorter; the name carries the verb because the row is the control.
- Accessible name of the current session: `Current session, {full label}`. `aria-current="true"`. Activating it does not move focus out of the inspector except to leave the button focused.
- Focus order in the expanded inspector: header actions, then any request lines, then stats disclosures, then each linked-session button in chain order (root first), then Agents, then the rest of `#body`. The sheet's close button stays the first focus target the shell already sets (`data-inspector-close`).
- Tab through the whole chain, including rows that start scrolled out of the 10.5rem viewport.
- Contrast, both Anubis themes: relation text and “This session” use `text-base-content-muted` (gated at 4.5:1 on base-100 / 200 / 300, `tailwind.config.js` lines 13–24 and 113–117, 191–195). The focus ring on linked buttons is `outline-base-content` (full opacity), not gold. The current-row bar is `bg-secondary` (the agent selection bar), with `aria-current` and semibold weight so color is not the only cue.
- `prefers-reduced-motion`: the row hover is a 120ms color change only. There is no pulse and no entrance travel on this section.

## Component mapping

| Piece | File |
| --- | --- |
| Where the section mounts (docked and sheet). Not the `rail` branch. | `libs/frontend/chat/src/lib/components/organisms/session-inspector/session-inspector.component.html` after the stats switch (lines 163–183), before Agents (line 185) |
| Section markup, list, truncate, current bar. New sibling component next to the stats component, invoked from the template above. Do not grow `inspector-session-stats.component.ts`. | `libs/frontend/chat-ui/src/lib/molecules/session/inspector-stats/inspector-linked-sessions.component.ts` (new), selector `ptah-inspector-linked-sessions` |

The compact rail template (lines 1–72, `w-14`) is not in this map. Neither are `canvas-rail.component.ts`, `compact-rail-card.component.ts`, `session-list-row.component.ts`, or `previous-sessions-modal.component.html`. Those files stay unchanged.

## Decisions

1. **Section sits after the stats switch, not inside the metrics grid.**
   Options: a fourth column in the stats grid; a block inside `ptah-inspector-session-stats`; a sibling section between stats and Agents.
   Evidence: the grid is three metric cells (`inspector-session-stats.component.ts` lines 59–165). The section is named and lives in the stats area. It is absent when there is no chain, which a grid column cannot do cleanly. The stats file is already past the point where adding a list is a small edit.
   Reversible: yes. The mount is one template outlet.

2. **Heading utilities stay with Agents except `uppercase`; the visible string is “Linked sessions”.**
   Options: all-caps to match the rendered Agents label; title case as the section name.
   Evidence: Agents writes `AGENTS` (`inspector-agents-section.component.ts` line 98) with `uppercase` (line 96). The section name is “Linked sessions”. CSS `uppercase` would render “LINKED SESSIONS”. Implementers omit `uppercase` for this heading only, and keep `sec-label text-[10.5px] font-semibold`.
   Reversible: yes.

3. **Current row uses the agent selection bar, and every row is a button.**
   Options: current row is static text; only other rows are buttons; current uses the previous-sessions `--ptah-link` inset.
   Evidence: each entry is a keyboard-focusable control that opens that session, and the current one is marked. The inspector already marks a selected row with `bg-surface-2` and `bg-secondary` (`inspector-agents-section.component.ts` lines 147–154). The sessions-list inset belongs to a surface this task does not change.
   Reversible: yes.

4. **Chain order is root-first. The list scrolls after five rows. Nothing is collapsed.**
   Options: newest first; show five plus “Show more”; scroll.
   Evidence: A → B → C must list A, B, and C on every session in the chain, including after a later hop. Agents already uses “Show more” (`inspector-agents-section.component.ts` lines 217–226), which would hide a required entry. Five rows at `min-h-8` is 10.5rem, inside a dock whose minimum width is 300px (`inspector-dock-width.ts` line 7).
   Reversible: yes.

5. **No loading or error chrome on this section.**
   Options: skeleton rows like Agents; an error alert in the section; render nothing until the chain is known, and nothing when the record is dropped.
   Evidence: Agents skeletons exist (`inspector-agents-section.component.ts` lines 108–125), but absence is the specified empty state. A dropped payload must not be drawn as a chain.
   Reversible: yes.

6. **The canvas rail and the previous-sessions list are not restyled.**
   Options: nest the old session under the successor and label it Handed off; leave order, grouping, and the normal row and card alone, and show the chain only in this section.
   Evidence: `context.md` “Scope change” (2026-11-04) and `task-description.md` out of scope (the same date) plus criteria 3, 6, and 7. The old session is stopped after its turn ends, so it is not Running. Its row and card stay in the place and the live-state bucket a session that simply stopped already uses. They gain no new label.
   Reversible: yes. Putting a label back on the trees would be a new design.

## Scope change log

Removed from the previous visual contract because `context.md` “Scope change” is binding:

- Surface B, the Handed off treatment on the canvas rail and the previous-sessions list, including indents, group membership, chip counts, the 62px / 46px card, the idle stripe, and the “Handed off” pill and meta line.
- The sr-only “Handed off session” label and the gate on the existing “Child session” span.
- Tokens that existed only for that treatment: rail card chrome and heights, state inks, the rail pill, the rail focus frame, rail group labels, the sessions-list current fill, the open-in-tab accent, list indent, and the inset list focus ring.
- Component-mapping rows for `compact-rail-card.component.ts`, `compact-lane.types.ts`, `compact-session-card.component.ts`, `canvas-rail-grouping.util.ts`, `canvas-rail.component.ts`, `canvas-rail-card.component.ts`, `session-list-row.component.ts`, `previous-sessions-modal.component.html`, `session-row-groups.ts`, and `session-live-phase-indicator.component.ts`.
- Decisions that chose the idle stripe, the nest indent, muted “Handed off” copy, and the 62px card.
- Prototype panels for the canvas rail and previous sessions, the “successor not loaded” state, and screenshots that showed those panels.

Kept: surface A, with absent, one predecessor, chain of three, long chain, long label, current entry, missing record, hover, focus, docked, and sheet.

## Verification screenshots

These are the only files in `prototype/screenshots/` after this revision. Each one was captured from `prototype/index.html` with `ptah_browser_navigate` and `ptah_browser_screenshot`.

| File | What it shows |
| --- | --- |
| `screenshots/dark-chain-of-three.png` | Anubis dark, 1440px, docked. A → B → C. C is current. The `w-14` rail has metrics only. |
| `screenshots/light-chain-of-three.png` | Same chain on anubis-light. |
| `screenshots/dark-long-chain.png` | Six sessions. The section scrolls and the current row is in view. |
| `screenshots/dark-absent.png` | No chain. Linked sessions is not in the inspector. |
| `screenshots/dark-missing-record.png` | Middle entry with no name. Fallback title `Session 9f3c2a10` in muted text. |
| `screenshots/dark-narrow-sheet.png` | 400px viewport, sheet. Same chain of three inside the dialog. No horizontal overflow. |
