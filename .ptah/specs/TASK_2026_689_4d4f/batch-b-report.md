# Batch B — core dial and status cards

## Files created

- `libs/frontend/command-center/src/lib/scene/command-core.component.ts`
- `libs/frontend/command-center/src/lib/scene/command-core.component.css`
- `libs/frontend/command-center/src/lib/scene/command-core.component.spec.ts`
- `libs/frontend/command-center/src/lib/scene/command-status-groups.component.ts`
- `libs/frontend/command-center/src/lib/scene/command-status-groups.component.css`
- `libs/frontend/command-center/src/lib/scene/command-status-groups.component.spec.ts`

## Batch B acceptance

- Seven voice states are exposed on the dial and caption (`command-core.component.ts:13,42`), with tokenized solid/dashed/partial ring styles (`command-core.component.css:13-20`). The 96 static ticks and every-eighth major tick are in `command-core.component.ts:4,16-21`; the seven states and tick counts are covered by `command-core.component.spec.ts:19-39`.
- Listening and speaking levels clamp to 0–1 and scale at most 1.025 (`command-core.component.ts:69-75`). Reduced motion and visibility pause fix scale at 1 and pause thinking rotation (`command-core.component.ts:14,70`, `command-core.component.css:21,37`); tests are at `command-core.component.spec.ts:41-63`.
- The native root button exposes `data-core-root-id`, preview/pin ARIA relationships and hover/focus/activate/Escape outputs (`command-core.component.ts:24-36`). Keyboard activation uses native button click behavior. Tests cover events, focus retention and plate attributes (`command-core.component.spec.ts:65-99`). Absent root has a zero, noninteractive visual (`command-core.component.ts:46-51`, `command-core.component.spec.ts:101-107`).
- The dial uses 292/200/160px container widths, a 68% root button and hides duplicate voice caption at 160px (`command-core.component.css:4,24,35-36`). No tribunal aggregate input exists (`command-core.component.ts:55-64`).
- Four static cards take `StatusCounts` in the specified order and expose `data-status-card` hooks (`command-status-groups.component.ts:3-8,17-36`). Failed/cancelled stay named in Other; cards have no interactive elements or tab stops (`command-status-groups.component.ts:32-36`, `command-status-groups.component.spec.ts:5-19`). Counts default to zero (`command-status-groups.component.ts:40`, `command-status-groups.component.spec.ts:21-29`). Glass styling and responsive layouts are in `command-status-groups.component.css:2-13`.

## Decisions

- **`StatusCounts` location:** Exported the fixed four-field structural type from the status component (`command-status-groups.component.ts:3-8`), since the parallel placement file was not yet present and the fixed contract specifies its shape rather than a defining file. Alternative: import it from placement. This is reversible without changing the component input shape.
- **Listening color:** Mixed the existing theme-aware running and finished inks to make a teal ring (`command-core.component.css:15`). Alternative: add a new teal palette token. Existing `--state-ink-run` and `--state-ink-done` are defined in `apps/ptah-extension-webview/tailwind.config.js`; no new theme token was needed. Reversible.
- **Root pressed state:** Bound `aria-pressed` to the fixed `pinnedId` input (`command-core.component.ts:28`), while `activeId` controls preview description. The fixed core interface does not include `selectedId`; pin is the persistent root activation state. Reversible if the facade later expands the contract.

## Verification and remaining work

- Scoped `ptah_get_diagnostics` reported **no diagnostics in the four new TypeScript files**. It also reported 29 errors in sibling files outside this batch, including existing integration and model specs; those files were not edited.
- Nx, Jest, TypeScript CLI, build and visual checks were not run, as required for parallel lanes. The orchestrator owns scoped checks and Batch D2 page wiring.
