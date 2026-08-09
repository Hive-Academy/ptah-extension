# Context — TASK_2026_186

## Where this came from

TASK_2026_183 fixed a real WCAG AA failure: `text-base-content/40` and `/50` were
used as body-adjacent text across the Tasks UI and failed contrast against
`base-100`. The fix replaced every opacity tier with full-opacity
`text-base-content`.

The fix was accepted, and the reasoning behind it is the reason this task exists
rather than a revert.

## Why raising the alpha floor does not work

Ratios recomputed from the literal theme values (`apps/ptah-extension-webview/tailwind.config.js`
for anubis/anubis-light, `node_modules/daisyui/src/theming/themes.js` for the
built-ins), converting OKLCH to sRGB and blending at the stated alpha:

| Tier  | anubis dark                  | daisyUI dark  |
| ----- | ---------------------------- | ------------- |
| `/40` | 3.30:1 ❌                    | fails         |
| `/50` | 4.50:1 — exactly on the gate | fails         |
| `/60` | 5.94:1 ✅                    | **3.45:1 ❌** |
| full  | 14.86:1 ✅                   | 7.03:1 ✅     |

The trap is daisyUI dark. Its `base-content` is `#A6ADBB` against `base-100`
`#1d232a` — only **7.03:1 at full opacity**. Any alpha below roughly `/70` fails
there. So "raise the floor to `/60`" passes on our own anubis theme and ships a
violation on a built-in one. There is no single alpha value that is correct
across every theme we ship, which is why 183 removed the tiers instead of
retuning them.

## What this task does

Hierarchy has to come from a token whose value is chosen per theme, not from an
alpha modifier applied uniformly across themes.

1. Add a `base-content-muted` token (name is a proposal, not a mandate) to every
   theme we define — `anubis`, `anubis-light` — and resolve a value for each
   built-in daisyUI theme the app can actually be switched to. Each value is
   picked to clear 4.5:1 against that theme's `base-100` while still reading as
   visually secondary.
2. Prove each value with a computed ratio, the same way 183 did. A table of
   theme → token value → measured ratio is the acceptance evidence. Ratios are
   computed from the literal theme values, not eyeballed.
3. Repoint the three files 183 flattened, restoring a two-tier ladder
   (`base-content` for primary, `base-content-muted` for secondary) rather than
   the original four:
   - `libs/frontend/tasks-ui/src/lib/components/board/task-card.component.ts`
   - `libs/frontend/tasks-ui/src/lib/components/detail/task-relations.component.ts`
   - `libs/frontend/tasks-ui/src/lib/components/tasks-view.component.ts`
4. Add a lint rule or a spec that fails on any reintroduced
   `text-base-content/NN`. Without a ratchet this defect returns the first time
   someone wants a dimmer timestamp.

## Constraints

- Two tiers, not four. The original ladder had `/40`, `/50`, `/60` and `/80`
  doing work that size and weight classes already do. Restoring all four is
  re-creating the problem with extra steps.
- The decorative `aria-hidden="true"` icons at `/20` in `tasks-view.component.ts`
  are out of scope. 183 left them deliberately: contrast rules do not apply to
  decorative elements.
- `primary-content` is settled. 183 moved anubis `primary-content` from
  `#e8e6e1` to `#f8f7f4` (4.14:1 → 4.82:1). Do not revisit it.

## Rejected

- **Reverting 183.** It fixed a genuine AA failure. The flattening is a cost of
  that fix, not an error in it.
- **A single alpha floor across all themes.** The table above is why.
- **Per-component hardcoded hex values.** Defeats theming; the next theme added
  silently breaks.
