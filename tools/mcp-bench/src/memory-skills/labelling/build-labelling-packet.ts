import { existsSync } from 'node:fs';
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, posix } from 'node:path';
import {
  assertSafeBenchDataDir,
  compareCodePoints,
  sha256,
  type BenchDataDirGuardOptions,
} from '../data/verify-candidate-manifest';
import {
  SKILLS_PREFIX,
  type GitTreeReader,
  type RubricSample,
  type RubricStratum,
  type SampledDocument,
  type SuggestionRow,
} from './select-rubric-sample';

/** Packet location under the bench data dir (never the repository; R2). */
export const PACKET_RELATIVE_DIR = join('labelling', 'skill-rubric-v1');

/** Columns of the rater CSV; the committed rubric row has no `note` column (R2). */
export const RATER_CSV_COLUMNS = [
  'opaqueId',
  'raterId',
  'c1',
  'c2',
  'c3',
  'c4',
  'c5',
  'c6',
  'c7',
  'c8',
  'total',
  'pass',
  'ratedAt',
] as const;
export const NOTES_CSV_COLUMNS = ['opaqueId', 'raterId', 'note'] as const;

/** Fixed separator before the inlined reference files, written for every document. */
export const REFERENCES_SEPARATOR =
  '<!-- ===== REFERENCE FILES (inlined for labelling) ===== -->';
export const NO_REFERENCES_LINE = '_No reference files._';

/** Frontmatter keys kept in a rendered document; any other key may reveal provenance. */
const KEPT_FRONTMATTER_KEYS = ['description', 'when_to_use'] as const;
/** Reference folders inlined from a repository skill. */
const REFERENCE_DIRS = ['references', 'reference'] as const;
const OPAQUE_PREFIX = 'SKD-';

export interface PacketDocumentSource {
  /** Raw SKILL.md text (or the suggestion body), before rendering. */
  skillMd: string;
  /** Description from the DB when the text has no frontmatter (suggestions). */
  fallbackDescription?: string;
  references: { name: string; content: string }[];
}

/** Resolves a sampled document to its raw text. */
export type DocumentReader = (
  doc: SampledDocument,
) => Promise<PacketDocumentSource>;

export interface BuildPacketOptions {
  benchDataDir: string;
  sample: RubricSample;
  read: DocumentReader;
  raterIds?: readonly string[];
  /** Provenance written to the private packet manifest only. */
  provenance: Record<string, string | number | null>;
  /** Replace an existing packet; refused when any rater CSV already holds scores. */
  overwrite?: boolean;
  guard?: BenchDataDirGuardOptions;
}

export interface IdMapEntry {
  stratum: RubricStratum;
  slug: string;
  sourceKind: SampledDocument['source']['kind'];
  candidateId: string | null;
  suggestionId: string | null;
  cell: string | null;
  anchor471Total: number | null;
  /** sha256 of the rendered document the raters read. */
  sha256: string;
  /** sha256 of the raw source text before rendering. */
  sourceSha256: string;
  referenceFiles: number;
  droppedFrontmatterKeys: string[];
}

export interface PacketResult {
  packetDir: string;
  raterDirs: Record<string, string>;
  raterCsvPaths: Record<string, string>;
  notesCsvPaths: Record<string, string>;
  idMapPath: string;
  manifestPath: string;
  documents: number;
}

/**
 * Writes the blind labelling packet:
 * - `raters/rater-<id>/` per rater: `INSTRUCTIONS.md`, `rater-<id>.csv`,
 *   `notes-<id>.csv` and `documents/<opaqueId>.md` (rater-visible);
 * - `private/id-map.json` and `private/packet-manifest.json` (never shown to raters).
 */
export async function buildLabellingPacket(
  options: BuildPacketOptions,
): Promise<PacketResult> {
  const benchDataDir = assertSafeBenchDataDir(
    options.benchDataDir,
    options.guard,
  );
  const raterIds = [...(options.raterIds ?? ['r1', 'r2'])];
  if (raterIds.length < 2)
    throw new Error('A blind packet needs at least two raters');
  for (const id of raterIds) {
    if (!/^[a-z0-9-]{1,32}$/.test(id))
      throw new Error(`Invalid rater id: ${id}`);
  }
  if (new Set(raterIds).size !== raterIds.length)
    throw new Error('Duplicate rater id');
  const { sample } = options;
  if (sample.documents.length === 0)
    throw new Error('The sample has no documents');

  const packetDir = join(benchDataDir, PACKET_RELATIVE_DIR);
  await assertReplaceable(packetDir, options.overwrite === true);

  const opaqueIds = assignOpaqueIds(
    sample.seed,
    sample.documents.map((d) => d.key),
  );
  const rendered = new Map<string, string>();
  const idMap: Record<string, IdMapEntry> = {};
  for (const doc of sample.documents) {
    const opaqueId = opaqueIds.get(doc.key) ?? '';
    const source = await options.read(doc);
    const { text, droppedKeys } = renderDocument(opaqueId, doc.slug, source);
    rendered.set(opaqueId, text);
    idMap[opaqueId] = {
      stratum: doc.stratum,
      slug: doc.slug,
      sourceKind: doc.source.kind,
      candidateId:
        doc.source.kind === 'candidate' ? doc.source.candidateId : null,
      suggestionId:
        doc.source.kind === 'suggestion' ? doc.source.suggestionId : null,
      cell: doc.cell ?? null,
      anchor471Total: doc.anchor471Total ?? null,
      sha256: sha256(text),
      sourceSha256: sha256(source.skillMd),
      referenceFiles: source.references.length,
      droppedFrontmatterKeys: droppedKeys,
    };
  }

  const ids = [...rendered.keys()].sort(compareCodePoints);
  const orders: Record<string, string[]> = {};
  for (const raterId of raterIds)
    orders[raterId] = shuffleForRater(sample.seed, raterId, ids);
  const orderKeys = new Set(Object.values(orders).map((o) => o.join(',')));
  if (ids.length > 2 && orderKeys.size !== raterIds.length) {
    throw new Error('Two raters received the same document order');
  }

  const stagingDir = `${packetDir}.staging-${process.pid}`;
  await rm(stagingDir, { recursive: true, force: true });
  const raterDirs: Record<string, string> = {};
  const raterCsvPaths: Record<string, string> = {};
  const notesCsvPaths: Record<string, string> = {};
  try {
    for (const raterId of raterIds) {
      const rel = join('raters', `rater-${raterId}`);
      const dir = join(stagingDir, rel);
      await mkdir(join(dir, 'documents'), { recursive: true });
      for (const opaqueId of ids) {
        await writeFile(
          join(dir, 'documents', `${opaqueId}.md`),
          rendered.get(opaqueId) ?? '',
          'utf8',
        );
      }
      const order = orders[raterId] ?? [];
      await writeFile(
        join(dir, `rater-${raterId}.csv`),
        raterCsv(raterId, order),
        'utf8',
      );
      await writeFile(
        join(dir, `notes-${raterId}.csv`),
        notesCsv(raterId, order),
        'utf8',
      );
      await writeFile(
        join(dir, 'INSTRUCTIONS.md'),
        instructions(raterId, order.length),
        'utf8',
      );
      raterDirs[raterId] = join(packetDir, rel);
      raterCsvPaths[raterId] = join(packetDir, rel, `rater-${raterId}.csv`);
      notesCsvPaths[raterId] = join(packetDir, rel, `notes-${raterId}.csv`);
    }
    await mkdir(join(stagingDir, 'private'), { recursive: true });
    await writeFile(
      join(stagingDir, 'private', 'id-map.json'),
      stableJson(idMap),
      'utf8',
    );
    await writeFile(
      join(stagingDir, 'private', 'packet-manifest.json'),
      stableJson({
        packet: 'gt-skill-rubric@v1 labelling packet',
        seed: sample.seed,
        shuffle: 'sort by sha256(`${seed}:order:${raterId}:${opaqueId}`)',
        opaqueIds:
          'SKD- + first 8 hex of sha256(`${seed}:opaque:${key}`), uppercased',
        provenance: options.provenance,
        raters: raterIds,
        orders,
        counts: sample.counts,
        shortfalls: sample.shortfalls,
        fallbackIdentifiable: sample.fallbackIdentifiable,
        judgedModelCells: sample.judgedModelCells,
        judgedModelMedianTurns: sample.judgedModelMedianTurns,
        pools: sample.pools,
        notes: sample.notes,
        documents: ids.map((id) => ({
          opaqueId: id,
          sha256: idMap[id]?.sha256 ?? '',
        })),
      }),
      'utf8',
    );
    await rm(packetDir, { recursive: true, force: true });
    await mkdir(dirname(packetDir), { recursive: true });
    await rename(stagingDir, packetDir);
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true });
    throw error;
  }

  return {
    packetDir,
    raterDirs,
    raterCsvPaths,
    notesCsvPaths,
    idMapPath: join(packetDir, 'private', 'id-map.json'),
    manifestPath: join(packetDir, 'private', 'packet-manifest.json'),
    documents: ids.length,
  };
}

/** Opaque ids derived from the seed; extended on a prefix collision. */
export function assignOpaqueIds(
  seed: string,
  keys: readonly string[],
): Map<string, string> {
  for (let length = 8; length <= 64; length += 2) {
    const ids = new Map(
      keys.map((key) => [
        key,
        `${OPAQUE_PREFIX}${sha256(`${seed}:opaque:${key}`).slice(0, length).toUpperCase()}`,
      ]),
    );
    if (new Set(ids.values()).size === keys.length) return ids;
  }
  throw new Error('Duplicate document keys in the sample');
}

export function shuffleForRater(
  seed: string,
  raterId: string,
  opaqueIds: readonly string[],
): string[] {
  return [...opaqueIds].sort((a, b) =>
    compareCodePoints(
      sha256(`${seed}:order:${raterId}:${a}`),
      sha256(`${seed}:order:${raterId}:${b}`),
    ),
  );
}

interface ParsedSkill {
  keys: Map<string, string>;
  body: string;
}

const BYTE_ORDER_MARK = new RegExp(`^${String.fromCharCode(0xfeff)}`);

/** Line-based frontmatter split (candidate frontmatter is not always valid YAML). */
export function parseSkillMarkdown(text: string): ParsedSkill {
  const normalised = text.replace(/\r\n?/g, '\n').replace(BYTE_ORDER_MARK, '');
  const keys = new Map<string, string>();
  if (!normalised.startsWith('---\n')) return { keys, body: normalised };
  const end = normalised.indexOf('\n---', 3);
  if (end < 0) return { keys, body: normalised };
  const afterFence = normalised.indexOf('\n', end + 1);
  const body = afterFence < 0 ? '' : normalised.slice(afterFence + 1);
  let current: string | null = null;
  for (const line of normalised.slice(4, end).split('\n')) {
    const match = /^([A-Za-z0-9_-]+):(.*)$/.exec(line);
    if (match?.[1] !== undefined) {
      current = match[1];
      keys.set(current, (match[2] ?? '').trim());
    } else if (current !== null && line.trim() !== '') {
      keys.set(current, `${keys.get(current) ?? ''}\n${line.trim()}`);
    }
  }
  return { keys, body };
}

/** Plain text of a YAML scalar written as plain, quoted or block (`>`/`|`) style. */
export function yamlScalarText(raw: string): string {
  const [first = '', ...rest] = raw.split('\n');
  if (/^[>|][+-]?$/.test(first)) {
    return first.startsWith('|') ? rest.join('\n') : rest.join(' ');
  }
  const joined = [first, ...rest].join(' ').trim();
  if (joined.length >= 2 && joined.startsWith("'") && joined.endsWith("'")) {
    return joined.slice(1, -1).replace(/''/g, "'");
  }
  if (joined.length >= 2 && joined.startsWith('"') && joined.endsWith('"')) {
    try {
      return JSON.parse(joined) as string;
    } catch {
      return joined.slice(1, -1);
    }
  }
  return joined;
}

/**
 * Renders one blind document: frontmatter `name` becomes the opaque id, only
 * content keys survive, every multi-word slug occurrence is replaced by the
 * opaque id, and references follow a fixed separator in every document.
 */
export function renderDocument(
  opaqueId: string,
  slug: string,
  source: PacketDocumentSource,
): { text: string; droppedKeys: string[] } {
  const parsed = parseSkillMarkdown(source.skillMd);
  const droppedKeys = [...parsed.keys.keys()]
    .filter(
      (k) =>
        k !== 'name' &&
        !(KEPT_FRONTMATTER_KEYS as readonly string[]).includes(k),
    )
    .sort(compareCodePoints);
  const redact = (text: string): string => redactSlug(text, slug, opaqueId);
  const lines = ['---', `name: ${opaqueId}`];
  const description =
    parsed.keys.get('description') !== undefined
      ? yamlScalarText(parsed.keys.get('description') ?? '')
      : (source.fallbackDescription ?? '');
  lines.push(`description: ${JSON.stringify(redact(description))}`);
  const whenToUse = parsed.keys.get('when_to_use');
  if (whenToUse !== undefined) {
    lines.push(
      `when_to_use: ${JSON.stringify(redact(yamlScalarText(whenToUse)))}`,
    );
  }
  lines.push(
    '---',
    '',
    redact(parsed.body.trim()),
    '',
    REFERENCES_SEPARATOR,
    '',
  );
  const references = [...source.references].sort((a, b) =>
    compareCodePoints(a.name, b.name),
  );
  if (references.length === 0) {
    lines.push(NO_REFERENCES_LINE, '');
  } else {
    references.forEach((ref, index) => {
      lines.push(
        `### Reference ${index + 1}: ${redact(ref.name)}`,
        '',
        redact(ref.content.replace(/\r\n?/g, '\n').trim()),
        '',
      );
    });
  }
  return { text: lines.join('\n'), droppedKeys };
}

function redactSlug(text: string, slug: string, opaqueId: string): string {
  // Single-word slugs are ordinary words ("orchestration"); only hyphenated
  // slugs are distinctive enough to redact without damaging the prose.
  if (!slug.includes('-')) return text;
  const escaped = slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(
    new RegExp(`(?<![A-Za-z0-9-])${escaped}(?![A-Za-z0-9-])`, 'g'),
    opaqueId,
  );
}

function raterCsv(raterId: string, order: readonly string[]): string {
  const empty = RATER_CSV_COLUMNS.slice(2).map(() => '');
  return (
    [
      RATER_CSV_COLUMNS.join(','),
      ...order.map((id) => [id, raterId, ...empty].join(',')),
    ].join('\n') + '\n'
  );
}

function notesCsv(raterId: string, order: readonly string[]): string {
  return (
    [
      NOTES_CSV_COLUMNS.join(','),
      ...order.map((id) => `${id},${raterId},`),
    ].join('\n') + '\n'
  );
}

/** Refuses to replace a packet whose rater CSVs already hold any score. */
async function assertReplaceable(
  packetDir: string,
  overwrite: boolean,
): Promise<void> {
  if (!existsSync(packetDir)) return;
  const entries = await readdir(packetDir);
  if (entries.length === 0) return;
  if (!overwrite) {
    throw new Error(
      `A labelling packet already exists at ${packetDir}; pass overwrite to rebuild it`,
    );
  }
  const ratersDir = join(packetDir, 'raters');
  if (!existsSync(ratersDir)) return;
  for (const raterDir of await readdir(ratersDir)) {
    const dir = join(ratersDir, raterDir);
    for (const file of await readdir(dir)) {
      if (!/^rater-.+\.csv$/.test(file)) continue;
      const rows = (await readFile(join(dir, file), 'utf8'))
        .split(/\r?\n/)
        .slice(1);
      if (
        rows.some((row) =>
          row
            .split(',')
            .slice(2)
            .some((cell) => cell.trim() !== ''),
        )
      ) {
        throw new Error(
          `Refusing to overwrite: ${join(dir, file)} already holds scores`,
        );
      }
    }
  }
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Reader that resolves repo skills at the pinned commit, candidates from the frozen copy, suggestions from the snapshot rows. */
export function createDocumentReader(options: {
  git: GitTreeReader;
  commit: string;
  copyDir: string;
  suggestionRows: readonly SuggestionRow[];
}): DocumentReader {
  const suggestions = new Map(options.suggestionRows.map((s) => [s.id, s]));
  return async (doc) => {
    const source = doc.source;
    if (source.kind === 'candidate') {
      return {
        skillMd: await readFile(
          join(options.copyDir, source.slug, 'SKILL.md'),
          'utf8',
        ),
        references: [],
      };
    }
    if (source.kind === 'suggestion') {
      const row = suggestions.get(source.suggestionId);
      if (!row)
        throw new Error(
          `Suggestion ${source.suggestionId} is not on the snapshot`,
        );
      return {
        skillMd: row.body,
        fallbackDescription: row.description,
        references: parseSuggestionReferences(row.referencesJson),
      };
    }
    const base = `${SKILLS_PREFIX}${source.slug}/`;
    const skillMd = (
      await options.git.readFile(options.commit, `${base}SKILL.md`)
    ).toString('utf8');
    const files = await options.git.listFiles(options.commit, base);
    const references: { name: string; content: string }[] = [];
    for (const file of files.sort(compareCodePoints)) {
      const rel = file.slice(base.length);
      const top = rel.split('/')[0] ?? '';
      if (
        !(REFERENCE_DIRS as readonly string[]).includes(top) ||
        !/\.(md|markdown|txt)$/i.test(rel)
      )
        continue;
      references.push({
        name: posix.basename(rel),
        content: (await options.git.readFile(options.commit, file)).toString(
          'utf8',
        ),
      });
    }
    return { skillMd, references };
  };
}

function parseSuggestionReferences(
  json: string | null,
): { name: string; content: string }[] {
  if (json === null || json.trim() === '') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Suggestion references_json is not valid JSON');
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((item: unknown) => {
    if (typeof item !== 'object' || item === null) return [];
    const record = item as Record<string, unknown>;
    const name = typeof record['name'] === 'string' ? record['name'] : null;
    const content =
      typeof record['body'] === 'string'
        ? record['body']
        : typeof record['content'] === 'string'
          ? record['content']
          : null;
    return name !== null && content !== null ? [{ name, content }] : [];
  });
}

/** The rater instruction sheet; quotes the 471 rubric (`skill-quality-criteria.md:51-66`). */
export function instructions(raterId: string, documents: number): string {
  return `# Skill document labelling — rater ${raterId}

You will score ${documents} skill documents on an 8-criterion rubric. Work alone:
do not discuss documents or scores with the other rater until you have handed in
your sheet.

## What is in this folder

- \`documents/\` — one Markdown file per document, named by an opaque id
  (\`SKD-…\`). The \`name\` in each file's frontmatter is that id. Reference
  files that belong to a document are inlined at the end, below the line
  \`${REFERENCES_SEPARATOR}\`.
- \`rater-${raterId}.csv\` — your score sheet. Rows are in YOUR reading order.
  Score the documents in that order.
- \`notes-${raterId}.csv\` — optional free-text notes, one row per document.
  Notes stay on this machine and are never committed.

## How to score

For each row of \`rater-${raterId}.csv\`:

1. Open \`documents/<opaqueId>.md\` and read the whole document, including the
   inlined references.
2. Score each criterion C1-C8 as a whole number from 0 to 10 (columns
   \`c1\`..\`c8\`). Judge only what is on the page.
3. \`total\` = c1 + … + c8 (0-80).
4. \`pass\` = \`true\` when total ≥ 64 **and** no criterion is below 6;
   otherwise \`false\`.
5. \`ratedAt\` = the date you scored it, \`YYYY-MM-DD\`.
6. Leave \`opaqueId\` and \`raterId\` unchanged. Do not add or reorder columns.
   Do not put commas in any cell. If a document should not be in the set
   (unreadable, empty), score what you can and say why in the notes file.

Save the sheet as CSV (UTF-8) with the same file name. In a spreadsheet
program, set every column to Text before typing so ids and dates are not
reformatted.

## The rubric (TASK_2026_471 \`skill-quality-criteria.md\`, quoted)

To evaluate any skill document objectively without knowing its origin, score each criterion from 0 to 10:

| Criterion | Key Question | 0-3 (Failing) | 4-6 (Marginal) | 7-10 (Exemplar) |
| --- | --- | --- | --- | --- |
| **C1. Contractual Boundaries & Triggers** | Are activation preconditions, tool requirements, and anti-scopes explicitly bounded? | Generic "Use when" statement; no anti-triggers or sibling contrast. | Mentions prerequisites, but lacks contrast with alternative workflows. | Explicit trigger keywords, sibling topology contrast table, required capabilities stated up front. |
| **C2. Deterministic State & Routing Tables** | Are decision points structured as state machines or markdown decision tables? | No tables; linear narrative checklist only. | 1 simple summary table, but decisions remain prose-based. | Multiple markdown decision matrices mapping discrete inputs/states to deterministic actions. |
| **C3. Interface & Protocol Completeness** | Are parameters, payloads, file contracts, and schemas exhaustively specified? | Vague steps ("pass parameters", "update files"). | Names some file paths or commands, but omits schemas/payload formats. | Full parameter schemas, prompt delivery envelopes, exact reply protocols (\`WROTE: <path>\`). |
| **C4. Causal Failure Modes & Recovery** | Are failure modes named by concrete technical cause with deterministic recovery paths? | Obvious general tips ("be careful", "tests may fail"). | Identifies general edge cases, but recovery is left to agent intuition. | Concrete technical breakdown of failure mechanisms (harness bugs, race conditions, silent drops) + deterministic recovery branches. |
| **C5. Operational Invariants ("Never" Rules)** | Does the skill enforce hard negative boundaries to prevent catastrophic failure? | Zero negative constraints; assumes ideal execution. | Contains 1-2 soft warnings ("avoid doing X"). | Explicit \`## Never\` section or bold negative constraints preventing silent reverts, bad merges, and false greens. |
| **C6. Lifecycle Breadth & Multi-Situation Coverage** | Does the document cover the full problem lifecycle across multiple states? | Covers exactly 1 narrow happy path. | Covers happy path plus 1 error branch. | Covers 5+ distinct lifecycle situations (discovery, invocation, execution, recovery, verification, cost). |
| **C7. Verification & Ground Truth Standards** | How is completion proved independent of agent self-reporting? | "Verify the build passes" or no verification step. | Recommends running tests, but specifies no defect format or thresholds. | Explicit verification gates, \`file:line\` defect syntax, independence invariants ("different family"), refutation stance. |
| **C8. Progressive Disclosure & Token Economics** | Is density high with zero fluff, using references for deep context? | Fluffy narrative explanations of concepts an LLM already knows. | Concise, but monolithic; no separation of core vs reference material. | High-density core document directing to modular reference files; zero tutorial text. |

_Passing threshold for exemplar quality_: Total score ≥ 64/80 (average ≥ 8.0/10), with no single criterion below 6.0.

## When you are done

Hand back \`rater-${raterId}.csv\` (and \`notes-${raterId}.csv\` if you used it).
Items where the two raters disagree on pass/fail, or whose totals differ by
more than 12, go to a third person for adjudication.
`;
}
