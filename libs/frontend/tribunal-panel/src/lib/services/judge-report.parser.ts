import type {
  CrucibleDefect,
  CrucibleRound,
  CrucibleVerdict,
} from '../types/tribunal-ui.types';

/**
 * Parser for a Crucible judge report (`round-N-judge.md`).
 *
 * The report is UNTRUSTED vendor output. Every rule below is deliberately
 * strict and every unmatched case falls to the safe side — `'unparsed'` for a
 * verdict, dropped for a defect. There is no default arm and no optimistic
 * fallback anywhere in this file: a report we cannot read must never be
 * indistinguishable from a report that said PASS.
 *
 * The contract this parses is `crucible.md:79-96`, reproduced verbatim in every
 * judge spawn prompt:
 *
 * ```markdown
 * ## VERDICT
 *
 * PASS | REVISE | REJECT
 *
 * ## SCORES
 *
 * | # | Criterion | Pass? | Evidence (file:line) |
 *
 * ## DEFECTS <!-- omit when PASS -->
 *
 * D1 [blocking|major|minor] <file:line> — what is wrong — what correct looks like
 *
 * ## MENTOR NOTE
 * ```
 *
 * Note that the template's own verdict line is `PASS | REVISE | REJECT`. A lazy
 * judge that echoes the template back unchanged must parse to `'unparsed'`, and
 * its template defect row must be dropped — both are pinned by tests.
 */

type SectionName = 'verdict' | 'scores' | 'defects' | 'mentor';

/** ATX heading, up to three leading spaces, any level. */
const HEADING_RE = /^ {0,3}(#{1,6})\s+(.*)$/;

/** A lone fenced-code delimiter, e.g. ``` or ```markdown. */
const FENCE_RE = /^ {0,3}(?:`{3,}|~{3,})\s*\S*\s*$/;

const SECTION_TITLES = new Map<string, SectionName>([
  ['VERDICT', 'verdict'],
  ['SCORES', 'scores'],
  ['DEFECTS', 'defects'],
  ['MENTOR NOTE', 'mentor'],
]);

/**
 * The three verdict words, UPPERCASE only.
 *
 * Case-insensitive matching is deliberately NOT offered: the contract is
 * emitted verbatim into the judge prompt, and loosening the match is exactly
 * the kind of accommodation that lets a `pass` appear where none was given.
 */
const VERDICT_WORDS = new Map<string, CrucibleVerdict>([
  ['PASS', 'pass'],
  ['REVISE', 'revise'],
  ['REJECT', 'reject'],
]);

/**
 * The three contract severity words. Anything else becomes `'unknown'` — see
 * {@link parseDefectLine}. This map is a recogniser, never a gate.
 */
const SEVERITIES = new Map<string, CrucibleDefect['severity']>([
  ['blocking', 'blocking'],
  ['major', 'major'],
  ['minor', 'minor'],
]);

/** `D1 [blocking] <rest>`, tolerating a leading list marker and `D1:` / `D1)`. */
const DEFECT_HEAD_RE =
  /^ {0,3}(?:[-*+]\s+)?(D\d+)\s*[:.)]?\s*\[([^\]]*)\]\s*(.*)$/;

/**
 * A `file:line` (or `file:line:col`) citation anchored on a TRAILING line
 * number, never on the first colon.
 *
 * `.*?` is lazy and the lookahead requires the citation to end at whitespace, a
 * closing wrapper, or end-of-input, so the match extends across a Windows drive
 * letter: `D:\projects\x\foo.ts:42` yields the whole path, NOT `D`. That failure
 * mode — splitting on the first colon and calling `D` a file — is the entire
 * reason this is one anchored regex rather than a `split(':')` (R4).
 *
 * The lookahead admits a closing backtick/bracket because judges routinely
 * write the citation as `` `src/a.ts:42` ``; dropping those would discard real,
 * evidenced defects.
 */
const LOCATION_RE = /^(\S.*?:\d+(?::\d+)?)(?=[\s`>)\],;]|$)/;

/** Em dash, en dash, `--`, or a spaced hyphen — the contract uses the em dash. */
const SEPARATOR_RE = /\s*[—–]\s*|\s+-{1,2}\s+/;

/** Markdown emphasis and code decoration that may wrap a lone verdict word. */
const DECORATION_RE = /[`*_]/g;

/** HTML comments, e.g. the template's `<!-- omit when PASS -->` heading suffix. */
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;

/**
 * Parse one judge report into a {@link CrucibleRound}.
 *
 * Always returns a round: an unreadable report is a round whose verdict is
 * `'unparsed'` and whose defect list is empty, which the UI renders as
 * "awaiting verdict" (AC-5.2). Callers that have NO report at all must not call
 * this — an absent file yields no round, not an empty one.
 *
 * @param round    1-based round index, from `roundJudgeFile(round)`.
 * @param markdown Raw file content.
 */
export function parseJudgeReport(
  round: number,
  markdown: string,
): CrucibleRound {
  const sections = splitSections(markdown);
  return {
    round,
    verdict: parseVerdict(sections.get('verdict') ?? []),
    defects: parseDefects(sections.get('defects') ?? []),
    mentorNote: parseMentorNote(sections.get('mentor') ?? []),
  };
}

/** Group the document's lines under the contract heading they follow. */
function splitSections(markdown: string): ReadonlyMap<SectionName, string[]> {
  const sections = new Map<SectionName, string[]>();
  let current: SectionName | null = null;

  for (const line of markdown.split(/\r?\n/)) {
    const heading = HEADING_RE.exec(line);
    if (heading) {
      const title = heading[2]
        .replace(HTML_COMMENT_RE, '')
        .replace(DECORATION_RE, '')
        .trim()
        .replace(/\s+/g, ' ')
        .toUpperCase();
      current = SECTION_TITLES.get(title) ?? null;
      if (current && !sections.has(current)) sections.set(current, []);
      continue;
    }
    if (current) sections.get(current)?.push(line);
  }

  return sections;
}

/**
 * The verdict, or `'unparsed'`.
 *
 * A verdict is recognised only when a line consists of NOTHING BUT one verdict
 * word (after stripping markdown decoration and one trailing `.`/`:`). Pipes,
 * table cells and prose are never stripped, so the template's own
 * `PASS | REVISE | REJECT` matches nothing.
 *
 * Two DIFFERENT verdict words in the section is ambiguity, not a tie to break —
 * it also resolves to `'unparsed'`.
 */
function parseVerdict(lines: readonly string[]): CrucibleVerdict {
  const found = new Set<CrucibleVerdict>();

  for (const line of lines) {
    const token = line
      .replace(HTML_COMMENT_RE, '')
      .replace(DECORATION_RE, '')
      .trim()
      .replace(/[.:]$/, '')
      .trim();
    if (token.length === 0) continue;
    const verdict = VERDICT_WORDS.get(token);
    if (verdict) found.add(verdict);
  }

  if (found.size !== 1) return 'unparsed';
  const [only] = found;
  return only;
}

function parseDefects(lines: readonly string[]): readonly CrucibleDefect[] {
  const defects: CrucibleDefect[] = [];
  for (const line of lines) {
    const defect = parseDefectLine(line);
    if (defect) defects.push(defect);
  }
  return defects;
}

/**
 * One defect row, or `null` when it does not clear the bar.
 *
 * A MISSING `file:line` citation is the one and only drop condition (AC-5.3).
 * The Conductor drops unevidenced defects before relaying them
 * (`crucible.md:145`) and the panel must not resurrect them.
 *
 * An unrecognised severity word is explicitly NOT a drop condition: the defect
 * is kept at `'unknown'`. Dropping an evidenced, located finding because the
 * judge wrote `[critical]` is silent data loss that makes a REVISE look cleaner
 * than it was — the same failure class as defaulting a verdict to PASS.
 * Remapping it onto `'major'` would misreport the judge instead, which is a
 * different bug rather than a fix.
 *
 * This does not weaken the defence against a judge echoing the contract
 * template. That row is killed by the LOCATION rule — its literal `<file:line>`
 * has no digits and cannot match `:\d+`. Severity strictness never stopped it,
 * and `drops the template defect rows entirely` in the spec pins that with the
 * severity rule relaxed. Do not re-tighten this on the template's account.
 */
function parseDefectLine(line: string): CrucibleDefect | null {
  const head = DEFECT_HEAD_RE.exec(line);
  if (!head) return null;

  const [, id, severityRaw, tail] = head;
  const severity =
    SEVERITIES.get(severityRaw.trim().toLowerCase()) ?? 'unknown';

  const body = tail.trim().replace(/^[`<([]+/, '');
  const location = LOCATION_RE.exec(body);
  if (!location) return null;

  const rest = body
    .slice(location[0].length)
    .trim()
    .replace(/^[`>)\],;]+/, '')
    .trim();
  const parts = rest
    .split(SEPARATOR_RE)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  return {
    id,
    severity,
    location: location[1],
    what: parts[0] ?? '',
    expected: parts.slice(1).join(' — '),
  };
}

/** The mentor note body, or `null` when the section is absent or empty. */
function parseMentorNote(lines: readonly string[]): string | null {
  const kept = [...lines];
  while (kept.length > 0 && isBlankOrFence(kept[0])) kept.shift();
  while (kept.length > 0 && isBlankOrFence(kept[kept.length - 1])) kept.pop();
  const note = kept.join('\n').trim();
  return note.length > 0 ? note : null;
}

function isBlankOrFence(line: string): boolean {
  return line.trim().length === 0 || FENCE_RE.test(line);
}
