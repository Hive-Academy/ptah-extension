/**
 * Time Formatting Utilities
 *
 * **Purpose**: Shared time/duration formatting functions for consistent display across UI components.
 *
 * **Design Decisions**:
 * - Pure functions (no side effects)
 * - No dependencies (standalone utility)
 * - Defensive edge case handling
 * - Human-readable output optimized for UI display
 *
 * **Complexity Assessment**:
 * - Level: 1 (Simple utility - pure function, no state)
 * - Patterns: Functional programming
 * - Patterns Rejected: Class-based service (YAGNI - no state needed)
 */

/**
 * Formats a duration in milliseconds into a human-readable string.
 *
 * **Output Format**:
 * - < 60s: "Ns" (e.g., "45s")
 * - 60s - 3599s: "Nm Ns" (e.g., "2m 30s")
 * - >= 3600s: "Nh Nm" (e.g., "1h 5m")
 *
 * **Edge Cases**:
 * - Negative values: Returns "0s"
 * - Zero: Returns "0s"
 * - Very large values: Returns hours + minutes (no day/week breakdown)
 *
 * @param ms - Duration in milliseconds (non-negative)
 * @returns Formatted string optimized for compact UI display
 *
 * @example
 * ```typescript
 * formatDuration(0)       // "0s"
 * formatDuration(45000)   // "45s"
 * formatDuration(125000)  // "2m 5s"
 * formatDuration(3661000) // "1h 1m"
 * formatDuration(-1000)   // "0s" (negative guard)
 * ```
 */
export function formatDuration(ms: number): string {
  // Guard against negative values
  if (ms < 0) {
    return '0s';
  }

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  // 3600+ seconds: "Nh Nm"
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }

  // 60-3599 seconds: "Nm Ns"
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }

  // 0-59 seconds: "Ns"
  return `${seconds}s`;
}
