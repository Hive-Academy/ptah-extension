---
status: backlog
type: refactoring
title: >-
  Tailwind 4 and daisyUI 5
description: >-
  Move the renderer and the landing page to Tailwind 4 and daisyUI 5. The main cost is five
  hand-authored daisyUI themes and about 450 class occurrences that the codemod does not cover.
updated: 2026-11-07T00:00:00.000Z
---

# Tailwind 4 and daisyUI 5

## Description

Wave 6 of TASK_2026_498_5513, deferred to its own pull request. The full research is in
`.ptah/specs/TASK_2026_498_5513/research-tailwind.md`.

The config surface is two `tailwind.config.js` files
(`apps/ptah-extension-webview/tailwind.config.js`, `apps/ptah-landing-page/tailwind.config.js`), one
`apps/ptah-extension-webview/postcss.config.js` and two `styles.css` entry points
(`apps/ptah-extension-webview/src/styles.css`, `apps/ptah-landing-page/src/styles.css`).

## Current state (2026-11-07)

- Not started. `package.json:184,205` has `daisyui` `^4.12.24` and `tailwindcss` `^3.4.18`.
- Five custom themes: `anubis`, `anubis-light`, `ptah-glass`, `ptah-glass-light`
  (`apps/ptah-extension-webview/tailwind.config.js:87,156,232,277`) and `operator`
  (`apps/ptah-landing-page/tailwind.config.js:94`).
- The 32 prebuilt daisyUI themes are compiled into a separate `theme-extra.css` from
  `node_modules/daisyui/dist/themes.css` (`apps/ptah-extension-webview/tailwind.config.js:321-332`).
  That path changes with daisyUI 5 and must move too.
- The blast radius below was re-counted on 2026-11-07 over `apps` and `libs` (`.html`, `.ts`,
  `.css`). It is smaller than the first count, because removed apps took their templates with them.

## Why it is its own task

daisyUI 5 requires Tailwind 4, so the two move together. Neither has a codemod
that covers the theme rewrite.

## Measured blast radius

| Change                                                   | Occurrences | Files |
| -------------------------------------------------------- | ----------- | ----- |
| `input-bordered` family (incl. select, textarea)         | 172         | 91    |
| `form-control`, `label-text`, `label-text-alt` (removed) | 20          | 6     |
| `flex-shrink-*`, `flex-grow-*`                           | 181         | 67    |
| `outline-none` -> `outline-hidden`                       | 52          | 38    |
| `bg-gradient-to-*` -> `bg-linear-to-*`                   | 5           | 5     |
| `tabs-bordered`, `tabs-lifted`, `tabs-boxed`             | 19          | 4     |

The five custom themes use daisyUI 4 variables (`--rounded-box`,
`--btn-focus-scale`, `--animation-btn`, `--tab-radius`). daisyUI 5 replaces
them with `--radius-box`, `--radius-field`, `--depth`, `--noise`, declared in
CSS through `@plugin "daisyui/theme"` rather than in a JavaScript object. That
is a redesign, not a text substitution.

## Known risk

`angular/angular#59784`: ng-packagr fails to build an Angular **library** with
Tailwind 4 through PostCSS. No library here runs its own Tailwind build (no
`tailwind.config.*` or `postcss.config.*` under `libs/` on 2026-11-07), so the
defect has no trigger point today. Confirm that still holds before starting.

## Not a blocker

The Tailwind 4 browser floor (Chrome 111, Safari 16.4, Firefox 128) clears the
Electron 44 renderer with wide margin.
