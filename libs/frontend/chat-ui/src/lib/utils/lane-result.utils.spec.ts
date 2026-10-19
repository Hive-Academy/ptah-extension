import { parseLaneResult } from './lane-result.utils';

const WIN_DIR =
  'D:\\projects\\ptah-extension\\.claude-worktrees\\x\\.ptah\\specs\\TASK_2026_593_7c2e';

describe('parseLaneResult', () => {
  it('returns null for text with no WROTE lines', () => {
    expect(parseLaneResult('Just an answer.\n\nWith two paragraphs.')).toBe(
      null,
    );
    expect(parseLaneResult('')).toBe(null);
  });

  it('parses trailing WROTE lines and keeps Windows paths exactly', () => {
    const text = [
      'I documented the limit.',
      '',
      `WROTE: ${WIN_DIR}\\parity-inventory.md — 26 capabilities`,
      `WROTE: ${WIN_DIR}\\task-description.md — 21 requirements`,
    ].join('\n');

    const result = parseLaneResult(text);

    expect(result?.body).toBe('I documented the limit.');
    expect(result?.reported).toBe(null);
    expect(result?.files).toEqual([
      {
        path: `${WIN_DIR}\\parity-inventory.md`,
        name: 'parity-inventory.md',
        verdict: '26 capabilities',
        tone: 'neutral',
      },
      {
        path: `${WIN_DIR}\\task-description.md`,
        name: 'task-description.md',
        verdict: '21 requirements',
        tone: 'neutral',
      },
    ]);
    expect(result?.folder).toEqual({
      path: WIN_DIR,
      name: 'TASK_2026_593_7c2e',
    });
  });

  it('accepts en dash and hyphen separators, forward slashes and no verdict', () => {
    const result = parseLaneResult(
      [
        'Done.',
        'WROTE: D:/a/b/one.md – APPROVED',
        '',
        'WROTE: D:/a/c/two.md - NEEDS_REVISION · 2 serious',
        'WROTE: D:/a/c/three.md',
        '',
      ].join('\n'),
    );

    expect(result?.files.map((f) => [f.name, f.verdict, f.tone])).toEqual([
      ['one.md', 'APPROVED', 'approved'],
      ['two.md', 'NEEDS_REVISION · 2 serious', 'revision'],
      ['three.md', '', 'neutral'],
    ]);
    expect(result?.folder).toBe(null);
  });

  it('marks REJECTED verdicts', () => {
    expect(
      parseLaneResult('WROTE: /r/review.md — REJECTED: 3 blocking')?.files[0]
        .tone,
    ).toBe('rejected');
  });

  it('strips backticks around a path', () => {
    expect(parseLaneResult('WROTE: `/r/x/plan.md` — ok')?.files[0].path).toBe(
      '/r/x/plan.md',
    );
  });

  it('takes a "Reported" line directly before the WROTE lines', () => {
    const result = parseLaneResult(
      [
        'Body text.',
        'Reported to the spawning session: Wrote the inventory.',
        '',
        'WROTE: /r/x/a.md — 1',
      ].join('\n'),
    );

    expect(result?.body).toBe('Body text.');
    expect(result?.reported).toBe('Wrote the inventory.');
  });

  it('takes a fenced "Reported" block directly before the WROTE lines', () => {
    const result = parseLaneResult(
      [
        'Body text.',
        '',
        '```text',
        'Reported to the spawning session: Wrote parity inventory',
        '(26 capabilities).',
        '```',
        'WROTE: /r/x/a.md — 26 capabilities',
      ].join('\n'),
    );

    expect(result?.body).toBe('Body text.');
    expect(result?.reported).toBe('Wrote parity inventory\n(26 capabilities).');
  });

  it('leaves an unrelated fence before the WROTE lines in the body', () => {
    const text = ['```ts', 'const a = 1;', '```', 'WROTE: /r/x/a.md'].join(
      '\n',
    );
    const result = parseLaneResult(text);

    expect(result?.reported).toBe(null);
    expect(result?.body).toBe('```ts\nconst a = 1;\n```');
  });

  it('keeps a WROTE line followed by prose as text', () => {
    expect(
      parseLaneResult('WROTE: /r/x/a.md — 1\n\nThen I kept working.'),
    ).toBe(null);
  });

  it('parses only the trailing run when an earlier WROTE line is in the prose', () => {
    const result = parseLaneResult(
      ['WROTE: /r/early.md', 'More prose.', 'WROTE: /r/late.md'].join('\n'),
    );

    expect(result?.files.map((f) => f.name)).toEqual(['late.md']);
    expect(result?.body).toBe('WROTE: /r/early.md\nMore prose.');
  });

  it('handles CRLF line endings', () => {
    const result = parseLaneResult('Body\r\nWROTE: C:\\r\\a.md — ok\r\n');

    expect(result?.body).toBe('Body');
    expect(result?.files[0].path).toBe('C:\\r\\a.md');
  });
});
