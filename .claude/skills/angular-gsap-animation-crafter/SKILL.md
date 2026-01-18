---
name: angular-gsap-animation-crafter
description: Interactive scroll animation designer for @hive-academy/angular-gsap library. Guides users through creating smooth, professional scroll-based animations using GSAP and ScrollTrigger. Use when users want to: (1) Create scroll-triggered animations or viewport animations, (2) Design scroll experiences (parallax, pinned sections, hijacked scroll), (3) Get recommendations for animation types and timing, (4) Learn GSAP best practices and easing functions, (5) Generate complete Angular components with scroll animations, (6) Analyze reference videos or images to reverse-engineer scroll animation sequences and recreate similar motion timing with available directives (extracts animation types, easing, trigger points, durations).
---

# Angular GSAP Animation Crafter

Welcome! I'm here to help you design stunning scroll-based animations using the `@hive-academy/angular-gsap` library.

## How I Can Help

I guide you through two workflows:

- **Workflow A: Image/Video-Based Reverse Engineering** - Provide a reference video or image, and I'll analyze the motion, timing, and effects to recreate similar scroll animations
- **Workflow B: Text-Based Design** - Describe what you want, and I'll recommend animation types, timing, and configurations

---

## Workflow A: Image/Video-Based Reverse Engineering

**Use when:** You have a reference video, GIF, or image showing scroll animations you want to recreate.

### 1. Request Image/Video

Prompt you to share:
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

| Detected Pattern | Recommended Directive | Configuration |
|-----------------|----------------------|---------------|
| Fade on scroll into view | `viewportAnimation` | `animation: 'fadeIn'` |
| Element slides up on entry | `viewportAnimation` | `animation: 'slideUp'` |
| Background moves slower | `scrollAnimation` | `animation: 'parallax', speed: 0.5` |
| Section pins while animating | `scrollAnimation` | `pin: true, scrub: true` |
| Fullpage step presentation | `hijackedScroll` + `hijackedScrollItem` | With slide directions |
| List items appear in sequence | `viewportAnimation` | `stagger: 0.1` |
| Progress bar fills on scroll | `scrollAnimation` | `scrub: true, onUpdate: callback` |

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

See `references/patterns.md` for complete code examples.

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
    <div scrollAnimation
      [scrollConfig]="{
        animation: 'parallax',
        speed: 0.4,
        scrub: 1.5
      }">
      Background
    </div>

    <!-- Entrance animations -->
    <h1 viewportAnimation
      [viewportConfig]="{
        animation: 'slideUp',
        duration: 0.8,
        threshold: 0.2
      }">
      Title
    </h1>

    <!-- More elements based on analysis -->
  `
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

## Workflow B: Text-Based Conversational Design

**Use when:** User describes desired scroll animations without visual reference.

### Step 1: Understand Intent

Ask clarifying questions:

**For Animation Goal**:
- "What should happen as the user scrolls?"
  - Fade in elements?
  - Slide content from sides?
  - Pin sections in place?
  - Create parallax depth?
  - Hijack scroll for presentation?

**For Trigger Behavior**:
- "Should animation be tied to scroll progress or trigger once on entry?"
  - Scrubbed (1:1 with scroll) → Use `scrollAnimation` with `scrub: true`
  - One-time entrance → Use `viewportAnimation`

**For Aesthetic**:
- "What's the desired feel?"
  - Smooth and professional → `ease: 'power2.out'`
  - Bouncy and playful → `ease: 'back.out(1.7)'`
  - Dramatic and slow → `duration: 1.5, ease: 'power3.inOut'`

### Step 2: Recommend Animation Type

Based on intent, suggest directive and animation type:

#### For Viewport Entrance (One-Time)

```typescript
viewportAnimation with:
- 'fadeIn' - Simple opacity fade
- 'slideUp' - Upward slide with fade
- 'scaleIn' - Scale from small with fade
- 'rotateIn' - Rotation with opacity
- 'bounceIn' - Elastic bounce entrance
```

#### For Scroll-Linked Progress

```typescript
scrollAnimation with:
- 'parallax' - Background depth effect
- 'fadeIn'/'fadeOut' - Opacity tied to scroll
- 'custom' - Multi-property animation
- pin: true - Keep element fixed while scrolling
```

#### For Fullpage Presentations

```typescript
hijackedScroll + hijackedScrollItem with:
- slideDirection: 'left'|'right'|'up'|'down'
- Step-based navigation
- Progress indicators
```

### Step 3: Configure Timing

Recommend duration and easing:

| Context | Duration | Ease | Use Case |
|---------|----------|------|----------|
| Quick feedback | 0.3s | power2.out | UI interactions |
| Standard entrance | 0.6-0.8s | power2.out | Content reveals |
| Emphasized | 1.2-1.5s | power3.inOut | Hero sections |
| Stats/metrics | 0.6s | back.out(1.7) | Bouncy cards |
| Parallax | N/A | none | Layered backgrounds |

See `references/best-practices.md` for comprehensive timing guide.

### Step 4: Set Trigger Points

Help choose ScrollTrigger start/end:

```typescript
// Early trigger (element enters from bottom)
start: 'top 90%'

// Mid trigger (element center-ish)
start: 'top 60%'

// Late trigger (element near top)
start: 'top 30%'

// Pin at top of viewport
start: 'top top'
```

### Step 5: Build Incrementally

Guide through scene construction:

**Phase 1: Basic Animation**
```typescript
<div viewportAnimation
  [viewportConfig]="{
    animation: 'slideUp'
  }">
  Content
</div>
```

**Phase 2: Customize Timing**
```typescript
<div viewportAnimation
  [viewportConfig]="{
    animation: 'slideUp',
    duration: 0.8,
    ease: 'power2.out'
  }">
  Content
</div>
```

**Phase 3: Add Stagger (if needed)**
```typescript
<div viewportAnimation
  [viewportConfig]="{
    animation: 'slideUp',
    duration: 0.8,
    stagger: 0.1,
    staggerTarget: '.item'
  }">
  <div class="item">Item 1</div>
  <div class="item">Item 2</div>
  <div class="item">Item 3</div>
</div>
```

**Phase 4: Combine with Scroll Directive**
```typescript
<!-- Background parallax -->
<div scrollAnimation
  [scrollConfig]="{
    animation: 'parallax',
    speed: 0.5,
    scrub: 1.5
  }">
  Background
</div>

<!-- Foreground content -->
<div viewportAnimation
  [viewportConfig]="{
    animation: 'slideUp',
    duration: 0.8
  }">
  Foreground content
</div>
```

### Step 6: Generate Complete Component

Provide production-ready Angular component:

```typescript
import { Component, ChangeDetectionStrategy } from '@angular/core';
import {
  ScrollAnimationDirective,
  ViewportAnimationDirective,
  HijackedScrollDirective,
  HijackedScrollItemDirective,
} from '@hive-academy/angular-gsap';

@Component({
  selector: 'app-custom-animation',
  standalone: true,
  imports: [
    ScrollAnimationDirective,
    ViewportAnimationDirective,
    // Import others as needed
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Parallax background -->
    <div scrollAnimation
      [scrollConfig]="{
        animation: 'parallax',
        speed: 0.4,
        scrub: 1.5
      }">
      <!-- Background image -->
    </div>

    <!-- Hero section entrance -->
    <section>
      <h1 viewportAnimation
        [viewportConfig]="{
          animation: 'slideUp',
          duration: 0.8,
          threshold: 0.2
        }">
        Hero Title
      </h1>

      <p viewportAnimation
        [viewportConfig]="{
          animation: 'fadeIn',
          duration: 0.8,
          delay: 0.2,
          threshold: 0.2
        }">
        Subtitle
      </p>
    </section>

    <!-- Staggered feature list -->
    <div viewportAnimation
      [viewportConfig]="{
        animation: 'slideUp',
        stagger: 0.1,
        staggerTarget: '.feature'
      }">
      <div class="feature">Feature 1</div>
      <div class="feature">Feature 2</div>
      <div class="feature">Feature 3</div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      position: relative;
    }
  `]
})
export class CustomAnimationComponent {}
```

---

## Example Interaction (Workflow B)

**User**: "I want a hero section where the title slides up and a background image moves slower than the scroll."

**Me**: Perfect! That's a classic parallax effect with a viewport entrance. Let me build this step by step:

**Step 1: Background Parallax**
```html
<div scrollAnimation
  [scrollConfig]="{
    animation: 'parallax',
    speed: 0.5,
    scrub: 1.5
  }">
  <img src="background.jpg" />
</div>
```
This makes the background move at 50% scroll speed with a 1.5s smooth lag.

**Step 2: Title Slide Up**
```html
<h1 viewportAnimation
  [viewportConfig]="{
    animation: 'slideUp',
    duration: 0.8,
    threshold: 0.2
  }">
  Hero Title
</h1>
```
Title appears when 20% visible, slides up over 0.8s.

**User**: "Can I make the title fade out as I scroll down?"

**Me**: Yes! Add a ScrollAnimation directive to the title:

```html
<h1
  viewportAnimation
  [viewportConfig]="{
    animation: 'slideUp',
    duration: 0.8,
    threshold: 0.2
  }"
  scrollAnimation
  [scrollConfig]="{
    animation: 'custom',
    start: 'top 20%',
    end: 'bottom 60%',
    scrub: 1.2,
    from: { opacity: 1, y: 0 },
    to: { opacity: 0, y: -150 }
  }">
  Hero Title
</h1>
```

This combines entrance (viewport) with scroll-linked fade out.

---

## Reference Files

For detailed information, see:

- **`references/components.md`** - Complete catalog of all directives, components, services, and configurations
- **`references/patterns.md`** - 10 reusable animation patterns from demo sections with full code examples
- **`references/best-practices.md`** - Timing strategies, easing functions, trigger point guides, performance tips
- **`assets/animation-template.component.ts`** - Boilerplate Angular component template to start from

---

## Key Principles

1. **SSR Compatibility** - All directives work with server-side rendering
2. **Performance First** - Use `once: true` for non-reversible animations, optimize stagger counts
3. **Accessibility** - Support `prefers-reduced-motion` by reducing durations
4. **Progressive Enhancement** - Start simple, add complexity as needed
5. **Composition** - Combine multiple directives for rich effects

---

## Quick Start Template

Use `assets/animation-template.component.ts` as a starting point. It includes:
- Parallax background setup
- Hero entrance stagger pattern
- Staggered list items
- Scroll-linked content fade
- All necessary imports and configuration

---

Let's create amazing scroll experiences together!
