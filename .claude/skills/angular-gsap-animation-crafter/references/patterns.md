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
  <div viewportAnimation
    [viewportConfig]="{
      animation: 'scaleIn',
      duration: 0.6,
      threshold: 0.1
    }"
    class="inline-flex items-center gap-2 px-4 py-2 mb-6
           bg-gradient-to-r from-indigo-500/20 to-purple-500/20
           rounded-full border border-indigo-500/30">
    <span class="text-sm font-semibold text-indigo-300">New Feature</span>
  </div>

  <!-- Main Headline - Slide up with gradient -->
  <h1 viewportAnimation
    [viewportConfig]="{
      animation: 'slideUp',
      duration: 0.8,
      delay: 0.1,
      threshold: 0.1
    }"
    class="text-5xl md:text-7xl font-bold mb-6">
    <span class="bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400
                bg-clip-text text-transparent">
      Hero Headline
    </span>
  </h1>

  <!-- Subtitle - Fade in -->
  <p viewportAnimation
    [viewportConfig]="{
      animation: 'fadeIn',
      duration: 0.8,
      delay: 0.2,
      threshold: 0.1
    }"
    class="text-xl md:text-2xl text-gray-300 mb-8 max-w-3xl mx-auto">
    Compelling subtitle that explains the value proposition
  </p>

  <!-- CTA Buttons - Slide up with stagger -->
  <div viewportAnimation
    [viewportConfig]="{
      animation: 'slideUp',
      duration: 0.6,
      delay: 0.3,
      threshold: 0.1
    }"
    class="flex gap-4 justify-center">
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
  <div scrollAnimation
    [scrollConfig]="{
      animation: 'parallax',
      speed: 0.3,
      scrub: 1.5,
      start: 'top top',
      end: 'bottom 50%'
    }"
    class="absolute inset-0 -z-10">
    <img src="/assets/hero-bg.jpg"
         alt="Background"
         class="w-full h-full object-cover" />
  </div>

  <!-- Foreground Content - Normal scroll speed -->
  <div class="relative z-10">
    <h1 viewportAnimation
      [viewportConfig]="{
        animation: 'slideUp',
        duration: 0.8
      }">
      Foreground Title
    </h1>
  </div>

</div>
```

**Multi-Layer Parallax** (3 layers at different speeds):

```html
<div class="relative min-h-screen">

  <!-- Background (slowest) -->
  <div scrollAnimation
    [scrollConfig]="{ animation: 'parallax', speed: 0.3, scrub: 1.5 }"
    class="absolute inset-0 -z-30">
    Background layer
  </div>

  <!-- Midground -->
  <div scrollAnimation
    [scrollConfig]="{ animation: 'parallax', speed: 0.6, scrub: 1.2 }"
    class="absolute inset-0 -z-20">
    Midground layer
  </div>

  <!-- Foreground (normal speed) -->
  <div class="relative z-10">
    Foreground content
  </div>

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
<div scrollAnimation
  [scrollConfig]="{
    animation: 'custom',
    start: 'top 20%',
    end: 'bottom 60%',
    scrub: 1.2,
    from: { opacity: 1, y: 0 },
    to: { opacity: 0, y: -150 }
  }"
  class="relative text-center">

  <h1 class="text-6xl font-bold text-white mb-4">
    Hero Title
  </h1>

  <p class="text-xl text-gray-300">
    Fades out as user scrolls
  </p>

</div>
```

**With Parallax Background** (combined):

```html
<div class="relative min-h-screen">

  <!-- Parallax background stays -->
  <div scrollAnimation
    [scrollConfig]="{
      animation: 'parallax',
      speed: 0.4,
      scrub: 1.5
    }">
    Background
  </div>

  <!-- Hero fades out -->
  <div scrollAnimation
    [scrollConfig]="{
      animation: 'custom',
      start: 'top 20%',
      end: 'bottom 60%',
      scrub: 1.2,
      from: { opacity: 1, y: 0 },
      to: { opacity: 0, y: -150 }
    }">
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
  features = [
    'Declarative API',
    'SSR Compatible',
    'Type-Safe',
    'Zero Dependencies',
    'Production Ready'
  ];
}
```

```html
<!-- Staggered Feature Pills -->
<div class="flex flex-wrap gap-3">
  @for (feature of features; track $index) {
    <div viewportAnimation
      [viewportConfig]="{
        animation: 'slideUp',
        duration: 0.5,
        delay: $index * 0.1,
        threshold: 0.2,
        ease: 'power2.out'
      }"
      class="px-4 py-2 bg-slate-800/60 border border-slate-700/50
             rounded-xl text-sm text-slate-200">
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
    <div viewportAnimation
      [viewportConfig]="{
        animation: 'slideUp',
        duration: 0.5,
        delay: $index * 0.1,
        threshold: 0.2
      }"
      class="px-4 py-2 bg-red-500/10 border border-red-500/20
             rounded-full text-sm text-red-300">
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
    { value: '100%', label: 'Type-Safe', description: 'Full TypeScript', colorClass: 'bg-gradient-to-br from-amber-400 to-orange-500' }
  ];
}
```

```html
<!-- Metric Cards with Bounce -->
<div class="grid grid-cols-2 md:grid-cols-4 gap-6">
  @for (metric of metrics; track $index) {
    <div viewportAnimation
      [viewportConfig]="{
        animation: 'slideUp',
        duration: 0.6,
        delay: $index * 0.1,
        ease: 'back.out(1.7)',
        threshold: 0.2
      }"
      class="relative p-6 rounded-2xl bg-slate-800/60
             border border-slate-700/50 backdrop-blur-md">

      <!-- Large gradient number -->
      <div class="text-5xl md:text-6xl font-black mb-2 bg-clip-text text-transparent"
           [ngClass]="metric.colorClass">
        {{ metric.value }}
      </div>

      <!-- Label -->
      <div class="text-base md:text-lg font-bold text-white mb-1">
        {{ metric.label }}
      </div>

      <!-- Description -->
      <div class="text-xs md:text-sm text-gray-400">
        {{ metric.description }}
      </div>

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
    { title: 'Step 5', icon: '⚡', direction: 'left' as const }
  ];

  onStepChange(index: number) {
    this.currentStep.set(index);
  }
}
```

```html
<agsp-hijacked-scroll-timeline
  [scrollHeightPerStep]="900"
  [animationDuration]="0.8"
  [ease]="'power3.inOut'"
  [scrub]="1.5"
  [stepHold]="0.9"
  [showStepIndicator]="false"
  (currentStepChange)="onStepChange($event)">

  @for (step of steps; track step.title; let i = $index) {
    <div hijackedScrollItem
      [slideDirection]="step.direction"
      [fadeIn]="true"
      [scale]="true">

      <!-- Fullscreen slide -->
      <div class="h-screen w-screen flex items-center justify-center
                  bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950">

        <!-- Content -->
        <div class="text-center">
          <!-- Step number -->
          <div class="text-7xl font-black mb-6
                      bg-gradient-to-br from-indigo-400 to-violet-500
                      bg-clip-text text-transparent">
            {{ (i + 1).toString().padStart(2, '0') }}
          </div>

          <!-- Icon -->
          <div class="text-9xl mb-8">{{ step.icon }}</div>

          <!-- Title -->
          <h2 class="text-5xl font-bold text-white mb-4">
            {{ step.title }}
          </h2>

          <!-- Description -->
          <p class="text-xl text-slate-300 max-w-2xl mx-auto">
            Detailed description of this step
          </p>
        </div>

      </div>
    </div>
  }

</agsp-hijacked-scroll-timeline>

<!-- Step Indicator -->
<div class="fixed left-8 top-1/2 -translate-y-1/2 z-50">
  @for (step of steps; track $index) {
    <div class="w-3 h-3 rounded-full mb-4"
         [class.bg-indigo-500]="currentStep() === $index"
         [class.bg-slate-700]="currentStep() !== $index">
    </div>
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
<section class="relative min-h-screen overflow-hidden
                bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950">

  <!-- Ambient Glow Backgrounds (Static) -->
  <div class="absolute inset-0 pointer-events-none">

    <!-- Primary glow (top-left) -->
    <div class="absolute top-1/4 left-1/4
                w-[500px] h-[500px]
                bg-indigo-500/10
                rounded-full blur-[120px]">
    </div>

    <!-- Secondary glow (bottom-right) -->
    <div class="absolute bottom-1/3 right-1/4
                w-[400px] h-[400px]
                bg-purple-500/10
                rounded-full blur-[100px]">
    </div>

    <!-- Tertiary glow (top-right) -->
    <div class="absolute top-1/2 right-1/3
                w-[300px] h-[300px]
                bg-pink-500/8
                rounded-full blur-[80px]">
    </div>

  </div>

  <!-- Content (above glows) -->
  <div class="relative z-10">
    Content here
  </div>

</section>
```

**Animated Glow** (optional scroll-linked):

```html
<!-- Decorative glow that scales/rotates on scroll -->
<div scrollAnimation
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
  class="absolute top-0 left-0 w-full h-full">
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
  <div class="grid grid-cols-1 md:grid-cols-2 gap-12 items-center mb-32"
       [class.md:grid-flow-dense]="step.layout === 'right'">

    <!-- Content Column -->
    <div viewportAnimation
      [viewportConfig]="{
        animation: 'slideUp',
        duration: 0.8,
        threshold: 0.2
      }"
      [class.md:col-start-2]="step.layout === 'right'">

      <!-- Step Number -->
      <div class="flex items-center gap-4 mb-6">
        <span class="text-6xl font-black
                    bg-gradient-to-br from-indigo-400 to-violet-500
                    bg-clip-text text-transparent">
          {{ (i + 1).toString().padStart(2, '0') }}
        </span>
      </div>

      <!-- Title -->
      <h3 class="text-3xl md:text-4xl font-bold text-white mb-4">
        {{ step.title }}
      </h3>

      <!-- Description -->
      <p class="text-lg text-slate-300 mb-6">
        {{ step.description }}
      </p>

    </div>

    <!-- Visual Column -->
    <div scrollAnimation
      [scrollConfig]="{
        animation: 'parallax',
        speed: 0.6,
        scrub: 1.2
      }"
      [class.md:col-start-1]="step.layout === 'right'"
      [class.md:row-start-1]="step.layout === 'right'">

      <div class="relative aspect-square rounded-3xl overflow-hidden
                  bg-slate-800/60 border border-slate-700/50">
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
<div scrollAnimation
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
  class="absolute inset-0 pointer-events-none">

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
    }
  };
}
```

```html
<div scrollAnimation [scrollConfig]="scrollConfig"
     class="fixed top-0 left-0 h-2 bg-indigo-500 origin-left"
     [style.width.%]="progressSignal()">
</div>
```

---

## Pattern 10: Gradient Text Animation

**Use Case**: Headings, emphasis text, CTAs

**Gradient Direction**: `to-r`, `to-b`, `to-br` common

**Description**: Text with animated gradient colors.

**Complete Example**:

```html
<!-- Gradient Text with Entrance Animation -->
<h2 viewportAnimation
  [viewportConfig]="{
    animation: 'slideUp',
    duration: 0.8,
    delay: 0.1,
    threshold: 0.2
  }"
  class="text-4xl md:text-6xl font-bold mb-6">

  <span class="bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400
               bg-clip-text text-transparent">
    Beautiful Gradient Text
  </span>

</h2>
```

**With Multiple Gradient Sections**:

```html
<h1 class="text-5xl md:text-7xl font-bold">
  <span viewportAnimation
    [viewportConfig]="{
      animation: 'slideUp',
      duration: 0.8,
      threshold: 0.1
    }"
    class="block">
    Build
  </span>

  <span viewportAnimation
    [viewportConfig]="{
      animation: 'slideUp',
      duration: 0.8,
      delay: 0.1,
      threshold: 0.1
    }"
    class="block bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400
           bg-clip-text text-transparent">
    Amazing Experiences
  </span>

  <span viewportAnimation
    [viewportConfig]="{
      animation: 'slideUp',
      duration: 0.8,
      delay: 0.2,
      threshold: 0.1
    }"
    class="block text-slate-300">
    With Angular & GSAP
  </span>
</h1>
```

**Animated Gradient** (CSS animation):

```html
<h1 class="text-6xl font-bold">
  <span class="bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400
               bg-clip-text text-transparent
               bg-[length:200%_auto]
               animate-gradient">
    Flowing Gradient
  </span>
</h1>
```

```css
@keyframes gradient {
  0%, 100% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
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
    <div class="absolute top-1/4 left-1/4 w-[500px] h-[500px]
                bg-indigo-500/10 rounded-full blur-[120px]"></div>
  </div>

  <!-- Pattern 2: Parallax Background -->
  <div scrollAnimation
    [scrollConfig]="{ animation: 'parallax', speed: 0.3, scrub: 1.5 }">
    Background image
  </div>

  <!-- Pattern 1: Hero Entrance Stagger -->
  <div class="relative z-10">
    <!-- Badge -->
    <div viewportAnimation
      [viewportConfig]="{ animation: 'scaleIn', duration: 0.6 }">
      Badge
    </div>

    <!-- Pattern 10: Gradient Text -->
    <h1 viewportAnimation
      [viewportConfig]="{ animation: 'slideUp', duration: 0.8, delay: 0.1 }">
      <span class="bg-gradient-to-r from-indigo-400 to-pink-400
                   bg-clip-text text-transparent">
        Hero Title
      </span>
    </h1>
  </div>

  <!-- Pattern 3: Fade Out on Scroll -->
  <div scrollAnimation
    [scrollConfig]="{
      animation: 'custom',
      start: 'top 20%',
      end: 'bottom 60%',
      scrub: 1.2,
      from: { opacity: 1 },
      to: { opacity: 0 }
    }">
    Content that fades
  </div>

</section>

<!-- Pattern 5: Metric Cards -->
<section>
  <div class="grid grid-cols-4 gap-6">
    @for (metric of metrics; track $index) {
      <div viewportAnimation
        [viewportConfig]="{
          animation: 'slideUp',
          delay: $index * 0.1,
          ease: 'back.out(1.7)'
        }">
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
