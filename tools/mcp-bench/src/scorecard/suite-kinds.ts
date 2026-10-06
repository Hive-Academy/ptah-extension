import { createHash } from 'node:crypto';
import { z } from 'zod';

export interface SuiteView<D> {
  kind: string;
  details: D;
  claim: {
    source: 'prompt' | 'tool-description' | 'ledger' | 'code';
    ref: string;
    text?: string;
  };
  groundTruth: {
    id: string;
    version: string;
    method: 'generated' | 'labelled' | 'seeded' | 'git-history';
    raterCount?: number;
    frozenAt?: string;
  };
  arm?: string;
  projectionSha256?: string;
  baselines: Array<{
    id: string;
    label: string;
    metrics: Record<string, number | null>;
  }>;
  deltas: Record<string, Record<string, number | null>>;
  cost: {
    source: 'live' | 'cassette' | 'none';
    calls: number;
    latency_ms: { p50: number | null; p95: number | null };
    error_rate: number | null;
    tokens: {
      result_p50?: number | null;
      input?: number | null;
      output?: number | null;
      billed?: number | null;
    };
  };
  verdict: 'pass' | 'fail' | 'na';
  naReason?: string;
}
export interface SuiteKind {
  readonly detailsSchema: z.ZodType<unknown>;
  readonly renderMarkdown?: (view: SuiteView<unknown>) => string[];
}
export interface SuiteKindRegistry {
  registerSuiteKind<D>(
    kind: string,
    detailsSchema: z.ZodType<D>,
    renderMarkdown?: (view: SuiteView<D>) => string[],
  ): void;
  getSuiteKind(kind: string): SuiteKind | undefined;
  getRegisteredSuiteKinds(): string[];
}
export function createSuiteKindRegistry(): SuiteKindRegistry {
  const kinds = new Map<string, SuiteKind>();
  return {
    registerSuiteKind<D>(
      kind: string,
      detailsSchema: z.ZodType<D>,
      renderMarkdown?: (view: SuiteView<D>) => string[],
    ): void {
      if (kind.trim().length === 0)
        throw new Error('suite kind must be non-empty');
      if (kinds.has(kind))
        throw new Error(`suite kind already registered: ${kind}`);
      kinds.set(kind, {
        detailsSchema,
        renderMarkdown:
          renderMarkdown === undefined
            ? undefined
            : (view) =>
                renderMarkdown({
                  ...view,
                  details: detailsSchema.parse(view.details),
                }),
      });
    },
    getSuiteKind(kind: string): SuiteKind | undefined {
      return kinds.get(kind);
    },
    getRegisteredSuiteKinds(): string[] {
      return [...kinds.keys()];
    },
  };
}
export const defaultSuiteKindRegistry = createSuiteKindRegistry();
export function registerSuiteKind<D>(
  kind: string,
  detailsSchema: z.ZodType<D>,
  renderMarkdown?: (view: SuiteView<D>) => string[],
): void {
  defaultSuiteKindRegistry.registerSuiteKind(
    kind,
    detailsSchema,
    renderMarkdown,
  );
}
export function getSuiteKind(kind: string): SuiteKind | undefined {
  return defaultSuiteKindRegistry.getSuiteKind(kind);
}
export function getRegisteredSuiteKinds(): string[] {
  return defaultSuiteKindRegistry.getRegisteredSuiteKinds();
}

export function computeProjectionSha256(projection: unknown): string {
  return createHash('sha256').update(canonicalJson(projection)).digest('hex');
}

function canonicalJson(
  value: unknown,
  ancestors: Set<object> = new Set(),
): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new Error('projection cannot contain non-finite numbers');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value))
      throw new Error('projection cannot contain cycles');
    ancestors.add(value);
    const result = `[${value
      .map((item) => {
        if (item === undefined)
          throw new Error(
            'projection cannot contain undefined values in arrays',
          );
        return canonicalJson(item, ancestors);
      })
      .join(',')}]`;
    ancestors.delete(value);
    return result;
  }
  if (typeof value === 'object') {
    if (ancestors.has(value))
      throw new Error('projection cannot contain cycles');
    ancestors.add(value);
    const record = value as Record<string, unknown>;
    const result = `{${Object.keys(record)
      .sort()
      .filter((key) => record[key] !== undefined)
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJson(record[key], ancestors)}`,
      )
      .join(',')}}`;
    ancestors.delete(value);
    return result;
  }
  throw new Error(`projection cannot contain ${typeof value} values`);
}
