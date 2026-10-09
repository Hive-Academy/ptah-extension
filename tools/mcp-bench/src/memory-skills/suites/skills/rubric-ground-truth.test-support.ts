/**
 * Spec support for the Batch 21 suites: writes a SYNTHETIC `gt-skill-rubric@v1`
 * (labels CSV, adjudication CSV, docs JSON, MANIFEST.json) into a spec temp
 * dir. Nothing here is a real label; the real CSVs do not exist yet (U1).
 */

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { RubricStratum } from '../../labelling/select-rubric-sample';
import {
  ADJUDICATION_COLUMNS,
  FIXTURE_MANIFEST_FILE,
  LABEL_COLUMNS,
  SKILL_ADJUDICATION_FILE,
  SKILL_DOCS_FILE,
  SKILL_LABELS_FILE,
} from './rubric-ground-truth';

const RATED_AT = '2026-10-20T00:00:00.000Z';

/** One synthetic labelled document: what each rater gave it. */
export interface SyntheticDoc {
  readonly opaqueId: string;
  readonly sha256: string;
  readonly stratum?: RubricStratum;
  readonly anchor471Total?: number;
  /** Totals of rater r1 and r2 (0..80); criteria are spread evenly. */
  readonly totals: readonly [number, number];
  /** An adjudicated total, when the raters disagree. */
  readonly adjudicatedTotal?: number;
}

/** Eight 0..10 criteria summing to `total`, spread as evenly as possible. */
export function criteriaFor(total: number): number[] {
  const base = Math.floor(total / 8);
  const extra = total - base * 8;
  return Array.from(
    { length: 8 },
    (_, index) => base + (index < extra ? 1 : 0),
  );
}

/** The rubric pass rule (label-schemas.ts): total >= 64, no criterion < 6. */
export function passFor(total: number): boolean {
  const criteria = criteriaFor(total);
  return total >= 64 && criteria.every((criterion) => criterion >= 6);
}

function scoreCells(total: number): string[] {
  return [
    ...criteriaFor(total).map(String),
    String(total),
    String(passFor(total)),
  ];
}

export function sha256Of(text: string | Buffer): string {
  return createHash('sha256').update(text).digest('hex');
}

export interface WrittenGroundTruth {
  readonly files: Record<string, string>;
}

/**
 * Write the three files and a manifest pinning them. `pin: false` writes a
 * manifest without the label files (unrecorded); `omit` leaves files out.
 */
export function writeSyntheticGroundTruth(
  dir: string,
  docs: readonly SyntheticDoc[],
  options: { readonly pin?: boolean; readonly raters?: [string, string] } = {},
): WrittenGroundTruth {
  const [r1, r2] = options.raters ?? ['r1', 'r2'];
  mkdirSync(dir, { recursive: true });
  const labels = [
    LABEL_COLUMNS.join(','),
    ...docs.flatMap((doc) => [
      [doc.opaqueId, r1, ...scoreCells(doc.totals[0]), RATED_AT].join(','),
      [doc.opaqueId, r2, ...scoreCells(doc.totals[1]), RATED_AT].join(','),
    ]),
  ].join('\n');
  const adjudication = [
    ADJUDICATION_COLUMNS.join(','),
    ...docs
      .filter((doc) => doc.adjudicatedTotal !== undefined)
      .map((doc) => {
        const [a, b] = doc.totals;
        const triggers = [
          ...(passFor(a) !== passFor(b) ? ['pass-fail-differs'] : []),
          ...(Math.abs(a - b) > 12 ? ['totals-differ'] : []),
        ];
        return [
          doc.opaqueId,
          'r3',
          ...scoreCells(doc.adjudicatedTotal ?? 0),
          triggers.join(';'),
          RATED_AT,
        ].join(',');
      }),
  ].join('\n');
  const skillDocs = `${JSON.stringify(
    {
      schemaVersion: 1,
      documents: docs.map((doc) => ({
        opaqueId: doc.opaqueId,
        sha256: doc.sha256,
        ...(doc.stratum === undefined ? {} : { stratum: doc.stratum }),
        ...(doc.anchor471Total === undefined
          ? {}
          : { anchor471Total: doc.anchor471Total }),
      })),
    },
    null,
    2,
  )}\n`;
  const files: Record<string, string> = {
    [SKILL_LABELS_FILE]: `${labels}\n`,
    [SKILL_ADJUDICATION_FILE]: `${adjudication}\n`,
    [SKILL_DOCS_FILE]: skillDocs,
  };
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(dir, name), text, 'utf8');
  }
  const pinned =
    options.pin === false
      ? {}
      : Object.fromEntries(
          Object.entries(files).map(([name, text]) => [name, sha256Of(text)]),
        );
  writeFileSync(
    join(dir, FIXTURE_MANIFEST_FILE),
    `${JSON.stringify({ schemaVersion: 1, files: pinned }, null, 2)}\n`,
    'utf8',
  );
  return { files };
}

/**
 * Ten anchors, two authored, two fallback, two random: the smallest set whose
 * trust bar can hold (anchor stability needs exactly ten anchor documents).
 * Totals rise with the index, raters agree within 2 points, so every
 * agreement statistic is high.
 */
export function trustedDocs(
  shaOf: (opaqueId: string) => string,
): SyntheticDoc[] {
  const plan: { stratum: RubricStratum; total: number }[] = [
    { stratum: 'authored', total: 72 },
    { stratum: 'authored', total: 70 },
    { stratum: 'fallback', total: 8 },
    { stratum: 'fallback', total: 10 },
    { stratum: 'random', total: 30 },
    { stratum: 'random', total: 66 },
    ...Array.from({ length: 10 }, (_, index) => ({
      stratum: 'anchor-471' as RubricStratum,
      total: 12 + index * 5,
    })),
  ];
  return plan.map((entry, index) => {
    const opaqueId = `SKD-${(index + 1).toString(16).padStart(8, '0')}`;
    return {
      opaqueId,
      sha256: shaOf(opaqueId),
      stratum: entry.stratum,
      ...(entry.stratum === 'anchor-471'
        ? { anchor471Total: entry.total + 3 }
        : {}),
      totals: [entry.total, entry.total + (index % 2 === 0 ? 1 : 0)],
    };
  });
}
