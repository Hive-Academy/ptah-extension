import { createHash } from 'node:crypto';
import type {
  StateStorageArraySplitPlan,
  StateStorageFieldProjection,
  StateStorageJsonPath,
  StateStorageMigrationReceipt,
  StateStorageNestedExtractionPlan,
} from '@ptah-extension/platform-core';
import type { JsonValue } from './electron-state-storage-worker-protocol';

export type ElectronStateSplitCounts = Omit<
  StateStorageMigrationReceipt,
  'committedGeneration' | 'commitId'
>;

export interface ElectronStateArraySplitOutcome {
  readonly changes: Map<string, JsonValue>;
  readonly counts: ElectronStateSplitCounts;
}

export type ElectronStateSplitValueReader = (
  key: string,
) => Promise<JsonValue | undefined>;

export interface MutableSplitCounters {
  extractedValueCount: number;
  droppedStdoutCount: number;
  stdoutFallbackCount: number;
  droppedBulkWithoutIdCount: number;
  skippedItemCount: number;
}

type TaggedSequenceFormat = NonNullable<
  StateStorageNestedExtractionPlan['destinationFormat']
>;

export function sha256Json(value: JsonValue): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function isJsonObject(
  value: unknown,
): value is Record<string, JsonValue> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function getAtPath(
  value: unknown,
  jsonPath: StateStorageJsonPath,
): unknown {
  let current = value;
  for (const segment of jsonPath) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string | number, unknown>)[segment];
  }
  return current;
}

function deleteAtPath(value: unknown, jsonPath: StateStorageJsonPath): void {
  if (jsonPath.length === 0) return;
  const parent = getAtPath(value, jsonPath.slice(0, -1));
  const final = jsonPath[jsonPath.length - 1];
  if (parent === null || typeof parent !== 'object') return;
  if (Array.isArray(parent) && typeof final === 'number') {
    parent[final] = undefined as unknown as JsonValue;
  } else {
    delete (parent as Record<string | number, unknown>)[final];
  }
}

function setAtPath(
  root: Record<string, JsonValue>,
  jsonPath: StateStorageJsonPath,
  value: JsonValue,
): void {
  let parent: Record<string | number, JsonValue> = root;
  for (const segment of jsonPath.slice(0, -1)) {
    const next = parent[segment];
    if (next === null || typeof next !== 'object') {
      const created: Record<string, JsonValue> = {};
      parent[segment] = created;
      parent = created;
    } else {
      parent = next as Record<string | number, JsonValue>;
    }
  }
  parent[jsonPath[jsonPath.length - 1]] = value;
}

function projectionName(field: StateStorageFieldProjection): string {
  if (field.targetField) return field.targetField;
  const final = field.sourcePath[field.sourcePath.length - 1];
  if (typeof final !== 'string') {
    throw new Error('A numeric projection path requires targetField');
  }
  return final;
}

export function project(
  source: unknown,
  fields: readonly StateStorageFieldProjection[],
): Record<string, JsonValue> {
  const result: Record<string, JsonValue> = {};
  for (const field of fields) {
    const value = getAtPath(source, field.sourcePath);
    if (value !== undefined) {
      result[projectionName(field)] = structuredClone(value) as JsonValue;
    }
  }
  return result;
}

export function usableId(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const id = String(value).trim();
  return id.length > 0 ? id : null;
}

function taggedItems(
  source: unknown,
  format: TaggedSequenceFormat,
): JsonValue[] {
  const result: JsonValue[] = [];
  for (const field of format.fields) {
    const values = getAtPath(source, field.sourcePath);
    if (!Array.isArray(values)) continue;
    for (const value of values) {
      result.push({
        tag: field.tag,
        value: structuredClone(value) as JsonValue,
      });
    }
  }
  return result;
}

function hasTag(item: JsonValue, tag: string): boolean {
  return isJsonObject(item) && item['tag'] === tag;
}

function mergeTaggedSequence(
  existing: JsonValue | undefined,
  incomingSource: unknown,
  plan: StateStorageNestedExtractionPlan,
  format: TaggedSequenceFormat,
): JsonValue[] {
  const incoming = taggedItems(incomingSource, format);
  if (plan.conflictPolicy.kind === 'replace' || existing === undefined) {
    return incoming;
  }
  const existingItems = Array.isArray(existing)
    ? existing
    : isJsonObject(existing)
      ? taggedItems(existing, format)
      : [];
  const result: JsonValue[] = [];
  for (const field of format.fields) {
    const oldItems = existingItems.filter((item) => hasTag(item, field.tag));
    const newItems = incoming.filter((item) => hasTag(item, field.tag));
    result.push(...(oldItems.length > newItems.length ? oldItems : newItems));
  }
  return result;
}

function mergeExtraction(
  existing: JsonValue | undefined,
  incomingSource: unknown,
  plan: StateStorageNestedExtractionPlan,
): JsonValue {
  if (plan.destinationFormat?.kind === 'tagged-sequence') {
    return mergeTaggedSequence(
      existing,
      incomingSource,
      plan,
      plan.destinationFormat,
    );
  }
  const incoming = project(incomingSource, plan.fields);
  if (plan.conflictPolicy.kind === 'replace' || !isJsonObject(existing)) {
    return incoming;
  }
  const merged = { ...existing, ...incoming };
  for (const field of plan.conflictPolicy.fields) {
    const oldValue = existing[field];
    const newValue = incoming[field];
    if (
      Array.isArray(oldValue) &&
      Array.isArray(newValue) &&
      oldValue.length > newValue.length
    ) {
      merged[field] = oldValue;
    }
  }
  return merged;
}

function isNonEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string' || Array.isArray(value)) {
    return value.length > 0;
  }
  return true;
}

function bulkPaths(
  plan: StateStorageNestedExtractionPlan,
): StateStorageJsonPath[] {
  return [
    ...plan.fields.map((field) => field.sourcePath),
    ...plan.dropFields,
    ...(plan.textFallback ? [plan.textFallback.sourcePath] : []),
  ];
}

function fallbackText(
  reference: unknown,
  plan: StateStorageNestedExtractionPlan,
): string | null {
  if (!plan.textFallback) return null;
  const text = getAtPath(reference, plan.textFallback.sourcePath);
  return typeof text === 'string' && text.length > 0 ? text : null;
}

function fallbackItem(
  plan: StateStorageNestedExtractionPlan,
  text: string,
): JsonValue {
  const fallback = plan.textFallback;
  if (!fallback) throw new Error('Text fallback is not configured');
  const item = structuredClone(fallback.itemTemplate) as Record<
    string,
    JsonValue
  >;
  setAtPath(item, fallback.contentPath, text);
  return item;
}

export async function extractReference(
  reference: unknown,
  plan: StateStorageNestedExtractionPlan,
  changes: Map<string, JsonValue>,
  read: ElectronStateSplitValueReader,
  counters: MutableSplitCounters,
): Promise<void> {
  const referenceId = usableId(getAtPath(reference, plan.itemIdPath));
  if (referenceId) {
    const destinationKey = `${plan.destinationKeyPrefix}${referenceId}`;
    const existing = changes.has(destinationKey)
      ? changes.get(destinationKey)
      : await read(destinationKey);
    let merged = mergeExtraction(existing, reference, plan);
    const text = fallbackText(reference, plan);
    if (text !== null && Array.isArray(merged) && merged.length === 0) {
      merged = [fallbackItem(plan, text)];
      counters.stdoutFallbackCount++;
    } else if (text !== null) {
      counters.droppedStdoutCount++;
    }
    changes.set(destinationKey, merged);
    counters.extractedValueCount++;
  } else if (
    bulkPaths(plan).some((jsonPath) =>
      isNonEmpty(getAtPath(reference, jsonPath)),
    )
  ) {
    counters.droppedBulkWithoutIdCount++;
  }
  for (const field of plan.fields) deleteAtPath(reference, field.sourcePath);
  for (const jsonPath of plan.dropFields) deleteAtPath(reference, jsonPath);
}

export async function computeElectronStateArraySplit(
  plan: StateStorageArraySplitPlan,
  read: ElectronStateSplitValueReader,
): Promise<ElectronStateArraySplitOutcome> {
  const counters: MutableSplitCounters = {
    extractedValueCount: 0,
    droppedStdoutCount: 0,
    stdoutFallbackCount: 0,
    droppedBulkWithoutIdCount: 0,
    skippedItemCount: 0,
  };
  const changes = new Map<string, JsonValue>();
  const source = await read(plan.sourceKey);
  if (source === undefined) {
    return {
      changes,
      counts: {
        sourceKey: plan.sourceKey,
        sourceSha256: sha256Json(null),
        itemCount: 0,
        ...counters,
      },
    };
  }
  if (!Array.isArray(source)) {
    if (
      isJsonObject(source) &&
      source['schemaVersion'] === plan.indexSchemaVersion
    ) {
      const items = source['items'];
      return {
        changes,
        counts: {
          sourceKey: plan.sourceKey,
          sourceSha256: sha256Json(source),
          itemCount: Array.isArray(items) ? items.length : 0,
          ...counters,
        },
      };
    }
    throw new Error('Split source is not an array');
  }

  const indexItems: JsonValue[] = [];
  for (const sourceItem of source) {
    const id = usableId(getAtPath(sourceItem, plan.itemIdPath));
    if (!id) {
      counters.skippedItemCount++;
      continue;
    }
    const detail = structuredClone(sourceItem);
    for (const extraction of plan.nestedExtractions ?? []) {
      const nested = getAtPath(detail, extraction.sourceArrayPath);
      if (!Array.isArray(nested)) continue;
      for (const reference of nested) {
        await extractReference(reference, extraction, changes, read, counters);
      }
    }
    changes.set(`${plan.detailKeyPrefix}${id}`, detail);
    indexItems.push(project(sourceItem, plan.summaryFields));
  }
  changes.set(plan.indexKey, {
    schemaVersion: plan.indexSchemaVersion,
    items: indexItems,
  });
  return {
    changes,
    counts: {
      sourceKey: plan.sourceKey,
      sourceSha256: sha256Json(source),
      itemCount: source.length,
      ...counters,
    },
  };
}
