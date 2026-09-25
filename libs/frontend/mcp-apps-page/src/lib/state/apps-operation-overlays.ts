import type { SurfaceInteractionState } from '@ptah-extension/declarative-dashboard';
import type { SurfaceDataValue } from '@ptah-extension/shared/mcp-apps-contracts/surface';

/**
 * Rule 4 overlay ledger (implementation-plan.md:574-582).
 *
 * One instance holds the pending value overlays of ONE surface. Overlays are
 * keyed by operation id in send order. The value an input displays is its
 * latest unretired overlay per path (several inputs may share a path); the
 * renderer falls back to `readSurfacePath(dataModel, path, kind)` behind it.
 *
 * Every operation returns a NEW instance and never throws, so a discarded
 * structure keeps witnessing the state it was read at. No timers, no Angular
 * DI: `AppsSurfaceOperations` (Batch 13) drives retirement from results,
 * echoes and reads.
 */

/** The pending-value view consumed by `SurfaceInteractionState.pendingValues`. */
export type SurfacePendingValues = SurfaceInteractionState['pendingValues'];

/** One optimistic value: what a path shows until its operation retires. */
export interface SurfaceValueOverlay {
  /** The operation id the value was sent under; one per user attempt. */
  readonly operationId: string;
  /** The data-model path the value overlays. */
  readonly path: string;
  /** The optimistic value. */
  readonly value: SurfaceDataValue;
  /** The materialized revision the operation was based on. */
  readonly baseRevision: number;
  /** The ack revision once the operation settled; `null` while pending. */
  readonly settledRevision: number | null;
}

/** An overlay as sent: before any result names its ack revision. */
export type SurfaceValueOverlayInput = Omit<
  SurfaceValueOverlay,
  'settledRevision'
>;

function isOverlayInput(value: unknown): value is SurfaceValueOverlayInput {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['operationId'] === 'string' &&
    candidate['operationId'].length > 0 &&
    typeof candidate['path'] === 'string' &&
    candidate['path'].length > 0 &&
    typeof candidate['baseRevision'] === 'number' &&
    Number.isFinite(candidate['baseRevision']) &&
    candidate['value'] !== undefined
  );
}

export class AppsOperationOverlays {
  private readonly entries: ReadonlyMap<string, SurfaceValueOverlay>;

  private constructor(entries: ReadonlyMap<string, SurfaceValueOverlay>) {
    this.entries = entries;
  }

  /** The empty structure; one instance lives per surface. */
  public static empty(): AppsOperationOverlays {
    return new AppsOperationOverlays(new Map());
  }

  /** Number of unretired overlays. */
  public get size(): number {
    return this.entries.size;
  }

  /** All unretired overlays in send order. */
  public list(): readonly SurfaceValueOverlay[] {
    return [...this.entries.values()];
  }

  public has(operationId: string): boolean {
    return this.entries.has(operationId);
  }

  public get(operationId: string): SurfaceValueOverlay | undefined {
    return this.entries.get(operationId);
  }

  /**
   * Adds one pending overlay in send order. A duplicate operation id or an
   * invalid overlay changes nothing; the call never throws.
   */
  public add(overlay: SurfaceValueOverlayInput): AppsOperationOverlays {
    if (!isOverlayInput(overlay) || this.entries.has(overlay.operationId)) {
      return this;
    }
    const entries = new Map(this.entries);
    entries.set(overlay.operationId, { ...overlay, settledRevision: null });
    return new AppsOperationOverlays(entries);
  }

  /**
   * Records the ack revision of a settled operation. The overlay stays
   * displayed until the echo or a read reaches that revision. An operation
   * settles once: a second settle, an unknown id or a non-finite revision
   * changes nothing.
   */
  public settle(
    operationId: string,
    ackRevision: number,
  ): AppsOperationOverlays {
    const existing = this.entries.get(operationId);
    if (
      existing === undefined ||
      existing.settledRevision !== null ||
      !Number.isFinite(ackRevision)
    ) {
      return this;
    }
    const entries = new Map(this.entries);
    entries.set(operationId, { ...existing, settledRevision: ackRevision });
    return new AppsOperationOverlays(entries);
  }

  /**
   * Removes exactly the overlay for `operationId`. A newer overlay for the
   * same path keeps its own.
   */
  public retire(operationId: string): AppsOperationOverlays {
    if (!this.entries.has(operationId)) {
      return this;
    }
    const entries = new Map(this.entries);
    entries.delete(operationId);
    return new AppsOperationOverlays(entries);
  }

  /**
   * Retires every settled overlay whose ack revision is at or below
   * `revision` — the materialized state already holds the value.
   */
  public retireSettledUpTo(revision: number): AppsOperationOverlays {
    if (!Number.isFinite(revision)) {
      return this;
    }
    return this.retainWhere(
      (overlay) =>
        overlay.settledRevision === null || overlay.settledRevision > revision,
    );
  }

  /** A read retires every settled overlay of the surface; pending ones stay. */
  public retireAllSettled(): AppsOperationOverlays {
    return this.retainWhere((overlay) => overlay.settledRevision === null);
  }

  /**
   * The value every path currently shows: the latest unretired overlay per
   * path, in send order. Feeds `SurfaceInteractionState.pendingValues`
   * unchanged.
   */
  public pendingValues(): SurfacePendingValues {
    const values = new Map<string, SurfaceDataValue>();
    this.entries.forEach((overlay) => {
      values.set(overlay.path, overlay.value);
    });
    return values;
  }

  private retainWhere(
    keep: (overlay: SurfaceValueOverlay) => boolean,
  ): AppsOperationOverlays {
    let changed = false;
    const entries = new Map<string, SurfaceValueOverlay>();
    this.entries.forEach((overlay, operationId) => {
      if (keep(overlay)) {
        entries.set(operationId, overlay);
      } else {
        changed = true;
      }
    });
    return changed ? new AppsOperationOverlays(entries) : this;
  }
}