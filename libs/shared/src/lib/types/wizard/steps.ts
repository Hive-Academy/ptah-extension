/**
 * Setup Wizard saved analysis metadata (persistent analysis history).
 */

// ============================================================================
// Saved Analysis Types (Persistent Analysis History)
// ============================================================================

/**
 * Metadata for a saved analysis (lightweight, for listing).
 * v2-only: represents multi-phase analysis slug directories.
 */
export interface SavedAnalysisMetadata {
  /** Slug directory name in .ptah/analysis/ */
  filename: string;
  /** ISO 8601 timestamp of when the analysis was saved */
  savedAt: string;
  /** Human-readable project type description (from slug) */
  projectType: string;
  /** Number of completed phases */
  phaseCount: number;
  /** Model used for analysis */
  model: string;
  /** Total analysis duration in milliseconds */
  durationMs: number;
}
