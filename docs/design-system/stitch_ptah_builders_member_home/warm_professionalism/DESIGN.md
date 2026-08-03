---
name: Warm Professionalism
colors:
  surface: '#faf8ff'
  surface-dim: '#d9d9e2'
  surface-bright: '#faf8ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f3fb'
  surface-container: '#ededf6'
  surface-container-high: '#e7e7f0'
  surface-container-highest: '#e2e2ea'
  on-surface: '#191b21'
  on-surface-variant: '#534435'
  inverse-surface: '#2e3037'
  inverse-on-surface: '#f0f0f9'
  outline: '#857463'
  outline-variant: '#d8c3b0'
  surface-tint: '#875200'
  primary: '#845000'
  on-primary: '#ffffff'
  primary-container: '#a66600'
  on-primary-container: '#fffbff'
  inverse-primary: '#ffb866'
  secondary: '#835400'
  on-secondary: '#ffffff'
  secondary-container: '#ffad2e'
  on-secondary-container: '#6c4400'
  tertiary: '#00628d'
  on-tertiary: '#ffffff'
  tertiary-container: '#007cb1'
  on-tertiary-container: '#fcfcff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#ffddba'
  primary-fixed-dim: '#ffb866'
  on-primary-fixed: '#2b1700'
  on-primary-fixed-variant: '#673d00'
  secondary-fixed: '#ffddb5'
  secondary-fixed-dim: '#ffb957'
  on-secondary-fixed: '#2a1800'
  on-secondary-fixed-variant: '#643f00'
  tertiary-fixed: '#c8e6ff'
  tertiary-fixed-dim: '#88ceff'
  on-tertiary-fixed: '#001e2f'
  on-tertiary-fixed-variant: '#004c6e'
  background: '#faf8ff'
  on-background: '#191b21'
  surface-variant: '#e2e2ea'
typography:
  headline-lg:
    fontFamily: Inter
    fontSize: 48px
    fontWeight: '700'
    lineHeight: '1.1'
    letterSpacing: -0.02em
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: '1.2'
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.3'
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: '1.6'
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.5'
  label-mono:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: '500'
    lineHeight: '1.4'
    letterSpacing: 0.02em
  caption:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '500'
    lineHeight: '1.4'
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  unit: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 48px
  gutter: 24px
  margin: 32px
  max_width: 1280px
---

## Brand & Style

This design system utilizes a refined, **Minimalist** aesthetic with a warm, organic undertone. It is designed for high-end SaaS or professional tools where clarity and focus are paramount. The style prioritizes exceptional legibility, generous whitespace, and a sophisticated "paper-like" depth. By moving away from stark whites and harsh blacks in favor of a curated cream and charcoal palette, the UI reduces eye strain and establishes a premium, trustworthy atmosphere.

## Colors

The palette is built on a foundation of warm neutrals to create a tactile, high-quality feel.

- **Brand Accent:** Use `#c97e0e` for primary actions and key highlights. Its deep saturation ensures accessibility on the light cream background.
- **Surface Hierarchy:** The `#faf9f7` page background serves as the lowest layer. Cards and containers use `#ffffff` (raised) or `#f2f0ec` (elevated) to establish visual structure.
- **Borders:** Use the `#e2ddd4` hairline border for subtle containment without introducing heavy visual noise.

## Typography

This design system pairs the systematic clarity of **Inter** for all UI and prose with the technical precision of **JetBrains Mono** for data and labels.

- **Headlines:** Use tight tracking and bold weights for a modern, editorial feel.
- **Labels:** Use JetBrains Mono for metadata, status tags, and technical inputs to differentiate them from narrative text.
- **Contrast:** Ensure all text color follows the primary/muted definitions to maintain a clear hierarchy of information.

## Layout & Spacing

The layout follows a **Fluid Grid** model with strict 4px increments.

- **Desktop:** 12-column grid with a 1280px max-width container. Gutters are fixed at 24px.
- **Mobile:** Single column with 16px side margins.
- **Rhythm:** Use `md` (16px) for standard component internal padding and `lg` (24px) for spacing between logical sections.

## Elevation & Depth

Depth is achieved through **Tonal Layering** and soft, ambient shadows.

- **Level 0 (Base):** Page background `#faf9f7`.
- **Level 1 (Raised):** Surface `#ffffff` with a subtle `1px` border of `#e2ddd4`.
- **Level 2 (Floating):** Surface `#ffffff` with a soft, diffused shadow (Blur: 12px, Y: 4px, Color: `rgba(26, 28, 34, 0.05)`).
  Avoid high-contrast shadows; the goal is a gentle "lift" off the page.

## Shapes

The shape language is defined by a dual-radius system:

- **Large Components:** Use `12px` (radius_lg) for cards, modal containers, and large section wraps.
- **UI Elements:** Use `8px` (radius_sm) for buttons, input fields, chips, and small interactive elements.
- **Pills:** Fully rounded corners are reserved exclusively for status indicators and notification badges.

## Components

- **Buttons:** Primary buttons use `#c97e0e` background with white text. Hover state shifts to `#f5a524`. Ghost buttons use a `#e2ddd4` border.
- **Inputs:** Default state uses `#ffffff` background with a `#e2ddd4` border. On focus, the border transitions to the Brand Accent.
- **Chips:** Small containers with `8px` radius, using the `#f2f0ec` background and `#6b7280` text for inactive states.
- **Lists:** Items separated by `#e2ddd4` hairline borders. Interactive list items should have a hover state of `#f2f0ec`.
- **Cards:** Use `#ffffff` background, `12px` radius, and a `#e2ddd4` hairline border. For interactive cards, apply the Level 2 shadow on hover.
- **Checkboxes/Radios:** Use the Brand Accent for checked states. The frame should remain `#e2ddd4` when unchecked.
