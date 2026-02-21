# 3D Scene Templates

Ready-to-use Angular components for common 3D scene types. Each template is production-ready and documented with customization points.

## Scene Types

### Cyberpunk / Neon

**[crystal-grid-neon.component.ts](scenes/crystal-grid-neon.component.ts)**

- Wireframe geometry with emissive materials
- Multi-axis rotation animations
- Strong bloom post-processing
- Colored point lights matching object colors
- Auto-rotating orbit controls

**Best for:** Tech products, gaming, futuristic branding

---

### Geometric Abstract

**[floating-geometry.component.ts](scenes/floating-geometry.component.ts)**

- Multiple polyhedron types (icosahedron, octahedron, etc.)
- Float3d for gentle bobbing animation
- MouseTracking3d for cursor interaction
- Environment map for PBR reflections
- Subtle bloom for soft glow

**Best for:** SaaS landing pages, portfolio sites, creative agencies

---

### Glass / Bubble

**[bubble-dream-hero.component.ts](scenes/bubble-dream-hero.component.ts)**

- Corner-positioned glass bubbles with transmission
- Per-bubble spotlight for dramatic lighting
- Inverted mouse tracking for depth parallax
- Volumetric nebula background
- HTML overlay support for marketing content

**Best for:** Luxury brands, beauty products, ethereal themes

---

### Space / Cosmic

**[space-cosmic-hero.component.ts](scenes/space-cosmic-hero.component.ts)**

- Star field with parallax scrolling layers
- Nebula volumetric background
- Central animated marble sphere (planet)
- Particle field for depth
- Rich bloom post-processing

**Best for:** Tech startups, astronomy apps, futuristic themes

---

### Organic / Fluid

**[metaball-organic.component.ts](scenes/metaball-organic.component.ts)**

- MetaballSystem with multiple merging globs
- Each metaball follows orbit path
- Environment mapping for reflections
- Subtle bloom for organic glow
- Optional transmission for liquid/glass effect

**Best for:** Creative agencies, experimental sites, biotech

---

### Particle Effects

**[particle-storm.component.ts](scenes/particle-storm.component.ts)**

- Multiple particle layers at different speeds
- Vortex animation for storm effect
- Strong bloom for energy effect
- Mouse tracking for interactive particles
- Dramatic colored point lights

**Best for:** Gaming, action products, high-energy brands

---

## Usage

1. **Copy the template** into your project
2. **Rename** the component selector and class
3. **Customize** the documented customization points (colors, positions, animations)
4. **Add your content** to the overlay layer (if applicable)

Each template file includes detailed comments explaining:

- Scene type and best use cases
- Key features used
- Customization points with examples
