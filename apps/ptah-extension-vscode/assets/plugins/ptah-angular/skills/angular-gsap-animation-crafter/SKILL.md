---
name: angular-gsap-animation-crafter
description: 'Designs scroll, parallax and timeline motion for @hive-academy/angular-gsap. Use for scroll-triggered or viewport animations, pinned or hijacked-scroll sections, easing and timing, or recreating motion from a reference. A 3D scene is angular-3d-scene-crafter and may load when the task has both. Component structure may load angular-frontend-patterns. Non-Angular animation is outside this skill.'
---

# Angular GSAP Animation Crafter

## Rules

- Before generating animation code, check the project's `package.json` for `@hive-academy/angular-gsap`; install it or confirm the intended version if absent.
- For a visual reference, identify motion type, timing, easing, trigger points, and scroll behavior before choosing directives.
- For a written brief, choose viewport, scroll-linked, or fullpage behavior, then configure timing and triggers before presenting the complete Angular component.
- Use `once: true` for non-reversible entrances, limit stagger counts, and respect `prefers-reduced-motion` with reduced durations.
- Keep library directive setups compatible with server-side rendering.

## Load on demand

- [Image and video workflow](references/image-workflow.md): load when recreating motion from a video, GIF, image, or reference site.
- [Text workflow](references/text-workflow.md): load when the user describes an animation without a visual reference.
- [Animation templates](references/templates.md): load when a ready-to-use page or section asset matches the requested behavior.
- [Component catalog](references/components.md): load when selecting directives, services, or exact configuration inputs.
- [Animation patterns](references/patterns.md): load when choosing or combining motion patterns.
- [Best practices](references/best-practices.md): load when tuning timing, easing, trigger points, accessibility, or performance.
