import { createHash } from 'node:crypto';
import type { BigIntStats } from 'node:fs';
import * as fs from 'node:fs/promises';
import {
  StateStorageRecoveryRequiredError,
  type StateStorageArraySplitPlan,
  type StateStorageNestedExtractionPlan,
} from '@ptah-extension/platform-core';
import {
  extractReference,
  getAtPath,
  isJsonObject,
  project,
  sha256Json,
  usableId,
  type ElectronStateSplitCounts,
  type MutableSplitCounters,
} from './electron-state-storage-array-split';
import {
  ElectronStateCommitError,
  type ElectronStateCommitStore,
  type ElectronStateInitialSink,
} from './electron-state-storage-commit-store';
import {
  ElectronStateLegacyFormatError,
  readLegacySpan,
  scanLegacyObject,
} from './electron-state-storage-legacy-scanner';
import type { ElectronStateManifest } from './electron-state-storage-manifest';
import {
  electronStateJsonValueSchema,
  type JsonValue,
} from './electron-state-storage-worker-protocol';

export interface ElectronStateLegacySplitOutcome {
  readonly manifest: ElectronStateManifest;
  readonly counts: ElectronStateSplitCounts[];
}

interface ValueSpan {
  readonly start: number;
  readonly end: number;
  readonly digest: Buffer;
}

interface ParsedSpan {
  readonly span: ValueSpan;
  readonly value: JsonValue;
}

const EMPTY_LEGACY_SHA256 = createHash('sha256').update('{}').digest('hex');

function migrationFailed(): StateStorageRecoveryRequiredError {
  return new StateStorageRecoveryRequiredError('migration-failed');
}

async function underSplitRules<T>(compute: () => T | Promise<T>): Promise<T> {
  try {
    return await compute();
  } catch (error: unknown) {
    if (error instanceof StateStorageRecoveryRequiredError) throw error;
    throw migrationFailed();
  }
}

function parseSpanBytes(bytes: Buffer): JsonValue {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw migrationFailed();
  }
  const result = electronStateJsonValueSchema.safeParse(parsed);
  if (!result.success) throw migrationFailed();
  return result.data;
}

async function readIndexedSpan(
  handle: fs.FileHandle,
  start: number,
  end: number,
): Promise<ParsedSpan> {
  const bytes = await readLegacySpan(handle, start, end);
  const digest = createHash('sha256').update(bytes).digest();
  return { span: { start, end, digest }, value: parseSpanBytes(bytes) };
}

async function rereadSpan(
  handle: fs.FileHandle,
  span: ValueSpan,
): Promise<JsonValue> {
  const bytes = await readLegacySpan(handle, span.start, span.end);
  if (!createHash('sha256').update(bytes).digest().equals(span.digest)) {
    throw migrationFailed();
  }
  return parseSpanBytes(bytes);
}

function destinationKeyOf(
  extraction: StateStorageNestedExtractionPlan,
  reference: unknown,
): string | null {
  const id = usableId(getAtPath(reference, extraction.itemIdPath));
  return id === null ? null : `${extraction.destinationKeyPrefix}${id}`;
}

function* nestedReferences(
  plan: StateStorageArraySplitPlan,
  item: JsonValue,
): Generator<[StateStorageNestedExtractionPlan, JsonValue]> {
  for (const extraction of plan.nestedExtractions ?? []) {
    const nested = getAtPath(item, extraction.sourceArrayPath);
    if (!Array.isArray(nested)) continue;
    for (const reference of nested as JsonValue[]) {
      yield [extraction, reference];
    }
  }
}

class LegacyPlanIndex {
  source: 'absent' | 'index-shaped' | 'array' = 'absent';
  readonly counters: MutableSplitCounters = {
    extractedValueCount: 0,
    droppedStdoutCount: 0,
    stdoutFallbackCount: 0,
    droppedBulkWithoutIdCount: 0,
    skippedItemCount: 0,
  };
  readonly itemSpans: ValueSpan[] = [];
  readonly lastItemIndexById = new Map<string, number>();
  readonly lastOccurrence = new Map<string, number>();
  private readonly indexItems: JsonValue[] = [];
  private readonly itemsHash = createHash('sha256');
  private sourceSha256 = sha256Json(null);
  private itemCount = 0;
  private occurrences = 0;

  constructor(readonly plan: StateStorageArraySplitPlan) {}

  addItem(index: number, span: ValueSpan, item: JsonValue): void {
    this.itemsHash.update(index === 0 ? '[' : ',');
    this.itemsHash.update(JSON.stringify(item));
    this.itemSpans.push(span);
    const id = usableId(getAtPath(item, this.plan.itemIdPath));
    if (id === null) {
      this.counters.skippedItemCount++;
      return;
    }
    this.lastItemIndexById.set(id, index);
    this.indexItems.push(project(item, this.plan.summaryFields));
    for (const [extraction, reference] of nestedReferences(this.plan, item)) {
      const destinationKey = destinationKeyOf(extraction, reference);
      if (destinationKey !== null) {
        this.lastOccurrence.set(destinationKey, this.occurrences++);
      }
    }
  }

  acceptArray(elementCount: number): void {
    this.itemsHash.update(elementCount === 0 ? '[]' : ']');
    this.source = 'array';
    this.sourceSha256 = this.itemsHash.digest('hex');
    this.itemCount = elementCount;
  }

  acceptValue(value: JsonValue): void {
    if (
      !isJsonObject(value) ||
      value['schemaVersion'] !== this.plan.indexSchemaVersion
    ) {
      throw migrationFailed();
    }
    const items = value['items'];
    this.source = 'index-shaped';
    this.sourceSha256 = sha256Json(value);
    this.itemCount = Array.isArray(items) ? items.length : 0;
  }

  ownsOutput(key: string): boolean {
    if (this.source !== 'array') return false;
    const { detailKeyPrefix, indexKey } = this.plan;
    return (
      key === indexKey ||
      this.lastOccurrence.has(key) ||
      (key.startsWith(detailKeyPrefix) &&
        this.lastItemIndexById.has(key.slice(detailKeyPrefix.length)))
    );
  }

  indexValue(): JsonValue {
    return {
      schemaVersion: this.plan.indexSchemaVersion,
      items: this.indexItems,
    };
  }

  counts(): ElectronStateSplitCounts {
    return {
      sourceKey: this.plan.sourceKey,
      sourceSha256: this.sourceSha256,
      itemCount: this.itemCount,
      ...this.counters,
    };
  }
}

async function emitSplitItems(
  handle: fs.FileHandle,
  index: LegacyPlanIndex,
  spans: ReadonlyMap<string, ValueSpan>,
  sink: ElectronStateInitialSink,
): Promise<void> {
  const { plan } = index;
  const open = new Map<string, JsonValue>();
  let occurrence = 0;
  for (let item = 0; item < index.itemSpans.length; item++) {
    const detail = await rereadSpan(handle, index.itemSpans[item]);
    const id = usableId(getAtPath(detail, plan.itemIdPath));
    if (id === null) continue;
    for (const [extraction, reference] of nestedReferences(plan, detail)) {
      const destinationKey = destinationKeyOf(extraction, reference);
      const legacySpan =
        destinationKey === null ? undefined : spans.get(destinationKey);
      if (destinationKey !== null && legacySpan && !open.has(destinationKey)) {
        open.set(destinationKey, await rereadSpan(handle, legacySpan));
      }
      await underSplitRules(() =>
        extractReference(
          reference,
          extraction,
          open,
          async () => undefined,
          index.counters,
        ),
      );
      if (destinationKey === null) continue;
      if (index.lastOccurrence.get(destinationKey) !== occurrence++) continue;
      const merged = open.get(destinationKey);
      if (merged === undefined) throw migrationFailed();
      open.delete(destinationKey);
      await sink.put(destinationKey, merged);
    }
    if (index.lastItemIndexById.get(id) === item) {
      await sink.put(`${plan.detailKeyPrefix}${id}`, detail);
    }
  }
  if (open.size > 0) throw migrationFailed();
}

function sameFileVersion(left: BigIntStats, right: BigIntStats): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs
  );
}

async function assertLegacyUnchanged(
  handle: fs.FileHandle,
  legacyFilePath: string,
  before: BigIntStats,
): Promise<void> {
  let current: BigIntStats[];
  try {
    current = await Promise.all([
      handle.stat({ bigint: true }),
      fs.stat(legacyFilePath, { bigint: true }),
    ]);
  } catch {
    throw migrationFailed();
  }
  if (!current.every((stats) => sameFileVersion(stats, before))) {
    throw migrationFailed();
  }
}

function assertStreamablePlans(
  migrations: readonly StateStorageArraySplitPlan[],
): void {
  if (migrations.some((plan) => plan.sourceKey !== plan.indexKey)) {
    throw migrationFailed();
  }
}

async function splitOpenLegacyFile(
  store: ElectronStateCommitStore,
  handle: fs.FileHandle,
  legacyFilePath: string,
  migrations: readonly StateStorageArraySplitPlan[],
): Promise<ElectronStateLegacySplitOutcome> {
  const before = await handle.stat({ bigint: true });
  const plans = migrations.map((plan) => new LegacyPlanIndex(plan));
  const bySource = new Map(plans.map((entry) => [entry.plan.sourceKey, entry]));
  const spans = new Map<string, ValueSpan>();
  const scan = await scanLegacyObject(
    handle,
    { splitKeys: new Set(bySource.keys()) },
    {
      onElement: async (key, index, start, end) => {
        const { span, value } = await readIndexedSpan(handle, start, end);
        const plan = bySource.get(key);
        if (!plan) throw migrationFailed();
        await underSplitRules(() => plan.addItem(index, span, value));
      },
      onEntry: async (key, start, end, elementCount) => {
        const plan = bySource.get(key);
        if (plan && elementCount !== null) {
          plan.acceptArray(elementCount);
          return;
        }
        const { span, value } = await readIndexedSpan(handle, start, end);
        spans.set(key, span);
        if (plan) await underSplitRules(() => plan.acceptValue(value));
      },
    },
  );
  if (BigInt(scan.size) !== before.size) throw migrationFailed();
  const manifest = await store.commitInitialStream(
    scan.sha256,
    async (sink) => {
      for (const plan of plans) {
        if (plan.source === 'array') {
          await emitSplitItems(handle, plan, spans, sink);
        }
      }
      for (const [key, span] of spans) {
        if (plans.some((plan) => plan.ownsOutput(key))) continue;
        await sink.put(key, await rereadSpan(handle, span));
      }
      for (const plan of plans) {
        if (plan.source === 'array') {
          await sink.put(plan.plan.indexKey, plan.indexValue());
        }
      }
      await assertLegacyUnchanged(handle, legacyFilePath, before);
    },
  );
  return { manifest, counts: plans.map((plan) => plan.counts()) };
}

async function openLegacyFile(
  legacyFilePath: string,
): Promise<fs.FileHandle | null> {
  try {
    return await fs.open(legacyFilePath, 'r');
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function commitEmptyLegacy(
  store: ElectronStateCommitStore,
  migrations: readonly StateStorageArraySplitPlan[],
): Promise<ElectronStateLegacySplitOutcome> {
  const manifest = await store.commitInitialStream(
    EMPTY_LEGACY_SHA256,
    async () => undefined,
  );
  return {
    manifest,
    counts: migrations.map((plan) => new LegacyPlanIndex(plan).counts()),
  };
}

function legacySplitFailure(error: unknown): unknown {
  const cause =
    error instanceof ElectronStateCommitError &&
    error.phase === 'pre-publication'
      ? error.failure
      : error;
  if (cause instanceof ElectronStateLegacyFormatError) return migrationFailed();
  if (cause instanceof StateStorageRecoveryRequiredError) return cause;
  return error;
}

export async function commitLegacyStateSplit(
  store: ElectronStateCommitStore,
  legacyFilePath: string,
  migrations: readonly StateStorageArraySplitPlan[],
): Promise<ElectronStateLegacySplitOutcome> {
  let handle: fs.FileHandle | null = null;
  try {
    assertStreamablePlans(migrations);
    handle = await openLegacyFile(legacyFilePath);
    if (!handle) return await commitEmptyLegacy(store, migrations);
    return await splitOpenLegacyFile(store, handle, legacyFilePath, migrations);
  } catch (error: unknown) {
    throw legacySplitFailure(error);
  } finally {
    // degradation-audit: optional-capability - the file was opened read-only
    // and every outcome is already decided; a failed close cannot change the
    // committed generation or the error being reported.
    await handle?.close().catch(() => undefined);
  }
}
