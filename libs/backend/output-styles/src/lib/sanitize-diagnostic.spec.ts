/**
 * The path-stripping pipeline is Req 7.6 security-relevant logic, and it used
 * to exist twice (`sanitizeDiagnostic` in `output-style-frontmatter.ts`,
 * `sanitizeDetail` in `claude-settings.writer.ts`) with two truncation caps.
 *
 * The first two blocks cover the pipeline itself. The third is a SHARING GUARD:
 * it reads both call sites' source and fails if either one grows its own
 * path-stripping regex again. Do not relax it — a second copy is exactly the
 * defect this file was created to remove.
 */
import { readFileSync } from 'fs';
import * as path from 'path';
import { sanitizeDiagnostic } from './sanitize-diagnostic';
import { toValidationError } from './output-style-frontmatter';

/** The cap `output-style-frontmatter.ts` passes. */
const FRONTMATTER_CAP = 120;
/** The cap `claude-settings.writer.ts` passes. */
const WRITER_CAP = 100;

const CALL_SITES = [
  ['output-style-frontmatter.ts', 'output-style-frontmatter.ts'],
  ['claude-settings.writer.ts', 'claude-settings.writer.ts'],
] as const;

describe('sanitizeDiagnostic — path stripping (Req 7.6)', () => {
  it.each([
    ['windows drive path', String.raw`open C:\Users\ada\.claude\settings.json`],
    ['windows forward-slash drive path', 'open C:/Users/ada/settings.json'],
    ['UNC path', String.raw`open \\build-01\share\settings.json`],
    ['posix path', 'open /home/ada/.claude/settings.json'],
    ['nested posix path', 'at /Users/ada/src/node_modules/pkg/index.js:12'],
  ])('replaces a %s with the placeholder', (_label, text) => {
    const result = sanitizeDiagnostic(text, FRONTMATTER_CAP);

    expect(result).toContain('<path>');
    expect(result).not.toMatch(/[A-Za-z]:[\\/]/);
    expect(result).not.toMatch(/\/home\//);
    expect(result).not.toMatch(/\/Users\//);
    expect(result).not.toContain('node_modules');
  });

  it('collapses every run of whitespace onto one line', () => {
    expect(sanitizeDiagnostic('a\n\tb   c \r\n', FRONTMATTER_CAP)).toBe(
      'a b c',
    );
  });

  it('leaves text with no path shape alone', () => {
    expect(
      sanitizeDiagnostic('unexpected end of the stream', FRONTMATTER_CAP),
    ).toBe('unexpected end of the stream');
  });

  it('returns an empty string for empty input', () => {
    expect(sanitizeDiagnostic('', FRONTMATTER_CAP)).toBe('');
    expect(sanitizeDiagnostic('   \n  ', FRONTMATTER_CAP)).toBe('');
  });
});

describe('sanitizeDiagnostic — truncation', () => {
  it.each([
    ['frontmatter', FRONTMATTER_CAP],
    ['writer', WRITER_CAP],
  ])('caps a %s-length message at its own limit', (_label, cap) => {
    const result = sanitizeDiagnostic('x'.repeat(cap * 2), cap);

    expect(result).toHaveLength(cap);
    expect(result.endsWith('…')).toBe(true);
  });

  it('leaves a message exactly at the cap untouched', () => {
    const exact = 'y'.repeat(WRITER_CAP);

    expect(sanitizeDiagnostic(exact, WRITER_CAP)).toBe(exact);
  });

  it('applies the cap AFTER stripping, so a path cannot buy length', () => {
    const text = `${'z'.repeat(WRITER_CAP - 10)} /home/ada/very/long/path/here`;

    expect(sanitizeDiagnostic(text, WRITER_CAP)).toBe(
      `${'z'.repeat(WRITER_CAP - 10)} <path>`,
    );
  });

  it('the two call sites differ ONLY in their cap', () => {
    const text = `${'q'.repeat(300)} at /home/ada/.claude/settings.json`;

    expect(sanitizeDiagnostic(text, WRITER_CAP)).toBe(
      `${sanitizeDiagnostic(text, FRONTMATTER_CAP).slice(0, WRITER_CAP - 1)}…`,
    );
  });
});

describe('sanitizeDiagnostic — both call sites share this pipeline', () => {
  it.each(CALL_SITES)('%s imports it and defines no copy', (_label, file) => {
    const source = readFileSync(path.resolve(__dirname, file), 'utf8');

    expect(source).toContain("from './sanitize-diagnostic'");
    // A local `<path>` replacement here means the pipeline forked again.
    expect(source).not.toContain("'<path>'");
    expect(source).not.toMatch(/replace\(\/\[A-Za-z\]:/);
  });

  it('is reachable through the frontmatter parser', () => {
    const cause = Object.assign(
      new Error(String.raw`bad indentation in C:\Users\ada\styles\terse.md`),
      { reason: String.raw`bad indentation in C:\Users\ada\styles\terse.md` },
    );

    const error = toValidationError(cause);

    expect(error.message).toContain('<path>');
    expect(error.message).not.toMatch(/[A-Za-z]:[\\/]/);
  });
});
