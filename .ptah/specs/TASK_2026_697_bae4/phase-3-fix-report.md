# Phase 3 fix report

| Finding | Result | Source | Regression test |
| --- | --- | --- | --- |
| 1. Stale page clock | Fixed: accept starts up to one 30 s clock period ahead; clamp negative renderer elapsed to zero. | `model/work-projection.ts:35,93-100`; `scene/command-scene-renderer.ts:552-558` | `model/work-projection.spec.ts:323`; `scene/command-scene-renderer.spec.ts:426` |
| 2. Elapsed text | Fixed: shared detail shows `Running for <duration>` for timed running nodes, using the supplied `now` and shared `formatDuration`. | `components/command-node-detail.component.ts:92-96,150-155` | `components/command-node-detail.component.spec.ts:64` |
| 3. Nonpositive epoch | Fixed: start must be positive and finite. | `model/work-projection.ts:95-99` | `model/work-projection.spec.ts:323` |
| 4. Standalone CLI arcs | Kept as directed; standalone CLI agents were named in the brief. | `model/work-projection.ts:288` | Existing `model/work-projection.spec.ts:323` verifies CLI start propagation. |
| 5. Empty current figures | Fixed: figures row appears only if cost or tokens are known. | `components/command-center-start.component.ts:88,214-223` | `components/command-center-start.component.spec.ts:168-205` |
| 6. Meter value text | Fixed: speaker and microphone meters expose percentage text. | `components/command-voice-hud.component.ts:55,74` | `components/command-voice-hud.component.spec.ts:30-35` |

## Checks

- Targeted Jest: 5 suites passed, 51 tests passed. Jest emitted a worker exit warning after the passing run.
- `npx nx test command-center --parallel=1 --output-style=static -- --maxWorkers=2`: 45 suites passed, 492 tests passed.
- `npx nx typecheck command-center --parallel=1 --output-style=static`: successfully ran.
- `npx nx lint command-center --parallel=1 --output-style=static`: successfully ran.
- Scoped `ptah_get_diagnostics` initially reported no errors in requested files and 29 sibling errors. A later diagnostics call timed out; the completed Nx typecheck passed.

## Decisions

- Kept elapsed arcs on standalone CLI agents. Removing them was an option, but the orchestrator decision says the brief named CLI agents and the existing projection test covers their timestamps. This is reversible.
- Used the library's existing `formatDuration` for visible elapsed text and the supplied page clock. A local formatter or timer would duplicate existing behavior. This is reversible.
