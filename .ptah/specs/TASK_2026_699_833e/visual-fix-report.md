# Visual Fix Report - TASK_2026_699_833e

Source: `visual-review.md`, sections "Serious" and "Moderate and minor". Nothing committed.

## Fixes

### 1. (Serious) Open sidebar-tab label contrast - FIXED

- File: `libs/frontend/chat-ui/src/lib/atoms/sidebar-tab.component.ts`.
- Change: the open label is `text-base-content` (was `text-primary`). The closed label stays
  `text-base-content-muted` with `group-hover:text-base-content`. The 2 px active line keeps
  `bg-primary`. So "open" shows as a stronger label tone (muted to full), the primary line,
  and `aria-expanded="true"`.
- Shared atom: Stats, Agents, Workspaces, Git and Display tabs all use it, so the open label
  now passes on every one of them. No layout or size class changed.
- Contrast, computed from `apps/ptah-extension-webview/tailwind.config.js` theme tokens
  (OKLCH to sRGB, WCAG relative luminance) against the tab surface the review measured:

  | Theme       | Open label before                    | Open label after (`base-content`) | On `base-300` (hover) |
  | ----------- | ------------------------------------ | --------------------------------- | --------------------- |
  | anubis-light | 1.20:1 (`primary` oklch 85% 0.138 181) | 13.68:1 (oklch 23.574% 0.066 313.189 on rgb 234,230,227) | 13.21:1 |
  | anubis (dark) | 3.43:1 (`primary` #2563eb)          | 14.19:1 (#e8e6e1 on rgb 24,24,28) | 12.29:1 (on #242430) |

  Closed state is unchanged (review measured 5.79:1 dark, 5.62:1 light). All pass 4.5:1.
- Spec: `sidebar-tab.component.spec.ts` adds a test that the open label has
  `text-base-content` and not `text-primary`, and the closed label has
  `text-base-content-muted`.

### 2. (Moderate) Tab focus ring clipped - FIXED

- File: `sidebar-tab.component.ts`. The button gets `focus-visible:-outline-offset-2`.
- The global rule `button:focus-visible { outline: 2px solid ...; outline-offset: 2px }` in
  `apps/ptah-extension-webview/src/styles.css:860-869` (specificity 0,1,1) is overridden by
  the Tailwind utility (0,2,0). The 2 px outline now sits fully inside the button, so the slot
  and dock cannot clip any edge. Colour is unchanged (the theme `--s` token).
- Same utility family as the split handle (`focus-visible:-outline-offset-1`).
- Spec: a test asserts the class is on the button.

### 3. (Moderate) Width readout covers dock title - FIXED

- File: `libs/frontend/chat-ui/src/lib/atoms/split-handle.component.ts`, `readoutClass` only
  (grip appearance only; the `line` template has no readout and is unchanged).
- Anchor changed from `top-2` / `left-2` to `top-1/2 mt-5` (vertical) and `left-1/2 ml-5`
  (horizontal). The pill now starts 20 px past the middle of the handle, just beyond the
  32 px grip (16 px half-height), so it covers neither the grip nor the title row. Side
  anchoring (`left-0`/`right-0`, `top-0`/`bottom-0` by `inverted`) is unchanged.
- Spec: `split-handle.component.spec.ts` asserts `top-1/2` and `mt-5`, and that `top-2` is gone.

### Not fixed (recorded only, as instructed)

- Long plan-window label truncates at 300/336 px dock widths (`truncate` plus `title`).

## Files

- MODIFIED `libs/frontend/chat-ui/src/lib/atoms/sidebar-tab.component.ts`
- MODIFIED `libs/frontend/chat-ui/src/lib/atoms/sidebar-tab.component.spec.ts`
- MODIFIED `libs/frontend/chat-ui/src/lib/atoms/split-handle.component.ts`
- MODIFIED `libs/frontend/chat-ui/src/lib/atoms/split-handle.component.spec.ts`

Prettier ran on these four files only (three unchanged, the spec reformatted only its new lines).

## Verification

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat-ui @ptah-extension/chat --parallel=1`
  printed "for 2 projects". First run: 1 failing test in 248 suites, together with a Jest
  "worker process has failed to exit gracefully" warning. The output was filtered, so the
  failing suite name was not captured.
- Checked the changed specs on their own: `npx jest -c libs/frontend/chat-ui/jest.config.ts
  sidebar-tab.component.spec.ts split-handle.component.spec.ts --coverage=false --maxWorkers=2`
  gave 42/42 passing. `electron-shell.command-center-tab.spec.ts` (chat) gave 4/4 passing.
- Re-ran `npx nx run-many -t test -p @ptah-extension/chat-ui @ptah-extension/chat --parallel=1
  --skip-nx-cache`: "Successfully ran target test for 2 projects".
- `npx nx run-many -t typecheck,lint -p @ptah-extension/chat-ui @ptah-extension/chat --parallel=1`:
  "Successfully ran targets typecheck, lint for 2 projects".
- I take the first-run failure to be a flaky test related to the worker teardown, since the
  clean re-run passed. This is not proven.
- No rendered re-check: no browser or build was run, because build is out of scope.

## Decisions

- Open-state emphasis uses full `base-content` plus the primary line, not a primary-tinted
  fill with `primary-content`. Options: (a) base-content label (chosen); (b) `bg-primary` fill
  with `text-primary-content`. Evidence: (a) is the review's suggested fix and passes 13-14:1.
  (b) would add a conditional background that fights the static `bg-base-200/60
  hover:bg-base-300/80`, and it would restyle four shared tabs. Reversible: yes, one binding.

## Out-of-scope observations

- The 2 px `bg-primary` active line is a non-text state cue. With light `primary` it is about
  1.2:1 on the tab, under the 3:1 of WCAG 1.4.11. The state is still conveyed by the label
  tone and `aria-expanded`. If the line has to carry the state alone, it could use
  `bg-base-content`.
