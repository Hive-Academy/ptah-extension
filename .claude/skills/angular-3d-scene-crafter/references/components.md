# Component Catalog

Complete reference for @hive-academy/angular-3d components, directives, and services.

## Table of Contents

1. [Scene Container](#scene-container)
2. [Geometry Primitives](#geometry-primitives)
3. [Advanced Visual Effects](#advanced-visual-effects)
4. [Space & Cosmic](#space--cosmic)
5. [Particle Systems](#particle-systems)
6. [Text Components](#text-components)
7. [Lights](#lights)
8. [Scene Organization](#scene-organization)
9. [Post-Processing](#post-processing)
10. [Animation Directives](#animation-directives)
11. [Interaction Directives](#interaction-directives)
12. [Controls](#controls)
13. [Common Input Patterns](#common-input-patterns)

---

## Scene Container

### `<a3d-scene-3d>`
Root container creating WebGPURenderer, Scene, Camera.

**Key Inputs:**
```typescript
cameraPosition: [x, y, z] = [0, 0, 20]
cameraFov: number = 75
backgroundColor: string | number = 0x000000
enableShadows: boolean = false
frameloopMode: 'always' | 'demand' = 'always'
```

**Example:**
```html
<a3d-scene-3d
  [cameraPosition]="[0, 0, 20]"
  [backgroundColor]="0x0a0a0f"
  [enableShadows]="true">
  <!-- Components -->
</a3d-scene-3d>
```

---

## Geometry Primitives

All primitives support: `position`, `rotation`, `scale`, `color`, `wireframe`, `metalness`, `roughness`, `emissive`, `emissiveIntensity`, `castShadow`, `receiveShadow`.

### `<a3d-box>`
```typescript
args: [width, height, depth] = [1, 1, 1]
```

### `<a3d-sphere>`
```typescript
args: [radius, widthSegments, heightSegments] = [1, 32, 32]
```

### `<a3d-cylinder>`
```typescript
args: [radiusTop, radiusBottom, height, radialSegments] = [1, 1, 2, 32]
```

### `<a3d-torus>`
```typescript
args: [radius, tube, radialSegments, tubularSegments] = [1, 0.4, 16, 100]
```

### `<a3d-polyhedron>`
```typescript
args: [radius, detail] = [1, 0]
type: 'icosahedron' | 'octahedron' | 'dodecahedron' | 'tetrahedron' = 'icosahedron'
```

**Example:**
```html
<a3d-torus
  [args]="[2, 0.5, 16, 100]"
  [position]="[0, 0, -5]"
  [rotation]="[Math.PI / 4, 0, 0]"
  [color]="'#00ffff'"
  [emissive]="'#00ffff'"
  [emissiveIntensity]="2"
  [wireframe]="true"
/>
```

---

## Advanced Visual Effects

### `<a3d-marble-sphere>`
Glossy sphere with animated volumetric interior using TSL raymarching.

```typescript
radius: number = 0.2
segments: number = 64
position: [x, y, z] = [0, 0, 0]
roughness: number = 0.1
colorA: string | number = '#001a13'  // Dark interior
colorB: string | number = '#66e5b3'  // Bright interior
edgeColor: string | number = '#4cd9a8'
edgeIntensity: number = 0.6
edgePower: number = 3.0
animationSpeed: number = 0.3
iterations: number = 16  // Ray march quality (8=mobile, 16=default, 32=high)
depth: number = 0.8
```

### `<a3d-glass-sphere>`
Realistic glass sphere with refraction.

```typescript
radius: number = 1
transmission: number = 0.95
thickness: number = 0.5
ior: number = 1.5  // Index of refraction
```

### `<a3d-metaball>`
Organic metaball effect with ray-marched shader.

```typescript
preset: 'moody' | 'cosmic' | 'neon' | 'sunset' | 'holographic' | 'minimal' = 'cosmic'
mouseProximity: boolean = true
```

### `<a3d-background-cubes>`
Animated background cube grid.

---

## Space & Cosmic

### `<a3d-planet>`
Textured sphere with optional glow halo.

```typescript
position: [x, y, z] = [0, 0, 0]
radius: number = 6.5
segments: number = 64
textureUrl: string | null = null
color: string | number = 0xcccccc
metalness: number = 0.3
roughness: number = 0.7
emissive: string | number = 0x000000
emissiveIntensity: number = 0.2
scale: number = 1
glowIntensity: number = 0.8
glowColor: string | number = 0xffffff
glowDistance: number = 15
```

### `<a3d-star-field>`
Configurable star field with realistic effects.

```typescript
starCount: number = 3000
radius: number = 40
color: string | number = '#ffffff'
size: number = 0.02
opacity: number = 0.8

// Quality enhancements
multiSize: boolean = true       // Varied star sizes
stellarColors: boolean = true   // Temperature-based colors
enableGlow: boolean = false     // Sprite-based glow
enableTwinkle: boolean = false  // Opacity animation

// Movement
enableDrift: boolean = false
driftSpeed: number = 1.0
driftDirection: [x, y, z] = [-0.1, 0.05, 0]
enableRotation: boolean = false
rotationSpeed: number = 0.02
rotationAxis: 'x' | 'y' | 'z' = 'y'
```

**Example:**
```html
<a3d-star-field
  [starCount]="2000"
  [radius]="40"
  [multiSize]="true"
  [stellarColors]="true"
  [enableRotation]="true"
  [rotationSpeed]="0.015"
/>
```

### `<a3d-nebula-volumetric>`
Volumetric nebula cloud effect.

```typescript
position: [x, y, z] = [0, 0, -80]
scale: number = 50
color: string | number = '#6b21a8'
opacity: number = 0.3
```

### `<a3d-cloud-layer>`
Atmospheric cloud layer.

```typescript
count: number = 50
spread: number = 40
color: string | number = 0xffffff
opacity: number = 0.6
```

---

## Particle Systems

### `<a3d-particle-system>`
Configurable particle system with distribution patterns.

```typescript
count: number = 1000
spread: number = 10
color: string | number = 0xffffff
size: number = 0.05
opacity: number = 1.0
distribution: 'sphere' | 'box' | 'cone' = 'sphere'
position: [x, y, z] = [0, 0, 0]
```

### `<a3d-marble-particle-system>`
Particles with marble shader effect.

### `<a3d-gpu-particle-sphere>`
GPU-optimized particle sphere.

### `<a3d-sparkle-corona>`
Sparkling corona effect.

---

## Text Components

All text uses Troika for high-quality SDF rendering.

### `<a3d-troika-text>`
Production-grade 3D text.

```typescript
text: string  // REQUIRED
fontSize: number = 0.1
color: string | number = '#ffffff'
font: string | null = null  // Custom font URL
position: [x, y, z] = [0, 0, 0]
anchorX: 'left' | 'center' | 'right' = 'center'
anchorY: 'top' | 'middle' | 'bottom' = 'middle'
textAlign: 'left' | 'center' | 'right' = 'left'
```

### `<a3d-glow-troika-text>`
Text with glow effect (auto-assigned to bloom layer).

```typescript
// Same inputs as troika-text, plus:
glowIntensity: number = 2.0
```

### `<a3d-extruded-text-3d>`
3D extruded text with depth.

```typescript
text: string
depth: number = 0.2
bevelEnabled: boolean = true
```

### `<a3d-bubble-text>`
Text with bubble proximity scaling.

```typescript
text: string
animationMode: 'breathe' | 'pulse' | 'none' = 'breathe'
animationSpeed: number = 0.3
animationIntensity: number = 0.4
```

### `<a3d-particle-text>`
Text formed by particles.

---

## Lights

### `<a3d-ambient-light>`
Global ambient illumination.

```typescript
color: string | number = 'white'
intensity: number = 1
```

### `<a3d-directional-light>`
Directional light (like sun).

```typescript
position: [x, y, z] = [0, 0, 0]
target: [x, y, z] = [0, 0, 0]
color: string | number = 'white'
intensity: number = 1
castShadow: boolean = false
```

### `<a3d-point-light>`
Point light (like lightbulb).

```typescript
position: [x, y, z] = [0, 0, 0]
color: string | number = 'white'
intensity: number = 1
distance: number = 0  // 0 = infinite
decay: number = 2
castShadow: boolean = false
```

### `<a3d-spot-light>`
Spotlight (like flashlight).

```typescript
position: [x, y, z] = [0, 0, 0]
target: [x, y, z] = [0, 0, 0]
color: string | number = 'white'
intensity: number = 1
distance: number = 0
angle: number = Math.PI / 3
penumbra: number = 0
decay: number = 2
castShadow: boolean = false
```

---

## Scene Organization

### `<a3d-group>`
Container for organizing/transforming objects together.

```typescript
position: [x, y, z] = [0, 0, 0]
rotation: [x, y, z] = [0, 0, 0]
scale: [x, y, z] = [1, 1, 1]
```

### `<a3d-fog>`
Atmospheric fog.

```typescript
color: string | number = 'white'
// Linear fog (default)
near: number | undefined = undefined
far: number = 1000
// OR Exponential fog
density: number | undefined = undefined
```

### `<a3d-environment>`
Environment map for PBR reflections.

```typescript
preset: 'sunset' | 'dawn' | 'night' | 'warehouse' | 'forest' | 'apartment' | 'studio' | 'city' | 'park' | 'lobby' = 'sunset'
intensity: number = 1.0
```

---

## Post-Processing

All effects must be wrapped in `<a3d-effect-composer>`.

### `<a3d-bloom-effect>`
Bloom/glow effect.

```typescript
threshold: number = 0.9  // Brightness threshold (0-1)
strength: number = 0.3   // Bloom intensity
radius: number = 0.5     // Blur spread
```

**Examples:**
```html
<!-- Strong bloom for neon -->
<a3d-bloom-effect [threshold]="0.5" [strength]="1.2" [radius]="0.4" />

<!-- Subtle bloom for refinement -->
<a3d-bloom-effect [threshold]="0.9" [strength]="0.3" [radius]="0.5" />
```

### `<a3d-selective-bloom-effect>`
Layer-based bloom control.

```typescript
layer: number = 1        // Bloom layer number
threshold: number = 0
strength: number = 1.5
```

Objects must be assigned to the bloom layer to glow. `<a3d-glow-troika-text>` auto-assigns to layer 1.

---

## Animation Directives

### `float3d`
Smooth floating/bobbing animation.

```typescript
interface FloatConfig {
  height?: number;        // Vertical displacement (default: 0.3)
  speed?: number;         // Full cycle duration in ms (default: 2000)
  delay?: number;         // Start delay in ms (default: 0)
  ease?: string;          // GSAP easing (default: 'sine.inOut')
  autoStart?: boolean;    // Auto-play (default: true)
}
```

**Example:**
```html
<a3d-sphere
  float3d
  [floatConfig]="{
    height: 0.5,
    speed: 2500,
    delay: 200,
    ease: 'sine.inOut'
  }"
/>
```

### `rotate3d`
Continuous rotation animation.

```typescript
interface RotateConfig {
  axis?: 'x' | 'y' | 'z' | 'xyz';
  speed?: number;         // Seconds for 360° (default: 60)
  xSpeed?: number;        // X-axis speed (for xyz mode)
  ySpeed?: number;        // Y-axis speed (for xyz mode)
  zSpeed?: number;        // Z-axis speed (for xyz mode)
  direction?: 1 | -1;     // 1=CW, -1=CCW (default: 1)
  autoStart?: boolean;
  ease?: string;          // GSAP easing (default: 'none')
}
```

**Example:**
```html
<!-- Single-axis -->
<a3d-planet rotate3d [rotateConfig]="{ axis: 'y', speed: 60 }" />

<!-- Multi-axis tumble -->
<a3d-asteroid
  rotate3d
  [rotateConfig]="{
    axis: 'xyz',
    xSpeed: 10,
    ySpeed: 20,
    zSpeed: 5
  }"
/>
```

### `glow3d`
Glow effect on objects (requires bloom).

---

## Interaction Directives

### `mouseTracking3d`
Makes objects follow mouse movement.

```typescript
interface TrackingConfig {
  sensitivity?: number;        // Movement amount (default: 0.3)
  damping?: number;            // Smoothing (default: 0.08)
  limit?: number;              // Max movement (default: 1)
  invertX?: boolean;           // Reverse X rotation
  invertY?: boolean;           // Reverse Y rotation
  translationRange?: [number, number];  // [X range, Y range]
  invertPosX?: boolean;        // Reverse X position
  invertPosY?: boolean;        // Reverse Y position
}
```

**Example:**
```html
<a3d-box
  mouseTracking3d
  [trackingConfig]="{
    sensitivity: 0.3,
    damping: 0.08
  }"
/>
```

---

## Controls

### `<a3d-orbit-controls>`
Camera orbit controls (drag to rotate, scroll to zoom).

```typescript
enableDamping: boolean = true
dampingFactor: number = 0.05
minDistance: number = 0
maxDistance: number = Infinity
minPolarAngle: number = 0
maxPolarAngle: number = Math.PI
enableZoom: boolean = true
enablePan: boolean = true
enableRotate: boolean = true
autoRotate: boolean = false
autoRotateSpeed: number = 2.0
```

---

## Common Input Patterns

### Transform Inputs (Most Components)
```typescript
position: [x, y, z] = [0, 0, 0]
rotation: [x, y, z] = [0, 0, 0]  // Radians
scale: [x, y, z] = [1, 1, 1]
```

### Material Inputs (Geometry Components)
```typescript
color: string | number = 0xffffff
wireframe: boolean = false
metalness: number = 0.3
roughness: number = 0.5
emissive: string | number = 0x000000
emissiveIntensity: number = 1
```

### Shadow Inputs (Most Components)
```typescript
castShadow: boolean = false
receiveShadow: boolean = false
```

### Advanced Material Properties (Glass/Transmission)
```typescript
transmission: number = 0.9      // Light transmission (0-1)
thickness: number = 0.5         // Glass thickness
ior: number = 1.4               // Index of refraction (glass ~1.5, water ~1.33)
clearcoat: number = 1.0         // Glossy outer layer (0-1)
clearcoatRoughness: number = 0.0  // Clearcoat smoothness (0-1)
```

### Iridescence (Soap Bubble Effect)
```typescript
iridescence: number = 1.0       // Strength (0-1)
iridescenceIOR: number = 1.3    // Refractive index
iridescenceThicknessMin: number = 100  // Min thickness (nm)
iridescenceThicknessMax: number = 400  // Max thickness (nm)
```