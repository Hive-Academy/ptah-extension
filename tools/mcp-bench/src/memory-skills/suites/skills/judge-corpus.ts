/**
 * The documents the judge agreement suites judge (benchmark-design.md 4.3):
 *   - the 105 blinded `gt-skill-rubric@v1` documents, exactly as the raters
 *     read them (Batch 9 packet, `documents/<opaqueId>.md`: frontmatter `name`
 *     is the opaque id, references inlined), with their stratum from the
 *     packet's private `id-map.json`;
 *   - the 10 committed planted negatives (`planted-negatives.v1/`).
 *
 * The packet lives in the bench data folder and is private: the plan copies
 * the documents folder and `id-map.json` into the bench host's isolated home
 * (`directory`/`file` fixtures) and this module reads only those copies. Every
 * document's sha256 is checked against the id-map (packet) or `index.json`
 * (planted negatives), so the judge reads byte for byte what the labels
 * describe; any mismatch throws.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

import { compareCodeUnits } from '../../../utils/compare-code-units';
import { sha256HexSchema } from '../../ground-truth/label-schemas';
import {
  parseSkillMarkdown,
  yamlScalarText,
} from '../../labelling/build-labelling-packet';
import {
  RUBRIC_STRATA,
  type RubricStratum,
} from '../../labelling/select-rubric-sample';

/** Prefix of a planted negative's id; never collides with `SKD-` ids. */
export const PLANTED_ID_PREFIX = 'planted/';

export interface JudgeDocument {
  /** `SKD-…` for a labelled document, `planted/pn-NN` for a planted negative. */
  readonly opaqueId: string;
  readonly source: 'labelled' | 'planted-negative';
  /** Packet stratum; `null` for a planted negative. */
  readonly stratum: RubricStratum | null;
  readonly name: string;
  readonly description: string;
  /** Everything after the frontmatter: the body the judge receives. */
  readonly body: string;
  /** sha256 of the whole file. */
  readonly sha256: string;
  /** Characters of {@link body}: the score-by-length baseline. */
  readonly bodyChars: number;
  /** Absolute path of the file (the candidate row's `bodyPath`). */
  readonly path: string;
}

export interface JudgeCorpusPaths {
  readonly documentsDir: string;
  readonly idMapFile: string;
  readonly plantedNegativesDir: string;
}

/** Only the two id-map fields used here; slugs and candidate ids are dropped. */
const idMapSchema = z.record(
  z.string().regex(/^SKD-[0-9a-f]{8}$/),
  z.object({ stratum: z.enum(RUBRIC_STRATA), sha256: sha256HexSchema }),
);

const plantedIndexSchema = z.object({
  schemaVersion: z.literal(1),
  documents: z
    .array(
      z.object({
        file: z.string().regex(/^[a-z0-9-]+\.md$/),
        kind: z.string().min(1),
        sha256: sha256HexSchema,
      }),
    )
    .min(1),
});

export class JudgeCorpusError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JudgeCorpusError';
  }
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch (error: unknown) {
    throw new JudgeCorpusError(
      `${path} is not readable JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function documentOf(
  path: string,
  expectedSha256: string,
  identity: Pick<JudgeDocument, 'opaqueId' | 'source' | 'stratum'>,
): JudgeDocument {
  const bytes = readFileSync(path);
  const actual = sha256(bytes);
  if (actual !== expectedSha256) {
    throw new JudgeCorpusError(
      `${identity.opaqueId}: sha256 ${actual} differs from the recorded ${expectedSha256}`,
    );
  }
  const parsed = parseSkillMarkdown(bytes.toString('utf8'));
  const name = yamlScalarText(parsed.keys.get('name') ?? '');
  if (name.length === 0) {
    throw new JudgeCorpusError(`${identity.opaqueId}: no frontmatter name`);
  }
  if (identity.source === 'labelled' && name !== identity.opaqueId) {
    throw new JudgeCorpusError(
      `${identity.opaqueId}: frontmatter name ${name} is not the opaque id (not a blinded packet document)`,
    );
  }
  return {
    ...identity,
    name,
    description: yamlScalarText(parsed.keys.get('description') ?? ''),
    body: parsed.body,
    sha256: actual,
    bodyChars: parsed.body.length,
    path,
  };
}

/** Labelled documents first (by opaque id), then the planted negatives (by file). */
export function loadJudgeCorpus(paths: JudgeCorpusPaths): JudgeDocument[] {
  const idMap = idMapSchema.safeParse(readJson(paths.idMapFile));
  if (!idMap.success) {
    throw new JudgeCorpusError(
      `${paths.idMapFile} is invalid: ${z.prettifyError(idMap.error)}`,
    );
  }
  const ids = Object.keys(idMap.data).sort(compareCodeUnits);
  const files = readdirSync(paths.documentsDir)
    .filter((name) => name.endsWith('.md'))
    .map((name) => name.slice(0, -'.md'.length))
    .sort(compareCodeUnits);
  if (files.join('\n') !== ids.join('\n')) {
    throw new JudgeCorpusError(
      `${paths.documentsDir} holds ${files.length} documents, the id-map lists ${ids.length}; they must be the same set`,
    );
  }
  const labelled = ids.map((opaqueId) => {
    const entry = idMap.data[opaqueId];
    return documentOf(
      join(paths.documentsDir, `${opaqueId}.md`),
      entry.sha256,
      {
        opaqueId,
        source: 'labelled',
        stratum: entry.stratum,
      },
    );
  });

  const index = plantedIndexSchema.safeParse(
    readJson(join(paths.plantedNegativesDir, 'index.json')),
  );
  if (!index.success) {
    throw new JudgeCorpusError(
      `planted-negatives index.json is invalid: ${z.prettifyError(index.error)}`,
    );
  }
  const planted = [...index.data.documents]
    .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))
    .map((entry) =>
      documentOf(join(paths.plantedNegativesDir, entry.file), entry.sha256, {
        opaqueId: `${PLANTED_ID_PREFIX}${entry.file.slice(0, -'.md'.length)}`,
        source: 'planted-negative',
        stratum: null,
      }),
    );
  return [...labelled, ...planted];
}
