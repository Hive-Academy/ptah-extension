/**
 * Record-mode provenance for staged cassettes.
 *
 * The product tap is `Symbol.for('PtahModelDispatchProvenanceTap')` (Batch A2).
 * The cassette doubles write JSONL straight to the plan path
 * (`doubles/cassette-store.ts` `record`); they have no staging directory and
 * this batch does not edit them. Provenance is therefore a sidecar,
 * `<cassette>.provenance.json`, written only after every dispatch matches.
 * A skill lane may record one structured-output retry (two dispatches per
 * cassette entry). The curator stays one dispatch per entry. A mismatch, a
 * short count, or an auth-file change deletes the cassette file (the
 * unaccepted recording) and the sidecar. Nothing is copied onward.
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

/** Shared with the curator and the skill lane runner. */
export const MODEL_DISPATCH_PROVENANCE_TAP = Symbol.for(
  'PtahModelDispatchProvenanceTap',
);

export interface ModelDispatchProvenance {
  readonly resolvedProviderId: string;
  readonly resolvedModelId: string;
  readonly component: 'memory-curator' | 'skill-lane';
  readonly laneId: string;
}

export interface ModelDispatchProvenanceTap {
  onModelDispatched(provenance: ModelDispatchProvenance): void;
}

/** Collects tap callbacks for the host's end-of-run check. */
export class DispatchProvenanceCollector implements ModelDispatchProvenanceTap {
  readonly events: ModelDispatchProvenance[] = [];

  onModelDispatched(provenance: ModelDispatchProvenance): void {
    this.events.push({
      resolvedProviderId: provenance.resolvedProviderId,
      resolvedModelId: provenance.resolvedModelId,
      component: provenance.component,
      laneId: provenance.laneId,
    });
  }

  forComponent(
    component: ModelDispatchProvenance['component'],
  ): readonly ModelDispatchProvenance[] {
    return this.events.filter((event) => event.component === component);
  }
}

export class RecordingRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecordingRejectedError';
  }
}

export interface StagedCassetteEntry {
  readonly key: string;
  /** Cassette operation, retained only for redacted rejection diagnostics. */
  readonly method?: string;
}

/** `<cassette path>.provenance.json`, beside the staged cassette. */
export function provenanceSidecarPath(cassettePath: string): string {
  return `${cassettePath}.provenance.json`;
}

/** JSONL lines the double wrote. A missing file is an empty recording. */
export function readStagedCassetteEntries(
  path: string,
): readonly StagedCassetteEntry[] {
  if (!existsSync(path)) return [];
  const entries: StagedCassetteEntry[] = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new RecordingRejectedError(
        `staged cassette ${path} has a line that is not JSON`,
      );
    }
    const entry = parsed as { key?: unknown; method?: unknown };
    const key =
      parsed !== null && typeof parsed === 'object' ? entry.key : undefined;
    if (typeof key !== 'string' || key.length === 0) {
      throw new RecordingRejectedError(
        `staged cassette ${path} has an entry with no key`,
      );
    }
    entries.push({
      key,
      method: typeof entry.method === 'string' ? entry.method : 'unknown',
    });
  }
  return entries;
}

export interface ExpectedRoute {
  readonly providerId: string;
  readonly modelId: string;
}

/**
 * Expected provider and model for one dispatch. Provider comes from the
 * product settings the plan wrote (`memory.curatorProvider`, or
 * `skillSynthesis.<laneId>.provider`). Model prefers the matching settings
 * key and otherwise the cassette's pinned model. A missing provider is `''`,
 * which the validator rejects.
 */
export function expectedRouteFor(
  dispatch: ModelDispatchProvenance,
  settings: Readonly<Record<string, string | number | boolean>> | undefined,
  cassetteModel: string,
): ExpectedRoute {
  const read = (key: string): string => {
    const value = settings?.[key];
    return typeof value === 'string' ? value : '';
  };
  if (dispatch.component === 'memory-curator') {
    const model = read('memory.curatorModel');
    return {
      providerId: read('memory.curatorProvider'),
      modelId: model.length > 0 ? model : cassetteModel,
    };
  }
  const model = read(`skillSynthesis.${dispatch.laneId}.model`);
  return {
    providerId: read(`skillSynthesis.${dispatch.laneId}.provider`),
    modelId: model.length > 0 ? model : cassetteModel,
  };
}

/**
 * Exact match of one staged entry to its dispatch. `''`, a missing dispatch,
 * or any other provider/model (including an alias) fails.
 */
export function provenanceMismatch(input: {
  readonly cassetteKey: string;
  readonly dispatch: ModelDispatchProvenance | undefined;
  readonly expectedProviderId: string;
  readonly expectedModelId: string;
}): string | null {
  const { cassetteKey, dispatch } = input;
  if (dispatch === undefined) {
    return `provenance missing for cassette key ${cassetteKey}`;
  }
  if (dispatch.resolvedProviderId === '') {
    return `provenance provider is empty for cassette key ${cassetteKey}`;
  }
  if (dispatch.resolvedModelId === '') {
    return `provenance model is empty for cassette key ${cassetteKey}`;
  }
  if (dispatch.resolvedProviderId !== input.expectedProviderId) {
    return (
      `provenance provider ${dispatch.resolvedProviderId} does not match ` +
      `${input.expectedProviderId} for cassette key ${cassetteKey}`
    );
  }
  if (dispatch.resolvedModelId !== input.expectedModelId) {
    return (
      `provenance model ${dispatch.resolvedModelId} does not match ` +
      `${input.expectedModelId} for cassette key ${cassetteKey}`
    );
  }
  return null;
}

/**
 * One structured-output retry: a skill-lane entry may have two dispatches.
 * The curator has no retry, so it stays one dispatch per entry.
 */
const SKILL_LANE_DISPATCHES_PER_ENTRY = 2;

/**
 * Check one component's staged cassette.
 *
 * Cassette lines only carry `key`, so entries cannot be split by lane. The
 * host calls this once per component. Inside that call, dispatches are grouped
 * by `component` and `laneId`: every dispatch in a group must match that
 * lane's provider and model exactly (non-empty). The component then needs at
 * least one matching dispatch per entry. Skill-lane may record up to
 * {@link SKILL_LANE_DISPATCHES_PER_ENTRY} dispatches per entry; the curator
 * must be exact. Zero entries and zero dispatches is an empty recording.
 */
export function provenanceProblems(input: {
  readonly component: ModelDispatchProvenance['component'];
  readonly entries: readonly StagedCassetteEntry[];
  readonly dispatches: readonly ModelDispatchProvenance[];
  readonly expectedFor: (
    dispatch: ModelDispatchProvenance,
    index: number,
  ) => ExpectedRoute;
}): readonly string[] {
  if (input.entries.length === 0 && input.dispatches.length === 0) {
    return [];
  }
  const problems: string[] = [];
  const groups = new Map<string, ModelDispatchProvenance[]>();
  for (const dispatch of input.dispatches) {
    const groupKey = `${dispatch.component}\0${dispatch.laneId}`;
    const group = groups.get(groupKey);
    if (group === undefined) groups.set(groupKey, [dispatch]);
    else group.push(dispatch);
  }
  let matching = 0;
  let index = 0;
  for (const group of groups.values()) {
    for (const dispatch of group) {
      const entry =
        input.entries[Math.min(index, Math.max(input.entries.length - 1, 0))];
      const cassetteKey = entry?.key ?? `dispatch-${index}`;
      index += 1;
      if (dispatch.component !== input.component) {
        problems.push(
          `provenance dispatch component ${dispatch.component} is not ` +
            `${input.component} for cassette key ${cassetteKey}`,
        );
        continue;
      }
      const expected = input.expectedFor(dispatch, index - 1);
      const problem = provenanceMismatch({
        cassetteKey,
        dispatch,
        expectedProviderId: expected.providerId,
        expectedModelId: expected.modelId,
      });
      if (problem !== null) problems.push(problem);
      else matching += 1;
    }
  }
  const entryCount = input.entries.length;
  const dispatchCount = input.dispatches.length;
  const maxPerEntry =
    input.component === 'skill-lane' ? SKILL_LANE_DISPATCHES_PER_ENTRY : 1;
  if (dispatchCount < entryCount || dispatchCount > entryCount * maxPerEntry) {
    problems.push(
      `staged cassette has ${entryCount} entries but ` +
        `${dispatchCount} provenance dispatches`,
    );
  } else if (matching < entryCount) {
    problems.push(
      `staged cassette has ${entryCount} entries but ${matching} matching ` +
        'provenance dispatches',
    );
  }
  return problems;
}

export interface ProvenanceSidecarEntry {
  readonly key: string;
  readonly resolvedProviderId: string;
  readonly resolvedModelId: string;
  readonly laneId: string;
}

/** Write the sidecar. Call only after {@link provenanceProblems} is empty. */
export function writeProvenanceSidecar(
  cassettePath: string,
  component: ModelDispatchProvenance['component'],
  entries: readonly StagedCassetteEntry[],
  dispatches: readonly ModelDispatchProvenance[],
): void {
  const rows: ProvenanceSidecarEntry[] = entries.map((entry, index) => ({
    key: entry.key,
    resolvedProviderId: dispatches[index]?.resolvedProviderId ?? '',
    resolvedModelId: dispatches[index]?.resolvedModelId ?? '',
    laneId: dispatches[index]?.laneId ?? '',
  }));
  const body = {
    schemaId: '620.cassette-provenance.v1',
    component,
    entries: rows,
  };
  writeFileSync(
    provenanceSidecarPath(cassettePath),
    `${JSON.stringify(body, null, 2)}\n`,
    'utf8',
  );
}

export interface ProvenanceSidecarWrite {
  readonly component: ModelDispatchProvenance['component'];
  readonly path: string;
  readonly entries: readonly StagedCassetteEntry[];
  readonly dispatches: readonly ModelDispatchProvenance[];
}

/**
 * Write one sidecar per non-empty cassette. Any throw deletes every cassette
 * in the batch and any sidecar already written, then rethrows.
 */
export function commitProvenanceSidecars(
  sides: readonly ProvenanceSidecarWrite[],
  write: (
    cassettePath: string,
    component: ModelDispatchProvenance['component'],
    entries: readonly StagedCassetteEntry[],
    dispatches: readonly ModelDispatchProvenance[],
  ) => void = writeProvenanceSidecar,
): void {
  const paths = sides.map((side) => side.path);
  try {
    for (const side of sides) {
      if (side.entries.length === 0) continue;
      write(side.path, side.component, side.entries, side.dispatches);
    }
  } catch (error: unknown) {
    discardStagedCassettes(paths);
    throw error;
  }
}

/**
 * Delete the cassette JSONL and its sidecar. The doubles write the final
 * path directly, so deleting it is the refusal to promote.
 */
export function discardStagedCassettes(paths: readonly string[]): void {
  for (const path of paths) {
    rmSync(path, { force: true });
    rmSync(provenanceSidecarPath(path), { force: true });
  }
}
