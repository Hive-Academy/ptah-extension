# Development Tasks - TASK_2025_072

## Landing Page Rich Content Enhancement

**Total Tasks**: 19 | **Batches**: 6 | **Status**: 4/6 complete

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

### Assumptions Verified

- ✅ GSAP 3.13.0 already installed and in use (verified in package.json:68 and hero-section.component.ts)
- ✅ Three.js 0.181.2 already installed with types (verified in package.json:69, 104)
- ✅ DaisyUI "anubis" theme configured with gold/obsidian palette (verified in tailwind.config.js:23-76)
- ✅ All section components exist and follow standalone Angular 20 pattern
- ✅ GSAP lifecycle pattern (afterNextRender → context → cleanup) verified across 5 components

### Risks Identified

| Risk                                                          | Severity | Mitigation                                                             |
| ------------------------------------------------------------- | -------- | ---------------------------------------------------------------------- |
| Three.js post-processing (UnrealBloomPass) is new to codebase | MEDIUM   | Add fallback without bloom, test performance on low-end devices        |
| Ankh 3D model may not be available                            | MEDIUM   | Implement procedural geometry fallback (golden pyramid already exists) |
| Glassmorphism backdrop-filter not supported in older browsers | LOW      | Progressive enhancement with solid fallback (@supports query)          |
| 500 particles may impact 60fps performance target             | MEDIUM   | Add performance monitoring, reduce to 300 if FPS drops                 |

### Edge Cases to Handle

- [ ] prefers-reduced-motion: Disable ALL animations (already handled in existing components)
- [ ] WebGL unavailable: Show fallback message for Three.js scene
- [ ] Ankh model load failure: Fall back to procedural golden pyramid
- [ ] Slow network: Ensure content visible before 3D assets load
- [ ] Mobile touch: Hover effects should be optional (not critical)

---

## Batch 1: Foundation - Tailwind Config & Global Styles ✅ COMPLETE

**Developer**: frontend-developer
**Tasks**: 2 | **Dependencies**: None
**Duration**: 1-2 hours
**Commit**: 28d9d01

### Task 1.1: Extend Tailwind Config with New Utilities ✅ COMPLETE

**File**: D:\projects\ptah-extension\apps\ptah-landing-page\tailwind.config.js
**Type**: MODIFY
**Spec Reference**: implementation-plan.md:724-763
**Pattern to Follow**: tailwind.config.js:10-17 (existing theme.extend)

**Quality Requirements**:

- Add fontSize extensions (8xl, 9xl) for hero typography
- Add animation keyframes (glow-pulse, pulse-ring, divider-draw)
- Add boxShadow utilities (glow-gold, glow-gold-lg)
- Ensure new classes are not purged by production build

**Validation Notes**:

- No risks - configuration changes only
- Test by building: `npx nx build ptah-landing-page`

**Implementation Details**:

```javascript
// ADD to theme.extend (after line 16):
extend: {
  fontFamily: {
    // ... keep existing
  },
  fontSize: {
    '8xl': ['6rem', { lineHeight: '1', letterSpacing: '-0.03em' }],
    '9xl': ['8rem', { lineHeight: '0.95', letterSpacing: '-0.04em' }],
  },
  animation: {
    'glow-pulse': 'glow-pulse 2s ease-in-out infinite',
    'pulse-ring': 'pulse-ring 2s ease-out infinite',
    'divider-draw': 'divider-draw 1.5s ease-out forwards',
  },
  keyframes: {
    'glow-pulse': {
      '0%, 100%': { boxShadow: '0 0 40px rgba(212, 175, 55, 0.3)' },
      '50%': { boxShadow: '0 0 60px rgba(212, 175, 55, 0.5)' },
    },
    'pulse-ring': {
      '0%': { boxShadow: '0 0 0 0 rgba(212, 175, 55, 0.4)' },
      '50%': { boxShadow: '0 0 0 20px rgba(212, 175, 55, 0)' },
      '100%': { boxShadow: '0 0 0 0 rgba(212, 175, 55, 0)' },
    },
    'divider-draw': {
      from: { transform: 'translateX(-100%)' },
      to: { transform: 'translateX(0)' },
    },
  },
  boxShadow: {
    'glow-gold': '0 0 60px rgba(212, 175, 55, 0.4)',
    'glow-gold-lg': '0 0 100px rgba(212, 175, 55, 0.5)',
  },
}
```

---

### Task 1.2: Add Global CSS Utility Classes ✅ COMPLETE

**File**: D:\projects\ptah-extension\apps\ptah-landing-page\src\styles.css
**Type**: MODIFY
**Dependencies**: Task 1.1
**Spec Reference**: implementation-plan.md:769-808
**Pattern to Follow**: styles.css:6-26 (existing CSS custom properties)

**Quality Requirements**:

- Add glassmorphism utility class for demo window chrome
- Add gradient-text-gold utility for hero/CTA headlines
- Add CSS custom properties for reusable values
- Include fallback for browsers without backdrop-filter

**Validation Notes**:

- Risk: backdrop-filter not supported in older browsers
- Mitigation: @supports query with solid fallback

**Implementation Details**:

```css
/* ADD after line 25 (:root closing) */
:root {
  /* ... existing variables (keep) ... */

  /* Glassmorphism */
  --glass-blur: blur(20px);
  --glass-bg: rgba(42, 42, 42, 0.6);
  --glass-border: rgba(212, 175, 55, 0.2);

  /* Gradient Text */
  --gradient-text-gold: linear-gradient(135deg, #d4af37, #fbbf24, #d4af37);

  /* Animation Timing */
  --animation-slow: 2s;
  --animation-medium: 1.2s;
  --animation-fast: 0.6s;
}

/* Utility Classes */
.glassmorphism {
  backdrop-filter: var(--glass-blur);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
}

/* Fallback for browsers without backdrop-filter */
@supports not (backdrop-filter: blur(20px)) {
  .glassmorphism {
    background: rgba(42, 42, 42, 0.95);
  }
}

.gradient-text-gold {
  background: var(--gradient-text-gold);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
```

---

**Batch 1 Verification**:

- [x] Build completes: `npx nx build ptah-landing-page`
- [x] No Tailwind purge warnings in console
- [x] New utility classes available in components
- [x] CSS variables defined in :root

---

## Batch 2: Hero 3D Scene - Golden Ankh + Particle Halo ✅ COMPLETE

**Developer**: frontend-developer
**Tasks**: 3 | **Dependencies**: Batch 1 complete
**Duration**: 4-6 hours
**Critical Path**: YES (longest duration, highest visual impact)
**Commit**: f805af8

### Task 2.1: Replace Island with Golden Ankh Geometry ✅ COMPLETE

**File**: D:\projects\ptah-extension\apps\ptah-landing-page\src\app\sections\hero\hero-scene.component.ts
**Type**: REWRITE (major changes to initScene method)
**Spec Reference**: implementation-plan.md:189-266
**Pattern to Follow**: hero-scene.component.ts:51-168 (existing Three.js structure)

**Quality Requirements**:

- Remove existing GLTF island loader (line 255 reference)
- Implement TWO approaches: (A) Load ankh.gltf if available, (B) Procedural geometry fallback
- Use MeshStandardMaterial with metalness: 1.0, roughness: 0.2, color: 0xd4af37
- Maintain 60fps performance target
- Proper resource disposal on component destroy

**Validation Notes**:

- Risk: Ankh 3D model may not exist
- Mitigation: Procedural fallback MUST be implemented (use existing pyramid code as reference)
- Edge case: Model load failure → fallback must trigger automatically

**Implementation Details**:

```typescript
// REPLACE loadModel() method:
private async loadAnkhModel(): Promise<void> {
  const loader = new GLTFLoader();

  try {
    // Attempt GLTF load first
    const gltf = await loader.loadAsync('/assets/3d-models/ankh.gltf');
    const ankh = gltf.scene;
    ankh.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.material = new THREE.MeshStandardMaterial({
          color: 0xd4af37,
          metalness: 1.0,
          roughness: 0.2,
        });
      }
    });
    ankh.scale.setScalar(2.5);
    this.scene!.add(ankh);
    this.ankhModel = ankh; // Store for cleanup
  } catch (error) {
    console.warn('Ankh model not found, using procedural fallback');
    this.createProceduralAnkh();
  }
}

private createProceduralAnkh(): void {
  // Fallback: Golden pyramid (reference existing code at line 290-303)
  const geometry = new THREE.ConeGeometry(1.5, 3, 4);
  const material = new THREE.MeshStandardMaterial({
    color: 0xd4af37,
    metalness: 1.0,
    roughness: 0.2,
  });
  const pyramid = new THREE.Mesh(geometry, material);
  pyramid.rotation.y = Math.PI / 4;
  this.scene!.add(pyramid);
  this.ankhModel = pyramid;
}
```

---

### Task 2.2: Enhance Particle System (500 particles, spherical distribution) ✅ COMPLETE

**File**: D:\projects\ptah-extension\apps\ptah-landing-page\src\app\sections\hero\hero-scene.component.ts
**Type**: MODIFY
**Dependencies**: Task 2.1
**Spec Reference**: implementation-plan.md:209-214
**Pattern to Follow**: hero-scene.component.ts:311 (existing particle system)

**Quality Requirements**:

- Increase particle count: 200 → 500 particles
- Arrange particles in spherical distribution (radius 3-5 units around Ankh)
- Add slow rotation animation + outward emanation effect
- Use additive blending for glow effect
- Monitor performance: if FPS < 60, reduce to 300 particles

**Validation Notes**:

- Risk: 500 particles may drop FPS below 60
- Mitigation: Add FPS monitoring, reduce count if needed
- Edge case: Low-end devices → reduce particles based on performance

**Implementation Details**:

```typescript
// REPLACE addParticles() method:
private addAnkhParticleHalo(): void {
  const particleCount = 500;
  const positions = new Float32Array(particleCount * 3);

  // Spherical distribution (radius 3-5 units)
  for (let i = 0; i < particleCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const radius = 3 + Math.random() * 2; // 3-5 units

    positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = radius * Math.cos(phi);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    color: 0xd4af37,
    size: 0.05,
    blending: THREE.AdditiveBlending,
    transparent: true,
    opacity: 0.8,
  });

  this.particles = new THREE.Points(geometry, material);
  this.scene!.add(this.particles);
}

// ADD to animate() loop:
private animate = (): void => {
  this.animationId = requestAnimationFrame(this.animate);

  // Particle rotation + emanation
  if (this.particles) {
    this.particles.rotation.y += 0.001;
    // Optional: Add pulsing emanation effect
  }

  // ... existing camera/controls updates ...
  this.renderer!.render(this.scene!, this.camera!);
};
```

---

### Task 2.3: Change Background & Add Post-Processing Bloom ✅ COMPLETE

**File**: D:\projects\ptah-extension\apps\ptah-landing-page\src\app\sections\hero\hero-scene.component.ts
**Type**: MODIFY
**Dependencies**: Task 2.2
**Spec Reference**: implementation-plan.md:215-264
**Pattern to Follow**: hero-scene.component.ts:102-104 (existing background)

**Quality Requirements**:

- Change background from linear brown gradient to radial obsidian→gold glow
- Add UnrealBloomPass for glow effect (requires EffectComposer)
- Add imports from three/examples/jsm/postprocessing/
- Maintain 60fps with post-processing enabled
- Fallback: If bloom impacts performance, make it optional

**Validation Notes**:

- Risk: UnrealBloomPass is NEW to codebase (not used before)
- Mitigation: Add fallback path without bloom if performance drops
- Edge case: WebGL context lost → gracefully handle

**Implementation Details**:

```typescript
// ADD imports at top:
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass';

// MODIFY initScene() background setup:
private async initScene(): Promise<void> {
  // ... existing renderer/scene setup (keep) ...

  // CHANGE: Radial gradient background (not solid color)
  this.scene!.background = this.createRadialGradientTexture();

  // ... existing camera/controls setup (keep) ...

  await this.loadAnkhModel();
  this.addAnkhParticleHalo();

  // NEW: Add post-processing bloom
  this.setupBloomEffect();

  this.animate();
}

private createRadialGradientTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  const gradient = ctx.createRadialGradient(256, 358, 0, 256, 358, 512);
  gradient.addColorStop(0, 'rgba(212, 175, 55, 0.15)'); // Gold glow center
  gradient.addColorStop(0.5, 'rgba(26, 26, 26, 1)');    // Dark fade
  gradient.addColorStop(1, 'rgba(10, 10, 10, 1)');      // Obsidian edge

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 512, 512);

  const texture = new THREE.CanvasTexture(canvas);
  return texture;
}

private setupBloomEffect(): void {
  this.composer = new EffectComposer(this.renderer!);

  const renderPass = new RenderPass(this.scene!, this.camera!);
  this.composer.addPass(renderPass);

  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    1.5, // strength
    0.4, // radius
    0.85 // threshold
  );
  this.composer.addPass(bloomPass);
}

// MODIFY animate() to use composer:
private animate = (): void => {
  this.animationId = requestAnimationFrame(this.animate);

  // ... particle/controls updates ...

  // CHANGE: Use composer instead of direct render
  if (this.composer) {
    this.composer.render();
  } else {
    this.renderer!.render(this.scene!, this.camera!);
  }
};

// ADD composer cleanup:
private cleanup(): void {
  // ... existing cleanup ...
  this.composer?.dispose();
}
```

---

**Batch 2 Verification**:

- [x] Golden Ankh visible (either GLTF or procedural fallback)
- [x] 500 particles in spherical halo around Ankh
- [x] Radial gradient background (gold glow center)
- [x] Bloom glow effect visible on Ankh
- [x] 60fps maintained (check Chrome DevTools Performance tab)
- [x] Proper resource disposal (no memory leaks on component destroy)

---

## Batch 3: Typography & Animation - Hero + CTA Sections ✅ COMPLETE

**Developer**: frontend-developer
**Tasks**: 4 | **Dependencies**: Batch 1 complete (uses new Tailwind classes)
**Duration**: 3-4 hours
**Commit**: 3712a09

### Task 3.1: Enhance Hero Section Typography ✅ COMPLETE

**File**: D:\projects\ptah-extension\apps\ptah-landing-page\src\app\sections\hero\hero-section.component.ts
**Type**: MODIFY
**Spec Reference**: implementation-plan.md:269-332
**Pattern to Follow**: hero-section.component.ts:68-98 (existing template)

**Quality Requirements**:

- Increase headline size: text-5xl md:text-6xl lg:text-7xl → text-6xl md:text-7xl lg:text-8xl
- Replace solid gold color with gradient-text-gold utility class (from Batch 1)
- Apply copy from landing-page-copy.md:38-40 ("Ancient Wisdom for Modern AI")
- Ensure Cinzel Display font loads (already configured)
- Test responsive breakpoints (mobile 375px, tablet 768px, desktop 1920px)

**Validation Notes**:

- No risks - CSS changes only
- Edge case: Font loading delay → ensure fallback serif visible

**Implementation Details**:

```html
<!-- MODIFY template (lines 68-98): -->
<div class="hero-content text-center max-w-4xl mx-auto">
  <!-- Headline with gold gradient -->
  <h1 class="hero-headline text-6xl md:text-7xl lg:text-8xl font-display font-bold mb-6 gradient-text-gold">Ancient Wisdom for Modern AI</h1>

  <!-- Tagline from landing-page-copy.md:47-50 -->
  <p class="hero-tagline text-xl md:text-2xl text-base-content/80 mb-8 max-w-3xl mx-auto">Transform Claude Code CLI into a native VS Code experience. Built by architects who understand your craft.</p>

  <!-- CTA buttons -->
  <div class="hero-ctas flex gap-4 justify-center">
    <a href="#" class="btn btn-secondary btn-lg">Install Free</a>
    <a href="#demo" class="btn btn-outline btn-lg">See what it builds ↓</a>
  </div>
</div>
```

---

### Task 3.2: Add Hero Entry Animation Timeline ✅ COMPLETE

**File**: D:\projects\ptah-extension\apps\ptah-landing-page\src\app\sections\hero\hero-section.component.ts
**Type**: MODIFY
**Dependencies**: Task 3.1
**Spec Reference**: implementation-plan.md:290-332
**Pattern to Follow**: hero-section.component.ts:162-262 (existing GSAP pattern)

**Quality Requirements**:

- Add NEW entry animation timeline (runs once on page load)
- Sequence: headline fade-up (900ms) → tagline fade-up (1200ms) → CTA bounce (1500ms)
- KEEP existing scroll-out animations (lines 194-252)
- Respect prefers-reduced-motion (skip animations if set)
- Ensure timeline doesn't conflict with existing ScrollTrigger animations

**Validation Notes**:

- Assumption: Entry animation should complete within 1.5s (Lighthouse FCP requirement)
- Edge case: prefers-reduced-motion → skip ALL animations

**Implementation Details**:

```typescript
// MODIFY initAnimations() method:
private initAnimations(): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  this.gsapContext = gsap.context(() => {
    // NEW: Entry animation timeline (runs once on load)
    const entryTl = gsap.timeline({ delay: 0.3 });
    entryTl
      .from('.hero-headline', {
        y: 30,
        opacity: 0,
        filter: 'blur(10px)',
        duration: 0.8,
        ease: 'power3.out'
      })
      .from('.hero-tagline', {
        y: 20,
        opacity: 0,
        duration: 0.6,
        ease: 'power3.out'
      }, '-=0.3')
      .from('.hero-ctas', {
        y: 15,
        opacity: 0,
        duration: 0.5,
        ease: 'back.out(1.7)'
      }, '-=0.2');

    // KEEP: Existing scroll-out animations (lines 194-252)
    gsap.to('.hero-headline', {
      scrollTrigger: {
        trigger: this.sectionRef().nativeElement,
        start: 'top top',
        end: 'bottom top',
        scrub: true,
      },
      y: -100,
      opacity: 0,
    });

    // ... keep other scroll animations ...
  }, this.sectionRef().nativeElement);

  // KEEP: Existing cleanup (line 256-260)
  this.destroyRef.onDestroy(() => {
    ScrollTrigger.getAll().forEach(trigger => trigger.kill());
    this.gsapContext?.revert();
  });
}
```

---

### Task 3.3: Enhance CTA Section Typography & Button ✅ COMPLETE

**File**: D:\projects\ptah-extension\apps\ptah-landing-page\src\app\sections\cta\cta-section.component.ts
**Type**: MODIFY
**Spec Reference**: implementation-plan.md:627-714
**Pattern to Follow**: Existing section component structure

**Quality Requirements**:

- Increase headline to text-7xl with gradient-text-gold class
- Apply copy from landing-page-copy.md:313-315 ("Ready to Build Smarter?")
- Add large CTA button (64px height) with golden gradient background
- Add pulse-ring animation (from Tailwind config Batch 1)
- Add subheadline with friction-removal copy

**Validation Notes**:

- No risks - template and CSS changes
- Animation is continuous (not triggered) - ensure performance acceptable

**Implementation Details**:

```html
<!-- REWRITE template: -->
<section id="cta" class="py-32 bg-base-100">
  <div class="container mx-auto px-6 text-center">
    <!-- Headline with gradient -->
    <h2 class="text-7xl font-display font-bold mb-6 gradient-text-gold">Ready to Build Smarter?</h2>

    <!-- Subheadline from landing-page-copy.md:321-323 -->
    <p class="text-xl text-base-content/70 mb-12 max-w-2xl mx-auto">Free to install. No configuration needed. Works with your existing Claude Code setup.</p>

    <!-- CTA Button with pulse -->
    <a
      href="vscode:extension/your-publisher.ptah-extension"
      class="cta-button inline-block px-12 py-6 text-xl font-bold rounded-xl
              bg-gradient-to-r from-secondary to-accent
              text-base-100 shadow-glow-gold
              hover:scale-110 hover:shadow-glow-gold-lg
              transition-all duration-300 animate-pulse-ring"
    >
      Install Ptah Extension
    </a>

    <!-- Secondary link -->
    <div class="mt-8">
      <a href="#" class="text-secondary hover:text-accent transition-colors"> Read the Documentation → </a>
    </div>

    <!-- Divider (for Task 3.4) -->
    <div class="divider-container mt-16 overflow-hidden">
      <div class="golden-divider h-[2px] w-full bg-gradient-to-r from-transparent via-secondary to-transparent"></div>
    </div>
  </div>
</section>
```

---

### Task 3.4: Add Golden Divider Draw Animation ✅ COMPLETE

**File**: D:\projects\ptah-extension\apps\ptah-landing-page\src\app\sections\cta\cta-section.component.ts
**Type**: MODIFY
**Dependencies**: Task 3.3
**Spec Reference**: implementation-plan.md:654-714
**Pattern to Follow**: hero-section.component.ts:162-262 (GSAP context pattern)

**Quality Requirements**:

- Add GSAP animation to draw golden divider on scroll-in
- Use divider-draw animation (from Tailwind config Batch 1)
- Trigger at 85% viewport entry
- Respect prefers-reduced-motion
- Add component lifecycle (afterNextRender + DestroyRef cleanup)

**Validation Notes**:

- This section currently has NO GSAP animations (unlike hero/features)
- Must add full GSAP lifecycle pattern

**Implementation Details**:

```typescript
// ADD to component class:
import { Component, ChangeDetectionStrategy, viewChild, ElementRef, inject, DestroyRef, afterNextRender } from '@angular/core';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

@Component({
  // ... existing metadata ...
})
export class CTASectionComponent {
  private readonly sectionRef = viewChild.required<ElementRef>('sectionRef');
  private readonly destroyRef = inject(DestroyRef);
  private gsapContext?: gsap.Context;

  constructor() {
    afterNextRender(() => this.initAnimations());
  }

  private initAnimations(): void {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    this.gsapContext = gsap.context(() => {
      // Divider draw animation
      gsap.from('.golden-divider', {
        scaleX: 0,
        duration: 1.5,
        ease: 'power2.out',
        scrollTrigger: {
          trigger: '.divider-container',
          start: 'top 85%',
          toggleActions: 'play none none reverse',
        },
      });
    }, this.sectionRef().nativeElement);

    this.destroyRef.onDestroy(() => {
      ScrollTrigger.getAll().forEach((trigger) => trigger.kill());
      this.gsapContext?.revert();
    });
  }
}
```

---

**Batch 3 Verification**:

- [x] Hero headline uses text-8xl with gold gradient
- [x] Hero entry animation sequence (headline → tagline → CTA) works
- [x] CTA headline text-7xl with gold gradient
- [x] CTA button has continuous pulse-ring animation
- [x] Golden divider draws on scroll-in
- [x] All copy from landing-page-copy.md applied correctly
- [x] prefers-reduced-motion disables all animations

---

## Batch 4: Card & Chrome - Features + Demo Sections ✅ COMPLETE

**Developer**: frontend-developer
**Tasks**: 4 | **Dependencies**: Batch 1 complete (uses glassmorphism class)
**Duration**: 3-4 hours
**Commit**: 20180f3

### Task 4.1: Enhance Feature Card Design ✅ COMPLETE

**File**: D:\projects\ptah-extension\apps\ptah-landing-page\src\app\sections\features\feature-card.component.ts
**Type**: MODIFY
**Spec Reference**: implementation-plan.md:422-515
**Pattern to Follow**: Existing FeatureCardComponent

**Quality Requirements**:

- Add min-h-[400px] for visual weight
- Create 80px icon container with gradient background circle
- Add hover transform: translateY(-8px) + rotate(1deg)
- Add hover glow: box-shadow with gold color
- Convert capability bullet list to badge pills (DaisyUI badges)
- Apply copy from landing-page-copy.md:136-234 (4 feature cards)

**Validation Notes**:

- Hover effects are GPU accelerated (CSS transforms)
- No accessibility impact (hover is decorative)

**Implementation Details**:

```typescript
// MODIFY template:
@Component({
  selector: 'ptah-feature-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div
      class="feature-card min-h-[400px] bg-base-200 border border-base-300 rounded-2xl p-8
                transition-all duration-300 hover:border-secondary"
    >
      <!-- Icon with gradient background circle -->
      <div class="icon-container w-20 h-20 rounded-full flex items-center justify-center mb-6" style="background: radial-gradient(circle, rgba(212,175,55,0.2), transparent);">
        <span class="text-6xl">{{ iconEmoji }}</span>
      </div>

      <h3 class="text-2xl font-display font-bold text-accent mb-4">{{ title }}</h3>
      <p class="text-base-content/70 mb-6">{{ description }}</p>

      <!-- Capability pills (replace bullet list) -->
      <div class="flex flex-wrap gap-2">
        @for (cap of capabilities; track cap) {
        <span class="badge badge-secondary badge-outline">{{ cap }}</span>
        }
      </div>
    </div>
  `,
  styles: [
    `
      .feature-card:hover {
        transform: translateY(-8px) rotate(1deg);
        box-shadow: 0 0 60px rgba(212, 175, 55, 0.3);
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FeatureCardComponent {
  @Input() iconEmoji!: string;
  @Input() title!: string;
  @Input() description!: string;
  @Input() capabilities: string[] = [];
}
```

---

### Task 4.2: Update Features Section Grid & Content ✅ COMPLETE

**File**: D:\projects\ptah-extension\apps\ptah-landing-page\src\app\sections\features\features-section.component.ts
**Type**: MODIFY
**Dependencies**: Task 4.1
**Spec Reference**: implementation-plan.md:470-473
**Pattern to Follow**: features-section.component.ts:45-135

**Quality Requirements**:

- Update grid gap: gap-8 → gap-12 (48px breathing room)
- Adjust GSAP stagger delay: 0.2s → 0.15s
- Apply section content from landing-page-copy.md:117-234
- Update feature card data with new copy (4 cards: Visual Interface, SDK Performance, Workspace Intelligence, Multi-Provider)

**Validation Notes**:

- No risks - layout and content changes
- Ensure stagger animation still visible (0.15s may be faster but should work)

**Implementation Details**:

```typescript
// MODIFY template grid:
<div class="grid md:grid-cols-2 gap-12">
  @for (feature of features; track feature.title) {
    <ptah-feature-card
      [iconEmoji]="feature.iconEmoji"
      [title]="feature.title"
      [description]="feature.description"
      [capabilities]="feature.capabilities" />
  }
</div>

// UPDATE features data (from landing-page-copy.md):
features = [
  {
    iconEmoji: '🎨', // layout-dashboard icon placeholder
    title: 'Native Chat, Zero Context Switching',
    description: 'Stop toggling terminals. Ptah brings Claude Code\'s full power into a native VS Code sidebar with 48+ hand-crafted components. Chat, view execution trees, and track sessions—all without leaving your editor.',
    capabilities: ['48+ Angular components', 'ExecutionNode tree visualization', 'Real-time streaming responses', 'Multi-session management']
  },
  {
    iconEmoji: '⚡', // zap icon placeholder
    title: '10x Faster With Official SDK',
    description: 'Ditch the CLI overhead. Ptah uses the official Claude Agent SDK for native TypeScript integration. Get instant streaming, built-in session management, and permission handling—no subprocess spawning required.',
    capabilities: ['Official @anthropic-ai/claude-agent-sdk', 'Native streaming support', 'Zero CLI latency', 'Built-in session persistence']
  },
  {
    iconEmoji: '🧠', // brain icon placeholder
    title: 'Your Codebase, Understood',
    description: 'Ptah doesn\'t just chat—it comprehends. 20+ specialized services analyze your workspace, detect 13+ project types, optimize token budgets, and auto-select relevant files. Claude gets the context it needs, nothing it doesn\'t.',
    capabilities: ['13+ project type detection', 'Intelligent file ranking', 'Token budget optimization', 'Autocomplete discovery']
  },
  {
    iconEmoji: '🌐', // network icon placeholder
    title: 'One Interface, Five AI Providers',
    description: 'Never get locked in. Ptah\'s multi-provider abstraction supports Anthropic, OpenAI, Google Gemini, OpenRouter, and VS Code LM API. Switch models mid-conversation. Compare responses. Your choice, your control.',
    capabilities: ['Anthropic (Claude)', 'OpenAI (GPT-4)', 'Google Gemini', 'OpenRouter gateway', 'VS Code LM API']
  }
];

// MODIFY GSAP stagger timing:
gsap.from('.feature-card', {
  scrollTrigger: {
    trigger: '.features-grid',
    start: 'top 85%',
  },
  opacity: 0,
  y: 40,
  stagger: 0.15, // Changed from 0.2s
  duration: 0.6,
  ease: 'power3.out',
});
```

---

### Task 4.3: Add Glassmorphism to Demo Window Chrome ✅ COMPLETE

**File**: D:\projects\ptah-extension\apps\ptah-landing-page\src\app\sections\demo\demo-section.component.ts
**Type**: MODIFY
**Spec Reference**: implementation-plan.md:335-418
**Pattern to Follow**: demo-section.component.ts:42-138

**Quality Requirements**:

- Add glassmorphism utility class (from Batch 1) to demo window
- Add gradient header bar (gold-to-transparent)
- Add border pulse animation on hover (using glow-pulse from Tailwind config)
- Ensure backdrop-filter fallback works (solid background if not supported)
- Add GSAP scroll animation (scale 0.95 → 1.0 on viewport entry)

**Validation Notes**:

- Risk: backdrop-filter not supported in older browsers
- Mitigation: @supports fallback in global styles (from Batch 1) handles this
- Edge case: Mobile devices may not show blur - acceptable graceful degradation

**Implementation Details**:

```html
<!-- MODIFY template: -->
<section #sectionRef id="demo" class="py-32 bg-base-200">
  <div class="container mx-auto px-6">
    <!-- Section label -->
    <p class="text-sm tracking-widest text-secondary uppercase text-center mb-4">SEE IT IN ACTION</p>

    <h2 class="text-5xl md:text-6xl font-display font-bold text-center mb-16">Watch Your Codebase Come Alive</h2>

    <!-- Demo window with glassmorphism -->
    <div class="demo-container max-w-4xl mx-auto">
      <div
        class="demo-window glassmorphism rounded-2xl overflow-hidden border border-secondary/20
                  hover:animate-glow-pulse transition-all"
      >
        <!-- Gradient header bar -->
        <div class="header-gradient h-10 flex items-center px-4" style="background: linear-gradient(90deg, rgba(212,175,55,0.1) 0%, transparent 50%, rgba(212,175,55,0.1) 100%);">
          <!-- Traffic light dots -->
          <div class="flex gap-2">
            <div class="w-3 h-3 rounded-full bg-error"></div>
            <div class="w-3 h-3 rounded-full bg-warning"></div>
            <div class="w-3 h-3 rounded-full bg-success"></div>
          </div>
        </div>

        <!-- Chat content (keep existing) -->
        <div class="p-8">
          <!-- Existing demo content -->
        </div>
      </div>
    </div>
  </div>
</section>
```

```typescript
// ADD GSAP scroll animation:
private initAnimations(): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  this.gsapContext = gsap.context(() => {
    // Scale-in animation on viewport entry
    gsap.from('.demo-window', {
      scrollTrigger: {
        trigger: '.demo-container',
        start: 'top 80%',
        toggleActions: 'play none none reverse',
      },
      scale: 0.95,
      opacity: 0,
      duration: 0.8,
      ease: 'power3.out',
    });
  }, this.sectionRef().nativeElement);

  this.destroyRef.onDestroy(() => {
    ScrollTrigger.getAll().forEach(trigger => trigger.kill());
    this.gsapContext?.revert();
  });
}
```

---

### Task 4.4: Apply Section Headers & Copy Integration ✅ COMPLETE

**File**: D:\projects\ptah-extension\apps\ptah-landing-page\src\app\sections\features\features-section.component.ts
**Type**: MODIFY
**Dependencies**: Task 4.2
**Spec Reference**: landing-page-copy.md:117-134

**Quality Requirements**:

- Add eyebrow label "SUPERPOWERS" above section headline
- Update section headline to "Everything You Need to Master Claude Code"
- Apply consistent section header styling (eyebrow: text-sm tracking-widest gold)
- Ensure spacing matches design spec

**Validation Notes**:

- No risks - content and styling only

**Implementation Details**:

```html
<!-- ADD to features-section template: -->
<section #sectionRef id="features" class="py-32 bg-base-100">
  <div class="container mx-auto px-6">
    <!-- Eyebrow label -->
    <p class="text-sm tracking-widest text-secondary uppercase text-center mb-4">SUPERPOWERS</p>

    <!-- Section headline -->
    <h2 class="text-5xl md:text-6xl font-display font-bold text-center mb-16">Everything You Need to Master Claude Code</h2>

    <!-- Features grid (existing) -->
    <div class="grid md:grid-cols-2 gap-12">
      <!-- ... feature cards ... -->
    </div>
  </div>
</section>
```

---

**Batch 4 Verification**:

- [x] Feature cards min-height 400px with hover lift effect
- [x] Feature card icons in gradient circles
- [x] Capability pills (not bullet lists)
- [x] Grid gap increased to 48px
- [x] Demo window has glassmorphism effect (blurred background visible)
- [x] Demo window gradient header bar visible
- [x] Demo window scale-in animation on scroll
- [x] All copy from landing-page-copy.md applied
- [x] Section headers with eyebrow labels

---

## Batch 5: SVG Arrow - Comparison Section 🔄 IN PROGRESS

**Developer**: frontend-developer
**Tasks**: 2 | **Dependencies**: Batch 1 complete
**Duration**: 2-3 hours

### Task 5.1: Replace Text Arrow with Animated SVG 🔄 IMPLEMENTED

**File**: D:\projects\ptah-extension\apps\ptah-landing-page\src\app\sections\comparison\comparison-section.component.ts
**Type**: MODIFY
**Spec Reference**: implementation-plan.md:519-623
**Pattern to Follow**: comparison-section.component.ts:16-138

**Quality Requirements**:

- Replace simple text arrow (→) with SVG arrow
- SVG should have gradient (gray → gold) and glow filter
- Position absolutely between Before/After cards
- Hide on mobile (hidden md:block)
- Add stroke-dasharray/stroke-dashoffset for draw animation
- Ensure aria-hidden="true" (decorative element)

**Validation Notes**:

- SVG is decorative - no accessibility impact
- Animation uses CSS stroke-dashoffset (not GSAP DrawSVG plugin - licensing)

**Implementation Details**:

```html
<!-- REPLACE arrow in template: -->
<div class="relative grid md:grid-cols-2 gap-8">
  <!-- Before Card (keep existing) -->
  <div class="before-card bg-base-200 rounded-2xl p-8 border border-base-300">
    <!-- ... existing content ... -->
  </div>

  <!-- SVG Arrow (hidden on mobile) -->
  <div class="hidden md:block absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
    <svg class="arrow-svg" viewBox="0 0 120 120" width="120" height="120" aria-hidden="true">
      <defs>
        <linearGradient id="arrowGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#6b7280" />
          <stop offset="100%" stop-color="#d4af37" />
        </linearGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="3" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <path d="M 10 60 L 70 60 M 55 45 L 70 60 L 55 75" stroke="url(#arrowGradient)" stroke-width="4" fill="none" filter="url(#glow)" stroke-dasharray="100" stroke-dashoffset="100" class="arrow-path" />
    </svg>
  </div>

  <!-- After Card (keep existing) -->
  <div class="after-card bg-base-200 rounded-2xl p-8 border-2 border-secondary shadow-glow-gold">
    <!-- ... existing content ... -->
  </div>
</div>
```

---

### Task 5.2: Add Arrow Draw & Card Entrance Animations 🔄 IMPLEMENTED

**File**: D:\projects\ptah-extension\apps\ptah-landing-page\src\app\sections\comparison\comparison-section.component.ts
**Type**: MODIFY
**Dependencies**: Task 5.1
**Spec Reference**: implementation-plan.md:565-623
**Pattern to Follow**: comparison-section.component.ts:16-138 (add GSAP context if missing)

**Quality Requirements**:

- Animate SVG arrow draw (stroke-dashoffset 100 → 0) on scroll-in
- Add Before card shake animation (gentle horizontal shake)
- Add After card scale animation (0.9 → 1.0 with bounce)
- Sequence animations: Before card → Arrow → After card
- Respect prefers-reduced-motion
- Apply comparison copy from landing-page-copy.md:240-304

**Validation Notes**:

- Assumption: Section already has GSAP context (verify first)
- If no GSAP context, add full lifecycle pattern

**Implementation Details**:

```typescript
// ADD or MODIFY initAnimations():
private initAnimations(): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  this.gsapContext = gsap.context(() => {
    // Timeline for coordinated animations
    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: this.sectionRef().nativeElement,
        start: 'top 80%',
        toggleActions: 'play none none reverse',
      }
    });

    // Before card gentle shake
    tl.from('.before-card', {
      x: -20,
      opacity: 0,
      duration: 0.6,
      ease: 'power3.out',
    });

    // Arrow draw animation
    tl.to('.arrow-path', {
      strokeDashoffset: 0,
      duration: 1.2,
      ease: 'power2.inOut',
    }, '-=0.2');

    // After card scale with bounce
    tl.from('.after-card', {
      scale: 0.9,
      opacity: 0,
      duration: 0.6,
      ease: 'back.out(1.7)',
    }, '-=0.6');

  }, this.sectionRef().nativeElement);

  this.destroyRef.onDestroy(() => {
    ScrollTrigger.getAll().forEach(trigger => trigger.kill());
    this.gsapContext?.revert();
  });
}

// UPDATE comparison data with copy from landing-page-copy.md:240-304
sectionHeadline = 'From Terminal Chaos to Visual Clarity';

beforePoints = [
  'Context-switching between terminal and editor kills flow',
  'No visual feedback—just text scrolling in a black box',
  'Session management means memorizing CLI flags and paths',
  'File context requires manual specification every time',
  'Tracking token usage and costs means parsing logs'
];

afterPoints = [
  'Native sidebar keeps chat next to code—zero context loss',
  'ExecutionNode trees visualize agent spawning in real-time',
  'Click to switch sessions, track costs, manage multiple contexts',
  'Workspace intelligence auto-ranks files by relevance',
  'Real-time dashboard shows tokens, costs, performance metrics'
];
```

---

**Batch 5 Verification**:

- [ ] SVG arrow visible between cards (desktop only)
- [ ] Arrow draws from left to right on scroll-in
- [ ] Arrow has gradient (gray → gold) and glow effect
- [ ] Before card has shake entrance animation
- [ ] After card has scale-up bounce entrance
- [ ] Arrow hidden on mobile (< 768px)
- [ ] Comparison copy from landing-page-copy.md applied
- [ ] Section headline updated

---

## Batch 6: Content Integration & Polish ⏸️ PENDING

**Developer**: frontend-developer
**Tasks**: 3 | **Dependencies**: All previous batches complete
**Duration**: 2-3 hours

### Task 6.1: Apply Hero Section Final Copy ⏸️ PENDING

**File**: D:\projects\ptah-extension\apps\ptah-landing-page\src\app\sections\hero\hero-section.component.ts
**Type**: MODIFY
**Spec Reference**: landing-page-copy.md:28-72

**Quality Requirements**:

- Verify headline: "Ancient Wisdom for Modern AI" (already applied in Batch 3.1)
- Verify tagline: "Transform Claude Code CLI..." (already applied in Batch 3.1)
- Update primary CTA text: "Install Free"
- Add secondary scroll indicator: "↓ See what it builds"
- Ensure all text has proper contrast (WCAG AA)

**Validation Notes**:

- Most copy already applied in Batch 3
- This task verifies completeness and adds scroll indicator

**Implementation Details**:

```html
<!-- VERIFY/UPDATE hero CTAs: -->
<div class="hero-ctas flex flex-col sm:flex-row gap-4 justify-center items-center">
  <a href="vscode:extension/your-publisher.ptah-extension" class="btn btn-secondary btn-lg px-8"> Install Free </a>

  <!-- Secondary scroll indicator -->
  <a href="#demo" class="text-secondary hover:text-accent transition-colors flex items-center gap-2">
    <span>See what it builds</span>
    <span class="animate-bounce">↓</span>
  </a>
</div>
```

---

### Task 6.2: Add Demo Section Copy & Callouts ⏸️ PENDING

**File**: D:\projects\ptah-extension\apps\ptah-landing-page\src\app\sections\demo\demo-section.component.ts
**Type**: MODIFY
**Spec Reference**: landing-page-copy.md:75-113

**Quality Requirements**:

- Add section label: "SEE IT IN ACTION" (already added in Batch 4.3)
- Verify section headline: "Watch Your Codebase Come Alive"
- Add 3 callout annotations if using video demo:
  - "Native VS Code Integration" → points to sidebar
  - "Real-Time Execution Tree" → points to ExecutionNode visualization
  - "10x Faster Than CLI" → points to streaming response
- If using static screenshot, add caption with key benefits

**Validation Notes**:

- Demo implementation (video vs screenshot) may vary
- Callouts are optional but enhance understanding

**Implementation Details**:

```html
<!-- ADD demo callouts (if using video): -->
<div class="demo-content relative">
  <!-- Video or screenshot -->
  <div class="demo-media rounded-lg overflow-hidden">
    <!-- Video element or img -->
  </div>

  <!-- Optional callouts -->
  <div class="demo-callouts absolute inset-0 pointer-events-none">
    <div class="callout" style="top: 20%; left: 10%;">
      <span class="badge badge-secondary">Native VS Code Integration</span>
    </div>
    <div class="callout" style="top: 50%; right: 10%;">
      <span class="badge badge-secondary">Real-Time Execution Tree</span>
    </div>
    <div class="callout" style="bottom: 20%; left: 50%;">
      <span class="badge badge-secondary">10x Faster Than CLI</span>
    </div>
  </div>
</div>
```

---

### Task 6.3: Add Footer with Links & Legal ⏸️ PENDING

**File**: D:\projects\ptah-extension\apps\ptah-landing-page\src\app\sections\cta\cta-section.component.ts (or create footer.component.ts)
**Type**: MODIFY or CREATE
**Spec Reference**: landing-page-copy.md:352-380

**Quality Requirements**:

- Add brand tagline: "Ptah - Craftsman of AI Development"
- Add navigation links: Documentation | GitHub | Marketplace | Community
- Add social links: Twitter/X | Discord | GitHub
- Add legal footer: © 2025 Ptah Extension | MIT License | Privacy | Terms
- Style with minimal dark background and thin gold divider
- Ensure links have hover states (cream → gold color shift)

**Validation Notes**:

- Links may not have destinations yet (use # placeholders)
- MIT License link can point to GitHub repo

**Implementation Details**:

```html
<!-- ADD below CTA section or create separate component: -->
<footer class="bg-base-100 border-t border-secondary/20 py-12">
  <div class="container mx-auto px-6">
    <!-- Brand -->
    <div class="text-center mb-8">
      <h3 class="text-2xl font-display font-bold text-secondary mb-2">Ptah</h3>
      <p class="text-base-content/60">Craftsman of AI Development</p>
    </div>

    <!-- Navigation Links -->
    <nav class="flex flex-wrap justify-center gap-6 mb-8">
      <a href="#" class="text-base-content/70 hover:text-secondary transition-colors">Documentation</a>
      <a href="#" class="text-base-content/70 hover:text-secondary transition-colors">GitHub</a>
      <a href="#" class="text-base-content/70 hover:text-secondary transition-colors">Marketplace</a>
      <a href="#" class="text-base-content/70 hover:text-secondary transition-colors">Community</a>
    </nav>

    <!-- Social Links -->
    <div class="flex justify-center gap-4 mb-8">
      <a href="#" class="text-base-content/70 hover:text-secondary transition-colors" aria-label="Twitter">
        <span class="text-xl">🐦</span>
      </a>
      <a href="#" class="text-base-content/70 hover:text-secondary transition-colors" aria-label="Discord">
        <span class="text-xl">💬</span>
      </a>
      <a href="#" class="text-base-content/70 hover:text-secondary transition-colors" aria-label="GitHub">
        <span class="text-xl">🔗</span>
      </a>
    </div>

    <!-- Legal -->
    <div class="text-center text-sm text-base-content/50">
      <p>
        © 2025 Ptah Extension | <a href="#" class="hover:text-secondary transition-colors">MIT License</a> | <a href="#" class="hover:text-secondary transition-colors">Privacy</a> |
        <a href="#" class="hover:text-secondary transition-colors">Terms</a>
      </p>
    </div>
  </div>
</footer>
```

---

**Batch 6 Verification**:

- [ ] All copy from landing-page-copy.md applied
- [ ] Hero CTAs use correct text ("Install Free", scroll indicator)
- [ ] Demo section has callouts (if using video)
- [ ] Footer with brand, links, social, legal
- [ ] All links have hover states
- [ ] No placeholder text (Lorem Ipsum) remaining
- [ ] All sections use consistent typography hierarchy

---

## Final Quality Gates

### Build Verification

```bash
# Production build must succeed
npx nx build ptah-landing-page

# No errors or warnings
# Output: dist/ptah-landing-page/browser/
```

### Visual Verification (Manual Testing)

- [ ] Hero section has dramatic impact (large headline + 3D Ankh + glow)
- [ ] All animations smooth at 60fps (no jank during scroll)
- [ ] Glassmorphism effect visible in demo window
- [ ] Feature cards lift on hover with glow
- [ ] SVG arrow draws smoothly between comparison cards
- [ ] CTA button has continuous pulse effect
- [ ] Golden divider draws on scroll-in

### Performance Verification (Lighthouse)

- [ ] Performance score > 90
- [ ] First Contentful Paint < 1.5s
- [ ] Cumulative Layout Shift < 0.1
- [ ] No layout shifts during animations

### Accessibility Verification

- [ ] All animations disabled when prefers-reduced-motion is set
- [ ] All text meets WCAG AA contrast ratios (4.5:1 minimum)
- [ ] All interactive elements keyboard accessible (Tab navigation)
- [ ] Decorative elements have aria-hidden="true"
- [ ] Screen reader announces sections correctly

### Responsive Verification

- [ ] Mobile (375px): Cards stack, animations scale, arrow hidden
- [ ] Tablet (768px): 2-column grid works, arrow visible
- [ ] Desktop (1920px): Full layout, optimal spacing

### Cross-Browser Verification

- [ ] Chrome/Edge (latest): Full experience with bloom effect
- [ ] Firefox (latest): Full experience
- [ ] Safari (latest): Glassmorphism works, backdrop-filter supported
- [ ] Fallback: Browsers without backdrop-filter show solid background

---

## Success Criteria Summary

**Implementation Complete When**:

1. All 6 batches marked ✅ COMPLETE
2. All 19 tasks verified and committed
3. Build succeeds with no warnings
4. Visual verification passes (60fps, dramatic impact)
5. Performance metrics meet targets (Lighthouse > 90)
6. Accessibility verified (prefers-reduced-motion, WCAG AA, keyboard nav)
7. Responsive design works across 3 breakpoints
8. All content from landing-page-copy.md integrated

**Deliverables**:

- Enhanced landing page with nano banana aesthetic
- Golden Ankh 3D scene with particle halo and bloom
- Smooth GSAP scroll animations throughout
- Glassmorphism demo window chrome
- Large premium feature cards with hover effects
- Animated SVG comparison arrow
- Bold CTA with pulse animation
- Complete marketing copy integrated

---

**END OF TASKS DOCUMENT**

This tasks.md will be updated by team-leader as batches are assigned, implemented, reviewed, and committed.
