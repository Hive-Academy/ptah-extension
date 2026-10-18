# Batch B2 — motion tokens, view transitions, and Electron surface naming

## Files changed

- `apps/ptah-extension-webview/src/styles.css` — added shared motion tokens, page and named-surface View Transition rules, and reduced-motion overrides.
- `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts` — named one content element in each of the three mutually exclusive shell states.
- `libs/frontend/chat/src/lib/components/templates/electron-shell.view-transition.spec.ts` — added render assertions for all three shell states.

## Tokens and CSS rules

| Token | Value |
| --- | --- |
| `--ptah-ease-soft` | `cubic-bezier(0.22, 0.61, 0.36, 1)` |
| `--ptah-ease-gentle-in` | `cubic-bezier(0.4, 0, 0.2, 1)` |
| `--ptah-motion-out` | `120ms` |
| `--ptah-motion-in` | `200ms` |
| `--ptah-stagger-step` | `28ms` |

`:root` defines all five. `.ptah-vt-surface` names the `ptah-surface` group; `::view-transition` has `pointer-events: none`. Root old/new use symmetric 180 ms opacity keyframes (`ptahPageOut`, `ptahPageIn`) with the soft easing. Named surface old fades out in 120 ms with the gentle-in easing; new fades in while rising 4 px over 200 ms with the soft easing (`ptahPageRiseIn`). The existing reduced-motion media block now sets `animation: none !important` on `::view-transition-group(*)`, `::view-transition-old(*)`, and `::view-transition-new(*)`.

## Spec cases

- No workspace and no configuration surface: only `ptah-electron-welcome` carries `.ptah-vt-surface`.
- Pre-workspace configuration: only the outlet wrapper carries the class and contains `router-outlet`.
- Open workspace: only `[data-test="configuration-surface-host"]` carries the class.

Each case renders the real shell template and asserts exactly one named element.

## Verification

Scoped `ptah_get_diagnostics` was called after the edits with all three changed files, then with the two TypeScript files and `severity: error`. Both calls reported TypeScript unavailable: the compiler check was still running after 45 seconds, leaving both TypeScript files unchecked. The first call also reported CSS unrecognised. No errors or warnings were returned, but these results are **not** a diagnostics pass.

Heavy checks were not run because the B2 assignment says another heavy check is in progress. Commands for the orchestrator, one at a time:

```powershell
npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/components/templates/electron-shell.view-transition.spec.ts --coverage=false --maxWorkers=2
npx nx typecheck @ptah-extension/chat --parallel=1
npx nx lint @ptah-extension/chat --parallel=1
```

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Name the existing welcome element, outlet wrapper, and configuration host with static classes. | Add wrappers or dynamic class bindings. | Approved plan component 4 and the mutually exclusive branches in `electron-shell.component.ts:266-309`. | Yes. |
| Use a standalone markdown test stub for the shell's imported child graph. | Reproduce the existing tests' mock `NgModule`. | Existing `electron-shell.*.spec.ts` files mock the ESM-only package; project guidance requires standalone Angular code. | Yes. |

## Clarifications Needed

None.
