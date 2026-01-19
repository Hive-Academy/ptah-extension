/**
 * Landing Library - Main Entry Point
 *
 * ARCHITECTURE: Premium landing page with 3D effects and scroll animations
 *
 * EXPORTS:
 * - LandingPageComponent: Main orchestrator component
 * - Section components: Hero, Demo, Features, Comparison, CTA
 * - Types: Feature, SocialProofStat, PerformanceMetric, PainPoint, Benefit
 *
 * USAGE:
 * Import LandingPageComponent in app-shell for the 'landing' view:
 *
 * @example
 * ```typescript
 * import { LandingPageComponent } from '@ptah-extension/landing';
 *
 * // In app-shell template:
 * // @case ('landing') { <ptah-landing-page /> }
 * ```
 */

// Main component (entry point for app-shell integration)
export { LandingPageComponent } from './lib/components/landing-page.component';

// Hero section components (Batch 2)
export { HeroSectionComponent } from './lib/components/hero-section/hero-section.component';
export { Hero3dSceneComponent } from './lib/components/hero-section/hero-3d-scene.component';
export { HeroContentOverlayComponent } from './lib/components/hero-section/hero-content-overlay.component';

// Types
export * from './lib/types/landing.types';
