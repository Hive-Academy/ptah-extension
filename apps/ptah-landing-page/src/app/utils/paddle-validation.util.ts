/**
 * Paddle Validation Utilities
 *
 * Shared validation functions for Paddle price IDs and configuration.
 * Extracted from duplicate logic in pricing-grid.component.ts and plan-card.component.ts
 *
 * Evidence: TASK_2025_116 - Issue 6 (Duplicate Placeholder Validation)
 */

/**
 * Check if a price ID is a placeholder that needs replacement
 *
 * Placeholder patterns to detect:
 * - 'REPLACE' - Common placeholder prefix
 * - 'xxxxxxxxx' - Temporary price ID marker
 * - 'yyyyyyyyy' - Temporary price ID marker
 * - 'REPLACE_ME' - Explicit placeholder flag
 * - undefined/null - Missing configuration
 *
 * @param priceId - Paddle price ID to validate
 * @returns true if priceId is a placeholder or invalid, false if valid
 *
 * @example
 * isPriceIdPlaceholder('pri_01abc123') // false (valid)
 * isPriceIdPlaceholder('REPLACE_WITH_REAL_ID') // true (placeholder)
 * isPriceIdPlaceholder(undefined) // true (missing)
 */
export function isPriceIdPlaceholder(priceId: string | undefined): boolean {
  // Treat missing/empty price IDs as placeholders
  if (!priceId || priceId.trim() === '') {
    return true;
  }

  // Check for known placeholder patterns (case-insensitive)
  const placeholderPatterns = [
    'REPLACE',
    'xxxxxxxxx',
    'yyyyyyyyy',
    'REPLACE_ME',
  ];

  return placeholderPatterns.some((pattern) =>
    priceId.toLowerCase().includes(pattern.toLowerCase())
  );
}
