## Ready-to-Use Animation Templates

The `../assets/` folder contains complete, production-ready animation components organized by type. Each template is heavily documented with customization points and can be used as first drafts for user requirements.

### Page Templates (`../assets/pages/`)

| User Intent                    | Template                                                                      | Key Features                                                     |
| ------------------------------ | ----------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| "Fullpage scroll presentation" | [fullpage-showcase.component.ts](../assets/pages/fullpage-showcase.component.ts) | HijackedScrollContainer, progress indicator, 5 complete sections |

### Section Templates (`../assets/sections/`)

| User Intent                | Template                                                                                   | Key Features                                               |
| -------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| "Parallax hero with depth" | [parallax-hero.component.ts](../assets/sections/parallax-hero.component.ts)                   | Multi-layer parallax, floating elements, staggered content |
| "Timeline / history page"  | [split-panel-timeline.component.ts](../assets/sections/split-panel-timeline.component.ts)     | Pinned left panel, scrolling timeline, progress sync       |
| "Feature cards grid"       | [feature-showcase-cards.component.ts](../assets/sections/feature-showcase-cards.component.ts) | Staggered entrance, hover effects, grid layout             |

### Using Templates

1. **Match user intent**: When user describes an animation matching a template, offer it as starting point
2. **Customize documented points**: Each template has comments explaining what to change
3. **Combine sections**: Build complete pages by combining multiple section templates

### Using templates

1. Offer a matching template as a starting draft.
2. Customize values documented in its comments.
3. Combine sections when the page calls for it.

### Quick start

Use `../assets/animation-template.component.ts` for parallax background, hero entrance, staggered items, scroll-linked fade, and imports.
