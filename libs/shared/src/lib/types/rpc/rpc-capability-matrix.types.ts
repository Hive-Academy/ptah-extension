/**
 * Capability-matrix wire contract (routing learning, item 7).
 *
 * `agent:getCapabilityMatrix` is the read-only Electron settings table. It
 * carries family, model and per-kind cells only: no prompts, paths or
 * outcome text. An unknown cell is `{ kind: 'unknown' }` so the page can
 * show "unrated" instead of a neutral score.
 */

import type { OutcomeTaskKind } from '../lane-outcome.types';

/** The three sources the matrix store merges, in the same names. */
export const CAPABILITY_MATRIX_CELL_SOURCES = ['seed', 'user', 'local'] as const;

export type CapabilityMatrixCellSource =
  (typeof CAPABILITY_MATRIX_CELL_SOURCES)[number];

/** The read takes no parameters. */
export type AgentGetCapabilityMatrixParams = Record<string, never>;

/** A cell with no merged value. The page renders this as "unrated". */
export interface AgentCapabilityMatrixUnknownCell {
  readonly kind: 'unknown';
}

/** One evidenced cell. `sampleCount` is null when the source did not count runs. */
export interface AgentCapabilityMatrixValueCell {
  readonly kind: 'value';
  readonly score: number;
  readonly source: CapabilityMatrixCellSource;
  readonly sourceRef: string | null;
  readonly asOf: string;
  readonly stale: boolean;
  readonly sampleCount: number | null;
  readonly note?: string;
}

export type AgentCapabilityMatrixCell =
  | AgentCapabilityMatrixUnknownCell
  | AgentCapabilityMatrixValueCell;

/** One family and model, with one cell for every task kind. */
export interface AgentCapabilityMatrixProfile {
  readonly family: string;
  readonly model: string;
  readonly cells: Readonly<Record<OutcomeTaskKind, AgentCapabilityMatrixCell>>;
}

/** Result of `agent:getCapabilityMatrix`. */
export interface AgentGetCapabilityMatrixResult {
  readonly profiles: readonly AgentCapabilityMatrixProfile[];
  /** Most recent selected executor for each routing key, oldest first. */
  readonly lastPicks?: readonly { readonly key: string; readonly candidateId: string }[];
  readonly lastPicksUnavailable?: boolean;
}
