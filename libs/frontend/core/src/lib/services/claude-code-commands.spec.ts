import {
  CLAUDE_CODE_INSTALL_COMMANDS,
  CLAUDE_CODE_NPM_INSTALL_COMMAND,
  CLAUDE_CODE_SETUP_DOCS_URL,
  CLAUDE_CODE_SIGN_IN_COMMAND,
} from './claude-code-commands';

describe('Claude Code commands', () => {
  it('signs in with the bare claude command', () => {
    expect(CLAUDE_CODE_SIGN_IN_COMMAND).toBe('claude');
  });

  it('keeps the npm install command and the setup docs URL', () => {
    expect(CLAUDE_CODE_NPM_INSTALL_COMMAND).toBe(
      'npm install -g @anthropic-ai/claude-code',
    );
    expect(CLAUDE_CODE_SETUP_DOCS_URL).toBe(
      'https://code.claude.com/docs/en/setup',
    );
  });

  it('lists four install rows with distinct ids, in tab order', () => {
    expect(CLAUDE_CODE_INSTALL_COMMANDS).toHaveLength(4);
    const ids = CLAUDE_CODE_INSTALL_COMMANDS.map((row) => row.id);
    expect(new Set(ids).size).toBe(4);
    expect(ids).toEqual(['unix', 'powershell', 'cmd', 'npm']);
    expect(CLAUDE_CODE_INSTALL_COMMANDS.map((row) => row.tab)).toEqual([
      'unix',
      'windows',
      'windows',
      'npm',
    ]);
  });

  it('uses the official install commands verbatim', () => {
    expect(CLAUDE_CODE_INSTALL_COMMANDS.map((row) => row.command)).toEqual([
      'curl -fsSL https://claude.ai/install.sh | bash',
      'irm https://claude.ai/install.ps1 | iex',
      'curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd',
      CLAUDE_CODE_NPM_INSTALL_COMMAND,
    ]);
  });

  it('labels every row', () => {
    for (const row of CLAUDE_CODE_INSTALL_COMMANDS) {
      expect(row.label.trim()).not.toBe('');
    }
  });
});
