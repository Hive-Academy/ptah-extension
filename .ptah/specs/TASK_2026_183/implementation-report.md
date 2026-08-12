# Implementation Report — TASK_2026_183

## Scope

Fix the opacity-modified `text-base-content/NN` daisyUI construct in the three
Tasks UI files identified by TASK_2026_181 Batch 7, and decide the anubis
`primary-content` contrast defect by adjusting the default theme token.

## Files changed

| Absolute path                                                                                             | What changed                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `D:/projects/ptah-extension/libs/frontend/tasks-ui/src/lib/components/board/task-card.component.ts`       | All `text-base-content/<opacity>` tokens replaced with full-opacity `text-base-content`.                                                                                                     |
| `D:/projects/ptah-extension/libs/frontend/tasks-ui/src/lib/components/tasks-view.component.ts`            | All `text-base-content/<opacity>` tokens replaced with full-opacity `text-base-content`; the two decorative `/20` icons (`aria-hidden="true"`) were left untouched per the spec constraints. |
| `D:/projects/ptah-extension/libs/frontend/tasks-ui/src/lib/components/detail/task-relations.component.ts` | All `text-base-content/<opacity>` tokens replaced with full-opacity `text-base-content`.                                                                                                     |
| `D:/projects/ptah-extension/apps/ptah-extension-webview/tailwind.config.js`                               | `anubis` theme `primary-content` changed from `#e8e6e1` to `#f8f7f4`.                                                                                                                        |

## Before / after token values

### Component files

| File                          | Opacity tokens removed                                                                         | Replacement         |
| ----------------------------- | ---------------------------------------------------------------------------------------------- | ------------------- |
| `task-card.component.ts`      | `text-base-content/40`, `text-base-content/50`, `text-base-content/60`                         | `text-base-content` |
| `tasks-view.component.ts`     | `text-base-content/50`, `text-base-content/60`                                                 | `text-base-content` |
| `task-relations.component.ts` | `text-base-content/40`, `text-base-content/50`, `text-base-content/60`, `text-base-content/80` | `text-base-content` |

Hierarchy is carried by existing size (`text-xs`, `text-[10px]`) and weight
(`font-mono`, `font-normal`) classes, not by an opacity modifier.

### Theme file

| Token                    | Before    | After     |
| ------------------------ | --------- | --------- |
| `anubis.primary-content` | `#e8e6e1` | `#f8f7f4` |

This fixes every `badge-primary` / `btn-primary` small-text site in the
product globally, including the already-noted
`libs/frontend/tasks-ui/src/lib/components/detail/task-detail.component.ts:236`
hover state, rather than patching individual consumers.

## Verified contrast ratios

Ratios were recomputed from the literal theme values
(`apps/ptah-extension-webview/tailwind.config.js` for anubis/anubis-light,
`node_modules/daisyui/src/theming/themes.js` for built-ins), converting
OKLCH to sRGB via `culori` and blending at the stated alpha.

### Full-opacity `base-content` on each mandated base

| Theme         | `base-100`                    | `base-content`                 | Ratio       |
| ------------- | ----------------------------- | ------------------------------ | ----------- |
| anubis        | `#131317`                     | `#e8e6e1`                      | **14.86:1** |
| anubis-light  | `oklch(97.788% 0.004 56.375)` | `oklch(23.574% 0.066 313.189)` | **15.92:1** |
| daisyUI dark  | `#1d232a`                     | `#A6ADBB`                      | **7.03:1**  |
| daisyUI light | `#ffffff`                     | `#1f2937`                      | **14.68:1** |

All exceed the 4.5:1 gate; the worst case is daisyUI dark at 7.03:1.

### New `anubis` `primary-content` on primary surfaces

| Background                | `primary-content` | Ratio      |
| ------------------------- | ----------------- | ---------- |
| `primary` `#2563eb`       | `#f8f7f4`         | **4.82:1** |
| `primary-focus` `#1d4ed8` | `#f8f7f4`         | **6.26:1** |

Both exceed the 4.5:1 gate (previous `#e8e6e1` on `#2563eb` was 4.14:1).

## Test / lint totals

| Project                    | Target | Baseline       | Post-edit      |
| -------------------------- | ------ | -------------- | -------------- |
| `@ptah-extension/tasks-ui` | lint   | pass           | pass           |
| `@ptah-extension/tasks-ui` | test   | **470 passed** | **470 passed** |
| `ptah-extension-webview`   | lint   | pass           | pass           |
| `ptah-extension-webview`   | test   | **6 passed**   | **6 passed**   |

## Notes

- No files under `libs/api/`, `libs/web/`, `apps/ptah-license-server/`, or
  `libs/frontend/ui/src/lib/native/shared/` were modified.
- No `git` operations were performed (no branch changes, stashes, or commits).
