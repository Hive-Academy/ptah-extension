---
status: backlog
type: refactoring
title: >-
  Tailwind 4 and daisyUI 5
description: >-
  Wave 6 of TASK_2026_498_5513, deliberately deferred to its own pull request.
  The config surface is two `tailwind.config.js` files, one `postcss.config.js`
  and two `styles.css` entry points. The real cost is the six hand-authored
  daisyUI themes, which must be rewritten against a different variable
  vocabulary, plus about 700 class occurrences the codemod does not cover.
---

# Tailwind 4 and daisyUI 5

Wave 6 of TASK_2026_498_5513. The full research is in
`.ptah/specs/TASK_2026_498_5513/research-tailwind.md`.

## Why it is its own task

daisyUI 5 requires Tailwind 4, so the two move together. Neither has a codemod
that covers the theme rewrite.

## Measured blast radius

| Change                                                   | Occurrences | Files |
| -------------------------------------------------------- | ----------- | ----- |
| `input-bordered` family                                  | 272         | ~95   |
| `form-control`, `label-text`, `label-text-alt` (removed) | 231         | 24    |
| `flex-shrink-*`, `flex-grow-*`                           | 152         | 58    |
| `outline-none` -> `outline-hidden`                       | —           | 20    |
| `bg-gradient-to-*` -> `bg-linear-to-*`                   | —           | 18    |
| `tabs-bordered`, `tabs-lifted`, `tabs-boxed`             | 17          | 11    |

The six custom themes use daisyUI 4 variables (`--rounded-box`,
`--btn-focus-scale`, `--animation-btn`, `--tab-radius`). daisyUI 5 replaces
them with `--radius-box`, `--radius-field`, `--depth`, `--noise`, declared in
CSS through `@plugin "daisyui/theme"` rather than in a JavaScript object. That
is a redesign, not a text substitution.

## Known risk

`angular/angular#59784`: ng-packagr fails to build an Angular **library** with
Tailwind 4 through PostCSS. No library here runs its own Tailwind build, so the
defect has no trigger point today. Confirm that still holds before starting.

## Not a blocker

The Tailwind 4 browser floor (Chrome 111, Safari 16.4, Firefox 128) clears both
Electron and the VS Code webview with wide margin.
