# PR #730 CodeRabbit canvas fixes

| Comment id | Valid? | Fix (file:line) | Test added (spec:line) | Check result |
| --- | --- | --- | --- | --- |
| 4277283760 | Yes; `anubis` idle ink was `#6b7280` on dark surfaces. | `apps/ptah-extension-webview/tailwind.config.js:115` — changed only `anubis` idle ink to `#9ca3af`. | `apps/ptah-extension-webview/src/app/base-content-muted.spec.ts:54` — checks 4.5:1 on both surfaces. | Webview spec: 180 passed. |
| 4277283797 | Yes; selected `bg:` key had no `sub:` fallback. | `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.ts:168` — maps both directions. | `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.spec.ts:119` — background to completed sub-agent. | 8 passed. |
| 4277283810 | Yes; expansion changes retriggered the effect. | `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.ts:294` — expand only when selected agent id changes. | `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.spec.ts:152` — user collapse stays collapsed. | 17 passed. |
| 4277283818 | Yes; every collapsed card claimed focus. | `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-card.component.ts:113` — conditional label suffix. | `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-card.component.spec.ts:316` — focused and unfocused labels. | 20 passed. |
| 4277283828 | Yes; window keyboard handler could switch sessions for outside and scrolling targets. | `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-keyboard.ts:64`; `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts:265` — guard canvas host and scrollable ancestors. | `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-keyboard.spec.ts:39` — outside, scrollable, and valid target. | 16 passed. |
| 4277283841 | Yes; null `addTile` silently cleared the request. | `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts:397` — announce `TILE_BOUND_MESSAGE`. | `libs/frontend/canvas/src/lib/orchestra-canvas.rail.spec.ts:399` — external request at tile bound. | 16 passed. |

## Decisions

- All six comments were reproduced against the current source. The `anubis-light` token remains unchanged.
- `CanvasRailKeyboardContext.host` is optional because the existing rail component also calls the helper from its own keydown handler; OrchestraCanvas supplies the viewport for its window handler.
- The scoped canvas typecheck passed. Scoped diagnostics found no errors in the requested implementation files; its broader compiler scan reported seven unrelated errors, including one existing test-file typing issue at `orchestra-canvas.rail.spec.ts:276`.
- Canvas lint completed with 0 errors and 31 warnings.

## Checks

| Exact command | Summary |
| --- | --- |
| `node .ptah/tmp/check-run.mjs canvas-lane-tabs -- npx nx test canvas --testFile=canvas-lane-tabs.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` | PASS — 1 suite, 8 tests. |
| `node .ptah/tmp/check-run.mjs canvas-lane-view -- npx nx test canvas --testFile=canvas-lane-view.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` | PASS — 1 suite, 17 tests. |
| `node .ptah/tmp/check-run.mjs canvas-rail-card -- npx nx test canvas --testFile=canvas-rail-card.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` | PASS — 1 suite, 20 tests. |
| `node .ptah/tmp/check-run.mjs canvas-rail-keyboard -- npx nx test canvas --testFile=canvas-rail-keyboard.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` | PASS — 1 suite, 16 tests. |
| `node .ptah/tmp/check-run.mjs orchestra-canvas-rail -- npx nx test canvas --testFile=orchestra-canvas.rail.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` | PASS — 1 suite, 16 tests. |
| `node .ptah/tmp/check-run.mjs webview-idle-ink -- npx nx test ptah-extension-webview --testFile=base-content-muted.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` | PASS — 1 suite, 180 tests. |
| `node .ptah/tmp/check-run.mjs canvas-typecheck -- npx nx typecheck canvas --parallel=1 --skip-nx-cache` | PASS — Nx target succeeded. |
| `node .ptah/tmp/check-run.mjs canvas-lint -- npx nx lint canvas --parallel=1 --skip-nx-cache` | PASS — Nx target succeeded; 0 errors, 31 warnings. |

## Revision 1

The host guard for comment 4277283828 also rejected `document.body` and
`document.documentElement`, which receive window keydown events when no child
element has focus. At `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-keyboard.ts:64`,
those document roots are now treated as in scope and skip the scrollable-region
walk. Other targets still require containment in the supplied host. The new
case at `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-keyboard.spec.ts:39`
confirms that a body-targeted ArrowRight moves focus with a host supplied.

| Exact command | Summary |
| --- | --- |
| `node .ptah/tmp/check-run.mjs kb -- npx nx test canvas --testFile=canvas-rail-keyboard.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` | PASS — 1 suite, 17 tests. |
| `node .ptah/tmp/check-run.mjs kb-lint -- npx nx lint canvas --parallel=1 --skip-nx-cache` | PASS — Nx target succeeded; 0 errors, 31 warnings. |

Scoped diagnostics found no errors in the changed implementation file.
