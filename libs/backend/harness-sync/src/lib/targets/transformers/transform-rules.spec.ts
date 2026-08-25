import {
  extractAgentId,
  extractFrontmatterDescription,
  resolveAgentDescription,
  rewriteFrontmatter,
  stripFrontmatter,
  yamlDoubleQuoted,
} from './transform-rules';

describe('transform-rules', () => {
  describe('extractAgentId', () => {
    it('extracts the slug from a posix agent path', () => {
      expect(extractAgentId('.claude/agents/backend-developer.md')).toBe(
        'backend-developer',
      );
    });

    it('extracts the slug from a windows agent path', () => {
      expect(
        extractAgentId('D:\\workspace\\.claude\\agents\\frontend-developer.md'),
      ).toBe('frontend-developer');
    });
  });

  describe('stripFrontmatter', () => {
    it('removes a leading frontmatter block', () => {
      const content = '---\nname: x\ndescription: y\n---\n# Body';
      expect(stripFrontmatter(content)).toBe('# Body');
    });

    it('returns content unchanged when no frontmatter is present', () => {
      const content = '# Just a body';
      expect(stripFrontmatter(content)).toBe('# Just a body');
    });
  });

  describe('extractFrontmatterDescription', () => {
    it('unquotes a YAML double-quoted description', () => {
      const content =
        '---\nname: backend-developer\ndescription: "Backend developer for Ptah\'s Nx monorepo: NestJS"\nmodel: opus\n---\n\n## Body';
      expect(extractFrontmatterDescription(content)).toBe(
        "Backend developer for Ptah's Nx monorepo: NestJS",
      );
    });

    it('unescapes inner double-quotes emitted by the orchestrator', () => {
      // orchestrator.service.ts writes `\"` for inner quotes (safeDescription)
      const content =
        '---\nname: x\ndescription: "He said \\"hi\\" to me"\n---\nBody';
      expect(extractFrontmatterDescription(content)).toBe('He said "hi" to me');
    });

    it('unescapes backslashes in a double-quoted description', () => {
      const content =
        '---\nname: x\ndescription: "path\\\\to\\\\thing"\n---\nBody';
      expect(extractFrontmatterDescription(content)).toBe('path\\to\\thing');
    });

    it('unquotes a YAML single-quoted description and unescapes doubled quotes', () => {
      const content = "---\nname: x\ndescription: 'It''s alive'\n---\nBody";
      expect(extractFrontmatterDescription(content)).toBe("It's alive");
    });

    it('returns an unquoted description verbatim', () => {
      const content =
        '---\nname: figma-designer\ndescription: Figma Designer agent for UI\n---\nBody';
      expect(extractFrontmatterDescription(content)).toBe(
        'Figma Designer agent for UI',
      );
    });

    it('returns undefined when no frontmatter is present', () => {
      expect(extractFrontmatterDescription('# No frontmatter')).toBeUndefined();
    });

    it('returns undefined when the description field is missing', () => {
      const content = '---\nname: x\n---\nBody';
      expect(extractFrontmatterDescription(content)).toBeUndefined();
    });

    it('handles CRLF line endings', () => {
      const content =
        '---\r\nname: x\r\ndescription: "CRLF safe"\r\n---\r\nBody';
      expect(extractFrontmatterDescription(content)).toBe('CRLF safe');
    });

    it('does not strip quotes that only appear on one side', () => {
      const content =
        '---\nname: x\ndescription: "only leading quote\n---\nBody';
      expect(extractFrontmatterDescription(content)).toBe(
        '"only leading quote',
      );
    });
  });

  describe('resolveAgentDescription', () => {
    it('prefers the frontmatter description over variables', () => {
      const content =
        '---\nname: x\ndescription: "From frontmatter"\n---\nBody';
      expect(
        resolveAgentDescription(
          content,
          { description: 'from variables' },
          'x',
        ),
      ).toBe('From frontmatter');
    });

    it('falls back to variables when no frontmatter is present', () => {
      expect(
        resolveAgentDescription('# no frontmatter', { description: 'V' }, 'x'),
      ).toBe('V');
    });

    it('falls back to the agent-id default when nothing is set', () => {
      expect(resolveAgentDescription('# no frontmatter', undefined, 'x')).toBe(
        'x agent',
      );
    });

    it('falls back to the default when variables has no description key', () => {
      const content = '---\nname: x\n---\nBody';
      expect(resolveAgentDescription(content, {}, 'x')).toBe('x agent');
    });

    it('reads the real description even when variables.description is unset (wizard path)', () => {
      const content =
        '---\nname: backend-developer\ndescription: "Backend dev for NestJS"\n---\nBody';
      expect(
        resolveAgentDescription(content, undefined, 'backend-developer'),
      ).toBe('Backend dev for NestJS');
    });
  });

  describe('yamlDoubleQuoted', () => {
    it('wraps a plain value in double quotes', () => {
      expect(yamlDoubleQuoted('hello')).toBe('"hello"');
    });

    it('escapes embedded double quotes', () => {
      expect(yamlDoubleQuoted('He said "hi"')).toBe('"He said \\"hi\\""');
    });

    it('escapes backslashes', () => {
      expect(yamlDoubleQuoted('path\\to')).toBe('"path\\\\to"');
    });

    it('collapses newlines to spaces', () => {
      expect(yamlDoubleQuoted('line1\nline2')).toBe('"line1 line2"');
    });

    it('preserves colons (the reason for quoting)', () => {
      expect(yamlDoubleQuoted('Backend dev: NestJS')).toBe(
        '"Backend dev: NestJS"',
      );
    });
  });

  describe('rewriteFrontmatter', () => {
    it('emits the description as a YAML double-quoted scalar', () => {
      const content = '---\nname: x\ndescription: old\n---\nBody';
      const result = rewriteFrontmatter(content, 'copilot', 'x', 'New desc');
      expect(result).toContain('description: "New desc"');
      expect(result).not.toContain('description: New desc\n');
    });

    it('keeps YAML valid for descriptions containing colon-space', () => {
      const content = '---\nname: x\ndescription: old\n---\nBody';
      const result = rewriteFrontmatter(
        content,
        'cursor',
        'x',
        'Backend dev: NestJS and more',
      );
      expect(result).toContain('description: "Backend dev: NestJS and more"');
    });

    it('escapes embedded quotes in the emitted description', () => {
      const content = '---\nname: x\ndescription: old\n---\nBody';
      const result = rewriteFrontmatter(
        content,
        'copilot',
        'x',
        'He said "hi"',
      );
      expect(result).toContain('description: "He said \\"hi\\""');
    });

    it('prepends frontmatter when the source has none', () => {
      const result = rewriteFrontmatter('# body', 'copilot', 'x', 'Desc');
      expect(result.startsWith('---\n')).toBe(true);
      expect(result).toContain('description: "Desc"');
      expect(result).toContain('# body');
    });
  });
});
