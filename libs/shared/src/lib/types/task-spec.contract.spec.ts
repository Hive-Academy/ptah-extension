/**
 * The `.ptah/specs/` carrier contract — renderers and artifact classifiers.
 *
 * Two properties in this module are load-bearing and both fail SILENTLY:
 *
 *  1. `renderTaskMd` hand-rolls a YAML emitter (no `gray-matter` — it drags in
 *     `node:fs` and would break the webview build). If a hostile value escapes
 *     unquoted, the frontmatter stops parsing and the task VANISHES from the
 *     board with no error anywhere. CLAUDE.md records three carriers that went
 *     dark for exactly this.
 *  2. `renderSpecsReadme` is rewritten into every user workspace on activation,
 *     and the index service skips the write only when the rendered hash matches
 *     the on-disk one. Any non-determinism rewrites the file on every launch.
 *
 * The artifact classifiers carry a third: they used to be an intersection with
 * `DOC_FILES`, which matched none of the report names real task folders
 * actually carry, so the doctor planned `backlog` for finished work.
 */
import {
  BATCHES_FILE,
  CARRIER_BANNER,
  CARRIER_FILE,
  CONTEXT_FILE,
  DOC_FILES,
  LEGACY_BATCHES_FILE,
  LEGACY_DOC_FILES,
  SPEC_CONTRACT_VERSION,
  SPEC_ROOT,
  SPEC_ROOT_SEGMENTS,
  isCompletionArtifact,
  isDocFile,
  isLegacyDocFile,
  isPlanningArtifact,
  renderSpecsReadme,
  renderTaskMd,
  roundJudgeFile,
} from './task-spec.contract';

const NOW = '2026-01-01T00:00:00.000Z';

/** Parse the frontmatter block back into raw lines, the way a reader would. */
function frontmatterLines(md: string): string[] {
  const lines = md.split('\n');
  expect(lines[0]).toBe('---');
  const end = lines.indexOf('---', 1);
  expect(end).toBeGreaterThan(0);
  return lines.slice(1, end);
}

describe('contract constants', () => {
  it('keeps SPEC_ROOT and SPEC_ROOT_SEGMENTS in agreement', () => {
    // The segments form exists so callers can `path.join(root, ...segments)`
    // without hard-coding a separator. If the two drift, half the codebase
    // looks in one place and half in another.
    expect(SPEC_ROOT_SEGMENTS.join('/')).toBe(SPEC_ROOT);
  });

  it('names the legacy batch file as a member of DOC_FILES', () => {
    // The fallback is permanent: existing task folders are gitignored, so no
    // migration can be trusted to have run.
    expect(DOC_FILES).toContain(LEGACY_BATCHES_FILE);
    expect(LEGACY_DOC_FILES).toContain(LEGACY_BATCHES_FILE);
    expect(BATCHES_FILE).toBe('batches.md');
  });

  it('derives round judge filenames from a number, not a filename', () => {
    expect(roundJudgeFile(1)).toBe('round-1-judge.md');
    expect(roundJudgeFile(12)).toBe('round-12-judge.md');
    // A number cannot express a separator, so traversal is structurally
    // impossible rather than something a sanitiser has to catch.
    expect(roundJudgeFile(3)).not.toContain('/');
  });
});

describe('isDocFile / isLegacyDocFile', () => {
  it('accepts every member of the closed set', () => {
    for (const name of DOC_FILES) expect(isDocFile(name)).toBe(true);
  });

  it.each([
    'code-review.md',
    'notes.md',
    'README.md',
    'task.md',
    '../context.md',
    'Context.md',
    '',
  ])('rejects %p', (name) => {
    expect(isDocFile(name)).toBe(false);
  });

  it('recognises only the legacy names as legacy', () => {
    expect(isLegacyDocFile('tasks.md')).toBe(true);
    expect(isLegacyDocFile('batches.md')).toBe(false);
    expect(isLegacyDocFile('context.md')).toBe(false);
  });
});

describe('artifact classifiers', () => {
  it('recognises the real per-batch report and review names on disk', () => {
    // These are the names that broke the old DOC_FILES intersection.
    expect(isCompletionArtifact('batch2-logic-review.md')).toBe(true);
    expect(isCompletionArtifact('batch1-report.md')).toBe(true);
    expect(isCompletionArtifact('batch3-report.md')).toBe(true);
    expect(isCompletionArtifact('test-report.md')).toBe(true);
    expect(isCompletionArtifact('code-style-review.md')).toBe(true);
  });

  it.each([
    'context.md',
    'implementation-plan.md',
    'batches.md',
    'review.md',
    'report.md',
    'my-report.md.bak',
  ])('does not treat %p as completion evidence', (name) => {
    expect(isCompletionArtifact(name)).toBe(false);
  });

  it('recognises plans and batch breakdowns, including suffixed forms', () => {
    expect(isPlanningArtifact('implementation-plan.md')).toBe(true);
    expect(isPlanningArtifact('implementation-plan-b2.md')).toBe(true);
    expect(isPlanningArtifact('batches.md')).toBe(true);
    expect(isPlanningArtifact('tasks.md')).toBe(true);
  });

  it.each([
    'context.md',
    'test-report.md',
    'my-implementation-plan.md',
    'sub-batches.md',
  ])('does not treat %p as planning evidence', (name) => {
    expect(isPlanningArtifact(name)).toBe(false);
  });

  it('keeps the two classifications disjoint for the canonical names', () => {
    // A plan must never be read as proof the work finished — that is the exact
    // inversion that made the doctor misreport shipped tasks.
    expect(isCompletionArtifact('implementation-plan.md')).toBe(false);
    expect(isPlanningArtifact('test-report.md')).toBe(false);
  });
});

describe('renderTaskMd — the minimal carrier', () => {
  it('emits exactly the historical field set for a zero-metadata task', () => {
    const md = renderTaskMd({
      id: 'TASK_2026_001',
      title: 'Short imperative title',
      type: 'FEATURE',
      now: NOW,
    });

    expect(frontmatterLines(md)).toEqual([
      'id: TASK_2026_001',
      'status: backlog',
      'type: FEATURE',
      'title: Short imperative title',
      'depends_on: []',
      `created: "${NOW}"`,
      `updated: "${NOW}"`,
    ]);
  });

  it('defaults status to backlog and depends_on to an empty inline list', () => {
    const md = renderTaskMd({
      id: 'T',
      title: 'x',
      type: 'BUGFIX',
      now: NOW,
    });
    expect(md).toContain('status: backlog');
    // `depends_on: []` is part of the shape every carrier on disk already has.
    expect(md).toContain('depends_on: []');
  });

  it('writes a pointer body: banner, one-line summary, context link', () => {
    const md = renderTaskMd({
      id: 'T',
      title: 'Fix the thing',
      type: 'BUGFIX',
      now: NOW,
    });

    expect(md).toContain(CARRIER_BANNER);
    expect(md).toContain('Fix the thing');
    expect(md).toContain(`[./${CONTEXT_FILE}](./${CONTEXT_FILE})`);
    expect(CARRIER_FILE).toBe('task.md');
  });

  it('stamps created and updated with the same value', () => {
    const md = renderTaskMd({ id: 'T', title: 'x', type: 'DEVOPS', now: NOW });
    expect(md).toContain(`created: "${NOW}"`);
    expect(md).toContain(`updated: "${NOW}"`);
  });

  it('falls back to the current time when none is injected', () => {
    const before = Date.now();
    const md = renderTaskMd({ id: 'T', title: 'x', type: 'RESEARCH' });
    const stamp = /created: "([^"]+)"/.exec(md)?.[1];
    expect(stamp).toBeDefined();
    expect(Date.parse(stamp as string)).toBeGreaterThanOrEqual(before - 1000);
  });
});

describe('renderTaskMd — optional metadata is omitted when empty', () => {
  const base = { id: 'T', title: 'x', type: 'FEATURE' as const, now: NOW };

  it.each([
    ['parent', { parent: '' }, 'parent:'],
    ['labels', { labels: [] }, 'labels:'],
    ['duplicates', { duplicates: [] }, 'duplicates:'],
    ['relates_to', { relatesTo: [] }, 'relates_to:'],
    ['status_inferred', { statusInferred: false }, 'status_inferred:'],
  ])('omits %s when the value is empty', (_label, extra, needle) => {
    const md = renderTaskMd({ ...base, ...extra });
    expect(md).not.toContain(needle);
  });

  it('is byte-identical with all-empty metadata and with none at all', () => {
    // This is what makes a zero-metadata carrier match a pre-change one.
    const bare = renderTaskMd(base);
    const empty = renderTaskMd({
      ...base,
      parent: '',
      labels: [],
      duplicates: [],
      relatesTo: [],
      statusInferred: false,
    });
    expect(empty).toBe(bare);
  });

  it('emits every optional field once populated, in contract order', () => {
    const md = renderTaskMd({
      ...base,
      status: 'in_progress',
      description: 'A description',
      dependsOn: ['TASK_2026_002'],
      executor: 'senior-developer',
      parent: 'TASK_2026_000',
      estimate: 'M',
      labels: ['licensing'],
      duplicates: ['TASK_2026_003'],
      relatesTo: ['TASK_2026_004'],
      statusInferred: true,
    });

    expect(frontmatterLines(md)).toEqual([
      'id: T',
      'status: in_progress',
      'type: FEATURE',
      'title: x',
      'depends_on:',
      '  - TASK_2026_002',
      `created: "${NOW}"`,
      `updated: "${NOW}"`,
      'description: A description',
      'executor: senior-developer',
      'parent: TASK_2026_000',
      'estimate: M',
      'labels:',
      '  - licensing',
      'duplicates:',
      '  - TASK_2026_003',
      'relates_to:',
      '  - TASK_2026_004',
      'status_inferred: true',
    ]);
  });

  it('emits an empty description when one is explicitly supplied', () => {
    // `undefined` means "no field"; `''` means "a field with an empty value".
    const md = renderTaskMd({ ...base, description: '' });
    expect(md).toContain('description: ""');
  });
});

describe('renderTaskMd — the YAML emitter cannot be broken by hostile input', () => {
  const base = { id: 'T', type: 'FEATURE' as const, now: NOW };

  it('quotes a title containing a colon-space', () => {
    // An unquoted plain scalar ends at the first `: `, which is precisely how
    // three carriers went dark.
    const md = renderTaskMd({ ...base, title: 'fix: the parser' });
    expect(md).toContain('title: "fix: the parser"');
  });

  it.each([
    ['leading hash', '#comment'],
    ['leading dash', '-dash'],
    ['leading digit', '2026 plan'],
    ['trailing space', 'trailing '],
    ['embedded quote', 'say "hi"'],
    ['embedded newline', 'line one\nline two'],
    ['leading bracket', '[bracketed]'],
    ['leading brace', '{braced}'],
    ['ampersand anchor', '&anchor'],
    ['asterisk alias', '*alias'],
  ])('quotes a title with a %s', (_label, title) => {
    const md = renderTaskMd({ ...base, title });
    const line = frontmatterLines(md).find((l) => l.startsWith('title:'));
    expect(line).toBe(`title: ${JSON.stringify(title)}`);
  });

  it.each(['y', 'n', 'yes', 'no', 'true', 'false', 'on', 'off', 'null'])(
    'quotes the YAML-reserved word %p so it stays a string',
    (word) => {
      const md = renderTaskMd({ ...base, title: word });
      expect(md).toContain(`title: "${word}"`);
    },
  );

  it('quotes reserved words case-insensitively', () => {
    expect(renderTaskMd({ ...base, title: 'NO' })).toContain('title: "NO"');
    expect(renderTaskMd({ ...base, title: 'True' })).toContain('title: "True"');
  });

  it('always quotes ISO timestamps so YAML does not read them as dates', () => {
    const md = renderTaskMd({ ...base, title: 'x' });
    expect(md).toContain(`created: "${NOW}"`);
  });

  it('leaves a plainly-safe scalar unquoted', () => {
    const md = renderTaskMd({
      ...base,
      title: 'Refactor the (v2) auth/flow_handler.ts path-thing',
    });
    expect(md).toContain(
      'title: Refactor the (v2) auth/flow_handler.ts path-thing',
    );
  });

  it('quotes hostile list entries element by element', () => {
    const md = renderTaskMd({
      ...base,
      title: 'x',
      labels: ['plain', 'needs:design', 'trailing ', 'true'],
    });

    expect(frontmatterLines(md)).toEqual(
      expect.arrayContaining([
        'labels:',
        '  - plain',
        '  - "needs:design"',
        '  - "trailing "',
        '  - "true"',
      ]),
    );
  });
});

describe('renderTaskMd — body summary', () => {
  const base = { id: 'T', type: 'FEATURE' as const, now: NOW };

  it('prefers the description over the title', () => {
    const md = renderTaskMd({
      ...base,
      title: 'The title',
      description: 'The description',
    });
    expect(md).toContain('\nThe description\n');
    expect(md.split(CARRIER_BANNER)[1]).not.toContain('The title');
  });

  it('falls back to the title when the description is blank', () => {
    const md = renderTaskMd({
      ...base,
      title: 'The title',
      description: '   \n  ',
    });
    expect(md.split(CARRIER_BANNER)[1]).toContain('The title');
  });

  it('collapses a multi-line description to its first non-blank line', () => {
    const md = renderTaskMd({
      ...base,
      title: 'The title',
      description: '\n\n  First   real   line  \nsecond line\n',
    });
    // The body is a POINTER, never prose — one line, whitespace collapsed.
    expect(md.split(CARRIER_BANNER)[1]).toContain('\nFirst real line\n');
    expect(md.split(CARRIER_BANNER)[1]).not.toContain('second line');
  });

  it('handles CRLF line endings in a description', () => {
    const md = renderTaskMd({
      ...base,
      title: 'The title',
      description: 'first\r\nsecond',
    });
    expect(md.split(CARRIER_BANNER)[1]).toContain('\nfirst\n');
  });
});

describe('renderSpecsReadme', () => {
  it('is deterministic — the same bytes on every call', () => {
    // The index service compares hashes and skips the write when they match.
    // A wall-clock read here rewrites the file on every activation.
    expect(renderSpecsReadme()).toBe(renderSpecsReadme());
  });

  it('lists every recognised document except the legacy names', () => {
    const readme = renderSpecsReadme();
    for (const name of DOC_FILES) {
      if (isLegacyDocFile(name)) continue;
      expect(readme).toContain(`- \`${name}\``);
    }
    // The legacy name is described in prose, never offered as a list entry.
    expect(readme).not.toContain(`- \`${LEGACY_BATCHES_FILE}\``);
    expect(readme).toContain(LEGACY_BATCHES_FILE);
  });

  it('states the carrier contract without assuming any tooling', () => {
    const readme = renderSpecsReadme();
    expect(readme).toContain(SPEC_ROOT);
    expect(readme).toContain(CARRIER_FILE);
    expect(readme).toContain(CONTEXT_FILE);
    expect(readme).toContain(`spec contract v${SPEC_CONTRACT_VERSION}`);
    // Every status and type a reader may write.
    for (const status of [
      'backlog',
      'in_progress',
      'in_review',
      'blocked',
      'done',
      'cancelled',
    ]) {
      expect(readme).toContain(status);
    }
  });

  it('warns against the two failure modes the board actually suffers', () => {
    const readme = renderSpecsReadme();
    expect(readme).toContain('invisible to the Tasks board');
    expect(readme).toContain('registry.md');
  });
});
