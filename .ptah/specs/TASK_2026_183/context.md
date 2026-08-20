# Context — TASK_2026_183

## Origin

Surfaced three times inside TASK_2026_181 and fixed locally each time. The
third occurrence produced a full audit that showed the construct is unsafe at
**every** opacity level, so the remaining instances need a deliberate sweep
rather than another local patch.

## The defect

`text-base-content/NN` — a daisyUI theme token with an opacity modifier — is
used for de-emphasized text across the Tasks board. Its contrast ratio depends
on whatever the active theme's `base-100` happens to be, and this app ships
30-plus themes.

Measured during TASK_2026_181 Batch 7, rebuilt from the literal theme values
(`apps/ptah-extension-webview/tailwind.config.js` for anubis/anubis-light,
`daisyui/src/theming/themes` for the built-ins), OKLCH→sRGB via `culori`, with
translucent text alpha-blended over its actual background:

| opacity | anubis | anubis-light | daisyUI dark | daisyUI light |
| ------- | ------ | ------------ | ------------ | ------------- |
| `/30`   | 2.39   | 1.92         | 1.84         | 1.85          |
| `/40`   | 3.31   | 2.48         | 2.28         | 2.35          |
| `/50`   | 4.48   | 3.28         | 2.82         | 3.05          |
| `/60`   | 5.94   | 4.45         | 3.45         | 4.06          |
| `/70`   | 7.69   | 6.18         | **4.18**     | 5.53          |

**No opacity level clears 4.5:1 on all four mandated bases.** Even `/70` fails
on daisyUI `dark`. "Raise the floor" is not an available remedy — the construct
itself has to be replaced.

The fix applied in Batch 7 was full-opacity `base-content`, which daisyUI
guarantees against its own base by construction. Worst case across all four
themes after that change was **4.74:1**, most sites clearing AAA. Hierarchy
comes from **size and weight**, which are theme-invariant by definition.

## Remaining instances — not introduced by TASK_2026_181

Confirmed by `git diff` to pre-date the task; Batch 7 added none of them.

| File                                                                           | Lines                       | What it is                                    |
| ------------------------------------------------------------------------------ | --------------------------- | --------------------------------------------- |
| `libs/frontend/tasks-ui/src/lib/components/board/task-card.component.ts`       | 80, 142, 147, 156, 314, 330 | card id, parent breadcrumb, isolate label     |
| `libs/frontend/tasks-ui/src/lib/components/tasks-view.component.ts`            | 91, 401, 429, 439, 447      | header counter, exclusions drawer             |
| `libs/frontend/tasks-ui/src/lib/components/detail/task-relations.component.ts` | 99–101                      | Batch 3's own unresolved flag, same construct |

At `/40`–`/60` these measure 2.28–5.94:1 depending on theme — failing on at
least one mandated base in every case.

The `task-relations.component.ts` entry has already been through one review
cycle: Batch 3 raised it from `text-[10px] text-base-content/40` (2.28–3.29:1,
failing everywhere) to `text-xs text-base-content/80`. That was an improvement,
not a fix.

## Also in scope — a real defect in the default theme

**anubis's `primary-content` `#e8e6e1` on `primary` `#2563eb` is 4.14:1**, below
the 4.5:1 gate this codebase enforces elsewhere. It affects **every**
`badge-primary` / `btn-primary` small-text site in the product, not only the
Tasks board.

TASK_2026_181 Batch 7 deliberately did **not** fix this: changing a default
theme colour is an app-wide decision with a blast radius far beyond a feature
batch. It changed its own two usages instead and recorded the token failure.
Deciding this one needs a look at every `primary` consumer.

**One live instance is already known and must not be lost**:
`libs/frontend/tasks-ui/src/lib/components/detail/task-detail.component.ts:236`
(`hover:badge-primary`) — pre-existing, same 4.14:1 defect, found at the Batch 7
gate after the two Batch 7 introduced had already been removed. It is a
hover-only affordance on the detail panel, so it carries the same problem as the
Batch 7 rollup did: the only signal that the element is interactive is a colour
flip that itself fails the gate. Sweep every `primary` consumer rather than
this one site.

## Scope

1. Sweep the remaining `text-base-content/NN` instances listed above.
2. Decide the anubis `primary-content` question with sight of all `primary`
   consumers.
3. Consider a lint rule or a spec-level ratchet. TASK_2026_181 Batch 7 pinned
   its files with tests that assert the **construct is absent** from the
   rendered tree, rather than asserting a ratio a test cannot measure — that
   pattern generalizes and is cheaper than re-auditing by hand.

## Constraints

- **Do not fix by raising the opacity.** The table above shows why that does not
  work. Full-opacity token, with hierarchy from size and weight.
- Colour is never the sole carrier of meaning (NFR-12) — every chip renders its
  text.
- Purely decorative elements are exempt but must be `aria-hidden="true"`, as
  Batch 7 did for the filter glyph and the empty-state illustration.
- Recompute ratios from the literal theme values. Do not trust an asserted
  number; three separate agents reproduced this audit independently and the
  arithmetic matched each time.
