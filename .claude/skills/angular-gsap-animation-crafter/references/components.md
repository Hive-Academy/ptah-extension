# Component Catalog

Complete reference for @hive-academy/angular-gsap directives, components, and services.

## Table of Contents

1. [Directives](#directives)
   - [ScrollAnimationDirective](#scrollanimationdirective)
   - [HijackedScrollDirective](#hijackedscrolldirective)
   - [HijackedScrollItemDirective](#hijackedscrollitemdirective)
   - [ScrollSectionPinDirective](#scrollsectionpindirective)
   - [ViewportAnimationDirective](#viewportanimationdirective)
   - [SectionStickyDirective](#sectionstickydirective)
   - [LenisSmoothScrollDirective](#lenissmoothscrolldirective)
   - [ParallaxSplitItemDirective](#parallaxsplititemdirective)
2. [Components](#components)
   - [HijackedScrollTimelineComponent](#hijackedscrolltimelinecomponent)
   - [ParallaxSplitScrollComponent](#parallaxsplitscrollcomponent)
3. [Services](#services)
   - [GsapCoreService](#gsapcoreservice)
   - [LenisSmoothScrollService](#lenissmoothscrollservice)
4. [Common Patterns](#common-patterns)
5. [Configuration Reference](#configuration-reference)
6. [Setup & Initialization](#setup--initialization)

---

## Directives

### ScrollAnimationDirective

**Purpose**: Declarative GSAP ScrollTrigger animations for any DOM element.

**Selector**: `[scrollAnimation]`

**Public API Methods**:
```typescript
refresh() // Manually refresh ScrollTrigger calculations
getProgress() // Get current scroll progress (0-1)
setEnabled(enabled: boolean) // Enable/disable the animation
```

**Configuration**: `[scrollConfig]="config"`

```typescript
interface ScrollAnimationConfig {
  // Animation type
  animation?: AnimationType;

  // ScrollTrigger settings
  trigger?: string;          // CSS selector or 'self'
  start?: string;            // e.g., 'top 80%'
  end?: string;
  scrub?: boolean | number;  // Link to scroll progress
  pin?: boolean;             // Pin during scroll
  pinSpacing?: boolean;
  markers?: boolean;         // Debug markers

  // Animation properties
  duration?: number;         // Seconds
  delay?: number;
  ease?: string;             // GSAP easing
  stagger?: number;

  // Parallax
  speed?: number;
  yPercent?: number;
  xPercent?: number;

  // Custom animation
  from?: gsap.TweenVars;
  to?: gsap.TweenVars;

  // Callbacks
  onEnter?: () => void;
  onLeave?: () => void;
  onUpdate?: (progress: number) => void;

  // Performance
  once?: boolean;
  toggleActions?: string;
}
```

**Animation Types**:
```typescript
type AnimationType =
  | 'fadeIn'      // Opacity: 0 → 1
  | 'fadeOut'     // Opacity: 1 → 0
  | 'slideUp'     // y: 100px → 0, opacity: 0 → 1
  | 'slideDown'   // y: -100px → 0, opacity: 0 → 1
  | 'slideLeft'   // x: 100px → 0, opacity: 0 → 1
  | 'slideRight'  // x: -100px → 0, opacity: 0 → 1
  | 'scaleIn'     // scale: 0.8 → 1, opacity: 0 → 1
  | 'scaleOut'    // scale: 1.2 → 1, opacity: 0 → 1
  | 'parallax'    // Parallax with speed
  | 'custom';     // Custom from/to
```

**Examples**:

```html
<!-- Simple fade-in -->
<h1 scrollAnimation>Title</h1>

<!-- Slide up -->
<div
  scrollAnimation
  [scrollConfig]="{
    animation: 'slideUp',
    start: 'top 80%',
    duration: 1.2,
    ease: 'power3.out'
  }">
  Content
</div>

<!-- Parallax -->
<div
  scrollAnimation
  [scrollConfig]="{
    animation: 'parallax',
    speed: 0.5,
    scrub: true
  }">
  Background
</div>

<!-- Pinned section -->
<section
  scrollAnimation
  [scrollConfig]="{
    animation: 'slideUp',
    pin: true,
    pinSpacing: true,
    start: 'top top',
    end: '+=100%',
    scrub: 1
  }">
  Pinned content
</section>

<!-- Custom -->
<div
  scrollAnimation
  [scrollConfig]="{
    animation: 'custom',
    from: { opacity: 0, rotation: -10, scale: 0.9 },
    to: { opacity: 1, rotation: 0, scale: 1 }
  }">
  Custom element
</div>

<!-- Staggered children -->
<div
  scrollAnimation
  [scrollConfig]="{
    animation: 'slideUp',
    stagger: 0.1
  }">
  <p>Item 1</p>
  <p>Item 2</p>
  <p>Item 3</p>
</div>
```

---

### HijackedScrollDirective

**Purpose**: Full-page scroll hijacking for step-by-step presentations.

**Selector**: `[hijackedScroll]`

**Public Methods**:
```typescript
refresh()
getProgress() // Overall progress (0-1)
jumpToStep(stepIndex: number)
```

**Inputs**:
```typescript
scrollHeightPerStep: number = 100      // vh per step
animationDuration: number = 0.3        // seconds
ease: string = 'power2.out'
markers: boolean = false
minHeight: string = '100vh'
start: string = 'top top'
end: string | undefined
scrub: number = 1
stepHold: number = 0                   // Hold multiplier
showFirstStepImmediately: boolean = true
```

**Outputs**:
```typescript
currentStepChange // Emits step index (0-based)
progressChange    // Emits progress (0-1)
```

**Example**:

```html
<div
  hijackedScroll
  [scrollHeightPerStep]="100"
  [animationDuration]="0.3"
  [stepHold]="0.5"
  (currentStepChange)="onStepChange($event)">

  <div hijackedScrollItem slideDirection="left">
    Step 1
  </div>

  <div hijackedScrollItem slideDirection="right">
    Step 2
  </div>
</div>
```

---

### HijackedScrollItemDirective

**Purpose**: Individual step within hijacked scroll container.

**Selector**: `[hijackedScrollItem]`

**Inputs**:
```typescript
slideDirection: SlideDirection = 'none' // left|right|up|down|none
fadeIn: boolean = true
scale: boolean = true
customFrom: Record<string, unknown>
customTo: Record<string, unknown>
```

**Slide Direction Offsets** (60px):
- `'left'` → `{ x: -60, y: 0 }`
- `'right'` → `{ x: 60, y: 0 }`
- `'up'` → `{ x: 0, y: -60 }`
- `'down'` → `{ x: 0, y: 60 }`
- `'none'` → `{ x: 0, y: 0 }`

**Example**:

```html
<div hijackedScrollItem
     [slideDirection]="'left'"
     [fadeIn]="true"
     [scale]="true">
  <h2>Step Title</h2>
</div>
```

---

### ScrollSectionPinDirective

**Purpose**: Pin section during scroll (lighter alternative).

**Selector**: `[scrollSectionPin]`

**Inputs**:
```typescript
pinDuration: string = '300px'          // '300px', '50vh'
start: string = 'top top'
end: string | undefined                // Auto-calculated
anticipatePin: number = 1
pinSpacing: boolean = true
scrub: boolean | number = true
markers: boolean = false
```

**Outputs**:
```typescript
pinProgress // Progress (0-1)
pinned      // true/false
pinComplete // Completion event
```

**Example**:

```html
<section
  scrollSectionPin
  [pinDuration]="'300px'"
  [start]="'top center'"
  (pinProgress)="onProgress($event)">
  Content
</section>
```

---

### ViewportAnimationDirective

**Purpose**: Trigger GSAP animations on viewport entry (IntersectionObserver).

**Selector**: `[viewportAnimation]`

**Public Methods**:
```typescript
replay() // Replay animation
reset()  // Reset to initial state
```

**Configuration**: `[viewportConfig]="config"`

```typescript
interface ViewportAnimationConfig {
  animation?: ViewportAnimationType;
  duration?: number;           // Default: 0.6
  delay?: number;
  ease?: string;               // Default: 'power2.out'
  threshold?: number;          // 0-1, default: 0.1
  rootMargin?: string;         // Default: '0px'
  once?: boolean;              // Default: true
  stagger?: number;
  staggerTarget?: string;
  from?: gsap.TweenVars;
  to?: gsap.TweenVars;
  distance?: number;           // For slide animations (default: 50)
  scale?: number;              // For scale animations (default: 0.9)
  rotation?: number;           // For rotate animations (default: 15)
}
```

**Animation Types**:
```typescript
type ViewportAnimationType =
  | 'fadeIn'
  | 'fadeOut'
  | 'slideUp'
  | 'slideDown'
  | 'slideLeft'
  | 'slideRight'
  | 'scaleIn'
  | 'scaleOut'
  | 'rotateIn'
  | 'flipIn'
  | 'bounceIn'
  | 'custom';
```

**Outputs**:
```typescript
viewportEnter
viewportLeave
animationComplete
```

**Examples**:

```html
<!-- Simple fade -->
<h1 viewportAnimation>Title</h1>

<!-- Slide up -->
<div
  viewportAnimation
  [viewportConfig]="{
    animation: 'slideUp',
    duration: 0.8,
    threshold: 0.2
  }">
  Content
</div>

<!-- Staggered -->
<ul
  viewportAnimation
  [viewportConfig]="{
    animation: 'slideUp',
    stagger: 0.1,
    staggerTarget: 'li'
  }">
  <li>Item 1</li>
  <li>Item 2</li>
</ul>
```

---

### SectionStickyDirective

**Purpose**: Make child elements sticky only when parent section is in viewport.

**Selector**: `[sectionSticky]`

**Inputs**:
```typescript
stickyThreshold: number = 0.0
stickyRootMargin: string = '0px'
stickyDebounce: number = 50
stickyDebug: boolean = false
```

**Outputs**:
```typescript
inViewChange // true/false when section enters/leaves
```

**CSS Integration**:

```css
.section-sticky-target {
  position: absolute;
  opacity: 0;
}

[data-section-in-view="true"] .section-sticky-target {
  position: fixed;
  opacity: 1;
  top: 0;
  left: 0;
}
```

**Example**:

```html
<section
  sectionSticky
  [stickyThreshold]="0.2">

  <nav class="section-sticky-target">
    Sticky nav
  </nav>
</section>
```

---

### LenisSmoothScrollDirective

**Purpose**: Declarative Lenis smooth scroll initialization.

**Selector**: `[lenisSmoothScroll]`

**Input**: `[lenisConfig]="config"`

**Outputs**:
```typescript
lenisScroll // Scroll event data
```

**Example**:

```html
<main
  lenisSmoothScroll
  [lenisConfig]="{ lerp: 0.08 }"
  (lenisScroll)="onScroll($event)">
  Content
</main>
```

---

### ParallaxSplitItemDirective

**Purpose**: Step in parallax split-screen layout.

**Selector**: `[parallaxSplitItem]`

**Inputs**:
```typescript
imageSrc: string // Required
imageAlt: string = ''
layout: SplitLayout = 'left' // left|right
```

**Example**:

```html
<div parallaxSplitItem
     [imageSrc]="'/assets/step1.jpg'"
     [layout]="'left'">
  <h3>Title</h3>
</div>
```

---

## Components

### HijackedScrollTimelineComponent

**Purpose**: Wrapper around HijackedScrollDirective with content projection.

**Selector**: `agsp-hijacked-scroll-timeline`

**Inputs**: Same as HijackedScrollDirective

**Example**:

```html
<agsp-hijacked-scroll-timeline
  [scrollHeightPerStep]="100"
  (currentStepChange)="onStepChange($event)">

  <div hijackedScrollItem slideDirection="left">
    Step 1
  </div>

  <div hijackedScrollItem slideDirection="right">
    Step 2
  </div>
</agsp-hijacked-scroll-timeline>
```

---

### ParallaxSplitScrollComponent

**Purpose**: Split-screen layout with parallax.

**Selector**: `agsp-parallax-split-scroll`

**Example**:

```html
<agsp-parallax-split-scroll>
  <div parallaxSplitItem
       [imageSrc]="imagePath1"
       [layout]="'left'">
    Content
  </div>
</agsp-parallax-split-scroll>
```

---

## Services

### GsapCoreService

**Purpose**: Centralized GSAP access with SSR safety.

**Properties**:
```typescript
gsap: typeof gsap | null
scrollTrigger: typeof ScrollTrigger | null
isBrowser: boolean
isInitialized: Signal<boolean>
```

**Methods**:
```typescript
createContext(func, scope?)
```

**Setup**:

```typescript
// app.config.ts
import { provideGsap } from '@hive-academy/angular-gsap';

export const appConfig: ApplicationConfig = {
  providers: [
    provideGsap({
      defaults: { ease: 'power2.out', duration: 1 },
    }),
  ],
};
```

---

### LenisSmoothScrollService

**Purpose**: Centralized Lenis smooth scroll management.

**Signals**:
```typescript
isInitialized: Signal<boolean>
scroll: Signal<number>
progress: Signal<number>
velocity: Signal<number>
direction: Signal<number>
isScrolling: Signal<boolean | 'native' | 'smooth'>
```

**Computed**:
```typescript
isAtTop: Signal<boolean>
isAtBottom: Signal<boolean>
```

**Methods**:
```typescript
initialize(options)
scrollTo(target, options?)
stop()
start()
resize()
destroy()
```

**Property**:
```typescript
lenis: Lenis | null
```

**Setup**:

```typescript
// app.config.ts
import { provideLenis } from '@hive-academy/angular-gsap';

export const appConfig: ApplicationConfig = {
  providers: [
    provideLenis({
      lerp: 0.08,
      wheelMultiplier: 0.7,
    }),
  ],
};
```

**Usage**:

```typescript
export class AppComponent {
  private lenis = inject(LenisSmoothScrollService);

  constructor() {
    afterNextRender(() => {
      this.lenis.initialize();
    });
  }

  scrollToTop() {
    this.lenis.scrollTo(0, { duration: 1.5 });
  }
}
```

---

## Common Patterns

### Staggered Children

```html
<div
  scrollAnimation
  [scrollConfig]="{
    animation: 'slideUp',
    stagger: 0.1
  }">
  <p>Item 1</p>
  <p>Item 2</p>
  <p>Item 3</p>
</div>
```

### Progress-Based Updates

```typescript
config: ScrollAnimationConfig = {
  scrub: true,
  onUpdate: (progress) => {
    this.progressSignal.set(progress * 100);
  }
};
```

### Parallax Layers

```html
<div scrollAnimation
  [scrollConfig]="{ animation: 'parallax', speed: 0.3 }">
  Background
</div>

<div scrollAnimation
  [scrollConfig]="{ animation: 'parallax', speed: 0.6 }">
  Midground
</div>
```

---

## Configuration Reference

### Trigger Points

```typescript
start: 'top 80%'       // Top of element at 80% down viewport
start: 'center center' // Center aligned
start: 'bottom top'    // Bottom at viewport top
start: '+=100px'       // 100px offset
```

### Easing Functions

```typescript
ease: 'power1.out'     // Smooth
ease: 'power2.out'     // Common choice
ease: 'power3.inOut'   // Dramatic
ease: 'back.out'       // Bounce
ease: 'elastic.out'    // Spring
ease: 'none'           // Linear (parallax)
```

### Duration & Delay

```typescript
duration: 0.3, delay: 0      // Quick
duration: 0.8, delay: 0      // Standard
duration: 1.5, delay: 0.2    // Emphasized
```

### Parallax Speed

```typescript
speed: 0.3  // Very slow
speed: 0.5  // Half speed
speed: 1    // Normal
speed: 1.5  // Faster
```

---

## Setup & Initialization

### App Configuration

```typescript
// app.config.ts
import { ApplicationConfig } from '@angular/core';
import { provideGsap, provideLenis } from '@hive-academy/angular-gsap';

export const appConfig: ApplicationConfig = {
  providers: [
    provideGsap({
      defaults: {
        ease: 'power2.out',
        duration: 1,
      },
    }),
    provideLenis({
      lerp: 0.08,
      wheelMultiplier: 0.7,
    }),
  ],
};
```

### Root Component

```typescript
import { Component, afterNextRender, inject } from '@angular/core';
import { LenisSmoothScrollService } from '@hive-academy/angular-gsap';

@Component({
  selector: 'app-root',
  standalone: true,
  template: '<router-outlet />',
})
export class AppComponent {
  private lenis = inject(LenisSmoothScrollService);

  constructor() {
    afterNextRender(() => {
      if (!this.lenis.isInitialized()) {
        this.lenis.initialize();
      }
    });
  }
}
```

---

## TypeScript Imports

```typescript
// Directives
import {
  ScrollAnimationDirective,
  ScrollAnimationConfig,
  AnimationType,
  HijackedScrollDirective,
  HijackedScrollItemDirective,
  ScrollSectionPinDirective,
  ViewportAnimationDirective,
  ViewportAnimationConfig,
  ViewportAnimationType,
  SectionStickyDirective,
  ParallaxSplitItemDirective,
  LenisSmoothScrollDirective,
} from '@hive-academy/angular-gsap';

// Components
import {
  HijackedScrollTimelineComponent,
  ParallaxSplitScrollComponent,
} from '@hive-academy/angular-gsap';

// Services
import {
  GsapCoreService,
  LenisSmoothScrollService,
} from '@hive-academy/angular-gsap';

// Providers
import {
  provideGsap,
  provideLenis,
} from '@hive-academy/angular-gsap';
```

---

## SSR Compatibility

All directives/services are SSR-compatible:

```typescript
constructor() {
  afterNextRender(() => {
    if (isPlatformBrowser(this.platformId)) {
      this.initializeAnimation();
    }
  });
}
```

---

## Performance Optimization

```typescript
// Good: Limited duration
{ duration: 0.6, ease: 'power2.out' }

// Avoid: Too long
{ duration: 3, onUpdate: expensiveCallback }

// Reduce motion support
prefersReducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
config = { duration: this.prefersReducedMotion ? 0.1 : 0.8 };
```
