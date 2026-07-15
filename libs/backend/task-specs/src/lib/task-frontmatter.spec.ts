import { parseTaskFile, updateFrontmatter } from './task-frontmatter';

const ISO = '2026-01-01T00:00:00.000Z';

function fullFile(folder = 'TASK_2026_001'): string {
  return [
    '---',
    `id: ${folder}`,
    'status: in_progress',
    'type: FEATURE',
    'title: Build the thing',
    'description: A one-line summary',
    'depends_on:',
    '  - TASK_2026_140',
    '  - TASK_2026_155',
    'executor: backend-developer',
    `created: '${ISO}'`,
    `updated: '${ISO}'`,
    '---',
    '',
    '## Description',
    '',
    'Body text.',
    '',
  ].join('\n');
}

describe('parseTaskFile', () => {
  it('parses a full valid task.md', () => {
    const result = parseTaskFile('TASK_2026_001', fullFile());
    expect(result.kind).toBe('task');
    if (result.kind !== 'task') return;
    expect(result.task.id).toBe('TASK_2026_001');
    expect(result.task.status).toBe('in_progress');
    expect(result.task.type).toBe('FEATURE');
    expect(result.task.title).toBe('Build the thing');
    expect(result.task.dependsOn).toEqual(['TASK_2026_140', 'TASK_2026_155']);
    expect(result.task.executor).toBe('backend-developer');
    expect(result.task.created).toBe(ISO);
    expect(result.task.frontmatterValid).toBe(true);
    expect(result.task.validationIssues).toHaveLength(0);
    expect(result.body).toContain('## Description');
  });

  it('parses a BOM-prefixed task.md as an included task', () => {
    // A leading UTF-8 BOM (U+FEFF) — common from Windows tooling — must not
    // defeat frontmatter detection and silently exclude the task.
    const raw = '\uFEFF---\nstatus: backlog\ntitle: BOM task\n---\nbody';
    const result = parseTaskFile('TASK_2026_010', raw);
    expect(result.kind).toBe('task');
    if (result.kind !== 'task') return;
    expect(result.task.id).toBe('TASK_2026_010');
    expect(result.task.status).toBe('backlog');
    expect(result.task.title).toBe('BOM task');
    expect(result.task.frontmatterValid).toBe(true);
  });

  it('parses a minimal task.md (status + title only)', () => {
    const raw = '---\nstatus: backlog\ntitle: Minimal\n---\nbody';
    const result = parseTaskFile('TASK_2026_002', raw);
    expect(result.kind).toBe('task');
    if (result.kind !== 'task') return;
    expect(result.task.id).toBe('TASK_2026_002');
    expect(result.task.type).toBeNull();
    expect(result.task.dependsOn).toEqual([]);
    expect(result.task.created).toBeNull();
    expect(result.task.frontmatterValid).toBe(true);
  });

  describe('exclusions', () => {
    it('excludes a file with no frontmatter block', () => {
      const result = parseTaskFile('TASK_X', '# just a heading\n\nprose');
      expect(result).toEqual({
        kind: 'excluded',
        excluded: { folderName: 'TASK_X', reason: 'no_frontmatter' },
      });
    });

    it('excludes unparseable YAML', () => {
      const raw = '---\nstatus: [unterminated\ntitle: x\n---\nbody';
      const result = parseTaskFile('TASK_X', raw);
      expect(result.kind).toBe('excluded');
      if (result.kind !== 'excluded') return;
      expect(result.excluded.reason).toBe('yaml_unparseable');
    });

    it('excludes an invalid status', () => {
      const raw = '---\nstatus: wip\ntitle: x\n---\nbody';
      const result = parseTaskFile('TASK_X', raw);
      expect(result.kind).toBe('excluded');
      if (result.kind !== 'excluded') return;
      expect(result.excluded.reason).toBe('invalid_status');
    });

    it('excludes a missing title', () => {
      const raw = '---\nstatus: backlog\n---\nbody';
      const result = parseTaskFile('TASK_X', raw);
      expect(result.kind).toBe('excluded');
      if (result.kind !== 'excluded') return;
      expect(result.excluded.reason).toBe('missing_title');
    });
  });

  describe('warnings (included with issues)', () => {
    it('folder name wins over a mismatched id', () => {
      const raw =
        '---\nid: TASK_9999_999\nstatus: backlog\ntitle: x\n---\nbody';
      const result = parseTaskFile('TASK_2026_003', raw);
      expect(result.kind).toBe('task');
      if (result.kind !== 'task') return;
      expect(result.task.id).toBe('TASK_2026_003');
      expect(result.task.frontmatterValid).toBe(false);
      expect(result.task.validationIssues.map((i) => i.code)).toContain(
        'id_mismatch',
      );
    });

    it('warns on an invalid type but stays included with type null', () => {
      const raw = '---\nstatus: backlog\ntitle: x\ntype: NONSENSE\n---\nbody';
      const result = parseTaskFile('TASK_2026_004', raw);
      expect(result.kind).toBe('task');
      if (result.kind !== 'task') return;
      expect(result.task.type).toBeNull();
      expect(result.task.validationIssues.map((i) => i.code)).toContain(
        'invalid_type',
      );
    });

    it('warns on an unparseable date', () => {
      const raw =
        '---\nstatus: backlog\ntitle: x\ncreated: not-a-date\n---\nbody';
      const result = parseTaskFile('TASK_2026_005', raw);
      expect(result.kind).toBe('task');
      if (result.kind !== 'task') return;
      expect(result.task.created).toBeNull();
      expect(result.task.validationIssues.map((i) => i.code)).toContain(
        'invalid_date',
      );
    });

    it('warns on malformed depends_on', () => {
      const raw =
        '---\nstatus: backlog\ntitle: x\ndepends_on: not-a-list\n---\nbody';
      const result = parseTaskFile('TASK_2026_006', raw);
      expect(result.kind).toBe('task');
      if (result.kind !== 'task') return;
      expect(result.task.dependsOn).toEqual([]);
      expect(result.task.validationIssues.map((i) => i.code)).toContain(
        'invalid_depends_on',
      );
    });
  });
});

describe('updateFrontmatter (byte-preservation, R1.5)', () => {
  it('preserves a CRLF body with `---` inside a code fence, byte-for-byte', () => {
    const body =
      'intro line\r\n```markdown\r\n---\r\nnot frontmatter\r\n---\r\n```\r\ntrailing\r\n';
    const raw =
      `---\nid: TASK_2026_007\nstatus: backlog\ntitle: x\ncreated: '${ISO}'\nupdated: '${ISO}'\n---\n` +
      body;

    const out = updateFrontmatter(raw, {
      status: 'done',
      updated: '2026-02-02T00:00:00.000Z',
    });

    // Body after the frontmatter block is untouched.
    expect(out.endsWith(body)).toBe(true);
    // Frontmatter reflects the patch.
    const reparsed = parseTaskFile('TASK_2026_007', out);
    expect(reparsed.kind).toBe('task');
    if (reparsed.kind !== 'task') return;
    expect(reparsed.task.status).toBe('done');
    expect(reparsed.task.updated).toBe('2026-02-02T00:00:00.000Z');
  });

  it('preserves a fully-CRLF frontmatter file body', () => {
    const body = 'CRLF body line one\r\nline two\r\n';
    const raw =
      `---\r\nstatus: backlog\r\ntitle: x\r\nupdated: '${ISO}'\r\n---\r\n` +
      body;
    const out = updateFrontmatter(raw, {
      status: 'in_review',
      updated: ISO,
    });
    expect(out.endsWith(body)).toBe(true);
    const reparsed = parseTaskFile('TASK_2026_008', out);
    expect(reparsed.kind).toBe('task');
    if (reparsed.kind !== 'task') return;
    expect(reparsed.task.status).toBe('in_review');
  });

  it('refreshes `updated` automatically when not supplied in the patch', () => {
    const raw = `---\nstatus: backlog\ntitle: x\nupdated: '${ISO}'\n---\nbody`;
    const out = updateFrontmatter(raw, { status: 'blocked' });
    const reparsed = parseTaskFile('TASK_2026_009', out);
    expect(reparsed.kind).toBe('task');
    if (reparsed.kind !== 'task') return;
    expect(reparsed.task.updated).not.toBe(ISO);
    expect(reparsed.task.updated).not.toBeNull();
  });

  it('preserves the leading BOM and the body byte-for-byte on rewrite', () => {
    // When the original carrier had a UTF-8 BOM, the rewrite keeps the BOM
    // (safer than silently normalizing it away) and the body survives untouched.
    const body = 'CRLF body\r\n```\r\n---\r\ninner\r\n---\r\n```\r\ntail\r\n';
    const raw =
      '\uFEFF' +
      `---\nstatus: backlog\ntitle: x\nupdated: '${ISO}'\n---\n` +
      body;

    const out = updateFrontmatter(raw, {
      status: 'in_review',
      updated: ISO,
    });

    // Leading BOM is preserved on the rewritten file.
    expect(out.charCodeAt(0)).toBe(0xfeff);
    // Body after the frontmatter block is byte-for-byte identical.
    expect(out.endsWith(body)).toBe(true);
    // Frontmatter still reparses correctly (BOM tolerated on the way back in).
    const reparsed = parseTaskFile('TASK_2026_011', out);
    expect(reparsed.kind).toBe('task');
    if (reparsed.kind !== 'task') return;
    expect(reparsed.task.status).toBe('in_review');
  });

  it('returns the input unchanged when there is no frontmatter block', () => {
    const raw = 'no frontmatter here';
    expect(updateFrontmatter(raw, { status: 'done' })).toBe(raw);
  });
});
