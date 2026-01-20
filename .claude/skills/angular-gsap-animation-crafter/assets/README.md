# GSAP Animation Templates

Ready-to-use Angular components for common scroll animation patterns. Each template is production-ready and documented with customization points.

## Organization

Templates are organized by scope:

- **pages/** - Complete page layouts with multiple sections
- **sections/** - Individual sections that can be combined

---

## Page Templates

### Fullpage Showcase

**[pages/fullpage-showcase.component.ts](pages/fullpage-showcase.component.ts)**

- HijackedScrollContainer for smooth fullpage transitions
- 5 complete sections (hero, features, stats, CTA)
- Progress indicators synced to scroll position
- ViewportAnimations for content reveals
- Mobile-friendly touch gestures

**Best for:** Product showcases, feature pages, portfolio sites

---

## Section Templates

### Parallax Hero

**[sections/parallax-hero.component.ts](sections/parallax-hero.component.ts)**

- Multiple parallax layers at different scroll speeds
- Floating decorative elements
- Staggered content entrance animations
- Smooth fade-out as user scrolls
- Scroll indicator animation

**Best for:** Landing page heroes, portfolio headers, immersive intros

---

### Split Panel Timeline

**[sections/split-panel-timeline.component.ts](sections/split-panel-timeline.component.ts)**

- Pinned left panel with progress indicator
- Right panel scrolls through timeline items
- Progress tracking synced to scroll position
- Content reveals on each step

**Best for:** About pages, history/timeline, feature comparisons

---

### Feature Showcase Cards

**[sections/feature-showcase-cards.component.ts](sections/feature-showcase-cards.component.ts)**

- Grid of feature cards with staggered entrance
- Hover interactions with scale and glow effects
- Icon animations on viewport entry
- Responsive grid layout
- Subtle parallax on scroll

**Best for:** Feature sections, services pages, product benefits

---

## Usage

### Using a Page Template

1. **Copy the template** into your project
2. **Rename** the component selector and class
3. **Customize** section content, colors, and timing
4. **Add/remove sections** as needed

### Using Section Templates

1. **Select sections** that match your needs
2. **Copy each template** into your project
3. **Combine in a parent component** or routing
4. **Customize** each section independently

### Combining Sections

```typescript
import { Component } from '@angular/core';
import { ParallaxHeroComponent } from './sections/parallax-hero.component';
import { SplitPanelTimelineComponent } from './sections/split-panel-timeline.component';
import { FeatureShowcaseCardsComponent } from './sections/feature-showcase-cards.component';

@Component({
  selector: 'app-landing-page',
  standalone: true,
  imports: [ParallaxHeroComponent, SplitPanelTimelineComponent, FeatureShowcaseCardsComponent],
  template: `
    <app-parallax-hero />
    <app-feature-showcase-cards />
    <app-split-panel-timeline />
  `,
})
export class LandingPageComponent {}
```

---

## Customization Points

Each template file includes detailed comments explaining:

- Animation type and best use cases
- Key features used
- Customization points (timing, colors, easing, layout)
- Configuration examples

Look for these comment patterns:

```typescript
/**
 * Customization Points:
 * - Duration: Change transition speed
 * - Easing: Modify animation feel
 * - Colors: Update to match brand
 */
```
