import {
  CAMEL_CASE_FIXTURE,
  DERIVED_DESCRIPTION_FIXTURE,
  KEEP_INSTRUCTIONS_ABSENT_FIXTURE,
  KEEP_INSTRUCTIONS_FALSE_FIXTURE,
  LONG_BODY_FIXTURE,
  MALFORMED_YAML_FIXTURE,
  NO_FRONTMATTER_FIXTURE,
  STE_FILE_NAME,
  STE_FIXTURE,
  UNRECOGNIZED_KEY_FIXTURE,
  WRONG_TYPE_FIXTURE,
} from './__fixtures__/output-style.fixtures';
import {
  deriveDescription,
  normalizeFrontmatterKeys,
  parseOutputStyleFile,
  serializeOutputStyleFile,
  type ParsedOutputStyle,
} from './output-style-frontmatter';
import { OUTPUT_STYLE_FRONTMATTER_KEYS } from './output-style-frontmatter.schema';

function parseOk(content: string, fileName: string): ParsedOutputStyle {
  const result = parseOutputStyleFile(content, fileName);
  if (!result.ok) {
    throw new Error(`expected a parse, got ${result.error.code}`);
  }
  return result.style;
}

function parseErr(content: string, fileName: string) {
  const result = parseOutputStyleFile(content, fileName);
  if (result.ok) throw new Error('expected a validation error');
  return result.error;
}

describe('parseOutputStyleFile', () => {
  describe('strict schema (Req 7.2)', () => {
    it('rejects a fifth key and NAMES it', () => {
      const error = parseErr(UNRECOGNIZED_KEY_FIXTURE, 'themed.md');
      expect(error.code).toBe('UNRECOGNIZED_KEY');
      if (error.code !== 'UNRECOGNIZED_KEY') return;
      expect(error.key).toBe('theme');
      expect(error.validKeys).toEqual([...OUTPUT_STYLE_FRONTMATTER_KEYS]);
      expect(error.message).toContain('"theme"');
      for (const key of OUTPUT_STYLE_FRONTMATTER_KEYS) {
        expect(error.message).toContain(key);
      }
    });

    it('accepts all four valid keys', () => {
      const style = parseOk(
        [
          '---',
          'name: Four',
          'description: All four keys.',
          'keep-coding-instructions: true',
          'force-for-plugin: false',
          '---',
          '',
          'Body.',
        ].join('\n'),
        'four.md',
      );
      expect(style.name).toBe('Four');
      expect(style.keepCodingInstructions).toBe(true);
    });

    it('reports a known key holding the wrong type as INVALID_VALUE', () => {
      const error = parseErr(WRONG_TYPE_FIXTURE, 'typed.md');
      expect(error.code).toBe('INVALID_VALUE');
      if (error.code !== 'INVALID_VALUE') return;
      expect(error.key).toBe('keep-coding-instructions');
    });
  });

  describe('name resolution (E1, Req 8.2)', () => {
    it('prefers the frontmatter name over the filename', () => {
      const style = parseOk(STE_FIXTURE, STE_FILE_NAME);
      expect(style.name).toBe('Simplified Technical English');
    });

    it('falls back to the filename without .md when name is absent', () => {
      const style = parseOk(NO_FRONTMATTER_FIXTURE, 'my-plain-style.md');
      expect(style.name).toBe('my-plain-style');
    });

    it('falls back when name is present but blank', () => {
      const style = parseOk(
        '---\nname: "   "\n---\n\nBody.\n',
        'fallback-name.md',
      );
      expect(style.name).toBe('fallback-name');
    });
  });

  describe('key normalisation (§5.3)', () => {
    it('accepts the camelCase spelling the SDK normalises on read', () => {
      const camel = parseOk(CAMEL_CASE_FIXTURE, 'camel.md');
      expect(camel.keepCodingInstructions).toBe(true);
    });

    it('parses camelCase identically to the kebab form', () => {
      const kebab = parseOk(
        CAMEL_CASE_FIXTURE.replace(
          'keepCodingInstructions:',
          'keep-coding-instructions:',
        ),
        'camel.md',
      );
      const camel = parseOk(CAMEL_CASE_FIXTURE, 'camel.md');
      expect(camel).toEqual(kebab);
    });

    it('folds only the two known camelCase keys', () => {
      expect(
        normalizeFrontmatterKeys({
          keepCodingInstructions: true,
          forceForPlugin: false,
          somethingElse: 1,
        }),
      ).toEqual({
        'keep-coding-instructions': true,
        'force-for-plugin': false,
        somethingElse: 1,
      });
    });

    it('lets the canonical kebab value win when both spellings are present', () => {
      expect(
        normalizeFrontmatterKeys({
          'keep-coding-instructions': false,
          keepCodingInstructions: true,
        }),
      ).toEqual({ 'keep-coding-instructions': false });
    });
  });

  describe('keep-coding-instructions semantics (Req 6)', () => {
    it('is false when the key is absent', () => {
      expect(
        parseOk(KEEP_INSTRUCTIONS_ABSENT_FIXTURE, 'replaces.md')
          .keepCodingInstructions,
      ).toBe(false);
    });

    it('is false when the key is explicitly false', () => {
      expect(
        parseOk(KEEP_INSTRUCTIONS_FALSE_FIXTURE, 'replaces-explicitly.md')
          .keepCodingInstructions,
      ).toBe(false);
    });

    it('is true for the reference fixture (Req 8.4)', () => {
      expect(parseOk(STE_FIXTURE, STE_FILE_NAME).keepCodingInstructions).toBe(
        true,
      );
    });
  });

  describe('description (Req 1.4)', () => {
    it('uses the frontmatter description when present', () => {
      expect(parseOk(STE_FIXTURE, STE_FILE_NAME).description).toContain(
        'ASD-STE100',
      );
    });

    it('derives the first non-heading paragraph when absent', () => {
      const style = parseOk(DERIVED_DESCRIPTION_FIXTURE, 'terse.md');
      expect(style.description).toBe(
        'Keep every answer to the shortest form that still answers the question.',
      );
      expect(style.description).not.toContain('second paragraph');
    });

    it('caps a derived description at 160 characters', () => {
      const style = parseOk(LONG_BODY_FIXTURE, 'verbose.md');
      expect(style.description.length).toBeLessThanOrEqual(160);
    });

    it('collapses a multi-line paragraph to one line', () => {
      expect(deriveDescription('# Heading\n\nline one\nline two\n\nnext')).toBe(
        'line one line two',
      );
    });

    it('never returns an empty description', () => {
      expect(deriveDescription('')).not.toBe('');
      expect(deriveDescription('# Only a heading\n')).not.toBe('');
    });
  });

  describe('malformed YAML (Req 7.3)', () => {
    it('reports YAML_PARSE with a line number', () => {
      const error = parseErr(MALFORMED_YAML_FIXTURE, 'broken.md');
      expect(error.code).toBe('YAML_PARSE');
      if (error.code !== 'YAML_PARSE') return;
      expect(typeof error.line).toBe('number');
      expect(error.line).toBeGreaterThanOrEqual(1);
      expect(error.message).toContain('line');
    });

    it('is deterministic across repeated calls on identical bytes', () => {
      // gray-matter's module-global cache would otherwise return `{}` on the
      // second call and turn this into a different diagnosis entirely.
      const first = parseErr(MALFORMED_YAML_FIXTURE, 'broken.md');
      const second = parseErr(MALFORMED_YAML_FIXTURE, 'broken.md');
      const third = parseErr(MALFORMED_YAML_FIXTURE, 'broken.md');
      expect(second).toEqual(first);
      expect(third).toEqual(first);
    });
  });

  describe('sanitised diagnostics (Req 7.6)', () => {
    const hostPaths = [
      /[A-Za-z]:[\\/]/,
      /\/home\//,
      /\/Users\//,
      /node_modules/,
    ];

    it.each([
      ['unrecognized key', UNRECOGNIZED_KEY_FIXTURE],
      ['malformed yaml', MALFORMED_YAML_FIXTURE],
      ['wrong type', WRONG_TYPE_FIXTURE],
    ])('leaks no host path for %s', (_label, fixture) => {
      const error = parseErr(fixture, 'x.md');
      for (const pattern of hostPaths) {
        expect(error.message).not.toMatch(pattern);
      }
      expect(error.message).not.toContain('\n');
    });
  });
});

describe('serializeOutputStyleFile', () => {
  const input = {
    name: 'Round Trip',
    description: 'A style that survives a round trip.',
    keepCodingInstructions: true,
    body: '# Heading\n\nA body with `---` inside a sentence and a trailing list:\n\n- one\n- two',
  };

  it('emits kebab-case keys', () => {
    const text = serializeOutputStyleFile(input);
    expect(text).toContain('keep-coding-instructions: true');
    expect(text).not.toContain('keepCodingInstructions');
  });

  it('round-trips the body byte-for-byte (Req 4.3)', () => {
    const parsed = parseOk(serializeOutputStyleFile(input), 'round-trip.md');
    expect(parsed.body).toBe(input.body);
    expect(parsed.name).toBe(input.name);
    expect(parsed.description).toBe(input.description);
    expect(parsed.keepCodingInstructions).toBe(true);
  });

  it('does not accumulate blank lines across repeated saves', () => {
    let text = serializeOutputStyleFile(input);
    for (let i = 0; i < 5; i++) {
      const parsed = parseOk(text, 'round-trip.md');
      text = serializeOutputStyleFile({
        name: parsed.name,
        description: parsed.description,
        keepCodingInstructions: parsed.keepCodingInstructions,
        body: parsed.body,
      });
    }
    expect(text).toBe(serializeOutputStyleFile(input));
  });

  it('never writes force-for-plugin (E7)', () => {
    expect(serializeOutputStyleFile(input)).not.toContain('force-for-plugin');
  });
});
