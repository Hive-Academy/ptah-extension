# Task Context - TASK_2025_104

## User Intent

Based on experience with angular-gsap and angular-3d skills, implement a complete landing page redesign to properly reflect Ptah's premium features. Current UI (screenshot: C:\Users\abdal\Downloads\screencapture-localhost-4200-2026-01-18-21_43_52.png) does not reflect the premium features offered.

## Conversation Summary

- User has developed `angular-gsap-animation-crafter` skill for GSAP animations
- User has developed `angular-3d-scene-crafter` skill for Three.js scenes
- TASK_2025_072 attempted landing page enhancement but left QA issues (TASK_2025_072_FIXES)
- Current landing page shows basic UI that doesn't match premium positioning
- Existing content spec in `docs/content/LANDING_PAGE.md` provides evidence-based copy
- Previous design spec attempted "nano banana" aesthetic (BlueYard-inspired)

## Technical Context

- Branch: feature/sdk-only-migration (current)
- Created: 2026-01-18
- Type: FEATURE (UI Enhancement)
- Complexity: Complex

### CRITICAL: Target Project

**Target**: `apps/ptah-landing-page/` - Standalone Angular 20 marketing website

**NOT**: `libs/frontend/landing/` or `apps/ptah-extension-webview/`

The landing page is a **completely separate project** from the VS Code extension:

- Separate build: `nx build ptah-landing-page`
- Separate serve: `nx serve ptah-landing-page`
- Static deployment: Netlify, Vercel, GitHub Pages
- NO VS Code API dependencies
- Has its own `app.config.ts` at `apps/ptah-landing-page/src/app/app.config.ts`

### Existing Structure (apps/ptah-landing-page/)

```
src/app/
├── app.config.ts           # ADD provideGsap, provideLenis here
├── pages/
│   └── landing-page.component.ts  # Main page orchestrator
├── sections/
│   ├── hero/hero.component.ts     # UPGRADE: raw Three.js → angular-3d
│   ├── demo/demo-section.component.ts
│   ├── features/features-section.component.ts  # UPGRADE: cards → hijacked scroll
│   ├── comparison/comparison-section.component.ts  # UPGRADE: cards → parallax split
│   └── cta/cta-section.component.ts
├── components/
│   ├── navigation.component.ts
│   └── demo-chat-view.component.ts
└── services/
    └── static-session.provider.ts
```

## Key Assets Available

### Skills

1. **angular-3d-scene-crafter** - Creates Three.js scenes with declarative Angular components

   - Scene types: Cyberpunk Neon, Space/Cosmic, Glass/Bubble, Geometric Abstract, Particle Effects
   - Components: spheres, planets, star fields, nebulas, particle systems, text
   - Effects: bloom, selective bloom, environment maps
   - Animations: float3d, rotate3d, mouseTracking3d

2. **angular-gsap-animation-crafter** - Creates GSAP scroll animations
   - Directives: scrollAnimation, viewportAnimation, hijackedScroll
   - Animations: parallax, fadeIn, slideUp, scaleIn, rotateIn, bounceIn
   - Patterns: Hero Entrance Stagger, Parallax Background, Content Fade-Out
   - Features: ScrollTrigger, stagger, scrub, pinning

### Previous Work (TASK_2025_072)

- Visual design spec: "nano banana" aesthetic with BlueYard Capital inspiration
- Golden Ankh 3D scene concept
- Glassmorphism panels
- GSAP scroll animations
- Issues: Memory leaks, cleanup problems, race conditions

### Content (docs/content/)

- LANDING_PAGE.md - Complete evidence-based copy
- BLOG_POST_10X_PERFORMANCE.md
- BLOG_POST_MCP_SUPERPOWERS.md
- VIDEO_SCRIPT_HIDDEN_FEATURES.md
- VIDEO_SCRIPT_PRODUCT_DEMO.md

## Execution Strategy

FEATURE workflow with design focus:

1. Project Manager - Define scope and requirements
2. UI/UX Designer - Create design system (if needed) and visual spec
3. Software Architect - Implementation plan using angular-3d and angular-gsap
4. Team Leader - Task decomposition
5. Frontend Developer - Implementation
6. QA - Style + Logic reviews
7. Modernization detector - Future enhancements

## Key Decisions Needed

1. **3D Scene Approach**: New implementation using angular-3d library vs fixing existing Three.js code
2. **Animation Approach**: Use angular-gsap directives vs custom GSAP code
3. **Design Direction**: Keep BlueYard "nano banana" aesthetic or explore alternatives
4. **Scope**: Full page redesign vs hero section focus

## Success Criteria

1. Landing page visually reflects premium positioning
2. 3D hero scene using @hive-academy/angular-3d library
3. Scroll animations using @hive-academy/angular-gsap library
4. No memory leaks or cleanup issues
5. Build passes with no errors
6. Proper prefers-reduced-motion support

## Complementary Task (TASK_2025_105)

**Scope**: Add Setup Wizard and OpenRouter sections to landing page

Features to add in follow-up task:

1. **Setup Wizard Showcase** - 6-step wizard demo/animation

   - Codebase scanning visualization
   - Agent selection UI
   - AI-powered rule generation

2. **OpenRouter Model Mapping** - Model flexibility showcase
   - 200+ models via OpenRouter
   - Tier override system (Sonnet/Opus/Haiku)
   - Tool use compatibility indicators

**Rationale**: Keep TASK_2025_104 focused on core visual redesign using angular-3d and angular-gsap. Add these premium features in dedicated follow-up.
