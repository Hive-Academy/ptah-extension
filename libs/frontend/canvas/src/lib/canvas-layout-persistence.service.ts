import { DestroyRef, Injectable, inject } from '@angular/core';
import { z } from 'zod';
import { VSCodeService } from '@ptah-extension/core';
import {
  MAX_CANVAS_TILES,
  TILE_SPANS,
  logicalRows,
  type TileIntent,
} from './canvas-layout-intent';

/** Delay that coalesces a burst of intent mutations into one storage write. */
export const CANVAS_LAYOUT_SAVE_DEBOUNCE_MS = 250;

const LATEST_VERSION = 2;

const tabIdSchema = z.string().min(1);
const orderSchema = z.number().int().nonnegative();
const weightSchema = z.number().gt(0).lte(12);

const uniqueIds = (tiles: readonly { tabId: string }[]): boolean =>
  new Set(tiles.map((tile) => tile.tabId)).size === tiles.length;

const widthSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('span'), span: z.enum(TILE_SPANS) }),
  z.strictObject({ kind: z.literal('auto'), weight: weightSchema }),
]);

const v2Schema = z.strictObject({
  version: z.literal(2),
  tiles: z
    .array(
      z.strictObject({
        tabId: tabIdSchema,
        order: orderSchema,
        width: widthSchema,
        rowBreakBefore: z.boolean(),
      }),
    )
    .max(MAX_CANVAS_TILES)
    .refine(uniqueIds, 'duplicate tab ids'),
});

const v1Schema = z.strictObject({
  version: z.literal(1),
  columnsPreference: z.union([
    z.literal('auto'),
    z.literal(1),
    z.literal(2),
    z.literal(3),
  ]),
  tiles: z
    .array(
      z.strictObject({
        tabId: tabIdSchema,
        order: orderSchema,
        weight: weightSchema,
        rowBreakBefore: z.boolean(),
      }),
    )
    .max(MAX_CANVAS_TILES)
    .refine(uniqueIds, 'duplicate tab ids'),
});

export type CanvasWorkspaceIntentV1 = z.infer<typeof v1Schema>;
export type CanvasWorkspaceIntentV2 = z.infer<typeof v2Schema>;

export interface CanvasLayoutLoadResult {
  /** Validated, migrated intent; `null` when nothing usable is stored. */
  readonly tiles: readonly TileIntent[] | null;
  /** False when writing could destroy a record this client cannot read. */
  readonly writable: boolean;
  /** True when a validated legacy record should be rewritten as v2. */
  readonly needsWrite: boolean;
}

type WarningKind = 'read' | 'parse' | 'write' | 'remove';

/** Dense order with the first tile never carrying a row break. */
function normalize(tiles: readonly TileIntent[]): readonly TileIntent[] {
  return logicalRows(tiles)
    .flat()
    .map((tile, order) => ({
      ...tile,
      order,
      rowBreakBefore: order > 0 && tile.rowBreakBefore,
    }));
}

/**
 * Lossless v1 -> v2 migration. The removed Auto/1/2/3 cap becomes durable row
 * breaks at the widest supported width (Auto -> 3 per row), and every weight
 * survives unrounded inside an `auto` width.
 */
export function migrateCanvasIntentV1(
  record: CanvasWorkspaceIntentV1,
): readonly TileIntent[] {
  const maximum =
    record.columnsPreference === 'auto' ? 3 : record.columnsPreference;
  const weighted: TileIntent[] = record.tiles.map((tile) => ({
    tabId: tile.tabId,
    order: tile.order,
    width: { kind: 'auto', weight: tile.weight },
    rowBreakBefore: tile.rowBreakBefore,
  }));
  return normalize(
    logicalRows(weighted).flatMap((row) =>
      row.map((tile, index) => ({
        ...tile,
        rowBreakBefore: index % maximum === 0,
      })),
    ),
  );
}

/**
 * CanvasLayoutPersistenceService — the storage boundary for canvas intent.
 *
 * Scoped with `CanvasStore` on `OrchestraCanvasComponent`. localStorage is
 * mutable external input, so every record is parsed as `unknown` and validated
 * with Zod before it becomes intent. Writes are enabled per workspace only
 * after hydration, debounced, and flushed on page hide/unload and destroy.
 * Storage failures warn and leave in-memory state authoritative.
 */
@Injectable()
export class CanvasLayoutPersistenceService {
  private readonly vscode = inject(VSCodeService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly writable = new Set<string>();
  private readonly pending = new Map<string, () => readonly TileIntent[]>();
  private readonly lastWritten = new Map<string, string>();
  private readonly warned = new Set<WarningKind>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    const flush = (): void => this.flush();
    const flushWhenHidden = (): void => {
      if (document.visibilityState === 'hidden') this.flush();
    };
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', flushWhenHidden);
    this.destroyRef.onDestroy(() => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', flushWhenHidden);
      this.flush();
    });
  }

  /** `ptah.canvas-layout.ws.{encodedPath}.{panelId|primary}` */
  storageKey(workspacePath: string): string {
    const encoded = encodeURIComponent(workspacePath).replace(/%/g, '_');
    const panel = this.vscode.config().panelId || 'primary';
    return `ptah.canvas-layout.ws.${encoded}.${panel}`;
  }

  /** Read, validate and migrate one workspace record. Never writes. */
  load(workspacePath: string): CanvasLayoutLoadResult {
    if (workspacePath === '') {
      return { tiles: null, writable: false, needsWrite: false };
    }
    let raw: string | null;
    try {
      raw = localStorage.getItem(this.storageKey(workspacePath));
    } catch (error: unknown) {
      this.warn('read', error);
      return { tiles: null, writable: false, needsWrite: false };
    }
    if (raw === null) return { tiles: null, writable: true, needsWrite: false };

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error: unknown) {
      this.warn('parse', error);
      return { tiles: null, writable: true, needsWrite: false };
    }

    const version =
      typeof parsed === 'object' && parsed !== null && 'version' in parsed
        ? parsed.version
        : undefined;
    if (
      typeof version === 'number' &&
      version > LATEST_VERSION
    ) {
      // A newer client owns this record: render defaults, keep the bytes.
      return { tiles: null, writable: false, needsWrite: false };
    }

    const v2 = v2Schema.safeParse(parsed);
    if (v2.success) {
      this.lastWritten.set(workspacePath, raw);
      return {
        tiles: normalize(v2.data.tiles),
        writable: true,
        needsWrite: false,
      };
    }
    const v1 = v1Schema.safeParse(parsed);
    if (v1.success) {
      return {
        tiles: migrateCanvasIntentV1(v1.data),
        writable: true,
        needsWrite: true,
      };
    }
    this.warn('parse', v2.error);
    return { tiles: null, writable: true, needsWrite: false };
  }

  /** Hydration finished for this workspace; enable writes when allowed. */
  markHydrated(workspacePath: string, writable: boolean): void {
    if (workspacePath === '' || !writable) {
      this.writable.delete(workspacePath);
      return;
    }
    this.writable.add(workspacePath);
  }

  isWritable(workspacePath: string): boolean {
    return this.writable.has(workspacePath);
  }

  /**
   * Schedule a debounced write. The snapshot is read at flush time, so a burst
   * of mutations writes the latest intent exactly once.
   */
  schedule(
    workspacePath: string,
    snapshot: () => readonly TileIntent[],
  ): void {
    if (!this.writable.has(workspacePath)) return;
    this.pending.set(workspacePath, snapshot);
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), CANVAS_LAYOUT_SAVE_DEBOUNCE_MS);
  }

  /** Write every pending workspace synchronously. */
  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const pending = [...this.pending];
    this.pending.clear();
    for (const [workspacePath, snapshot] of pending) {
      this.write(workspacePath, snapshot());
    }
  }

  /** Forget an acknowledged removed workspace, including its stored record. */
  remove(workspacePath: string): void {
    this.pending.delete(workspacePath);
    this.writable.delete(workspacePath);
    this.lastWritten.delete(workspacePath);
    if (workspacePath === '') return;
    try {
      localStorage.removeItem(this.storageKey(workspacePath));
    } catch (error: unknown) {
      this.warn('remove', error);
    }
  }

  private write(workspacePath: string, tiles: readonly TileIntent[]): void {
    if (!this.writable.has(workspacePath)) return;
    const record: CanvasWorkspaceIntentV2 = {
      version: 2,
      tiles: tiles.map((tile) => ({
        tabId: tile.tabId,
        order: tile.order,
        width:
          tile.width.kind === 'span'
            ? { kind: 'span', span: tile.width.span }
            : { kind: 'auto', weight: tile.width.weight },
        rowBreakBefore: tile.rowBreakBefore,
      })),
    };
    const serialized = JSON.stringify(record);
    if (this.lastWritten.get(workspacePath) === serialized) return;
    try {
      localStorage.setItem(this.storageKey(workspacePath), serialized);
      this.lastWritten.set(workspacePath, serialized);
    } catch (error: unknown) {
      this.warn('write', error);
    }
  }

  /** One warning per failure kind per panel, so a full quota cannot spam. */
  private warn(kind: WarningKind, error: unknown): void {
    if (this.warned.has(kind)) return;
    this.warned.add(kind);
    const detail = error instanceof Error ? error.message : String(error);
    console.warn(`[CanvasLayoutPersistence] ${kind} failed: ${detail}`);
  }
}
