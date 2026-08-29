/**
 * Agent-template composition ratchet.
 *
 * This suite is a GUARD, not a unit test. Nothing in the build opened a
 * `.template.md` before it existed, and that is how the corpus reached 8,375
 * lines with ~1,267 of them being the same four cross-cutting rules pasted
 * fifteen times. Every failure it prevents is silent:
 *
 *  - A shared rule copied into a second template drifts. The clarification
 *    protocol had eleven copies in eleven variants; all six copies of the
 *    task-spec rules still named a file that had been renamed.
 *  - A `<!-- STATIC:ID -->` marker nothing resolves leaks verbatim into every
 *    generated agent and every rival CLI's harness dir. That is what they did.
 *  - A malformed id (`ANT I_PATTERNS` shipped for months) is invisible to a
 *    `\w+` validator, so the block it fences is silently never expanded.
 *  - A second `---name/description---` frontmatter block that nothing parses
 *    makes the file's own metadata a lie.
 *
 * Duties (a)-(e) below map one-to-one onto those.
 */
import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import matter from 'gray-matter';
import { renderTaskSpecAgentBlock } from '@ptah-extension/shared';

jest.mock('@ptah-extension/vscode-core', () => ({
  Logger: jest.fn(),
  TOKENS: { LOGGER: Symbol.for('Logger'), SENTRY_SERVICE: Symbol.for('S') },
}));

import {
  SHARED_BLOCK_IDS,
  SHARED_PARTIALS_DIR,
  TemplatePartialResolver,
  partialFileName,
} from './template-partial-resolver';

const TEMPLATES_DIR = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'templates',
  'agents',
);
const PARTIALS_DIR = path.join(TEMPLATES_DIR, SHARED_PARTIALS_DIR);

/** The corpus is a fixed set of specialists, not a growing directory. */
const EXPECTED_TEMPLATE_COUNT = 15;

function templateFiles(): string[] {
  return fs
    .readdirSync(TEMPLATES_DIR)
    .filter((name) => name.endsWith('.template.md'))
    .sort();
}

function read(name: string): string {
  return fs.readFileSync(path.join(TEMPLATES_DIR, name), 'utf8');
}

const FILES = templateFiles();

/** Same loose id capture the resolver uses — a malformed id must be VISIBLE. */
const MARKER_LINE = /^[ \t]*<!--[ \t]*(\/?)STATIC:(.*?)[ \t]*-->[ \t]*$/gm;

interface Marker {
  readonly isClose: boolean;
  readonly id: string;
  readonly line: number;
}

function markersOf(body: string): Marker[] {
  const markers: Marker[] = [];
  for (const match of body.matchAll(MARKER_LINE)) {
    const before = body.slice(0, match.index ?? 0);
    markers.push({
      isClose: match[1] === '/',
      id: match[2],
      line: before.split('\n').length,
    });
  }
  return markers;
}

/**
 * Character ranges covered by a STATIC pair, markers included.
 *
 * Used to EXEMPT shared content from the heading-uniqueness rule: a heading
 * repeated across fifteen files is the defect, unless the reason it repeats is
 * that all fifteen point at the same file.
 */
function sharedRanges(body: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let open: number | undefined;
  for (const match of body.matchAll(MARKER_LINE)) {
    const start = match.index ?? 0;
    if (match[1] === '/') {
      if (open !== undefined) ranges.push([open, start + match[0].length]);
      open = undefined;
    } else {
      open = start;
    }
  }
  return ranges;
}

// ---------------------------------------------------------------------------
// (c) the corpus is a fixed set
// ---------------------------------------------------------------------------

describe('template corpus', () => {
  it(`holds exactly ${EXPECTED_TEMPLATE_COUNT} templates`, () => {
    expect(FILES).toHaveLength(EXPECTED_TEMPLATE_COUNT);
  });

  it('ships a file for every registered shared block that is not derived', () => {
    // TASK_SPEC_CONTRACT is rendered from constants in `libs/shared`; it
    // deliberately has NO file, so a seventh stale copy cannot exist.
    const onDisk = new Set(fs.readdirSync(PARTIALS_DIR));
    const missing = SHARED_BLOCK_IDS.filter(
      (id) => id !== 'TASK_SPEC_CONTRACT' && !onDisk.has(partialFileName(id)),
    );
    expect(missing).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// (d) one frontmatter block, and it agrees with the filename
// ---------------------------------------------------------------------------

describe('template frontmatter', () => {
  it.each(FILES)('%s carries exactly one frontmatter block', (file) => {
    const body = matter(read(file)).content;
    // A second block would sit at the very top of what gray-matter returned.
    expect(body.trimStart().startsWith('---')).toBe(false);
  });

  it.each(FILES)('%s declares templateId and templateVersion', (file) => {
    const data = matter(read(file)).data;
    expect(typeof data['templateId']).toBe('string');
    expect(typeof data['templateVersion']).toBe('string');
  });

  it.each(FILES)(
    '%s has name === templateId minus the version suffix',
    (file) => {
      const data = matter(read(file)).data;
      const expected = String(data['templateId']).replace(/-v\d+$/, '');
      expect(data['name']).toBe(expected);
      // And the filename is the same thing again — three names, one value.
      expect(file).toBe(`${expected}.template.md`);
    },
  );

  it.each(FILES)('%s declares a description', (file) => {
    const data = matter(read(file)).data;
    expect(typeof data['description']).toBe('string');
    expect(String(data['description']).trim().length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// (b) markers are well-formed, registered, and paired
// ---------------------------------------------------------------------------

describe('STATIC markers', () => {
  it.each(FILES)('%s uses only registered block ids', (file) => {
    const offenders = markersOf(matter(read(file)).content)
      .filter(
        (m) =>
          !/^[A-Z_]+$/.test(m.id) ||
          !(SHARED_BLOCK_IDS as readonly string[]).includes(m.id),
      )
      .map((m) => `line ${m.line}: ${JSON.stringify(m.id)}`);
    expect(offenders).toEqual([]);
  });

  it.each(FILES)('%s pairs every marker, without nesting', (file) => {
    const markers = markersOf(matter(read(file)).content);
    const problems: string[] = [];
    let open: Marker | undefined;
    for (const marker of markers) {
      if (!marker.isClose) {
        if (open)
          problems.push(`line ${marker.line}: nested inside ${open.id}`);
        open = marker;
        continue;
      }
      if (!open) {
        problems.push(`line ${marker.line}: closes ${marker.id} with no open`);
        continue;
      }
      if (open.id !== marker.id) {
        problems.push(`line ${marker.line}: ${open.id} closed by ${marker.id}`);
      }
      open = undefined;
    }
    if (open)
      problems.push(`${open.id} opened at line ${open.line} never closes`);
    expect(problems).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// (a) a heading belongs to one template, or to a shared block
// ---------------------------------------------------------------------------

/**
 * The section skeleton every agent file is authored to.
 *
 * These names REPEAT BY DESIGN — that is the contract a reader relies on to
 * find an agent's output format without reading the whole file. What must not
 * repeat is what sits UNDER them: `## Method` saying the same thing in fifteen
 * files is the 1,267-line duplication this suite exists to stop, and the second
 * test below is what separates the two cases.
 *
 * Closed and named. A new entry means a new section in the skeleton, which is a
 * decision about the shape of every agent, not a way to get a heading past the
 * uniqueness rule.
 */
const SKELETON_HEADINGS: ReadonlyArray<{ heading: string; why: string }> = [
  { heading: 'role', why: 'Opens every agent file: who this specialist is.' },
  { heading: 'inputs', why: 'What the agent is handed when it is invoked.' },
  {
    heading: 'method',
    why: 'The specialist-specific procedure. Body differs.',
  },
  { heading: 'output contract', why: 'What the agent returns. Body differs.' },
  {
    heading: 'return value',
    why: 'The shape handed back to the orchestrator.',
  },
  { heading: 'refusals', why: 'What this specialist declines and why.' },
];

const SKELETON = new Set(SKELETON_HEADINGS.map((e) => e.heading));

interface Section {
  readonly heading: string;
  readonly level: number;
  readonly body: string;
  readonly shared: boolean;
}

/** Normalised so emphasis or punctuation cannot hide a copy. */
function normaliseHeading(text: string): string {
  return text.replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Character ranges covered by a fenced code block, fences included.
 *
 * A `## Summary` inside a ` ```markdown ` fence is not a section of the agent's
 * own instructions — it is a section name in the document the agent is being
 * told to WRITE. Four reviewers legitimately end their report with `## Verdict`,
 * and the reports are only comparable because they do. Counting those as
 * duplicated headings would force the output schemas apart to satisfy a rule
 * aimed at duplicated prose, so the rule stops at the fence.
 *
 * An unclosed fence swallows the rest of the body, which is what a Markdown
 * renderer does with one — the template is malformed either way, and hiding its
 * headings is the reading that does not invent sections nobody wrote.
 */
function fencedRanges(body: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let open: number | undefined;
  let at = 0;
  for (const line of body.split('\n')) {
    if (/^[ \t]*(```|~~~)/.test(line)) {
      if (open === undefined) {
        open = at;
      } else {
        ranges.push([open, at + line.length]);
        open = undefined;
      }
    }
    at += line.length + 1;
  }
  if (open !== undefined) ranges.push([open, body.length]);
  return ranges;
}

function sectionsIn(body: string): Section[] {
  const shared = sharedRanges(body);
  const fenced = fencedRanges(body);
  const matches = [...body.matchAll(/^(#{2,3}) +(.+)$/gm)].filter(
    (match) =>
      !fenced.some(
        ([start, stop]) =>
          (match.index ?? 0) >= start && (match.index ?? 0) < stop,
      ),
  );

  return matches.map((match, i) => {
    const at = match.index ?? 0;
    const end = matches[i + 1]?.index ?? body.length;
    return {
      heading: normaliseHeading(match[2]),
      level: match[1].length,
      body: body.slice(at + match[0].length, end).trim(),
      shared: shared.some(([start, stop]) => at >= start && at < stop),
    };
  });
}

function sectionsOf(file: string): Section[] {
  return sectionsIn(matter(read(file)).content);
}

/**
 * Headings owned by more than one document, formatted for the failure message.
 *
 * Takes bodies rather than filenames so duty (a) and the fence exemption below
 * exercise the SAME reduction — a rule proven only against the corpus it was
 * written for is a rule that passes because the corpus was edited.
 */
function duplicateHeadings(
  docs: ReadonlyArray<{ file: string; body: string }>,
): string[] {
  const owners = new Map<string, string[]>();

  for (const { file, body } of docs) {
    const seen = new Set<string>();
    for (const section of sectionsIn(body)) {
      if (section.shared || SKELETON.has(section.heading)) continue;
      if (seen.has(section.heading)) continue;
      seen.add(section.heading);
      owners.set(section.heading, [
        ...(owners.get(section.heading) ?? []),
        file,
      ]);
    }
  }

  return [...owners.entries()]
    .filter(([, files]) => files.length > 1)
    .map(([heading, files]) => `"${heading}" in ${files.join(', ')}`)
    .sort();
}

describe('heading uniqueness', () => {
  it('no H2/H3 heading appears in two templates outside a shared block', () => {
    // When this fails: the section is either specialist-specific and needs a
    // specialist name, or it is shared and belongs in `_shared/`. Never relax
    // the rule to get green.
    expect(
      duplicateHeadings(
        FILES.map((file) => ({ file, body: matter(read(file)).content })),
      ),
    ).toEqual([]);
  });

  it('exempts a repeated heading inside a fence, and only inside one', () => {
    const schema = [
      '## Preamble',
      '',
      '```markdown',
      '## Verdict',
      '',
      'Recommendation: APPROVE / REVISE / REJECT',
      '```',
    ].join('\n');
    const prose = [
      '## Preamble',
      '',
      '## Verdict',
      '',
      'Recommendation: APPROVE / REVISE / REJECT',
    ].join('\n');

    // Same `## Verdict` in two documents: an output schema, so it is fine...
    expect(
      duplicateHeadings([
        { file: 'a', body: schema },
        { file: 'b', body: schema },
      ]),
    ).toEqual(['"preamble" in a, b']);

    // ...and the identical heading as an instruction still fails.
    expect(
      duplicateHeadings([
        { file: 'a', body: prose },
        { file: 'b', body: prose },
      ]),
    ).toEqual(['"preamble" in a, b', '"verdict" in a, b']);
  });

  /**
   * The exemption above is for the NAME, never for the text. Without this, a
   * cross-cutting rule could be reintroduced fifteen times simply by filing it
   * under `## Method`.
   */
  it('no skeleton section has identical prose in two templates', () => {
    const byBody = new Map<string, string[]>();

    for (const file of FILES) {
      for (const section of sectionsOf(file)) {
        if (section.shared || !SKELETON.has(section.heading)) continue;
        if (section.body.length < 80) continue; // a one-line stub proves nothing
        const key = `${section.heading}\0${section.body}`;
        byBody.set(key, [...(byBody.get(key) ?? []), file]);
      }
    }

    const cloned = [...byBody.entries()]
      .filter(([, files]) => files.length > 1)
      .map(([key, files]) => `"${key.split('\0')[0]}" in ${files.join(', ')}`)
      .sort();

    expect(cloned).toEqual([]);
  });

  it('has a skeleton allowlist that every template actually uses', () => {
    // A skeleton entry no template carries is a stale exemption, and a stale
    // exemption silently widens the rule above.
    const used = new Set(
      FILES.flatMap((file) => sectionsOf(file).map((s) => s.heading)),
    );
    const unused = SKELETON_HEADINGS.filter((e) => !used.has(e.heading)).map(
      (e) => e.heading,
    );
    expect(unused).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// (f) no Prettier escape artefact survives in the corpus
// ---------------------------------------------------------------------------

/**
 * Every `.md` this lib ships as agent instructions: the 15 templates plus the
 * shared partials they expand.
 */
function corpusFiles(): Array<{ label: string; text: string }> {
  const partials = fs
    .readdirSync(PARTIALS_DIR)
    .filter((name) => name.endsWith('.md'))
    .sort()
    .map((name) => ({
      label: `${SHARED_PARTIALS_DIR}/${name}`,
      text: fs.readFileSync(path.join(PARTIALS_DIR, name), 'utf8'),
    }));

  return [
    ...FILES.map((file) => ({ label: file, text: read(file) })),
    ...partials,
  ];
}

/**
 * Prettier escapes `_` and `*` when it thinks bare emphasis markers are loose
 * prose, so `TASK_[ID]` in a heading became `TASK\_[ID]` on every format run.
 * The backslash is not Markdown the agent renders — it reaches the model as a
 * literal character inside a token it is told to reproduce, and three templates
 * shipped a task-id placeholder nobody could match.
 *
 * The fix at the source is to put the placeholder in a code span, where Prettier
 * has no emphasis to escape. This pins that: a re-mangled corpus fails here
 * rather than silently on the next `format:write`.
 */
describe('escape artefacts', () => {
  it.each(corpusFiles())(
    '$label carries no backslash-escaped _ or *',
    ({ text }) => {
      const offenders = text
        .split('\n')
        .map((line, i) => ({ line, number: i + 1 }))
        .filter(({ line }) => /\\[_*]/.test(line))
        .map(({ line, number }) => `line ${number}: ${line.trim()}`);
      expect(offenders).toEqual([]);
    },
  );

  it('would catch a mangled placeholder', () => {
    // Proof the matcher sees the thing it exists for, rather than passing
    // because the corpus happens to be clean today.
    expect(/\\[_*]/.test('## Backend implementation — TASK\\_[ID]')).toBe(true);
    expect(/\\[_*]/.test('## Backend implementation — `TASK_[ID]`')).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// (e) every template resolves, and resolution leaves no slot behind
// ---------------------------------------------------------------------------

describe('partial resolution', () => {
  const resolver = new TemplatePartialResolver({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as never);

  it.each(FILES)('%s resolves and expands its shared blocks', async (file) => {
    const parsed = matter(read(file));
    const raw = parsed.data['variables'];
    const variables =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, string>)
        : {};

    const result = await resolver.resolve(
      file.replace('.template.md', ''),
      parsed.content,
      PARTIALS_DIR,
      variables,
    );

    expect(result.isErr() ? result.error!.message : 'ok').toBe('ok');

    const { content, blocks } = result.value!;
    for (const block of blocks) {
      // The partial's text actually landed in the body...
      expect(content).toContain(block.content);
      // ...and every declared slot was filled. A literal `{{CLARIFY_TRIGGER}}`
      // reaching an agent reads as a token it is expected to understand.
      expect(block.content).not.toContain('{{');
    }
  });

  it('renders TASK_SPEC_CONTRACT from the contract module, not from a file', async () => {
    const withBlock = FILES.filter((file) =>
      read(file).includes('STATIC:TASK_SPEC_CONTRACT'),
    );
    // If no template uses it, the derived block is dead code — say so loudly.
    expect(withBlock.length).toBeGreaterThan(0);

    const parsed = matter(read(withBlock[0]));
    const raw = parsed.data['variables'];
    const result = await resolver.resolve(
      withBlock[0].replace('.template.md', ''),
      parsed.content,
      PARTIALS_DIR,
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, string>)
        : {},
    );

    const block = result.value!.blocks.find(
      (b) => b.id === 'TASK_SPEC_CONTRACT',
    );
    expect(block?.content).toBe(renderTaskSpecAgentBlock().trim());
  });
});
