---
name: Kinetic Operator
colors:
  surface: '#0c141f'
  surface-dim: '#0c141f'
  surface-bright: '#323946'
  surface-container-lowest: '#070e1a'
  surface-container-low: '#151c27'
  surface-container: '#19202c'
  surface-container-high: '#232a36'
  surface-container-highest: '#2e3542'
  on-surface: '#dce2f3'
  on-surface-variant: '#d7c3ae'
  inverse-surface: '#dce2f3'
  inverse-on-surface: '#2a313d'
  outline: '#9f8e7a'
  outline-variant: '#524434'
  surface-tint: '#ffb957'
  primary: '#ffc77f'
  on-primary: '#462b00'
  primary-container: '#f5a524'
  on-primary-container: '#643f00'
  inverse-primary: '#835400'
  secondary: '#7bd0ff'
  on-secondary: '#00354a'
  secondary-container: '#00a6e0'
  on-secondary-container: '#00374d'
  tertiary: '#9ad9ff'
  on-tertiary: '#003549'
  tertiary-container: '#36c2ff'
  on-tertiary-container: '#004d69'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#ffddb5'
  primary-fixed-dim: '#ffb957'
  on-primary-fixed: '#2a1800'
  on-primary-fixed-variant: '#643f00'
  secondary-fixed: '#c4e7ff'
  secondary-fixed-dim: '#7bd0ff'
  on-secondary-fixed: '#001e2c'
  on-secondary-fixed-variant: '#004c69'
  tertiary-fixed: '#c4e7ff'
  tertiary-fixed-dim: '#7bd0ff'
  on-tertiary-fixed: '#001e2c'
  on-tertiary-fixed-variant: '#004c69'
  background: '#0c141f'
  on-background: '#dce2f3'
  surface-variant: '#2e3542'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: '1.2'
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.3'
  title-sm:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '600'
    lineHeight: '1.4'
  body-base:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.6'
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: '1.5'
  code-sm:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '450'
    lineHeight: '1.6'
  label-caps:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '600'
    lineHeight: '1'
    letterSpacing: 0.08em
  numeric-data:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: '500'
    lineHeight: '1'
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  unit: 4px
  container-padding: 24px
  gutter: 16px
  stack-tight: 8px
  stack-loose: 32px
---

## Brand & Style

The design system is engineered for high-performance software practitioners. The brand personality is precise, technical, and authoritative, evoking the feeling of a premium physical workstation or a high-end IDE.

The aesthetic leans into **Minimalism** with a **Technical** edge—utilizing deep obsidian surfaces, hairline borders, and strict grid alignment to create a "command center" atmosphere. Visual clutter is eliminated in favor of high information density and structural clarity. The user should feel like an "operator" in a high-stakes environment where every pixel serves a functional purpose.

## Colors

The palette is built on a "Obsidian & Amber" foundation. To maintain a premium feel, pure black (#000000) is avoided. Instead, layers of deep navy-greys create a sense of physical depth.

- **Brand Primary (Amber):** Reserved for primary calls to action, active selection states, and brand-defining moments.
- **Surface Tiers:** Page backgrounds are darkest (#0b0d12). Raised containers use #161a23, and interactive or floating elements use #232936.
- **Warning Distinction:** While the brand is Amber (#f5a524), system warnings use a more traditional Yellow (#eab308) to ensure semantic clarity and prevent confusion with branded UI elements.
- **Borders:** Every panel transition must be defined by a 1px hairline border (#2c3342) to maintain technical precision.

## Typography

The typographic system prioritizes legibility in data-dense environments.

- **Inter** is the primary workhorse for interface labels and prose, providing a neutral, modern clarity.
- **JetBrains Mono** is utilized for all code snippets, technical metadata, and numeric values to enhance scanability and reinforce the developer-centric narrative.
- **Hierarchy:** Use `label-caps` for section headers and table column titles to create clear structural anchors. High-contrast levels (Text Primary vs Text Muted) should be used aggressively to guide the eye through dense data.

## Layout & Spacing

This design system utilizes a **Fixed Grid** philosophy for dashboard views, transitioning to a fluid model for content-heavy pages.

- **Grid:** A 12-column grid with 16px gutters is standard for desktop.
- **Density:** Spacing is compact. A 4px base unit ensures that elements are tightly packed but aligned.
- **Breakpoints:**
  - Mobile (<768px): Single column, 16px margins.
  - Tablet (768px - 1280px): Fluid columns, 24px margins.
  - Desktop (>1280px): Max-width 1440px, centered.

## Elevation & Depth

Depth is communicated through **Tonal Layers** and **Hairline Outlines** rather than heavy shadows.

- **Layer 0 (Background):** #0b0d12.
- **Layer 1 (Cards/Panels):** #161a23 with a 1px #2c3342 border.
- **Layer 2 (Modals/Popovers):** #232936 with a 1px #2c3342 border and a subtle, high-spread shadow (0px 8px 24px rgba(0,0,0,0.5)).
- **Interactivity:** On hover, raised surfaces can subtly lighten or the border color can shift to the Primary Amber at 20% opacity to signal focus.

## Shapes

The shape language is "Calculated Softness." While the overall system feels rigid and technical, strategic rounding prevents it from feeling hostile.

- **Panels/Cards:** 12px rounding creates a modern, contained look.
- **Buttons/Inputs:** 8px rounding provides a distinct "tooling" feel that separates interactive elements from structural containers.
- **Badges/Chips:** Full pill-shaping (999px) is used to distinguish metadata tags from buttons and inputs.

## Components

- **Buttons:**
  - _Primary:_ Amber #f5a524 background, dark text, 8px radius. Hover state: #ffbb4d.
  - _Secondary:_ Transparent background, #2c3342 border, primary text.
- **Input Fields:** #161a23 background, #2c3342 border. Focus state: #f5a524 border with 0px 0px 0px 2px rgba(245, 165, 36, 0.2) glow.
- **Data Tables:** High density. Row borders only (no vertical lines). Header row uses `label-caps` typography with #2c3342 bottom border.
- **Status Indicators:** Small 8px circles or pill-shaped badges using semantic colors (Success, Error, etc.).
- **Code Blocks:** #0b0d12 background, 8px radius, JetBrains Mono text. Include a "Copy" button in the top right corner using the Elevated Surface color.
- **Cards:** 12px radius, #161a23 background, #2c3342 border. Titles should be `title-sm`.
