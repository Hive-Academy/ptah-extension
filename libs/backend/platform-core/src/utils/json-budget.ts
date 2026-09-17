import type { StateStorageTruncatedItem } from '../interfaces/async-state-storage.interface';
import type { StateStorageJsonPath } from '../interfaces/state-storage-maintenance.interface';

export const JSON_PATH_WILDCARD = '*';

export interface ShrinkJsonStringLeavesOptions {
  readonly maxEstimatorBytes: number;
  readonly maxJsonBytes: number;
  readonly estimate: (value: unknown) => number;
}

export interface JsonSequencePageSource<T> {
  readonly length: number;
  readonly itemAt: (index: number) => T;
}

export interface JsonSequenceEstimatorBudget {
  readonly maxBytes: number;
  readonly envelopeBytes: number;
  readonly separatorBytes: number;
  readonly estimate: (value: unknown) => number;
}

export interface PackJsonSequencePageOptions {
  readonly maxJsonBytes: number;
  readonly jsonEnvelopeBytes: number;
  readonly maxItemBytes: number;
  readonly estimator?: JsonSequenceEstimatorBudget;
}

export type PackedJsonSequencePage<T> =
  | {
      readonly status: 'packed';
      readonly items: T[];
      readonly nextIndex: number;
      readonly jsonBytes: number;
      readonly truncatedItems: StateStorageTruncatedItem[];
    }
  | {
      readonly status: 'item-too-large';
      readonly originalJsonBytes: number;
    };

export function jsonUtf8Bytes(value: unknown): number {
  const encoded = JSON.stringify(value);
  return Buffer.byteLength(encoded === undefined ? 'null' : encoded, 'utf8');
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function segmentMatches(
  segment: StateStorageJsonPath[number],
  key: string | number,
): boolean {
  return segment === JSON_PATH_WILDCARD || String(segment) === String(key);
}

function omitWalk(
  value: unknown,
  paths: readonly StateStorageJsonPath[],
): unknown {
  if (Array.isArray(value)) {
    const result: unknown[] = [];
    value.forEach((item, index) => {
      if (omitsHere(paths, index)) return;
      result.push(omitWalk(item, descend(paths, index)));
    });
    return result;
  }
  if (isJsonObject(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (omitsHere(paths, key)) continue;
      result[key] = omitWalk(item, descend(paths, key));
    }
    return result;
  }
  return value;
}

function omitsHere(
  paths: readonly StateStorageJsonPath[],
  key: string | number,
): boolean {
  return paths.some(
    (path) => path.length === 1 && segmentMatches(path[0], key),
  );
}

function descend(
  paths: readonly StateStorageJsonPath[],
  key: string | number,
): StateStorageJsonPath[] {
  const next: StateStorageJsonPath[] = [];
  for (const path of paths) {
    if (path.length > 1 && segmentMatches(path[0], key)) {
      next.push(path.slice(1));
    }
  }
  return next;
}

export function omitJsonPaths<T>(
  value: T,
  paths: readonly StateStorageJsonPath[],
): T {
  const effective = paths.filter((path) => path.length > 0);
  return omitWalk(value, effective) as T;
}

function jsonCodePointBytes(codePoint: number): number {
  if (codePoint === 0x22 || codePoint === 0x5c) return 2;
  if (codePoint < 0x20) {
    return codePoint === 0x08 ||
      codePoint === 0x09 ||
      codePoint === 0x0a ||
      codePoint === 0x0c ||
      codePoint === 0x0d
      ? 2
      : 6;
  }
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint >= 0xd800 && codePoint <= 0xdfff) return 6;
  if (codePoint < 0x10000) return 3;
  return 4;
}

function jsonContentBytes(text: string): number {
  return jsonUtf8Bytes(text) - 2;
}

function truncationSuffix(removedBytes: number): string {
  return `[truncated ${removedBytes} bytes]`;
}

function truncateLeaf(text: string, cap: number): string {
  const originalJsonBytes = jsonContentBytes(text);
  if (originalJsonBytes <= cap) return text;
  const rawBytes = Buffer.byteLength(text, 'utf8');
  const worstSuffixBytes = truncationSuffix(rawBytes).length;
  const contentBudget = cap - worstSuffixBytes;
  let used = 0;
  let end = 0;
  while (end < text.length && contentBudget > 0) {
    const codePoint = text.codePointAt(end) as number;
    const bytes = jsonCodePointBytes(codePoint);
    if (used + bytes > contentBudget) break;
    used += bytes;
    end += codePoint > 0xffff ? 2 : 1;
  }
  const prefix = text.slice(0, end);
  const removedBytes = rawBytes - Buffer.byteLength(prefix, 'utf8');
  const truncated = `${prefix}${truncationSuffix(removedBytes)}`;
  return jsonContentBytes(truncated) < originalJsonBytes ? truncated : text;
}

function shrinkWalk(value: unknown, cap: number): unknown {
  if (typeof value === 'string') return truncateLeaf(value, cap);
  if (Array.isArray(value)) return value.map((item) => shrinkWalk(item, cap));
  if (isJsonObject(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = shrinkWalk(item, cap);
    }
    return result;
  }
  return value;
}

function largestLeafJsonBytes(value: unknown): number {
  if (typeof value === 'string') return jsonContentBytes(value);
  let largest = 0;
  const children = Array.isArray(value)
    ? value
    : isJsonObject(value)
      ? Object.values(value)
      : [];
  for (const child of children) {
    largest = Math.max(largest, largestLeafJsonBytes(child));
  }
  return largest;
}

function fitsBudgets(
  candidate: unknown,
  options: ShrinkJsonStringLeavesOptions,
): boolean {
  return (
    jsonUtf8Bytes(candidate) <= options.maxJsonBytes &&
    options.estimate(candidate) <= options.maxEstimatorBytes
  );
}

export function shrinkJsonStringLeaves<T>(
  value: T,
  options: ShrinkJsonStringLeavesOptions,
): T | null {
  if (fitsBudgets(value, options)) return value;
  const smallest = shrinkWalk(value, 0);
  if (!fitsBudgets(smallest, options)) return null;
  let low = 0;
  let best = smallest;
  let high = largestLeafJsonBytes(value);
  while (low < high) {
    const cap = Math.ceil((low + high) / 2);
    const candidate = shrinkWalk(value, cap);
    if (fitsBudgets(candidate, options)) {
      low = cap;
      best = candidate;
    } else {
      high = cap - 1;
    }
  }
  return best as T;
}

export function packJsonSequencePage<T>(
  sequence: JsonSequencePageSource<T>,
  start: number,
  options: PackJsonSequencePageOptions,
): PackedJsonSequencePage<T> {
  const { estimator } = options;
  const items: T[] = [];
  let estimatorBytes = estimator?.envelopeBytes ?? 0;
  let jsonBytes = options.jsonEnvelopeBytes;
  let index = start;
  while (index < sequence.length) {
    const item = sequence.itemAt(index);
    const itemJson = jsonUtf8Bytes(item);
    const first = items.length === 0;
    const jsonSeparator = first ? 0 : 1;
    const itemEstimator = estimator
      ? estimator.estimate(item) + (first ? 0 : estimator.separatorBytes)
      : 0;
    if (
      (!estimator || estimatorBytes + itemEstimator <= estimator.maxBytes) &&
      jsonBytes + jsonSeparator + itemJson <= options.maxJsonBytes &&
      itemJson <= options.maxItemBytes
    ) {
      items.push(item);
      estimatorBytes += itemEstimator;
      jsonBytes += jsonSeparator + itemJson;
      index++;
      continue;
    }
    if (!first) break;
    const jsonCap = Math.min(
      options.maxJsonBytes - options.jsonEnvelopeBytes,
      options.maxItemBytes,
    );
    const shrunk = shrinkJsonStringLeaves(
      item,
      estimator
        ? {
            maxEstimatorBytes: estimator.maxBytes - estimator.envelopeBytes,
            maxJsonBytes: jsonCap,
            estimate: estimator.estimate,
          }
        : {
            maxEstimatorBytes: jsonCap,
            maxJsonBytes: jsonCap,
            estimate: jsonUtf8Bytes,
          },
    );
    if (shrunk === null) {
      return { status: 'item-too-large', originalJsonBytes: itemJson };
    }
    return {
      status: 'packed',
      items: [shrunk],
      nextIndex: index + 1,
      jsonBytes: jsonBytes + jsonUtf8Bytes(shrunk),
      truncatedItems: [{ index: 0, originalJsonBytes: itemJson }],
    };
  }
  return {
    status: 'packed',
    items,
    nextIndex: index,
    jsonBytes,
    truncatedItems: [],
  };
}
