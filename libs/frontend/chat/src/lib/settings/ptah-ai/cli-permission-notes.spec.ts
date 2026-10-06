import { SYSTEM_CLI_TYPES, type CliType } from '@ptah-extension/shared';
import {
  PENDING_USER_REVIEW_IDS,
  cliPermissionNote,
} from './cli-permission-notes';

const ALL_IDS: readonly CliType[] = [...SYSTEM_CLI_TYPES, 'ptah-cli'];

describe('cliPermissionNote', () => {
  it.each(ALL_IDS)('has a badge, a tone and detail copy for %s', (cli) => {
    for (const autoApprove of [true, false, null]) {
      const note = cliPermissionNote(cli, autoApprove);
      expect(note.badge.trim()).not.toBe('');
      expect(note.detail.trim()).not.toBe('');
      expect(['warning', 'info', 'error', 'neutral']).toContain(note.tone);
    }
  });

  it('keeps the pre-#575 wording for Codex, Cursor, Antigravity, opencode and Pi (#70)', () => {
    expect(cliPermissionNote('codex').detail).toBe(
      'Full auto — Codex runs headless with full access.',
    );
    expect(cliPermissionNote('cursor').detail).toBe(
      'Full auto — Cursor runs headless with full access.',
    );
    expect(cliPermissionNote('antigravity').detail).toBe(
      'Full auto — Antigravity runs headless with full access.',
    );
    expect(cliPermissionNote('opencode').detail).toBe(
      'Full auto — opencode runs headless with --auto.',
    );
    expect(cliPermissionNote('pi').detail).toBe(
      'No approval gate and no MCP support — Pi always runs tools with full process permissions.',
    );
  });

  it('uses the prototype badges', () => {
    expect(cliPermissionNote('codex')).toMatchObject({
      badge: 'Full auto',
      tone: 'warning',
    });
    expect(cliPermissionNote('opencode')).toMatchObject({
      badge: '--auto flag',
      tone: 'info',
    });
    expect(cliPermissionNote('pi')).toMatchObject({
      badge: 'No MCP / gate',
      tone: 'error',
    });
  });

  it("shows Copilot's saved auto-approve state", () => {
    expect(cliPermissionNote('copilot', true)).toMatchObject({
      badge: 'Auto-approve: On',
      tone: 'warning',
    });
    expect(cliPermissionNote('copilot', false)).toMatchObject({
      badge: 'Auto-approve: Off',
      tone: 'neutral',
    });
    expect(cliPermissionNote('copilot', false).detail).toContain(
      'waits for your approval',
    );
  });

  it("does not guess Copilot's state when it is not loaded (the host default would be on)", () => {
    expect(cliPermissionNote('copilot')).toMatchObject({
      badge: 'Auto-approve: unknown',
      tone: 'neutral',
    });
    expect(cliPermissionNote('copilot', null).detail).toContain(
      'has not loaded',
    );
  });

  it('ignores the Copilot value for every other CLI', () => {
    for (const cli of ALL_IDS.filter((id) => id !== 'copilot')) {
      expect(cliPermissionNote(cli, true)).toEqual(
        cliPermissionNote(cli, false),
      );
      expect(cliPermissionNote(cli, null)).toEqual(cliPermissionNote(cli));
    }
  });

  it('describes Ptah instances by the chat Autopilot level they inherit', () => {
    const note = cliPermissionNote('ptah-cli');
    expect(note.badge).toBe('Follows Autopilot');
    expect(note.detail).toContain('Autopilot');
  });

  it('warns that Grok auto-approves tool requests, shell and file edits included', () => {
    expect(cliPermissionNote('grok')).toEqual({
      badge: 'Auto-approve',
      tone: 'warning',
      detail:
        'Ptah approves Grok tool requests, shell commands and file edits included. ' +
        'It answers allow-once when Grok offers it; if a request offers only a persistent grant, ' +
        'Ptah accepts that grant and shows an info line. A request with no allow option is declined.',
    });
  });

  it('flags exactly the new copy (Copilot, Ptah instances and Grok) for user review', () => {
    expect([...PENDING_USER_REVIEW_IDS].sort()).toEqual([
      'copilot',
      'grok',
      'ptah-cli',
    ]);
  });

  it('has no quota wording (D11)', () => {
    for (const cli of ALL_IDS) {
      for (const autoApprove of [true, false, null]) {
        const note = cliPermissionNote(cli, autoApprove);
        expect(`${note.badge} ${note.detail}`.toLowerCase()).not.toContain(
          'quota',
        );
      }
    }
  });
});
