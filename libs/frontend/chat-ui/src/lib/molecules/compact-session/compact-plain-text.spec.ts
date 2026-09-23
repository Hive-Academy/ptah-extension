import { stripMarkdownToPlainText } from './compact-plain-text';

describe('stripMarkdownToPlainText', () => {
  it('returns empty string for null, undefined, or empty string', () => {
    expect(stripMarkdownToPlainText(null)).toBe('');
    expect(stripMarkdownToPlainText(undefined)).toBe('');
    expect(stripMarkdownToPlainText('')).toBe('');
    expect(stripMarkdownToPlainText('   ')).toBe('');
  });

  it('strips a table separator run inside an already-joined line', () => {
    expect(
      stripMarkdownToPlainText(
        '## Where this leaves things | | |---|---| | a | b |',
      ),
    ).toBe('Where this leaves things a b');
    expect(stripMarkdownToPlainText('keep | x | y | pipes')).toBe(
      'keep x y pipes',
    );
  });

  it('strips heading hashes from line start', () => {
    expect(stripMarkdownToPlainText('# Heading 1')).toBe('Heading 1');
    expect(stripMarkdownToPlainText('## Where this leaves things')).toBe(
      'Where this leaves things',
    );
    expect(stripMarkdownToPlainText('### Level 3')).toBe('Level 3');
  });

  it('strips emphasis (bold and italic) markers', () => {
    expect(stripMarkdownToPlainText('This is **bold** text')).toBe(
      'This is bold text',
    );
    expect(stripMarkdownToPlainText('This is __bold__ text')).toBe(
      'This is bold text',
    );
    expect(stripMarkdownToPlainText('This is *italic* text')).toBe(
      'This is italic text',
    );
    expect(stripMarkdownToPlainText('This is _italic_ text')).toBe(
      'This is italic text',
    );
    expect(stripMarkdownToPlainText('__b__')).toBe('b');
    expect(stripMarkdownToPlainText('_it_')).toBe('it');
    expect(stripMarkdownToPlainText('*it*')).toBe('it');
  });

  it('preserves code identifiers, environment variables, globs, and arithmetic expressions', () => {
    expect(stripMarkdownToPlainText('snake_case_name')).toBe('snake_case_name');
    expect(stripMarkdownToPlainText('PTAH_API_KEY')).toBe('PTAH_API_KEY');
    expect(stripMarkdownToPlainText('rm *.ts && ls *.js')).toBe(
      'rm *.ts && ls *.js',
    );
    expect(stripMarkdownToPlainText('2 * 3 * 4')).toBe('2 * 3 * 4');
  });

  it('strips inline and fenced code ticks while preserving content', () => {
    expect(
      stripMarkdownToPlainText('Fixed `terminalReason` null narrow helper'),
    ).toBe('Fixed terminalReason null narrow helper');
    expect(stripMarkdownToPlainText('```typescript\nconst x = 1;\n```')).toBe(
      'const x = 1;',
    );
  });

  it('strips link syntax [text](url) -> text', () => {
    expect(
      stripMarkdownToPlainText('Read [the docs](https://ptah.dev) now'),
    ).toBe('Read the docs now');
  });

  it('strips image syntax ![alt](url) -> alt', () => {
    expect(
      stripMarkdownToPlainText(
        'Preview ![diagram](https://ptah.dev/d.png) here',
      ),
    ).toBe('Preview diagram here');
  });

  it('strips table separator rows and replaces pipes with spaces', () => {
    const table = `| Col A | Col B |
|---|---|
| Val 1 | Val 2 |`;
    expect(stripMarkdownToPlainText(table)).toBe('Col A Col B Val 1 Val 2');

    const tableWithColons = `| Name | Value |
|:---|---:|
| Foo | Bar |`;
    expect(stripMarkdownToPlainText(tableWithColons)).toBe(
      'Name Value Foo Bar',
    );
  });

  it('strips list bullets and numbers at line start', () => {
    const list = `- First item
* Second item
+ Third item
1. Fourth item
2. Fifth item`;
    expect(stripMarkdownToPlainText(list)).toBe(
      'First item Second item Third item Fourth item Fifth item',
    );
  });

  it('strips blockquote markers at line start', () => {
    expect(stripMarkdownToPlainText('> Important decision noted')).toBe(
      'Important decision noted',
    );
  });

  it('collapses multiline whitespace and leaves plain text intact', () => {
    const raw = `  Exit code 1:

      3 test suites failed
    `;
    expect(stripMarkdownToPlainText(raw)).toBe(
      'Exit code 1: 3 test suites failed',
    );
  });

  it('finishes in under 50ms for a 20k-character string without catastrophic backtracking', () => {
    const chunk = '|--|||::---|-*__**[[[()()';
    const longString = chunk.repeat(Math.ceil(20_000 / chunk.length));

    // Warm-up regexes to avoid one-off cold JIT compilation skew
    stripMarkdownToPlainText(longString);

    const start = performance.now();
    const result = stripMarkdownToPlainText(longString);
    const duration = performance.now() - start;

    expect(typeof result).toBe('string');
    expect(duration).toBeLessThan(50);
  });
});
