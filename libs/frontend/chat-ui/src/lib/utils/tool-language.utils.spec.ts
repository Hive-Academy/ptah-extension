import {
  detectToolLanguage,
  getLanguageFromPath,
  getLanguageLabel,
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

describe('detectToolLanguage', () => {
  it('renders mcp__ tools as markdown, even with JSON output', () => {
    expect(
      detectToolLanguage({ toolName: 'mcp__ptah__x', toolOutput: '{"a":1}' }),
    ).toBe('markdown');
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

  it('uses bash for Bash', () => {
    expect(
      detectToolLanguage({
        toolName: 'Bash',
        toolInput: { command: 'ls' },
        toolOutput: 'a\nb',
      }),
    ).toBe('bash');
  });

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
    ).toBe('bash');
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
    ).toBe('bash');
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
