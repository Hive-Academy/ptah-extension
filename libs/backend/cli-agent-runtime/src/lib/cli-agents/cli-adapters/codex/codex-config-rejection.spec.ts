import { readFileSync } from 'fs';
import { join } from 'path';
import {
  codexRejectionNamesUserServer,
  essentialCodexConfigEntries,
} from './codex-config-rejection';

/** Real stderr captured from the bundled codex-cli 0.155.1 (see the source header). */
function fixture(name: string): string {
  return readFileSync(join(__dirname, '__fixtures__', name), 'utf8');
}

describe('codexRejectionNamesUserServer', () => {
  it('is true when Codex names a user server (captured fixture)', () => {
    expect(
      codexRejectionNamesUserServer(
        fixture('exec-unloaded-server-disable.stderr.txt'),
      ),
    ).toBe(true);
  });

  it.each([
    ['a budget key', fixture('exec-invalid-value.stderr.txt')],
    ['no named key', fixture('exec-malformed-override.stderr.txt')],
    [
      "Ptah's own server",
      'Error loading config.toml: invalid type\nin `mcp_servers.ptah.url`',
    ],
  ])('is false for %s', (_label, stderr) => {
    expect(codexRejectionNamesUserServer(stderr)).toBe(false);
  });
});

describe('essentialCodexConfigEntries', () => {
  const entries = [
    'agents.enabled=false',
    'features.plugins=false',
    'features.apps=false',
    'skills.include_instructions=false',
    'model_auto_compact_token_limit=120000',
    'tool_output_token_limit=2500',
    'web_search="live"',
    'approval_policy="never"',
    'model_reasoning_effort="high"',
    'mcp_servers={"github"={enabled=false}}',
    'mcp_servers.ptah.url="http://localhost:1/workspace/%2Fp"',
    'mcp_servers.ptah.tool_timeout_sec=960',
    'developer_instructions="## Role: x"',
  ];

  it('keeps effort and the user-server disable, drops budgets and prefix keys, in order', () => {
    expect(
      essentialCodexConfigEntries(
        entries,
        fixture('exec-invalid-value.stderr.txt'),
      ),
    ).toEqual([
      'web_search="live"',
      'approval_policy="never"',
      'model_reasoning_effort="high"',
      'mcp_servers={"github"={enabled=false}}',
      'mcp_servers.ptah.url="http://localhost:1/workspace/%2Fp"',
      'mcp_servers.ptah.tool_timeout_sec=960',
      'developer_instructions="## Role: x"',
    ]);
  });

  it('drops the user-server entry when Codex named a user server as the cause', () => {
    expect(
      essentialCodexConfigEntries(
        entries,
        fixture('exec-unloaded-server-disable.stderr.txt'),
      ),
    ).toEqual([
      'web_search="live"',
      'approval_policy="never"',
      'model_reasoning_effort="high"',
      'mcp_servers.ptah.url="http://localhost:1/workspace/%2Fp"',
      'mcp_servers.ptah.tool_timeout_sec=960',
      'developer_instructions="## Role: x"',
    ]);
  });
});
