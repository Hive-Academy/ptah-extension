/**
 * Integration Tests for the Strip Pre-Processor + Regex Rules
 *
 * Verifies that regex-based rules (built via `createRegexRule`) now correctly
 * ignore matches that sit inside comments or string literals, thanks to the
 * `stripCommentsAndStrings` pre-processor wired into `rule-base.ts`.
 *
 * Before the B3 change:
 *  - `// TODO: fix the any` could falsely match `: any` when surrounded by
 *    loose whitespace.
 *  - `"pattern: any is banned"` in a string literal could falsely match too.
 *
 * After the B3 change:
 *  - Matches inside comments and strings are suppressed.
 *  - Reported line/column for real matches is unchanged.
 *  - Rules whose subject IS a comment (e.g. `@ts-ignore`) opt out via
 *    `matchInCommentsAndStrings: true`.
 *
 * Note: `rule.detect(...)` returns `MaybeAsync<AntiPatternMatch[]>` after
 * TASK_2025_291 B2, so every call is awaited via `Promise.resolve(...)`.
 *
 * TASK_2025_291 Wave B (B3)
 */

import type { AntiPatternMatch } from '@ptah-extension/shared';
import { explicitAnyRule, tsIgnoreRule } from './typescript-rules';

/** Resolve a possibly-sync detect() result. */
const runDetect = async (
  rule: typeof explicitAnyRule,
  content: string,
  filePath = 'test.ts',
): Promise<AntiPatternMatch[]> =>
  Promise.resolve(rule.detect(content, filePath));

describe('Regex rules ignore matches inside comments and strings (integration)', () => {
  describe('explicitAnyRule', () => {
    it('does NOT match `: any` that appears inside a line comment', async () => {
      const content = [
        '// TODO: change signature to use : any as fallback',
        'function safe(x: number): number { return x; }',
      ].join('\n');
      const matches = await runDetect(explicitAnyRule, content);
      expect(matches).toHaveLength(0);
    });

    it('does NOT match `: any` that appears inside a block comment', async () => {
      const content = [
        '/*',
        ' * Example: function f(x: any) { ... }',
        ' */',
        'function real(x: number): number { return x; }',
      ].join('\n');
      const matches = await runDetect(explicitAnyRule, content);
      expect(matches).toHaveLength(0);
    });

    it('does NOT match `: any` that appears inside a string literal', async () => {
      const content = 'const msg = "signature: any is banned";';
      const matches = await runDetect(explicitAnyRule, content);
      expect(matches).toHaveLength(0);
    });

    it('DOES still match a real `: any` on a line that also has a comment', async () => {
      const content = 'function f(x: any) { /* comment with : any inside */ }';
      const matches = await runDetect(explicitAnyRule, content);
      expect(matches).toHaveLength(1);
      // Column of the real match must point at the type annotation in the
      // ORIGINAL source.
      expect(matches[0].location.line).toBe(1);
      const expectedCol = content.indexOf(': any') + 1;
      expect(matches[0].location.column).toBe(expectedCol);
      expect(matches[0].matchedText).toBe(': any');
    });

    it('preserves correct line numbers across a multi-line block comment', async () => {
      const content = [
        '/* line1', // 1
        '   line2', // 2
        '   line3 */', // 3
        'function real(x: any) { return x; }', // 4
      ].join('\n');
      const matches = await runDetect(explicitAnyRule, content);
      expect(matches).toHaveLength(1);
      expect(matches[0].location.line).toBe(4);
    });

    it('preserves `${expr}` expression contents so real violations inside template placeholders are still detected', async () => {
      // The stripper leaves `${...}` expression bodies intact. So a real
      // `: any` type annotation inside a template placeholder (unusual but
      // legal) still reaches the rule.
      const content = 'const msg = `value: ${(obj as { foo: any }).foo}`;';
      const matches = await runDetect(explicitAnyRule, content);
      expect(matches).toHaveLength(1);
      expect(matches[0].matchedText).toBe(': any');
    });
  });

  describe('tsIgnoreRule (matchInCommentsAndStrings opt-out)', () => {
    it('still matches `@ts-ignore` in a real line comment', async () => {
      // This rule opts out of stripping because its SUBJECT is a comment
      // directive. Without the opt-out, the stripper would blank the
      // directive before the regex ever sees it.
      const content = '// @ts-ignore\nconst bad = wrong();';
      const matches = await runDetect(tsIgnoreRule, content);
      expect(matches).toHaveLength(1);
      expect(matches[0].location.line).toBe(1);
    });

    it('matches `@ts-nocheck` at the top of a file', async () => {
      const content = '// @ts-nocheck\nconst x = 1;';
      const matches = await runDetect(tsIgnoreRule, content);
      expect(matches).toHaveLength(1);
    });

    it('also reports `@ts-ignore` inside a string literal (known trade-off of opt-out)', async () => {
      // With `matchInCommentsAndStrings: true`, the rule scans raw source,
      // so a string that literally contains `@ts-ignore` will be flagged.
      // This is an acceptable trade-off — the directive is extremely unlikely
      // to appear verbatim in a string that isn't discussing the directive.
      const content = 'const doc = "write @ts-ignore above the line";';
      const matches = await runDetect(tsIgnoreRule, content);
      expect(matches).toHaveLength(1);
    });
  });
});
