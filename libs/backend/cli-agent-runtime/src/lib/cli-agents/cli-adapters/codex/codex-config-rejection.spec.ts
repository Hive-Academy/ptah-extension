import { readFileSync } from 'fs';
import { join } from 'path';
import {
  codexRejectionNamesUserServer,
  codexStderrExcerpt,
  essentialCodexConfigEntries,
  isCodexConfigRejection,
  sdkConfigRejectionStderr,
} from './codex-config-rejection';

/** Real stderr captured from the bundled codex-cli 0.155.1 (see the source header). */
function fixture(name: string): string {
  return readFileSync(join(__dirname, '__fixtures__', name), 'utf8');
}

const CAPTURED = [
  'exec-invalid-value.stderr.txt',
  'exec-unloaded-server-disable.stderr.txt',
  'exec-malformed-override.stderr.txt',
  'features-list-invalid-value.stderr.txt',
];

describe('isCodexConfigRejection', () => {
  it.each(CAPTURED)('matches the captured fixture %s', (name) => {
    expect(isCodexConfigRejection(fixture(name))).toBe(true);
  });

  it.each([
    'stream disconnected before completion: error sending request',
    'Error: unexpected status 401 Unauthorized: Missing bearer authentication',
    'thread 0199a213 not found',
    "The 'gpt-6-sol' model is not supported when using Codex with a ChatGPT account.",
    // Codex's own warning line above every fixture is not itself a rejection.
    'WARNING: proceeding, even though we could not create PATH aliases',
  ])('does not match a non-config failure: %s', (stderr) => {
    expect(isCodexConfigRejection(stderr)).toBe(false);
  });
});

describe('sdkConfigRejectionStderr', () => {
  it('returns the stderr of the SDK exit error when it is a rejection', () => {
    const stderr = fixture('exec-invalid-value.stderr.txt');
    expect(
      sdkConfigRejectionStderr(`Codex Exec exited with code 1: ${stderr}`),
    ).toBe(stderr);
  });

  it('accepts the signal form of the SDK exit error', () => {
    const stderr = fixture('exec-malformed-override.stderr.txt');
    expect(
      sdkConfigRejectionStderr(
        `Codex Exec exited with signal SIGTERM: ${stderr}`,
      ),
    ).toBe(stderr);
  });

  it('ignores an exit whose stderr is not a rejection', () => {
    expect(
      sdkConfigRejectionStderr(
        'Codex Exec exited with code 1: stream disconnected before completion',
      ),
    ).toBeUndefined();
  });

  it('ignores rejection text that is not the SDK exit error', () => {
    // A turn or tool message that quotes the words must not trigger a retry.
    expect(
      sdkConfigRejectionStderr(
        `Failed to parse item: ${fixture('exec-invalid-value.stderr.txt')}`,
      ),
    ).toBeUndefined();
  });
});

describe('codexStderrExcerpt', () => {
  it('starts at the rejection headline and skips the warning above it', () => {
    const excerpt = codexStderrExcerpt(
      fixture('exec-invalid-value.stderr.txt'),
      [],
    );
    expect(excerpt).toBe(
      'Error loading config.toml: invalid type: string "x", expected i64 in `model_auto_compact_token_limit`',
    );
  });

  it('keeps the multi-line cause of the bootstrap shape on one line', () => {
    const excerpt = codexStderrExcerpt(
      fixture('features-list-invalid-value.stderr.txt'),
      [],
    );
    expect(excerpt).toBe(
      'Error: failed to load bootstrap configuration Caused by: invalid type: string "x", expected i64 in `model_auto_compact_token_limit`',
    );
  });

  it('redacts secrets and caps the excerpt at 200 chars', () => {
    const secret = 'sk-test-0123456789abcdef';
    const stderr = `Error loading config.toml: invalid value ${secret} ${'y'.repeat(400)}`;
    const excerpt = codexStderrExcerpt(stderr, [secret]);

    expect(excerpt).not.toContain(secret);
    expect(excerpt).toContain('[REDACTED]');
    expect(excerpt.length).toBe(200);
    expect(excerpt.endsWith('...')).toBe(true);
  });
});

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
