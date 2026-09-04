# Animation Patterns

Reusable scroll animation patterns extracted from the Angular GSAP showcase demo sections.

## Table of Contents

1. [Hero Entrance Stagger](#pattern-1-hero-entrance-stagger)
2. [Parallax Background](#pattern-2-parallax-background)
3. [Content Fade-Out on Scroll](#pattern-3-content-fade-out-on-scroll)
4. [Staggered Pills/List Items](#pattern-4-staggered-pillslist-items)
5. [Metric Card Animation (Bounce Easing)](#pattern-5-metric-card-animation-bounce-easing)
6. [Fullpage Hijacked Scroll](#pattern-6-fullpage-hijacked-scroll)
7. [Ambient Glow Backgrounds](#pattern-7-ambient-glow-backgrounds)
8. [Split Panel Alternating Layout](#pattern-8-split-panel-alternating-layout)
9. [Custom Scroll Animation](#pattern-9-custom-scroll-animation)
10. [Gradient Text Animation](#pattern-10-gradient-text-animation)

---

## Pattern 1: Hero Entrance Stagger

**Use Case**: Hero sections, feature introductions, section headers

**Timing**: 600-800ms duration, 100-200ms between elements

**Description**: Sequential entrance where each element appears with a cascading delay (badge → title → subtitle → buttons).

**Complete Example**:

```html
<!-- Hero Section with Staggered Entrance -->
<div class="relative text-center py-16">
  <!-- Badge - Scale in from center -->
  <div
    viewportAnimation
    [viewportConfig]="{
      animation: 'scaleIn',
      duration: 0.6,
      threshold: 0.1
    }"
    class="inline-flex items-center gap-2 px-4 py-2 mb-6
           bg-gradient-to-r from-indigo-500/20 to-purple-500/20
           rounded-full border border-indigo-500/30"
  >
    <span class="text-sm font-semibold text-indigo-300">New Feature</span>
  </div>

  <!-- Main Headline - Slide up with gradient -->
  <h1
    viewportAnimation
    [viewportConfig]="{
      animation: 'slideUp',
      duration: 0.8,
      delay: 0.1,
      threshold: 0.1
    }"
    class="text-5xl md:text-7xl font-bold mb-6"
  >
    <span
      class="bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400
                bg-clip-text text-transparent"
    >
      Hero Headline
    </span>
  </h1>

  <!-- Subtitle - Fade in -->
  <p
    viewportAnimation
    [viewportConfig]="{
      animation: 'fadeIn',
      duration: 0.8,
      delay: 0.2,
      threshold: 0.1
    }"
    class="text-xl md:text-2xl text-gray-300 mb-8 max-w-3xl mx-auto"
  >
    Compelling subtitle that explains the value proposition
  </p>

  <!-- CTA Buttons - Slide up with stagger -->
  <div
    viewportAnimation
    [viewportConfig]="{
      animation: 'slideUp',
      duration: 0.6,
      delay: 0.3,
      threshold: 0.1
    }"
    class="flex gap-4 justify-center"
  >
    <button class="px-8 py-3 bg-indigo-500 rounded-lg">Get Started</button>
    <button class="px-8 py-3 bg-slate-700 rounded-lg">Learn More</button>
  </div>
</div>
```

**Key Timing Sequence**:

1. Badge: 600ms at 100ms delay
2. Title: 800ms at 200ms delay
3. Subtitle: 800ms at 400ms delay
4. Buttons: 600ms at 600ms delay

---

## Pattern 2: Parallax Background

**Use Case**: Hero backgrounds, atmospheric effects

**Speed Range**: 0.3-0.6 (slow moving)

**Description**: Background layer moves slower than scroll to create depth.

**Complete Example**:

```html
<div class="relative min-h-screen overflow-hidden">
  <!-- Background Parallax Layer - Moves at 30% scroll speed -->
  <div
    scrollAnimation
    [scrollConfig]="{
      animation: 'parallax',
      speed: 0.3,
      scrub: 1.5,
      start: 'top top',
      end: 'bottom 50%'
    }"
    class="absolute inset-0 -z-10"
  >
    <img src="/assets/hero-bg.jpg" alt="Background" class="w-full h-full object-cover" />
  </div>

  <!-- Foreground Content - Normal scroll speed -->
  <div class="relative z-10">
    <h1
      viewportAnimation
      [viewportConfig]="{
        animation: 'slideUp',
        duration: 0.8
      }"
    >
      Foreground Title
    </h1>
  </div>
</div>
```

**Multi-Layer Parallax** (3 layers at different speeds):

```html
<div class="relative min-h-screen">
  <!-- Background (slowest) -->
  <div scrollAnimation [scrollConfig]="{ animation: 'parallax', speed: 0.3, scrub: 1.5 }" class="absolute inset-0 -z-30">Background layer</div>

  <!-- Midground -->
  <div scrollAnimation [scrollConfig]="{ animation: 'parallax', speed: 0.6, scrub: 1.2 }" class="absolute inset-0 -z-20">Midground layer</div>

  <!-- Foreground (normal speed) -->
  <div class="relative z-10">Foreground content</div>
</div>
```

---

## Pattern 3: Content Fade-Out on Scroll

**Use Case**: Hero sections, section transitions

**Timing**: Scrub of 1.0-1.5 for smooth feel

**Description**: Hero content disappears gracefully as user scrolls down.

**Complete Example**:

```html
<!-- Hero Content that Fades Out -->
<div
  scrollAnimation
  [scrollConfig]="{
    animation: 'custom',
    start: 'top 20%',
    end: 'bottom 60%',
    scrub: 1.2,
    from: { opacity: 1, y: 0 },
    to: { opacity: 0, y: -150 }
  }"
  class="relative text-center"
>
  <h1 class="text-6xl font-bold text-white mb-4">Hero Title</h1>

  <p class="text-xl text-gray-300">Fades out as user scrolls</p>
</div>
```

**With Parallax Background** (combined):

```html
<div class="relative min-h-screen">
  <!-- Parallax background stays -->
  <div
    scrollAnimation
    [scrollConfig]="{
      animation: 'parallax',
      speed: 0.4,
      scrub: 1.5
    }"
  >
    Background
  </div>

  <!-- Hero fades out -->
  <div
    scrollAnimation
    [scrollConfig]="{
      animation: 'custom',
      start: 'top 20%',
      end: 'bottom 60%',
      scrub: 1.2,
      from: { opacity: 1, y: 0 },
      to: { opacity: 0, y: -150 }
    }"
  >
    Hero content
  </div>
</div>
```

---

## Pattern 4: Staggered Pills/List Items

**Use Case**: Feature lists, problem statements, capability lists

**Stagger Amount**: 0.08-0.15s typical

**Description**: List items appear in cascade with sequential delays.

**Complete Example**:

```typescript
export class FeaturesComponent {
  features = ['Declarative API', 'SSR Compatible', 'Type-Safe', 'Zero Dependencies', 'Production Ready'];
}
```

```html
<!-- Staggered Feature Pills -->
<div class="flex flex-wrap gap-3">
  @for (feature of features; track $index) {
  <div
    viewportAnimation
    [viewportConfig]="{
        animation: 'slideUp',
        duration: 0.5,
        delay: $index * 0.1,
        threshold: 0.2,
        ease: 'power2.out'
      }"
    class="px-4 py-2 bg-slate-800/60 border border-slate-700/50
             rounded-xl text-sm text-slate-200"
  >
    {{ feature }}
  </div>
  }
</div>
```

**Problem/Solution Pills** (color-coded):

```html
<!-- Problem Pills (red theme) -->
<div class="flex flex-wrap gap-3">
  @for (problem of problems; track $index) {
  <div
    viewportAnimation
    [viewportConfig]="{
        animation: 'slideUp',
        duration: 0.5,
        delay: $index * 0.1,
        threshold: 0.2
      }"
    class="px-4 py-2 bg-red-500/10 border border-red-500/20
             rounded-full text-sm text-red-300"
  >
    {{ problem }}
  </div>
  }
</div>
```

---

## Pattern 5: Metric Card Animation (Bounce Easing)

**Use Case**: Statistics, metrics, proof points

**Easing**: `back.out(1.7)` for bouncy feel

**Description**: Cards animate with elastic bounce effect for emphasis.

**Complete Example**:

```typescript
export class MetricsComponent {
  metrics = [
    { value: '60+', label: 'Components', description: 'Ready to use', colorClass: 'bg-gradient-to-br from-indigo-400 to-violet-500' },
    { value: '10+', label: 'Animations', description: 'Built-in presets', colorClass: 'bg-gradient-to-br from-emerald-400 to-cyan-500' },
    { value: 'SSR', label: 'Compatible', description: 'Server-side ready', colorClass: 'bg-gradient-to-br from-pink-400 to-rose-500' },
    { value: '100%', label: 'Type-Safe', description: 'Full TypeScript', colorClass: 'bg-gradient-to-br from-amber-400 to-orange-500' },
  ];
}
```

```html
<!-- Metric Cards with Bounce -->
<div class="grid grid-cols-2 md:grid-cols-4 gap-6">
  @for (metric of metrics; track $index) {
  <div
    viewportAnimation
    [viewportConfig]="{
        animation: 'slideUp',
        duration: 0.6,
        delay: $index * 0.1,
        ease: 'back.out(1.7)',
        threshold: 0.2
      }"
    class="relative p-6 rounded-2xl bg-slate-800/60
             border border-slate-700/50 backdrop-blur-md"
  >
    <!-- Large gradient number -->
    <div class="text-5xl md:text-6xl font-black mb-2 bg-clip-text text-transparent" [ngClass]="metric.colorClass">{{ metric.value }}</div>

    <!-- Label -->
    <div class="text-base md:text-lg font-bold text-white mb-1">{{ metric.label }}</div>

    <!-- Description -->
    <div class="text-xs md:text-sm text-gray-400">{{ metric.description }}</div>
  </div>
  }
</div>
```

---

## Pattern 6: Fullpage Hijacked Scroll

**Use Case**: Product showcases, feature tours, value proposition walkthroughs

**Scroll Height**: 800-1000px per step typical

**Description**: One viewport = one slide, scroll is hijacked for step-by-step presentation.

**Complete Example**:

```typescript
export class TutorialComponent {
  currentStep = signal(0);
  totalSteps = 5;

  steps = [
    { title: 'Step 1', icon: '🎮', direction: 'left' as const },
    { title: 'Step 2', icon: '✨', direction: 'right' as const },
    { title: 'Step 3', icon: '🏗️', direction: 'left' as const },
    { title: 'Step 4', icon: '📡', direction: 'right' as const },
    { title: 'Step 5', icon: '⚡', direction: 'left' as const },
  ];

  onStepChange(index: number) {
    this.currentStep.set(index);
  }
}
```

```html
<agsp-hijacked-scroll-timeline [scrollHeightPerStep]="900" [animationDuration]="0.8" [ease]="'power3.inOut'" [scrub]="1.5" [stepHold]="0.9" [showStepIndicator]="false" (currentStepChange)="onStepChange($event)">
  @for (step of steps; track step.title; let i = $index) {
  <div hijackedScrollItem [slideDirection]="step.direction" [fadeIn]="true" [scale]="true">
    <!-- Fullscreen slide -->
    <div
      class="h-screen w-screen flex items-center justify-center
                  bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950"
    >
      <!-- Content -->
      <div class="text-center">
        <!-- Step number -->
        <div
          class="text-7xl font-black mb-6
                      bg-gradient-to-br from-indigo-400 to-violet-500
                      bg-clip-text text-transparent"
        >
          {{ (i + 1).toString().padStart(2, '0') }}
        </div>

        <!-- Icon -->
        <div class="text-9xl mb-8">{{ step.icon }}</div>

        <!-- Title -->
        <h2 class="text-5xl font-bold text-white mb-4">{{ step.title }}</h2>

        <!-- Description -->
        <p class="text-xl text-slate-300 max-w-2xl mx-auto">Detailed description of this step</p>
      </div>
    </div>
  </div>
  }
</agsp-hijacked-scroll-timeline>

<!-- Step Indicator -->
<div class="fixed left-8 top-1/2 -translate-y-1/2 z-50">
  @for (step of steps; track $index) {
  <div class="w-3 h-3 rounded-full mb-4" [class.bg-indigo-500]="currentStep() === $index" [class.bg-slate-700]="currentStep() !== $index"></div>
  }
</div>
```

---

## Pattern 7: Ambient Glow Backgrounds

**Use Case**: Dark theme sections, premium backgrounds

**Colors**: Use brand colors at 8-20% opacity

**Description**: Layered blurred circles for atmospheric effect (no animation required).

**Complete Example**:

```html
<section
  class="relative min-h-screen overflow-hidden
                bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950"
>
  <!-- Ambient Glow Backgrounds (Static) -->
  <div class="absolute inset-0 pointer-events-none">
    <!-- Primary glow (top-left) -->
    <div
      class="absolute top-1/4 left-1/4
                w-[500px] h-[500px]
                bg-indigo-500/10
                rounded-full blur-[120px]"
    ></div>

    <!-- Secondary glow (bottom-right) -->
    <div
      class="absolute bottom-1/3 right-1/4
                w-[400px] h-[400px]
                bg-purple-500/10
                rounded-full blur-[100px]"
    ></div>

    <!-- Tertiary glow (top-right) -->
    <div
      class="absolute top-1/2 right-1/3
                w-[300px] h-[300px]
                bg-pink-500/8
                rounded-full blur-[80px]"
    ></div>
  </div>

  <!-- Content (above glows) -->
  <div class="relative z-10">Content here</div>
</section>
```

**Animated Glow** (optional scroll-linked):

```html
<!-- Decorative glow that scales/rotates on scroll -->
<div
  scrollAnimation
  [scrollConfig]="{
    animation: 'custom',
    start: 'top 90%',
    end: 'bottom 30%',
    scrub: 0.5,
    from: {
      scale: 0.6,
      opacity: 0,
      rotation: -20
    },
    to: {
      scale: 1,
      opacity: 0.4,
      rotation: 0
    }
  }"
  class="absolute top-0 left-0 w-full h-full"
>
  Animated background pattern
</div>
```

---

## Pattern 8: Split Panel Alternating Layout

**Use Case**: Feature showcases, tutorial steps

**Parallax Speed**: 0.6 typical for subtle effect

**Description**: Content and visual alternate sides as you scroll.

**Complete Example**:

```typescript
export class FeatureStepsComponent {
  steps = [
    { id: 1, title: 'Step 1', description: '...', image: '/assets/step1.jpg', layout: 'left' as const },
    { id: 2, title: 'Step 2', description: '...', image: '/assets/step2.jpg', layout: 'right' as const },
    { id: 3, title: 'Step 3', description: '...', image: '/assets/step3.jpg', layout: 'left' as const },
  ];
}
```

```html
@for (step of steps; track step.id; let i = $index) {
<div class="grid grid-cols-1 md:grid-cols-2 gap-12 items-center mb-32" [class.md:grid-flow-dense]="step.layout === 'right'">
  <!-- Content Column -->
  <div
    viewportAnimation
    [viewportConfig]="{
        animation: 'slideUp',
        duration: 0.8,
        threshold: 0.2
      }"
    [class.md:col-start-2]="step.layout === 'right'"
  >
    <!-- Step Number -->
    <div class="flex items-center gap-4 mb-6">
      <span
        class="text-6xl font-black
                    bg-gradient-to-br from-indigo-400 to-violet-500
                    bg-clip-text text-transparent"
      >
        {{ (i + 1).toString().padStart(2, '0') }}
      </span>
    </div>

    <!-- Title -->
    <h3 class="text-3xl md:text-4xl font-bold text-white mb-4">{{ step.title }}</h3>

    <!-- Description -->
    <p class="text-lg text-slate-300 mb-6">{{ step.description }}</p>
  </div>

  <!-- Visual Column -->
  <div
    scrollAnimation
    [scrollConfig]="{
        animation: 'parallax',
        speed: 0.6,
        scrub: 1.2
      }"
    [class.md:col-start-1]="step.layout === 'right'"
    [class.md:row-start-1]="step.layout === 'right'"
  >
    <div
      class="relative aspect-square rounded-3xl overflow-hidden
                  bg-slate-800/60 border border-slate-700/50"
    >
      <img [src]="step.image" [alt]="step.title" class="w-full h-full object-cover" />
    </div>
  </div>
</div>
}
```

---

## Pattern 9: Custom Scroll Animation

**Use Case**: Decorative elements, complex animations

**Properties**: scale, rotate, opacity, x/y translation all possible

**Description**: Full control over animation progression tied to scroll.

**Complete Example**:

```html
<!-- Decorative Pattern with Complex Animation -->
<div
  scrollAnimation
  [scrollConfig]="{
    animation: 'custom',
    start: 'top 90%',
    end: 'bottom 30%',
    scrub: 0.5,
    from: {
      scale: 0.6,
      opacity: 0,
      rotation: -20,
      y: 50,
      x: -30
    },
    to: {
      scale: 1,
      opacity: 0.4,
      rotation: 0,
      y: -50,
      x: 30
    }
  }"
  class="absolute inset-0 pointer-events-none"
>
  <!-- SVG or decorative content -->
  <svg class="w-full h-full">
    <circle cx="50%" cy="50%" r="200" fill="url(#gradient)" />
  </svg>
</div>
```

**Progress Bar Fill**:

```typescript
export class ProgressComponent {
  progressSignal = signal(0);

  scrollConfig: ScrollAnimationConfig = {
    animation: 'custom',
    start: 'top top',
    end: 'bottom bottom',
    scrub: true,
    from: { scaleX: 0 },
    to: { scaleX: 1 },
    onUpdate: (progress) => {
      this.progressSignal.set(progress * 100);
    },
  };
}
```

```html
<div scrollAnimation [scrollConfig]="scrollConfig" class="fixed top-0 left-0 h-2 bg-indigo-500 origin-left" [style.width.%]="progressSignal()"></div>
```

---

## Pattern 10: Gradient Text Animation

**Use Case**: Headings, emphasis text, CTAs

**Gradient Direction**: `to-r`, `to-b`, `to-br` common

**Description**: Text with animated gradient colors.

**Complete Example**:

```html
<!-- Gradient Text with Entrance Animation -->
<h2
  viewportAnimation
  [viewportConfig]="{
    animation: 'slideUp',
    duration: 0.8,
    delay: 0.1,
    threshold: 0.2
  }"
  class="text-4xl md:text-6xl font-bold mb-6"
>
  <span
    class="bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400
               bg-clip-text text-transparent"
  >
    Beautiful Gradient Text
  </span>
</h2>
```

**With Multiple Gradient Sections**:

```html
<h1 class="text-5xl md:text-7xl font-bold">
  <span
    viewportAnimation
    [viewportConfig]="{
      animation: 'slideUp',
      duration: 0.8,
      threshold: 0.1
    }"
    class="block"
  >
    Build
  </span>

  <span
    viewportAnimation
    [viewportConfig]="{
      animation: 'slideUp',
      duration: 0.8,
      delay: 0.1,
      threshold: 0.1
    }"
    class="block bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400
           bg-clip-text text-transparent"
  >
    Amazing Experiences
  </span>

  <span
    viewportAnimation
    [viewportConfig]="{
      animation: 'slideUp',
      duration: 0.8,
      delay: 0.2,
      threshold: 0.1
    }"
    class="block text-slate-300"
  >
    With Angular & GSAP
  </span>
</h1>
```

**Animated Gradient** (CSS animation):

```html
<h1 class="text-6xl font-bold">
  <span
    class="bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400
               bg-clip-text text-transparent
               bg-[length:200%_auto]
               animate-gradient"
  >
    Flowing Gradient
  </span>
</h1>
```

```css
@keyframes gradient {
  0%,
  100% {
    background-position: 0% 50%;
  }
  50% {
    background-position: 100% 50%;
  }
}

.animate-gradient {
  animation: gradient 3s ease infinite;
}
```

---

## Pattern Combination Examples

### Hero with All Patterns

```html
<section class="relative min-h-screen overflow-hidden">
  <!-- Pattern 7: Ambient Glow -->
  <div class="absolute inset-0 pointer-events-none">
    <div
      class="absolute top-1/4 left-1/4 w-[500px] h-[500px]
                bg-indigo-500/10 rounded-full blur-[120px]"
    ></div>
  </div>

  <!-- Pattern 2: Parallax Background -->
  <div scrollAnimation [scrollConfig]="{ animation: 'parallax', speed: 0.3, scrub: 1.5 }">Background image</div>

  <!-- Pattern 1: Hero Entrance Stagger -->
  <div class="relative z-10">
    <!-- Badge -->
    <div viewportAnimation [viewportConfig]="{ animation: 'scaleIn', duration: 0.6 }">Badge</div>

    <!-- Pattern 10: Gradient Text -->
    <h1 viewportAnimation [viewportConfig]="{ animation: 'slideUp', duration: 0.8, delay: 0.1 }">
      <span
        class="bg-gradient-to-r from-indigo-400 to-pink-400
                   bg-clip-text text-transparent"
      >
        Hero Title
      </span>
    </h1>
  </div>

  <!-- Pattern 3: Fade Out on Scroll -->
  <div
    scrollAnimation
    [scrollConfig]="{
      animation: 'custom',
      start: 'top 20%',
      end: 'bottom 60%',
      scrub: 1.2,
      from: { opacity: 1 },
      to: { opacity: 0 }
    }"
  >
    Content that fades
  </div>
</section>

<!-- Pattern 5: Metric Cards -->
<section>
  <div class="grid grid-cols-4 gap-6">
    @for (metric of metrics; track $index) {
    <div
      viewportAnimation
      [viewportConfig]="{
          animation: 'slideUp',
          delay: $index * 0.1,
          ease: 'back.out(1.7)'
        }"
    >
      Metric card
    </div>
    }
  </div>
</section>
```

---

## Summary

These 10 patterns cover the most common scroll animation scenarios:

1. **Hero Entrance Stagger** - Sequential reveals
2. **Parallax Background** - Depth effects
3. **Content Fade-Out** - Hero transitions
4. **Staggered Pills** - List reveals
5. **Metric Cards** - Bouncy stats
6. **Fullpage Hijacked** - Step presentations
7. **Ambient Glows** - Atmospheric backgrounds
8. **Split Panels** - Alternating layouts
9. **Custom Scroll** - Complex animations
10. **Gradient Text** - Emphasized headings

Combine these patterns to create rich, professional scroll experiences.

---

## Complete Page Examples

### Example 1: GSAP Showcase Hero Section

Full hero with combined viewport + scroll animations, parallax background, and staggered entrance.

```typescript
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { ScrollAnimationDirective, ViewportAnimationDirective } from '@hive-academy/angular-gsap';

@Component({
  selector: 'app-gsap-hero',
  imports: [NgOptimizedImage, ScrollAnimationDirective, ViewportAnimationDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="relative min-h-screen flex items-center justify-center overflow-hidden">
      <!-- Background Layer - Smooth Parallax -->
      <div
        class="absolute inset-0 w-full h-full min-h-screen"
        scrollAnimation
        [scrollConfig]="{
          animation: 'parallax',
          speed: 0.3,
          scrub: 1.5,
          start: 'top top',
          end: 'bottom 50%'
        }"
      >
        <img ngSrc="images/hero-bg.png" alt="" fill priority class="object-cover scale-110" />
      </div>

      <!-- Gradient Overlay -->
      <div class="absolute inset-0 bg-gradient-to-b from-slate-950/100 via-transparent to-slate-950/100"></div>

      <!-- Hero Content - Combined Viewport + Scroll Animations -->
      <div
        class="relative z-10 text-center text-white px-8 max-w-5xl mx-auto"
        scrollAnimation
        [scrollConfig]="{
          animation: 'custom',
          start: 'top 20%',
          end: 'bottom 60%',
          scrub: 1.2,
          from: { opacity: 1, y: 0 },
          to: { opacity: 0, y: -150 }
        }"
      >
        <!-- Badge - Scale in on viewport entry -->
        <div viewportAnimation [viewportConfig]="{ animation: 'scaleIn', duration: 0.6, delay: 0.1, threshold: 0.1 }">
          <span
            class="inline-flex items-center gap-3 px-6 py-3 bg-white/5 backdrop-blur-md
                       rounded-full text-sm font-medium border border-white/10"
          >
            <span class="relative flex h-3 w-3">
              <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span class="relative inline-flex rounded-full h-3 w-3 bg-emerald-400"></span>
            </span>
            <span class="text-white/90">Angular + GSAP ScrollTrigger</span>
          </span>
        </div>

        <!-- Main Title - Slide up with stagger -->
        <h1 class="text-5xl md:text-7xl font-black mb-8 leading-none tracking-tight mt-6" viewportAnimation [viewportConfig]="{ animation: 'slideUp', duration: 0.8, delay: 0.2, threshold: 0.1 }">
          <span class="block bg-gradient-to-r from-white via-white to-white/80 bg-clip-text text-transparent"> Angular </span>
          <span class="block bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent"> GSAP </span>
        </h1>

        <!-- Subtitle - Fade in -->
        <p class="text-xl text-white/70 max-w-3xl mx-auto mb-6" viewportAnimation [viewportConfig]="{ animation: 'fadeIn', duration: 0.8, delay: 0.4, threshold: 0.1 }">Create stunning scroll-driven animations with declarative directives.</p>

        <!-- Feature Pills -->
        <div class="flex flex-wrap gap-3 justify-center mb-12">
          <span class="px-4 py-2 bg-cyan-500/20 text-cyan-300 rounded-full text-sm font-semibold border border-cyan-500/30"> 10+ Built-in Effects </span>
          <span class="px-4 py-2 bg-purple-500/20 text-purple-300 rounded-full text-sm font-semibold border border-purple-500/30"> SSR-Safe </span>
          <span class="px-4 py-2 bg-pink-500/20 text-pink-300 rounded-full text-sm font-semibold border border-pink-500/30"> TypeScript-First </span>
        </div>

        <!-- CTA Buttons - Slide up -->
        <div class="flex flex-wrap gap-6 justify-center" viewportAnimation [viewportConfig]="{ animation: 'slideUp', duration: 0.6, delay: 0.6, threshold: 0.1 }">
          <button
            class="group relative px-10 py-5 bg-gradient-to-r from-emerald-400 to-cyan-400
                         text-slate-900 rounded-full font-bold text-lg
                         hover:scale-105 transition-all duration-300
                         shadow-xl shadow-emerald-400/30"
          >
            Get Started
          </button>
          <a
            href="#features"
            class="px-10 py-5 bg-white/5 backdrop-blur-md text-white
                                     rounded-full font-bold text-lg border border-white/20
                                     hover:bg-white/10 transition-all duration-300"
          >
            See Examples
          </a>
        </div>

        <!-- Scroll Indicator -->
        <div class="flex flex-col items-center gap-3 text-white/50 mt-16" viewportAnimation [viewportConfig]="{ animation: 'fadeIn', duration: 0.6, delay: 0.8, threshold: 0.1 }">
          <span class="text-sm font-medium tracking-widest uppercase">Scroll to explore</span>
          <div class="w-6 h-10 border-2 border-white/30 rounded-full flex justify-center pt-2">
            <div class="w-1.5 h-3 bg-white/50 rounded-full animate-bounce"></div>
          </div>
        </div>
      </div>
    </section>
  `,
})
export class GsapHeroComponent {}
```

---

### Example 2: Fullpage Library Showcase

Hijacked scroll with 50/50 split layout and step indicator.

```typescript
import { Component, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ScrollTimelineComponent, HijackedScrollItemDirective } from '@hive-academy/angular-gsap';

@Component({
  selector: 'app-value-propositions',
  imports: [CommonModule, ScrollTimelineComponent, HijackedScrollItemDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <agsp-scroll-timeline [scrollHeightPerStep]="900" [start]="'top top'" [animationDuration]="0.8" [ease]="'power3.inOut'" [scrub]="1.5" [stepHold]="0.9" [showStepIndicator]="true" [stepIndicatorPosition]="'left'" (currentStepChange)="onStepChange($event)">
      @for (section of sections(); track section.id; let i = $index) {
      <div hijackedScrollItem [slideDirection]="i % 2 === 0 ? 'left' : 'right'" [fadeIn]="true" [scale]="true">
        <div class="h-screen w-screen flex overflow-hidden bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950">
          <!-- Left Column -->
          <div class="w-1/2 h-full flex items-center" [class.justify-end]="i % 2 === 0">
            @if (i % 2 === 0) {
            <!-- Content on left -->
            <div class="w-full max-w-2xl px-16 pl-24">
              <div class="flex items-center gap-4 mb-6">
                <span
                  class="text-7xl font-black bg-gradient-to-br from-indigo-400 to-violet-500
                                 bg-clip-text text-transparent leading-none"
                >
                  {{ (i + 1).toString().padStart(2, '0') }}
                </span>
              </div>
              <h2 class="text-5xl font-bold text-white mb-6">{{ section.headline }}</h2>
              <p class="text-xl text-slate-300 mb-8">{{ section.description }}</p>
              <div
                class="inline-flex items-center gap-4 px-6 py-4
                              bg-gradient-to-r from-indigo-500/20 to-violet-500/20
                              rounded-2xl border border-indigo-500/30"
              >
                <div
                  class="text-4xl font-black bg-gradient-to-br from-indigo-400 to-violet-500
                                bg-clip-text text-transparent"
                >
                  {{ section.metricValue }}
                </div>
                <div class="text-sm font-bold text-white">{{ section.metricLabel }}</div>
              </div>
            </div>
            } @else {
            <!-- Visual on left -->
            <div class="w-full h-full flex items-center justify-center p-16">
              <div class="text-9xl">{{ section.icon }}</div>
            </div>
            }
          </div>

          <!-- Right Column (opposite content) -->
          <div class="w-1/2 h-full flex items-center">
            @if (i % 2 !== 0) {
            <div class="w-full max-w-2xl px-16 pr-24">
              <!-- Same content structure as left -->
            </div>
            } @else {
            <div class="w-full h-full flex items-center justify-center p-16">
              <div class="text-9xl">{{ section.icon }}</div>
            </div>
            }
          </div>
        </div>
      </div>
      }
    </agsp-scroll-timeline>
  `,
})
export class ValuePropositionsComponent {
  currentStep = signal(0);

  onStepChange(step: number) {
    this.currentStep.set(step);
  }

  sections = signal([
    {
      id: 'angular-3d',
      headline: 'Three.js Made Angular-Native',
      description: 'Pure Angular components with signal-based inputs and automatic cleanup.',
      metricValue: '10+',
      metricLabel: '3D Primitives',
      icon: '🎮',
    },
    {
      id: 'angular-gsap',
      headline: 'GSAP Animations, Angular Style',
      description: 'Declarative directives for scroll-triggered animations. SSR-safe.',
      metricValue: '6+',
      metricLabel: 'Animation Directives',
      icon: '✨',
    },
    // ... more sections
  ]);
}
```

---

### Example 3: Split Panel Feature Timeline

Alternating image/content with parallax using built-in components.

```typescript
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { FeatureShowcaseTimelineComponent, SplitPanelSectionComponent, SplitPanelImageDirective, SplitPanelBadgeDirective, SplitPanelTitleDirective, SplitPanelDescriptionDirective, SplitPanelFeaturesDirective, ViewportAnimationDirective, ScrollAnimationDirective } from '@hive-academy/angular-gsap';

@Component({
  selector: 'app-feature-timeline',
  imports: [NgOptimizedImage, FeatureShowcaseTimelineComponent, SplitPanelSectionComponent, SplitPanelImageDirective, SplitPanelBadgeDirective, SplitPanelTitleDirective, SplitPanelDescriptionDirective, SplitPanelFeaturesDirective, ViewportAnimationDirective, ScrollAnimationDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <agsp-feature-showcase-timeline [colorTheme]="'emerald'">
      <!-- Hero Section -->
      <div featureHero class="relative text-center py-16">
        <!-- Animated decorative background -->
        <div
          class="absolute inset-0 flex items-center justify-end pointer-events-none"
          scrollAnimation
          [scrollConfig]="{
            animation: 'custom',
            start: 'top 90%',
            end: 'bottom 30%',
            scrub: 0.5,
            from: { scale: 0.6, opacity: 0, rotation: -20, y: 50 },
            to: { scale: 1, opacity: 0.4, rotation: 0, y: -50 }
          }"
        >
          <div class="w-[800px] h-[800px] text-emerald-400/30">
            <!-- SVG pattern or decorative element -->
          </div>
        </div>

        <!-- Hero content with viewport animations -->
        <div class="relative z-10">
          <div viewportAnimation [viewportConfig]="{ animation: 'scaleIn', duration: 0.6, threshold: 0.3 }">
            <span
              class="inline-flex items-center gap-2 px-6 py-2
                         bg-gradient-to-r from-emerald-500/20 to-cyan-500/20
                         border border-emerald-400/30 rounded-full text-sm font-semibold text-emerald-300 mb-6"
            >
              SCROLL ANIMATION LAYER
            </span>
          </div>

          <h2 class="text-7xl font-bold text-white mb-6" viewportAnimation [viewportConfig]="{ animation: 'slideUp', duration: 0.8, delay: 0.1, threshold: 0.2 }">
            <span class="bg-gradient-to-r from-emerald-400 via-cyan-400 to-blue-400 bg-clip-text text-transparent"> Angular GSAP </span>
          </h2>

          <!-- Metrics row -->
          <div class="flex justify-center gap-12 mt-12" viewportAnimation [viewportConfig]="{ animation: 'slideUp', duration: 0.8, delay: 0.3, threshold: 0.2 }">
            <div class="text-center">
              <div class="text-4xl font-bold text-emerald-400">10+ Animations</div>
              <div class="text-sm text-gray-400 uppercase">Built-in Effects</div>
            </div>
            <div class="text-center">
              <div class="text-4xl font-bold text-cyan-400">ScrollTrigger</div>
              <div class="text-sm text-gray-400 uppercase">GSAP-Powered</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Feature Steps using Split Panel Component -->
      @for (step of steps(); track step.id; let i = $index) {
      <agsp-split-panel-section [layout]="step.layout === 'left' ? 'image-right' : 'image-left'" [parallaxSpeed]="0.6" [colorTheme]="'emerald'">
        <img splitPanelImage [ngSrc]="step.image" [alt]="step.title" fill priority class="object-cover" />

        <div splitPanelBadge class="inline-flex items-center gap-3 mb-8">
          <span
            class="flex items-center justify-center w-16 h-16 rounded-full
                         bg-gradient-to-br from-emerald-500 to-cyan-600
                         text-white font-bold text-2xl shadow-lg"
          >
            {{ step.step }}
          </span>
        </div>

        <h3 splitPanelTitle class="text-5xl font-bold text-white mb-6">{{ step.title }}</h3>
        <p splitPanelDescription class="text-xl text-gray-300 mb-8">{{ step.description }}</p>

        <div splitPanelFeatures class="space-y-4">
          @for (note of step.notes; track $index) {
          <div class="flex items-start gap-3">
            <svg class="w-6 h-6 text-emerald-400 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p class="text-base text-gray-400">{{ note }}</p>
          </div>
          }
        </div>
      </agsp-split-panel-section>
      }
    </agsp-feature-showcase-timeline>
  `,
})
export class FeatureTimelineComponent {
  steps = signal([
    {
      id: 'scroll-animation',
      step: 1,
      title: 'ScrollAnimationDirective',
      description: 'Apply scroll-triggered animations with a simple directive.',
      image: 'images/step1.png',
      layout: 'left' as const,
      notes: ['10+ built-in animation types', 'Custom from/to with GSAP TweenVars', 'Configurable ScrollTrigger options'],
    },
    {
      id: 'hijacked-scroll',
      step: 2,
      title: 'Hijacked Scroll',
      description: 'Create scroll-jacked experiences for step-by-step presentations.',
      image: 'images/step2.png',
      layout: 'right' as const,
      notes: ['Pinned viewport during scroll', 'Step-by-step transitions', 'Progress tracking outputs'],
    },
  ]);
}
```
