/**
 * Unit Tests for stripCommentsAndStrings
 *
 * Verifies the comment/string pre-processor used by regex-based anti-pattern
 * rules. The stripper must:
 * - Preserve total length, newlines, tabs, and per-line column positions.
 * - Replace line/block comment contents with spaces.
 * - Replace static string-literal contents with spaces (single, double, template).
 * - Preserve `${expr}` expressions inside template literals.
 * - Handle unterminated strings/comments without throwing or hanging.
 * - Distinguish regex literals from division via a documented heuristic.
 *
 * TASK_2025_291 Wave B (B3)
 */

import { stripCommentsAndStrings } from './strip-comments-and-strings';

describe('stripCommentsAndStrings', () => {
  // ============================================
  // Invariants
  // ============================================

  describe('invariants', () => {
    it('returns a string of identical length to the input', () => {
      const inputs = [
        '',
        'const x = 1;',
        '// comment only',
        '"just a string"',
        '`template ${expr} done`',
        '/* block */ code /* block */',
        'const s = \'mixed "quotes" inside\';',
      ];
      inputs.forEach((input) => {
        expect(stripCommentsAndStrings(input)).toHaveLength(input.length);
      });
    });

    it('preserves newline positions exactly', () => {
      const input = 'a\nb\nc\n"multi\nline"\nd';
      const output = stripCommentsAndStrings(input);
      // All \n characters must be at the same indices
      for (let i = 0; i < input.length; i++) {
        if (input[i] === '\n') {
          expect(output[i]).toBe('\n');
        }
      }
    });

    it('preserves tab characters inside stripped regions', () => {
      const input = '"hello\tworld"';
      const output = stripCommentsAndStrings(input);
      // The tab at index 6 must still be a tab in the output.
      expect(output[6]).toBe('\t');
    });

    it('preserves line count across comments and strings', () => {
      const input = [
        'line1',
        '// line2 comment',
        '/* line3',
        '   line4 */',
        '"line5 string"',
        '`line6',
        ' line7`',
        'line8',
      ].join('\n');
      expect(stripCommentsAndStrings(input).split('\n')).toHaveLength(
        input.split('\n').length,
      );
    });
  });

  // ============================================
  // Required test cases from the task spec
  // ============================================

  describe('required task cases', () => {
    it('strips `any` from a line comment while preserving line position', () => {
      const input = '// TODO: fix the any here\nconst x: number = 1;';
      const output = stripCommentsAndStrings(input);

      // The word `any` must be gone from the stripped output.
      expect(output).not.toMatch(/\bany\b/);
      // Newline must still be at index 25 (length of the original first line).
      expect(output.indexOf('\n')).toBe(input.indexOf('\n'));
      // Code on the next line must be untouched.
      expect(output.split('\n')[1]).toBe('const x: number = 1;');
    });

    it('replaces double-quoted string content with filler', () => {
      const input = 'const x = "// not a comment";';
      const output = stripCommentsAndStrings(input);

      // Length and outer structure preserved; inner content becomes spaces.
      expect(output).toHaveLength(input.length);
      expect(output.startsWith('const x = "')).toBe(true);
      expect(output.endsWith('";')).toBe(true);
      // No `//` should remain anywhere (it was inside the string).
      expect(output.indexOf('//')).toBe(-1);
    });

    it('replaces single-quoted string content with filler', () => {
      const input = "const x = 'inner stuff';";
      const output = stripCommentsAndStrings(input);
      expect(output).toHaveLength(input.length);
      expect(output.slice(0, 11)).toBe("const x = '");
      expect(output.slice(11, 22)).toBe('           '); // 11 spaces for inner chars
      expect(output.slice(22)).toBe("';");
    });

    it('preserves `${expr}` inside a template literal while stripping static parts', () => {
      const input = '`hello ${world}`';
      const output = stripCommentsAndStrings(input);

      expect(output).toHaveLength(input.length);
      // Expression is preserved intact.
      expect(output).toContain('${world}');
      // Static `hello ` becomes spaces.
      expect(output.slice(1, 7)).toBe('      ');
    });

    it('preserves multiple `${expr}` segments in a template', () => {
      const input = '`a ${x + y} b ${z} c`';
      const output = stripCommentsAndStrings(input);

      expect(output).toHaveLength(input.length);
      expect(output).toContain('${x + y}');
      expect(output).toContain('${z}');
    });

    it('handles nested `/* block /* nested */ still */` per spec', () => {
      // JS/TS grammar: block comments do NOT nest. The first `*/` closes the
      // comment and `still */` is re-parsed as code. The stripper mirrors this.
      const input = '/* block /* nested */ still */';
      const output = stripCommentsAndStrings(input);

      expect(output).toHaveLength(input.length);
      // The delimiters `/*` and the closing `*/` are preserved; the body
      // between them becomes whitespace. `still` is outside the closed
      // comment and remains as-is.
      expect(output.startsWith('/*')).toBe(true);
      expect(output.slice(2, 19)).toBe(' '.repeat(17));
      expect(output.slice(19, 21)).toBe('*/');
      expect(output.slice(21)).toBe(' still */');
      // None of the words `block` or `nested` should remain.
      expect(output.indexOf('block')).toBe(-1);
      expect(output.indexOf('nested')).toBe(-1);
    });

    it('does not hang or throw on an unterminated string at EOF', () => {
      const input = 'const x = "never closed';
      expect(() => stripCommentsAndStrings(input)).not.toThrow();
      const output = stripCommentsAndStrings(input);
      expect(output).toHaveLength(input.length);
      // The `"never closed` content is blanked.
      expect(output).toBe('const x = "            ');
    });

    it('does not hang or throw on an unterminated block comment at EOF', () => {
      const input = 'code /* unterminated block';
      expect(() => stripCommentsAndStrings(input)).not.toThrow();
      const output = stripCommentsAndStrings(input);
      expect(output).toHaveLength(input.length);
    });

    it('does not hang or throw on an unterminated template literal at EOF', () => {
      const input = '`hello ${name}';
      expect(() => stripCommentsAndStrings(input)).not.toThrow();
      const output = stripCommentsAndStrings(input);
      expect(output).toHaveLength(input.length);
    });
  });

  // ============================================
  // Regex-vs-division heuristic
  // ============================================

  describe('regex vs division heuristic', () => {
    it('treats `/foo/g` after `=` as a regex literal and strips its content', () => {
      const input = 'const r = /foo/g;';
      const output = stripCommentsAndStrings(input);
      // Inner `foo` replaced, flags `g` and delimiters preserved, length intact.
      expect(output).toHaveLength(input.length);
      expect(output.indexOf('foo')).toBe(-1);
      expect(output.endsWith('/g;')).toBe(true);
      // The opening `/` remains at the same column.
      expect(output.indexOf('/')).toBe(input.indexOf('/'));
    });

    it('treats `a / b` as division (does NOT strip)', () => {
      const input = 'const q = a / b;';
      const output = stripCommentsAndStrings(input);
      expect(output).toBe(input);
    });

    it('treats `arr[0] / 2` as division', () => {
      const input = 'const q = arr[0] / 2;';
      const output = stripCommentsAndStrings(input);
      expect(output).toBe(input);
    });

    it('treats `return /pattern/` as regex', () => {
      const input = 'return /pattern/;';
      const output = stripCommentsAndStrings(input);
      expect(output.indexOf('pattern')).toBe(-1);
      expect(output).toHaveLength(input.length);
    });

    it('handles regex character classes with `/` inside', () => {
      const input = 'const r = /[a/b]/;';
      const output = stripCommentsAndStrings(input);
      expect(output).toHaveLength(input.length);
      // `a/b` inside the char class must be stripped.
      expect(output.indexOf('a/b')).toBe(-1);
    });
  });

  // ============================================
  // Line/column preservation
  // ============================================

  describe('line and column preservation', () => {
    it('preserves the column of the first non-blanked character on each line', () => {
      const input = [
        '// TODO: any',
        'const x: any = 1;',
        '/* block */ const y: any = 2;',
      ].join('\n');
      const output = stripCommentsAndStrings(input);
      const inLines = input.split('\n');
      const outLines = output.split('\n');

      // Line 2: `const x: any = 1;` is unchanged.
      expect(outLines[1]).toBe(inLines[1]);

      // Line 3: the block comment region is blanked, but `const y: any = 2;`
      // still starts at its original column 12.
      expect(outLines[2].indexOf('const y')).toBe(
        inLines[2].indexOf('const y'),
      );
    });

    it('keeps column of `any` intact on a line where it is real code', () => {
      const input = 'function f(x: any) { return x; } // fallback for any';
      const output = stripCommentsAndStrings(input);
      // The real `any` at the type annotation position is preserved.
      expect(output.indexOf(': any')).toBe(input.indexOf(': any'));
      // The `any` in the comment must be gone.
      const afterComment = output.slice(input.indexOf('//'));
      expect(afterComment.indexOf('any')).toBe(-1);
    });
  });

  // ============================================
  // Escape handling
  // ============================================

  describe('escape handling', () => {
    it('blanks escape sequences inside strings (both chars)', () => {
      const input = '"a\\nb"';
      const output = stripCommentsAndStrings(input);
      expect(output).toHaveLength(input.length);
      expect(output).toBe('"    "');
    });

    it('handles escaped quote inside a string without terminating early', () => {
      const input = '"she said \\"hi\\""';
      const output = stripCommentsAndStrings(input);
      expect(output).toHaveLength(input.length);
      // The whole interior is blanked — nothing matchable remains.
      expect(output).toBe('"               "');
    });

    it('handles escaped backtick inside a template literal', () => {
      const input = '`a\\`b`';
      const output = stripCommentsAndStrings(input);
      expect(output).toHaveLength(input.length);
    });
  });
});
