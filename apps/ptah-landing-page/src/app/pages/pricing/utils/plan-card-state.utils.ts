import {
  PlanSubscriptionContext,
  PlanBadgeVariant,
  PlanCtaVariant,
  TRIAL_WARNING_THRESHOLD_DAYS,
} from '../models/pricing-plan.interface';

/**
 * Plan Card State Utilities
 *
 * Shared utility functions for computing plan card state (badge variant, CTA variant, etc.)
 * Used by CommunityPlanCardComponent and ProPlanCardComponent to eliminate code duplication.
 *
 * TASK_2025_128: Freemium Model
 * - Community: FREE forever, Pro: $5/month or $50/year
 *
 * Evidence: TASK_2025_127 - QA Review Issue #5 - Code Duplication
 * Evidence: TASK_2025_128 - Freemium Model Conversion
 */

/**
 * Compute the badge variant for a plan card based on subscription context.
 *
 * Priority order:
 * 1. Pro subscriber viewing Community -> 'included' (Community card only)
 * 2. Paused subscription -> 'paused'
 * 3. Current active plan -> 'current'
 * 4. Trial ending soon -> 'trial-ending'
 * 5. Active trial -> 'trial-active'
 * 6. Canceled subscription -> 'canceling'
 * 7. Past due subscription -> 'past-due'
 * 8. Default -> 'trial' (Community) or 'popular' (Pro)
 *
 * @param context - Subscription context from service
 * @param planTier - The tier of the plan card ('community' | 'pro')
 * @param isCurrentPlan - Whether this is the user's current active plan
 * @param isTrialPlan - Whether this is the user's trial plan
 * @returns The appropriate badge variant
 */
export function computeBadgeVariant(
  context: PlanSubscriptionContext | null,
  planTier: 'community' | 'pro',
  isCurrentPlan: boolean,
  isTrialPlan: boolean,
): PlanBadgeVariant {
  // No context = unauthenticated user
  if (!context) {
    return planTier === 'community' ? 'trial' : 'popular';
  }

  // Pro subscriber viewing Community card - show "included" badge
  if (
    planTier === 'community' &&
    context.currentPlanTier === 'pro' &&
    !context.isOnTrial
  ) {
    return 'included';
  }

  // Paused subscription for this plan tier
  if (
    context.subscriptionStatus === 'paused' &&
    context.currentPlanTier === planTier
  ) {
    return 'paused';
  }

  // Active subscription (not trial)
  if (isCurrentPlan) {
    return 'current';
  }

  // Trial user for this plan
  if (isTrialPlan) {
    const days = context.trialDaysRemaining ?? 0;
    // Handle zero or negative trial days as "trial-ending"
    if (days <= 0) {
      return 'trial-ending';
    }
    return days <= TRIAL_WARNING_THRESHOLD_DAYS
      ? 'trial-ending'
      : 'trial-active';
  }

  // Canceled subscription (still in grace period)
  if (
    context.subscriptionStatus === 'canceled' &&
    context.currentPlanTier === planTier
  ) {
    return 'canceling';
  }

  // Past due subscription
  if (
    context.subscriptionStatus === 'past_due' &&
    context.currentPlanTier === planTier
  ) {
    return 'past-due';
  }

  // Default for non-authenticated or no subscription
  return planTier === 'community' ? 'trial' : 'popular';
}

/**
 * Compute the CTA variant for a plan card based on subscription context.
 *
 * Determines button action and appearance:
 * - 'start-trial': Opens checkout for new users
 * - 'current-plan': Opens subscription management portal
 * - 'upgrade': Opens checkout for Community subscribers viewing Pro
 * - 'upgrade-now': Opens checkout for trial conversion
 * - 'reactivate': Opens portal for canceled subscriptions
 * - 'update-payment': Opens portal for past due subscriptions
 * - 'resume': Opens portal for paused subscriptions
 * - 'included': Disabled state for Pro subscribers viewing Community
 *
 * @param context - Subscription context from service
 * @param planTier - The tier of the plan card ('community' | 'pro')
 * @returns The appropriate CTA variant
 */
export function computeCtaVariant(
  context: PlanSubscriptionContext | null,
  planTier: 'community' | 'pro',
): PlanCtaVariant {
  // Not authenticated or no context -> start trial
  if (!context?.isAuthenticated) return 'start-trial';
  if (!context.currentPlanTier) return 'start-trial';

  // User has this plan tier
  if (context.currentPlanTier === planTier) {
    // Paused -> offer resume
    if (context.subscriptionStatus === 'paused') return 'resume';
    // Trial user -> encourage upgrade
    if (context.isOnTrial) return 'upgrade-now';
    // Canceled -> offer reactivation
    if (context.subscriptionStatus === 'canceled') return 'reactivate';
    // Past due -> prompt payment update
    if (context.subscriptionStatus === 'past_due') return 'update-payment';
    // Active subscription -> manage
    return 'current-plan';
  }

  // Different plan tier logic
  if (planTier === 'community') {
    // User has Pro subscription - Community is included
    if (context.currentPlanTier === 'pro') {
      return 'included';
    }
  } else if (planTier === 'pro') {
    // User has Community plan - show upgrade option
    if (context.currentPlanTier === 'community') {
      return 'upgrade';
    }
  }

  return 'start-trial';
}

/**
 * Get the CTA button text based on variant.
 *
 * @param variant - The CTA variant
 * @returns Human-readable button text
 */
export function computeCtaText(variant: PlanCtaVariant): string {
  switch (variant) {
    case 'start-trial':
      return 'Start 100-Day Free Trial';
    case 'current-plan':
      return 'Manage Subscription';
    case 'upgrade':
      return 'Upgrade to Pro';
    case 'upgrade-now':
      return 'Upgrade Now';
    case 'reactivate':
      return 'Reactivate';
    case 'update-payment':
      return 'Update Payment';
    case 'resume':
      return 'Resume Subscription';
    case 'included':
      return 'Included in Pro';
    case 'downgrade':
      return 'Downgrade';
    default:
      return 'Start 100-Day Free Trial';
  }
}

/**
 * Get the CTA button CSS classes based on variant and disabled state.
 *
 * @param variant - The CTA variant
 * @param isDisabled - Whether the button is disabled
 * @param planTier - The tier of the plan card for styling differences
 * @returns Tailwind CSS classes for the button
 */
export function computeCtaButtonClass(
  variant: PlanCtaVariant,
  isDisabled: boolean,
  planTier: 'community' | 'pro',
): string {
  // Base disabled state (not for 'included' which has its own style)
  if (isDisabled && variant !== 'included') {
    return planTier === 'community'
      ? 'bg-base-content/10 text-base-content/40 cursor-not-allowed opacity-50'
      : 'bg-amber-500/50 text-base-100/60 cursor-not-allowed opacity-50';
  }

  switch (variant) {
    case 'current-plan':
      return 'bg-success/20 text-success border border-success/30 hover:bg-success/30 cursor-pointer';
    case 'reactivate':
    case 'resume':
      return 'bg-warning/20 text-warning border border-warning/30 hover:bg-warning/30 cursor-pointer';
    case 'update-payment':
      return 'bg-error/20 text-error border border-error/30 hover:bg-error/30 cursor-pointer';
    case 'included':
      return 'bg-base-300/50 text-base-content/40 cursor-not-allowed';
    case 'upgrade-now':
      if (planTier === 'community') {
        return 'bg-sky-500 text-base-100 hover:bg-sky-600 shadow-md shadow-sky-500/25 cursor-pointer';
      }
      return 'bg-gradient-to-r from-amber-500 to-secondary text-base-100 shadow-lg shadow-amber-500/25 hover:shadow-amber-500/40 cursor-pointer';
    case 'upgrade':
    case 'start-trial':
    default:
      if (planTier === 'community') {
        return 'bg-base-content/10 text-base-content hover:bg-base-content/20 cursor-pointer';
      }
      return 'bg-gradient-to-r from-amber-500 to-secondary text-base-100 shadow-lg shadow-amber-500/25 hover:shadow-amber-500/40 cursor-pointer';
  }
}

/**
 * Get formatted trial days text for badge display.
 * Handles edge cases like zero or negative days.
 *
 * @param days - Number of trial days remaining (can be null, 0, or negative)
 * @returns Formatted string for display, or null if not applicable
 */
export function formatTrialDaysText(days: number | null): string | null {
  if (days === null) return null;

  if (days <= 0) {
    return 'Trial expiring today';
  }

  if (days === 1) {
    return '1 day left';
  }

  return `${days} days left`;
}

/**
 * Check if CTA variant requires portal action (vs checkout).
 *
 * @param variant - The CTA variant
 * @returns True if this variant opens the subscription portal
 */
export function isPortalAction(variant: PlanCtaVariant): boolean {
  return ['current-plan', 'reactivate', 'update-payment', 'resume'].includes(
    variant,
  );
}

/**
 * Check if CTA should be disabled based on variant.
 * Note: This only checks variant-based disable logic, not loading states.
 *
 * @param variant - The CTA variant
 * @returns True if this variant should always be disabled
 */
export function isVariantDisabled(variant: PlanCtaVariant): boolean {
  return variant === 'included';
}
