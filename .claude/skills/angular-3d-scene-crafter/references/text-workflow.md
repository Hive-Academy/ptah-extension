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

Recommend components from [components.md](components.md) based on scene type:

**For geometric scenes:**

- `<a3d-box>`, `<a3d-sphere>`, `<a3d-cylinder>`, `<a3d-torus>`, `<a3d-polyhedron>`

**For space/cosmic:**

- `<a3d-planet>`, `<a3d-star-field>`, `<a3d-nebula-volumetric>`

**For effects:**

- `<a3d-particle-system>`, `<a3d-marble-sphere>`, `<a3d-glass-sphere>`, `<a3d-metaball>`

**For text:**

- `<a3d-troika-text>`, `<a3d-glow-troika-text>`, `<a3d-bubble-text>`, `<a3d-particle-text>`

Apply composition patterns from [patterns.md](patterns.md):

- **Grid distribution** - Evenly spaced objects
- **Asymmetric scatter** - Irregular positioning for organic feel
- **Corner framing** - Objects at edges frame central content
- **Focal clustering** - Size hierarchy with primary focus
- **Layered depth** - Z-position ranges (0 to -80)

#### C. Materials & Colors

Configure materials based on aesthetic. See [best-practices.md](best-practices.md) for detailed guidance.

**Quick material patterns:**

**Emissive wireframe (neon):**

```typescript
[wireframe]="true" [emissive]="'#00ffff'" [emissiveIntensity]="2" [color]="'#00ffff'"
```

**Glass/transparent:**

```typescript
[transmission]="0.9" [thickness]="0.5" [ior]="1.4" [clearcoat]="1.0" [clearcoatRoughness]="0.0" [roughness]="0.0"
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
[transmission]="0.9" [iridescence]="1.0" [iridescenceIOR]="1.3" [iridescenceThicknessMin]="100" [iridescenceThicknessMax]="400"
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

Add directives for motion. See [components.md](components.md) for directive details.

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
    <a3d-scene-3d [cameraPosition]="[0, 0, 20]" [backgroundColor]="0x0a0a0f">
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
  `,
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
