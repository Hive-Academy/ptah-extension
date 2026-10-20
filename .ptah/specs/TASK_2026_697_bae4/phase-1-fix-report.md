# Phase 1 fix report — TASK_2026_697_bae4

Review scope: `libs/frontend/command-center/src/lib/`. All eight review items were addressed within the assigned paths.

| # | Status | Change (file:line) | Regression evidence |
| --- | --- | --- | --- |
| 1 Serious | Fixed | `scene/command-scene.component.ts:122,331-338,405`: resolve inks after the applied `data-theme` mutation; disconnect observer; idle uses `--bcm`/`--bc` or computed text color. | `scene/command-scene.component.spec.ts:102` switches dark to forest with the same theme class and checks refreshed run/idle inks; existing scene test checks no style read on voice or class update. |
| 2 Serious | Fixed | `components/command-relative-time.ts:2-5`: clamp future skew to zero; null only for invalid values. | `components/command-relative-time.spec.ts:11-18`, `command-center-start.component.spec.ts:60`, `command-node-detail.component.spec.ts:28-32`. |
| 3 Moderate | Fixed | `components/command-center-page.component.ts:435-440`: exclude root and phase from work counts. | `components/command-center-page.component.spec.ts:285-307` includes running root and waiting phase. |
| 4 Moderate | Fixed | `components/command-node-detail.component.ts:68-71`: take first nonblank task line, retaining the 160-character bound and Angular escaping. | `components/command-node-detail.component.spec.ts:28-31`. |
| 5 Moderate | Fixed | `components/command-node-detail.component.ts:60`, `command-overlay.component.ts:163`, `command-work-list.component.ts:126`, `command-center-start.component.ts:122`: require the live `now` input. | Existing page clock binding tests plus updated direct component fixtures; Nx typecheck passed. |
| 6 Minor | Fixed | `components/command-center-page.component.ts:187`: unknown context has a readable word. | `components/command-center-page.component.spec.ts:199`. |
| 7 Minor | Fixed | `components/command-overlay.component.ts:49-51`, `command-work-list.component.ts:50-52`: selection also has an outline; overlay already had `aria-pressed`. | `components/command-overlay.component.spec.ts:96`, `command-work-list.component.spec.ts:55`. |
| 8 Minor/informational | Documented | `integration/integration-harness.testing.ts:40`: explains why the scene stub has empty nodes and hides the overlay in integration tests. Projection behavior needed no change. | Existing integration harness tests; no functional code changed for this item. |

## Verification

- Changed specs: `Test Suites: 7 passed, 7 total`; `Tests: 81 passed, 81 total` (`--coverage=false --maxWorkers=2`). Jest reported an existing worker-exit warning after completion.
- Project suite: `Test Suites: 1 failed, 43 passed, 44 total`; `Tests: 1 failed, 472 passed, 473 total`. The failing suite was `components/command-center-page.controller.spec.ts`, outside this fix round's assigned paths. The requested filtered command did not retain its assertion details; it was not rerun solely to recover output.
- Project typecheck: `NX Successfully ran target typecheck for project @ptah-extension/command-center`.
- Scoped ptah diagnostics: no errors in the requested changed source files. It also reported 29 errors in sibling spec files; the Nx project typecheck above passed.

## Decisions

- Used a single `MutationObserver` on the root `data-theme` attribute because the dark/light input does not distinguish stock themes. This reads computed style after the attribute is applied and is disconnected on destruction. Reversible: replace with a post-render theme-key input if the host exposes one.
- Used the defined `--bcm` then `--bc` theme tokens for idle ink when `--state-ink-idle` is absent, matching the Tailwind `state-idle` fallback. Reversible: use an explicit idle token if all themes acquire one.
- Clamped every finite future timestamp to “Just now,” following the task's explicit instruction to reserve null for invalid/non-finite values. Reversible: introduce a bounded skew policy if product requirements change.
- Left the controller suite failure and unrelated sibling spec diagnostics outside this batch's ownership; neither failure identifies one of the reviewed interface findings.
