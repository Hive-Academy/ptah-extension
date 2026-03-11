import {
  ViewportAnimationConfig,
  ScrollAnimationConfig,
} from '@hive-academy/angular-gsap';

/**
 * Auth Animation Configurations
 *
 * Shared GSAP animation configurations for auth components.
 * Provides consistent, staggered entrance animations.
 */

// ============================================
// LEFT SIDE (Form) ANIMATIONS
// ============================================

/** Logo - First to appear with fade */
export const LOGO_ANIMATION: ViewportAnimationConfig = {
  animation: 'fadeIn',
  duration: 0.6,
  threshold: 0.1,
  ease: 'power2.out',
  once: true,
};

/** Title - Slide up after logo */
export const TITLE_ANIMATION: ViewportAnimationConfig = {
  animation: 'slideUp',
  duration: 0.7,
  delay: 0.1,
  threshold: 0.1,
  ease: 'power3.out',
  distance: 30,
  once: true,
};

/** Tab switcher - Slide up with delay */
export const TABS_ANIMATION: ViewportAnimationConfig = {
  animation: 'slideUp',
  duration: 0.6,
  delay: 0.2,
  threshold: 0.1,
  ease: 'power2.out',
  distance: 25,
  once: true,
};

/** Alert messages */
export const ALERT_ANIMATION: ViewportAnimationConfig = {
  animation: 'slideUp',
  duration: 0.4,
  threshold: 0.1,
  ease: 'power2.out',
  once: true,
};

/** Email input - Slide up with delay */
export const EMAIL_INPUT_ANIMATION: ViewportAnimationConfig = {
  animation: 'slideUp',
  duration: 0.6,
  delay: 0.3,
  threshold: 0.1,
  ease: 'power2.out',
  distance: 25,
  once: true,
};

/** Password input - Slide up with delay */
export const PASSWORD_INPUT_ANIMATION: ViewportAnimationConfig = {
  animation: 'slideUp',
  duration: 0.6,
  delay: 0.35,
  threshold: 0.1,
  ease: 'power2.out',
  distance: 25,
  once: true,
};

/** Continue button - Slide up with bounce */
export const BUTTON_ANIMATION: ViewportAnimationConfig = {
  animation: 'slideUp',
  duration: 0.6,
  delay: 0.4,
  threshold: 0.1,
  ease: 'back.out(1.4)',
  distance: 25,
  once: true,
};

/** Divider - Fade in */
export const DIVIDER_ANIMATION: ViewportAnimationConfig = {
  animation: 'fadeIn',
  duration: 0.5,
  delay: 0.5,
  threshold: 0.1,
  ease: 'power2.out',
  once: true,
};

// ============================================
// SOCIAL BUTTON ANIMATIONS (Staggered)
// ============================================

/** GitHub button - First social button */
export const SOCIAL_BTN_1_ANIMATION: ViewportAnimationConfig = {
  animation: 'scaleIn',
  duration: 0.5,
  delay: 0.5,
  threshold: 0.1,
  ease: 'back.out(1.7)',
  scale: 0.8,
  once: true,
};

/** Google button - Second social button */
export const SOCIAL_BTN_2_ANIMATION: ViewportAnimationConfig = {
  animation: 'scaleIn',
  duration: 0.5,
  delay: 0.6,
  threshold: 0.1,
  ease: 'back.out(1.7)',
  scale: 0.8,
  once: true,
};

/** Magic Link button - Third social button */
export const SOCIAL_BTN_3_ANIMATION: ViewportAnimationConfig = {
  animation: 'scaleIn',
  duration: 0.5,
  delay: 0.7,
  threshold: 0.1,
  ease: 'back.out(1.7)',
  scale: 0.8,
  once: true,
};

/** Footer text - Fade in last */
export const FOOTER_ANIMATION: ViewportAnimationConfig = {
  animation: 'fadeIn',
  duration: 0.6,
  delay: 0.7,
  threshold: 0.1,
  ease: 'power2.out',
  once: true,
};

// ============================================
// RIGHT SIDE (Hero) ANIMATIONS
// ============================================

/** Parallax background effect */
export const PARALLAX_ANIMATION: ScrollAnimationConfig = {
  animation: 'parallax',
  speed: 0.3,
  scrub: 1.5,
};

/** Main floating card - Bounce in from bottom */
export const HERO_CARD_ANIMATION: ViewportAnimationConfig = {
  animation: 'slideUp',
  duration: 0.8,
  delay: 0.4,
  threshold: 0.1,
  ease: 'back.out(1.2)',
  distance: 40,
  once: true,
};

/** Secondary card - Slide from right */
export const SECONDARY_CARD_ANIMATION: ViewportAnimationConfig = {
  animation: 'slideLeft',
  duration: 0.7,
  delay: 0.6,
  threshold: 0.1,
  ease: 'power3.out',
  distance: 50,
  once: true,
};

// ============================================
// CARD ANIMATION (For simpler pages)
// ============================================

/** Card scale in animation */
export const CARD_ANIMATION: ViewportAnimationConfig = {
  animation: 'scaleIn',
  duration: 0.6,
  threshold: 0.1,
  ease: 'power2.out',
};

// ============================================
// VERIFICATION CODE ANIMATIONS
// ============================================

/** Verification code input */
export const CODE_INPUT_ANIMATION: ViewportAnimationConfig = {
  animation: 'slideUp',
  duration: 0.6,
  delay: 0.2,
  threshold: 0.1,
  ease: 'power2.out',
  distance: 25,
  once: true,
};

/** Verification message */
export const VERIFICATION_MESSAGE_ANIMATION: ViewportAnimationConfig = {
  animation: 'fadeIn',
  duration: 0.5,
  delay: 0.1,
  threshold: 0.1,
  ease: 'power2.out',
  once: true,
};
