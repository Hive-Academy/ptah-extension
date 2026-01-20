# Best Practices Guide

Comprehensive guide for creating professional scroll animations with @hive-academy/angular-gsap.

## Table of Contents

1. [Timing & Duration Strategy](#timing--duration-strategy)
2. [Easing Function Guide](#easing-function-guide)
3. [ScrollTrigger Configuration](#scrolltrigger-configuration)
4. [Trigger Point Strategies](#trigger-point-strategies)
5. [Performance Optimization](#performance-optimization)
6. [Accessibility Considerations](#accessibility-considerations)
7. [SSR Compatibility](#ssr-compatibility)
8. [Animation Composition](#animation-composition)
9. [Common Mistakes to Avoid](#common-mistakes-to-avoid)
10. [Testing & Debugging](#testing--debugging)

---

## Timing & Duration Strategy

### Duration Guidelines by Context

| Context | Duration | Delay | Use Case |
|---------|----------|-------|----------|
| **Hero badges** | 0.6s | 0.1s | Quick attention grab |
| **Headlines** | 0.8s | 0.1-0.2s | Comfortable entrance |
| **Subtitles** | 0.8s | 0.2-0.4s | Sequential reveal |
| **Buttons/CTAs** | 0.6s | 0.5-0.7s | Final call-to-action |
| **List items** | 0.5s | stagger 0.1s | Rapid sequential |
| **Metric cards** | 0.6s | stagger 0.1s | Bouncy emphasis |
| **Parallax** | N/A | N/A | Tied to scroll |
| **Scroll transitions** | 0.8-1.2s | N/A | Smooth section changes |

### Timing Patterns

**Quick Feedback** (UI Interactions):
```typescript
{
  duration: 0.3,
  delay: 0,
  ease: 'power2.out'
}
```

**Standard Entrance** (Content Reveals):
```typescript
{
  duration: 0.6-0.8,
  delay: 0,
  ease: 'power2.out'
}
```

**Emphasized** (Hero Sections):
```typescript
{
  duration: 1.2-1.5,
  delay: 0.2,
  ease: 'power3.inOut'
}
```

**Staggered Sequence**:
```typescript
{
  duration: 0.6,
  stagger: 0.08-0.15,  // 80-150ms between items
  ease: 'power2.out'
}
```

### Delay Patterns

**Sequential Cascade**:
```typescript
// Badge: delay 0.1s
// Title: delay 0.2s
// Subtitle: delay 0.4s
// CTA: delay 0.6s
```

**Stagger Formula**:
```typescript
delay: index * 0.1  // 100ms between each item
```

**Grouped Delays**:
```typescript
// Group 1 (header): delay 0-0.2s
// Group 2 (content): delay 0.4-0.6s
// Group 3 (footer): delay 0.8-1.0s
```

---

## Easing Function Guide

### GSAP Easing Functions

**Linear Easing** (constant speed):
```typescript
ease: 'none'  // NO easing, constant speed
// Use for: Parallax, progress bars
```

**Power Easing** (acceleration curves):
```typescript
ease: 'power1.in'    // Slow start, fast end
ease: 'power1.out'   // Fast start, slow end (smooth)
ease: 'power1.inOut' // Acceleration both ends

ease: 'power2.out'   // RECOMMENDED for most UI
ease: 'power3.out'   // Snappy, fast reveals
ease: 'power3.inOut' // Dramatic scroll transitions
ease: 'power4.out'   // Very aggressive
```

**Back Easing** (elastic bounce):
```typescript
ease: 'back.out(1.7)'  // RECOMMENDED for metric cards
ease: 'back.in'        // Bounces inward
ease: 'back.inOut'     // Bounces both ways
```

**Elastic Easing** (spring effect):
```typescript
ease: 'elastic.out'    // Spring bounce
ease: 'elastic.in'
ease: 'elastic.inOut'
```

**Bounce Easing** (bouncy landing):
```typescript
ease: 'bounce.out'     // Bounces on landing
ease: 'bounce.in'
ease: 'bounce.inOut'
```

**Circular Easing** (smooth curve):
```typescript
ease: 'circ.out'       // Circular curve
ease: 'circ.inOut'
```

**Sine Easing** (gentle wave):
```typescript
ease: 'sine.inOut'     // Smooth sine curve
ease: 'sine.out'
```

### Easing Recommendations

| Animation Type | Recommended Easing | Reason |
|----------------|-------------------|--------|
| General UI | `power2.out` | Universal smooth feel |
| Hero sections | `power3.inOut` | Dramatic emphasis |
| Metric cards | `back.out(1.7)` | Bouncy attention |
| Fast reveals | `power3.out` | Snappy entrance |
| Smooth scrolling | `power3.inOut` | Acceleration + deceleration |
| Parallax | `none` | Must be linear |
| Buttons | `power2.out` | Professional feel |
| Lists | `power2.out` | Consistent flow |

### Choosing Easing

**Decision Tree**:
1. Is it parallax? → Use `ease: 'none'`
2. Is it a metric/stat? → Use `ease: 'back.out(1.7)'`
3. Is it a scroll transition? → Use `ease: 'power3.inOut'`
4. Is it fast UI feedback? → Use `ease: 'power3.out'`
5. Everything else → Use `ease: 'power2.out'`

---

## ScrollTrigger Configuration

### Basic Settings

**Trigger Element**:
```typescript
trigger: 'self'           // Use the element itself (default)
trigger: '.other-element' // Use different trigger
trigger: '#section-1'     // By ID
```

**Start/End Points**:
```typescript
start: 'top 80%'      // Element top at 80% down viewport
start: 'center center' // Centers aligned
start: 'bottom top'    // Element bottom at viewport top
start: 'top top'       // Element top at viewport top (for pinning)

end: 'bottom top'      // Element bottom leaves viewport
end: '+=500px'         // 500px after start
end: 'bottom 20%'      // Element bottom at 20% down viewport
```

**Scrub Settings**:
```typescript
scrub: false           // Independent animation (default)
scrub: true            // Link directly to scroll (immediate)
scrub: 0.5             // 0.5s smooth lag behind scroll
scrub: 1.5             // 1.5s smooth lag (very smooth)
```

**Pin Settings**:
```typescript
pin: false             // Don't pin (default)
pin: true              // Pin element during animation
pin: '.target'         // Pin different element
pinSpacing: true       // Add spacing (default)
pinSpacing: false      // No spacing (overlay effect)
```

**Toggle Actions**:
```typescript
toggleActions: 'play none none none'        // Play on enter only (default)
toggleActions: 'play pause resume reset'    // Full control
toggleActions: 'play pause reverse reverse' // Reverse on leave
```

### Advanced Settings

**Anticipate Pin**:
```typescript
anticipatePin: 1       // Start pin 1px before trigger
```

**Markers** (debugging):
```typescript
markers: true          // Show debug markers
markers: false         // Hide markers (production)
```

**Once** (performance):
```typescript
once: false            // Reversible (can leave/re-enter)
once: true             // Run once only (better performance)
```

---

## Trigger Point Strategies

### Start Point Selection

**Early Trigger** (element enters from bottom):
```typescript
start: 'top 90%'       // Triggers when element is 90% down viewport
// Use for: Content that should start animating before fully visible
```

**Mid Trigger** (element center-ish):
```typescript
start: 'top 60%'       // Triggers when element is 60% down viewport
// Use for: Standard content reveals
```

**Late Trigger** (element near top):
```typescript
start: 'top 30%'       // Triggers when element is 30% down viewport
// Use for: Content that should be mostly visible before animating
```

**Pin at Top**:
```typescript
start: 'top top'       // Triggers when element top reaches viewport top
// Use for: Pinned sections
```

### End Point Selection

**Quick Animation**:
```typescript
end: 'top 50%'         // Ends quickly after start
// Use for: Fast reveals
```

**Extended Animation**:
```typescript
end: 'bottom top'      // Ends when element fully leaves viewport
// Use for: Parallax, long scroll-linked animations
```

**Fixed Duration**:
```typescript
end: '+=500px'         // Ends 500px after start
// Use for: Pinned sections with specific scroll distance
```

### Common Trigger Point Combinations

| Use Case | Start | End | Scrub |
|----------|-------|-----|-------|
| **Hero fade out** | `'top 20%'` | `'bottom 60%'` | `1.2` |
| **Content reveal** | `'top 80%'` | `'top 40%'` | `false` |
| **Decorative parallax** | `'top 90%'` | `'bottom 30%'` | `1.5` |
| **Metric animations** | `'top 80%'` | `'top 50%'` | `false` |
| **Pin section** | `'top top'` | `'+=100%'` | `1` |
| **Footer reveal** | `'bottom 20%'` | `'bottom 0%'` | `false` |

---

## Performance Optimization

### General Best Practices

**Limit Animation Count**:
```typescript
// Good: Max 3-5 simultaneous viewport animations
// Bad: 20+ animations on a single scroll

// Solution: Use stagger on parent instead of individual animations
<div viewportAnimation [viewportConfig]="{ stagger: 0.1 }">
  <div>Item 1</div> <!-- No individual animation -->
  <div>Item 2</div>
  <div>Item 3</div>
</div>
```

**Use `once: true` for Non-Reversible Animations**:
```typescript
// Good: One-time entrance
{
  once: true,
  animation: 'slideUp'
}

// Avoid: Unnecessary reversible animation
{
  once: false,  // Animation repeats on scroll up/down
  animation: 'slideUp'
}
```

**Optimize Parallax Speed**:
```typescript
// Good: Speed < 0.5 (background) or > 1.5 (foreground)
speed: 0.3  // Very slow background
speed: 0.5  // Standard background
speed: 1.5  // Fast foreground

// Avoid: Speed close to 1.0 (barely noticeable)
speed: 0.9  // Too close to normal scroll
```

**Scrub Values**:
```typescript
// Good: 1.0-1.5 for smooth feel
scrub: 1.0   // Balanced
scrub: 1.5   // Very smooth

// Avoid: Too high (laggy feel)
scrub: 5.0   // Way too smooth/laggy
```

**Stagger Optimization**:
```typescript
// Good: 80-150ms between items
stagger: 0.08   // Fast stagger
stagger: 0.15   // Slow stagger

// Avoid: Too many items with stagger
// Max ~10 items for good UX
```

### SSR Safety

**Browser-Only Initialization**:
```typescript
import { afterNextRender, isPlatformBrowser, PLATFORM_ID, inject } from '@angular/core';

export class MyComponent {
  private platformId = inject(PLATFORM_ID);

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      afterNextRender(() => {
        this.initializeAnimations();
      });
    }
  }

  private initializeAnimations() {
    // GSAP/ScrollTrigger code here
  }
}
```

**Service Pattern**:
```typescript
import { GsapCoreService } from '@hive-academy/angular-gsap';

export class MyComponent {
  private gsap = inject(GsapCoreService);

  animate() {
    if (this.gsap.gsap) {  // null in SSR
      this.gsap.gsap.to('.element', { x: 100 });
    }
  }
}
```

### Cleanup

**Automatic Cleanup** (Directives handle this):
```typescript
// Directives automatically clean up ScrollTrigger instances
// No manual cleanup needed
```

**Manual Cleanup** (if using GSAP directly):
```typescript
export class MyComponent {
  private destroyRef = inject(DestroyRef);
  private scrollTrigger?: ScrollTrigger;

  constructor() {
    afterNextRender(() => {
      this.scrollTrigger = ScrollTrigger.create({
        trigger: '.element',
        start: 'top 80%',
        onEnter: () => { /* ... */ }
      });
    });

    this.destroyRef.onDestroy(() => {
      this.scrollTrigger?.kill();
    });
  }
}
```

---

## Accessibility Considerations

### Respect Reduced Motion Preference

**Detect User Preference**:
```typescript
export class AccessibleAnimationComponent {
  private mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  prefersReducedMotion = signal(this.mediaQuery.matches);

  constructor() {
    // Listen for changes
    this.mediaQuery.addEventListener('change', (e) => {
      this.prefersReducedMotion.set(e.matches);
    });
  }

  getAnimationConfig(): ViewportAnimationConfig {
    if (this.prefersReducedMotion()) {
      // Minimal animation
      return {
        animation: 'fadeIn',
        duration: 0.1,
        ease: 'none'
      };
    }

    // Full animation
    return {
      animation: 'slideUp',
      duration: 0.8,
      ease: 'power2.out'
    };
  }
}
```

**CSS Alternative**:
```css
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

### Keyboard Navigation

**Ensure Focusable Elements Remain Accessible**:
```html
<!-- Don't hide focusable content during animation -->
<button viewportAnimation
  [viewportConfig]="{ animation: 'fadeIn' }"
  tabindex="0">  <!-- Always focusable -->
  Click Me
</button>
```

### Screen Reader Compatibility

**ARIA Labels for Animated Content**:
```html
<div viewportAnimation
  [viewportConfig]="{ animation: 'slideUp' }"
  role="region"
  aria-label="Feature showcase">
  Content
</div>
```

---

## SSR Compatibility

### Safe Patterns

**Use `afterNextRender`**:
```typescript
import { afterNextRender } from '@angular/core';

constructor() {
  afterNextRender(() => {
    // Browser-only code
    this.initializeAnimations();
  });
}
```

**Check Platform**:
```typescript
import { isPlatformBrowser, PLATFORM_ID, inject } from '@angular/core';

export class MyComponent {
  private platformId = inject(PLATFORM_ID);

  ngOnInit() {
    if (isPlatformBrowser(this.platformId)) {
      // Browser-only logic
    }
  }
}
```

**Service Null Checks**:
```typescript
private gsap = inject(GsapCoreService);

animate() {
  if (this.gsap.gsap) {  // null on server
    this.gsap.gsap.to('.element', { x: 100 });
  }
}
```

---

## Animation Composition

### Combining Directives

**Parallax Background + Viewport Content**:
```html
<!-- Background parallax -->
<div scrollAnimation
  [scrollConfig]="{ animation: 'parallax', speed: 0.5 }">
  Background
</div>

<!-- Foreground content -->
<div viewportAnimation
  [viewportConfig]="{ animation: 'slideUp' }">
  Content
</div>
```

**Entrance + Scroll-Linked Fade**:
```html
<!-- Enters on viewport, fades on scroll -->
<h1
  viewportAnimation
  [viewportConfig]="{ animation: 'slideUp', duration: 0.8 }"
  scrollAnimation
  [scrollConfig]="{
    animation: 'custom',
    start: 'top 20%',
    end: 'bottom 60%',
    scrub: 1.2,
    from: { opacity: 1 },
    to: { opacity: 0 }
  }">
  Hero Title
</h1>
```

**Smooth Scroll + Animations**:
```typescript
// app.config.ts
providers: [
  provideLenis({ lerp: 0.08 }),
  provideGsap({ defaults: { ease: 'power2.out' } })
]
```

```html
<main lenisSmoothScroll>
  <section viewportAnimation>...</section>
  <section scrollAnimation>...</section>
</main>
```

---

## Common Mistakes to Avoid

### ❌ Mistake 1: Too Many Animations

```typescript
// Bad: Individual animations for every element
<div viewportAnimation>Item 1</div>
<div viewportAnimation>Item 2</div>
<div viewportAnimation>Item 3</div>
// ... 20 more items

// Good: Stagger on parent
<div viewportAnimation [viewportConfig]="{ stagger: 0.1 }">
  <div>Item 1</div>
  <div>Item 2</div>
  <div>Item 3</div>
</div>
```

### ❌ Mistake 2: Parallax with Easing

```typescript
// Bad: Parallax with easing (causes janky feel)
{
  animation: 'parallax',
  speed: 0.5,
  ease: 'power2.out'  // NEVER use easing with parallax
}

// Good: Parallax without easing
{
  animation: 'parallax',
  speed: 0.5,
  ease: 'none'  // Must be linear
}
```

### ❌ Mistake 3: Long Durations

```typescript
// Bad: Too long (users will scroll past)
{ duration: 3.0 }

// Good: Reasonable duration
{ duration: 0.6-0.8 }
```

### ❌ Mistake 4: Forgetting SSR

```typescript
// Bad: Direct DOM access in constructor
constructor() {
  gsap.to('.element', { x: 100 });  // Breaks SSR
}

// Good: Browser-only initialization
constructor() {
  afterNextRender(() => {
    if (isPlatformBrowser(this.platformId)) {
      gsap.to('.element', { x: 100 });
    }
  });
}
```

### ❌ Mistake 5: No Reduced Motion Support

```typescript
// Bad: Forced animations
{ duration: 1.5 }

// Good: Respect user preference
{
  duration: this.prefersReducedMotion() ? 0.1 : 1.5
}
```

---

## Testing & Debugging

### Enable Markers

```typescript
{
  markers: true  // Shows ScrollTrigger start/end points
}
```

### Refresh After Dynamic Content

```typescript
// After loading dynamic content
this.directive.refresh();

// Or globally
ScrollTrigger.refresh();
```

### Test Different Viewports

```typescript
// Mobile-specific config
@if (isMobile) {
  <div viewportAnimation
    [viewportConfig]="{
      duration: 0.5,  // Faster on mobile
      threshold: 0.3  // Trigger later
    }">
    Content
  </div>
}
```

### Performance Profiling

```typescript
// Check FPS in DevTools Performance tab
// Look for:
// - Long tasks (> 50ms)
// - Layout thrashing
// - Excessive repaints
```

### Common Debug Commands

```typescript
// Refresh all ScrollTriggers
ScrollTrigger.refresh();

// Kill all ScrollTriggers
ScrollTrigger.killAll();

// Get all active ScrollTriggers
ScrollTrigger.getAll();
```

---

## Summary Checklist

Before shipping animations, verify:

- [ ] Durations are reasonable (0.3-1.5s)
- [ ] Easing is appropriate (power2.out for most, none for parallax)
- [ ] Trigger points are optimized (top 80% for early, top 30% for late)
- [ ] `once: true` for non-reversible animations
- [ ] Reduced motion preference is respected
- [ ] SSR compatibility is ensured
- [ ] Stagger is used instead of individual animations
- [ ] Parallax uses `ease: 'none'`
- [ ] Scrub values are 1.0-1.5 for smooth feel
- [ ] Cleanup is handled (automatic with directives)

Following these best practices will ensure performant, accessible, and professional scroll animations.
