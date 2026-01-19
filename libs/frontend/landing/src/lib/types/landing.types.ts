/**
 * Landing Page Type Definitions
 *
 * Types used across landing page components for features, stats, and metrics.
 */

/**
 * Feature displayed in the hijacked scroll section
 */
export interface Feature {
  title: string;
  headline: string;
  description: string;
  metric: string;
  icon: string;
  gradient: string;
  bgGlow: string;
}

/**
 * Social proof statistic displayed in hero section
 */
export interface SocialProofStat {
  value: string;
  label: string;
}

/**
 * Performance metric comparing CLI vs SDK
 */
export interface PerformanceMetric {
  name: string;
  cli: string;
  sdk: string;
  improvement: string;
}

/**
 * Pain point for comparison section (Before Ptah)
 */
export interface PainPoint {
  text: string;
  detail: string;
}

/**
 * Benefit for comparison section (With Ptah)
 */
export interface Benefit {
  text: string;
  detail: string;
}
