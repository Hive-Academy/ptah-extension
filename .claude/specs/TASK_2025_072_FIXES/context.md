# TASK_2025_072_FIXES - Landing Page QA Fixes + Hero Redesign

**Created**: 2025-12-15
**Status**: IN PROGRESS
**Parent Task**: TASK_2025_072

---

## Part 1: Code Style Review Issues (8 total)

### Blocking (3)

1. **GSAP ScrollTrigger.getAll() breaks encapsulation**

   - Files: hero-section.component.ts:259, cta-section.component.ts:233, comparison-section.component.ts:229
   - Fix: Remove explicit `ScrollTrigger.getAll().forEach()`, rely on `gsapContext.revert()`

2. **Three.js background texture not disposed**

   - File: hero-scene.component.ts:108, 164-173
   - Fix: Store texture reference and dispose in cleanup

3. **Arrow function event listeners prevent cleanup**
   - File: hero-scene.component.ts:147-148, 158-159
   - Fix: Use bound references for proper removal

### Serious (7)

4. Inconsistent prefers-reduced-motion check location
5. CSS custom property naming collision (--glass-panel vs --glass-bg)
6. Magic numbers without design system reference
7. Inline styles break Tailwind theming
8. EffectComposer not resized on window resize
9. Date.now() instead of clock.getElapsedTime()
10. Tailwind animation naming conflicts with DaisyUI

---

## Part 3: Code Logic Review Issues (13 total)

### Critical (5)

1. **Missing WebGL context loss handling**

   - File: hero-scene.component.ts
   - Fix: Add webglcontextlost/restored event listeners

2. **GSAP ScrollTrigger global kill bug** (duplicate of style #1)

3. **Non-null assertion on Canvas 2D context**

   - File: hero-scene.component.ts:184
   - Fix: Add null check with fallback

4. **UnrealBloomPass resolution not updated on resize**

   - File: hero-scene.component.ts:379-386
   - Fix: Update bloom pass resolution in onResize

5. **Race condition between entry and scroll animations**
   - File: hero-section.component.ts:172-253
   - Fix: Disable scroll triggers until entry animation completes

### Serious (8)

6. No FPS monitoring despite requirement
7. No WebGL support detection
8. RAF loop continues in background tabs
9. SVG arrow path/viewBox mismatch
10. Missing runtime prefers-reduced-motion detection
11. Gradient texture not cached, leaks on re-init
12. Bloom pass not disposed on cleanup
13. No GLTF load timeout

---

## Design Assets

| Asset                          | Purpose                 |
| ------------------------------ | ----------------------- |
| hero_ankh_sphere.png           | Target design reference |
| circuit_corner_topleft.png     | Top-left decoration     |
| circuit_corner_bottomright.png | Bottom-right decoration |

---

## Success Criteria

1. Hero section matches target design aesthetic
2. All blocking QA issues fixed
3. No memory leaks in Three.js scene
4. Proper GSAP cleanup without breaking other sections
5. Build passes with no errors
