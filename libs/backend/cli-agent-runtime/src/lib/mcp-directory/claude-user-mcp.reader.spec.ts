// The reader imports `harness-sync`'s barrel for `jsonToConfig`, which reaches
// `vscode-core` and therefore tsyringe. Same polyfill line as every other spec
// in this lib that touches a DI-carrying barrel.
import 'reflect-metadata';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  claudeUserConfigPath,
  readClaudeUserMcpServers,
} from './claude-user-mcp.reader';

/**
 * Every case here writes `.claude.json` into a temp `homeDir`. The reader
 * defaults to `os.homedir()`, so a spec that omitted the option would read the
 * developer's real Claude config and pass or fail by accident.
 */
describe('readClaudeUserMcpServers', () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-user-mcp-'));
  });

  afterEach(() => {
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  const write = (value: unknown): void => {
    fs.writeFileSync(
      claudeUserConfigPath(homeDir),
      JSON.stringify(value),
      'utf-8',
    );
  };

  it('returns an empty list when the file is absent', () => {
    expect(readClaudeUserMcpServers('D:/ws', { homeDir })).toEqual([]);
  });

  it('returns an empty list for an unparseable file rather than throwing', () => {
    fs.writeFileSync(claudeUserConfigPath(homeDir), '{ not json', 'utf-8');
    expect(() => readClaudeUserMcpServers('D:/ws', { homeDir })).not.toThrow();
    expect(readClaudeUserMcpServers('D:/ws', { homeDir })).toEqual([]);
  });

  it('reads project-scoped servers when there is no top-level map at all', () => {
    // The measured shape on this machine: no top-level `mcpServers`, two
    // servers under the project entry.
    write({
      projects: {
        'D:/projects/ptah-extension': {
          mcpServers: {
            sentry: { type: 'http', url: 'https://mcp.sentry.dev/mcp' },
            sonarqube: { command: 'npx', args: ['-y', 'sonarqube-mcp'] },
          },
        },
      },
    });

    const entries = readClaudeUserMcpServers('D:/projects/ptah-extension', {
      homeDir,
      caseInsensitive: true,
    });

    expect(entries.map((e) => e.serverKey).sort()).toEqual([
      'sentry',
      'sonarqube',
    ]);
    expect(entries.every((e) => e.scope === 'project')).toBe(true);
    expect(entries[0].configPath).toBe(claudeUserConfigPath(homeDir));
    const sonar = entries.find((e) => e.serverKey === 'sonarqube');
    expect(sonar?.config).toEqual({
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'sonarqube-mcp'],
    });
  });

  it('folds drive-letter case and reads BOTH duplicate project keys', () => {
    // On Windows the two spellings name one directory, so both entries are
    // running for this workspace; picking one would hide the other's servers.
    fs.writeFileSync(
      claudeUserConfigPath(homeDir),
      `{"projects":{"D:/projects/ptah-extension":{"mcpServers":{"first":{"command":"a"}}},` +
        `"d:/projects/ptah-extension":{"mcpServers":{"second":{"command":"b"}}}}}`,
      'utf-8',
    );

    const entries = readClaudeUserMcpServers('D:/projects/ptah-extension', {
      homeDir,
      caseInsensitive: true,
    });
    expect(entries.map((e) => e.serverKey).sort()).toEqual(['first', 'second']);
  });

  it('does NOT fold case when the filesystem is case-sensitive', () => {
    // On ext4 `/a/App` and `/a/app` are two directories; folding there would
    // report a sibling project's servers as this one's.
    write({
      projects: {
        '/home/u/App': { mcpServers: { other: { command: 'a' } } },
      },
    });

    expect(
      readClaudeUserMcpServers('/home/u/app', {
        homeDir,
        caseInsensitive: false,
      }),
    ).toEqual([]);
  });

  it('reads the top-level user map and lets a project entry win the same key', () => {
    write({
      mcpServers: {
        shared: { type: 'http', url: 'https://user.example/mcp' },
        useronly: { command: 'u' },
      },
      projects: {
        '/ws': {
          mcpServers: {
            shared: { type: 'http', url: 'https://project.example/mcp' },
          },
        },
      },
    });

    const entries = readClaudeUserMcpServers('/ws', {
      homeDir,
      caseInsensitive: false,
    });
    const shared = entries.find((e) => e.serverKey === 'shared');
    expect(shared?.scope).toBe('project');
    expect(shared?.config).toEqual({
      type: 'http',
      url: 'https://project.example/mcp',
    });
    expect(entries.find((e) => e.serverKey === 'useronly')?.scope).toBe('user');
  });

  it('reads the user map when no workspace root is supplied', () => {
    write({ mcpServers: { global: { command: 'g' } } });
    const entries = readClaudeUserMcpServers(undefined, { homeDir });
    expect(entries.map((e) => e.serverKey)).toEqual(['global']);
  });

  it('skips entries whose value is not an object', () => {
    write({ mcpServers: { good: { command: 'g' }, bad: 'nope', '': {} } });
    const entries = readClaudeUserMcpServers(undefined, { homeDir });
    expect(entries.map((e) => e.serverKey)).toEqual(['good']);
  });
});
