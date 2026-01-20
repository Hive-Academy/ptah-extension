# Design System Builder - Create Your Visual Language

## Purpose

Transform your aesthetic profile into a complete, implementable design system. This guide walks you through building every token and pattern you need.

---

## Design System Structure

```
your-design-system/
├── 1. Foundation (colors, typography, spacing)
├── 2. Effects (shadows, gradients, animations)
├── 3. Components (buttons, cards, inputs)
├── 4. Patterns (layouts, sections, navigation)
└── 5. Motion (transitions, keyframes, 3D)
```

---

## Step 1: Color System

### Background Colors

Define your surface hierarchy (3-5 levels):

```css
/* Light Mode Example */
--bg-primary: #ffffff; /* Main background */
--bg-secondary: #f9fafb; /* Alternate sections */
--bg-tertiary: #f3f4f6; /* Cards, elevated surfaces */
--bg-elevated: #ffffff; /* Modals, dropdowns */

/* Dark Mode Example (Ptah Style) */
--bg-primary: #0a0a0a; /* Obsidian - main background */
--bg-secondary: #1a1a1a; /* Charcoal - cards, panels */
--bg-tertiary: #2a2a2a; /* Smoke - elevated surfaces */
--bg-elevated: #1a1a1a; /* Modals with blur */
```

### Text Colors

Define hierarchy with contrast ratios:

```css
/* Light Mode */
--text-primary: #1f2937; /* Main text - 15.3:1 on white */
--text-secondary: #6b7280; /* Muted text - 5.8:1 */
--text-tertiary: #9ca3af; /* Hints, placeholders - 3.0:1 */

/* Dark Mode (Ptah Style) */
--text-primary: #f5f5dc; /* Cream - 15.2:1 on obsidian */
--text-secondary: #c4b998; /* Sand - 6.1:1 */
--text-tertiary: #8a8a8a; /* Stone - 4.6:1 */
```

### Accent Colors

Your signature color(s):

```css
/* Single Accent */
--accent-primary: #6366f1; /* Indigo */
--accent-primary-hover: #4f46e5; /* Darker on hover */
--accent-primary-glow: rgba(99, 102, 241, 0.4);

/* Gold Spectrum (Ptah Style) */
--gold: #d4af37; /* Primary accent */
--gold-light: #f4d47c; /* Highlights */
--gold-dark: #9a7b2c; /* Shadows, borders */
--gold-glow: rgba(212, 175, 55, 0.4);

/* Semantic Colors */
--success: #22c55e; /* Green */
--warning: #f59e0b; /* Amber */
--error: #ef4444; /* Red */
--info: #3b82f6; /* Blue */
```

### Contrast Validation Checklist

| Combination                      | Minimum Ratio | Target           |
| -------------------------------- | ------------- | ---------------- |
| Body text on background          | 4.5:1         | 7:1+ (AAA)       |
| Large text (18px+) on background | 3:1           | 4.5:1+           |
| UI components                    | 3:1           | 4.5:1+           |
| Focus indicators                 | 3:1           | Clear visibility |

**Tool**: Use [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/)

---

## Step 2: Typography System

### Font Selection

```css
:root {
  /* Display Font - Headlines */
  --font-display: 'Your Display Font', serif;
  /* Examples: Cinzel, Playfair Display, DM Serif */

  /* Body Font - Text */
  --font-body: 'Your Body Font', system-ui, sans-serif;
  /* Examples: Inter, Plus Jakarta Sans, DM Sans */

  /* Mono Font - Code */
  --font-mono: 'Your Mono Font', monospace;
  /* Examples: JetBrains Mono, Fira Code, SF Mono */
}
```

### Type Scale

Define your size hierarchy:

```css
/* Modular Scale (1.25 ratio) */
--text-xs: 0.75rem; /* 12px - Labels, badges */
--text-sm: 0.875rem; /* 14px - Captions, meta */
--text-base: 1rem; /* 16px - Body text */
--text-lg: 1.125rem; /* 18px - Lead paragraphs */
--text-xl: 1.25rem; /* 20px - Subheadings */
--text-2xl: 1.5rem; /* 24px - Card titles */
--text-3xl: 1.875rem; /* 30px - Section subheads */
--text-4xl: 2.25rem; /* 36px - Section heads */
--text-5xl: 3rem; /* 48px - Page titles */
--text-6xl: 3.75rem; /* 60px - Hero (tablet) */
--text-7xl: 4.5rem; /* 72px - Hero (desktop) */
--text-8xl: 6rem; /* 96px - Display (large screens) */
```

### Line Heights

```css
--leading-none: 1; /* Display headlines */
--leading-tight: 1.1; /* Headlines */
--leading-snug: 1.3; /* Subheadings */
--leading-normal: 1.5; /* UI text */
--leading-relaxed: 1.6; /* Body text */
--leading-loose: 1.75; /* Long-form content */
```

### Font Weights

```css
--font-normal: 400;
--font-medium: 500;
--font-semibold: 600;
--font-bold: 700;
```

### Typography Combinations

| Element | Size      | Weight   | Line Height | Font    |
| ------- | --------- | -------- | ----------- | ------- |
| Display | text-7xl+ | bold     | 1.0-1.1     | display |
| H1      | text-5xl  | bold     | 1.1         | display |
| H2      | text-4xl  | bold     | 1.2         | display |
| H3      | text-2xl  | semibold | 1.3         | body    |
| H4      | text-xl   | semibold | 1.4         | body    |
| Body    | text-base | normal   | 1.6         | body    |
| Small   | text-sm   | normal   | 1.5         | body    |
| Label   | text-xs   | medium   | 1.4         | body    |

---

## Step 3: Spacing System

### Base Unit

Use an 8px grid system:

```css
--space-0: 0;
--space-1: 0.25rem; /* 4px */
--space-2: 0.5rem; /* 8px */
--space-3: 0.75rem; /* 12px */
--space-4: 1rem; /* 16px */
--space-5: 1.25rem; /* 20px */
--space-6: 1.5rem; /* 24px */
--space-8: 2rem; /* 32px */
--space-10: 2.5rem; /* 40px */
--space-12: 3rem; /* 48px */
--space-16: 4rem; /* 64px */
--space-20: 5rem; /* 80px */
--space-24: 6rem; /* 96px */
--space-32: 8rem; /* 128px */
```

### Semantic Spacing

```css
/* Section spacing */
--section-gap: 8rem; /* Between sections (128px) */
--section-padding: 6rem; /* Within sections (96px) */

/* Component spacing */
--card-gap: 2rem; /* Between cards (32px) */
--card-padding: 2rem; /* Inside cards (32px) */

/* Element spacing */
--element-gap: 1.5rem; /* Between elements (24px) */
--text-gap: 1rem; /* Between text blocks (16px) */

/* Container widths */
--container-sm: 640px;
--container-md: 768px;
--container-lg: 1024px;
--container-xl: 1280px;
--container-2xl: 1536px;
```

---

## Step 4: Effects System

### Shadows

```css
/* Elevation shadows */
--shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
--shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
--shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
--shadow-xl: 0 20px 25px -5px rgba(0, 0, 0, 0.1);

/* Glow shadows (for dark themes) */
--glow-sm: 0 0 20px var(--accent-glow);
--glow-md: 0 0 40px var(--accent-glow);
--glow-lg: 0 0 60px var(--accent-glow);

/* Card shadows */
--shadow-card: 0 4px 32px rgba(0, 0, 0, 0.04);
--shadow-card-hover: 0 8px 48px rgba(0, 0, 0, 0.08);
```

### Border Radius

```css
--radius-sm: 0.25rem; /* 4px - Buttons, inputs */
--radius-md: 0.5rem; /* 8px - Cards, panels */
--radius-lg: 1rem; /* 16px - Large cards */
--radius-xl: 1.5rem; /* 24px - Modals */
--radius-full: 9999px; /* Circles, pills */
```

### Gradients

```css
/* Background gradients */
--gradient-hero: radial-gradient(ellipse at 50% 70%, var(--accent-glow) 0%, var(--bg-secondary) 50%, var(--bg-primary) 100%);

/* Text gradients */
--gradient-text: linear-gradient(135deg, var(--accent-light) 0%, var(--accent) 50%, var(--accent-dark) 100%);

/* Button gradients */
--gradient-button: linear-gradient(135deg, var(--accent) 0%, var(--accent-dark) 100%);
```

### Glassmorphism (optional)

```css
.glass {
  background: rgba(26, 26, 26, 0.6);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.1);
}
```

---

## Step 5: Animation System

### Timing

```css
--duration-fast: 150ms;
--duration-normal: 300ms;
--duration-slow: 500ms;
--duration-slower: 800ms;
```

### Easing

```css
--ease-default: cubic-bezier(0.4, 0, 0.2, 1);
--ease-in: cubic-bezier(0.4, 0, 1, 1);
--ease-out: cubic-bezier(0, 0, 0.2, 1);
--ease-bounce: cubic-bezier(0.68, -0.55, 0.265, 1.55);
```

### Keyframes

```css
@keyframes fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes slide-up {
  from {
    opacity: 0;
    transform: translateY(20px);
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

@keyframes glow-pulse {
  0%,
  100% {
    box-shadow: var(--glow-sm);
  }
  50% {
    box-shadow: var(--glow-md);
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
```

---

## Step 6: Component Patterns

### Buttons

```yaml
primary:
  height: 48px (medium) / 64px (large)
  padding: 0 2rem
  background: var(--accent) or var(--gradient-button)
  color: white
  border-radius: var(--radius-sm)
  font-weight: 600
  transition: all var(--duration-normal) var(--ease-default)
  hover:
    transform: scale(1.02)
    box-shadow: var(--glow-sm)

secondary:
  height: 48px
  padding: 0 1.5rem
  background: transparent
  border: 1px solid var(--accent)
  color: var(--accent)
  hover:
    background: rgba(accent, 0.1)

ghost:
  padding: 0.5rem 1rem
  background: transparent
  color: var(--text-primary)
  hover:
    color: var(--accent)
```

### Cards

```yaml
feature-card:
  background: var(--bg-secondary)
  border: 1px solid var(--border-subtle)
  border-radius: var(--radius-lg)
  padding: var(--card-padding)
  shadow: var(--shadow-card)
  transition: all var(--duration-normal) var(--ease-default)
  hover:
    transform: translateY(-4px)
    border-color: var(--accent)
    shadow: var(--shadow-card-hover)
```

### Inputs

```yaml
text-input:
  height: 48px
  padding: 0 1rem
  background: var(--bg-tertiary)
  border: 1px solid var(--border-subtle)
  border-radius: var(--radius-sm)
  color: var(--text-primary)
  focus:
    border-color: var(--accent)
    outline: 2px solid var(--accent-glow)
    outline-offset: 2px
```

---

## Step 7: Responsive Breakpoints

```css
/* Mobile first */
--bp-sm: 640px; /* Mobile landscape */
--bp-md: 768px; /* Tablet */
--bp-lg: 1024px; /* Laptop */
--bp-xl: 1280px; /* Desktop */
--bp-2xl: 1536px; /* Large desktop */
```

### Responsive Patterns

```yaml
typography:
  mobile: text-4xl → tablet: text-6xl → desktop: text-7xl

section-padding:
  mobile: py-16 → tablet: py-24 → desktop: py-32

grid:
  mobile: 1 column → tablet: 2 columns → desktop: 3 columns
```

---

## Output Template

Save your design system:

```markdown
# [Brand Name] Design System

## Overview

- **Aesthetic**: [Your aesthetic name]
- **Mood**: [Light/Dark]
- **Primary Accent**: [Color]
- **Display Font**: [Font name]

## Color Tokens

[All color variables]

## Typography

[Font stack and scale]

## Spacing

[8px grid values]

## Effects

[Shadows, gradients, animations]

## Components

[Button, card, input patterns]

## Accessibility

[Contrast ratios, motion preferences]
```

---

## Validation Checklist

Before finalizing your design system:

- [ ] All color combinations meet WCAG AA contrast (4.5:1)
- [ ] Typography scale is consistent (modular ratio)
- [ ] Spacing follows 8px grid
- [ ] All interactive elements have hover/focus states
- [ ] Animations respect `prefers-reduced-motion`
- [ ] Components work on all breakpoints
- [ ] Design tokens are named semantically
- [ ] Documentation is complete
