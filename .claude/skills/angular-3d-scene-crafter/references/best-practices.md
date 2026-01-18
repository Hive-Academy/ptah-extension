# Best Practices

Comprehensive guides for composition, color, materials, lighting, animation, and post-processing in angular-3d scenes.

## Table of Contents

1. [Composition Guidelines](#composition-guidelines)
2. [Color Strategy](#color-strategy)
3. [Material Configuration](#material-configuration)
4. [Lighting Techniques](#lighting-techniques)
5. [Animation Best Practices](#animation-best-practices)
6. [Post-Processing](#post-processing)
7. [Performance Optimization](#performance-optimization)

---

## Composition Guidelines

### Size Hierarchy

Create visual interest through varied object sizes:

**Pattern:** Large + Medium + Small
- **Primary:** 3-4 units (focal point)
- **Secondary:** 1.5-2.5 units (supporting)
- **Accent:** 0.5-1 units (detail)

**Example:**
```typescript
// Primary focal sphere
<a3d-sphere [args]="[3.5, 64, 64]" [position]="[2, 0, 0]" />

// Secondary support
<a3d-sphere [args]="[2, 64, 64]" [position]="[-3, 2, -2]" />

// Accent details
<a3d-sphere [args]="[0.8, 32, 32]" [position]="[-4, -2, -1]" />
```

---

### Z-Depth Layering

Use Z-position ranges to create dimensional scenes:

**Depth Zones:**
- **Foreground:** Z = 0 to 2 (interactive objects, close details)
- **Midground:** Z = -5 to -10 (main scene content)
- **Background:** Z = -15 to -80 (ambient layers, backdrop)

**Best practices:**
- Never place all objects at same Z depth
- Background elements should be significantly farther (Z < -15)
- Minimum 3-5 unit separation between layers for parallax effect

---

### Asymmetry Over Symmetry

Avoid perfect symmetry unless intentionally minimalist:

**Don't:**
```typescript
<a3d-box [position]="[-5, 0, 0]" />
<a3d-box [position]="[5, 0, 0]" />  <!-- Perfect mirror -->
```

**Do:**
```typescript
<a3d-box [position]="[-6, 3, 0]" />
<a3d-box [position]="[5, -2, -2]" />  <!-- Offset, varied depth -->
```

---

### Center Space Management

**For hero sections with text overlay:**
- Use corner framing pattern (4 objects at edges)
- Keep center Z > -10 clear
- Position objects outside central 30% of viewport

**For full 3D showcases:**
- Fill center with focal point
- Distribute supporting elements radially

---

### Object Count Guidelines

**Simple scenes:** 3-5 objects
**Medium complexity:** 6-10 objects
**Complex scenes:** 10-20 objects

**Warning:** Too many objects (>30) without instancing impacts performance

---

## Color Strategy

### Dark Background Contrast

**Rule:** Ultra-dark backgrounds (0x0a0a0f - 0x050510) make colors vibrant

**Color range breakdown:**
- `0x000000` - Pure black (too harsh)
- `0x050510` - **Optimal deep space** (recommended)
- `0x0a0a0f` - **Optimal dark grey** (recommended)
- `0x0a0a1a` - Subtle blue tint
- `0x0a1525` - Deeper blue tint
- `0x1a1a2e` - Too bright (reduces contrast)

---

### Complementary Palette Selection

**Proven combinations:**

**Cyberpunk Electric:**
- Cyan: `#00ffff`, `#00d4ff`
- Magenta: `#ff00ff`, `#ff00cc`
- Yellow: `#ffff00`, `#ffcc00`

**Space Cosmic:**
- Deep Blue: `#00b8ff`, `#4a90d9`
- Purple: `#6b21a8`, `#a855f7`
- Cyan Accent: `#00d4ff`

**Dreamy Purple/Pink:**
- Pink: `#e879f9`, `#f472b6`, `#d946ef`
- Purple: `#a855f7`, `#8b5cf6`
- Soft Cyan: `#06b6d4`

**Warm Sunset:**
- Amber: `#f59e0b`, `#fbbf24`
- Rose: `#f43f5e`, `#fb7185`
- Indigo: `#6366f1`

**Neon Green:**
- Electric Green: `#a1ff4f`, `#84cc16`
- Cyan: `#00d4ff`
- Purple: `#a855f7`

---

### Color-Matched Lighting

**Rule:** Point light colors should match or complement object colors

```typescript
<!-- Cyan object gets cyan light -->
<a3d-torus [color]="'#00ffff'" [emissive]="'#00ffff'" />
<a3d-point-light [position]="[0, 5, 5]" [color]="'#00ffff'" [intensity]="2" />

<!-- Magenta object gets magenta light -->
<a3d-box [color]="'#ff00ff'" [emissive]="'#ff00ff'" />
<a3d-point-light [position]="[-5, 3, 3]" [color]="'#ff00ff'" [intensity]="1.5" />
```

---

### Dynamic Color Themes

Use computed signals for switchable themes:

```typescript
export class MySceneComponent {
  isDarkMode = signal(true);

  bgColor = computed(() =>
    this.isDarkMode() ? 0x050510 : 0x326696
  );

  fogColor = computed(() =>
    this.isDarkMode() ? '#050510' : '#4584b4'
  );
}
```

---

## Material Configuration

### Emissive Wireframe (Neon)

**When:** Cyberpunk, electric, high-tech aesthetics

```typescript
[wireframe]="true"
[emissive]="'#00ffff'"
[emissiveIntensity]="2"
[color]="'#00ffff'"
```

**Tips:**
- Emissive intensity 1.5-3.0 for strong glow
- Combine with strong bloom (threshold 0.4-0.6)
- Works without external lights (self-illuminating)

---

### Glass/Transparent

**When:** Realism, luxury, elegant scenes

```typescript
[transmission]="0.9"        // 90% light passes through
[thickness]="0.5"           // Glass thickness
[ior]="1.4"                 // Refraction (glass ~1.5, water ~1.33)
[clearcoat]="1.0"           // Glossy outer layer
[clearcoatRoughness]="0.0"  // Mirror-smooth
[roughness]="0.0"           // Perfectly smooth
[metalness]="0.0"           // Non-metallic
```

**Requirements:**
- **Must have environment map** for realistic reflections
- Use `<a3d-environment [preset]="'sunset'" [intensity]="0.5" />`
- Subtle bloom recommended (threshold 0.85-0.95)
- Three-point lighting for depth

---

### Iridescent Glass (Soap Bubble)

**When:** Dreamy, magical, ethereal moods

```typescript
[transmission]="0.9"
[thickness]="0.5"
[ior]="1.4"
[clearcoat]="1.0"
[clearcoatRoughness]="0.0"
[roughness]="0.0"
[iridescence]="1.0"
[iridescenceIOR]="1.3"
[iridescenceThicknessMin]="100"   // nm
[iridescenceThicknessMax]="400"   // nm
```

**Tips:**
- Thickness range creates color bands
- 100-400nm gives rainbow spectrum
- 50-200nm gives blue/green tones
- 200-600nm gives warm red/orange tones

---

### PBR Standard

**When:** Realistic, balanced, professional look

```typescript
[color]="'#6366f1'"
[metalness]="0.3"          // 0=dielectric, 1=metal
[roughness]="0.5"          // 0=glossy, 1=matte
```

**Roughness guide:**
- 0.0-0.1: Mirror, wet surfaces, polished metal
- 0.2-0.4: Glossy plastic, painted surfaces
- 0.5-0.7: Wood, fabric, stone
- 0.8-1.0: Concrete, rough metal, rubber

**Metalness guide:**
- 0.0: Non-metal (plastic, wood, fabric)
- 1.0: Pure metal (gold, silver, copper)
- 0.3-0.7: Avoid (non-physical, looks wrong)

---

### TSL Node Materials (Advanced)

**When:** WebGPU shaders for procedural effects

```typescript
<a3d-sphere
  a3dNodeMaterial
  [colorNode]="tslWaterMarble({ scale: 2, turbulence: 0.6, speed: 0.5 })"
/>
```

**Available TSL materials:**
- Water marble (swirling organic patterns)
- Procedural noise textures
- Animated shaders

---

## Lighting Techniques

### Minimal Ambient (Dramatic)

**Use for:** High-contrast, neon, particle scenes

```typescript
<a3d-ambient-light [intensity]="0.1" />
```

**Why:** Emissive materials and bloom provide glow; ambient adds subtle fill

---

### Dual Colored Point Lights

**Use for:** Cyberpunk, dual-tone color schemes

```typescript
<a3d-ambient-light [intensity]="0.1" />
<a3d-point-light [position]="[0, 0, 10]" [color]="'#00ffff'" [intensity]="2" />
<a3d-point-light [position]="[-10, 5, 5]" [color]="'#ff00ff'" [intensity]="1.5" />
```

**Tips:**
- Use complementary colors (cyan+magenta, blue+orange)
- Primary light: intensity 2-3
- Secondary light: intensity 1-2
- Position on opposite sides for separation

---

### Three-Point Lighting (Professional)

**Use for:** Product showcase, glass, high-quality renders

**Setup:**
```typescript
<a3d-ambient-light [intensity]="0.3" />

<!-- Key light (main, brightest) -->
<a3d-spot-light
  [position]="[0, 16, -6]"
  [intensity]="120"
  [angle]="0.5"
  [penumbra]="0.2"
/>

<!-- Fill light (soften shadows, colored) -->
<a3d-point-light
  [position]="[-10, 10, -10]"
  [intensity]="25"
  [color]="'#a855f7'"
/>

<!-- Rim/back light (separation, colored) -->
<a3d-point-light
  [position]="[10, 6, -8]"
  [intensity]="15"
  [color]="'#f472b6'"
/>
```

**Ratios:**
- Key:Fill:Rim = 8:2:1 (120:25:15)
- Key light from top/front
- Fill light from side (opposite key)
- Rim light from behind/side (creates halo)

---

### Dramatic Rim Lighting

**Use for:** Space, cosmic, cinematic scenes

```typescript
<a3d-ambient-light [intensity]="0.2" />

<!-- Main directional (sun) -->
<a3d-directional-light
  [position]="[15, 8, 10]"
  [intensity]="1.6"
  [color]="'white'"
/>

<!-- Rim light (opposite side, colored) -->
<a3d-directional-light
  [position]="[-10, 5, -5]"
  [intensity]="0.25"
  [color]="'#4a90d9'"
/>
```

**Effect:** Edge highlights separate objects from background, creates depth

---

### Per-Object Spotlights

**Use for:** Hero objects that need dedicated lighting

```typescript
<!-- Main object -->
<a3d-sphere [position]="[-15, 10, -15]" [args]="[3, 64, 64]" />

<!-- Dedicated spotlight targeting that object -->
<a3d-spot-light
  [position]="[-15, 10, -10]"     <!-- Above and in front -->
  [target]="[-15, 10, -15]"        <!-- Aim at object position -->
  [intensity]="40"
  [angle]="0.6"
  [penumbra]="0.3"
/>
```

**Tips:**
- Position spotlight 5-10 units in front of target
- Angle 0.5-0.8 for focused beam
- Penumbra 0.2-0.4 for soft edges
- Use for corner-framed bubbles or hero objects

---

## Animation Best Practices

### Staggered Float Timing

**Rule:** Vary delays to prevent synchronization

```typescript
<a3d-sphere
  float3d [floatConfig]="{ height: 0.4, speed: 2500, delay: 0 }"
/>
<a3d-box
  float3d [floatConfig]="{ height: 0.5, speed: 3000, delay: 200 }"
/>
<a3d-torus
  float3d [floatConfig]="{ height: 0.3, speed: 2800, delay: 400 }"
/>
```

**Pattern:**
- Height: 0.3-0.5 range
- Speed: 2500-3500ms range
- Delay: Increment by 100-200ms (0, 200, 400, 600)

**Effect:** Wave-like choreography, organic motion

---

### Variable Animation Speeds

**Rule:** Different speeds prevent uniform motion

**Rotation:**
```typescript
<a3d-torus rotate3d [rotateConfig]="{ axis: 'y', speed: 1 }" />
<a3d-box rotate3d [rotateConfig]="{ axis: 'x', speed: 0.8 }" />
<a3d-cylinder rotate3d [rotateConfig]="{ axis: 'z', speed: 0.6 }" />
```

**Speed ranges:**
- Fast: 0.8-1.4 (visible rotation)
- Medium: 0.4-0.7 (moderate spin)
- Slow: 0.1-0.3 (subtle drift)

---

### Slow Ambient Motion

**For star fields and backgrounds:**

```typescript
<a3d-star-field
  [enableRotation]="true"
  [rotationSpeed]="0.015"    <!-- Very slow -->
/>
```

**Speed guide:**
- 0.003-0.008: Barely perceptible (deep background)
- 0.008-0.015: Subtle motion (midground)
- 0.015-0.025: Noticeable (foreground)

**Pattern:** Slower = farther away (enhances parallax)

---

### Mouse Tracking Sensitivity

**Default (responsive):**
```typescript
mouseTracking3d
[trackingConfig]="{ sensitivity: 0.3, damping: 0.08 }"
```

**Sensitivity ranges:**
- 0.1-0.2: Subtle response
- 0.3-0.5: Standard response
- 0.6-1.0: Exaggerated response

**Damping ranges:**
- 0.02-0.05: Very smooth, laggy
- 0.06-0.10: Balanced (recommended)
- 0.15-0.30: Fast, snappy

---

### Combining Directives

**Pattern:** Layer multiple behaviors for rich motion

```typescript
<a3d-sphere
  float3d [floatConfig]="{ height: 0.5, speed: 3000 }"
  rotate3d [rotateConfig]="{ axis: 'y', speed: 60 }"
  mouseTracking3d [trackingConfig]="{ sensitivity: 0.3 }"
/>
```

**Best practices:**
- Float + Rotate: Most common combo
- Float + Mouse: Interactive floating objects
- Rotate + Mouse: Responsive spinning
- All three: Maximum dynamism (use sparingly)

---

## Post-Processing

### Bloom Configuration

**Strong bloom (neon scenes):**
```typescript
<a3d-bloom-effect
  [threshold]="0.5"     <!-- Low = more elements glow -->
  [strength]="1.2"      <!-- High = intense glow -->
  [radius]="0.4"        <!-- Smaller = tighter glow -->
/>
```

**Subtle bloom (refined scenes):**
```typescript
<a3d-bloom-effect
  [threshold]="0.9"     <!-- High = only brightest glow -->
  [strength]="0.3"      <!-- Low = gentle halo -->
  [radius]="0.5"        <!-- Larger = softer glow -->
/>
```

**Threshold guide:**
- 0.3-0.5: Most elements glow (electric scenes)
- 0.6-0.8: Balanced glow (standard)
- 0.9-1.0: Only very bright elements (subtle)

**Strength guide:**
- 0.2-0.4: Gentle glow
- 0.5-0.8: Moderate glow
- 1.0-1.5: Strong glow
- 1.5+: Extreme glow (neon)

---

### Selective Bloom (Advanced)

**Use when:** Precise control over which objects glow

```typescript
<a3d-effect-composer>
  <a3d-selective-bloom-effect
    [layer]="1"
    [threshold]="0"
    [strength]="1.5"
  />
</a3d-effect-composer>

<!-- This glows (auto-assigned to layer 1) -->
<a3d-glow-troika-text text="GLOW ME" />

<!-- This doesn't glow (not on bloom layer) -->
<a3d-cloud-layer />
```

**Benefits:**
- Text glows, backgrounds don't
- Hero objects glow, supporting elements don't
- Prevents unwanted bloom on large surfaces

---

### When to Skip Post-Processing

**Skip bloom for:**
- Ray-marched shaders (metaballs, marble) - already optimized
- Scenes with many large bright surfaces - bloom can overwhelm
- Performance-critical applications

**Alternative:** Use emissive materials alone

---

## Performance Optimization

### Segment Count Guidelines

**Spheres/Cylinders:**
- Mobile/Low-end: `[radius, 16, 16]`
- Standard: `[radius, 32, 32]`
- High-quality: `[radius, 64, 64]`
- Ultra (marble/glass): `[radius, 128, 128]`

**Rule:** Only use 64+ segments for hero objects with reflections/refraction

---

### Shadow Performance

```typescript
<a3d-scene-3d [enableShadows]="false">  <!-- Default OFF -->
```

**When to enable:**
- Only if shadow-casting lights present
- Only if shadows add significant value
- Be prepared for ~30% performance impact

---

### Star Field Optimization

```typescript
<!-- Balanced quality/performance -->
<a3d-star-field
  [starCount]="2000"       <!-- 2000-3000 optimal -->
  [multiSize]="true"       <!-- Minimal impact -->
  [stellarColors]="true"   <!-- Minimal impact -->
  [enableGlow]="false"     <!-- Expensive! Only when needed -->
/>
```

**Star count guide:**
- 500-1000: Sparse (background layer)
- 1000-2000: Moderate (standard)
- 2000-3000: Dense (foreground layer)
- 3000+: Very dense (use only on high-end)

---

### Particle Count Limits

```typescript
<a3d-particle-system [count]="1000" />  <!-- Safe default -->
```

**Limits:**
- Mobile: 500-1000 particles
- Desktop: 1000-5000 particles
- High-end: 5000-10000 particles

---

### Fog for Distant Culling

```typescript
<a3d-fog [color]="'#050510'" [near]="20" [far]="100" />
```

**Benefit:** Objects beyond `far` distance fade out, reducing visual complexity