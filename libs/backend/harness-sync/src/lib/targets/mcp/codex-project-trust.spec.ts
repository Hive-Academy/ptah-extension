/**
 * Reading Codex's per-project trust record.
 *
 * Codex merges `{ws}/.codex/config.toml` into the home config only for a
 * TRUSTED project, and says nothing when it declines — measured on codex-cli
 * 0.150.1, where the same file gave `MCP servers 2` in a trusted workspace and
 * `MCP servers 1` in an untrusted one. This reader is what lets a writer pick
 * the scope Codex will actually read instead of guessing.
 *
 * Every ambiguous case must read as NOT trusted: that costs a home-scoped entry
 * which works, never a workspace-scoped one that is silently ignored.
 *
 * Source-under-test: `codex-project-trust.ts`.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { codexProjectTrusted, trustLevelFor } from './codex-project-trust';

describe('codexProjectTrusted', () => {
  let tempHome: string;
  const WS = 'D:\\projects\\ptah-extension';

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'harness-sync-codex-trust-'));
  });

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
  });

  function seed(content: string): void {
    mkdirSync(join(tempHome, '.codex'), { recursive: true });
    writeFileSync(join(tempHome, '.codex', 'config.toml'), content, 'utf-8');
  }

  function trusted(workspaceRoot = WS): boolean {
    return codexProjectTrusted(workspaceRoot, { homeDir: tempHome });
  }

  it('reads a trusted project', () => {
    seed(
      [
        "[projects.'d:\\projects\\ptah-extension']",
        'trust_level = "trusted"',
        '',
      ].join('\n'),
    );

    expect(trusted()).toBe(true);
  });

  it('matches case-insensitively — Codex records the path lowercased', () => {
    // The recorded key is `d:\...` while a workspace root arrives as `D:\...`.
    // A literal comparison would report every Windows project untrusted.
    seed(
      [
        "[projects.'d:\\projects\\ptah-extension']",
        'trust_level = "trusted"',
        '',
      ].join('\n'),
    );

    expect(trusted('D:\\Projects\\Ptah-Extension')).toBe(true);
  });

  it('matches across separator spelling and a trailing separator', () => {
    seed(
      [
        "[projects.'d:/projects/ptah-extension']",
        'trust_level = "trusted"',
        '',
      ].join('\n'),
    );

    expect(trusted('D:\\projects\\ptah-extension\\')).toBe(true);
  });

  it('accepts a double-quoted table key too', () => {
    seed(
      ['[projects."/home/me/app"]', 'trust_level = "trusted"', ''].join('\n'),
    );

    expect(trusted('/home/me/app')).toBe(true);
  });

  describe('reads as NOT trusted', () => {
    it('when the config does not exist', () => {
      expect(trusted()).toBe(false);
    });

    it('when the project has no table', () => {
      seed(
        [
          "[projects.'c:\\somewhere\\else']",
          'trust_level = "trusted"',
          '',
        ].join('\n'),
      );

      expect(trusted()).toBe(false);
    });

    it('when the table exists with another trust level', () => {
      seed(
        [
          "[projects.'d:\\projects\\ptah-extension']",
          'trust_level = "untrusted"',
          '',
        ].join('\n'),
      );

      expect(trusted()).toBe(false);
    });

    it('when the table exists with no trust_level at all', () => {
      seed(
        [
          "[projects.'d:\\projects\\ptah-extension']",
          'something_else = 1',
          '',
        ].join('\n'),
      );

      expect(trusted()).toBe(false);
    });

    it('for an empty workspace root', () => {
      seed(
        [
          "[projects.'d:\\projects\\ptah-extension']",
          'trust_level = "trusted"',
          '',
        ].join('\n'),
      );

      expect(trusted('')).toBe(false);
    });
  });

  it("never reads a LATER project's trust_level as this one's", () => {
    // The next table header ends the body. Without that bound, a project with
    // no `trust_level` would inherit the next project's.
    seed(
      [
        "[projects.'d:\\projects\\ptah-extension']",
        '',
        "[projects.'c:\\other']",
        'trust_level = "trusted"',
        '',
      ].join('\n'),
    );

    expect(trusted()).toBe(false);
    expect(trusted('C:\\other')).toBe(true);
  });

  it('survives the surrounding config a real machine has', () => {
    seed(
      [
        'notify = [ "C:\\\\tools\\\\notify.exe", "turn-ended" ]',
        "[projects.'c:\\users\\abdal']",
        'trust_level = "trusted"',
        '',
        "[projects.'d:\\projects\\ptah-extension']",
        'trust_level = "trusted"',
        '',
        '[windows]',
        'sandbox = "unelevated"',
        '',
        '[features]',
        'js_repl = false',
        '',
        '[mcp_servers.node_repl]',
        'command = "node_repl.exe"',
        '',
      ].join('\n'),
    );

    expect(trusted()).toBe(true);
    expect(trusted('C:\\Users\\abdal')).toBe(true);
    expect(trusted('D:\\projects\\other')).toBe(false);
  });

  it("does not treat a parent project's trust as inherited", () => {
    // Measured: a temp repo under `C:\Users\abdal\AppData\...` was IGNORED by
    // Codex even though `c:\users\abdal` is trusted. Trust is per exact path.
    seed(
      ["[projects.'c:\\users\\abdal']", 'trust_level = "trusted"', ''].join(
        '\n',
      ),
    );

    expect(trusted('C:\\Users\\abdal\\AppData\\Local\\Temp\\repo')).toBe(false);
  });

  it('never writes anything', () => {
    // Trust grants Codex the right to run commands in a directory. Recording
    // that for the user would be Ptah answering a question asked of them.
    trusted();

    expect(() =>
      require('fs').readFileSync(join(tempHome, '.codex', 'config.toml')),
    ).toThrow();
  });
});

describe('trustLevelFor', () => {
  it('distinguishes "no entry" from "an entry saying something else"', () => {
    const content = ["[projects.'a']", 'trust_level = "untrusted"', ''].join(
      '\n',
    );

    expect(trustLevelFor(content, 'a')).toBe('untrusted');
    expect(trustLevelFor(content, 'b')).toBeNull();
  });
});
