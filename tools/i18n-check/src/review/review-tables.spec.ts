import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as markdownPlugin from 'prettier/plugins/markdown';
import { format } from 'prettier/standalone';
import { loadGlossary, type Glossary } from '../lib/glossary';
import type { TranslationEntry } from '../lib/translation-files';
import { UsageError } from '../lib/cli';
import {
  LEGAL_NOTICE_KEY,
  generate,
  parseArgs,
  reviewNotes,
  reviewTables,
  tableCell,
  type ReviewOptions,
} from './review-tables';

// Prettier throws for markdown containing PRETTIER_THROWS_HERE (as the table
// escapes it), so a failing format can be exercised; everything else is
// formatted for real.
jest.mock('prettier/standalone', () => {
  const actual = jest.requireActual('prettier/standalone');
  return {
    ...actual,
    format: (...args: Parameters<typeof actual.format>) => {
      if (String(args[0]).includes('PRETTIER\\_THROWS\\_HERE')) {
        return Promise.reject(new Error('prettier exploded'));
      }
      return actual.format(...args);
    },
  };
});

const EN = 'libs/web/legal/src/lib/i18n/en.json';
const AR = 'libs/web/legal/src/lib/i18n/ar.json';

describe('review-tables', () => {
  let root: string;
  const write = (rel: string, content: string): void => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  };
  const read = (rel: string): string =>
    fs.readFileSync(path.join(root, rel), 'utf8');
  const options = (over: Partial<ReviewOptions> = {}): ReviewOptions => ({
    workspaceRoot: root,
    projectRoot: 'libs/web/legal',
    scope: 'legal',
    glossary: 'glossary.json',
    out: 'copy-review',
    check: false,
    ...over,
  });

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-review-'));
    write(
      'glossary.json',
      JSON.stringify([
        { term: 'Ptah', reason: 'brand name' },
        { term: 'VS Code', reason: 'technical identifier' },
      ]),
    );
    write(
      EN,
      JSON.stringify({
        governingLanguageNotice: 'The English version governs.',
        terms: {
          intro: 'Use <strong>Ptah</strong> | VS Code',
          seats: 'For {{ count }} seats\nand *more*',
          brand: 'Ptah',
          onlyEn: 'English only',
        },
        Zeta: 'Upper case sorts first',
      }),
    );
    write(
      AR,
      JSON.stringify({
        governingLanguageNotice: 'النسخة الإنجليزية هي المعتمدة.',
        terms: {
          intro: 'استخدم <strong>Ptah</strong> | VS Code',
          seats: 'لعدد {{ count }} من المقاعد',
          brand: 'Ptah',
          onlyAr: 'عربي فقط',
        },
        Zeta: 'زيتا',
      }),
    );
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  describe('reviewNotes', () => {
    let glossary: Glossary;
    beforeEach(() => {
      glossary = loadGlossary(path.join(root, 'glossary.json'), 'g.json');
    });
    const entry = (value: string | null): TranslationEntry => ({
      key: 'k',
      value,
      line: 1,
    });

    it('lists presence, identity, glossary terms, placeholders and the legal notice in a fixed order', () => {
      expect(
        reviewNotes(
          LEGAL_NOTICE_KEY,
          entry('VS Code and Ptah for {{ n }} of {{ a }}'),
          entry('VS Code and Ptah for {{ n }} of {{ a }}'),
          glossary,
        ),
      ).toEqual([
        'identical to English',
        'glossary: Ptah, VS Code',
        'placeholders: a, n',
        'legal governing-language notice (8.4)',
      ]);
    });

    it('names a missing side and takes placeholders from Arabic when English is absent', () => {
      expect(reviewNotes('x.a', undefined, entry('{{ n }}'), glossary)).toEqual(
        ['missing in English', 'placeholders: n'],
      );
      expect(reviewNotes('x.a', entry('Hi'), undefined, glossary)).toEqual([
        'missing in Arabic',
      ]);
      expect(reviewNotes('x.a', entry('Hi'), entry('مرحبا'), glossary)).toEqual(
        [],
      );
    });
  });

  it('escapes Markdown and HTML in a cell so values show literally', () => {
    expect(tableCell('a | b')).toBe('a \\| b');
    expect(tableCell('<strong>x</strong> & *y*_z_')).toBe(
      '&lt;strong&gt;x&lt;/strong&gt; &amp; \\*y\\*\\_z\\_',
    );
    expect(tableCell('one\ntwo\\')).toBe('one<br>two\\\\');
    expect(tableCell('a\r\nb\u2028c\u2029d')).toBe('a<br>b<br>c<br>d');
    expect(tableCell('[link](u) `c` ~s~')).toBe(
      '\\[link\\](u) \\`c\\` \\~s\\~',
    );
  });

  it('generates a table sorted by key, with notes, byte-for-byte deterministic and Prettier-stable', async () => {
    const first = await generate(options());
    const second = await generate(options());
    expect(first.violations).toEqual([]);
    expect(second).toEqual(first);
    expect(first.files.map((f) => f.path)).toEqual([
      'copy-review/legal.md',
      'copy-review/glossary.md',
    ]);

    const table = first.files[0].content;
    const keyOrder = [...table.matchAll(/^\| `([^`]+)`/gm)].map((m) => m[1]);
    expect(keyOrder).toEqual([
      'legal.Zeta',
      'legal.governingLanguageNotice',
      'legal.terms.brand',
      'legal.terms.intro',
      'legal.terms.onlyAr',
      'legal.terms.onlyEn',
      'legal.terms.seats',
    ]);
    const row = (key: string): string =>
      table.split('\n').find((line) => line.startsWith(`| \`${key}\``)) ?? '';
    expect(row('legal.governingLanguageNotice')).toMatch(
      /\| legal governing-language notice \(8\.4\) +\|$/,
    );
    expect(row('legal.terms.brand')).toMatch(
      /identical to English; glossary: Ptah/,
    );
    expect(row('legal.terms.onlyAr')).toMatch(/missing in English/);
    expect(row('legal.terms.onlyEn')).toMatch(/missing in Arabic/);
    expect(row('legal.terms.intro')).toContain(
      '&lt;strong&gt;Ptah&lt;/strong&gt; \\| VS Code',
    );
    expect(row('legal.terms.seats')).toContain(
      'For {{ count }} seats<br>and \\*more\\*',
    );
    expect(table).toContain(`- English: \`${EN}\``);
    expect(table).toContain('- Keys: 7');

    const glossaryPage = first.files[1].content;
    expect(glossaryPage).toMatch(/\| Ptah +\| brand name +\|/);
    expect(glossaryPage.indexOf('| Ptah')).toBeLessThan(
      glossaryPage.indexOf('| VS Code'),
    );

    for (const file of first.files) {
      expect(
        await format(file.content, {
          parser: 'markdown',
          plugins: [markdownPlugin],
        }),
      ).toBe(file.content);
    }
  });

  it('writes the files, then --check passes on them and fails on drift', async () => {
    expect(await reviewTables(options())).toEqual({
      code: 0,
      lines: [
        'review-tables [legal]: wrote copy-review/legal.md',
        'review-tables [legal]: wrote copy-review/glossary.md',
      ],
    });
    const written = read('copy-review/legal.md');

    expect(await reviewTables(options({ check: true }))).toEqual({
      code: 0,
      lines: [
        'review-tables [legal]: OK (copy-review/legal.md, copy-review/glossary.md)',
      ],
    });

    // A translation change without a regeneration is drift.
    write(
      EN,
      read(EN).replace('English only', 'English only, edited after review'),
    );
    const drift = await reviewTables(options({ check: true }));
    expect(drift.code).toBe(1);
    expect(drift.lines).toEqual([
      'copy-review/legal.md: out of date with a fresh generation; rerun review-tables without --check and commit the result',
      'review-tables [legal]: 1 file(s) out of date',
    ]);
    // --check never writes.
    expect(read('copy-review/legal.md')).toBe(written);

    fs.rmSync(path.join(root, 'copy-review/glossary.md'));
    expect((await reviewTables(options({ check: true }))).lines).toContain(
      'copy-review/glossary.md: out of date with a fresh generation; rerun review-tables without --check and commit the result',
    );
  });

  describe('refusing to generate', () => {
    const expectRefused = async (expected: string[]): Promise<void> => {
      for (const check of [false, true]) {
        const result = await reviewTables(options({ check }));
        expect(result).toEqual({
          code: 1,
          lines: [
            ...expected,
            'review-tables [legal]: nothing generated; fix the violation(s) above first',
          ],
        });
      }
      expect(fs.existsSync(path.join(root, 'copy-review'))).toBe(false);
    };

    it('refuses a dotted key, naming it with file and line', async () => {
      write(EN, '{\n  "terms": { "a.b": "Dotted" }\n}\n');
      write(AR, '{\n  "terms": { "c": "ج" }\n}\n');
      await expectRefused([
        `${EN}:2: [dotted-key] legal.terms.a.b - a key segment must be non-empty and contain no "."`,
      ]);
    });

    it('refuses a duplicate key', async () => {
      write(EN, '{\n  "a": "One",\n  "a": "Two"\n}\n');
      write(AR, '{\n  "a": "واحد"\n}\n');
      await expectRefused([
        `${EN}:3: [duplicate-key] legal.a - the key is defined more than once in the same object`,
      ]);
    });

    it('refuses an invalid value in either file', async () => {
      write(EN, '{\n  "a": "One",\n  "b": 2\n}\n');
      write(AR, '{\n  "a": "",\n  "b": "اثنان"\n}\n');
      await expectRefused([
        `${AR}:2: [invalid-value] legal.a - the value is an empty string`,
        `${EN}:3: [invalid-value] legal.b - the value must be a non-empty string`,
      ]);
    });

    it('refuses a file whose only top-level key is default', async () => {
      write(EN, '{\n  "default": { "a": "One" }\n}\n');
      write(AR, '{\n  "default": { "a": "واحد" },\n  "b": "ب"\n}\n');
      await expectRefused([
        `${EN}:2: [sole-default-key] legal.default - the only top-level key is "default", which the i18n runtime treats as a JSON module wrapper; add a sibling key or rename it`,
      ]);
    });

    it('refuses an unreadable translation file or glossary', async () => {
      write(AR, '{ "terms": ');
      const result = await reviewTables(options());
      expect(result.code).toBe(1);
      expect(result.lines[0]).toMatch(
        new RegExp(`^${AR}:0: \\[parse-error\\]`),
      );
      expect(fs.existsSync(path.join(root, 'copy-review'))).toBe(false);

      write(AR, '{}');
      write('glossary.json', '{');
      expect((await reviewTables(options())).lines[0]).toMatch(
        /^glossary\.json:0: \[glossary-invalid\]/,
      );
    });

    it('reports a Prettier failure against the output file and writes nothing', async () => {
      write(EN, JSON.stringify({ a: 'PRETTIER_THROWS_HERE' }));
      write(AR, JSON.stringify({ a: 'نص' }));
      await expectRefused([
        'copy-review/legal.md:0: [format-error] - Prettier could not format the generated markdown for scope "legal": prettier exploded',
      ]);
    });
  });

  describe('parseArgs', () => {
    const base = [
      '--project-root',
      'libs/web/legal',
      '--scope',
      'legal',
      '--glossary',
      'g.json',
    ];

    it('parses valid arguments, --check anywhere, into resolved options', () => {
      expect(
        parseArgs([
          '--check',
          ...base,
          '--out',
          'out',
          '--workspace-root',
          root,
        ]),
      ).toEqual({
        workspaceRoot: root,
        projectRoot: 'libs/web/legal',
        scope: 'legal',
        glossary: 'g.json',
        out: 'out',
        check: true,
      });
      expect(parseArgs([...base, '--out', 'out']).check).toBe(false);
    });

    it('rejects a missing --out', () => {
      expect(() => parseArgs(base)).toThrow(
        new UsageError(
          '--project-root, --scope, --glossary and --out are required',
        ),
      );
      expect(() => parseArgs([...base, '--out'])).toThrow(
        new UsageError('--out needs a value'),
      );
    });

    it('rejects an unknown flag and a root of another scope', () => {
      expect(() => parseArgs([...base, '--out', 'o', '--force'])).toThrow(
        new UsageError('unknown argument "--force"'),
      );
      expect(() =>
        parseArgs([
          '--project-root',
          'libs/web/pricing',
          '--scope',
          'legal',
          '--glossary',
          'g.json',
          '--out',
          'o',
        ]),
      ).toThrow(UsageError);
    });
  });
});
