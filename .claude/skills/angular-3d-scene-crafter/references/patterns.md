# Scene Patterns

Proven composition patterns from 8 award-winning hero scenes in the angular-3d-demo.

## Table of Contents

1. [Spatial Composition Patterns](#spatial-composition-patterns)
2. [Scene Type Catalog](#scene-type-catalog)
3. [Material Combinations](#material-combinations)
4. [Lighting Setups](#lighting-setups)
5. [Animation Choreography](#animation-choreography)
6. [Multi-Layer Techniques](#multi-layer-techniques)

---

## Spatial Composition Patterns

### Grid Distribution
**Use when:** Structured, organized aesthetic desired
**Example:** Crystal Grid Hero

**Pattern:**
- 5 objects in grid formation
- Positions: top-left, top-right, bottom-left, bottom-right, center-back
- Size variation: 1.5-3.0 units
- Z-depth variation: -5 to 0

**Code template:**
```typescript
// Top-left
[position]="[-8, 4, -5]" [args]="[2.5, 0.6, 16, 100]"

// Top-right
[position]="[8, 4, -3]" [args]="[2, 0.5, 16, 100]"

// Bottom-left
[position]="[-7, -3, -2]" [args]="[1.8, 0.4, 16, 100]"

// Bottom-right
[position]="[7, -4, -4]" [args]="[3, 0.7, 16, 100]"

// Center-back
[position]="[0, 0, -5]" [args]="[1.5, 0.4, 16, 100]"
```

---

### Asymmetric Scatter
**Use when:** Organic, dynamic feel desired
**Example:** Floating Geometry Hero

**Pattern:**
- 5+ objects with irregular positioning
- No symmetry or alignment
- Varied sizes and geometry types
- Creates visual interest through chaos

**Code template:**
```typescript
<a3d-polyhedron type="icosahedron" [position]="[-6, 3, 0]" [args]="[1.5, 0]" />
<a3d-polyhedron type="octahedron" [position]="[5, 4, -2]" [args]="[1.2, 0]" />
<a3d-polyhedron type="dodecahedron" [position]="[0, 0, 2]" [args]="[2, 0]" />
<a3d-polyhedron type="tetrahedron" [position]="[-5, -3, 1]" [args]="[1.8, 0]" />
<a3d-polyhedron type="cube" [position]="[6, -2, -1]" [args]="[1.5, 0]" />
```

---

### Corner Framing
**Use when:** Central content (text/UI) needs framing
**Example:** Bubble Dream Hero

**Pattern:**
- 4 objects at screen corners
- Leaves center clear for overlay content
- Creates depth and boundary
- Corner positions adjusted for perspective

**Code template:**
```typescript
// Top-left
<a3d-sphere [position]="[-15, 10, -15]" [radius]="3" />

// Top-right
<a3d-sphere [position]="[15, 10, -14]" [radius]="2.5" />

// Bottom-left
<a3d-sphere [position]="[-12, -8, -13]" [radius]="2.8" />

// Bottom-right
<a3d-sphere [position]="[15, -10, -16]" [radius]="3.2" />
```

---

### Focal Clustering
**Use when:** Emphasizing a hero object with supporting elements
**Example:** Marble Hero

**Pattern:**
- Primary large object (center-right)
- Secondary medium object (off-axis)
- Accent tiny object (creates depth)
- Size hierarchy: 0.35, 0.18, 0.08 radius ratio

**Code template:**
```typescript
// Primary focal point
<a3d-marble-sphere [position]="[2.5, 0.25, 0]" [radius]="0.35" />

// Secondary support
<a3d-marble-sphere [position]="[-3, 3, -2]" [radius]="0.18" />

// Accent detail
<a3d-marble-sphere [position]="[-4, -2.5, -1]" [radius]="0.08" />
```

---

### Layered Depth
**Use when:** Creating multi-plane parallax effect
**Example:** Particle Storm, Hero Space

**Pattern:**
- Foreground: Z = 0 to 2 (interactive objects)
- Midground: Z = -5 to -10 (main content)
- Background: Z = -15 to -80 (ambient layers)

**Code template:**
```typescript
<!-- Foreground: Interactive text -->
<a3d-particle-text [position]="[0, 0, -10]" />

<!-- Midground: Star field -->
<a3d-star-field [position]="[0, 0, -30]" />

<!-- Background: Nebula -->
<a3d-nebula-volumetric [position]="[0, 0, -80]" />
```

---

## Scene Type Catalog

### Cyberpunk Neon
**Components:** Torus, Box, Polyhedron
**Materials:** Emissive + Wireframe
**Colors:** Cyan (#00ffff), Magenta (#ff00ff), Yellow (#ffff00)
**Lighting:** Colored point lights matching objects
**Effects:** Strong bloom (threshold 0.5, strength 1.2)
**Animation:** Multi-axis rotation

**Complete scene:**
```typescript
<a3d-scene-3d [cameraPosition]="[0, 0, 20]" [backgroundColor]="0x328976">
  <!-- Grid of emissive wireframe toruses -->
  <a3d-torus
    [position]="[-8, 4, -5]"
    [args]="[2.5, 0.6, 16, 100]"
    [color]="'#00ffff'"
    [wireframe]="true"
    [emissive]="'#00ffff'"
    [emissiveIntensity]="2"
    rotate3d [rotateConfig]="{ axis: 'y', speed: 1 }"
    glow3d
  />
  <!-- More toruses... -->

  <!-- Colored lights -->
  <a3d-ambient-light [intensity]="0.1" />
  <a3d-point-light [position]="[0, 0, 10]" [color]="'#00ffff'" [intensity]="2" />
  <a3d-point-light [position]="[-10, 5, 5]" [color]="'#ff00ff'" [intensity]="1.5" />

  <!-- Strong bloom -->
  <a3d-effect-composer>
    <a3d-bloom-effect [threshold]="0.5" [strength]="1.2" [radius]="0.4" />
  </a3d-effect-composer>
</a3d-scene-3d>
```

---

### Space/Cosmic
**Components:** Planet, Star Field, Nebula
**Materials:** TSL node materials (water marble shader)
**Colors:** Deep space blues (#00b8ff, #4a90d9), Dark background (0x050510)
**Lighting:** Directional (sun) + Rim light
**Effects:** Subtle bloom (threshold 0.9), Environment HDRI
**Animation:** Slow star rotation, planet rotation

**Complete scene:**
```typescript
<a3d-scene-3d [cameraPosition]="[0, 0, 25]" [backgroundColor]="0x050510">
  <!-- Multi-layer star fields with parallax rotation -->
  <a3d-star-field
    [starCount]="2000"
    [radius]="50"
    [position]="[0, 0, -20]"
    [multiSize]="true"
    [stellarColors]="true"
    [enableRotation]="true"
    [rotationSpeed]="0.015"
    [rotationAxis]="'z'"
  />
  <a3d-star-field
    [starCount]="1000"
    [radius]="60"
    [position]="[0, 0, -40]"
    [enableRotation]="true"
    [rotationSpeed]="-0.008"
  />

  <!-- Volumetric nebula backdrop -->
  <a3d-nebula-volumetric
    [position]="[0, 0, -80]"
    [scale]="50"
    [color]="'#6b21a8'"
    [opacity]="0.3"
  />

  <!-- Planet with TSL shader -->
  <a3d-sphere
    [position]="[0, 0, 0]"
    [args]="[4, 64, 64]"
    a3dNodeMaterial
    [colorNode]="tslWaterMarble({ scale: 2, turbulence: 0.6, speed: 0.5 })"
    rotate3d [rotateConfig]="{ axis: 'y', speed: 120 }"
  />

  <!-- Dramatic lighting -->
  <a3d-ambient-light [intensity]="0.2" />
  <a3d-directional-light [position]="[15, 8, 10]" [intensity]="1.6" />
  <a3d-directional-light
    [position]="[-10, 5, -5]"
    [intensity]="0.25"
    [color]="'#4a90d9'"
  />

  <!-- Environment for reflections -->
  <a3d-environment [preset]="'sunset'" [intensity]="0.5" />

  <!-- Subtle bloom -->
  <a3d-effect-composer>
    <a3d-bloom-effect [threshold]="0.9" [strength]="0.3" [radius]="0.5" />
  </a3d-effect-composer>
</a3d-scene-3d>
```

---

### Glass/Bubble
**Components:** Sphere with transmission
**Materials:** Transmission + Clearcoat + Iridescence
**Colors:** Purple/Pink (#e879f9, #a855f7, #f472b6)
**Lighting:** Three-point (spotlight + 2 colored point lights)
**Effects:** Subtle bloom, Environment map required
**Animation:** Float + Mouse tracking

**Complete scene:**
```typescript
<a3d-scene-3d [cameraPosition]="[0, 0, 35]" [backgroundColor]="0x0a0515">
  <!-- Corner-positioned glass bubbles -->
  <a3d-sphere
    [position]="[-15, 10, -15]"
    [args]="[3, 64, 64]"
    [color]="'#e879f9'"
    [transmission]="0.9"
    [thickness]="0.5"
    [ior]="1.4"
    [clearcoat]="1.0"
    [clearcoatRoughness]="0.0"
    [roughness]="0.0"
    [iridescence]="1.0"
    [iridescenceIOR]="1.3"
    [iridescenceThicknessMin]="100"
    [iridescenceThicknessMax]="400"
    float3d [floatConfig]="{ height: 0.6, speed: 3000 }"
    mouseTracking3d [trackingConfig]="{ sensitivity: 0.8, damping: 0.05, invertX: true }"
  />
  <!-- More corner bubbles... -->

  <!-- Three-point lighting -->
  <a3d-ambient-light [intensity]="0.3" />
  <a3d-spot-light
    [position]="[0, 16, -6]"
    [intensity]="120"
    [angle]="0.5"
  />
  <a3d-point-light
    [position]="[-10, 10, -10]"
    [intensity]="25"
    [color]="'#a855f7'"
  />
  <a3d-point-light
    [position]="[10, 6, -8]"
    [intensity]="15"
    [color]="'#f472b6'"
  />

  <!-- Per-bubble spotlights for each corner -->
  <a3d-spot-light
    [position]="[-15, 10, -10]"
    [target]="[-15, 10, -15]"
    [intensity]="40"
    [angle]="0.6"
  />

  <!-- Environment essential for glass -->
  <a3d-environment [preset]="'sunset'" [intensity]="0.8" />

  <a3d-effect-composer>
    <a3d-bloom-effect [threshold]="0.85" [strength]="0.4" />
  </a3d-effect-composer>
</a3d-scene-3d>
```

---

### Geometric Abstract
**Components:** Multiple polyhedron types
**Materials:** PBR with environment reflections
**Colors:** Warm/cool balance (Indigo, Emerald, Amber, Rose, Cyan)
**Lighting:** Minimal ambient, Environment provides lighting
**Effects:** Subtle bloom, Environment preset
**Animation:** Staggered float + Mouse tracking

**Complete scene:**
```typescript
<a3d-scene-3d [cameraPosition]="[0, 0, 25]" [backgroundColor]="0x0a0a1a">
  <!-- Asymmetric scatter of polyhedrons -->
  <a3d-polyhedron
    type="icosahedron"
    [position]="[-6, 3, 0]"
    [args]="[1.5, 0]"
    [color]="'#6366f1'"
    float3d [floatConfig]="{ height: 0.4, speed: 2500, delay: 0 }"
    mouseTracking3d [trackingConfig]="{ sensitivity: 0.3, damping: 0.08 }"
  />
  <a3d-polyhedron
    type="octahedron"
    [position]="[5, 4, -2]"
    [args]="[1.2, 0]"
    [color]="'#10b981'"
    float3d [floatConfig]="{ height: 0.5, speed: 3000, delay: 200 }"
    mouseTracking3d [trackingConfig]="{ sensitivity: 0.3, damping: 0.08 }"
  />
  <a3d-polyhedron
    type="dodecahedron"
    [position]="[0, 0, 2]"
    [args]="[2, 0]"
    [color]="'#f59e0b'"
    float3d [floatConfig]="{ height: 0.3, speed: 2800, delay: 400 }"
    mouseTracking3d [trackingConfig]="{ sensitivity: 0.3, damping: 0.08 }"
  />
  <!-- More polyhedrons... -->

  <!-- Environment provides realistic lighting -->
  <a3d-ambient-light [intensity]="0.2" />
  <a3d-environment [preset]="'sunset'" [intensity]="0.5" />

  <a3d-effect-composer>
    <a3d-bloom-effect [threshold]="0.9" [strength]="0.3" />
  </a3d-effect-composer>
</a3d-scene-3d>
```

---

### Particle Effects
**Components:** Particle Text, Star Field, Nebula
**Materials:** Emissive particles
**Colors:** Electric neon green (#a1ff4f), Cyan, Purple
**Lighting:** Minimal ambient
**Effects:** Strong bloom for particles
**Animation:** Float on star layers, rotation

**Complete scene:**
```typescript
<a3d-scene-3d [cameraPosition]="[0, 0, 30]" [backgroundColor]="0x0a0a0f">
  <!-- Volumetric nebula backdrop -->
  <a3d-nebula-volumetric
    [position]="[0, 0, -80]"
    [scale]="60"
    [color]="'#6b21a8'"
    [opacity]="0.4"
  />

  <!-- Multi-layer star fields with rotation -->
  <a3d-star-field
    [starCount]="3000"
    [radius]="50"
    [color]="'#00d4ff'"
    [position]="[0, 0, -30]"
    [enableRotation]="true"
    [rotationSpeed]="0.012"
    float3d [floatConfig]="{ height: 0.8, speed: 3000, delay: 500 }"
  />

  <!-- Particle text (foreground) -->
  <a3d-particle-text
    text="STORM"
    [fontSize]="2"
    [position]="[0, 0, -10]"
    [color]="'#a1ff4f'"
  />

  <!-- Minimal lighting (emissive materials glow) -->
  <a3d-ambient-light [intensity]="0.1" />

  <!-- Strong bloom for electric effect -->
  <a3d-effect-composer>
    <a3d-bloom-effect [threshold]="0.4" [strength]="1.5" [radius]="0.6" />
  </a3d-effect-composer>
</a3d-scene-3d>
```

---

## Material Combinations

### Emissive Wireframe (Neon)
```typescript
[wireframe]="true"
[emissive]="'#00ffff'"
[emissiveIntensity]="2"
[color]="'#00ffff'"
```
**When:** Cyberpunk, electric, high-tech aesthetics
**Requires:** Strong bloom, colored lights optional

---

### Glass Transmission
```typescript
[transmission]="0.9"
[thickness]="0.5"
[ior]="1.4"
[clearcoat]="1.0"
[clearcoatRoughness]="0.0"
[roughness]="0.0"
```
**When:** Realism, luxury, elegant scenes
**Requires:** Environment map essential, subtle bloom recommended

---

### Iridescent Glass (Soap Bubble)
```typescript
[transmission]="0.9"
[thickness]="0.5"
[ior]="1.4"
[clearcoat]="1.0"
[iridescence]="1.0"
[iridescenceIOR]="1.3"
[iridescenceThicknessMin]="100"
[iridescenceThicknessMax]="400"
```
**When:** Dreamy, magical, ethereal moods
**Requires:** Environment map, subtle bloom, three-point lighting

---

### PBR Standard
```typescript
[color]="'#6366f1'"
[metalness]="0.3"
[roughness]="0.5"
```
**When:** Realistic, balanced, professional look
**Requires:** Environment map for reflections

---

## Lighting Setups

### Minimal Ambient (Drama)
```typescript
<a3d-ambient-light [intensity]="0.1" />
<!-- Rely on emissive materials and bloom -->
```
**Use for:** Neon, particle, high-contrast scenes

---

### Dual Colored Accents
```typescript
<a3d-ambient-light [intensity]="0.1" />
<a3d-point-light [position]="[0, 0, 10]" [color]="'#00ffff'" [intensity]="2" />
<a3d-point-light [position]="[-10, 5, 5]" [color]="'#ff00ff'" [intensity]="1.5" />
```
**Use for:** Cyberpunk, dual-tone color schemes

---

### Three-Point Professional
```typescript
<a3d-ambient-light [intensity]="0.3" />
<!-- Key light -->
<a3d-spot-light [position]="[0, 16, -6]" [intensity]="120" [angle]="0.5" />
<!-- Fill light -->
<a3d-point-light [position]="[-10, 10, -10]" [intensity]="25" [color]="'#a855f7'" />
<!-- Rim light -->
<a3d-point-light [position]="[10, 6, -8]" [intensity]="15" [color]="'#f472b6'" />
```
**Use for:** Glass, bubble, product showcase scenes

---

### Dramatic Rim Lighting
```typescript
<a3d-ambient-light [intensity]="0.2" />
<!-- Main directional (sun) -->
<a3d-directional-light [position]="[15, 8, 10]" [intensity]="1.6" />
<!-- Rim light (opposite side, colored) -->
<a3d-directional-light [position]="[-10, 5, -5]" [intensity]="0.25" [color]="'#4a90d9'" />
```
**Use for:** Space, cosmic, cinematic scenes

---

## Animation Choreography

### Staggered Float
```typescript
<a3d-sphere float3d [floatConfig]="{ height: 0.4, speed: 2500, delay: 0 }" />
<a3d-box float3d [floatConfig]="{ height: 0.5, speed: 3000, delay: 200 }" />
<a3d-torus float3d [floatConfig]="{ height: 0.3, speed: 2800, delay: 400 }" />
```
**Effect:** Wave-like choreography, organic motion
**Pattern:** Vary height (0.3-0.5), speed (2500-3500ms), delay (0-600ms)

---

### Multi-Axis Rotation
```typescript
<a3d-torus rotate3d [rotateConfig]="{ axis: 'y', speed: 1 }" />
<a3d-box rotate3d [rotateConfig]="{ axis: 'x', speed: 0.8 }" />
<a3d-cylinder rotate3d [rotateConfig]="{ axis: 'z', speed: 0.6 }" />
```
**Effect:** Each object has unique motion signature
**Pattern:** Different axes per object, vary speeds (0.6-1.4)

---

### Parallax Star Rotation
```typescript
<!-- Foreground stars - fast clockwise -->
<a3d-star-field
  [position]="[0, 0, -20]"
  [enableRotation]="true"
  [rotationSpeed]="0.015"
  [rotationAxis]="'z'"
/>

<!-- Background stars - slow counter-clockwise -->
<a3d-star-field
  [position]="[0, 0, -40]"
  [enableRotation]="true"
  [rotationSpeed]="-0.008"
  [rotationAxis]="'z'"
/>
```
**Effect:** Depth parallax through differential rotation
**Pattern:** Foreground faster (0.01-0.015), background slower (0.003-0.008), opposite directions

---

### Inverted Mouse Tracking (Parallax)
```typescript
<!-- Center object - normal tracking -->
<a3d-sphere
  [position]="[0, 0, 0]"
  mouseTracking3d
  [trackingConfig]="{ sensitivity: 0.3, damping: 0.08 }"
/>

<!-- Corner objects - inverted tracking -->
<a3d-sphere
  [position]="[-15, 10, -15]"
  mouseTracking3d
  [trackingConfig]="{
    sensitivity: 0.8,
    damping: 0.05,
    invertX: true,
    invertPosX: true
  }"
/>
```
**Effect:** Corners move opposite to cursor, creates depth
**Pattern:** Invert both rotation and position on background objects

---

## Multi-Layer Techniques

### Star Field Layering
```typescript
<!-- Layer 1: Foreground (closest, largest, fast rotation) -->
<a3d-star-field
  [starCount]="2000"
  [radius]="50"
  [position]="[0, 0, -20]"
  [size]="0.03"
  [enableRotation]="true"
  [rotationSpeed]="0.015"
/>

<!-- Layer 2: Midground (medium distance, medium size, medium rotation) -->
<a3d-star-field
  [starCount]="1500"
  [radius]="60"
  [position]="[0, 0, -40]"
  [size]="0.02"
  [enableRotation]="true"
  [rotationSpeed]="0.008"
/>

<!-- Layer 3: Background (farthest, smallest, slowest rotation) -->
<a3d-star-field
  [starCount]="1000"
  [radius]="70"
  [position]="[0, 0, -60]"
  [size]="0.01"
  [enableRotation]="true"
  [rotationSpeed]="0.003"
/>
```

---

### Fog + Background Color Matching
```typescript
<a3d-scene-3d [backgroundColor]="0x050510">
  <!-- Fog color matches background -->
  <a3d-fog [color]="'#050510'" [near]="20" [far]="100" />
</a3d-scene-3d>
```
**Effect:** Seamless blend into background, atmospheric depth

---

### Selective Bloom Layers
```typescript
<a3d-effect-composer>
  <a3d-selective-bloom-effect [layer]="1" [threshold]="0" [strength]="1.5" />
</a3d-effect-composer>

<!-- Text glows (auto-assigned to layer 1) -->
<a3d-glow-troika-text text="GLOW" />

<!-- Clouds don't glow (not on bloom layer) -->
<a3d-cloud-layer />
```
**Effect:** Precise control over which objects glow