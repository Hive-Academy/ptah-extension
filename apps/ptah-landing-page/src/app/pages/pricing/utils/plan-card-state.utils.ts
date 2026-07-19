import {
  PlanSubscriptionContext,
  PlanCtaVariant,
} from '../models/pricing-plan.interface';

/**
 * Plan Card State Utilities
 *
 * Shared utility functions for computing the Builders CTA state (variant,
 * text, styling) for the unified Free-vs-Builders capability matrix.
 *
 * - Community: FREE forever, open source
 * - Ptah Builders: premium membership (Paddle checkout, gated behind the
 *   `buildersCheckoutEnabled` launch switch - see environment.ts)
 *
 * Evidence: TASK_2025_127 - QA Review Issue #5 - Code Duplication
 * Evidence: TASK_2025_128 - Freemium Model Conversion
 */

/**
 * Compute the CTA variant for the Builders column based on subscription
 * context. The capability matrix only ever renders one premium column, so
 * this no longer takes a `planTier` parameter.
 *
 * - 'join': No premium access yet (anonymous or Community) - joins the
 *   waitlist or opens checkout depending on the `buildersCheckoutEnabled`
 *   flag.
 * - 'current-plan' / 'reactivate' / 'update-payment' / 'resume': The viewer
 *   already holds an active Builders subscription - always opens the
 *   customer portal, never checkout, regardless of the flag.
 *
 * @param context - Subscription context from service
 * @returns The appropriate CTA variant
 */
export function computeCtaVariant(
  context: PlanSubscriptionContext | null,
): PlanCtaVariant {
  if (!context?.isAuthenticated) return 'join';

  const hasPremium = context.currentPlanTier === 'builders';
  if (!hasPremium) return 'join';

  if (context.subscriptionStatus === 'paused') return 'resume';
  if (context.subscriptionStatus === 'canceled') return 'reactivate';
  if (context.subscriptionStatus === 'past_due') return 'update-payment';
  return 'current-plan';
}

/**
 * Get the CTA button text based on variant.
 *
 * @param variant - The CTA variant
 * @param checkoutEnabled - Whether Builders self-serve checkout is open
 *   (`environment.buildersCheckoutEnabled`)
 * @returns Human-readable button text
 */
export function computeCtaText(
  variant: PlanCtaVariant,
  checkoutEnabled: boolean,
): string {
  switch (variant) {
    case 'current-plan':
      return 'Manage Subscription';
    case 'reactivate':
      return 'Reactivate';
    case 'update-payment':
      return 'Update Payment';
    case 'resume':
      return 'Resume Subscription';
    case 'join':
    default:
      return checkoutEnabled
        ? 'Join Ptah Builders'
        : 'Join the Builders Waitlist';
  }
}

/**
 * Get the CTA button CSS classes based on variant and disabled state.
 *
 * @param variant - The CTA variant
 * @param isDisabled - Whether the button is disabled
 * @returns Tailwind CSS classes for the button
 */
export function computeCtaButtonClass(
  variant: PlanCtaVariant,
  isDisabled: boolean,
): string {
  if (isDisabled) {
    return 'bg-amber-500/50 text-base-100/60 cursor-not-allowed opacity-50';
  }

  switch (variant) {
    case 'current-plan':
      return 'bg-success/20 text-success border border-success/30 hover:bg-success/30 cursor-pointer';
    case 'reactivate':
    case 'resume':
      return 'bg-warning/20 text-warning border border-warning/30 hover:bg-warning/30 cursor-pointer';
    case 'update-payment':
      return 'bg-error/20 text-error border border-error/30 hover:bg-error/30 cursor-pointer';
    case 'join':
    default:
      return 'bg-gradient-to-r from-amber-500 to-secondary text-base-100 shadow-lg shadow-amber-500/25 hover:shadow-amber-500/40 cursor-pointer';
  }
}

/**
 * Check if CTA variant requires portal action (vs checkout/waitlist).
 *
 * @param variant - The CTA variant
 * @returns True if this variant opens the subscription portal
 */
export function isPortalAction(variant: PlanCtaVariant): boolean {
  return ['current-plan', 'reactivate', 'update-payment', 'resume'].includes(
    variant,
  );
}
