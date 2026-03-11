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
<a3d-scene-3d [cameraPosition]="[0, 0, 20]" [backgroundColor]="0x0a0a0f" [enableShadows]="true">
  <!-- Components -->
</a3d-scene-3d>
```

---

## Geometry Primitives

All primitives support: `position`, `rotation`, `scale`, `color`, `wireframe`, `metalness`, `roughness`, `emissive`, `emissiveIntensity`, `castShadow`, `receiveShadow`.

### `<a3d-box>`

```typescript
args: [width, height, depth] = [1, 1, 1];
```

### `<a3d-sphere>`

```typescript
args: [radius, widthSegments, heightSegments] = [1, 32, 32];
```

### `<a3d-cylinder>`

```typescript
args: [radiusTop, radiusBottom, height, radialSegments] = [1, 1, 2, 32];
```

### `<a3d-torus>`

```typescript
args: [radius, tube, radialSegments, tubularSegments] = [1, 0.4, 16, 100];
```

### `<a3d-polyhedron>`

```typescript
args: [radius, detail] = [1, 0]
type: 'icosahedron' | 'octahedron' | 'dodecahedron' | 'tetrahedron' = 'icosahedron'
```

**Example:**

```html
<a3d-torus [args]="[2, 0.5, 16, 100]" [position]="[0, 0, -5]" [rotation]="[Math.PI / 4, 0, 0]" [color]="'#00ffff'" [emissive]="'#00ffff'" [emissiveIntensity]="2" [wireframe]="true" />
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
radius: number = 1;
transmission: number = 0.95;
thickness: number = 0.5;
ior: number = 1.5; // Index of refraction
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

## Metaball System

### `<a3d-metaball-scene>`

Ray-marched metaball scene with presets and mouse proximity effect.

```typescript
preset: MetaballPreset = 'cosmic'; // 'moody' | 'cosmic' | 'neon' | 'sunset' | 'holographic' | 'minimal'
smoothness: number = 0.6; // Metaball blend smoothness
mouseProximityEffect: boolean = true; // Cursor interaction
animationSpeed: number = 0.4; // Animation speed multiplier
movementScale: number = 1; // Movement amplitude
fullscreen: boolean = true; // Fill container
```

**Example (from Metaball Hero):**

```html
<a3d-metaball-scene [preset]="'cosmic'" [smoothness]="0.6" [mouseProximityEffect]="true" [animationSpeed]="0.4" [fullscreen]="true">
  <!-- Metaball spheres go inside -->
  <a3d-metaball-sphere positionPreset="top-left" [radius]="0.7" />
  <a3d-metaball-sphere positionPreset="bottom-right" [radius]="0.7" />

  <!-- Orbiting spheres -->
  <a3d-metaball-sphere [orbit]="{ radius: 0.15, speed: 0.4 }" [radius]="0.06" />

  <!-- Cursor follower -->
  <a3d-metaball-cursor [radiusMin]="0.04" [radiusMax]="0.08" [glowIntensity]="0.35" />
</a3d-metaball-scene>
```

### `<a3d-metaball-sphere>`

Individual metaball sphere within a metaball scene.

```typescript
position: [x, y] = [0.5, 0.5]           // Normalized position (0-1)
positionPreset: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center'
radius: number = 0.1                     // Sphere radius (normalized)
orbit: { radius: number, speed: number, phase?: number } | null = null  // Orbital motion
```

### `<a3d-metaball-cursor>`

Cursor-following metaball with glow effect.

```typescript
radiusMin: number = 0.04; // Minimum radius
radiusMax: number = 0.08; // Maximum radius (when moving)
glowRadius: number = 0.25; // Glow area radius
glowIntensity: number = 0.35; // Glow brightness
smoothness: number = 1.0; // Following smoothness
```

---

## Advanced Sphere Components

### `<a3d-floating-sphere>`

Sphere with glass/transmission material properties built-in.

```typescript
args: [radius, widthSegments, heightSegments] = [1, 32, 32]
position: [x, y, z] = [0, 0, 0]
color: string | number = '#ffffff'

// Glass material properties
transmission: number = 0.9              // Light transmission (0-1)
thickness: number = 0.5                 // Glass thickness
ior: number = 1.4                       // Index of refraction
clearcoat: number = 1.0                 // Clearcoat layer
clearcoatRoughness: number = 0.0        // Clearcoat roughness
roughness: number = 0.0                 // Surface roughness
metalness: number = 0.0                 // Metalness

// Iridescence (soap bubble effect)
iridescence: number = 0                 // Iridescence strength (0-1)
iridescenceIOR: number = 1.3            // Iridescence refractive index
iridescenceThicknessMin: number = 100   // Min thickness (nm)
iridescenceThicknessMax: number = 400   // Max thickness (nm)
```

**Example (from Bubble Dream Hero):**

```html
<a3d-floating-sphere
  float3d
  [floatConfig]="{ height: 0.6, speed: 4000 }"
  [position]="[-15, 10, -15]"
  [args]="[2, 32, 32]"
  [color]="'#e879f9'"
  [transmission]="0.9"
  [thickness]="0.5"
  [ior]="1.4"
  [clearcoat]="1.0"
  [clearcoatRoughness]="0.0"
  mouseTracking3d
  [trackingConfig]="{
    sensitivity: 0.8,
    limit: 0.5,
    damping: 0.05,
    invertX: true,
    translationRange: [10, 5],
    invertPosX: true
  }"
/>
```

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
position: [x, y, z] = [0, 0, 0]

// Quality enhancements
multiSize: boolean = true               // Varied star sizes
stellarColors: boolean = true           // Temperature-based colors
enableGlow: boolean = false             // Sprite-based glow
enableTwinkle: boolean = false          // Opacity animation

// Movement
enableDrift: boolean = false
driftSpeed: number = 1.0
driftDirection: [x, y, z] = [-0.1, 0.05, 0]
enableRotation: boolean = false
rotationSpeed: number = 0.02
rotationAxis: 'x' | 'y' | 'z' = 'y'
```

**Example (multi-layer parallax from Hero Space):**

```html
<!-- Layer 1: Close stars (larger, brighter) - slow rotation -->
<a3d-star-field [starCount]="2000" [radius]="40" [size]="0.035" [multiSize]="true" [stellarColors]="true" [enableRotation]="true" [rotationSpeed]="0.008" [rotationAxis]="'y'" />

<!-- Layer 2: Mid-range stars - slightly slower rotation -->
<a3d-star-field [starCount]="1500" [radius]="55" [size]="0.025" [multiSize]="true" [stellarColors]="true" [enableRotation]="true" [rotationSpeed]="0.005" [rotationAxis]="'y'" />

<!-- Layer 3: Distant stars (smaller, dimmer) - slowest rotation for parallax -->
<a3d-star-field [starCount]="1500" [radius]="70" [size]="0.018" [opacity]="0.5" [multiSize]="true" [stellarColors]="true" [enableRotation]="true" [rotationSpeed]="0.003" [rotationAxis]="'y'" />
```

**Example (counter-rotating for depth from Particle Storm):**

```html
<!-- Foreground - clockwise rotation -->
<a3d-star-field [starCount]="3000" [radius]="50" [size]="0.03" [stellarColors]="true" [enableRotation]="true" [rotationSpeed]="0.015" [rotationAxis]="'z'" float3d [floatConfig]="{ height: 0.8, speed: 3000, delay: 500, ease: 'power1.inOut' }" />

<!-- Background - counter-clockwise for parallax -->
<a3d-star-field [starCount]="2000" [radius]="70" [size]="0.02" [opacity]="0.6" [stellarColors]="true" [enableRotation]="true" [rotationSpeed]="-0.008" [rotationAxis]="'z'" />
```

### `<a3d-nebula-volumetric>`

Volumetric nebula cloud effect with advanced options.

```typescript
position: [x, y, z] = [0, 0, -80]
width: number = 50                       // Nebula width
height: number = 35                      // Nebula height
scale: number = 50                       // Overall scale

// Colors
primaryColor: string | number = '#6b21a8'    // Main color
secondaryColor: string | number = '#0f172a'  // Secondary blend
tertiaryColor: string | number | undefined   // Optional third color
opacity: number = 0.3                    // Overall opacity

// Noise & density
noiseScale: number = 3.5                 // Noise pattern scale
density: number = 1.2                    // Cloud density
centerFalloff: number = 1.2              // Center fade
erosionStrength: number = 0.65           // Edge erosion

// Glow
glowIntensity: number = 0.6              // Glow brightness

// Animation
enableFlow: boolean = false              // Enable flowing motion
flowSpeed: number = 0.25                 // Flow animation speed
enableEdgePulse: boolean = true          // Pulsing edge effect
edgePulseSpeed: number = 0.3             // Pulse speed
edgePulseAmount: number = 0.2            // Pulse intensity
```

**Example (from Hero Space Scene):**

```html
<a3d-nebula-volumetric [position]="[8, 4, -80]" [width]="250" [height]="80" [opacity]="0.75" [primaryColor]="'#6b21a8'" [secondaryColor]="'#0f172a'" [enableFlow]="false" [noiseScale]="3.5" [density]="1.2" [glowIntensity]="0.6" [centerFalloff]="1.2" [erosionStrength]="0.65" [enableEdgePulse]="true" [edgePulseSpeed]="0.3" [edgePulseAmount]="0.2" />
```

**Example (from Particle Storm - electric storm):**

```html
<a3d-nebula-volumetric [position]="[0, -20, -80]" [width]="180" [height]="90" [opacity]="0.6" [primaryColor]="'#00d4ff'" [secondaryColor]="'#8b5cf6'" [tertiaryColor]="'#06b6d4'" [enableFlow]="true" [flowSpeed]="0.25" [noiseScale]="2.5" [density]="1.3" [glowIntensity]="0.8" [enableEdgePulse]="true" [edgePulseSpeed]="0.4" [edgePulseAmount]="0.25" />
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
glowIntensity: number = 2.0;
```

### `<a3d-extruded-text-3d>`

3D extruded text with depth.

```typescript
text: string;
depth: number = 0.2;
bevelEnabled: boolean = true;
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

```typescript
text: string                             // REQUIRED - Text to display
fontSize: number = 60                    // Font size in pixels
position: [x, y, z] = [0, 0, 0]
particleColor: string | number = 0xffffff
opacity: number = 0.25

// Particle configuration
sampleStep: number = 2                   // Sampling density
fontScaleFactor: number = 0.06           // Scale relative to scene
particlesPerPixel: number = 0.6          // Particle density
maxParticleScale: number = 0.6           // Max particle size

// Layout
lineHeightMultiplier: number = 2.5       // Multi-line spacing
skipInitialGrowth: boolean = true        // Skip entrance animation
```

**Example (from Particle Storm):**

```html
<a3d-particle-text [text]="'PARTICLE STORM'" [fontSize]="60" [sampleStep]="2" [fontScaleFactor]="0.06" [particleColor]="0xa1ff4f" [opacity]="0.25" [maxParticleScale]="0.6" [particlesPerPixel]="0.6" [position]="[0, 4, -10]" [skipInitialGrowth]="true" [lineHeightMultiplier]="2.5" />
```

---

## TSL Node Materials

### `a3dNodeMaterial` Directive

Apply TSL (Three.js Shading Language) procedural materials to objects.

```typescript
colorNode: TSLNode; // TSL color function result
```

**Available TSL Functions:**

```typescript
// Animated water marble texture
tslWaterMarble({
  scale: (number = 2), // Pattern scale
  turbulence: (number = 0.6), // Noise turbulence
  speed: (number = 0.5), // Animation speed
});
```

**Example (from Hero Space - procedural planet):**

```html
<a3d-sphere [args]="[4, 32, 32]" [position]="[0, 0, 0]" [roughness]="0.1" [metalness]="0.0" a3dNodeMaterial [colorNode]="tslWaterMarble({ scale: 2, turbulence: 0.6, speed: 0.5 })" />
```

**In component class:**

```typescript
import { tslWaterMarble } from '@hive-academy/angular-3d';

export class MyComponent {
  protected readonly marbleTexture = tslWaterMarble({
    scale: 2,
    turbulence: 0.6,
    speed: 0.5,
  });
}
```

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
position: [x, y, z] = [0, 0, 0];
rotation: [x, y, z] = [0, 0, 0];
scale: [x, y, z] = [1, 1, 1];
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
threshold: number = 0.9; // Brightness threshold (0-1)
strength: number = 0.3; // Bloom intensity
radius: number = 0.5; // Blur spread
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
layer: number = 1; // Bloom layer number
threshold: number = 0;
strength: number = 1.5;
```

Objects must be assigned to the bloom layer to glow. `<a3d-glow-troika-text>` auto-assigns to layer 1.

---

## Animation Directives

### `float3d`

Smooth floating/bobbing animation.

```typescript
interface FloatConfig {
  height?: number; // Vertical displacement (default: 0.3)
  speed?: number; // Full cycle duration in ms (default: 2000)
  delay?: number; // Start delay in ms (default: 0)
  ease?: string; // GSAP easing (default: 'sine.inOut')
  autoStart?: boolean; // Auto-play (default: true)
}
```

**Example (staggered choreography from Floating Geometry):**

```html
<!-- Stagger delays create wave-like motion -->
<a3d-polyhedron [type]="'icosahedron'" [position]="[-6, 3, 0]" [color]="'#6366f1'" float3d [floatConfig]="{ height: 0.4, speed: 2500, ease: 'sine.inOut' }" />

<a3d-polyhedron [type]="'octahedron'" [position]="[5, 4, -2]" [color]="'#10b981'" float3d [floatConfig]="{ height: 0.5, speed: 3000, delay: 200, ease: 'sine.inOut' }" />

<a3d-polyhedron [type]="'dodecahedron'" [position]="[0, 0, 2]" [color]="'#f59e0b'" float3d [floatConfig]="{ height: 0.3, speed: 2800, delay: 400, ease: 'sine.inOut' }" />
```

**Example (with star field from Particle Storm):**

```html
<a3d-star-field
  [starCount]="3000"
  [radius]="50"
  float3d
  [floatConfig]="{
    height: 0.8,
    speed: 3000,
    delay: 500,
    ease: 'power1.inOut',
    autoStart: true
  }"
/>
```

### `rotate3d`

Continuous rotation animation.

```typescript
interface RotateConfig {
  axis?: 'x' | 'y' | 'z' | 'xyz';
  speed?: number; // Seconds for 360° (default: 60)
  xSpeed?: number; // X-axis speed (for xyz mode)
  ySpeed?: number; // Y-axis speed (for xyz mode)
  zSpeed?: number; // Z-axis speed (for xyz mode)
  direction?: 1 | -1; // 1=CW, -1=CCW (default: 1)
  autoStart?: boolean;
  ease?: string; // GSAP easing (default: 'none')
}
```

**Example (neon toruses from Crystal Grid):**

```html
<!-- Different axes for unique motion signatures -->
<a3d-torus [position]="[-8, 4, 0]" [color]="'#00ffff'" [wireframe]="true" [emissive]="'#00ffff'" [emissiveIntensity]="2" rotate3d [rotateConfig]="{ axis: 'y', speed: 1 }" />

<a3d-torus [position]="[8, -4, 0]" [color]="'#ff00ff'" [wireframe]="true" [emissive]="'#ff00ff'" [emissiveIntensity]="2" rotate3d [rotateConfig]="{ axis: 'x', speed: 0.8 }" />

<a3d-torus [position]="[0, 0, -5]" [color]="'#ffff00'" [wireframe]="true" [emissive]="'#ffff00'" [emissiveIntensity]="2" rotate3d [rotateConfig]="{ axis: 'z', speed: 0.6 }" />
```

### `glow3d`

Glow effect on objects (requires bloom).

```typescript
interface GlowConfig {
  glowColor?: string | number;
  glowIntensity?: number; // Default: 0.3
  glowScale?: number; // Default: 1.3
}
```

**Example (from Crystal Grid):**

```html
<a3d-torus [color]="'#00ffff'" [emissive]="'#00ffff'" [emissiveIntensity]="2" a3dGlow3d [glowColor]="'#00ffff'" [glowIntensity]="0.3" [glowScale]="1.3" />
```

---

## Interaction Directives

### `mouseTracking3d`

Makes objects follow mouse movement.

```typescript
interface TrackingConfig {
  sensitivity?: number; // Movement amount (default: 0.3)
  damping?: number; // Smoothing (default: 0.08)
  limit?: number; // Max movement (default: 1)
  invertX?: boolean; // Reverse X rotation
  invertY?: boolean; // Reverse Y rotation
  translationRange?: [number, number]; // [X range, Y range]
  invertPosX?: boolean; // Reverse X position
  invertPosY?: boolean; // Reverse Y position
}
```

**Example (standard tracking from Floating Geometry):**

```html
<a3d-polyhedron [type]="'icosahedron'" [position]="[-6, 3, 0]" [color]="'#6366f1'" mouseTracking3d [trackingConfig]="{ sensitivity: 0.3, damping: 0.08 }" />
```

**Example (inverted for parallax depth from Bubble Dream):**

```html
<!-- Corner bubbles with inverted tracking create depth parallax -->
<a3d-floating-sphere
  [position]="[-15, 10, -15]"
  [args]="[2, 32, 32]"
  [color]="'#e879f9'"
  [transmission]="0.9"
  mouseTracking3d
  [trackingConfig]="{
    sensitivity: 0.8,
    limit: 0.5,
    damping: 0.05,
    invertX: true,
    translationRange: [10, 5],
    invertPosX: true
  }"
/>

<!-- Bottom corner - invert Y instead of X -->
<a3d-floating-sphere
  [position]="[-12, -8, -13]"
  [args]="[1.8, 32, 32]"
  [color]="'#f472b6'"
  [transmission]="0.9"
  mouseTracking3d
  [trackingConfig]="{
    sensitivity: 0.8,
    limit: 0.5,
    damping: 0.05,
    invertY: true,
    translationRange: [10, 5],
    invertPosY: true
  }"
/>
```

**Parallax Pattern:**

- Center objects: normal tracking `{ sensitivity: 0.3, damping: 0.08 }`
- Corner/background objects: inverted tracking for depth parallax
- Use `invertX`/`invertY` for rotation inversion
- Use `invertPosX`/`invertPosY` for position inversion
- Higher `translationRange` values = more position movement

---

## Controls

### `<a3d-orbit-controls>`

Camera orbit controls (drag to rotate, scroll to zoom).

```typescript
enableDamping: boolean = true;
dampingFactor: number = 0.05;
minDistance: number = 0;
maxDistance: number = Infinity;
minPolarAngle: number = 0;
maxPolarAngle: number = Math.PI;
enableZoom: boolean = true;
enablePan: boolean = true;
enableRotate: boolean = true;
autoRotate: boolean = false;
autoRotateSpeed: number = 2.0;
```

---

## Common Input Patterns

### Transform Inputs (Most Components)

```typescript
position: [x, y, z] = [0, 0, 0];
rotation: [x, y, z] = [0, 0, 0]; // Radians
scale: [x, y, z] = [1, 1, 1];
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
castShadow: boolean = false;
receiveShadow: boolean = false;
```

### Advanced Material Properties (Glass/Transmission)

```typescript
transmission: number = 0.9; // Light transmission (0-1)
thickness: number = 0.5; // Glass thickness
ior: number = 1.4; // Index of refraction (glass ~1.5, water ~1.33)
clearcoat: number = 1.0; // Glossy outer layer (0-1)
clearcoatRoughness: number = 0.0; // Clearcoat smoothness (0-1)
```

### Iridescence (Soap Bubble Effect)

```typescript
iridescence: number = 1.0; // Strength (0-1)
iridescenceIOR: number = 1.3; // Refractive index
iridescenceThicknessMin: number = 100; // Min thickness (nm)
iridescenceThicknessMax: number = 400; // Max thickness (nm)
```
