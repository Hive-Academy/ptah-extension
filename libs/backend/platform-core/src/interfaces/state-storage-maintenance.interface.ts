/**
 * Generic declarative maintenance operations for large state stores.
 *
 * Plans describe JSON structure only. Domain libraries own concrete recipes;
 * adapters execute them without importing or naming the domain.
 */

import type { IStateStorage } from './state-storage.interface';

export type StateStorageJsonPathSegment = string | number;
export type StateStorageJsonPath = readonly StateStorageJsonPathSegment[];

export interface StateStorageFieldProjection {
  readonly sourcePath: StateStorageJsonPath;
  /** Top-level name in the projected object; defaults to the final path key. */
  readonly targetField?: string;
}

export type StateStorageExtractionConflictPolicy =
  | { readonly kind: 'replace' }
  | {
      /** Keep the longest array for each listed projected field. */
      readonly kind: 'prefer-longer-arrays';
      readonly fields: readonly string[];
    };

export interface StateStorageNestedExtractionPlan {
  readonly sourceArrayPath: StateStorageJsonPath;
  readonly itemIdPath: StateStorageJsonPath;
  readonly destinationKeyPrefix: string;
  readonly fields: readonly StateStorageFieldProjection[];
  /**
   * Store projected arrays as a single tagged JSON sequence. This keeps large
   * append-only collections page-readable without teaching the platform layer
   * what the tags mean.
   */
  readonly destinationFormat?: {
    readonly kind: 'tagged-sequence';
    readonly fields: readonly {
      readonly sourcePath: StateStorageJsonPath;
      readonly tag: string;
    }[];
  };
  /** Preserve the source object when no usable destination id exists. */
  readonly onMissingId: 'retain-source';
  readonly conflictPolicy: StateStorageExtractionConflictPolicy;
}

export interface StateStorageArraySplitPlan {
  readonly kind: 'split-array-value';
  readonly planVersion: 1;
  readonly sourceKey: string;
  readonly itemIdPath: StateStorageJsonPath;
  readonly detailKeyPrefix: string;
  readonly indexKey: string;
  readonly indexSchemaVersion: number;
  readonly summaryFields: readonly StateStorageFieldProjection[];
  readonly nestedExtractions?: readonly StateStorageNestedExtractionPlan[];
}

export interface StateStorageMigrationReceipt {
  readonly sourceKey: string;
  readonly sourceSha256: string;
  readonly itemCount: number;
  readonly extractedValueCount: number;
  readonly retainedSourceCount: number;
  readonly committedGeneration: number;
  readonly commitId: string;
}

export interface IStateStorageMaintenance extends IStateStorage {
  /**
   * Split one stored JSON array and its nested large fields as a single durable
   * operation. No projected/lean value may become authoritative before every
   * extraction destination has been verified.
   */
  splitArrayValue(
    plan: StateStorageArraySplitPlan,
  ): Promise<StateStorageMigrationReceipt>;
}

export function hasStateStorageMaintenance(
  storage: IStateStorage,
): storage is IStateStorageMaintenance {
  return (
    typeof (storage as Partial<IStateStorageMaintenance>).splitArrayValue ===
    'function'
  );
}
