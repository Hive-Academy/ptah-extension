# Voice canvas fix report

| Item | Result | File:line | Test |
| --- | --- | --- | --- |
| 1. Ambient redraw and off-screen pause | Ambient paint capped at one per 33ms; live activity paints every frame. One canvas IntersectionObserver uses the renderer visibility path and disconnects on teardown. Reduced motion stops ambient scheduling. | `scene/command-scene-renderer.ts:202,308`; `scene/command-scene.component.ts:379,420,472` | Renderer ambient/live/reduced-motion specs; component intersection spec |
| 2. Orbit tracks | Layout returns its actual orbit count and renderer uses it for decoration. | `scene/scene-layout.ts:31,574`; `scene/command-scene-renderer.ts:236` | Layout owned-node count and renderer track specs |
| 3. NaN voice level | Non-finite input becomes zero; finite input is clamped to 0..1. | `scene/command-scene-decoration.ts:64` | NaN gradient spec |
| 4. Tether direction | Tether path now runs owner to work, matching dash flow on root links. | `scene/command-scene-renderer.ts:398` | Renderer tether direction specs |
| 5. Rail text | Three 10px utilities changed to 11px. | `components/command-work-list.component.ts:121`; `components/command-node-detail.component.ts:71,86` | Lint and alpha guard |

## Checks

- `nx typecheck command-center --parallel=1 --output-style=static`: passed.
- `nx lint command-center --parallel=1 --output-style=static`: passed, 0 errors and 0 warnings.
- `nx test command-center --parallel=1 --output-style=static --maxWorkers=2`: 48 suites, 550 tests passed.
- `jest -c apps/ptah-extension-webview/jest.config.ts apps/ptah-extension-webview/src/app/no-alpha-base-content.spec.ts --coverage=false --maxWorkers=2`: 11 tests passed.
- Scoped `ptah_get_diagnostics` timed out before reporting diagnostics; the mandatory project typecheck passed.
