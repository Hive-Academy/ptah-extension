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

| Context           | Duration | Ease          | Use Case            |
| ----------------- | -------- | ------------- | ------------------- |
| Quick feedback    | 0.3s     | power2.out    | UI interactions     |
| Standard entrance | 0.6-0.8s | power2.out    | Content reveals     |
| Emphasized        | 1.2-1.5s | power3.inOut  | Hero sections       |
| Stats/metrics     | 0.6s     | back.out(1.7) | Bouncy cards        |
| Parallax          | N/A      | none          | Layered backgrounds |

See `best-practices.md` for comprehensive timing guide.

### Step 4: Set Trigger Points

Help choose ScrollTrigger start/end:

```typescript
// Early trigger (element enters from bottom)
start: 'top 90%';

// Mid trigger (element center-ish)
start: 'top 60%';

// Late trigger (element near top)
start: 'top 30%';

// Pin at top of viewport
start: 'top top';
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
import { ScrollAnimationDirective, ViewportAnimationDirective, HijackedScrollDirective, HijackedScrollItemDirective } from '@hive-academy/angular-gsap';

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
    <div
      scrollAnimation
      [scrollConfig]="{
        animation: 'parallax',
        speed: 0.4,
        scrub: 1.5,
      }"
    >
      <!-- Background image -->
    </div>

    <!-- Hero section entrance -->
    <section>
      <h1
        viewportAnimation
        [viewportConfig]="{
          animation: 'slideUp',
          duration: 0.8,
          threshold: 0.2,
        }"
      >
        Hero Title
      </h1>

      <p
        viewportAnimation
        [viewportConfig]="{
          animation: 'fadeIn',
          duration: 0.8,
          delay: 0.2,
          threshold: 0.2,
        }"
      >
        Subtitle
      </p>
    </section>

    <!-- Staggered feature list -->
    <div
      viewportAnimation
      [viewportConfig]="{
        animation: 'slideUp',
        stagger: 0.1,
        staggerTarget: '.feature',
      }"
    >
      <div class="feature">Feature 1</div>
      <div class="feature">Feature 2</div>
      <div class="feature">Feature 3</div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        position: relative;
      }
    `,
  ],
})
export class CustomAnimationComponent {}
```

---
