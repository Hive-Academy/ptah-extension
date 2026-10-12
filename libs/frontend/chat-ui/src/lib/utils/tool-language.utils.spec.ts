import {
  detectToolLanguage,
  getLanguageFromPath,
  getLanguageLabel,
  looksLikeMarkdown,
} from './tool-language.utils';

describe('getLanguageFromPath', () => {
  it.each([
    ['/src/app.ts', 'typescript'],
    ['/src/App.TSX', 'tsx'],
    ['/a/b.js', 'javascript'],
    ['/a/b.jsx', 'jsx'],
    ['/a/package.json', 'json'],
    ['/a/index.html', 'html'],
    ['/a/s.css', 'css'],
    ['/a/s.scss', 'scss'],
    ['/a/m.py', 'python'],
    ['/a/M.java', 'java'],
    ['/a/m.go', 'go'],
    ['/a/m.rs', 'rust'],
    ['/a/README.md', 'markdown'],
    ['/a/c.yaml', 'yaml'],
    ['/a/c.yml', 'yaml'],
    ['/a/c.xml', 'xml'],
    ['/a/q.sql', 'sql'],
    ['/a/run.sh', 'bash'],
    ['/a/run.bash', 'bash'],
    ['/a/.zsh', 'bash'],
  ])('maps %s to %s', (path, language) => {
    expect(getLanguageFromPath(path)).toBe(language);
  });

  it('normalises Windows separators', () => {
    expect(getLanguageFromPath('C:\\repo\\src\\main.ts')).toBe('typescript');
  });

  it('falls back to text for an unknown or missing extension', () => {
    expect(getLanguageFromPath('/a/b.unknownext')).toBe('text');
    expect(getLanguageFromPath('/a/Makefile')).toBe('text');
    expect(getLanguageFromPath('')).toBe('text');
  });
});

describe('looksLikeMarkdown', () => {
  it.each([
    ['# Heading\ntext'],
    ['intro\n## Section'],
    ['- one\n- two'],
    ['* one'],
    ['1. first\n2. second'],
    ['```ts\nconst a = 1;\n```'],
    ['| a | b |\n| --- | --- |\n| 1 | 2 |'],
    ['a **bold** word'],
    ['see [docs](https://example.com)'],
    ['###### Six\nbody'],
    ['#\tTabbed heading'],
    ['intro\n   + indented item'],
    ['10) tenth'],
    ['  ~~~\ncode\n  ~~~'],
    ['a | b\n---|---'],
    ['| :--- | ---: | :---: |'],
    ['  |---|---|  \r\n'],
    ['[a](b) and [c](d)'],
    ['see [Foo](https://en.wikipedia.org/wiki/Foo_(bar))'],
  ])('detects markdown in %j', (text) => {
    expect(looksLikeMarkdown(text)).toBe(true);
  });

  it.each([
    ['Agent: claude (ready)\nAgent: codex (ready)\nAgent: gemini (busy)'],
    ['pong'],
    ['#hashtag and 3 * 4 = 12'],
    ['a | b | c'],
    ['[NX] ran build'],
    [''],
    ['####### seven hashes'],
    ['#\nnot a heading'],
    ['-not a list'],
    ['    - indented four spaces'],
    ['1.5 seconds'],
    ['text ``` inline fence'],
    ['---'],
    ['|---|'],
    ['| -- | -- |'],
    ['a\n- \nb'],
    ['**unclosed bold'],
    ['[label] (url)'],
    ['[label](has space)'],
    ['[[[[[[[[[[[[[[[['],
    ['[a](' + 'x[a]('.repeat(50)],
  ])('reads %j as plain text', (text) => {
    expect(looksLikeMarkdown(text)).toBe(false);
  });
});

describe('detectToolLanguage', () => {
  it('renders mcp__ output that uses markdown syntax as markdown', () => {
    expect(
      detectToolLanguage({
        toolName: 'mcp__ptah__x',
        toolOutput: '## Agents\n- claude\n- codex',
      }),
    ).toBe('markdown');
  });

  it('renders plain-text mcp__ output as text, keeping its line breaks', () => {
    expect(
      detectToolLanguage({
        toolName: 'mcp__github__ListAgents',
        toolOutput: 'Agent: claude\nAgent: codex\nAgent: gemini',
      }),
    ).toBe('text');
  });

  it('reads MCP content blocks through their displayed text', () => {
    expect(
      detectToolLanguage({
        toolName: 'mcp__srv__x',
        toolOutput: [{ type: 'text', text: '# Title\nbody' }],
      }),
    ).toBe('markdown');
    expect(
      detectToolLanguage({
        toolName: 'mcp__srv__x',
        toolOutput: [{ type: 'text', text: 'line one\nline two' }],
      }),
    ).toBe('text');
  });

  it('never returns json for mcp__ output', () => {
    expect(
      detectToolLanguage({ toolName: 'mcp__ptah__x', toolOutput: '{"a":1}' }),
    ).toBe('text');
  });

  it.each(['Read', 'Write', 'Edit'])(
    'uses the file extension for %s input',
    (toolName) => {
      const toolInput =
        toolName === 'Edit'
          ? { file_path: '/x/a.py', old_string: 'a', new_string: 'b' }
          : toolName === 'Write'
            ? { file_path: '/x/a.py', content: 'print(1)' }
            : { file_path: '/x/a.py' };
      expect(
        detectToolLanguage({ toolName, toolInput, toolOutput: 'print(1)' }),
      ).toBe('python');
    },
  );

  it.each(['Bash', 'PowerShell'])(
    'uses plain text, not shell highlighting, for %s output',
    (toolName) => {
      expect(
        detectToolLanguage({
          toolName,
          toolInput: { command: 'ls' },
          toolOutput: 'Build finished for the project\nDone',
        }),
      ).toBe('text');
    },
  );

  it.each(['Grep', 'Glob', 'Task', undefined])(
    'uses text for %s',
    (toolName) => {
      expect(detectToolLanguage({ toolName, toolOutput: 'a.ts:1: x' })).toBe(
        'text',
      );
    },
  );

  it('sniffs one JSON object or array as json', () => {
    expect(
      detectToolLanguage({ toolName: 'Bash', toolOutput: '{"ok":true}' }),
    ).toBe('json');
    expect(
      detectToolLanguage({ toolName: 'Grep', toolOutput: ' [1,2] ' }),
    ).toBe('json');
  });

  it('keeps the tool language when output only starts with a bracket', () => {
    expect(
      detectToolLanguage({ toolName: 'Bash', toolOutput: '[NX] ran build' }),
    ).toBe('text');
    expect(
      detectToolLanguage({
        toolName: 'Read',
        toolInput: { file_path: '/t/j.jsonl' },
        toolOutput: '{"a":1}\n{"b":2}',
      }),
    ).toBe('text');
  });

  it('ignores non-string output for JSON sniffing', () => {
    expect(
      detectToolLanguage({
        toolName: 'Bash',
        toolOutput: { a: 1 },
      }),
    ).toBe('text');
  });
});

describe('getLanguageLabel', () => {
  it('names known languages', () => {
    expect(getLanguageLabel('typescript')).toBe('TypeScript');
    expect(getLanguageLabel('bash')).toBe('Bash');
    expect(getLanguageLabel('json')).toBe('JSON');
    expect(getLanguageLabel('text')).toBe('Text');
  });

  it('returns an unmapped id unchanged', () => {
    expect(getLanguageLabel('kotlin')).toBe('kotlin');
  });
});
