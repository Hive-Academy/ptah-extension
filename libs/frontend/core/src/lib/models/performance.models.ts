/**
 * Performance Monitoring Models
 * Type definitions for performance metrics and benchmarking
 *
 * Angular 20+ Patterns:
 * - Readonly properties for immutability
 * - Type-safe metric interfaces
 * - Comprehensive performance tracking
 */

/**
 * Performance Metrics Interface
 * Tracks key frontend performance indicators
 */
export interface PerformanceMetrics {
  /** Number of change detection cycles executed */
  readonly changeDetectionCycles: number;

  /** Average render time in milliseconds */
  readonly renderTime: number;

  /** Bundle size in kilobytes */
  readonly bundleSize: number;

  /** Timestamp of when metrics were captured */
  readonly lastUpdated: Date;

  /** Memory usage in megabytes (if available) */
  readonly memoryUsage?: number;

  /** Number of components rendered */
  readonly componentCount?: number;

  /** First contentful paint time in milliseconds */
  readonly firstContentfulPaint?: number;

  /** Time to interactive in milliseconds */
  readonly timeToInteractive?: number;
}

/**
 * Performance Benchmark Interface
 * Compares baseline metrics with current metrics
 */
export interface PerformanceBenchmark {
  /** Baseline metrics before modernization */
  readonly baseline: PerformanceMetrics;

  /** Current metrics after modernization */
  readonly current: PerformanceMetrics;

  /** Percentage improvement for each metric */
  readonly improvement: {
    readonly changeDetectionCycles: number;
    readonly renderTime: number;
    readonly bundleSize: number;
    readonly memoryUsage?: number;
    readonly firstContentfulPaint?: number;
    readonly timeToInteractive?: number;
  };

  /** Overall performance score (0-100) */
  readonly score: number;

  /** Whether modernization goals were met */
  readonly goalsAchieved: {
    readonly changeDetection: boolean; // Target: 30% improvement
    readonly rendering: boolean; // Target: 40% improvement
    readonly bundleSize: boolean; // Target: 50% improvement
  };
}

/**
 * Performance Measurement Options
 */
export interface PerformanceMeasurementOptions {
  /** Whether to include memory usage measurements */
  readonly includeMemory?: boolean;

  /** Whether to include paint timing measurements */
  readonly includePaintTimings?: boolean;

  /** Measurement duration in milliseconds */
  readonly measurementDuration?: number;

  /** Whether to auto-refresh measurements */
  readonly autoRefresh?: boolean;

  /** Auto-refresh interval in milliseconds */
  readonly refreshInterval?: number;
}

/**
 * Performance Alert
 * Notifies when performance thresholds are exceeded
 */
export interface PerformanceAlert {
  /** Alert severity level */
  readonly severity: 'info' | 'warning' | 'critical';

  /** Metric that triggered the alert */
  readonly metric: keyof PerformanceMetrics;

  /** Current value that exceeded threshold */
  readonly currentValue: number;

  /** Threshold value that was exceeded */
  readonly threshold: number;

  /** Alert message */
  readonly message: string;

  /** Timestamp when alert was triggered */
  readonly timestamp: Date;

  /** Suggested action to resolve alert */
  readonly suggestedAction?: string;
}
