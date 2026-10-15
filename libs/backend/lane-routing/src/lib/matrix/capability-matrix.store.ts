import { join } from 'node:path';
import {
  LANE_DEFAULT_MODEL,
  OUTCOME_TASK_KINDS,
  SUBAGENT_LANE_ID,
  type LaneOutcomeReader,
  type LaneOutcomeSummary,
  type OutcomeTaskKind,
} from '@ptah-extension/shared';
import type { IFileSystemProvider } from '@ptah-extension/platform-core';
import { NEUTRAL_SCORE, OUTCOME_WINDOW_MS } from '../routing-constants';
import type {
  LaneRoutingLogMeta,
  LaneRoutingLogger,
} from '../lane-routing-logger';
import { CapabilityMatrixSchema } from './matrix.schema';
import {
  CAPABILITY_MATRIX_VERSION,
  FAMILY_PROFILE_MODEL,
  type CapabilityMatrix,
  type MatrixCell,
  type MatrixCellSource,
  type MatrixProfile,
} from './matrix.types';
import { AUTOMATIC_MATRIX_MODEL, deriveLocalMatrix } from './local-derivation';
import { buildSeedMatrix, isStale } from './seed-matrix';

/**
 * Capability matrix store (part A §3, Requirements 6.4-6.8).
 *
 * Precedence per cell is user, then local, then seed, then unknown. An
 * unknown cell does not hide a lower layer. Lookup of `LANE_DEFAULT_MODEL`
 * or `auto`, and lookup of a model with no profile row, reads the family
 * profile (`*`, Requirement 11.3).
 *
 * The `~/.ptah` directory is injected. platform-core has no host-neutral
 * home helper (PA-2); AB14 passes the absolute directory per host.
 *
 * Files, both under `{ptahHomeDir}/routing/`:
 * - `capability-matrix.json` — user edits. Read at most once per `load`.
 *   Created once as an empty version-1 matrix when it is missing, and never
 *   rewritten after that. A bad edit keeps the last valid copy in memory.
 * - `capability-matrix.view.json` — the merged cells routing will use.
 *   Written only when the canonical text changed.
 */

export const MATRIX_INVALID_PREFIX = 'matrix-invalid:';

/** Reader missing, or a read that breaks the SC-2 "never rejects" contract. */
export const OUTCOMES_UNAVAILABLE_REASON = 'outcomes-unavailable';

/** `LaneOutcomeReader.isPersistent()` is false (SC-2, Requirement 4.5). */
export const NO_OUTCOME_HISTORY_REASON = 'no outcome history';

/** Pretty-printed empty user template. The store writes this at most once. */
export const EMPTY_CAPABILITY_MATRIX_TEXT = `${JSON.stringify(
  { version: CAPABILITY_MATRIX_VERSION, profiles: [] },
  null,
  2,
)}\n`;

const MAX_MATRIX_INVALID_REASONS = 20;

export function capabilityMatrixUserPath(ptahHomeDir: string): string {
  return join(ptahHomeDir, 'routing', 'capability-matrix.json');
}

export function capabilityMatrixViewPath(ptahHomeDir: string): string {
  return join(ptahHomeDir, 'routing', 'capability-matrix.view.json');
}

export interface CapabilityMatrixStoreDependencies {
  readonly fileSystem: IFileSystemProvider;
  /** Absolute `~/.ptah` directory. The store does not expand `~`. */
  readonly ptahHomeDir: string;
  readonly outcomeReader?: LaneOutcomeReader;
  readonly logger?: LaneRoutingLogger;
}

/** One lane whose recent outcomes feed local cells for this call. */
export interface MatrixOutcomeQuery {
  readonly laneId: string;
  /** When true, outcomes are read with `SUBAGENT_LANE_ID`, not `laneId`. */
  readonly subagent: boolean;
}

export interface MatrixLoadInput {
  readonly nowMs: number;
  readonly outcomeQueries: readonly MatrixOutcomeQuery[];
}

export interface ResolvedMatrixCell {
  readonly family: string;
  readonly model: string;
  /** `*` when the lookup used the family profile. */
  readonly profileModel: string;
  readonly taskKind: OutcomeTaskKind;
  readonly cell: MatrixCell;
  /** The cell score, or `NEUTRAL_SCORE` when the cell is unknown (Req 6.4). */
  readonly score: number;
  /**
   * True when the resolved cell is unknown. Reason text for that case is
   * "no profile" (`compile-reasons.ts`).
   */
  readonly noProfile: boolean;
}

export interface CapabilityMatrixSnapshot {
  /** `matrix-invalid:` entries, then an outcome-reader reason when one applies. */
  readonly reasons: readonly string[];
  resolve(
    family: string,
    model: string,
    taskKind: OutcomeTaskKind,
  ): ResolvedMatrixCell;
}

/** Value row of the view file. `sourceRef` and `sampleCount` are null when absent. */
export interface MatrixViewValue {
  readonly kind: 'value';
  readonly score: number;
  readonly source: MatrixCellSource;
  readonly sourceRef: string | null;
  readonly asOf: string;
  readonly stale: boolean;
  readonly sampleCount: number | null;
  readonly note?: string;
}

export interface MatrixViewUnknown {
  readonly kind: 'unknown';
}

export type MatrixViewCell = MatrixViewValue | MatrixViewUnknown;

export interface MatrixViewProfile {
  readonly family: string;
  readonly model: string;
  readonly cells: Readonly<Record<OutcomeTaskKind, MatrixViewCell>>;
}

export interface CapabilityMatrixView {
  readonly version: typeof CAPABILITY_MATRIX_VERSION;
  readonly profiles: readonly MatrixViewProfile[];
}

interface LayerLoad {
  readonly matrix: CapabilityMatrix;
  readonly reasons: readonly string[];
}

interface ProfileIndex {
  readonly byKey: ReadonlyMap<string, MatrixProfile>;
}

type Persistence = 'yes' | 'no' | 'unavailable';

export class CapabilityMatrixStore {
  private readonly userFilePath: string;
  private readonly viewPath: string;
  private lastValidUser: CapabilityMatrix = emptyMatrix();
  private lastViewText: string | undefined;
  private viewTextKnown = false;

  constructor(private readonly deps: CapabilityMatrixStoreDependencies) {
    if (!/\S/.test(deps.ptahHomeDir)) {
      throw new Error('ptahHomeDir must be the absolute ~/.ptah directory');
    }
    this.userFilePath = capabilityMatrixUserPath(deps.ptahHomeDir);
    this.viewPath = capabilityMatrixViewPath(deps.ptahHomeDir);
  }

  /**
   * Merge seed, the user file and local cells for one routing call.
   * Reads the user file at most once. Writes the view only on change.
   */
  async load(input: MatrixLoadInput): Promise<CapabilityMatrixSnapshot> {
    if (!Number.isFinite(input.nowMs)) {
      throw new Error('nowMs must be a finite epoch millisecond');
    }
    const userLoad = await this.readUserMatrix();
    const localLoad = await this.readLocalMatrix(
      input.nowMs,
      input.outcomeQueries,
    );
    const layers = [
      indexMatrix(userLoad.matrix),
      indexMatrix(localLoad.matrix),
      indexMatrix(buildSeedMatrix(input.nowMs)),
    ];
    await this.writeViewIfChanged(layers, input.nowMs);
    return {
      reasons: [...userLoad.reasons, ...localLoad.reasons],
      resolve: (family, model, taskKind) =>
        resolveIndexed(layers, family, model, taskKind, input.nowMs),
    };
  }

  private async readUserMatrix(): Promise<LayerLoad> {
    let text: string;
    try {
      text = await this.deps.fileSystem.readFile(this.userFilePath);
    } catch (error: unknown) {
      // degradation-audit: reported - a missing user file is created once; any other read failure keeps the last valid matrix
      if (isMissingFile(error)) {
        this.lastValidUser = emptyMatrix();
        await this.writeEmptyTemplate();
        return { matrix: this.lastValidUser, reasons: [] };
      }
      this.warn('capability matrix user file could not be read', error);
      return {
        matrix: this.lastValidUser,
        reasons: [matrixInvalid('capability-matrix.json (unreadable)')],
      };
    }
    return this.acceptUserText(text);
  }

  private async writeEmptyTemplate(): Promise<void> {
    try {
      await this.deps.fileSystem.writeFile(
        this.userFilePath,
        EMPTY_CAPABILITY_MATRIX_TEXT,
      );
    } catch (error: unknown) {
      // degradation-audit: reported - routing still uses the seed when the empty template cannot be created; the next load retries
      this.warn('capability matrix template write failed', error);
    }
  }

  private acceptUserText(text: string): LayerLoad {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (error: unknown) {
      // degradation-audit: reported - invalid JSON keeps the last valid matrix and names the file, not the parser text
      this.warn('capability matrix user file is not valid JSON', error);
      return {
        matrix: this.lastValidUser,
        reasons: [matrixInvalid('capability-matrix.json (not valid JSON)')],
      };
    }
    const validated = CapabilityMatrixSchema.safeParse(raw);
    if (!validated.success) {
      const reasons = schemaReasons(validated.error.issues, raw);
      return {
        matrix: this.lastValidUser,
        reasons:
          reasons.length > 0
            ? reasons
            : [matrixInvalid('capability-matrix.json (invalid)')],
      };
    }
    const sourceReasons = nonUserSourceReasons(validated.data);
    if (sourceReasons.length > 0) {
      return { matrix: this.lastValidUser, reasons: sourceReasons };
    }
    this.lastValidUser = validated.data;
    return { matrix: validated.data, reasons: [] };
  }

  private async readLocalMatrix(
    nowMs: number,
    queries: readonly MatrixOutcomeQuery[],
  ): Promise<LayerLoad> {
    const reader = this.deps.outcomeReader;
    if (reader === undefined) {
      return { matrix: emptyMatrix(), reasons: [OUTCOMES_UNAVAILABLE_REASON] };
    }
    const persistent = this.readPersistent(reader);
    if (persistent === 'unavailable') {
      return { matrix: emptyMatrix(), reasons: [OUTCOMES_UNAVAILABLE_REASON] };
    }
    if (persistent === 'no') {
      return { matrix: emptyMatrix(), reasons: [NO_OUTCOME_HISTORY_REASON] };
    }
    const laneIds = readerLaneIds(queries);
    if (laneIds.length === 0) {
      return { matrix: emptyMatrix(), reasons: [] };
    }
    const sinceMs = nowMs - OUTCOME_WINDOW_MS;
    let summaries: readonly LaneOutcomeSummary[];
    try {
      const batches = await Promise.all(
        laneIds.map((laneId) => reader.recentOutcomes(laneId, { sinceMs })),
      );
      summaries = flattenSummaries(batches);
    } catch (error: unknown) {
      // degradation-audit: reported - the reader contract never rejects; a throw or a non-array drops local cells for this call
      this.warn('lane outcome read failed', error);
      return {
        matrix: emptyMatrix(),
        reasons: [OUTCOMES_UNAVAILABLE_REASON],
      };
    }
    return { matrix: deriveLocalMatrix(summaries, nowMs), reasons: [] };
  }

  private readPersistent(reader: LaneOutcomeReader): Persistence {
    try {
      const persistent = reader.isPersistent();
      if (persistent === true) return 'yes';
      if (persistent === false) return 'no';
      this.warn(
        'lane outcome persistence check returned a non-boolean',
        new Error('isPersistent returned a non-boolean'),
      );
      return 'unavailable';
    } catch (error: unknown) {
      // degradation-audit: reported - a throwing persistence check means the outcome store is unreadable; local cells are omitted
      this.warn('lane outcome persistence check failed', error);
      return unavailablePersistence();
    }
  }

  private async writeViewIfChanged(
    layers: readonly ProfileIndex[],
    nowMs: number,
  ): Promise<void> {
    const text = serializeView(viewDocument(layers, nowMs));
    const previous = await this.rememberedViewText();
    if (previous === text) return;
    try {
      await this.deps.fileSystem.writeFile(this.viewPath, text);
      this.lastViewText = text;
    } catch (error: unknown) {
      // degradation-audit: reported - the routing decision does not read the view; a failed write is logged and retried on the next change
      this.warn('capability matrix view write failed', error);
    }
  }

  private async rememberedViewText(): Promise<string | undefined> {
    if (this.viewTextKnown) return this.lastViewText;
    this.viewTextKnown = true;
    try {
      const text = await this.deps.fileSystem.readFile(this.viewPath);
      this.lastViewText = text;
      return text;
    } catch (error: unknown) {
      // degradation-audit: reported - a missing view is created by this load; any other read failure is logged and the view is rewritten
      if (!isMissingFile(error)) {
        this.warn('capability matrix view file could not be read', error);
      }
      this.lastViewText = undefined;
      return undefined;
    }
  }

  private warn(message: string, error: unknown): void {
    this.deps.logger?.warn(message, errorFacts(error));
  }
}

function unavailablePersistence(): 'unavailable' {
  return 'unavailable';
}

function emptyMatrix(): CapabilityMatrix {
  return { version: CAPABILITY_MATRIX_VERSION, profiles: [] };
}

function readerLaneIds(queries: readonly MatrixOutcomeQuery[]): string[] {
  const ids = new Set<string>();
  for (const query of queries) {
    if (query.subagent) {
      ids.add(SUBAGENT_LANE_ID);
      continue;
    }
    if (!/\S/.test(query.laneId)) continue;
    ids.add(query.laneId);
  }
  return [...ids];
}

function flattenSummaries(
  batches: readonly (readonly LaneOutcomeSummary[])[],
): LaneOutcomeSummary[] {
  const summaries: LaneOutcomeSummary[] = [];
  for (const batch of batches) {
    if (!Array.isArray(batch)) {
      throw new Error('lane outcome reader returned a non-array');
    }
    for (const summary of batch) summaries.push(summary);
  }
  return summaries;
}

function indexMatrix(matrix: CapabilityMatrix): ProfileIndex {
  const byKey = new Map<string, MatrixProfile>();
  for (const profile of matrix.profiles) {
    byKey.set(profileKey(profile.family, profile.model), profile);
  }
  return { byKey };
}

function profileKey(family: string, model: string): string {
  return JSON.stringify([family, model]);
}

function resolveIndexed(
  layers: readonly ProfileIndex[],
  family: string,
  model: string,
  taskKind: OutcomeTaskKind,
  nowMs: number,
): ResolvedMatrixCell {
  const profileModel = profileModelFor(
    model,
    hasProfile(layers, family, model),
  );
  const cell = mergedCell(layers, family, profileModel, taskKind, nowMs);
  return {
    family,
    model,
    profileModel,
    taskKind,
    cell,
    score: cell.kind === 'value' ? cell.score : NEUTRAL_SCORE,
    noProfile: cell.kind === 'unknown',
  };
}

/**
 * `lane-default` and `auto` always use the family profile, even when a row
 * is stored under that model id. Any other model uses its own row when one
 * exists in the user file, the local matrix or the seed.
 */
function profileModelFor(model: string, hasExact: boolean): string {
  if (
    model === LANE_DEFAULT_MODEL ||
    model === AUTOMATIC_MATRIX_MODEL ||
    !hasExact
  ) {
    return FAMILY_PROFILE_MODEL;
  }
  return model;
}

function hasProfile(
  layers: readonly ProfileIndex[],
  family: string,
  model: string,
): boolean {
  const key = profileKey(family, model);
  return layers.some((layer) => layer.byKey.has(key));
}

function mergedCell(
  layers: readonly ProfileIndex[],
  family: string,
  model: string,
  taskKind: OutcomeTaskKind,
  nowMs: number,
): MatrixCell {
  const key = profileKey(family, model);
  for (const layer of layers) {
    const cell = layer.byKey.get(key)?.cells[taskKind];
    if (cell?.kind === 'value') {
      return { ...cell, stale: isStale(cell.asOf, nowMs) };
    }
  }
  return { kind: 'unknown' };
}

function viewDocument(
  layers: readonly ProfileIndex[],
  nowMs: number,
): CapabilityMatrixView {
  const keys = new Map<string, { family: string; model: string }>();
  for (const layer of layers) {
    for (const profile of layer.byKey.values()) {
      keys.set(profileKey(profile.family, profile.model), {
        family: profile.family,
        model: profile.model,
      });
    }
  }
  const profiles = [...keys.values()].sort(compareProfileKeys).map((key) => ({
    family: key.family,
    model: key.model,
    cells: viewCells(layers, key.family, key.model, nowMs),
  }));
  return { version: CAPABILITY_MATRIX_VERSION, profiles };
}

function viewCells(
  layers: readonly ProfileIndex[],
  family: string,
  model: string,
  nowMs: number,
): Record<OutcomeTaskKind, MatrixViewCell> {
  return {
    plan: toViewCell(mergedCell(layers, family, model, 'plan', nowMs)),
    implement: toViewCell(
      mergedCell(layers, family, model, 'implement', nowMs),
    ),
    review: toViewCell(mergedCell(layers, family, model, 'review', nowMs)),
    research: toViewCell(mergedCell(layers, family, model, 'research', nowMs)),
    tests: toViewCell(mergedCell(layers, family, model, 'tests', nowMs)),
    docs: toViewCell(mergedCell(layers, family, model, 'docs', nowMs)),
  };
}

function toViewCell(cell: MatrixCell): MatrixViewCell {
  if (cell.kind === 'unknown') return { kind: 'unknown' };
  const view: MatrixViewValue = {
    kind: 'value',
    score: cell.score,
    source: cell.source,
    sourceRef: cell.sourceRef ?? null,
    asOf: cell.asOf,
    stale: cell.stale,
    sampleCount: cell.sampleCount ?? null,
  };
  if (cell.note === undefined) return view;
  return { ...view, note: cell.note };
}

function serializeView(view: CapabilityMatrixView): string {
  return `${JSON.stringify(view, null, 2)}\n`;
}

function compareProfileKeys(
  left: { readonly family: string; readonly model: string },
  right: { readonly family: string; readonly model: string },
): number {
  if (left.family < right.family) return -1;
  if (left.family > right.family) return 1;
  if (left.model === right.model) return 0;
  if (left.model === FAMILY_PROFILE_MODEL) return -1;
  if (right.model === FAMILY_PROFILE_MODEL) return 1;
  if (left.model < right.model) return -1;
  return 1;
}

function schemaReasons(
  issues: readonly {
    readonly path: readonly PropertyKey[];
    readonly message: string;
  }[],
  raw: unknown,
): string[] {
  return capReasons(
    issues.map((issue) =>
      matrixInvalid(`${issueEntry(issue.path, raw)} (${issue.message})`),
    ),
  );
}

function issueEntry(path: readonly PropertyKey[], raw: unknown): string {
  const named = namedIssue(path, raw);
  if (named !== undefined) return named;
  if (path.length === 0) return 'capability-matrix.json';
  return path.map((part) => String(part)).join('.');
}

function namedIssue(
  path: readonly PropertyKey[],
  raw: unknown,
): string | undefined {
  if (path[0] !== 'profiles' || typeof path[1] !== 'number') return undefined;
  const identity = profileIdentity(raw, path[1]);
  if (identity === undefined) return undefined;
  const taskKind =
    path[2] === 'cells' && typeof path[3] === 'string' ? path[3] : undefined;
  return namedProfile(identity.family, identity.model, taskKind);
}

function profileIdentity(
  raw: unknown,
  index: number,
): { readonly family: string; readonly model: string } | undefined {
  if (typeof raw !== 'object' || raw === null || !('profiles' in raw)) {
    return undefined;
  }
  const profiles = raw.profiles;
  if (!Array.isArray(profiles)) return undefined;
  const profile: unknown = profiles[index];
  if (typeof profile !== 'object' || profile === null) return undefined;
  if (!('family' in profile) || !('model' in profile)) return undefined;
  const family = profile.family;
  const model = profile.model;
  if (typeof family !== 'string' || typeof model !== 'string') return undefined;
  return { family, model };
}

function nonUserSourceReasons(matrix: CapabilityMatrix): string[] {
  const reasons: string[] = [];
  for (const profile of matrix.profiles) {
    for (const kind of OUTCOME_TASK_KINDS) {
      const cell = profile.cells[kind];
      if (cell.kind !== 'value' || cell.source === 'user') continue;
      reasons.push(
        matrixInvalid(
          `${namedProfile(profile.family, profile.model, kind)} source must be "user" (found "${cell.source}")`,
        ),
      );
    }
  }
  return capReasons(reasons);
}

function namedProfile(
  family: string,
  model: string,
  taskKind: string | undefined,
): string {
  const base = `family "${family}" model "${model}"`;
  if (taskKind === undefined) return base;
  return `${base} task "${taskKind}"`;
}

function capReasons(reasons: readonly string[]): string[] {
  if (reasons.length <= MAX_MATRIX_INVALID_REASONS) return [...reasons];
  const shown = reasons.slice(0, MAX_MATRIX_INVALID_REASONS);
  const omitted = reasons.length - MAX_MATRIX_INVALID_REASONS;
  shown.push(matrixInvalid(`${omitted} more entries`));
  return shown;
}

function matrixInvalid(entry: string): string {
  return `${MATRIX_INVALID_PREFIX} ${entry}`;
}

function isMissingFile(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if ('code' in error) {
    const code = error.code;
    if (code === 'ENOENT' || code === 'FileNotFound') return true;
  }
  return error instanceof Error && error.name.startsWith('EntryNotFound');
}

function errorFacts(error: unknown): LaneRoutingLogMeta {
  const facts: LaneRoutingLogMeta = {};
  facts['name'] = error instanceof Error ? error.name : 'UnknownError';
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = error.code;
    if (typeof code === 'string') facts['code'] = code;
  }
  return facts;
}
