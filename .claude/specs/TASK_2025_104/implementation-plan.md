# Implementation Plan - TASK_2025_104

## Landing Page Premium Redesign

---

## 1. Architecture Overview

### Component Hierarchy

```
LandingPageComponent (orchestrator)
├── HeroSectionComponent
│   ├── Hero3dSceneComponent (@hive-academy/angular-3d)
│   │   ├── a3d-scene-3d (container)
│   │   ├── a3d-star-field (x2 layers for parallax)
│   │   ├── a3d-nebula-volumetric (backdrop)
│   │   ├── a3d-sphere (x4-5 glass spheres, Corner Framing)
│   │   ├── a3d-ambient-light
│   │   ├── a3d-spot-light (key)
│   │   ├── a3d-point-light (fill, rim, per-sphere)
│   │   ├── a3d-environment (sunset preset)
│   │   └── a3d-effect-composer > a3d-bloom-effect
│   └── HeroContentOverlayComponent (HTML/CSS content)
├── DemoSectionComponent
│   └── GlassmorphismWindowComponent
├── FeaturesHijackedScrollComponent (@hive-academy/angular-gsap)
│   └── agsp-hijacked-scroll-timeline
│       └── hijackedScrollItem (x6 fullscreen feature slides)
│           └── FeatureSlideComponent (per-feature fullscreen content)
├── ComparisonSplitScrollComponent (@hive-academy/angular-gsap)
│   └── agsp-parallax-split-scroll
│       ├── parallaxSplitItem [layout="left"] (Before Ptah)
│       └── parallaxSplitItem [layout="right"] (With Ptah)
└── CtaSectionComponent
```

### Key Architecture Decisions

**CRITICAL**: Use advanced angular-gsap components instead of basic cards:

1. **Features Section**: Replace static cards with `agsp-hijacked-scroll-timeline`

   - Each feature gets a **full viewport slide**
   - Dramatic slide-in effects via `hijackedScrollItem`
   - Step indicator for navigation
   - Much more premium than static grid cards

2. **Comparison Section**: Replace before/after cards with `agsp-parallax-split-scroll`
   - Split-screen layout with parallax effect
   - Content/visual alternate sides as user scrolls
   - Much more dynamic than static comparison cards

### Data Flow

```
Signals Architecture:
┌─────────────────────────────────────────────────────────────┐
│  LandingPageComponent                                        │
│  ├── scrollProgress = signal<number>(0)                     │
│  ├── activeSection = signal<string>('hero')                 │
│  └── reducedMotion = signal<boolean>(false)                 │
├─────────────────────────────────────────────────────────────┤
│  @hive-academy/angular-gsap                                  │
│  ├── LenisSmoothScrollService (global smooth scrolling)     │
│  ├── scrollAnimation directive (section animations)         │
│  └── viewportAnimation directive (entry animations)         │
├─────────────────────────────────────────────────────────────┤
│  @hive-academy/angular-3d                                    │
│  ├── Scene3dComponent (WebGPU/WebGL renderer)               │
│  ├── float3d directive (sphere animations)                   │
│  ├── mouseTracking3d directive (parallax on hover)           │
│  └── EffectComposerComponent (bloom post-processing)         │
└─────────────────────────────────────────────────────────────┘
```

### Library Integration Approach

**@hive-academy/angular-3d**:

- All 3D rendering via declarative components (no raw THREE.\*)
- Scene cleanup handled automatically by library
- WebGPU preferred with WebGL fallback
- Environment maps for glass material realism

**@hive-academy/angular-gsap**:

- Scroll animations via `scrollAnimation` directive
- Entry animations via `viewportAnimation` directive
- Smooth scrolling via `LenisSmoothScrollService`
- Reduced motion support built-in via `prefers-reduced-motion` media query

---

## 2. Files to Delete

### Previous Implementation (TASK_2025_072)

Based on codebase investigation, **no existing landing page implementation files exist** in the codebase. The previous TASK_2025_072 was a design/planning task that did not result in committed code.

**Files to delete**: NONE

**Verification**:

- Grep for `Three|THREE|@three` in webview src: No files found
- Grep for `gsap|ScrollTrigger|GSAP` in webview src: No files found
- Grep for `landing|Landing` in webview src: No files found
- Glob for `*hero*.ts` in webview: No files found

**Conclusion**: This is a greenfield implementation. No cleanup required.

---

## 3. Files to Create/Modify

### 3.1 New Library: libs/frontend/landing

#### Create New Nx Library

```bash
nx g @nx/angular:library landing --directory=libs/frontend/landing --standalone --style=css --changeDetection=OnPush
```

#### File Structure

```
libs/frontend/landing/
├── src/
│   ├── index.ts                                    # Public API exports
│   ├── lib/
│   │   ├── components/
│   │   │   ├── landing-page.component.ts           # Main orchestrator
│   │   │   ├── hero-section/
│   │   │   │   ├── hero-section.component.ts       # Hero container
│   │   │   │   ├── hero-3d-scene.component.ts      # 3D Glass/Cosmic scene
│   │   │   │   └── hero-content-overlay.component.ts # HTML content
│   │   │   ├── demo-section/
│   │   │   │   ├── demo-section.component.ts       # Demo container
│   │   │   │   └── glassmorphism-window.component.ts # macOS-style window
│   │   │   ├── features-section/
│   │   │   │   ├── features-hijacked-scroll.component.ts  # ★ Hijacked scroll timeline
│   │   │   │   └── feature-slide.component.ts             # ★ Fullscreen slide
│   │   │   ├── comparison-section/
│   │   │   │   └── comparison-split-scroll.component.ts   # ★ Parallax split scroll
│   │   │   └── cta-section/
│   │   │       └── cta-section.component.ts        # Final CTA
│   │   ├── services/
│   │   │   └── landing-content.service.ts          # Content data
│   │   └── types/
│   │       └── landing.types.ts                    # Type definitions
├── project.json                                     # Nx project config
├── tsconfig.lib.json                               # TypeScript config
└── CLAUDE.md                                        # Library documentation
```

**★ = Advanced angular-gsap components replacing basic cards**

### 3.2 Files to Create

| File Path                                                                                          | Purpose               | Key Imports                                                  |
| -------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------ |
| `libs/frontend/landing/src/index.ts`                                                               | Public API            | Exports all components                                       |
| `libs/frontend/landing/src/lib/components/landing-page.component.ts`                               | Main orchestrator     | angular-gsap, all section components                         |
| `libs/frontend/landing/src/lib/components/hero-section/hero-section.component.ts`                  | Hero container        | Hero3dScene, HeroContentOverlay                              |
| `libs/frontend/landing/src/lib/components/hero-section/hero-3d-scene.component.ts`                 | 3D scene              | @hive-academy/angular-3d                                     |
| `libs/frontend/landing/src/lib/components/hero-section/hero-content-overlay.component.ts`          | Hero HTML             | angular-gsap viewportAnimation                               |
| `libs/frontend/landing/src/lib/components/demo-section/demo-section.component.ts`                  | Demo section          | GlassmorphismWindow, scrollAnimation                         |
| `libs/frontend/landing/src/lib/components/demo-section/glassmorphism-window.component.ts`          | Window UI             | CSS only                                                     |
| `libs/frontend/landing/src/lib/components/features-section/features-hijacked-scroll.component.ts`  | ★ Fullscreen features | HijackedScrollTimelineComponent, HijackedScrollItemDirective |
| `libs/frontend/landing/src/lib/components/features-section/feature-slide.component.ts`             | ★ Feature slide       | NgClass                                                      |
| `libs/frontend/landing/src/lib/components/comparison-section/comparison-split-scroll.component.ts` | ★ Split scroll        | ParallaxSplitScrollComponent, ParallaxSplitItemDirective     |
| `libs/frontend/landing/src/lib/components/cta-section/cta-section.component.ts`                    | Final CTA             | viewportAnimation                                            |
| `libs/frontend/landing/src/lib/services/landing-content.service.ts`                                | Content data          | None                                                         |
| `libs/frontend/landing/src/lib/types/landing.types.ts`                                             | Type defs             | None                                                         |
| `libs/frontend/landing/CLAUDE.md`                                                                  | Documentation         | None                                                         |

**★ = Uses advanced angular-gsap components (not basic cards)**

### 3.3 Files to Modify

| File Path                                                                      | Change Type | Description                                 |
| ------------------------------------------------------------------------------ | ----------- | ------------------------------------------- |
| `apps/ptah-extension-webview/src/app/app.config.ts`                            | MODIFY      | Add provideGsap(), provideLenis() providers |
| `apps/ptah-extension-webview/src/app/app.ts`                                   | MODIFY      | Initialize Lenis in afterNextRender         |
| `libs/frontend/chat/src/lib/components/templates/app-shell.component.ts`       | MODIFY      | Add 'landing' view case                     |
| `libs/frontend/chat/src/lib/components/templates/app-shell.component.html`     | MODIFY      | Add @case for landing view                  |
| `libs/frontend/core/src/lib/services/navigation/webview-navigation.service.ts` | MODIFY      | Add 'landing' to ViewType                   |
| `libs/shared/src/lib/types/navigation.types.ts`                                | MODIFY      | Add 'landing' to ViewType union             |
| `tsconfig.base.json`                                                           | MODIFY      | Add @ptah-extension/landing path alias      |

---

## 4. Component Design (Detailed Specifications)

### 4.1 Hero Section

#### hero-section.component.ts

**Purpose**: Container orchestrating 3D scene and content overlay

```typescript
import { Component, signal, computed, ChangeDetectionStrategy } from '@angular/core';
import { Hero3dSceneComponent } from './hero-3d-scene.component';
import { HeroContentOverlayComponent } from './hero-content-overlay.component';
import { ScrollAnimationDirective, ScrollAnimationConfig } from '@hive-academy/angular-gsap';

@Component({
  selector: 'ptah-hero-section',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Hero3dSceneComponent, HeroContentOverlayComponent, ScrollAnimationDirective],
  template: `
    <section class="relative min-h-screen overflow-hidden bg-slate-950">
      <!-- 3D Scene (background) -->
      <ptah-hero-3d-scene class="absolute inset-0 z-0" [reducedMotion]="reducedMotion()" />

      <!-- Content Overlay (foreground) -->
      <ptah-hero-content-overlay class="relative z-10" scrollAnimation [scrollConfig]="fadeOutConfig" />
    </section>
  `,
})
export class HeroSectionComponent {
  readonly reducedMotion = signal(typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  readonly fadeOutConfig: ScrollAnimationConfig = {
    animation: 'custom',
    start: 'top 20%',
    end: 'bottom 60%',
    scrub: 1.2,
    from: { opacity: 1, y: 0 },
    to: { opacity: 0, y: -150 },
  };
}
```

#### hero-3d-scene.component.ts

**Purpose**: Glass/Cosmic 3D scene using @hive-academy/angular-3d

```typescript
import { Component, input, ChangeDetectionStrategy } from '@angular/core';
import { Scene3dComponent, SphereComponent, StarFieldComponent, NebulaVolumetricComponent, AmbientLightComponent, SpotLightComponent, PointLightComponent, EnvironmentComponent, EffectComposerComponent, BloomEffectComponent, Float3dDirective, MouseTracking3dDirective } from '@hive-academy/angular-3d';

@Component({
  selector: 'ptah-hero-3d-scene',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Scene3dComponent, SphereComponent, StarFieldComponent, NebulaVolumetricComponent, AmbientLightComponent, SpotLightComponent, PointLightComponent, EnvironmentComponent, EffectComposerComponent, BloomEffectComponent, Float3dDirective, MouseTracking3dDirective],
  template: `
    <a3d-scene-3d [cameraPosition]="[0, 0, 35]" [backgroundColor]="0x0a0515" [enableShadows]="false">
      <!-- Star Field Layer 1 (Foreground) -->
      <a3d-star-field [starCount]="2000" [radius]="50" [position]="[0, 0, -20]" [multiSize]="true" [stellarColors]="true" [enableRotation]="!reducedMotion()" [rotationSpeed]="0.015" [rotationAxis]="'z'" />

      <!-- Star Field Layer 2 (Background - counter-rotation) -->
      <a3d-star-field [starCount]="1000" [radius]="60" [position]="[0, 0, -40]" [multiSize]="true" [enableRotation]="!reducedMotion()" [rotationSpeed]="-0.008" [rotationAxis]="'z'" />

      <!-- Nebula Volumetric Backdrop -->
      <a3d-nebula-volumetric [position]="[0, 0, -80]" [scale]="50" [color]="'#6b21a8'" [opacity]="0.3" />

      <!-- Glass Sphere 1: Top-Left -->
      <a3d-sphere [position]="[-15, 10, -15]" [args]="[3, 64, 64]" [color]="'#e879f9'" [transmission]="0.9" [thickness]="0.5" [ior]="1.4" [clearcoat]="1.0" [clearcoatRoughness]="0.0" [roughness]="0.0" [iridescence]="1.0" [iridescenceIOR]="1.3" [iridescenceThicknessMin]="100" [iridescenceThicknessMax]="400" float3d [floatConfig]="{ height: 0.6, speed: 3000, autoStart: !reducedMotion() }" mouseTracking3d [trackingConfig]="{ sensitivity: 0.8, damping: 0.05, invertX: true, invertPosX: true }" />

      <!-- Glass Sphere 2: Top-Right -->
      <a3d-sphere [position]="[15, 10, -14]" [args]="[2.5, 64, 64]" [color]="'#a855f7'" [transmission]="0.9" [thickness]="0.5" [ior]="1.4" [clearcoat]="1.0" [clearcoatRoughness]="0.0" [roughness]="0.0" [iridescence]="1.0" [iridescenceIOR]="1.3" [iridescenceThicknessMin]="100" [iridescenceThicknessMax]="400" float3d [floatConfig]="{ height: 0.5, speed: 3500, delay: 500, autoStart: !reducedMotion() }" mouseTracking3d [trackingConfig]="{ sensitivity: 0.6, damping: 0.06, invertX: true, invertPosX: true }" />

      <!-- Glass Sphere 3: Bottom-Left -->
      <a3d-sphere [position]="[-12, -8, -13]" [args]="[2.8, 64, 64]" [color]="'#f472b6'" [transmission]="0.9" [thickness]="0.5" [ior]="1.4" [clearcoat]="1.0" [clearcoatRoughness]="0.0" [roughness]="0.0" [iridescence]="1.0" [iridescenceIOR]="1.3" [iridescenceThicknessMin]="100" [iridescenceThicknessMax]="400" float3d [floatConfig]="{ height: 0.7, speed: 2800, delay: 200, autoStart: !reducedMotion() }" mouseTracking3d [trackingConfig]="{ sensitivity: 0.7, damping: 0.05, invertX: true, invertPosX: true }" />

      <!-- Glass Sphere 4: Bottom-Right -->
      <a3d-sphere [position]="[15, -10, -16]" [args]="[3.2, 64, 64]" [color]="'#e879f9'" [transmission]="0.9" [thickness]="0.5" [ior]="1.4" [clearcoat]="1.0" [clearcoatRoughness]="0.0" [roughness]="0.0" [iridescence]="1.0" [iridescenceIOR]="1.3" [iridescenceThicknessMin]="100" [iridescenceThicknessMax]="400" float3d [floatConfig]="{ height: 0.5, speed: 3200, delay: 800, autoStart: !reducedMotion() }" mouseTracking3d [trackingConfig]="{ sensitivity: 0.5, damping: 0.07, invertX: true, invertPosX: true }" />

      <!-- Three-Point Lighting Setup -->
      <a3d-ambient-light [intensity]="0.3" />

      <!-- Key Light (top spotlight) -->
      <a3d-spot-light [position]="[0, 16, -6]" [intensity]="120" [angle]="0.5" />

      <!-- Fill Light (purple accent) -->
      <a3d-point-light [position]="[-10, 10, -10]" [intensity]="25" [color]="'#a855f7'" />

      <!-- Rim Light (pink accent) -->
      <a3d-point-light [position]="[10, 6, -8]" [intensity]="15" [color]="'#f472b6'" />

      <!-- Per-Sphere Spotlights for Corner Emphasis -->
      <a3d-spot-light [position]="[-15, 10, -10]" [target]="[-15, 10, -15]" [intensity]="40" [angle]="0.6" />
      <a3d-spot-light [position]="[15, 10, -9]" [target]="[15, 10, -14]" [intensity]="35" [angle]="0.6" />
      <a3d-spot-light [position]="[-12, -8, -8]" [target]="[-12, -8, -13]" [intensity]="38" [angle]="0.6" />
      <a3d-spot-light [position]="[15, -10, -11]" [target]="[15, -10, -16]" [intensity]="42" [angle]="0.6" />

      <!-- Environment Map (essential for glass reflections) -->
      <a3d-environment [preset]="'sunset'" [intensity]="0.8" />

      <!-- Post-Processing: Bloom -->
      <a3d-effect-composer>
        <a3d-bloom-effect [threshold]="0.85" [strength]="0.4" [radius]="0.5" />
      </a3d-effect-composer>
    </a3d-scene-3d>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
        height: 100%;
      }
    `,
  ],
})
export class Hero3dSceneComponent {
  readonly reducedMotion = input<boolean>(false);
}
```

#### hero-content-overlay.component.ts

**Purpose**: Hero text content with staggered entrance animations

```typescript
import { Component, ChangeDetectionStrategy } from '@angular/core';
import { ViewportAnimationDirective, ViewportAnimationConfig } from '@hive-academy/angular-gsap';
import { LandingContentService } from '../../services/landing-content.service';

@Component({
  selector: 'ptah-hero-content-overlay',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ViewportAnimationDirective],
  template: `
    <div class="flex flex-col items-center justify-center min-h-screen px-4 text-center">
      <!-- Badge -->
      <div
        viewportAnimation
        [viewportConfig]="badgeConfig"
        class="inline-flex items-center gap-2 px-4 py-2 mb-6
               bg-gradient-to-r from-purple-500/20 to-pink-500/20
               rounded-full border border-purple-500/30"
      >
        <span class="relative flex h-2 w-2">
          <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"></span>
          <span class="relative inline-flex rounded-full h-2 w-2 bg-purple-500"></span>
        </span>
        <span class="text-sm font-semibold text-purple-300">Powered by Claude Agent SDK</span>
      </div>

      <!-- Main Headline -->
      <h1 viewportAnimation [viewportConfig]="headlineConfig" class="text-5xl md:text-7xl font-bold mb-6 leading-tight">
        <span class="block text-white">VS Code AI Development,</span>
        <span
          class="block bg-gradient-to-r from-purple-400 via-pink-400 to-amber-400
                     bg-clip-text text-transparent"
        >
          Powered Up by Claude Code
        </span>
      </h1>

      <!-- Subheadline -->
      <p viewportAnimation [viewportConfig]="subheadlineConfig" class="text-xl md:text-2xl text-gray-300 mb-8 max-w-3xl mx-auto leading-relaxed">A VS Code-native extension powered by the Claude Code Agent SDK. Intelligent workspace analysis, Code Execution MCP server, and project-adaptive AI agents.</p>

      <!-- CTA Buttons -->
      <div viewportAnimation [viewportConfig]="ctaConfig" class="flex flex-col sm:flex-row gap-4 justify-center mb-12">
        <a
          href="https://marketplace.visualstudio.com/items?itemName=ptah.ptah"
          target="_blank"
          rel="noopener"
          class="px-8 py-4 bg-gradient-to-r from-purple-500 to-pink-500
                 text-white font-semibold rounded-xl
                 hover:from-purple-600 hover:to-pink-600
                 transform hover:scale-105 transition-all duration-200
                 shadow-lg shadow-purple-500/25"
        >
          Install Free from VS Code Marketplace
        </a>
        <a
          href="#demo"
          class="px-8 py-4 bg-white/10 backdrop-blur-sm
                 text-white font-semibold rounded-xl
                 border border-white/20
                 hover:bg-white/20 transition-all duration-200"
        >
          Watch 3-Minute Demo
        </a>
      </div>

      <!-- Social Proof Bar -->
      <div viewportAnimation [viewportConfig]="socialProofConfig" class="flex flex-wrap justify-center gap-8 text-sm text-gray-400">
        @for (stat of stats; track stat.value) {
        <div class="flex items-center gap-2">
          <span class="text-2xl font-bold text-white">{{ stat.value }}</span>
          <span>{{ stat.label }}</span>
        </div>
        }
      </div>
    </div>
  `,
})
export class HeroContentOverlayComponent {
  readonly stats = [
    { value: '12', label: 'libraries' },
    { value: '48+', label: 'components' },
    { value: '60+', label: 'DI tokens' },
    { value: '94', label: 'message types' },
  ];

  readonly badgeConfig: ViewportAnimationConfig = {
    animation: 'scaleIn',
    duration: 0.6,
    threshold: 0.1,
  };

  readonly headlineConfig: ViewportAnimationConfig = {
    animation: 'slideUp',
    duration: 0.8,
    delay: 0.1,
    threshold: 0.1,
  };

  readonly subheadlineConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.8,
    delay: 0.2,
    threshold: 0.1,
  };

  readonly ctaConfig: ViewportAnimationConfig = {
    animation: 'slideUp',
    duration: 0.6,
    delay: 0.3,
    threshold: 0.1,
  };

  readonly socialProofConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.8,
    delay: 0.4,
    threshold: 0.1,
  };
}
```

### 4.2 Demo Section

#### demo-section.component.ts

```typescript
import { Component, ChangeDetectionStrategy } from '@angular/core';
import { GlassmorphismWindowComponent } from './glassmorphism-window.component';
import { ScrollAnimationDirective, ScrollAnimationConfig } from '@hive-academy/angular-gsap';

@Component({
  selector: 'ptah-demo-section',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [GlassmorphismWindowComponent, ScrollAnimationDirective],
  template: `
    <section id="demo" class="relative py-32 bg-gradient-to-b from-slate-950 to-slate-900">
      <!-- Ambient glow backgrounds -->
      <div class="absolute inset-0 pointer-events-none overflow-hidden">
        <div class="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-purple-500/10 rounded-full blur-[120px]"></div>
        <div class="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-pink-500/10 rounded-full blur-[100px]"></div>
      </div>

      <div class="container mx-auto px-4">
        <h2 scrollAnimation [scrollConfig]="headerConfig" class="text-4xl md:text-5xl font-bold text-center text-white mb-16">See Ptah in Action</h2>

        <ptah-glassmorphism-window scrollAnimation [scrollConfig]="windowConfig" />
      </div>
    </section>
  `,
})
export class DemoSectionComponent {
  readonly headerConfig: ScrollAnimationConfig = {
    animation: 'slideUp',
    start: 'top 80%',
    duration: 0.8,
    ease: 'power2.out',
  };

  readonly windowConfig: ScrollAnimationConfig = {
    animation: 'scaleIn',
    start: 'top 75%',
    duration: 1,
    ease: 'power3.out',
  };
}
```

#### glassmorphism-window.component.ts

```typescript
import { Component, ChangeDetectionStrategy } from '@angular/core';

@Component({
  selector: 'ptah-glassmorphism-window',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="relative mx-auto max-w-4xl">
      <!-- Window Container -->
      <div
        class="relative bg-white/5 backdrop-blur-xl rounded-2xl
                  border border-white/10 shadow-2xl overflow-hidden"
      >
        <!-- Window Chrome (Traffic Lights) -->
        <div class="flex items-center gap-2 px-4 py-3 border-b border-white/10">
          <div class="w-3 h-3 rounded-full bg-red-500 hover:bg-red-400 transition-colors cursor-pointer"></div>
          <div class="w-3 h-3 rounded-full bg-yellow-500 hover:bg-yellow-400 transition-colors cursor-pointer"></div>
          <div class="w-3 h-3 rounded-full bg-green-500 hover:bg-green-400 transition-colors cursor-pointer"></div>
          <span class="ml-4 text-sm text-gray-400">Ptah - Claude Code in VS Code</span>
        </div>

        <!-- Window Content -->
        <div class="p-6">
          <!-- Code Example -->
          <div class="bg-slate-900/80 rounded-xl p-4 font-mono text-sm">
            <div class="text-gray-400 mb-2">// Claude can now execute this inside Ptah</div>
            <div class="text-purple-400">const</div>
            <span class="text-blue-300"> info </span>
            <span class="text-white">= </span>
            <span class="text-green-400">await</span>
            <span class="text-yellow-300"> ptah.workspace.getInfo</span>
            <span class="text-white">();</span>
            <div class="mt-2">
              <span class="text-purple-400">const</span>
              <span class="text-blue-300"> files </span>
              <span class="text-white">= </span>
              <span class="text-green-400">await</span>
              <span class="text-yellow-300"> ptah.search.findFiles</span>
              <span class="text-white">(&#123;</span>
            </div>
            <div class="pl-4">
              <span class="text-cyan-300">query</span>
              <span class="text-white">: </span>
              <span class="text-amber-300">'authentication'</span>
              <span class="text-white">,</span>
            </div>
            <div class="pl-4">
              <span class="text-cyan-300">maxResults</span>
              <span class="text-white">: </span>
              <span class="text-orange-300">10</span>
            </div>
            <div><span class="text-white">&#125;);</span></div>
          </div>
        </div>
      </div>

      <!-- Decorative glow -->
      <div
        class="absolute -inset-1 bg-gradient-to-r from-purple-500/20 via-pink-500/20 to-amber-500/20
                  rounded-2xl blur-xl -z-10"
      ></div>
    </div>
  `,
})
export class GlassmorphismWindowComponent {}
```

### 4.3 Features Section (Hijacked Scroll Timeline)

**CRITICAL**: Use `agsp-hijacked-scroll-timeline` for premium fullscreen feature showcase, NOT basic cards.

#### features-hijacked-scroll.component.ts

```typescript
import { Component, signal, ChangeDetectionStrategy } from '@angular/core';
import { HijackedScrollTimelineComponent, HijackedScrollItemDirective } from '@hive-academy/angular-gsap';
import { FeatureSlideComponent } from './feature-slide.component';

@Component({
  selector: 'ptah-features-hijacked-scroll',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HijackedScrollTimelineComponent, HijackedScrollItemDirective, FeatureSlideComponent],
  template: `
    <!-- Fullscreen Hijacked Scroll Features -->
    <agsp-hijacked-scroll-timeline [scrollHeightPerStep]="900" [animationDuration]="0.8" [ease]="'power3.inOut'" [scrub]="1.5" [stepHold]="0.9" [showFirstStepImmediately]="true" (currentStepChange)="onStepChange($event)">
      @for (feature of features; track feature.title; let i = $index) {
      <div hijackedScrollItem [slideDirection]="i % 2 === 0 ? 'left' : 'right'" [fadeIn]="true" [scale]="true">
        <ptah-feature-slide [feature]="feature" [stepNumber]="i + 1" [totalSteps]="features.length" />
      </div>
      }
    </agsp-hijacked-scroll-timeline>

    <!-- Fixed Step Indicator -->
    <div class="fixed left-8 top-1/2 -translate-y-1/2 z-50 hidden lg:flex flex-col gap-4">
      @for (feature of features; track $index; let i = $index) {
      <button (click)="jumpToStep(i)" class="w-3 h-3 rounded-full transition-all duration-300" [class.bg-purple-500]="currentStep() === i" [class.scale-125]="currentStep() === i" [class.bg-slate-700]="currentStep() !== i" [attr.aria-label]="'Go to ' + feature.title"></button>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class FeaturesHijackedScrollComponent {
  readonly currentStep = signal(0);

  readonly features = [
    {
      title: 'Code Execution MCP Server',
      headline: 'Your Claude Agent Just Got Superpowers',
      description: '8 Ptah API namespaces available to your Claude agent. Query workspace structure, search files semantically, and execute VS Code commands.',
      metric: '8 API namespaces',
      icon: '🚀',
      gradient: 'from-purple-400 to-violet-500',
      bgGlow: 'bg-purple-500/10',
    },
    {
      title: '10x Faster Performance',
      headline: 'From 500ms to 50ms',
      description: 'Direct SDK integration bypasses CLI subprocess overhead. Feel the difference on every message.',
      metric: '10x faster',
      icon: '⚡',
      gradient: 'from-amber-400 to-orange-500',
      bgGlow: 'bg-amber-500/10',
    },
    {
      title: 'Intelligent Workspace Analysis',
      headline: 'Ptah Knows Your Codebase',
      description: 'Auto-detect 13+ project types and 6 monorepo tools. Context-aware AI interactions.',
      metric: '13+ project types',
      icon: '🧠',
      gradient: 'from-cyan-400 to-teal-500',
      bgGlow: 'bg-cyan-500/10',
    },
    {
      title: 'Project-Adaptive Agents',
      headline: 'AI Agents Built for YOUR Project',
      description: 'LLM-powered template expansion generates agents specifically trained on your codebase.',
      metric: 'Custom agents',
      icon: '🎯',
      gradient: 'from-pink-400 to-rose-500',
      bgGlow: 'bg-pink-500/10',
    },
    {
      title: 'Multi-Provider LLM Support',
      headline: 'Your Models, Your Choice',
      description: 'Claude, GPT, Gemini, OpenRouter, or VS Code LM API. One unified interface.',
      metric: '5 providers',
      icon: '🔌',
      gradient: 'from-green-400 to-emerald-500',
      bgGlow: 'bg-green-500/10',
    },
    {
      title: 'Token-Optimized Context',
      headline: 'Fit More Into Every Conversation',
      description: 'Greedy algorithm selects the most relevant files while respecting token budgets.',
      metric: '200k tokens',
      icon: '📊',
      gradient: 'from-orange-400 to-red-500',
      bgGlow: 'bg-orange-500/10',
    },
  ];

  onStepChange(index: number): void {
    this.currentStep.set(index);
  }

  jumpToStep(index: number): void {
    // HijackedScrollTimelineComponent exposes jumpToStep via ViewChild if needed
    // For now, scroll to approximate position
    const scrollHeight = 900 * index;
    window.scrollTo({ top: scrollHeight, behavior: 'smooth' });
  }
}
```

#### feature-slide.component.ts

```typescript
import { Component, input, ChangeDetectionStrategy } from '@angular/core';
import { NgClass } from '@angular/common';

interface Feature {
  title: string;
  headline: string;
  description: string;
  metric: string;
  icon: string;
  gradient: string;
  bgGlow: string;
}

@Component({
  selector: 'ptah-feature-slide',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgClass],
  template: `
    <!-- Fullscreen Feature Slide -->
    <div
      class="h-screen w-screen flex items-center justify-center
                bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950
                relative overflow-hidden"
    >
      <!-- Ambient Glow Background -->
      <div class="absolute inset-0 pointer-events-none">
        <div
          class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
                 w-[600px] h-[600px] rounded-full blur-[150px]"
          [ngClass]="feature().bgGlow"
        ></div>
      </div>

      <!-- Content -->
      <div class="relative z-10 text-center max-w-4xl mx-auto px-8">
        <!-- Step Number -->
        <div class="text-8xl md:text-9xl font-black mb-6 bg-clip-text text-transparent bg-gradient-to-br" [ngClass]="feature().gradient">
          {{ stepNumber().toString().padStart(2, '0') }}
        </div>

        <!-- Icon -->
        <div class="text-7xl md:text-8xl mb-8">
          {{ feature().icon }}
        </div>

        <!-- Headline -->
        <h2 class="text-4xl md:text-6xl font-bold text-white mb-4">
          {{ feature().headline }}
        </h2>

        <!-- Title (smaller) -->
        <p class="text-lg md:text-xl font-semibold mb-6 bg-clip-text text-transparent bg-gradient-to-r" [ngClass]="feature().gradient">
          {{ feature().title }}
        </p>

        <!-- Description -->
        <p class="text-xl md:text-2xl text-slate-300 max-w-2xl mx-auto mb-8 leading-relaxed">
          {{ feature().description }}
        </p>

        <!-- Metric Badge -->
        <div
          class="inline-flex items-center px-6 py-3 rounded-full
                 border border-white/20 backdrop-blur-sm"
        >
          <span class="text-lg font-bold text-white">
            {{ feature().metric }}
          </span>
        </div>
      </div>

      <!-- Step Counter (bottom) -->
      <div class="absolute bottom-8 left-1/2 -translate-x-1/2 text-slate-500 text-sm">{{ stepNumber() }} / {{ totalSteps() }}</div>
    </div>
  `,
})
export class FeatureSlideComponent {
  readonly feature = input.required<Feature>();
  readonly stepNumber = input.required<number>();
  readonly totalSteps = input.required<number>();
}
```

### 4.4 Comparison Section (Parallax Split Scroll)

**CRITICAL**: Use `agsp-parallax-split-scroll` for dynamic split-screen comparison, NOT static cards.

#### comparison-split-scroll.component.ts

```typescript
import { Component, ChangeDetectionStrategy } from '@angular/core';
import { ParallaxSplitScrollComponent, ParallaxSplitItemDirective, ViewportAnimationDirective, ViewportAnimationConfig } from '@hive-academy/angular-gsap';

@Component({
  selector: 'ptah-comparison-split-scroll',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ParallaxSplitScrollComponent, ParallaxSplitItemDirective, ViewportAnimationDirective],
  template: `
    <section class="relative bg-gradient-to-b from-slate-900 to-slate-950">
      <!-- Section Header -->
      <div class="py-16 text-center">
        <h2 viewportAnimation [viewportConfig]="headerConfig" class="text-4xl md:text-5xl font-bold text-white">The Ptah Difference</h2>
      </div>

      <!-- Parallax Split Scroll Comparison -->
      <agsp-parallax-split-scroll>
        <!-- Before Ptah (Left Layout) -->
        <div parallaxSplitItem [imageSrc]="'/assets/images/before-ptah-terminal.png'" [imageAlt]="'Terminal chaos before Ptah'" [layout]="'left'">
          <div class="p-8 md:p-12">
            <h3 class="text-3xl md:text-4xl font-bold text-gray-400 mb-8">Before Ptah</h3>

            <!-- Pain Points with Staggered Animation -->
            <ul class="space-y-6">
              @for (pain of painPoints; track $index; let i = $index) {
              <li viewportAnimation [viewportConfig]="getPainConfig(i)" class="flex items-start gap-4">
                <span
                  class="flex-shrink-0 w-8 h-8 rounded-full bg-red-500/20
                              flex items-center justify-center text-red-400"
                >
                  ✕
                </span>
                <div>
                  <p class="text-lg text-gray-300">{{ pain.text }}</p>
                  <p class="text-sm text-gray-500 mt-1">{{ pain.detail }}</p>
                </div>
              </li>
              }
            </ul>
          </div>
        </div>

        <!-- With Ptah (Right Layout) -->
        <div parallaxSplitItem [imageSrc]="'/assets/images/with-ptah-vscode.png'" [imageAlt]="'Seamless experience with Ptah'" [layout]="'right'">
          <div class="p-8 md:p-12">
            <h3 class="text-3xl md:text-4xl font-bold mb-8">
              <span
                class="bg-gradient-to-r from-amber-400 to-amber-200
                         bg-clip-text text-transparent"
              >
                With Ptah
              </span>
            </h3>

            <!-- Benefits with Staggered Animation -->
            <ul class="space-y-6">
              @for (benefit of benefits; track $index; let i = $index) {
              <li viewportAnimation [viewportConfig]="getBenefitConfig(i)" class="flex items-start gap-4">
                <span
                  class="flex-shrink-0 w-8 h-8 rounded-full bg-green-500/20
                              flex items-center justify-center text-green-400"
                >
                  ✓
                </span>
                <div>
                  <p class="text-lg text-white">{{ benefit.text }}</p>
                  <p class="text-sm text-gray-400 mt-1">{{ benefit.detail }}</p>
                </div>
              </li>
              }
            </ul>
          </div>
        </div>

        <!-- Performance Metrics (Left Layout) -->
        <div parallaxSplitItem [imageSrc]="'/assets/images/performance-chart.png'" [imageAlt]="'Performance comparison chart'" [layout]="'left'">
          <div class="p-8 md:p-12">
            <h3 class="text-3xl md:text-4xl font-bold text-white mb-8">Performance That Speaks</h3>

            <!-- Metrics Grid -->
            <div class="grid grid-cols-1 gap-6">
              @for (metric of metrics; track metric.name; let i = $index) {
              <div viewportAnimation [viewportConfig]="getMetricConfig(i)" class="p-6 rounded-2xl bg-slate-800/60 border border-slate-700/50">
                <div class="text-sm text-gray-400 mb-2">{{ metric.name }}</div>
                <div class="flex items-baseline gap-4">
                  <span class="text-gray-500 line-through">{{ metric.cli }}</span>
                  <span class="text-3xl font-bold text-green-400">{{ metric.sdk }}</span>
                  <span class="text-sm text-green-400">{{ metric.improvement }}</span>
                </div>
              </div>
              }
            </div>
          </div>
        </div>
      </agsp-parallax-split-scroll>
    </section>
  `,
})
export class ComparisonSplitScrollComponent {
  readonly painPoints = [
    {
      text: 'Terminal switching disrupts flow',
      detail: 'Context switching between editor and terminal breaks concentration',
    },
    {
      text: 'Slow CLI subprocess overhead',
      detail: '500ms+ startup time for each interaction',
    },
    {
      text: 'Generic agents waste context',
      detail: 'No understanding of your specific project structure',
    },
    {
      text: 'Limited workspace awareness',
      detail: 'Manual context management for every conversation',
    },
  ];

  readonly benefits = [
    {
      text: 'VS Code native - never leave your editor',
      detail: 'Seamlessly integrated into your existing workflow',
    },
    {
      text: '10x faster SDK integration',
      detail: '50ms session creation vs 500ms with CLI',
    },
    {
      text: 'Project-adaptive AI agents',
      detail: 'Agents customized to your codebase and stack',
    },
    {
      text: 'Full workspace intelligence',
      detail: 'Automatic context from 13+ project types',
    },
  ];

  readonly metrics = [
    { name: 'Session Creation', cli: '500ms', sdk: '50ms', improvement: '10x faster' },
    { name: 'First Chunk Latency', cli: '1000ms', sdk: '100ms', improvement: '10x faster' },
    { name: 'Memory Usage', cli: '50MB', sdk: '20MB', improvement: '60% less' },
  ];

  readonly headerConfig: ViewportAnimationConfig = {
    animation: 'slideUp',
    duration: 0.8,
    threshold: 0.2,
  };

  getPainConfig(index: number): ViewportAnimationConfig {
    return {
      animation: 'slideLeft',
      duration: 0.6,
      delay: index * 0.1,
      threshold: 0.2,
    };
  }

  getBenefitConfig(index: number): ViewportAnimationConfig {
    return {
      animation: 'slideRight',
      duration: 0.6,
      delay: index * 0.1,
      ease: 'back.out(1.4)',
      threshold: 0.2,
    };
  }

  getMetricConfig(index: number): ViewportAnimationConfig {
    return {
      animation: 'scaleIn',
      duration: 0.5,
      delay: index * 0.15,
      ease: 'back.out(1.7)',
      threshold: 0.2,
    };
  }
}
```

### 4.5 CTA Section

#### cta-section.component.ts

```typescript
import { Component, ChangeDetectionStrategy } from '@angular/core';
import { ViewportAnimationDirective, ViewportAnimationConfig } from '@hive-academy/angular-gsap';

@Component({
  selector: 'ptah-cta-section',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ViewportAnimationDirective],
  template: `
    <section class="relative py-32 bg-slate-950 overflow-hidden">
      <!-- Ambient glows -->
      <div class="absolute inset-0 pointer-events-none">
        <div
          class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
                    w-[800px] h-[800px] bg-purple-500/10 rounded-full blur-[150px]"
        ></div>
      </div>

      <div class="container mx-auto px-4 text-center relative z-10">
        <!-- Headline -->
        <h2 viewportAnimation [viewportConfig]="headlineConfig" class="text-5xl md:text-7xl font-bold mb-6">
          <span
            class="bg-gradient-to-r from-amber-300 via-amber-200 to-amber-400
                       bg-clip-text text-transparent"
          >
            Get Started Free
          </span>
        </h2>

        <!-- Subheadline -->
        <p viewportAnimation [viewportConfig]="subheadlineConfig" class="text-xl md:text-2xl text-gray-300 mb-12 max-w-2xl mx-auto">Install from VS Code Marketplace and transform your Claude Code experience in 2 minutes.</p>

        <!-- Primary CTA -->
        <div viewportAnimation [viewportConfig]="ctaConfig" class="mb-8">
          <a
            href="https://marketplace.visualstudio.com/items?itemName=ptah.ptah"
            target="_blank"
            rel="noopener"
            class="inline-flex items-center gap-3 px-10 py-5
                   bg-gradient-to-r from-amber-400 to-amber-500
                   text-slate-900 font-bold text-lg rounded-2xl
                   hover:from-amber-300 hover:to-amber-400
                   transform hover:scale-105 transition-all duration-200
                   shadow-lg shadow-amber-500/30
                   animate-pulse-subtle"
          >
            <span>Install Free</span>
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </a>
        </div>

        <!-- Secondary CTAs -->
        <div viewportAnimation [viewportConfig]="secondaryConfig" class="flex flex-col sm:flex-row gap-4 justify-center mb-12">
          <a href="#" class="text-gray-400 hover:text-white transition-colors"> Read the Docs </a>
          <span class="hidden sm:inline text-gray-600">|</span>
          <a href="#" class="text-gray-400 hover:text-white transition-colors"> Watch Demo </a>
        </div>

        <!-- Trust Signals -->
        <div viewportAnimation [viewportConfig]="trustConfig" class="flex flex-col sm:flex-row gap-4 justify-center text-sm text-gray-500">
          <span>Open source on GitHub</span>
          <span class="hidden sm:inline">•</span>
          <span>Built by developers, for developers</span>
        </div>
      </div>
    </section>
  `,
  styles: [
    `
      @keyframes pulse-subtle {
        0%,
        100% {
          box-shadow: 0 0 0 0 rgba(251, 191, 36, 0.4);
        }
        50% {
          box-shadow: 0 0 0 10px rgba(251, 191, 36, 0);
        }
      }

      .animate-pulse-subtle {
        animation: pulse-subtle 2s infinite;
      }
    `,
  ],
})
export class CtaSectionComponent {
  readonly headlineConfig: ViewportAnimationConfig = {
    animation: 'slideUp',
    duration: 0.8,
    threshold: 0.2,
  };

  readonly subheadlineConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.8,
    delay: 0.1,
    threshold: 0.2,
  };

  readonly ctaConfig: ViewportAnimationConfig = {
    animation: 'scaleIn',
    duration: 0.6,
    delay: 0.2,
    ease: 'back.out(1.7)',
    threshold: 0.2,
  };

  readonly secondaryConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.6,
    delay: 0.3,
    threshold: 0.2,
  };

  readonly trustConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.6,
    delay: 0.4,
    threshold: 0.2,
  };
}
```

---

## 5. Animation Choreography

### Entry Animation Timeline

| Element           | Animation    | Duration | Delay | Ease       |
| ----------------- | ------------ | -------- | ----- | ---------- |
| Hero Badge        | scaleIn      | 600ms    | 0ms   | power2.out |
| Hero Headline     | slideUp      | 800ms    | 100ms | power2.out |
| Hero Subheadline  | fadeIn       | 800ms    | 200ms | power2.out |
| Hero CTAs         | slideUp      | 600ms    | 300ms | power2.out |
| Hero Social Proof | fadeIn       | 800ms    | 400ms | power2.out |
| 3D Scene Elements | (continuous) | -        | -     | -          |

### Scroll Trigger Configurations

| Section             | Trigger Start | Trigger End | Animation                      |
| ------------------- | ------------- | ----------- | ------------------------------ |
| Hero Content Fade   | top 20%       | bottom 60%  | Custom (opacity 1→0, y 0→-150) |
| Demo Section Header | top 80%       | -           | slideUp                        |
| Demo Window         | top 75%       | -           | scaleIn                        |
| Feature Cards       | top 80%       | -           | slideUp with stagger 100ms     |
| Comparison Before   | top 80%       | -           | slideLeft                      |
| Comparison After    | top 80%       | -           | slideRight (delay 300ms)       |
| CTA Section         | top 80%       | -           | slideUp cascade                |

### Stagger Patterns

**Feature Cards**: 0.1s between each card (0, 0.1, 0.2, 0.3, 0.4, 0.5s)
**Social Proof Stats**: Simultaneous (same delay)
**Comparison Items**: 0.3s between Before and After

---

## 6. Shared Utilities

### landing.types.ts

```typescript
export interface Feature {
  title: string;
  headline: string;
  description: string;
  metric: string;
  icon: string;
  color: 'purple' | 'amber' | 'cyan' | 'pink' | 'green' | 'orange';
}

export interface SocialProofStat {
  value: string;
  label: string;
}

export interface PerformanceMetric {
  name: string;
  cli: string;
  sdk: string;
}
```

### landing-content.service.ts

```typescript
import { Injectable } from '@angular/core';
import { Feature, SocialProofStat, PerformanceMetric } from '../types/landing.types';

@Injectable({ providedIn: 'root' })
export class LandingContentService {
  readonly features: Feature[] = [
    // ... feature data from LANDING_PAGE.md
  ];

  readonly socialProof: SocialProofStat[] = [
    { value: '12', label: 'libraries' },
    { value: '48+', label: 'components' },
    { value: '60+', label: 'DI tokens' },
    { value: '94', label: 'message types' },
  ];

  readonly performanceMetrics: PerformanceMetric[] = [
    { name: 'Session Creation', cli: '500ms', sdk: '50ms' },
    { name: 'First Chunk', cli: '1000ms', sdk: '100ms' },
    { name: 'Memory Usage', cli: '50MB', sdk: '20MB' },
  ];
}
```

---

## 7. Testing Strategy

### Unit Tests

| Component                    | Test Focus                                        |
| ---------------------------- | ------------------------------------------------- |
| HeroSectionComponent         | Reduced motion signal, scroll config              |
| Hero3dSceneComponent         | Reduced motion input binding, component structure |
| HeroContentOverlayComponent  | Animation configs, static content                 |
| DemoSectionComponent         | Section structure                                 |
| GlassmorphismWindowComponent | Static rendering                                  |
| FeaturesSectionComponent     | Feature iteration, card config generation         |
| FeatureCardComponent         | Color class mapping, input binding                |
| ComparisonSectionComponent   | Animation configs                                 |
| BeforeCardComponent          | Pain points rendering                             |
| AfterCardComponent           | Benefits rendering                                |
| TransitionArrowComponent     | SVG rendering                                     |
| CtaSectionComponent          | Animation configs, links                          |

### Visual Regression Approach

1. Capture screenshots at key viewport sizes (mobile 375px, tablet 768px, desktop 1440px)
2. Compare against baseline after changes
3. Focus on: hero scene rendering, glassmorphism effects, gradient text, card hover states

### Performance Testing

1. Lighthouse CI in pipeline (target: 90+ performance score)
2. Memory profiling after 5 minutes of scrolling (target: <20MB growth)
3. FPS monitoring during scroll animations (target: 60fps sustained)
4. 3D scene initialization timing (target: <500ms)

---

## 8. Implementation Order

### Phase 1: Foundation (Day 1)

1. Create `libs/frontend/landing` library via Nx
2. Add path alias to `tsconfig.base.json`
3. Update `app.config.ts` with GSAP/Lenis providers
4. Create type definitions (`landing.types.ts`)
5. Create content service (`landing-content.service.ts`)
6. Update navigation types to include 'landing' view

### Phase 2: Hero Section (Day 2)

1. Create `hero-3d-scene.component.ts` with angular-3d components
2. Create `hero-content-overlay.component.ts` with viewport animations
3. Create `hero-section.component.ts` orchestrator
4. Test 3D rendering and reduced motion

### Phase 3: Supporting Sections (Day 3)

1. Create `glassmorphism-window.component.ts`
2. Create `demo-section.component.ts`
3. Create `feature-card.component.ts`
4. Create `features-section.component.ts`
5. Test scroll animations

### Phase 4: Comparison & CTA (Day 4)

1. Create `before-card.component.ts`
2. Create `after-card.component.ts`
3. Create `transition-arrow.component.ts`
4. Create `comparison-section.component.ts`
5. Create `cta-section.component.ts`

### Phase 5: Integration (Day 5)

1. Create `landing-page.component.ts` orchestrator
2. Update `app-shell.component.ts` to include landing view
3. Initialize Lenis in `app.ts`
4. Full integration testing
5. Performance profiling

### Phase 6: Polish & QA (Day 6)

1. Responsive testing (mobile, tablet, desktop)
2. Accessibility audit (reduced motion, focus states)
3. Performance optimization
4. Cross-browser testing
5. Memory leak testing

---

## 9. Dependencies

### Required NPM Packages (Already Installed via angular-3d/angular-gsap)

- `@hive-academy/angular-3d` - 3D scene components
- `@hive-academy/angular-gsap` - Scroll animation directives
- `three` - Three.js (peer dependency)
- `gsap` - GSAP (peer dependency)
- `lenis` - Smooth scroll (peer dependency)

### Internal Dependencies

| Library                  | Imports                             |
| ------------------------ | ----------------------------------- |
| `@ptah-extension/shared` | ViewType (needs 'landing' added)    |
| `@ptah-extension/core`   | AppStateManager, navigation service |

### Build Configuration

Add to `apps/ptah-extension-webview/project.json` allowed dependencies:

```json
{
  "implicitDependencies": ["landing"]
}
```

---

## 10. App Configuration Updates

### app.config.ts (MODIFY)

```typescript
import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZoneChangeDetection, ErrorHandler } from '@angular/core';
import { provideMarkdown } from 'ngx-markdown';
import { provideVSCodeService } from '@ptah-extension/core';
import { provideGsap, provideLenis } from '@hive-academy/angular-gsap';

// ... existing ErrorHandler ...

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    { provide: ErrorHandler, useClass: WebviewErrorHandler },
    provideVSCodeService(),
    provideMarkdown(),
    // NEW: GSAP and Lenis providers for landing page
    provideGsap({
      defaults: {
        ease: 'power2.out',
        duration: 0.8,
      },
    }),
    provideLenis({
      lerp: 0.08,
      wheelMultiplier: 0.7,
    }),
  ],
};
```

### app.ts (MODIFY)

```typescript
import { Component, OnInit, OnDestroy, signal, computed, inject, afterNextRender } from '@angular/core';
import { LenisSmoothScrollService } from '@hive-academy/angular-gsap';
// ... existing imports ...

@Component({
  // ... existing config ...
})
export class App implements OnInit, OnDestroy {
  private readonly lenis = inject(LenisSmoothScrollService);
  // ... existing properties ...

  constructor() {
    // Initialize Lenis smooth scroll after first render
    afterNextRender(() => {
      if (!this.lenis.isInitialized()) {
        this.lenis.initialize();
      }
    });
  }

  // ... existing methods ...

  public ngOnDestroy(): void {
    // ... existing cleanup ...
    this.lenis.destroy();
  }
}
```

---

## 11. Quality Checklist

### Visual Quality

- [ ] Hero 3D scene displays Glass/Cosmic aesthetic with iridescent spheres
- [ ] Star field has visible parallax depth with 2 layers
- [ ] Nebula provides atmospheric purple backdrop
- [ ] Glass spheres respond to mouse movement
- [ ] Glassmorphism effects render correctly (blur, transparency)
- [ ] Feature cards have proper hover states with elevation
- [ ] Comparison section clearly shows before/after contrast
- [ ] CTA button has visible glow and hover animation
- [ ] All gradient text renders correctly

### Technical Quality

- [ ] Lighthouse Performance score >= 90
- [ ] No memory leaks after 5 minutes of scrolling
- [ ] 60fps maintained during scroll animations
- [ ] WebGL context loss handled gracefully
- [ ] All components use OnPush change detection
- [ ] No raw Three.js/GSAP code - all via library directives
- [ ] Components properly clean up on destroy

### Accessibility

- [ ] `prefers-reduced-motion` respected - animations disabled/reduced
- [ ] All CTAs keyboard accessible
- [ ] Focus states visible
- [ ] 3D canvas has aria-label
- [ ] Color contrast meets WCAG AA

### Content

- [ ] All copy from LANDING_PAGE.md implemented
- [ ] Stats in social proof bar match codebase reality
- [ ] Performance claims (10x, 500ms to 50ms) accurately displayed
- [ ] Feature descriptions match library CLAUDE.md documentation

---

## 12. Team Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: frontend-developer

**Rationale**:

- Angular component development (100% frontend work)
- No backend API changes required
- 3D/animation work uses Angular directives (not raw Three.js/GSAP)
- Tailwind CSS styling
- TypeScript only

### Complexity Assessment

**Complexity**: MEDIUM-HIGH
**Estimated Effort**: 30-40 hours (5-6 days)

**Breakdown**:

- Library setup + foundation: 4 hours
- Hero section (3D scene): 8 hours
- Supporting sections (demo, features): 8 hours
- Comparison + CTA: 6 hours
- Integration + app updates: 4 hours
- Testing + polish: 6-10 hours

### Files Affected Summary

**CREATE (New Library)**:

- `libs/frontend/landing/` - entire new library (15+ files)

**MODIFY**:

- `apps/ptah-extension-webview/src/app/app.config.ts` - add providers
- `apps/ptah-extension-webview/src/app/app.ts` - Lenis init
- `libs/frontend/chat/src/lib/components/templates/app-shell.component.ts` - landing view case
- `libs/frontend/chat/src/lib/components/templates/app-shell.component.html` - landing view template
- `libs/shared/src/lib/types/navigation.types.ts` - ViewType union
- `tsconfig.base.json` - path alias

**DELETE**: NONE

### Critical Verification Points

Before implementation, developer must verify:

1. **@hive-academy/angular-3d installed and configured**:

   - Check `package.json` for dependency
   - Verify components are importable

2. **@hive-academy/angular-gsap installed and configured**:

   - Check `package.json` for dependency
   - Verify directives are importable

3. **All component selectors follow a3d- and agsp- prefixes**:

   - Reference components.md for exact selector names

4. **No raw Three.js/GSAP imports**:
   - All 3D via `@hive-academy/angular-3d`
   - All animations via `@hive-academy/angular-gsap`

### Architecture Delivery Checklist

- [x] All components specified with purpose and structure
- [x] All patterns verified from library references
- [x] All imports specified from library documentation
- [x] Quality requirements defined
- [x] Integration points documented
- [x] Files affected list complete
- [x] Developer type recommended (frontend-developer)
- [x] Complexity assessed (MEDIUM-HIGH, 30-40 hours)
- [x] No step-by-step implementation details (team-leader's job)
