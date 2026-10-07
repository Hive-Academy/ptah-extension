# Session row padding

The active accent is still a 2px inset shadow. The row now has 10px of inner padding, so the bar sits inside the rounded row and the title starts 8px to the right of the bar. Title, time, chips, the rename field, and group labels share that text edge. Idle and live rows use the same padding; the phase dot is out of flow.

Offsets below are from the session aside’s left edge. The aside has no horizontal padding. Tailwind spacing is 4px per step (`2.5` = 10px, `4` = 16px).

## Left offsets

| Edge              | Where                                                                             | px   |
| ----------------- | --------------------------------------------------------------------------------- | ---- |
| Gutter            | List padding-left (`pl-4`)                                                        | 16   |
| Phase dot         | Host is 16px (`w-4`), placed at `-left-4`, so it fills x = 0–16                   | 0–16 |
| Accent            | Button left edge, then 2px inset. Depth 0: x = 16–18                              | 16   |
| Text              | Gutter 16 + row padding 10. Depth 0 title, time, chips, rename field, group label | 26   |
| Gap, bar to title | 26 − 18                                                                           | 8    |

Header controls use `pl-[26px]`, the same 26px text edge (16 + 10). Their right inset is `pr-2` (8px), matching the list.

Nested rows keep `ml-3` / `ml-6` / `ml-9` on the `<li>`, so the whole row (title, time, chips) moves together:

| Depth | Extra margin | Text x |
| ----- | ------------ | ------ |
| 0     | 0            | 26     |
| 1     | 12 (`ml-3`)  | 38     |
| 2     | 24 (`ml-6`)  | 50     |
| 3+    | 36 (`ml-9`)  | 62     |

A child dot stays on that row: `-left-4` pulls it into the space in front of the child button, not into the title.

## Classes

`libs/frontend/chat/src/lib/components/templates/app-shell.component.html`

| Piece              | Before                                                                   | After                                                      | Line    |
| ------------------ | ------------------------------------------------------------------------ | ---------------------------------------------------------- | ------- |
| Header block       | `pl-5 pr-1.5` (20px / 6px)                                               | `pl-[26px] pr-2` (26px / 8px)                              | 104     |
| Session list       | `pl-5 pr-1.5` (20px / 6px)                                               | `pl-4 pr-2` (16px / 8px)                                   | 203     |
| Rename field       | `pl-0 pr-2`                                                              | `pl-2.5 pr-2`                                              | 216     |
| Session button     | `py-1.5 pl-0 … rounded-md` plus `[class.pr-16]` when organization is off | `py-1.5 px-2.5 … rounded-md` plus the same `[class.pr-16]` | 233–234 |
| Live-phase dot     | `absolute -left-5` (−20px)                                               | `absolute -left-4` (−16px)                                 | 254     |
| Organization chips | `pl-0 pr-24`                                                             | `pl-2.5 pr-24`                                             | 359     |
| Group label        | no horizontal padding, `text-[10px]`                                     | `pl-2.5`, still `text-[10px]`                              | 386     |
| Nested rows        | `ml-3` / `ml-6` / `ml-9`                                                 | unchanged                                                  | 209–211 |

`px-2.5` sets both sides to 10px. When organization is off, `pr-16` is also present. Tailwind emits `padding-right` utilities after `padding-left`/`padding-right` pairs, so the action gutter stays 64px and the left padding stays 10px. `app-shell.organization.spec.ts` still finds the `pr-16` token, so that spec was not edited.

Fonts are unchanged: title `text-[13px]` (line 265), time `text-[11px]` (line 278), chips `text-[10px] h-4` in `session-organization-chips.component.ts` (line 36).

`apps/ptah-extension-webview/src/styles.css`

| Rule                             | Before                                            | After                                                      | Line      |
| -------------------------------- | ------------------------------------------------- | ---------------------------------------------------------- | --------- |
| Light `.sidebar-item-active`     | `box-shadow: inset 2px 0 0 oklch(var(--n))`       | same shadow, plus `border-radius: 0.375rem` (`rounded-md`) | 2118–2124 |
| Light `.sidebar-item-open-tab`   | `box-shadow: inset 2px 0 0 oklch(var(--n) / 0.3)` | same shadow, plus `border-radius: 0.375rem`                | 2126–2128 |
| Default `.sidebar-item-active`   | `box-shadow: inset 2px 0 0 oklch(var(--p))`       | same shadow, plus `border-radius: 0.375rem`                | 2137–2143 |
| Default `.sidebar-item-open-tab` | `box-shadow: inset 2px 0 0 oklch(var(--p) / 0.3)` | same shadow, plus `border-radius: 0.375rem`                | 2147–2149 |

The button already had `rounded-md`. The radius on the accent class is the same 6px, so the inset bar follows the rounded row. The shadow is still 2px and stops well short of the text at 10px.

## Why the gutter is 16px, not the 8px / 12px example

The brief’s example was list `px-2` (8px) and header `px-3` (12px), with the dot at `left-1` and extra text padding `pl-4` when it needs room. Those numbers do not add up to one text edge, and they do not fit the marker:

- The indicator host is `w-4 h-4` (16px) in `session-live-phase-indicator.component.ts`. An 8px list gutter cannot hold it.
- `left-1` (4px) inside a `px-2.5` (10px) row runs the host from 4px to 20px and covers the title.
- Adding `pl-4` on the title as well would clear the dot, but the shared edge would become 8 + 10 + 16 = 34px, and every idle row would carry a blank column. Header `px-3` (12px) would not meet that edge either.

The list gutter is `pl-4` (16px), down from `pl-5` (20px). `-left-4` parks the 16px host in that gutter, ending on the button edge, so the painted glyph (10px dot or 12px icon, centered) stops 2–3px before the accent. Text stays at `px-2.5` for idle and live rows, and the header matches that edge at 26px.

## Specs

No spec file was edited. `app-shell.organization.spec.ts` asserts `pr-16`, `ml-3`, and `[data-testid="session-row-meta"]`, which are unchanged.

## Not done

- No Jest, Nx, lint, typecheck, or browser pass. This session was edit-only while another lane builds Electron.
- `ptah_agent_report` is not in the MCP tool list (`search_tool` on the tasks server returns automations only), so it was not called.
