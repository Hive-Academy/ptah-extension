import { parseJudgeReport } from './judge-report.parser';

/**
 * The contract template exactly as `crucible.md:79-96` emits it into every
 * judge prompt. A lazy judge echoing this back is the single most likely
 * malformed input, and it must NOT parse as a pass (AC-5.2).
 */
const CONTRACT_TEMPLATE = `## VERDICT

PASS | REVISE | REJECT

## SCORES

| # | Criterion | Pass? | Evidence (file:line) |

## DEFECTS <!-- omit when PASS -->

D1 [blocking|major|minor] <file:line> — what is wrong — what correct looks like
D2 ...

## MENTOR NOTE

<= 5 lines. The _pattern_ behind the defects, so the next round does not repeat the class of error.
`;

const REAL_REVISE = `# Round 1 — judge report

## VERDICT

REVISE

## SCORES

| # | Criterion | Pass? | Evidence (file:line) |
| 1 | Type safety | no | libs/a/src/x.ts:12 |

## DEFECTS

D1 [blocking] libs/a/src/x.ts:12 — \`any\` leaks through the boundary — narrow with a Zod schema at the entry point
D2 [minor] libs/a/src/y.ts:88:4 — unused import — delete it

## MENTOR NOTE

The pattern is trusting internal callers at an external boundary.
Validate once, at the edge, then trust the type.
`;

describe('parseJudgeReport', () => {
  describe('AC-5.2 — verdict parsing is adversarial, with no optimistic arm', () => {
    it('parses the echoed contract template as "unparsed", NOT pass', () => {
      expect(parseJudgeReport(1, CONTRACT_TEMPLATE).verdict).toBe('unparsed');
    });

    it.each(['PASS', 'REVISE', 'REJECT'] as const)(
      'parses a lone %s',
      (word) => {
        const report = `## VERDICT\n\n${word}\n`;
        expect(parseJudgeReport(1, report).verdict).toBe(
          word.toLowerCase() as 'pass' | 'revise' | 'reject',
        );
      },
    );

    it('accepts a verdict word wrapped in markdown emphasis or backticks', () => {
      expect(parseJudgeReport(1, '## VERDICT\n\n**PASS**\n').verdict).toBe(
        'pass',
      );
      expect(parseJudgeReport(1, '## VERDICT\n\n`REVISE`\n').verdict).toBe(
        'revise',
      );
    });

    it('accepts a trailing period or colon on an otherwise lone word', () => {
      expect(parseJudgeReport(1, '## VERDICT\n\nPASS.\n').verdict).toBe('pass');
    });

    it.each([
      ['prose around it', '## VERDICT\n\nI would say PASS on this one.\n'],
      ['a table cell', '## VERDICT\n\n| PASS |\n'],
      ['lowercase', '## VERDICT\n\npass\n'],
      ['mixed case', '## VERDICT\n\nPass\n'],
      ['a pipe list', '## VERDICT\n\nPASS | REJECT\n'],
      ['a label prefix', '## VERDICT\n\nVerdict: PASS\n'],
    ])('refuses to yield pass from %s', (_label, report) => {
      expect(parseJudgeReport(1, report).verdict).toBe('unparsed');
    });

    it('returns "unparsed" when two DIFFERENT verdict words stand alone', () => {
      const ambiguous = '## VERDICT\n\nREVISE\n\nPASS\n';
      expect(parseJudgeReport(1, ambiguous).verdict).toBe('unparsed');
    });

    it('tolerates the same verdict word repeated', () => {
      expect(parseJudgeReport(1, '## VERDICT\n\nPASS\n\nPASS\n').verdict).toBe(
        'pass',
      );
    });

    it('returns "unparsed" when the VERDICT section is missing entirely', () => {
      expect(parseJudgeReport(1, '## DEFECTS\n\nnothing\n').verdict).toBe(
        'unparsed',
      );
    });

    it('returns "unparsed" for empty content', () => {
      expect(parseJudgeReport(1, '').verdict).toBe('unparsed');
    });

    it('ignores a verdict word that stands alone OUTSIDE the VERDICT section', () => {
      const report =
        '## VERDICT\n\nsomething vague\n\n## MENTOR NOTE\n\nPASS\n';
      expect(parseJudgeReport(1, report).verdict).toBe('unparsed');
    });

    it('accepts any heading level and case for the section itself', () => {
      // Structure is matched tolerantly; the VALUE is matched strictly.
      expect(parseJudgeReport(1, '# Verdict\n\nPASS\n').verdict).toBe('pass');
      expect(parseJudgeReport(1, '#### verdict\n\nPASS\n').verdict).toBe(
        'pass',
      );
    });
  });

  describe('AC-5.3 — defects must carry a file:line citation', () => {
    it('parses well-formed defects', () => {
      const { defects } = parseJudgeReport(1, REAL_REVISE);
      expect(defects).toHaveLength(2);
      expect(defects[0]).toEqual({
        id: 'D1',
        severity: 'blocking',
        location: 'libs/a/src/x.ts:12',
        what: '`any` leaks through the boundary',
        expected: 'narrow with a Zod schema at the entry point',
      });
      expect(defects[1].id).toBe('D2');
      expect(defects[1].severity).toBe('minor');
      expect(defects[1].location).toBe('libs/a/src/y.ts:88:4');
    });

    it('drops the template defect rows entirely', () => {
      expect(parseJudgeReport(1, CONTRACT_TEMPLATE).defects).toEqual([]);
    });

    it('drops the template row on the LOCATION rule, not the severity rule', () => {
      // Load-bearing, and the reason severity strictness could be relaxed
      // safely. The template's `<file:line>` is a literal with no digits, so it
      // cannot match a trailing `:\d+` — the row dies on evidence, exactly as
      // an unevidenced real defect does. Proven by feeding the SAME row with a
      // contract-valid severity: it still drops.
      const withGoodSeverity =
        '## DEFECTS\n\nD1 [blocking] <file:line> — what is wrong — what correct looks like\n';
      expect(parseJudgeReport(1, withGoodSeverity).defects).toEqual([]);

      // And the converse: the template's junk severity alone does not drop a
      // row that IS evidenced. Nobody may re-tighten severity to kill the
      // template — that was never what killed it.
      const withRealLocation =
        '## DEFECTS\n\nD1 [blocking|major|minor] a/b.ts:12 — what is wrong — what correct looks like\n';
      const kept = parseJudgeReport(1, withRealLocation).defects;
      expect(kept).toHaveLength(1);
      expect(kept[0].severity).toBe('unknown');
    });

    it('drops a defect with no line number', () => {
      const report =
        '## DEFECTS\n\nD1 [blocking] libs/a/src/x.ts — bad — good\n';
      expect(parseJudgeReport(1, report).defects).toEqual([]);
    });

    it('drops a defect with no location at all', () => {
      const report =
        '## DEFECTS\n\nD1 [major] the code is bad — make it good\n';
      expect(parseJudgeReport(1, report).defects).toEqual([]);
    });

    it.each(['critical', 'high', 'nit', 'P0'])(
      'KEEPS a located defect whose severity is [%s], as "unknown"',
      (word) => {
        // A missing file:line is the one and only drop condition. Dropping an
        // evidenced finding over its severity word is silent data loss.
        const report = `## DEFECTS\n\nD1 [${word}] libs/a/src/x.ts:1 — bad — good\n`;
        const { defects } = parseJudgeReport(1, report);
        expect(defects).toHaveLength(1);
        expect(defects[0].severity).toBe('unknown');
        expect(defects[0].location).toBe('libs/a/src/x.ts:1');
        expect(defects[0].what).toBe('bad');
      },
    );

    it('never remaps an unknown severity onto a contract word', () => {
      const report = '## DEFECTS\n\nD1 [critical] a/b.ts:1 — bad — good\n';
      // Guessing `major` (or `blocking`) misreports the judge, which is a
      // different bug rather than a fix for the data loss.
      expect(parseJudgeReport(1, report).defects[0].severity).not.toBe('major');
      expect(parseJudgeReport(1, report).defects[0].severity).not.toBe(
        'blocking',
      );
    });

    it('drops ONLY the unevidenced defect from a mixed list', () => {
      const report = [
        '## DEFECTS',
        '',
        'D1 [blocking] no citation here — bad — good',
        'D2 [major] libs/a/src/x.ts:7 — real defect — real fix',
        'D3 [wat] libs/a/src/y.ts:9 — junk severity — still evidenced',
        '',
      ].join('\n');
      const { defects } = parseJudgeReport(1, report);
      expect(defects.map((d) => d.id)).toEqual(['D2', 'D3']);
      expect(defects.map((d) => d.severity)).toEqual(['major', 'unknown']);
    });

    it('ignores defect rows outside the DEFECTS section', () => {
      const report =
        '## MENTOR NOTE\n\nD1 [blocking] libs/a/src/x.ts:1 — bad — good\n';
      expect(parseJudgeReport(1, report).defects).toEqual([]);
    });

    it('tolerates a list marker and a trailing DEFECTS heading comment', () => {
      const report =
        '## DEFECTS <!-- omit when PASS -->\n\n- D1 [minor] a/b.ts:3 — x — y\n';
      expect(parseJudgeReport(1, report).defects).toHaveLength(1);
    });

    it('accepts a location wrapped in backticks', () => {
      const report =
        '## DEFECTS\n\nD1 [major] `libs/a/src/x.ts:7` — bad — good\n';
      const { defects } = parseJudgeReport(1, report);
      expect(defects).toHaveLength(1);
      expect(defects[0].location).toBe('libs/a/src/x.ts:7');
      expect(defects[0].what).toBe('bad');
      expect(defects[0].expected).toBe('good');
    });

    it('normalises severity case', () => {
      const report = '## DEFECTS\n\nD1 [BLOCKING] a/b.ts:3 — x — y\n';
      expect(parseJudgeReport(1, report).defects[0].severity).toBe('blocking');
    });
  });

  describe('R4 — Windows absolute paths', () => {
    it('anchors on the TRAILING line number, never the drive-letter colon', () => {
      const report =
        '## DEFECTS\n\nD1 [blocking] D:\\projects\\x\\foo.ts:42 — bad — good\n';
      const { defects } = parseJudgeReport(1, report);
      expect(defects).toHaveLength(1);
      // The failure mode this pins: splitting on the first colon and calling
      // the drive letter "D" a file location.
      expect(defects[0].location).toBe('D:\\projects\\x\\foo.ts:42');
      expect(defects[0].location).not.toBe('D');
    });

    it('keeps a Windows path with a column number intact', () => {
      const report =
        '## DEFECTS\n\nD1 [major] C:\\Users\\a\\b.ts:10:5 — bad — good\n';
      expect(parseJudgeReport(1, report).defects[0].location).toBe(
        'C:\\Users\\a\\b.ts:10:5',
      );
    });

    it('keeps a Windows path containing spaces, given a separator', () => {
      const report =
        '## DEFECTS\n\nD1 [minor] C:\\Program Files\\app\\a.ts:9 — bad — good\n';
      expect(parseJudgeReport(1, report).defects[0].location).toBe(
        'C:\\Program Files\\app\\a.ts:9',
      );
    });

    it('does not treat a drive letter alone as a location', () => {
      const report =
        '## DEFECTS\n\nD1 [blocking] D:\\projects\\x — bad — good\n';
      expect(parseJudgeReport(1, report).defects).toEqual([]);
    });

    it('stops the location at the first trailing line number when no separator follows', () => {
      const report =
        '## DEFECTS\n\nD1 [major] D:\\projects\\x\\foo.ts:42 missing null check\n';
      const { defects } = parseJudgeReport(1, report);
      expect(defects[0].location).toBe('D:\\projects\\x\\foo.ts:42');
      expect(defects[0].what).toBe('missing null check');
    });
  });

  describe('mentor note', () => {
    it('captures the whole note across lines', () => {
      const { mentorNote } = parseJudgeReport(1, REAL_REVISE);
      expect(mentorNote).toBe(
        'The pattern is trusting internal callers at an external boundary.\nValidate once, at the edge, then trust the type.',
      );
    });

    it('is null when the section is absent', () => {
      expect(parseJudgeReport(1, '## VERDICT\n\nPASS\n').mentorNote).toBeNull();
    });

    it('is null when the section is present but blank', () => {
      expect(
        parseJudgeReport(1, '## VERDICT\n\nPASS\n\n## MENTOR NOTE\n\n\n')
          .mentorNote,
      ).toBeNull();
    });

    it('strips a wrapping code fence but keeps the note body', () => {
      const report = '## MENTOR NOTE\n\n```\nthe underlying pattern\n```\n';
      expect(parseJudgeReport(1, report).mentorNote).toBe(
        'the underlying pattern',
      );
    });
  });

  describe('round echo', () => {
    it('echoes back the round it was given, so a late read cannot mislabel itself', () => {
      expect(parseJudgeReport(2, REAL_REVISE).round).toBe(2);
      expect(parseJudgeReport(3, '').round).toBe(3);
    });
  });

  describe('a PASS report', () => {
    it('parses with a verdict and no defects', () => {
      const report =
        '## VERDICT\n\nPASS\n\n## SCORES\n\n| 1 | all good | yes | a/b.ts:1 |\n\n## MENTOR NOTE\n\nKeep the boundary validation habit.\n';
      const round = parseJudgeReport(1, report);
      expect(round.verdict).toBe('pass');
      expect(round.defects).toEqual([]);
      expect(round.mentorNote).toBe('Keep the boundary validation habit.');
    });

    it('does not mine the SCORES table for defects', () => {
      const report =
        '## VERDICT\n\nPASS\n\n## SCORES\n\n| 1 | D1 [blocking] a/b.ts:1 | no | a/b.ts:1 |\n';
      expect(parseJudgeReport(1, report).defects).toEqual([]);
    });
  });
});
