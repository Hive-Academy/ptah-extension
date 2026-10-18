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

Match the analyzed scene to one of the proven patterns from [patterns.md](patterns.md):

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
    <a3d-scene-3d [cameraPosition]="[0, 0, 20]" [backgroundColor]="0x0a0a0f">
      <!-- Reconstructed based on image analysis -->

      <!-- Primary focal sphere (glass with iridescence) -->
      <a3d-sphere [args]="[3, 64, 64]" [position]="[2, 0, 0]" [color]="'#e879f9'" [transmission]="0.9" [iridescence]="1.0" [iridescenceThicknessMin]="100" [iridescenceThicknessMax]="400" />

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
  `,
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
