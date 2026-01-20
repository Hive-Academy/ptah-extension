# Ptah Design System Reference

## Purpose

This file defines the visual design system used across all content generation. All content must align with these specifications for consistency.

---

## Brand Identity

### Name & Positioning

- **Name**: Ptah (Egyptian god of craftsmen and creation)
- **Tagline**: "VS Code AI Development, Powered by Claude Code"
- **Personality**: Ancient wisdom meets modern technology

### Visual Theme

- **Style**: Egyptian sacred tech / Neo-mystical
- **Inspiration**: BlueYard Capital (nano banana), Augmentcode, Antigravity
- **Mood**: Premium, powerful, mystical but accessible

---

## Color System

### Primary Palette

```css
:root {
  /* Backgrounds */
  --obsidian: #0a0a0a; /* Darkest, page bg */
  --charcoal: #1a1a1a; /* Cards, panels */
  --smoke: #2a2a2a; /* Elevated surfaces */

  /* Gold spectrum */
  --gold: #d4af37; /* Primary accent */
  --gold-light: #f4d47c; /* Highlights */
  --gold-dark: #9a7b2c; /* Shadows, borders */
  --gold-glow: rgba(212, 175, 55, 0.4); /* Glow effects */

  /* Text */
  --cream: #f5f5dc; /* Primary text */
  --sand: #c4b998; /* Secondary text */
  --stone: #8a8a8a; /* Muted text */

  /* Accents */
  --scarab-teal: #2dd4bf; /* Success states */
  --papyrus-red: #ef4444; /* Error/danger */
  --lapis-blue: #3b82f6; /* Info/links */
}
```

### Gradient Definitions

```css
/* Hero background gradient */
.gradient-hero {
  background: radial-gradient(ellipse at 50% 70%, rgba(212, 175, 55, 0.15) 0%, rgba(26, 26, 26, 1) 50%, rgba(10, 10, 10, 1) 100%);
}

/* Gold text gradient */
.gradient-gold-text {
  background: linear-gradient(135deg, var(--gold-light) 0%, var(--gold) 50%, var(--gold-dark) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

/* Button gradient */
.gradient-button {
  background: linear-gradient(135deg, var(--gold) 0%, var(--gold-dark) 100%);
}

/* Card border gradient */
.gradient-border {
  background: linear-gradient(135deg, var(--gold) 0%, transparent 50%, var(--gold) 100%);
}
```

---

## Typography

### Font Stack

```css
:root {
  --font-display: 'Cinzel', 'Cinzel Decorative', serif;
  --font-body: 'Inter', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
}
```

### Type Scale

| Token        | Size            | Line Height | Letter Spacing | Usage                   |
| ------------ | --------------- | ----------- | -------------- | ----------------------- |
| `display-xl` | 8rem (128px)    | 0.95        | -0.04em        | Hero headline (desktop) |
| `display-lg` | 6rem (96px)     | 1.0         | -0.03em        | Hero headline (tablet)  |
| `display-md` | 4.5rem (72px)   | 1.1         | -0.02em        | Hero headline (mobile)  |
| `heading-1`  | 3.75rem (60px)  | 1.1         | -0.02em        | Section headlines       |
| `heading-2`  | 3rem (48px)     | 1.15        | -0.015em       | Subsection headlines    |
| `heading-3`  | 2.25rem (36px)  | 1.2         | -0.01em        | Card headlines          |
| `heading-4`  | 1.5rem (24px)   | 1.3         | 0              | Feature titles          |
| `body-lg`    | 1.25rem (20px)  | 1.6         | 0              | Lead paragraphs         |
| `body`       | 1rem (16px)     | 1.7         | 0              | Body text               |
| `body-sm`    | 0.875rem (14px) | 1.5         | 0              | Captions, meta          |
| `label`      | 0.75rem (12px)  | 1.4         | 0.1em          | Labels, badges          |

### Tailwind Classes

```
Hero headline:    text-5xl md:text-7xl lg:text-8xl font-display
Section headline: text-4xl md:text-5xl lg:text-6xl font-display
Card headline:    text-xl md:text-2xl font-body font-semibold
Body:            text-base md:text-lg font-body
Label:           text-xs uppercase tracking-widest font-body
```

---

## Spacing System

### Vertical Rhythm

```css
/* Section spacing */
--section-gap: 8rem; /* 128px between sections */
--section-padding: 6rem; /* 96px padding within sections */

/* Component spacing */
--card-gap: 3rem; /* 48px between cards */
--element-gap: 1.5rem; /* 24px between elements */
--text-gap: 1rem; /* 16px between text blocks */
```

### Container Widths

```css
--container-sm: 640px; /* Narrow content */
--container-md: 768px; /* Default content */
--container-lg: 1024px; /* Wide content */
--container-xl: 1280px; /* Full-width features */
--container-2xl: 1536px; /* Maximum width */
```

---

## Effects & Animations

### Shadow System

```css
/* Elevation shadows */
--shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
--shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
--shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
--shadow-xl: 0 20px 25px -5px rgba(0, 0, 0, 0.1);

/* Glow shadows */
--glow-gold-sm: 0 0 20px rgba(212, 175, 55, 0.2);
--glow-gold-md: 0 0 40px rgba(212, 175, 55, 0.3);
--glow-gold-lg: 0 0 60px rgba(212, 175, 55, 0.4);
--glow-gold-xl: 0 0 100px rgba(212, 175, 55, 0.5);
```

### Glassmorphism

```css
.glass {
  background: rgba(26, 26, 26, 0.6);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(212, 175, 55, 0.1);
}

.glass-card {
  background: rgba(26, 26, 26, 0.8);
  backdrop-filter: blur(12px);
  border-radius: 1rem;
  border: 1px solid rgba(255, 255, 255, 0.05);
}
```

### Animation Timing

```css
/* Durations */
--duration-fast: 150ms;
--duration-normal: 300ms;
--duration-slow: 500ms;
--duration-slower: 800ms;

/* Easings */
--ease-default: cubic-bezier(0.4, 0, 0.2, 1);
--ease-in: cubic-bezier(0.4, 0, 1, 1);
--ease-out: cubic-bezier(0, 0, 0.2, 1);
--ease-bounce: cubic-bezier(0.68, -0.55, 0.265, 1.55);
--ease-smooth: cubic-bezier(0.25, 0.1, 0.25, 1);
```

### Keyframe Animations

```css
@keyframes glow-pulse {
  0%,
  100% {
    box-shadow: 0 0 20px rgba(212, 175, 55, 0.2);
  }
  50% {
    box-shadow: 0 0 40px rgba(212, 175, 55, 0.4);
  }
}

@keyframes float {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-10px);
  }
}

@keyframes reveal-up {
  from {
    opacity: 0;
    transform: translateY(60px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes scale-in {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes draw-line {
  from {
    stroke-dashoffset: 1000;
  }
  to {
    stroke-dashoffset: 0;
  }
}
```

---

## Component Patterns

### Buttons

```yaml
primary:
  height: 64px (large) / 48px (medium) / 36px (small)
  padding: 0 2rem
  background: gradient-button
  border-radius: 0.5rem
  font: font-body, font-semibold
  text: --cream
  shadow: --glow-gold-sm
  hover:
    scale: 1.05
    shadow: --glow-gold-md
  active:
    scale: 0.98

secondary:
  height: 48px / 36px
  padding: 0 1.5rem
  background: transparent
  border: 1px solid var(--gold)
  text: --gold
  hover:
    background: rgba(212, 175, 55, 0.1)

ghost:
  padding: 0.5rem 1rem
  background: transparent
  text: --cream
  hover:
    text: --gold
```

### Cards

```yaml
feature-card:
  background: --charcoal with glass effect
  border: 1px solid rgba(212, 175, 55, 0.1)
  border-radius: 1.5rem
  padding: 2rem
  min-height: 400px
  hover:
    transform: translateY(-8px) rotate(1deg)
    border-color: var(--gold)
    shadow: --glow-gold-lg

comparison-card-before:
  background: --charcoal
  border: 1px solid rgba(255, 255, 255, 0.1)
  filter: grayscale(0.3)
  icon-color: --papyrus-red

comparison-card-after:
  background: --charcoal
  border: 2px solid var(--gold)
  shadow: --glow-gold-lg
  icon-color: --scarab-teal
```

### Icons

```yaml
style:
  stroke-width: 1.5
  default-size: 24px
  color: --cream (default) / --gold (active)

large-icon-container:
  size: 80px
  background: radial-gradient(circle, var(--gold-glow), transparent)
  icon-size: 48px
```

---

## Three.js 3D Elements

### Hero Scene Options

```yaml
ankh-sphere:
  geometry: SphereGeometry with Ankh texture overlay
  material: MeshStandardMaterial
    metalness: 1.0
    roughness: 0.2
    color: --gold
  effects:
    - UnrealBloomPass (threshold: 0.5, strength: 1.5)
    - Particle halo (THREE.Points)
  animation:
    - Mouse parallax (subtle)
    - Slow rotation (0.001 rad/frame)

pyramid-scene:
  geometry: ConeGeometry / Custom pyramid mesh
  material: MeshStandardMaterial with wireframe
    color: --gold
    wireframe: true
  effects:
    - Energy apex glow
    - Particles flowing upward
  lighting:
    - PointLight at apex (gold)
    - AmbientLight (dim white)

particle-halo:
  geometry: BufferGeometry with random positions
  material: PointsMaterial
    size: 2
    color: --gold
    transparent: true
    opacity: 0.6
  animation:
    - Radial expansion
    - Opacity pulsing
```

---

## GSAP Animation Patterns

### ScrollTrigger Defaults

```javascript
const scrollDefaults = {
  trigger: element,
  start: 'top 85%',
  toggleActions: 'play none none reverse',
};
```

### Common Animations

```javascript
// Reveal from below
gsap.from(element, {
  scrollTrigger: scrollDefaults,
  opacity: 0,
  y: 60,
  duration: 0.8,
  ease: 'power3.out',
});

// Scale in
gsap.from(element, {
  scrollTrigger: scrollDefaults,
  opacity: 0,
  scale: 0.95,
  duration: 0.6,
  ease: 'power2.out',
});

// Stagger children
gsap.from(children, {
  scrollTrigger: { trigger: parent, start: 'top 85%' },
  opacity: 0,
  y: 40,
  duration: 0.6,
  stagger: 0.15,
  ease: 'power3.out',
});
```

---

## Responsive Breakpoints

```css
/* Tailwind defaults */
sm: 640px    /* Mobile landscape */
md: 768px    /* Tablet */
lg: 1024px   /* Laptop */
xl: 1280px   /* Desktop */
2xl: 1536px  /* Large desktop */
```

### Mobile-First Patterns

```yaml
hero-headline:
  mobile: text-4xl to text-5xl
  tablet: text-6xl to text-7xl
  desktop: text-7xl to text-8xl

section-padding:
  mobile: py-16 (64px)
  tablet: py-24 (96px)
  desktop: py-32 (128px)

card-grid:
  mobile: 1 column
  tablet: 2 columns
  desktop: 3 columns
```

---

## Accessibility

### Motion Preferences

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

### Color Contrast

| Combination           | Ratio  | Status          |
| --------------------- | ------ | --------------- |
| --cream on --obsidian | 15.2:1 | AAA             |
| --gold on --obsidian  | 7.8:1  | AAA             |
| --sand on --charcoal  | 6.1:1  | AA              |
| --stone on --charcoal | 4.6:1  | AA (large text) |

### Focus States

```css
:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 2px;
}
```

---

## Usage in Content Generation

When generating content, always reference:

1. **Colors**: Use token names (--gold) not hex values in copy
2. **Typography**: Specify which level for each text element
3. **Spacing**: Use system values for consistency
4. **Animations**: Reference named patterns
5. **Components**: Use defined variants

### Example Content Spec

```yaml
hero:
  headline:
    text: 'VS Code AI, Enlightened'
    style: display-lg (mobile) → display-xl (desktop)
    color: gradient-gold-text
    animation: reveal-up, delay 900ms

  cta:
    text: 'Begin the Journey'
    variant: primary
    size: large
    animation: bounce-in, delay 1200ms
```
