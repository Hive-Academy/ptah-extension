import {
  parseFileLinkHref,
  type MarkdownFileLinkTarget,
} from './file-link-target';

type Case = readonly [
  label: string,
  href: string,
  expected: MarkdownFileLinkTarget | null,
];

function expectCases(cases: readonly Case[]): void {
  it.each(cases)('%s', (_label, href, expected) => {
    expect(parseFileLinkHref(href)).toEqual(expected);
  });
}

describe('parseFileLinkHref', () => {
  describe('relative and POSIX paths', () => {
    expectCases([
      ['relative path', 'src/app/a.ts', { path: 'src/app/a.ts' }],
      ['dot-relative path', './a.ts', { path: './a.ts' }],
      [
        'parent-relative path with a line',
        '../lib/a.ts:12',
        { path: '../lib/a.ts', line: 12 },
      ],
      [
        'path with line and column',
        'a.ts:12:3',
        { path: 'a.ts', line: 12, column: 3 },
      ],
      [
        'dotless file name with a line',
        'Makefile:7',
        { path: 'Makefile', line: 7 },
      ],
      [
        'POSIX absolute path',
        '/home/u/project/a.ts',
        { path: '/home/u/project/a.ts' },
      ],
      [
        'POSIX absolute path with line and column',
        '/home/u/a.ts:40:2',
        { path: '/home/u/a.ts', line: 40, column: 2 },
      ],
      [
        'surrounding whitespace is trimmed',
        '  src/a.ts  ',
        { path: 'src/a.ts' },
      ],
    ]);
  });

  describe('percent-encoding', () => {
    expectCases([
      ['encoded space is decoded', 'src/a%20b.ts', { path: 'src/a b.ts' }],
      ['encoded hash is decoded', 'src/C%23/a.cs', { path: 'src/C#/a.cs' }],
      ['malformed escape is kept raw', '%E0%A4%A', { path: '%E0%A4%A' }],
      [
        'literal percent is kept raw',
        'C:\\100%done.txt',
        { path: 'C:\\100%done.txt' },
      ],
    ]);
  });

  describe('fragments', () => {
    expectCases([
      ['#L line', 'src/a.ts#L12', { path: 'src/a.ts', line: 12 }],
      [
        '#L line and column',
        'src/a.ts#L12C3',
        { path: 'src/a.ts', line: 12, column: 3 },
      ],
      [
        '#L range keeps the start line',
        'src/a.ts#L12-L20',
        { path: 'src/a.ts', line: 12 },
      ],
      [
        'any other fragment is stripped',
        'src/a.ts#section',
        { path: 'src/a.ts' },
      ],
      ['#L0 is not a position', 'src/a.ts#L0', { path: 'src/a.ts' }],
    ]);
  });

  describe('Windows drive and UNC paths', () => {
    expectCases([
      [
        'drive path with line and column',
        'C:\\a.ts:12:3',
        { path: 'C:\\a.ts', line: 12, column: 3 },
      ],
      [
        'lower-case drive with forward slashes',
        'c:/a.ts:7',
        { path: 'c:/a.ts', line: 7 },
      ],
      [
        'drive path with #L line and column',
        'C:\\a.ts#L12C3',
        { path: 'C:\\a.ts', line: 12, column: 3 },
      ],
      [
        'drive path with #L range',
        'C:\\a.ts#L12-L20',
        { path: 'C:\\a.ts', line: 12 },
      ],
      ['drive directory', 'D:\\repo\\src', { path: 'D:\\repo\\src' }],
      ['a drive alone is not a file', 'C:', null],
      ['drive-relative form is not a file', 'c:relative.ts', null],
      [
        'UNC path is kept for the backend to refuse',
        '\\\\server\\x',
        { path: '\\\\server\\x' },
      ],
    ]);
  });

  describe('file URLs', () => {
    expectCases([
      [
        'drive file URL is decoded',
        'file:///C:/a%20b.ts',
        { path: 'C:/a b.ts' },
      ],
      ['localhost file URL', 'file://localhost/C:/x', { path: 'C:/x' }],
      [
        'remote-host file URL is kept for the backend to refuse',
        'file://server/share/x',
        { path: '//server/share/x' },
      ],
      [
        'POSIX file URL with #L line',
        'file:///home/u/a.ts#L5',
        { path: '/home/u/a.ts', line: 5 },
      ],
      [
        'upper-case scheme with a line suffix',
        'FILE:///tmp/a.ts:3',
        { path: '/tmp/a.ts', line: 3 },
      ],
      [
        'drive file URL with line and column',
        'file:///C:/a.ts:12:3',
        { path: 'C:/a.ts', line: 12, column: 3 },
      ],
      ['encoded control character in a file URL', 'file:///tmp/a%00.ts', null],
    ]);
  });

  describe('line edge cases', () => {
    expectCases([
      ['trailing colon is not stripped', 'x.ts:12:', { path: 'x.ts:12:' }],
      ['line zero is not stripped', 'x.ts:0', { path: 'x.ts:0' }],
      [
        'line 10^7 is stripped',
        'x.ts:10000000',
        { path: 'x.ts', line: 10_000_000 },
      ],
      [
        'line above 10^7 is not stripped',
        'x.ts:10000001',
        { path: 'x.ts:10000001' },
      ],
      [
        'column zero keeps the suffix whole',
        'x.ts:12:0',
        { path: 'x.ts:12:0' },
      ],
      [
        'alternate data stream is kept whole',
        'a.ts:stream',
        { path: 'a.ts:stream' },
      ],
      [
        'drive path with a stream is kept whole',
        'C:\\a.ts:stream',
        { path: 'C:\\a.ts:stream' },
      ],
      ['a bare position is not stripped to nothing', ':12', { path: ':12' }],
    ]);
  });

  describe('not file links', () => {
    expectCases([
      ['empty', '', null],
      ['whitespace only', '   ', null],
      ['in-page anchor', '#anchor', null],
      ['query only', '?q=1', null],
      ['protocol-relative URL', '//host/x', null],
      ['http URL', 'http://example.com/a.ts', null],
      ['https URL', 'https://example.com', null],
      ['bare http scheme', 'http:', null],
      ['bare mailto scheme', 'mailto:', null],
      ['mailto address', 'mailto:a@example.com', null],
      ['bare javascript scheme', 'javascript:', null],
      ['javascript in mixed case', 'JaVaScRiPt:alert(1)', null],
      ['tel followed by digits', 'tel:5551234', null],
      ['other scheme', 'vscode:extension/x', null],
      ['NUL character', 'src/a\u0000.ts', null],
      ['embedded newline', 'src/a\n.ts', null],
      ['DEL character', 'src/a\u007f.ts', null],
      ['encoded NUL character', 'src/a%00.ts', null],
    ]);

    it('rejects input longer than 4096 characters', () => {
      expect(parseFileLinkHref('a'.repeat(4097))).toBeNull();
      expect(parseFileLinkHref('a'.repeat(4096))).toEqual({
        path: 'a'.repeat(4096),
      });
    });

    it('rejects null and undefined', () => {
      expect(parseFileLinkHref(null)).toBeNull();
      expect(parseFileLinkHref(undefined)).toBeNull();
    });
  });
});
