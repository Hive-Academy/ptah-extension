/**
 * `skill.namer.collisions` (benchmark-design.md:83, :290): the slug collision
 * rate on the frozen candidate copy taken on 2026-10-06.
 *
 * The CandidateNamerService of 461 was deleted (commit 625b3861c, "drop
 * namer"). A candidate's directory name is now chosen by
 * `SkillMdGenerator.writeCandidate` (`skill-md-generator.ts:169-172`,
 * `:270-292`): the sanitized slug when it is free, else `<slug>-2` … `<slug>-5`,
 * else a refusal. A collision is a directory the generator had to suffix.
 *
 * Real product path: the suffix grammar is not copied from the generator. The
 * suite PROBES the real `writeCandidate` in a scratch folder with a synthetic
 * slug until it refuses, and classifies the frozen names with the suffixes the
 * generator actually produced. The frozen names themselves are never routed
 * through the generator: it logs every slug it writes at `info`, and the
 * frozen slugs are derived from the user's first messages, so they must not
 * reach any log.
 *
 * Privacy: the frozen copy is private user data. It is read only from the
 * COPY the host seeded into its isolated home, checked file by file against
 * the freeze manifest before anything is counted. Only counts leave this
 * module: no directory name, body or path appears in a case, a metric, a
 * detail or an error message.
 *
 * Verdict: always `na`. The design sets no threshold ("collision rate
 * reported", :83), and the frozen names are the namer's own output, so there is
 * no ground truth independent of it and no named baseline. The numbers are in
 * `metrics` and `details`.
 */

import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import type {
  MaterializedSkill,
  SkillMdInput,
} from '@ptah-extension/skill-synthesis';
import { z } from 'zod';

import {
  CandidateManifestSchema,
  FROZEN_CANDIDATES_MANIFEST_SHA256,
  FROZEN_CANDIDATES_NAME,
  compareCodePoints,
  computeManifestSha256,
  sha256,
} from '../../data/verify-candidate-manifest';
import { sha256HexSchema } from '../../ground-truth/label-schemas';
import {
  funnelDetailsSchema,
  type FunnelDetails,
} from '../../memory-skills-suite-kinds';
import { rate } from '../../metrics/curation-metrics';
import type { CaseRecord, SuiteResultInput } from '../../runner/suite-result';
import {
  costOf,
  inputSha256,
  rateMetrics,
  resolveHomeFile,
} from '../memory/memory-suite-support';

export const NAMER_COLLISIONS_SUITE_ID = 'skill.namer.collisions';

/** A slug the generator keeps as-is: lower-case, digits and single dashes. */
export const NAMER_PROBE_SLUG = 'namer-probe';

/**
 * Upper bound on probe writes. The generator refuses after 5 today; a bound
 * keeps a generator that never refuses from looping forever.
 */
export const NAMER_PROBE_MAX_WRITES = 32;

/** The generator's refusal (`skill-md-generator.ts:287-289`). */
const REFUSAL_MARKER = 'slug collision';

export const NAMER_COLLISIONS_NA_REASON =
  'report-only: benchmark-design.md:83 sets no threshold, and the frozen names are the namer output (no independent ground truth, no named baseline)';

export const namerCollisionsOptionsSchema = z
  .strictObject({
    /** Folder name of the copy; the manifest is `<snapshotName>.manifest.json` beside it. */
    snapshotName: z
      .string()
      .regex(/^[A-Za-z0-9._-]+$/, 'a plain folder name')
      .default(FROZEN_CANDIDATES_NAME),
    /** Home-relative folder the plan seeds the copy and its manifest into. */
    snapshotsDir: z.string().min(1).default('snapshots'),
    /** The freeze manifest's `manifestSha256`; the copy must carry exactly it. */
    expectedManifestSha256: sha256HexSchema.default(
      FROZEN_CANDIDATES_MANIFEST_SHA256,
    ),
  })
  .prefault({});
export type NamerCollisionsOptions = z.infer<
  typeof namerCollisionsOptionsSchema
>;

/** The surface of the real `SkillMdGenerator` the probe calls. */
export interface CandidateWriter {
  writeCandidate(
    input: SkillMdInput,
    candidatesDir?: string,
  ): MaterializedSkill;
}

// ------------------------------------------------------------ frozen copy

export interface FrozenCopy {
  /** Top-level directory names: one per candidate. Never leaves this module. */
  readonly names: readonly string[];
  readonly files: number;
  readonly manifestSha256: string;
}

interface Walk {
  readonly files: string[];
  readonly topLevelDirs: string[];
  nonRegular: number;
}

function walkCopy(root: string): Walk {
  const walk: Walk = { files: [], topLevelDirs: [], nonRegular: 0 };
  const visit = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        if (prefix === '') walk.topLevelDirs.push(entry.name);
        visit(join(dir, entry.name), rel);
      } else if (entry.isFile()) {
        walk.files.push(rel);
      } else {
        walk.nonRegular += 1;
      }
    }
  };
  visit(root, '');
  return walk;
}

/**
 * Check the seeded copy against its freeze manifest: the manifest hash
 * (recomputed and pinned), every file hash, no missing or unlisted file, the
 * directory count. Throws with counts only: a path would name user data.
 */
export function readFrozenCopy(
  copyDir: string,
  manifestPath: string,
  expectedManifestSha256: string,
): FrozenCopy {
  const manifest = CandidateManifestSchema.parse(
    JSON.parse(readFileSync(manifestPath, 'utf8')),
  );
  const recomputed = computeManifestSha256(manifest.files_sha256);
  if (recomputed !== manifest.manifestSha256) {
    throw new Error(
      'the candidate manifest is inconsistent: its manifestSha256 does not match its file hashes',
    );
  }
  if (manifest.manifestSha256 !== expectedManifestSha256) {
    throw new Error(
      `the candidate manifest is not the frozen one: ${manifest.manifestSha256.slice(0, 12)}… is not ${expectedManifestSha256.slice(0, 12)}…`,
    );
  }
  const walk = walkCopy(copyDir);
  const listed = new Set(Object.keys(manifest.files_sha256));
  const onDisk = new Set(walk.files);
  const missing = [...listed].filter((rel) => !onDisk.has(rel)).length;
  const unlisted = walk.files.filter((rel) => !listed.has(rel)).length;
  let changed = 0;
  for (const rel of walk.files) {
    const expected = manifest.files_sha256[rel];
    if (expected === undefined) continue;
    if (sha256(readFileSync(join(copyDir, ...rel.split('/')))) !== expected) {
      changed += 1;
    }
  }
  const dirMismatch = walk.topLevelDirs.length !== manifest.dirs;
  if (
    missing + unlisted + changed + walk.nonRegular > 0 ||
    dirMismatch ||
    listed.size !== manifest.files
  ) {
    throw new Error(
      `the candidate copy does not match its freeze manifest: ${missing} missing, ${unlisted} unlisted, ${changed} changed, ` +
        `${walk.nonRegular} non-regular, ${walk.topLevelDirs.length} of ${manifest.dirs} dirs, ${listed.size} of ${manifest.files} listed files`,
    );
  }
  return {
    names: [...walk.topLevelDirs].sort(compareCodePoints),
    files: walk.files.length,
    manifestSha256: manifest.manifestSha256,
  };
}

// ------------------------------------------------------------ probe

export interface SlugGrammar {
  /** Suffixes the generator appended, in the order it tried them. */
  readonly suffixes: readonly string[];
  /** Directories one base slug can occupy before a refusal; `null` when it never refused. */
  readonly maxPerBase: number | null;
  /** Successful writes the probe made. */
  readonly writes: number;
}

/**
 * Write {@link NAMER_PROBE_SLUG} through the real generator into an empty
 * scratch folder until it refuses, and read the suffix grammar off the slugs
 * it chose. Only the synthetic probe slug is ever written or logged.
 */
export function probeSlugGrammar(
  writer: CandidateWriter,
  scratchParent: string,
): SlugGrammar {
  const scratch = mkdtempSync(join(scratchParent, 'namer-probe-'));
  try {
    const chosen: string[] = [];
    let refused = false;
    while (chosen.length < NAMER_PROBE_MAX_WRITES) {
      try {
        chosen.push(
          writer.writeCandidate(
            {
              slug: NAMER_PROBE_SLUG,
              description: 'Synthetic namer probe.',
              body: 'Synthetic namer probe.',
            },
            scratch,
          ).slug,
        );
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        // Anything other than the generator's own refusal is a real failure.
        if (!message.includes(REFUSAL_MARKER)) throw error;
        refused = true;
        break;
      }
    }
    if (chosen[0] !== NAMER_PROBE_SLUG) {
      throw new Error(
        `the generator did not keep the canonical probe slug ${NAMER_PROBE_SLUG} on an empty root (chose ${chosen[0] ?? 'nothing'})`,
      );
    }
    const suffixes = chosen.slice(1).map((slug) => {
      if (!slug.startsWith(NAMER_PROBE_SLUG) || slug === NAMER_PROBE_SLUG) {
        throw new Error(
          `the generator chose ${slug} for a taken ${NAMER_PROBE_SLUG}; not a suffix of it`,
        );
      }
      return slug.slice(NAMER_PROBE_SLUG.length);
    });
    if (new Set(suffixes).size !== suffixes.length) {
      throw new Error('the generator repeated a suffix for one base slug');
    }
    return {
      suffixes,
      maxPerBase: refused ? chosen.length : null,
      writes: chosen.length,
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

// ------------------------------------------------------------ classification

export interface CollisionCounts {
  readonly dirs: number;
  /** Directories that are a probed suffix of another directory in the copy. */
  readonly collided: number;
  /** Distinct base slugs (a base and its suffixed directories count once). */
  readonly baseGroups: number;
  readonly groupsWithCollision: number;
  readonly largestGroup: number;
  /** Groups as large as the generator allows: the next same-base candidate is refused. */
  readonly fullGroups: number;
  /** Groups larger than the generator allows: names the probed grammar cannot explain. */
  readonly groupsOverLimit: number;
  /** Suffix-shaped names whose base is not in the copy: not attributable. */
  readonly suffixShapedNoBase: number;
  /** Collided directories whose SKILL.md body equals their base's: one work drafted twice. */
  readonly sameBodyAsBase: number;
  /** Collided directories where either SKILL.md is missing, so the bodies were not compared. */
  readonly collidedWithoutBody: number;
}

/**
 * Count collisions among `names` with the probed grammar. `bodyHashOf`
 * returns the sha256 of a directory's SKILL.md body after the frontmatter, or
 * `null` when it has none; it is called only for collided directories and
 * their bases.
 */
export function classifyCollisions(
  names: readonly string[],
  grammar: SlugGrammar,
  bodyHashOf: (name: string) => string | null,
): CollisionCounts {
  const present = new Set(names);
  const pairs: { name: string; base: string }[] = [];
  let suffixShapedNoBase = 0;
  for (const name of names) {
    let base: string | null = null;
    let suffixShaped = false;
    for (const suffix of grammar.suffixes) {
      if (name.length > suffix.length && name.endsWith(suffix)) {
        suffixShaped = true;
        const candidate = name.slice(0, -suffix.length);
        if (present.has(candidate)) {
          base = candidate;
          break;
        }
      }
    }
    if (base !== null) pairs.push({ name, base });
    else if (suffixShaped) suffixShapedNoBase += 1;
  }
  // A group is a base slug and the directories suffixed from it. A collided
  // directory is a group of its own only when something was suffixed from it
  // in turn (`x-2` taken, so `x-2-2`), which is why groups may overlap.
  const collided = new Set(pairs.map((pair) => pair.name));
  const bases = new Set(pairs.map((pair) => pair.base));
  const groupSize = new Map<string, number>();
  for (const name of names) {
    if (!collided.has(name) || bases.has(name)) groupSize.set(name, 1);
  }
  for (const { base } of pairs) {
    groupSize.set(base, (groupSize.get(base) ?? 1) + 1);
  }
  const sizes = [...groupSize.values()];
  const limit = grammar.maxPerBase;
  const bodies = new Map<string, string | null>();
  const body = (name: string): string | null => {
    if (!bodies.has(name)) bodies.set(name, bodyHashOf(name));
    return bodies.get(name) ?? null;
  };
  let sameBodyAsBase = 0;
  let collidedWithoutBody = 0;
  for (const { name, base } of pairs) {
    const mine = body(name);
    const theirs = body(base);
    if (mine === null || theirs === null) collidedWithoutBody += 1;
    else if (mine === theirs) sameBodyAsBase += 1;
  }
  return {
    dirs: names.length,
    collided: pairs.length,
    baseGroups: groupSize.size,
    groupsWithCollision: sizes.filter((size) => size > 1).length,
    largestGroup: sizes.reduce((max, size) => Math.max(max, size), 0),
    fullGroups:
      limit === null ? 0 : sizes.filter((size) => size === limit).length,
    groupsOverLimit:
      limit === null ? 0 : sizes.filter((size) => size > limit).length,
    suffixShapedNoBase,
    sameBodyAsBase,
    collidedWithoutBody,
  };
}

/** `text` without a leading `---` … `---` frontmatter block. */
function stripFrontmatter(text: string): string {
  const lines = text.replaceAll('\r\n', '\n').split('\n');
  if (lines[0]?.trimEnd() !== '---') return text;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trimEnd() === '---') return lines.slice(i + 1).join('\n');
  }
  return text;
}

/** sha256 of `<copyDir>/<name>/SKILL.md` after its frontmatter; `null` when absent. */
export function skillBodyHash(copyDir: string, name: string): string | null {
  let raw: string;
  try {
    raw = readFileSync(join(copyDir, name, 'SKILL.md'), 'utf8');
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  return createHash('sha256')
    .update(stripFrontmatter(raw).trim())
    .digest('hex');
}

// ------------------------------------------------------------ result

export function namerCollisionMetrics(
  counts: CollisionCounts,
  grammar: SlugGrammar,
): Record<string, number | null> {
  return {
    dirs: counts.dirs,
    collided: counts.collided,
    ...rateMetrics('slugCollisionRate', rate(counts.collided, counts.dirs)),
    ...rateMetrics(
      'selfCollisionShare',
      rate(counts.sameBodyAsBase, counts.collided),
    ),
    baseGroups: counts.baseGroups,
    groupsWithCollision: counts.groupsWithCollision,
    largestGroup: counts.largestGroup,
    fullGroups: counts.fullGroups,
    groupsOverLimit: counts.groupsOverLimit,
    suffixShapedNoBase: counts.suffixShapedNoBase,
    collidedWithoutBody: counts.collidedWithoutBody,
    'probe.maxPerBase': grammar.maxPerBase,
    'probe.suffixes': grammar.suffixes.length,
  };
}

export interface NamerCollisionsInput {
  /** The bench host's isolated home: the copy, the manifest and the probe scratch live here. */
  readonly home: string;
  readonly options: unknown;
  /** The real `SkillMdGenerator` (resolved from the host container). */
  readonly writer: CandidateWriter;
}

function record(
  caseId: string,
  input: unknown,
  expected: string,
  observed: string,
  pass: boolean,
  latencyMs: number,
): CaseRecord {
  return {
    caseId,
    inputSha256: inputSha256(input),
    expected,
    observed,
    outcome: pass ? 'pass' : 'fail',
    cassetteKey: null,
    latencyMs,
    error: null,
  };
}

export function runNamerCollisions(input: NamerCollisionsInput): {
  result: SuiteResultInput;
  cases: CaseRecord[];
} {
  const options = namerCollisionsOptionsSchema.parse(input.options);
  const copyDir = resolveHomeFile(
    input.home,
    `${options.snapshotsDir}/${options.snapshotName}`,
  );
  const manifestPath = resolveHomeFile(
    input.home,
    `${options.snapshotsDir}/${options.snapshotName}.manifest.json`,
  );

  let started = performance.now();
  const copy = readFrozenCopy(
    copyDir,
    manifestPath,
    options.expectedManifestSha256,
  );
  const verifyMs = performance.now() - started;

  started = performance.now();
  const grammar = probeSlugGrammar(input.writer, input.home);
  const probeMs = performance.now() - started;

  started = performance.now();
  const counts = classifyCollisions(copy.names, grammar, (name) =>
    skillBodyHash(copyDir, name),
  );
  const classifyMs = performance.now() - started;

  const subject = {
    snapshot: options.snapshotName,
    manifestSha256: copy.manifestSha256,
  };
  const limitText =
    grammar.maxPerBase === null
      ? 'no refusal within the probe bound'
      : `refused after ${grammar.maxPerBase}`;
  const cases: CaseRecord[] = [
    record(
      'frozen-copy/manifest',
      { ...subject, check: 'manifest' },
      `every file matches freeze manifest ${copy.manifestSha256.slice(0, 12)}…`,
      `${copy.files} files in ${counts.dirs} candidate dirs verified`,
      true,
      verifyMs,
    ),
    record(
      'probe/slug-grammar',
      { ...subject, check: 'probe', slug: NAMER_PROBE_SLUG },
      'a taken slug is suffixed, then refused (skill-md-generator.ts:283-292)',
      `base kept, suffixes ${grammar.suffixes.join(', ') || 'none'}, ${limitText}`,
      grammar.maxPerBase !== null && grammar.suffixes.length > 0,
      probeMs,
    ),
    record(
      'invariant/group-size-within-retry-limit',
      { ...subject, check: 'group-size', maxPerBase: grammar.maxPerBase },
      'no base slug occupies more directories than the generator allows',
      `${counts.groupsOverLimit} of ${counts.baseGroups} base slugs over the limit (largest ${counts.largestGroup})`,
      counts.groupsOverLimit === 0,
      classifyMs,
    ),
  ];

  const slugCollisionRate = rate(counts.collided, counts.dirs);
  const details: FunnelDetails = funnelDetailsSchema.parse({
    fixtureId: options.snapshotName,
    stages: [
      {
        stage: 'draft',
        in: counts.dirs,
        out: counts.baseGroups,
        invariants: [
          {
            id: 'group-size-within-retry-limit',
            pass: counts.groupsOverLimit === 0,
            violations: counts.groupsOverLimit,
            exampleIds: [],
          },
        ],
      },
    ],
    slugCollisionRate: slugCollisionRate.value,
  });

  return {
    cases,
    result: {
      suiteId: NAMER_COLLISIONS_SUITE_ID,
      kind: 'funnel',
      details,
      claim: {
        source: 'code',
        ref: 'libs/backend/skill-synthesis/src/lib/skill-md-generator.ts:169-172',
        text: 'A candidate whose slug is taken is written as -2 … -5, then refused.',
      },
      groundTruth: {
        id: options.snapshotName,
        version: `manifest-${copy.manifestSha256.slice(0, 12)}`,
        method: 'generated',
      },
      baselines: [],
      deltas: {},
      cost: costOf(cases, grammar.writes),
      modelCalls: 0,
      verdict: 'na',
      naReason: NAMER_COLLISIONS_NA_REASON,
      metrics: namerCollisionMetrics(counts, grammar),
      cassetteVersion: null,
    },
  };
}
