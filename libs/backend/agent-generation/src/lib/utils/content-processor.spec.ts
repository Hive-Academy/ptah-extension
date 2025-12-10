import {
  stripMarkdownCodeBlock,
  stripHtmlComments,
  processTemplate,
  extractFrontmatter,
} from './content-processor';

describe('ContentProcessor', () => {
  describe('stripMarkdownCodeBlock', () => {
    it('should strip ```markdown blocks', () => {
      const input = '```markdown\n# Hello World\n```';
      const result = stripMarkdownCodeBlock(input);

      expect(result.isOk()).toBe(true);
      expect(result.value).toBe('# Hello World');
    });

    it('should strip ```json blocks', () => {
      const input = '```json\n{"key": "value"}\n```';
      const result = stripMarkdownCodeBlock(input);

      expect(result.isOk()).toBe(true);
      expect(result.value).toBe('{"key": "value"}');
    });

    it('should strip blocks with any language identifier', () => {
      const input = '```typescript\nconst x = 1;\n```';
      const result = stripMarkdownCodeBlock(input);

      expect(result.isOk()).toBe(true);
      expect(result.value).toBe('const x = 1;');
    });

    it('should strip blocks without language identifier', () => {
      const input = '```\nplain code\n```';
      const result = stripMarkdownCodeBlock(input);

      expect(result.isOk()).toBe(true);
      expect(result.value).toBe('plain code');
    });

    it('should handle content without code blocks', () => {
      const input = 'Regular text content';
      const result = stripMarkdownCodeBlock(input);

      expect(result.isOk()).toBe(true);
      expect(result.value).toBe('Regular text content');
    });

    it('should handle multiple code blocks (strips first match)', () => {
      const input = '```js\ncode1\n```\n```ts\ncode2\n```';
      const result = stripMarkdownCodeBlock(input);

      expect(result.isOk()).toBe(true);
      // The function strips the first matched block
      expect(result.value).toContain('code1');
    });

    it('should handle code blocks with extra whitespace', () => {
      const input = '```markdown  \n  # Title  \n  ```';
      const result = stripMarkdownCodeBlock(input);

      expect(result.isOk()).toBe(true);
      expect(result.value).toBe('# Title');
    });

    it('should handle empty code blocks', () => {
      const input = '```markdown\n```';
      const result = stripMarkdownCodeBlock(input);

      expect(result.isOk()).toBe(true);
      expect(result.value).toBe('');
    });

    it('should handle code blocks with special characters', () => {
      const input = '```markdown\n# $pecial Ch@racters!\n```';
      const result = stripMarkdownCodeBlock(input);

      expect(result.isOk()).toBe(true);
      expect(result.value).toBe('# $pecial Ch@racters!');
    });
  });

  describe('stripHtmlComments', () => {
    it('should strip single comment', () => {
      const input = 'Hello <!-- comment --> World';
      const result = stripHtmlComments(input);

      expect(result.isOk()).toBe(true);
      expect(result.value).toBe('Hello  World');
    });

    it('should strip multiple comments', () => {
      const input = 'A <!-- c1 --> B <!-- c2 --> C';
      const result = stripHtmlComments(input);

      expect(result.isOk()).toBe(true);
      expect(result.value).toBe('A  B  C');
    });

    it('should strip nested comments', () => {
      const input = 'Text <!-- outer <!-- inner --> --> End';
      const result = stripHtmlComments(input);

      expect(result.isOk()).toBe(true);
      // Strips the first complete comment (non-greedy match)
      expect(result.value).toBe('Text  --> End');
    });

    it('should handle no comments', () => {
      const input = 'Plain text without comments';
      const result = stripHtmlComments(input);

      expect(result.isOk()).toBe(true);
      expect(result.value).toBe('Plain text without comments');
    });

    it('should handle multiline comments', () => {
      const input = 'Before\n<!--\nMultiline\nComment\n-->\nAfter';
      const result = stripHtmlComments(input);

      expect(result.isOk()).toBe(true);
      expect(result.value).toBe('Before\n\nAfter');
    });

    it('should handle comments at start and end', () => {
      const input = '<!-- start -->Content<!-- end -->';
      const result = stripHtmlComments(input);

      expect(result.isOk()).toBe(true);
      expect(result.value).toBe('Content');
    });

    it('should handle comments with minimal content', () => {
      const input = 'Text <!-- --> More';
      const result = stripHtmlComments(input);

      expect(result.isOk()).toBe(true);
      expect(result.value).toBe('Text  More');
    });

    it('should handle special characters in comments', () => {
      const input = 'Text <!-- $pecial @#$% --> End';
      const result = stripHtmlComments(input);

      expect(result.isOk()).toBe(true);
      expect(result.value).toBe('Text  End');
    });
  });

  describe('processTemplate', () => {
    it('should replace single variable', () => {
      const template = 'Hello {{name}}!';
      const data = { name: 'World' };
      const result = processTemplate(template, data);

      expect(result.isOk()).toBe(true);
      expect(result.value).toBe('Hello World!');
    });

    it('should replace multiple variables', () => {
      const template = '{{greeting}} {{name}}, welcome to {{place}}!';
      const data = { greeting: 'Hello', name: 'Alice', place: 'Wonderland' };
      const result = processTemplate(template, data);

      expect(result.isOk()).toBe(true);
      expect(result.value).toBe('Hello Alice, welcome to Wonderland!');
    });

    it('should replace same variable multiple times', () => {
      const template = '{{name}} and {{name}} are friends';
      const data = { name: 'Bob' };
      const result = processTemplate(template, data);

      expect(result.isOk()).toBe(true);
      expect(result.value).toBe('Bob and Bob are friends');
    });

    it('should handle missing variables (leaves placeholder)', () => {
      const template = 'Hello {{name}} and {{other}}!';
      const data = { name: 'World' };
      const result = processTemplate(template, data);

      expect(result.isOk()).toBe(true);
      expect(result.value).toBe('Hello World and {{other}}!');
    });

    it('should handle numeric values', () => {
      const template = 'Count: {{count}}';
      const data = { count: 42 };
      const result = processTemplate(template, data);

      expect(result.isOk()).toBe(true);
      expect(result.value).toBe('Count: 42');
    });

    it('should handle boolean values', () => {
      const template = 'Active: {{active}}';
      const data = { active: true };
      const result = processTemplate(template, data);

      expect(result.isOk()).toBe(true);
      expect(result.value).toBe('Active: true');
    });

    it('should handle special characters in values', () => {
      const template = 'Message: {{msg}}';
      const data = { msg: '$pecial @#$% characters!' };
      const result = processTemplate(template, data);

      expect(result.isOk()).toBe(true);
      expect(result.value).toBe('Message: $pecial @#$% characters!');
    });

    it('should handle empty string values', () => {
      const template = 'Value: "{{value}}"';
      const data = { value: '' };
      const result = processTemplate(template, data);

      expect(result.isOk()).toBe(true);
      expect(result.value).toBe('Value: ""');
    });

    it('should handle null and undefined as strings', () => {
      const template = 'Null: {{nullVal}}, Undefined: {{undefinedVal}}';
      const data = { nullVal: null, undefinedVal: undefined };
      const result = processTemplate(template, data);

      expect(result.isOk()).toBe(true);
      expect(result.value).toBe('Null: null, Undefined: undefined');
    });

    it('should handle template with no variables', () => {
      const template = 'Static content';
      const data = {};
      const result = processTemplate(template, data);

      expect(result.isOk()).toBe(true);
      expect(result.value).toBe('Static content');
    });

    it('should handle empty template', () => {
      const template = '';
      const data = { key: 'value' };
      const result = processTemplate(template, data);

      expect(result.isOk()).toBe(true);
      expect(result.value).toBe('');
    });

    it('should handle object values (stringified)', () => {
      const template = 'Object: {{obj}}';
      const data = { obj: { nested: 'value' } };
      const result = processTemplate(template, data);

      expect(result.isOk()).toBe(true);
      expect(result.value).toBe('Object: [object Object]');
    });
  });

  describe('extractFrontmatter', () => {
    it('should extract valid frontmatter', () => {
      const input = '---\ntitle: Hello\nauthor: World\n---\n# Content';
      const result = extractFrontmatter(input);

      expect(result.isOk()).toBe(true);
      expect(result.value?.frontmatter).toEqual({
        title: 'Hello',
        author: 'World',
      });
      expect(result.value?.content).toBe('# Content');
    });

    it('should handle no frontmatter', () => {
      const input = '# Content only';
      const result = extractFrontmatter(input);

      expect(result.isOk()).toBe(true);
      expect(result.value?.frontmatter).toEqual({});
      expect(result.value?.content).toBe('# Content only');
    });

    it('should handle empty frontmatter', () => {
      const input = '---\n\n---\n# Content';
      const result = extractFrontmatter(input);

      expect(result.isOk()).toBe(true);
      expect(result.value?.frontmatter).toEqual({});
      expect(result.value?.content).toBe('# Content');
    });

    it('should handle boolean values', () => {
      const input = '---\npublished: true\ndraft: false\n---\nContent';
      const result = extractFrontmatter(input);

      expect(result.isOk()).toBe(true);
      expect(result.value?.frontmatter).toEqual({
        published: true,
        draft: false,
      });
    });

    it('should handle numeric values', () => {
      const input = '---\ncount: 42\nprice: 19.99\n---\nContent';
      const result = extractFrontmatter(input);

      expect(result.isOk()).toBe(true);
      expect(result.value?.frontmatter).toEqual({
        count: 42,
        price: 19.99,
      });
    });

    it('should handle null values', () => {
      const input = '---\nvalue: null\n---\nContent';
      const result = extractFrontmatter(input);

      expect(result.isOk()).toBe(true);
      expect(result.value?.frontmatter).toEqual({
        value: null,
      });
    });

    it('should handle quoted strings', () => {
      const input =
        '---\ntitle: "Quoted Title"\nauthor: \'Single Quoted\'\n---\nContent';
      const result = extractFrontmatter(input);

      expect(result.isOk()).toBe(true);
      expect(result.value?.frontmatter).toEqual({
        title: 'Quoted Title',
        author: 'Single Quoted',
      });
    });

    it('should handle simple arrays', () => {
      const input = '---\ntags: ["tag1", "tag2", "tag3"]\n---\nContent';
      const result = extractFrontmatter(input);

      expect(result.isOk()).toBe(true);
      expect(result.value?.frontmatter).toEqual({
        tags: ['tag1', 'tag2', 'tag3'],
      });
    });

    it('should skip comments in frontmatter', () => {
      const input =
        '---\n# This is a comment\ntitle: Hello\n# Another comment\n---\nContent';
      const result = extractFrontmatter(input);

      expect(result.isOk()).toBe(true);
      expect(result.value?.frontmatter).toEqual({
        title: 'Hello',
      });
    });

    it('should handle multiline content', () => {
      const input = '---\ntitle: Test\n---\n# Line 1\n\nLine 2\n\nLine 3';
      const result = extractFrontmatter(input);

      expect(result.isOk()).toBe(true);
      expect(result.value?.content).toBe('# Line 1\n\nLine 2\n\nLine 3');
    });

    it('should handle keys with spaces (trimmed)', () => {
      const input = '---\n  title  :   Hello  \n---\nContent';
      const result = extractFrontmatter(input);

      expect(result.isOk()).toBe(true);
      expect(result.value?.frontmatter).toEqual({
        title: 'Hello',
      });
    });

    it('should handle frontmatter without trailing newline', () => {
      const input = '---\ntitle: Hello\n---\nContent';
      const result = extractFrontmatter(input);

      expect(result.isOk()).toBe(true);
      expect(result.value?.frontmatter).toEqual({
        title: 'Hello',
      });
      expect(result.value?.content).toBe('Content');
    });

    it('should handle empty content after frontmatter', () => {
      const input = '---\ntitle: Hello\n---\n';
      const result = extractFrontmatter(input);

      expect(result.isOk()).toBe(true);
      expect(result.value?.frontmatter).toEqual({
        title: 'Hello',
      });
      expect(result.value?.content).toBe('');
    });
  });
});
