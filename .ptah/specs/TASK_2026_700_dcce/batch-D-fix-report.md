# Phase D fix report

| Item | Result | File:line | Test |
| --- | --- | --- | --- |
| 1. Plates below spheres | Fixed own-sphere collision and gap; root uses radius + 32 | `scene/scene-layout.ts:456,508-523` | `scene-layout.spec.ts:85` sparse 1440px placement |
| 2. Root rect fallback | Fixed clamped root plate even when collisions exhaust candidates | `scene/scene-layout.ts:530` | `scene-layout.spec.ts:225` crowded 24-node rect |
| 3. Child-owned tribunal lane | Fixed direct-parent tethers; renderer caches tethered IDs per snapshot | `scene/scene-layout.ts:556`; `scene/command-scene-renderer.ts:79,113,314` | `scene-layout.spec.ts:206` child to tribunal to lane |
| 4. Renderer length | Fixed by extracting status and voice ring drawing; renderer is 577 lines | `scene/command-scene-status.ts:7,112`; `scene/command-scene-renderer.ts:493,511` | Command Center suite, 527 passed |
| 5. Unknown child assertion | Fixed test to check aria-label, title, and normalized metadata separately | `components/command-overlay.component.spec.ts:351` | Unknown child wording spec |
| 6. Provider mark assertion | Fixed test to check Codex mark on Beta and no mark on Ptah | `components/command-overlay.component.spec.ts:519` | Provider mark spec |
| 7. Orbit curves | Fixed shared clamped orbit radii for layout and decoration | `scene/scene-layout.ts:61,198`; `scene/command-scene-decoration.ts:41` | Scene layout and renderer specs |
| 8. Child orbit radius | Fixed shared 70px constant | `scene/scene-layout.ts:59,355`; `scene/command-scene-renderer.ts:384` | Child orbit layout spec |
| 9. Overflow pill | Fixed top position from reserved band height | `scene/command-scene.component.ts:105` | `command-scene.component.spec.ts:151` |
| 10. Theme inks | Fixed ink resolution when theme input changes; data-theme observer remains | `scene/command-scene.component.ts:220-223` | `command-scene.component.spec.ts:270` |
| 11. Root context label | Fixed aria-label to include known context percentage | `components/command-overlay.component.ts:84,401` | `command-overlay.component.spec.ts:100` |

## Checks

| Check | Result |
| --- | --- |
| `nx typecheck command-center` | Passed |
| `nx lint command-center` | Passed, 0 errors, 0 warnings |
| `nx test command-center` | Passed, 45 suites and 527 tests |
| `jest no-alpha-base-content.spec.ts` | Passed, 11 tests |

`ptah_get_diagnostics` reported no diagnostics in edited files. It also reported 29 errors in sibling specs outside this batch's ownership; the scoped Nx typecheck passed.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Keep an 8px own-sphere gap for rect plates and 32px for the root | Same gap for all plates; separate root clearance | Phase D review and design-spec sphere grammar | Yes |
| Preserve the root plate by ignoring collisions only in its final fallback | Hide the root plate; clamp fallback | Root is the scene's accessible control; review item 2 | Yes |
| Tether only direct child-owned nodes | Tether every descendant; direct parent only | Tribunal lanes retain their tribunal link; D4 | Yes |
