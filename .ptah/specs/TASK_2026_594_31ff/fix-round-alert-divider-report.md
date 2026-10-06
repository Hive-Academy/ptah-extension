# Fix round — alert and divider renderers (TASK_2026_594_31ff)

Status: DONE. Both fixes implemented; the full scoped verification passes.
Only the four allowed files were changed. No git commands run.

## Files modified (absolute)

1. `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/dashboard-alert.component.ts`
2. `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/dashboard-alert.component.spec.ts`
3. `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/dashboard-divider.component.ts`
4. `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/dashboard-divider.component.spec.ts`

## Fix 1: Alert — visible tone + base-level text contrast (S2, S3, code-logic Serious)

What changed:

- The per-tone filled `alert alert-<tone>` backgrounds are gone. The root stays
  the daisyUI `alert` component but on a neutral surface with a tone accent
  border: one complete literal per tone in `ALERT_TONE_STYLES`
  (`dashboard-alert.component.ts:14-35`), e.g.
  `info: 'alert border border-info bg-base-200 text-base-content'`
  (`:16`). No concatenation; text stays `text-base-content`, which measured
  14.9:1 / 15.9:1 in the review, so the sub-4.5:1 tone-content text (S2) is
  gone. Tone survives as a border + icon accent only.
- The sr-only tone word is replaced by a visible tone label: each tone gets an
  inline SVG icon with `aria-hidden="true"` and a complete literal icon class
  `'h-4 w-4 shrink-0 text-<tone>'` (`:17,22,27,32`, bound at `:46,49,52,55`),
  plus a visible `font-semibold` label span "Info" / "Success" / "Warning" /
  "Error" with `data-testid="alert-tone"` (`:18,23,28,33`, rendered at `:58`).
  Sighted, colour-blind users now read the tone (S3 + code-logic Serious S1).
  No external icon import: the SVGs are inline in the template, so the webview
  eager closure is unchanged.
- Role stays assertive/polite by tone (`alertRole`, `dashboard-alert.component.ts:71-73`).
- Layout stays one compact line (daisyUI `alert` grid-auto-flow column):
  icon, tone label, then text; with a title, the title renders after the tone
  label and before the text in the same element
  (`:58-62`). Without a title no title element and no placeholder exists.
- Plain text only: interpolation everywhere, no `innerHTML`, no hard-coded
  colour utility in any class string.

Spec evidence (`dashboard-alert.component.spec.ts`):

- Per tone, per theme root (`anubis` / `anubis-light`): exact class set of the
  root literal (sorted-token equality, because Ivy writes the class set in its
  own order — the source literal is what Tailwind scans), role per tone, exact
  icon class set, `aria-hidden="true"` on the svg, visible label text, no
  `.sr-only` left (`:50-61`).
- No title: no `[data-testid="alert-title"]`, exactly 2 element children
  (icon + label), single-line text `'Info Disk almost full'` (`:70-76`).
- With title: title inside the same alert element, order label < title < text,
  and the exact one-line reading `'Warning Deploy failed Disk almost full'`
  (`:77-88`).
- Hostile markup (`<img src=x onerror=...>`) stays text; no img/style/script
  node; no hard-coded colour utility (`:63-68`).

## Fix 2: Vertical divider draws no rule (S1)

What changed:

- The inner vertical divider fills its host: the vertical literal gains
  `h-full`, `vertical: 'divider divider-horizontal h-full'`
  (`dashboard-divider.component.ts:17`), so daisyUI's `::before` rule gets a
  real height instead of the measured 0px.
- The host stretches only for the vertical kind, via conditional host class
  bindings `[class.flex]` / `[class.self-stretch]` bound to `isVertical()`
  (`:23-27`, `:43`). In a horizontal flex stack the host now stretches across
  the row and the inner rule fills it. The horizontal divider keeps its
  default host and the bare `divider` class unchanged
  (`:16`), so the review-PASS horizontal case is untouched.
- No component `styles`, no hard-coded colours, no `innerHTML`.

Spec evidence (`dashboard-divider.component.spec.ts`):

- Vertical: host carries `flex` and `self-stretch`, inner carries `h-full`
  and `divider-horizontal` (`:33-41`).
- Horizontal: host has neither class and the inner has no `h-full` (`:42-45`).
- The exact-literal class test now expects `'divider divider-horizontal h-full'`
  for vertical and still `aria-orientation` equal to the contract direction,
  under both theme roots (`:20-31`). Text-only rendering and the hostile-markup
  test are unchanged and still pass (`:47-56`).
- Note: in this TestBed (Angular 22.1.7) the fixture root element itself
  carries the host bindings (`<div id="root2" ... class="self-stretch flex">`),
  so the spec asserts them on the fixture root element.

## Verification

Command (foreground, worktree root):

```
npx nx run-many -t typecheck,test,lint -p declarative-dashboard
```

Result: PASS — `Successfully ran targets typecheck, test, lint for project
@ptah-extension/declarative-dashboard` (24.0s), 0 errors.

Jest summary for the project suite: `Test Suites: 23 passed, 23 total; Tests:
249 passed, 249 total`. Scoped pre-check
`dashboard-(alert|divider)\.component`: 2 suites, 6 tests, all passed.

## Notes for the team-leader

- S4 (radial/neutral contrast), M2 (focus ring colour) and the remaining
  visual-review findings are outside this round's four files and untouched.
- The alert class-order difference (Ivy writes sets, order not guaranteed) is
  why two assertions compare sorted token sets; the complete literal strings
  remain the single source in the component source that Tailwind scans.