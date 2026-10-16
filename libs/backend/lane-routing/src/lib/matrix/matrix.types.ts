import type { OutcomeTaskKind } from '@ptah-extension/shared';

/**
 * Capability matrix (part A §3, Requirement 6).
 *
 * One profile per lane family and model. A profile whose model is
 * `FAMILY_PROFILE_MODEL` is the family-level profile, used when the chosen
 * model is `lane-default`, an automatic entry, or a model with no profile of
 * its own (Requirement 11.3). Every profile holds one cell per task kind.
 * A cell is `unknown` or an evidenced value with its provenance.
 */

/** Model key of the family-level profile. */
export const FAMILY_PROFILE_MODEL = '*';

/**
 * Where a value came from. Resolution precedence is user, then local, then
 * seed (Requirement 6 preamble).
 */
export const MATRIX_CELL_SOURCES = ['seed', 'user', 'local'] as const;

export type MatrixCellSource = (typeof MATRIX_CELL_SOURCES)[number];

/** Version of the serialized matrix shape. */
export const CAPABILITY_MATRIX_VERSION = 1;

export interface UnknownMatrixCell {
  readonly kind: 'unknown';
}

export interface ValueMatrixCell {
  readonly kind: 'value';
  /** Integer on the routing score scale (`SCORE_MIN`..`SCORE_MAX`). */
  readonly score: number;
  readonly source: MatrixCellSource;
  /**
   * Dataset or URL the value was taken from (Requirement 6.2). Required for
   * `seed`; optional for `user`; absent for `local`, whose evidence is the
   * outcome records counted in `sampleCount`.
   */
  readonly sourceRef?: string;
  /**
   * ISO date (`YYYY-MM-DD`) or ISO date-time. Seed: the result's publication
   * date. Local: the newest contributing outcome record.
   */
  readonly asOf: string;
  /** `now - asOf > STALENESS_AGE_MS` when the cell was built. */
  readonly stale: boolean;
  /** What the value measures, when narrower than the task kind. */
  readonly note?: string;
  /** Verified runs behind a `local` value; only `local` cells carry it. */
  readonly sampleCount?: number;
}

export type MatrixCell = UnknownMatrixCell | ValueMatrixCell;

/** One cell per task kind; a missing kind is a malformed profile. */
export type MatrixCells = Readonly<Record<OutcomeTaskKind, MatrixCell>>;

export interface MatrixProfileKey {
  /** Lane family as `laneFamilyOf` returns it (`@ptah-extension/shared`). */
  readonly family: string;
  /** Model id as the lane lists it, or `FAMILY_PROFILE_MODEL`. */
  readonly model: string;
}

export interface MatrixProfile extends MatrixProfileKey {
  readonly cells: MatrixCells;
}

export interface CapabilityMatrix {
  readonly version: typeof CAPABILITY_MATRIX_VERSION;
  readonly profiles: readonly MatrixProfile[];
}
