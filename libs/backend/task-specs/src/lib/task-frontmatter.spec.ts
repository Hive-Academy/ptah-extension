import { toTaskStatus, toTaskType } from './task-enum-narrowing';
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

    /**
     * D5 — the exclusion REASON must not depend on call order.
     *
     * gray-matter caches by input string and, on a YAML throw, leaves a
     * half-built entry with an empty `data` behind. Without the options object
     * that defeats that cache, this sequence reads
     * `yaml_unparseable | invalid_status | invalid_status`: the same bytes
     * diagnosed two different ways inside one process. That reason is shown to
     * a user in the exclusions drawer, so the second answer is simply wrong.
     *
     * Reproduced live during the 2026-08-09 doctor run on `TASK_2026_182`,
     * `188` and `189`.
     */
    it('reports the SAME reason on repeated parses of identical bytes', () => {
      // A description written as a plain scalar containing a flow mapping —
      // the exact shape that made three carriers vanish from the board.
      const raw = [
        '---',
        'id: TASK_2026_188',
        'status: backlog',
        'title: x',
        'description: a client sending {"field": null} to a dtoPipe endpoint',
        '---',
        'body',
      ].join('\n');

      const reasons = [0, 1, 2].map(() => {
        const result = parseTaskFile('TASK_X', raw);
        return result.kind === 'excluded' ? result.excluded.reason : 'task';
      });

      expect(reasons).toEqual([
        'yaml_unparseable',
        'yaml_unparseable',
        'yaml_unparseable',
      ]);
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

  /**
   * TASK_2026_255 — the two essential enums are narrowed case-INSENSITIVELY.
   *
   * Carriers are hand-authored with ordinary file tools (that is what the
   * task-spec contract tells agents to do), and the two tuples shout in
   * opposite directions: `TASK_TYPES` is uppercase, `TASK_STATUSES` is
   * lowercase. Sixteen live carriers declared `type: bugfix` and rendered an
   * amber warning triangle plus a "no type" badge. The `status` exposure was
   * worse in kind — a case mismatch there EXCLUDES the folder, so the task
   * vanishes from the board rather than losing a badge.
   */
  describe('case-insensitive enum narrowing (TASK_2026_255)', () => {
    const withType = (value: string): string =>
      `---\nstatus: backlog\ntitle: x\ntype: ${value}\n---\nbody`;
    const withStatus = (value: string): string =>
      `---\nstatus: ${value}\ntitle: x\n---\nbody`;

    it.each([
      ['bugfix', 'BUGFIX'],
      ['BugFix', 'BUGFIX'],
      ["'  bugfix  '", 'BUGFIX'],
      ['documentation', 'DOCUMENTATION'],
      ['saas_init', 'SAAS_INIT'],
    ])(
      'parses type %s as %s with no validation issue',
      (declared, expected) => {
        const result = parseTaskFile('TASK_2026_255', withType(declared));
        expect(result.kind).toBe('task');
        if (result.kind !== 'task') return;
        expect(result.task.type).toBe(expected);
        expect(result.task.validationIssues).toEqual([]);
        expect(result.task.frontmatterValid).toBe(true);
      },
    );

    it.each([
      ['Backlog', 'backlog'],
      ['IN_PROGRESS', 'in_progress'],
      ["'  In_Review  '", 'in_review'],
    ])(
      'includes a task declaring status %s, narrowed to %s',
      (declared, expected) => {
        const result = parseTaskFile('TASK_2026_255', withStatus(declared));
        expect(result.kind).toBe('task');
        if (result.kind !== 'task') return;
        expect(result.task.status).toBe(expected);
        expect(result.task.validationIssues).toEqual([]);
      },
    );

    it('still warns invalid_type for a value that is no type in any case', () => {
      const result = parseTaskFile('TASK_2026_255', withType('banana'));
      expect(result.kind).toBe('task');
      if (result.kind !== 'task') return;
      expect(result.task.type).toBeNull();
      expect(result.task.validationIssues.map((i) => i.code)).toContain(
        'invalid_type',
      );
    });

    it('still excludes a status that is no status in any case', () => {
      const result = parseTaskFile('TASK_2026_255', withStatus('nonsense'));
      expect(result.kind).toBe('excluded');
      if (result.kind !== 'excluded') return;
      expect(result.excluded.reason).toBe('invalid_status');
    });

    /**
     * YAML hands the parser whatever the author typed. A non-string takes the
     * ordinary invalid path — it must never reach `.trim()` and throw, because
     * `parseTaskFile` never throws past its boundary (R1.2).
     */
    it.each(['1', '[a, b]', '{ k: v }', 'true'])(
      'takes the invalid path without throwing for a non-string type %s',
      (declared) => {
        const result = parseTaskFile('TASK_2026_255', withType(declared));
        expect(result.kind).toBe('task');
        if (result.kind !== 'task') return;
        expect(result.task.type).toBeNull();
        expect(result.task.validationIssues.map((i) => i.code)).toContain(
          'invalid_type',
        );
      },
    );

    it.each(['1', '[a, b]', 'true'])(
      'excludes without throwing for a non-string status %s',
      (declared) => {
        const result = parseTaskFile('TASK_2026_255', withStatus(declared));
        expect(result.kind).toBe('excluded');
        if (result.kind !== 'excluded') return;
        expect(result.excluded.reason).toBe('invalid_status');
      },
    );

    /**
     * THE regression guard for the root cause.
     *
     * The defect was not any one carrier's casing — it was two narrowings of
     * one union, in one lib, answering differently for identical bytes: the
     * parser's `z.enum(TASK_TYPES)` and the doctor's `toTaskType`. Both now go
     * through `task-enum-narrowing.ts`; this feeds the same input to the parser
     * and to the doctor's narrowing and asserts they agree.
     */
    it('agrees with the doctor narrowing for every input', () => {
      const inputs = [
        'BUGFIX',
        'bugfix',
        'BugFix',
        '  feature  ',
        'documentation',
        'saas_init',
        'banana',
        '',
      ];

      for (const input of inputs) {
        const result = parseTaskFile(
          'TASK_2026_255',
          withType(JSON.stringify(input)),
        );
        expect(result.kind).toBe('task');
        if (result.kind !== 'task') continue;

        // The parser reports "no type" as null, the doctor as undefined —
        // the same answer in two shapes.
        expect(result.task.type).toBe(toTaskType(input) ?? null);
      }
    });

    it('narrows status the same way the shared helper does', () => {
      const inputs = ['backlog', 'Backlog', 'IN_PROGRESS', '  done  ', 'wip'];

      for (const input of inputs) {
        const result = parseTaskFile(
          'TASK_2026_255',
          withStatus(JSON.stringify(input)),
        );
        const narrowed = toTaskStatus(input);
        if (narrowed === undefined) {
          expect(result.kind).toBe('excluded');
          continue;
        }
        expect(result.kind).toBe('task');
        if (result.kind !== 'task') continue;
        expect(result.task.status).toBe(narrowed);
      }
    });
  });

  describe('dangling_depends_on (TASK_2026_179, step 15)', () => {
    const withDeps = (deps: string): string =>
      `---\nstatus: backlog\ntitle: x\ndepends_on:\n${deps}\n---\nbody`;

    it('raises exactly one issue for a dependency naming no existing folder', () => {
      const result = parseTaskFile(
        'TASK_2026_010',
        withDeps('  - TASK_2099_999'),
        { knownFolders: ['TASK_2026_010', 'TASK_2026_011'] },
      );
      expect(result.kind).toBe('task');
      if (result.kind !== 'task') return;

      const dangling = result.task.validationIssues.filter(
        (i) => i.code === 'dangling_depends_on',
      );
      expect(dangling).toHaveLength(1);
      expect(dangling[0].message).toContain('TASK_2099_999');
      // A broken pointer is a warning: the task stays visible on the board.
      expect(result.task.dependsOn).toEqual(['TASK_2099_999']);
    });

    it('raises none when every dependency resolves', () => {
      const result = parseTaskFile(
        'TASK_2026_010',
        withDeps('  - TASK_2026_011\n  - TASK_2026_012'),
        {
          knownFolders: ['TASK_2026_010', 'TASK_2026_011', 'TASK_2026_012'],
        },
      );
      if (result.kind !== 'task') return;
      expect(result.task.validationIssues).toEqual([]);
      expect(result.task.frontmatterValid).toBe(true);
    });

    it('raises one issue PER dangling entry, naming each', () => {
      const result = parseTaskFile(
        'TASK_2026_010',
        withDeps('  - TASK_2099_998\n  - TASK_2026_011\n  - TASK_2099_999'),
        { knownFolders: ['TASK_2026_010', 'TASK_2026_011'] },
      );
      if (result.kind !== 'task') return;
      const messages = result.task.validationIssues
        .filter((i) => i.code === 'dangling_depends_on')
        .map((i) => i.message);
      expect(messages).toHaveLength(2);
      expect(messages.join(' ')).toContain('TASK_2099_998');
      expect(messages.join(' ')).toContain('TASK_2099_999');
    });

    it('skips the check entirely when the caller supplies no folder set', () => {
      // A single-file reparse has no view of the directory. Reporting every
      // dependency as dangling there would be a false alarm about the CALLER's
      // ignorance, not about the file.
      const result = parseTaskFile(
        'TASK_2026_010',
        withDeps('  - TASK_2099_999'),
      );
      if (result.kind !== 'task') return;
      expect(result.task.validationIssues).toEqual([]);
    });

    it('still reports a mismatched id, and mutates nothing, alongside the new check', () => {
      // TASK_2026_176 really does declare `id: TASK_2026_178` in this
      // workspace. Normalizing it would erase the only record that 178 was ever
      // handed out, so the allocator could re-issue it to a different task.
      const raw =
        '---\nid: TASK_2026_178\nstatus: in_progress\ntitle: x\ndepends_on:\n  - TASK_2099_999\n---\nbody';
      const result = parseTaskFile('TASK_2026_176', raw, {
        knownFolders: ['TASK_2026_176'],
      });
      if (result.kind !== 'task') return;

      const codes = result.task.validationIssues.map((i) => i.code);
      expect(codes).toContain('id_mismatch');
      expect(codes).toContain('dangling_depends_on');
      // Folder name wins; the declared id is reported, never rewritten.
      expect(result.task.id).toBe('TASK_2026_176');
      expect(raw).toContain('id: TASK_2026_178');
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
