---
name: angular-3d-scene-crafter
description: Interactive 3D scene designer for @hive-academy/angular-3d library. Guides users through creating stunning Three.js scenes using declarative Angular components. Use when users want to: (1) Create new 3D scenes or hero sections, (2) Design visual effects (neon, space, glass, particles), (3) Get recommendations for primitives, lighting, and materials, (4) Learn composition patterns and best practices, (5) Generate complete Angular scene components with proper configuration, (6) Analyze reference images and reverse-engineer scenes to recreate similar aesthetics with available components (extracts colors, lighting, materials, composition).
---

# Angular 3D Scene Crafter

Create stunning 3D scenes using the @hive-academy/angular-3d library through guided, conversational design.

## Overview

This skill helps you design and generate complete Angular components for 3D scenes by:
- Guiding aesthetic and mood selection
- Recommending components based on scene type
- Applying proven composition patterns
- Configuring materials, lighting, and animations
- Generating production-ready Angular code

## Workflow

The skill supports two primary workflows:
- **A. Text-Based Design** - Conversational scene crafting from user descriptions
- **B. Image-Based Reverse Engineering** - Analyze reference images and recreate similar scenes

---

## Workflow A: Image-Based Reverse Engineering

**Use when:** User provides a reference image or screenshot of a desired 3D scene aesthetic.

### 1. Request and Analyze Image

Ask user to provide the reference image:
- "Please share the image you'd like to recreate"
- "I can analyze screenshots, design mockups, or existing 3D scenes"

### 2. Perform Visual Analysis

When image is provided, analyze these key aspects:

#### Color Palette Extraction
- Identify dominant colors (background, primary objects, accents)
- Note color temperature (warm vs cool)
- Detect color scheme type (monochrome, complementary, triadic)
- Extract hex values for key colors

**Example analysis:**
```
Colors detected:
- Background: Very dark (#0a0a0f - deep space)
- Primary: Cyan (#00d4ff)
- Secondary: Purple (#a855f7)
- Accent: Pink (#f472b6)
- Scheme: Cool complementary with warm accent
```

#### Lighting Analysis
- Count visible light sources
- Identify light types (ambient, directional, point, spot)
- Note light positions (top-left, rim, front)
- Assess lighting mood (dramatic, soft, high-contrast)

**Example analysis:**
```
Lighting setup:
- Very low ambient (dark dramatic mood)
- Strong rim light from upper-left (creates edge highlights)
- Colored accent light (purple tint on left side)
- Setup matches: Three-point professional OR dramatic rim lighting
```

#### Material & Surface Analysis
- Identify material types (glossy, matte, emissive, glass, metallic)
- Note special effects (wireframe, glow, transparency, iridescence)
- Detect surface treatments (smooth, rough, reflective)

**Example analysis:**
```
Materials:
- Sphere 1: Glass/transmission (visible refraction, clearcoat)
- Sphere 2: Emissive glow (self-illuminated wireframe)
- Background: Particle field (soft bokeh points)
- Effects: Strong bloom on emissive elements
```

#### Geometry & Composition
- Identify primitive shapes (spheres, boxes, toruses, cylinders)
- Note spatial arrangement (grid, scatter, corner framing, clustering)
- Assess depth layering (foreground/midground/background)
- Count objects and note size hierarchy

**Example analysis:**
```
Composition:
- 3 spheres: Large (focal), Medium (secondary), Small (accent)
- Layout: Focal clustering pattern (off-center primary)
- Depth: Foreground spheres (z=0), Background particles (z=-30)
- Camera: Standard perspective (FOV ~75°, distance ~20 units)
```

#### Animation & Effects
- Detect motion blur or animation trails
- Note particles or dynamic elements
- Identify post-processing (bloom, depth of field, chromatic aberration)

**Example analysis:**
```
Effects:
- Strong bloom (glow around bright elements)
- Particle background (static star field or animated?)
- No visible motion blur (static scene or slow animation)
- Depth of field: None detected (all elements sharp)
```

### 3. Map to Available Components

Based on analysis, recommend specific angular-3d components:

**Primitives:**
```
Detected: Spheres → Use: <a3d-sphere> or <a3d-marble-sphere> or <a3d-glass-sphere>
Detected: Torus → Use: <a3d-torus>
Detected: Particle field → Use: <a3d-star-field> or <a3d-particle-system>
Detected: Nebula cloud → Use: <a3d-nebula-volumetric>
```

**Materials:**
```
Detected: Glass with refraction → Config: [transmission]="0.9" [ior]="1.5" [clearcoat]="1.0"
Detected: Emissive glow → Config: [emissive]="color" [emissiveIntensity]="2" [wireframe]="true"
Detected: Iridescent rainbow → Config: [iridescence]="1.0" [iridescenceThicknessMin]="100"
```

**Lighting:**
```
Detected: Dramatic rim → Use: Directional light setup (main + rim)
Detected: Colored accents → Use: Multiple point lights with colors
```

**Effects:**
```
Detected: Strong bloom → Use: <a3d-bloom-effect [threshold]="0.5" [strength]="1.2" />
Detected: Selective glow → Use: <a3d-selective-bloom-effect [layer]="1" />
```

### 4. Identify Closest Scene Pattern

Match the analyzed scene to one of the proven patterns from [patterns.md](references/patterns.md):

**Pattern matching logic:**
- Emissive + wireframe + strong bloom → **Cyberpunk Neon**
- Spheres + transmission + iridescence → **Glass/Bubble**
- Planets + stars + nebula → **Space/Cosmic**
- Polyhedrons + environment reflections → **Geometric Abstract**
- Particles + volumetric elements → **Particle Effects**
- Marble shader + glossy materials → **Organic/Fluid**

**Output:**
```
"Based on the image analysis, this matches our **Glass/Bubble** scene pattern:
- Transmission materials with iridescence
- Three-point lighting (key + fill + rim)
- Corner framing composition
- Purple/pink color palette
- Subtle bloom for refinement

I'll recreate this using <a3d-glass-sphere> components with iridescence,
three-point lighting setup, and matching post-processing."
```

### 5. Generate Reconstruction Code

Provide the complete Angular component that recreates the scene:

```typescript
import { Component, ChangeDetectionStrategy } from '@angular/core';
import {
  Scene3dComponent,
  SphereComponent,
  StarFieldComponent,
  // ... other imports
} from '@hive-academy/angular-3d';

@Component({
  selector: 'app-reconstructed-scene',
  // ... component configuration
  template: `
    <a3d-scene-3d
      [cameraPosition]="[0, 0, 20]"
      [backgroundColor]="0x0a0a0f">

      <!-- Reconstructed based on image analysis -->

      <!-- Primary focal sphere (glass with iridescence) -->
      <a3d-sphere
        [args]="[3, 64, 64]"
        [position]="[2, 0, 0]"
        [color]="'#e879f9'"
        [transmission]="0.9"
        [iridescence]="1.0"
        [iridescenceThicknessMin]="100"
        [iridescenceThicknessMax]="400"
      />

      <!-- ... more components matching the analyzed scene -->

      <!-- Three-point lighting (detected from image) -->
      <a3d-ambient-light [intensity]="0.3" />
      <a3d-spot-light [position]="[0, 16, -6]" [intensity]="120" />
      <a3d-point-light [position]="[-10, 10, -10]" [color]="'#a855f7'" />

      <!-- Bloom effect (strong glow detected) -->
      <a3d-effect-composer>
        <a3d-bloom-effect [threshold]="0.85" [strength]="0.4" />
      </a3d-effect-composer>
    </a3d-scene-3d>
  `
})
export class ReconstructedSceneComponent {}
```

### 6. Provide Customization Notes

After generating code, explain approximations and suggest refinements:

**Approximations made:**
- "Estimated sphere positions based on perspective"
- "Bloom threshold approximated from glow intensity"
- "Camera distance inferred from field of view"

**Refinement suggestions:**
- "Adjust sphere positions: `[position]` values for exact placement"
- "Fine-tune colors: Use exact hex values if available"
- "Tweak bloom: Lower `threshold` for more glow, adjust `strength`"
- "Add animations: Consider `float3d` or `rotate3d` for motion"

---

## Workflow B: Text-Based Design

**Use when:** User describes desired scene verbally without reference image.

### 1. Discover User Intent

Ask about the desired scene aesthetic and purpose:

**Questions to ask:**
- "What mood or aesthetic are you aiming for?" (cyberpunk, cosmic, dreamy, energetic, minimal)
- "What's the scene's purpose?" (hero section, background, interactive feature, showcase)
- "Any specific visual elements you want?" (planets, particles, glass, geometry, text)
- "Do you have a color preference?" (neon, warm, cool, monochrome)

### 2. Recommend Scene Type

Based on user responses, suggest one or more scene types from these proven patterns:

**Scene Type Reference:**
- **Cyberpunk Neon** - Wireframe geometry, emissive materials, strong bloom, cyan/magenta palette
- **Space/Cosmic** - Planets, star fields, nebulas, dramatic lighting, deep blues
- **Glass/Bubble** - Transparent spheres, iridescence, transmission, soft lighting
- **Geometric Abstract** - Polyhedrons, PBR materials, environment reflections, scattered layout
- **Particle Effects** - Particle systems, volumetric text, nebula backgrounds, electric colors
- **Organic/Fluid** - Metaballs, marble shaders, TSL materials, smooth animations
- **Cloud/Atmospheric** - Cloud layers, fog, day/night modes, selective bloom

For each suggestion, reference similar examples from hero scenes and explain why it matches their goals.

### 3. Build Scene Incrementally

Guide users through adding components in this order:

#### A. Scene Container & Camera
```typescript
<a3d-scene-3d
  [cameraPosition]="[0, 0, 20]"
  [cameraFov]="75"
  [backgroundColor]="0x0a0a0f"
  [enableShadows]="false">
  <!-- Components go here -->
</a3d-scene-3d>
```

**Configuration tips:**
- `cameraPosition`: Adjust Z for desired view distance (10-30 typical)
- `backgroundColor`: Use ultra-dark (0x0a0a0f - 0x050510) for contrast
- `enableShadows`: Only enable if using shadow-casting lights

#### B. Primitives & Objects

Recommend components from [components.md](references/components.md) based on scene type:

**For geometric scenes:**
- `<a3d-box>`, `<a3d-sphere>`, `<a3d-cylinder>`, `<a3d-torus>`, `<a3d-polyhedron>`

**For space/cosmic:**
- `<a3d-planet>`, `<a3d-star-field>`, `<a3d-nebula-volumetric>`

**For effects:**
- `<a3d-particle-system>`, `<a3d-marble-sphere>`, `<a3d-glass-sphere>`, `<a3d-metaball>`

**For text:**
- `<a3d-troika-text>`, `<a3d-glow-troika-text>`, `<a3d-bubble-text>`, `<a3d-particle-text>`

Apply composition patterns from [patterns.md](references/patterns.md):
- **Grid distribution** - Evenly spaced objects
- **Asymmetric scatter** - Irregular positioning for organic feel
- **Corner framing** - Objects at edges frame central content
- **Focal clustering** - Size hierarchy with primary focus
- **Layered depth** - Z-position ranges (0 to -80)

#### C. Materials & Colors

Configure materials based on aesthetic. See [best-practices.md](references/best-practices.md) for detailed guidance.

**Quick material patterns:**

**Emissive wireframe (neon):**
```typescript
[wireframe]="true"
[emissive]="'#00ffff'"
[emissiveIntensity]="2"
[color]="'#00ffff'"
```

**Glass/transparent:**
```typescript
[transmission]="0.9"
[thickness]="0.5"
[ior]="1.4"
[clearcoat]="1.0"
[clearcoatRoughness]="0.0"
[roughness]="0.0"
```

**PBR with environment:**
```typescript
<a3d-environment [preset]="'sunset'" [intensity]="0.5" />
[color]="'#6366f1'"
[metalness]="0.3"
[roughness]="0.5"
```

**Iridescent (soap bubble):**
```typescript
[transmission]="0.9"
[iridescence]="1.0"
[iridescenceIOR]="1.3"
[iridescenceThicknessMin]="100"
[iridescenceThicknessMax]="400"
```

#### D. Lighting Setup

Recommend lighting based on scene type:

**Cyberpunk/Neon:**
```typescript
<a3d-ambient-light [intensity]="0.1" />
<a3d-point-light [position]="[0, 0, 10]" [color]="'#00ffff'" [intensity]="2" />
<a3d-point-light [position]="[-10, 5, 5]" [color]="'#ff00ff'" [intensity]="1.5" />
```

**Space/Dramatic:**
```typescript
<a3d-ambient-light [intensity]="0.2" />
<a3d-directional-light [position]="[15, 8, 10]" [intensity]="1.6" />
<a3d-directional-light [position]="[-10, 5, -5]" [intensity]="0.25" [color]="'#4a90d9'" />
```

**Glass/Bubble (three-point):**
```typescript
<a3d-ambient-light [intensity]="0.3" />
<a3d-spot-light [position]="[0, 16, -6]" [intensity]="120" [angle]="0.5" />
<a3d-point-light [position]="[-10, 10, -10]" [intensity]="25" [color]="'#a855f7'" />
<a3d-point-light [position]="[10, 6, -8]" [intensity]="15" [color]="'#f472b6'" />
```

#### E. Animation & Interactivity

Add directives for motion. See [components.md](references/components.md) for directive details.

**Float animation:**
```typescript
<a3d-sphere
  float3d
  [floatConfig]="{
    height: 0.5,
    speed: 2500,
    delay: 0,
    ease: 'sine.inOut'
  }"
/>
```

**Rotation:**
```typescript
<a3d-planet
  rotate3d
  [rotateConfig]="{
    axis: 'y',
    speed: 60
  }"
/>
```

**Mouse tracking:**
```typescript
<a3d-box
  mouseTracking3d
  [trackingConfig]="{
    sensitivity: 0.3,
    damping: 0.08
  }"
/>
```

**Best practices:**
- Stagger delays (200ms, 400ms, 600ms) for wave-like choreography
- Vary speeds to prevent synchronization
- Use slow rotation (0.003-0.015) for ambient motion
- Apply mouseTracking to create responsive scenes

#### F. Post-Processing Effects

Configure effects based on mood:

**Strong bloom (neon scenes):**
```typescript
<a3d-effect-composer>
  <a3d-bloom-effect
    [threshold]="0.5"
    [strength]="1.2"
    [radius]="0.4"
  />
</a3d-effect-composer>
```

**Subtle bloom (refined scenes):**
```typescript
<a3d-effect-composer>
  <a3d-bloom-effect
    [threshold]="0.9"
    [strength]="0.3"
    [radius]="0.5"
  />
</a3d-effect-composer>
```

**Selective bloom (precise control):**
```typescript
<a3d-effect-composer>
  <a3d-selective-bloom-effect
    [layer]="1"
    [threshold]="0"
    [strength]="1.5"
  />
</a3d-effect-composer>
<!-- Objects on layer 1 will glow -->
```

### 4. Generate Complete Component

After building incrementally, generate the complete Angular component:

**Component structure:**
```typescript
import { Component, ChangeDetectionStrategy } from '@angular/core';
import {
  Scene3dComponent,
  // Import components used in template
} from '@hive-academy/angular-3d';

@Component({
  selector: 'app-my-scene',
  imports: [
    Scene3dComponent,
    // List all imported components
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a3d-scene-3d
      [cameraPosition]="[0, 0, 20]"
      [backgroundColor]="0x0a0a0f">

      <!-- Primitives & Objects -->

      <!-- Lighting -->

      <!-- Effects -->
      <a3d-effect-composer>
        <a3d-bloom-effect [threshold]="0.7" [strength]="0.8" />
      </a3d-effect-composer>

      <!-- Controls (optional) -->
      <a3d-orbit-controls />
    </a3d-scene-3d>
  `,
  styles: `
    :host {
      display: block;
      width: 100%;
      height: 100vh;
    }
  `
})
export class MySceneComponent {}
```

**Best practices for generated code:**
- Use standalone components (no NgModules)
- Use `ChangeDetectionStrategy.OnPush`
- Import only components used in template
- Include host styles for proper sizing
- Add comments for each section (primitives, lighting, effects)
- Use signal-based inputs where available

### 5. Provide Customization Guidance

After generating the component, offer customization suggestions:

**Quick tweaks:**
- "Adjust `cameraPosition` Z value to zoom in/out"
- "Change `backgroundColor` for different moods"
- "Modify `[intensity]` on lights to brighten/dim"
- "Adjust bloom `threshold` (lower = more glow)"
- "Try different float `height` and `speed` values"

**Advanced enhancements:**
- "Add `<a3d-fog>` for atmospheric depth"
- "Include `<a3d-orbit-controls>` for user interaction"
- "Layer multiple star fields with different rotations for parallax"
- "Combine directives (float3d + rotate3d + mouseTracking3d)"

## Reference Files

Load these as needed during scene crafting:

- **[components.md](references/components.md)** - Complete component catalog with all inputs, directives, and services
- **[patterns.md](references/patterns.md)** - Scene composition patterns from 8 proven hero scenes
- **[best-practices.md](references/best-practices.md)** - Detailed guides for color, materials, lighting, animation, and effects

## Tips for Effective Scene Crafting

1. **Start simple** - Begin with basic shapes and build complexity
2. **Use dark backgrounds** - Ultra-dark (0x0a0a0f) makes colors pop
3. **Layer depth** - Vary Z positions (0 to -80) for dimensionality
4. **Match lights to colors** - Colored point lights enhance object colors
5. **Stagger animations** - Delays create organic choreography
6. **Preview iteratively** - Show code for each step, then complete component
7. **Explain choices** - Reference similar hero scenes and explain why patterns work

## Example Interaction Flow

```
User: "I want a cyberpunk neon scene"

You: "Great! For a cyberpunk neon aesthetic, I recommend the Crystal Grid pattern with
     emissive wireframe geometry and strong bloom. This creates that electric,
     high-contrast look. Would you like:
     - Geometric shapes (boxes, toruses, polyhedrons)?
     - Cyan/magenta/yellow neon palette?
     - Strong glow effects with bloom?

     Any specific elements you want to include?"

User: "Yes, use toruses and that color palette"

You: "Perfect! Let's build this step by step.

     **Step 1: Scene Container**
     [show camera setup code]

     **Step 2: Add Toruses in Grid Layout**
     [show 3-5 torus primitives with positions, emissive materials]

     **Step 3: Colored Point Lights**
     [show cyan and magenta point lights matching torus colors]

     **Step 4: Add Rotation Animations**
     [show rotate3d directives with different axes]

     **Step 5: Strong Bloom Effect**
     [show bloom effect with low threshold]

     Here's your complete component:
     [show full Angular component code]

     You can customize by adjusting the emissiveIntensity, bloom strength,
     or rotation speeds!"
```

This conversational approach ensures users understand each decision and can request modifications.