# Batch 3 fix round

## Findings and fixes

- **S1, repeated DOM IDs and local state:** `ptah-ui-block.component.ts:130,272,292` assigns each block instance a unique reason ID and separate read-only interaction maps. The display ID remains the compiler ID at `:286-320`; it no longer supplies an accessibility ID. The fallback's `aria-describedby` and reason element use the same ID at `:230,235`. `ptah-ui-inline-display.component.spec.ts:152` mounts two turns with the same display ID, checks independent renderer interaction state, then checks distinct reason IDs and matching ARIA references.
- **M1, duplicated reserved-ID validation:** `ptah-ui-block.component.ts:39,298-315` calls the exported `compileDisplayFences` collection path for named display fences, reusing its reserved-ID rule and error result. Anonymous fences still compile with their original ordinal and `anonymousDisplaySurfaceId` at `:286-320`. The collection's private `compileFence` cannot be exported within this batch's ownership; the exported collection function provides the shared check without editing the display-panel files.
- **M2, missing state coverage:** `ptah-ui-inline-display.component.spec.ts:118,143,152,189,249` checks pending and dock-invalid inline rendering, same-ID updates, hidden actions for invalid and evicted, the superseded `Open latest` label, and output forwarding. `:109` asserts the VS Code host-null case has no action. The repeated-ID test also asserts that each renderer receives its own read-only interaction object and action map.
- **M3, historical first paint:** `ptah-ui-inline-display.component.spec.ts:214` removes a block, fills the live window with newer keys, remounts it with an already superseded or evicted status, and asserts snapshot mode plus a full renderer.
- **M4, noisy host-null note:** `ptah-ui-display-chip.component.ts:22-65` renders the compact status only when a display dock and host sources exist. Inline content remains visible; `ptah-ui-display-chip.component.spec.ts:136` and `ptah-ui-inline-display.component.spec.ts:109` check that no chip or action appears without a dock.
- **Minor formatting and presentation:** Targeted Prettier formatting was applied to the four touched source/spec files. The full inline block retains the prior fallback reason; the chip still carries state and navigation labels. The default `displayId` input remains for ordinary inline blocks.

## Verification

No tests, typecheck, lint, build, serve, or e2e commands were run, as directed. Targeted Prettier formatting completed. Angular runtime behavior and test outcomes await the orchestrator's checks.

## Decisions

- **Reuse the exported collection compiler for named display fences.** Options were duplicating the reserved rule, editing the private collection helper outside the batch, or calling its exported wrapper. The wrapper already owns the rule and is callable from chat-ui. This is reversible if the collection exposes a narrower helper later.
- **Hide host-null chip content.** Options were repeating an unavailable note under each block or suppressing the chip when no dock exists. The inline renderer is useful in VS Code without a sheet, and the review called the repeated note noisy. This is reversible in the chip template.
- **Keep read-only interaction maps per block.** Options were sharing the constant maps or allocating them per instance. Per-instance maps prevent a renderer's local view actions from aliasing another historical block. This is reversible if the renderer contract becomes immutable.
