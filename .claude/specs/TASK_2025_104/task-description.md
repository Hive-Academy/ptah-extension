# Requirements Document - TASK_2025_104

## Landing Page Premium Redesign

---

## Executive Summary

### Business Context

The current Ptah Extension landing page fails to convey the premium nature of the product. The existing implementation features a simple glowing orange sphere with basic layout, which does not reflect the sophisticated capabilities of Ptah - a VS Code extension powered by the Claude Code Agent SDK with 10x faster AI interactions, Code Execution MCP server, and intelligent workspace analysis.

### Project Goal

Redesign and rebuild the landing page with a premium Glass/Cosmic aesthetic using declarative 3D components and professional scroll animations. The redesign will leverage `@hive-academy/angular-3d` for Three.js scenes and `@hive-academy/angular-gsap` for GSAP-powered animations, ensuring proper memory management and cleanup that was lacking in the previous implementation.

### Approach

**Delete and rebuild** - Remove all existing Three.js code from TASK_2025_072 and start fresh using the declarative library approach. This avoids carrying forward the technical debt and QA issues identified in TASK_2025_072_FIXES.

### Value Proposition

- **Visual Impact**: Transform from basic to premium, reflecting the product's professional-grade capabilities
- **Technical Excellence**: Proper cleanup, no memory leaks, accessibility support
- **Conversion Optimization**: Clear value proposition, evidence-backed claims, strong CTAs

---

## Functional Requirements

### Requirement 1: Hero Section with Glass/Cosmic 3D Scene

**User Story:** As a visitor landing on the Ptah Extension page, I want to see an impressive, premium 3D visual experience that immediately conveys the sophistication of the product, so that I understand this is a professional-grade tool worth my attention.

#### Visual Specification

The hero section SHALL display a Glass/Cosmic themed 3D scene featuring:

1. **Iridescent Glass Spheres** (4-5 spheres using Corner Framing pattern)

   - Positions: Corner framing to leave center clear for content overlay
   - Material: Full transmission (0.9), clearcoat (1.0), iridescence (1.0)
   - Colors: Purple/Pink palette (#e879f9, #a855f7, #f472b6)
   - Animations: `float3d` with staggered timing, `mouseTracking3d` with inverted parallax

2. **Star Field Background** (2 layers for parallax depth)

   - Foreground layer: 2000 stars, rotation speed 0.015, z=-20
   - Background layer: 1000 stars, rotation speed -0.008, z=-40
   - Features: multiSize, stellarColors enabled

3. **Nebula Volumetric Effect**

   - Position: z=-80 (deep background)
   - Color: Purple (#6b21a8)
   - Opacity: 0.3

4. **Lighting Setup** (Three-point professional)

   - Ambient: intensity 0.3
   - Key spotlight: position [0, 16, -6], intensity 120
   - Fill point light: purple accent
   - Rim point light: pink accent
   - Per-sphere spotlights for each corner

5. **Post-Processing**
   - Bloom effect: threshold 0.85, strength 0.4
   - Environment map: sunset preset, intensity 0.8

#### Content Overlay

The hero content SHALL display:

- **Headline**: "VS Code AI Development, Powered Up by Claude Code"
- **Subheadline**: "A VS Code-native extension powered by the Claude Code Agent SDK..."
- **Primary CTA**: "Install Free from VS Code Marketplace"
- **Secondary CTA**: "Watch 3-Minute Demo"
- **Social Proof Bar**: 4 stats (12 libraries, 48+ components, 60+ DI tokens, 94 message types)

#### Acceptance Criteria

1. WHEN the page loads THEN the 3D scene SHALL initialize within 500ms and display the Glass/Cosmic aesthetic
2. WHEN the user moves their mouse THEN the glass spheres SHALL respond with smooth parallax tracking (damping 0.05-0.08)
3. WHEN the user scrolls past the hero THEN the content SHALL fade out smoothly using GSAP scroll animation
4. WHEN `prefers-reduced-motion` is enabled THEN all 3D animations SHALL be disabled and static scene displayed
5. WHEN WebGL context is lost THEN the component SHALL handle gracefully without console errors

---

### Requirement 2: Demo Section with Glassmorphism Window

**User Story:** As a visitor evaluating Ptah, I want to see a visual representation of the product interface, so that I can understand what using the extension looks like.

#### Visual Specification

1. **Glassmorphism Window Container**

   - Background: `rgba(255, 255, 255, 0.05)` with `backdrop-filter: blur(20px)`
   - Border: subtle gradient border with gold/purple accent
   - Window chrome: macOS-style traffic light dots with hover glow

2. **Demo Content**

   - Screenshot or animated preview of Ptah in action
   - Code snippet showing MCP API usage

3. **Scroll Animation**
   - Entry: `scaleIn` from 0.95 with fadeIn
   - Parallax: slight float effect (speed 0.6) as user scrolls past

#### Acceptance Criteria

1. WHEN the demo section enters the viewport THEN it SHALL animate in with scale (0.95 to 1.0) and fade (0 to 1)
2. WHEN the user hovers over the window chrome THEN the traffic light dots SHALL display subtle glow effect
3. WHEN scrolling past the demo THEN the container SHALL have subtle parallax movement

---

### Requirement 3: Features Section with Premium Cards

**User Story:** As a potential user, I want to understand Ptah's key capabilities through visually appealing feature cards, so that I can evaluate if the product meets my needs.

#### Features to Highlight (6 total)

1. **Code Execution MCP Server** - "8 Ptah API namespaces available to your Claude agent"
2. **10x Faster Performance** - "From 500ms to 50ms session creation"
3. **Intelligent Workspace Analysis** - "13+ project types, 6 monorepo tools"
4. **Project-Adaptive Agents** - "Agents tailored to your specific codebase"
5. **Multi-Provider LLM Support** - "5 LLM providers, one unified interface"
6. **Token-Optimized Context** - "Adaptive budgeting up to 200k tokens"

#### Visual Specification

1. **Card Design**

   - Min-height: 400px for visual weight
   - Background: Glassmorphism with subtle gradient
   - Icon: 80px with gradient background circle
   - Hover: translateY(-8px), subtle border glow

2. **Layout**

   - 3-column grid on desktop, responsive down to 1-column
   - Gap: 48px (gap-12)

3. **Animation**
   - Entry: `slideUp` with stagger (0.1s between cards)
   - Easing: `back.out(1.7)` for bouncy feel

#### Acceptance Criteria

1. WHEN the features section enters viewport THEN cards SHALL animate in with staggered slideUp (100ms delay between each)
2. WHEN a user hovers over a feature card THEN it SHALL elevate with translateY(-8px) and display border glow
3. WHEN viewing on mobile (< 768px) THEN cards SHALL stack in single column

---

### Requirement 4: Comparison Section with Before/After

**User Story:** As a developer comparing tools, I want to see a clear visual comparison of development with and without Ptah, so that I can understand the specific value it provides.

#### Visual Specification

1. **Before Card (Pain Points)**

   - Theme: Muted grayscale with subtle red accent
   - Entry animation: slight shake effect
   - Items with animated X icons that draw in
   - Pain points from content: Terminal switching, slow CLI, generic agents, limited context

2. **After Card (Benefits)**

   - Theme: Vibrant with golden glow border
   - Entry animation: scale from 0.9 to 1.0 with punch
   - Items with animated checkmarks that draw in
   - Benefits from content: VS Code native, 10x faster, adaptive agents, optimized context

3. **Performance Metrics Table**

   - Display SDK vs CLI comparison
   - Metrics: Session creation (50ms vs 500ms), First chunk (100ms vs 1000ms), Memory (20MB vs 50MB)

4. **Transition Element**
   - Animated SVG arrow between cards
   - Draws on scroll with glow trail
   - Color transition: muted to gold

#### Acceptance Criteria

1. WHEN comparison section enters viewport THEN the Before card SHALL animate in first, followed by transition arrow, then After card
2. WHEN the transition arrow animates THEN it SHALL draw with SVG path animation and have a fading glow trail
3. WHEN viewing performance metrics THEN numbers SHALL be highlighted with brand colors

---

### Requirement 5: CTA Section with Bold Conversion Elements

**User Story:** As a visitor who has scrolled through the page, I want a clear, compelling call-to-action to install Ptah, so that I can easily take the next step.

#### Visual Specification

1. **Typography**

   - Headline: `text-5xl md:text-7xl` with gold gradient
   - "Get Started Free"
   - Subheadline: "Install from VS Code Marketplace and transform your Claude Code experience in 2 minutes"

2. **Primary CTA Button**

   - Size: Large (64px height)
   - Style: Golden gradient with glow
   - Hover: Scale 1.08 with intensified glow
   - Animation: Subtle continuous pulse ring

3. **Secondary CTAs**

   - "Read the Docs"
   - "Watch Demo"
   - Style: Outline/ghost buttons

4. **Trust Signals**
   - "Open source on GitHub"
   - "Built by developers, for developers"

#### Acceptance Criteria

1. WHEN CTA section enters viewport THEN headline SHALL animate in with slideUp
2. WHEN user hovers over primary CTA THEN button SHALL scale to 1.08 and glow SHALL intensify
3. WHEN primary CTA is clicked THEN user SHALL be directed to VS Code Marketplace

---

## Non-Functional Requirements

### Performance Requirements

| Metric                        | Target          | Measurement Method          |
| ----------------------------- | --------------- | --------------------------- |
| Lighthouse Performance Score  | >= 90           | Chrome DevTools Lighthouse  |
| Time to Interactive (TTI)     | < 2.5s          | Lighthouse                  |
| First Contentful Paint (FCP)  | < 1.5s          | Lighthouse                  |
| Cumulative Layout Shift (CLS) | < 0.1           | Lighthouse                  |
| Animation Frame Rate          | 60fps sustained | Chrome DevTools Performance |
| 3D Scene Initialization       | < 500ms         | Custom timing               |
| Memory Usage (idle)           | < 150MB         | Chrome DevTools Memory      |
| Memory Growth (5min scroll)   | < 20MB          | Chrome DevTools Memory      |

### Accessibility Requirements

1. **Reduced Motion Support**

   - WHEN `prefers-reduced-motion: reduce` is set THEN all GSAP animations SHALL have duration reduced to 0.1s
   - WHEN `prefers-reduced-motion: reduce` is set THEN 3D scene animations (float, rotate, mouseTracking) SHALL be disabled

2. **Keyboard Navigation**

   - All interactive elements (CTAs, links) SHALL be focusable via Tab
   - Focus states SHALL be visible with outline

3. **Screen Reader Support**

   - All images and icons SHALL have appropriate alt text
   - 3D canvas SHALL have aria-label describing the visual

4. **Color Contrast**
   - All text SHALL meet WCAG AA contrast ratio (4.5:1 for normal text, 3:1 for large text)

### Memory Management Requirements

**Critical**: The previous implementation (TASK_2025_072) had memory leak issues. The new implementation SHALL:

1. **Three.js Cleanup**

   - Use `@hive-academy/angular-3d` which handles automatic disposal
   - Verify no orphaned geometries, materials, or textures on component destroy
   - Handle WebGL context loss/restoration events

2. **GSAP Cleanup**

   - Use `@hive-academy/angular-gsap` directives which handle automatic cleanup
   - Do NOT use `ScrollTrigger.getAll().forEach()` for cleanup (this was a bug)
   - Each section component SHALL clean only its own animations via gsapContext.revert()

3. **Event Listener Cleanup**
   - Do NOT use arrow functions for event listeners (prevents cleanup)
   - Use bound method references that can be properly removed

### Reliability Requirements

1. **Error Handling**

   - WHEN WebGL is not supported THEN display fallback gradient background
   - WHEN Three.js scene fails to initialize THEN page SHALL remain functional with CSS-only styling
   - WHEN GSAP fails to load THEN content SHALL display without animations

2. **Browser Support**
   - Chrome 90+, Firefox 88+, Safari 14+, Edge 90+
   - WebGPU preferred, WebGL 2 fallback

---

## Technical Constraints

### Required Libraries

1. **@hive-academy/angular-3d** - MUST use for all 3D rendering

   - Declarative components: `<a3d-scene-3d>`, `<a3d-sphere>`, `<a3d-star-field>`, `<a3d-nebula-volumetric>`
   - Animation directives: `float3d`, `rotate3d`, `mouseTracking3d`
   - Post-processing: `<a3d-effect-composer>`, `<a3d-bloom-effect>`

2. **@hive-academy/angular-gsap** - MUST use for all scroll animations
   - Entry animations: `viewportAnimation` directive with `ViewportAnimationConfig`
   - Scroll animations: `scrollAnimation` directive with `ScrollAnimationConfig`
   - Smooth scrolling: `LenisSmoothScrollService` (optional, for premium feel)

### Code to Delete

The following files from TASK_2025_072 SHALL be deleted:

- `hero-scene.component.ts` (custom Three.js implementation)
- Any raw Three.js/GSAP code not using the library directives
- Related utility files for manual cleanup

### Angular Standards

1. **Standalone Components** - All components MUST be standalone
2. **OnPush Change Detection** - All components MUST use OnPush
3. **Signals** - Use Angular signals for reactive state
4. **No Zone.js** - Must work with zoneless Angular

### File Organization

```
apps/ptah-extension-webview/src/app/features/landing/
  components/
    hero-section/
      hero-section.component.ts      # Content + 3D scene orchestration
      hero-3d-scene.component.ts     # Glass/Cosmic 3D scene
    demo-section/
      demo-section.component.ts
    features-section/
      features-section.component.ts
      feature-card.component.ts
    comparison-section/
      comparison-section.component.ts
    cta-section/
      cta-section.component.ts
  landing-page.component.ts          # Main page orchestrator
```

---

## Acceptance Criteria Summary

### Visual Quality Checklist

- [ ] Hero 3D scene displays Glass/Cosmic aesthetic with iridescent spheres
- [ ] Star field has visible parallax depth with 2 layers
- [ ] Nebula provides atmospheric purple backdrop
- [ ] Glass spheres respond to mouse movement
- [ ] Glassmorphism effects render correctly (blur, transparency)
- [ ] Feature cards have proper hover states with elevation
- [ ] Comparison section clearly shows before/after contrast
- [ ] CTA button has visible glow and hover animation
- [ ] All gradient text renders correctly

### Technical Quality Checklist

- [ ] Lighthouse Performance score >= 90
- [ ] No memory leaks after 5 minutes of scrolling
- [ ] 60fps maintained during scroll animations
- [ ] WebGL context loss handled gracefully
- [ ] All components use OnPush change detection
- [ ] No raw Three.js/GSAP code - all via library directives
- [ ] Components properly clean up on destroy

### Accessibility Checklist

- [ ] `prefers-reduced-motion` respected - animations disabled/reduced
- [ ] All CTAs keyboard accessible
- [ ] Focus states visible
- [ ] 3D canvas has aria-label
- [ ] Color contrast meets WCAG AA

### Content Checklist

- [ ] All copy from LANDING_PAGE.md implemented
- [ ] Stats in social proof bar match codebase reality
- [ ] Performance claims (10x, 500ms to 50ms) accurately displayed
- [ ] Feature descriptions match library CLAUDE.md documentation

---

## Out of Scope

The following are explicitly NOT part of this task:

1. **Backend Changes** - No API endpoints, no server-side rendering changes
2. **Routing** - Landing page remains at existing route
3. **Authentication** - No login/signup functionality
4. **Analytics Integration** - No tracking code implementation
5. **SEO Optimization** - Meta tags exist in content spec but implementation deferred
6. **Internationalization** - English only
7. **Video Production** - Demo video placeholder only, not actual video creation
8. **Mobile App** - Desktop/responsive web only
9. **A/B Testing** - Single design implementation

---

## Risk Assessment

### Technical Risks

| Risk                                 | Probability | Impact | Mitigation                                          |
| ------------------------------------ | ----------- | ------ | --------------------------------------------------- |
| WebGL performance on low-end devices | Medium      | High   | Implement quality detection, reduce particle counts |
| Library version incompatibility      | Low         | Medium | Pin versions, test before upgrade                   |
| Memory leaks from improper cleanup   | Low         | High   | Use library directives exclusively, profile memory  |

### Visual Risks

| Risk                                | Probability | Impact | Mitigation                                  |
| ----------------------------------- | ----------- | ------ | ------------------------------------------- |
| Glass effect too subtle on monitors | Medium      | Medium | Increase iridescence, add point lights      |
| Animation jank on scroll            | Low         | High   | Use scrub values, avoid expensive callbacks |

### Schedule Risks

| Risk                               | Probability | Impact | Mitigation                      |
| ---------------------------------- | ----------- | ------ | ------------------------------- |
| 3D scene complexity underestimated | Medium      | Medium | Start with basic scene, iterate |
| Browser compatibility issues       | Low         | Medium | Test on target browsers early   |

---

## Dependencies

### External Dependencies

- `@hive-academy/angular-3d` - 3D scene rendering
- `@hive-academy/angular-gsap` - Scroll animations
- DaisyUI - UI component styling (existing)
- Tailwind CSS - Utility classes (existing)

### Internal Dependencies

- Landing page content from `docs/content/LANDING_PAGE.md`
- Existing routing and app shell
- Shared UI components from `libs/frontend/ui`

---

## Success Metrics

| Metric                     | Current       | Target   | Measurement         |
| -------------------------- | ------------- | -------- | ------------------- |
| Visual Appeal (subjective) | Basic         | Premium  | Stakeholder review  |
| Performance Score          | Unknown       | >= 90    | Lighthouse          |
| Memory Stability           | Leaks present | No leaks | DevTools profiling  |
| Animation Smoothness       | N/A           | 60fps    | Performance monitor |
| Accessibility              | Unknown       | WCAG AA  | axe DevTools        |

---

## Stakeholder Analysis

### Primary Stakeholders

| Stakeholder      | Role                | Interest                 | Success Criteria                   |
| ---------------- | ------------------- | ------------------------ | ---------------------------------- |
| End Users        | Visitors/Developers | Understand product value | Clear value proposition, fast load |
| Product Owner    | Business            | Conversions              | Premium feel, clear CTAs           |
| Development Team | Implementation      | Maintainability          | Clean code, library patterns       |

### Secondary Stakeholders

| Stakeholder | Role        | Interest       | Success Criteria               |
| ----------- | ----------- | -------------- | ------------------------------ |
| QA          | Testing     | Stability      | No regressions, proper cleanup |
| DevOps      | Performance | Resource usage | Memory stable, performant      |

---

## Document History

| Version | Date       | Author                | Changes                       |
| ------- | ---------- | --------------------- | ----------------------------- |
| 1.0     | 2025-01-18 | Project Manager Agent | Initial requirements document |
