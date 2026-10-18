## Workflow A: Image/Video-Based Reverse Engineering

**Use when:** User provides a reference video, GIF, or image showing scroll animations to recreate.

### 1. Request Image/Video

Ask the user to share:

- Video/GIF of scroll interaction
- Screenshot of animation state
- Link to reference website

### 2. Perform Motion Analysis

When media is provided, analyze these key aspects:

#### Animation Type Detection

- **Entrance animations**: Identify fadeIn, slideUp, scaleIn, etc.
- **Scroll-linked**: Determine if animations are tied to scroll progress (scrubbed)
- **Parallax effects**: Detect multi-layer depth with different scroll speeds
- **Pinned sections**: Identify sections that stay fixed while scrolling
- **Hijacked scroll**: Detect fullpage step-by-step presentations
- **Staggered sequences**: Notice cascading entrance patterns

#### Timing & Easing Analysis

- **Duration**: Estimate animation speed (fast: 0.3s, medium: 0.6-0.8s, slow: 1.2s+)
- **Easing function**: Identify easing type
  - Linear (constant speed) → `ease: 'none'`
  - Smooth acceleration → `ease: 'power2.out'`
  - Bounce/elastic → `ease: 'back.out(1.7)'`
  - Custom curve → `ease: 'power3.inOut'`
- **Delay patterns**: Notice sequential delays in lists or grids

#### Trigger Point Analysis

- **Start point**: Where animation begins (viewport position)
  - Early trigger: "top 90%" (element at bottom of viewport)
  - Mid trigger: "top 60%" (element mid-viewport)
  - Late trigger: "top 30%" (element near top)
- **End point**: Where animation completes or reverses
- **Scrub detection**: Does animation move 1:1 with scroll?

#### Scroll Behavior

- **Parallax speed**: Estimate layer speeds (0.3 = very slow, 1.0 = normal, 1.5+ = fast)
- **Pin duration**: How long sections stay fixed
- **Direction**: Left, right, up, down slide directions
- **Fade**: Opacity changes during animation

### 3. Map to Available Directives

Match detected patterns to angular-gsap directives:

| Detected Pattern              | Recommended Directive                   | Configuration                       |
| ----------------------------- | --------------------------------------- | ----------------------------------- |
| Fade on scroll into view      | `viewportAnimation`                     | `animation: 'fadeIn'`               |
| Element slides up on entry    | `viewportAnimation`                     | `animation: 'slideUp'`              |
| Background moves slower       | `scrollAnimation`                       | `animation: 'parallax', speed: 0.5` |
| Section pins while animating  | `scrollAnimation`                       | `pin: true, scrub: true`            |
| Fullpage step presentation    | `hijackedScroll` + `hijackedScrollItem` | With slide directions               |
| List items appear in sequence | `viewportAnimation`                     | `stagger: 0.1`                      |
| Progress bar fills on scroll  | `scrollAnimation`                       | `scrub: true, onUpdate: callback`   |

### 4. Identify Closest Demo Pattern

Reference proven patterns from the demo sections:

- **Hero Entrance Stagger** (Pattern 1) - Sequential badge → title → subtitle → buttons
- **Parallax Background** (Pattern 2) - Layered depth with speed variations
- **Content Fade-Out on Scroll** (Pattern 3) - Hero disappearing as user scrolls
- **Staggered Pills** (Pattern 4) - Cascading list items with delays
- **Metric Card Animation** (Pattern 5) - Stats with bounce easing
- **Fullpage Hijacked Scroll** (Pattern 6) - One viewport per slide
- **Ambient Glow Backgrounds** (Pattern 7) - Atmospheric blur effects
- **Split Panel Alternating** (Pattern 8) - Content/image sides alternating
- **Custom Scroll Animation** (Pattern 9) - Complex multi-property changes
- **Gradient Text Animation** (Pattern 10) - Animated color gradients

See `patterns.md` for complete code examples.

### 5. Generate Reconstruction Code

Provide Angular component code:

```typescript
import { Component, ChangeDetectionStrategy } from '@angular/core';
import { ScrollAnimationDirective, ViewportAnimationDirective } from '@hive-academy/angular-gsap';

@Component({
  selector: 'app-reconstructed-animation',
  standalone: true,
  imports: [ScrollAnimationDirective, ViewportAnimationDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Based on your reference video -->

    <!-- Background parallax layer -->
    <div
      scrollAnimation
      [scrollConfig]="{
        animation: 'parallax',
        speed: 0.4,
        scrub: 1.5,
      }"
    >
      Background
    </div>

    <!-- Entrance animations -->
    <h1
      viewportAnimation
      [viewportConfig]="{
        animation: 'slideUp',
        duration: 0.8,
        threshold: 0.2,
      }"
    >
      Title
    </h1>

    <!-- More elements based on analysis -->
  `,
})
export class ReconstructedAnimationComponent {}
```

### 6. Provide Customization Notes

Document approximations and suggestions:

- **Exact timing unknown**: Estimated 0.8s based on visual speed
- **Easing approximation**: Used `power2.out` for smooth feel
- **Trigger point guess**: Set to "top 80%" for early entrance
- **Alternative approaches**: Consider using `scrollSectionPin` for pinning
- **Performance tip**: Use `once: true` if animation doesn't need to reverse

---
