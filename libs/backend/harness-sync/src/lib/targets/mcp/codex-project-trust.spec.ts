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
    // `caseInsensitive` is pinned so the Windows-shaped cases below assert the
    // Windows RULE rather than whatever the host running CI happens to be. The
    // per-platform default is exercised separately.
    return codexProjectTrusted(workspaceRoot, {
      homeDir: tempHome,
      caseInsensitive: true,
    });
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

  it('reads a POSIX project path unchanged', () => {
    // Nothing here is Windows-shaped: a Linux or macOS project is the ordinary
    // case, and the separator normalization must be a no-op for it.
    seed(
      [
        "[projects.'/home/me/work/ptah-extension']",
        'trust_level = "trusted"',
        '',
      ].join('\n'),
    );

    expect(trusted('/home/me/work/ptah-extension')).toBe(true);
    expect(trusted('/home/me/work/other')).toBe(false);
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

describe('case sensitivity is per filesystem, not unconditional', () => {
  // The two errors are not symmetrical. A false `trusted` makes the caller
  // write `{ws}/.codex/config.toml`, which Codex ignores in silence — no Ptah
  // tools. A false `untrusted` makes it write `~/.codex/config.toml`, which
  // Codex always reads — tools work, at a wider scope. So case may be folded
  // only where folding cannot INVENT a match.
  const CASED = [
    "[projects.'/home/me/App']",
    'trust_level = "trusted"',
    '',
  ].join('\n');

  describe('a case-INSENSITIVE filesystem (win32, macOS by default)', () => {
    it('matches a different spelling, because it is the same directory', () => {
      expect(
        trustLevelFor(CASED, '/home/me/app', { caseInsensitive: true }),
      ).toBe('trusted');
    });

    it('is what makes Windows work at all — Codex stores paths lowercased', () => {
      // `C:\Users\abdal` is recorded as `c:\users\abdal`. Exact comparison
      // would report every Windows project untrusted.
      const win = [
        "[projects.'c:\\users\\abdal\\proj']",
        'trust_level = "trusted"',
        '',
      ].join('\n');

      expect(
        trustLevelFor(win, 'C:\\Users\\abdal\\proj', { caseInsensitive: true }),
      ).toBe('trusted');
      expect(
        trustLevelFor(win, 'C:\\Users\\abdal\\proj', {
          caseInsensitive: false,
        }),
      ).toBeNull();
    });
  });

  describe('a case-SENSITIVE filesystem (ext4, and a case-sensitive APFS volume)', () => {
    it('refuses a sibling that differs only in case', () => {
      // `/home/me/App` and `/home/me/app` are two directories on ext4. Trust
      // granted to one is not trust granted to the other.
      expect(
        trustLevelFor(CASED, '/home/me/app', { caseInsensitive: false }),
      ).toBeNull();
    });

    it('still matches the exact path', () => {
      expect(
        trustLevelFor(CASED, '/home/me/App', { caseInsensitive: false }),
      ).toBe('trusted');
    });

    it('still normalizes a trailing separator', () => {
      // Separator collapsing is safe on every platform: `{ws}` and `{ws}/` name
      // the same directory, so it can never invent a match.
      expect(
        trustLevelFor(CASED, '/home/me/App/', { caseInsensitive: false }),
      ).toBe('trusted');
    });
  });

  it('defaults to folding on win32 and darwin only', () => {
    const original = process.platform;
    const setPlatform = (value: NodeJS.Platform): void => {
      Object.defineProperty(process, 'platform', { value, configurable: true });
    };

    try {
      for (const platform of ['win32', 'darwin'] as NodeJS.Platform[]) {
        setPlatform(platform);
        expect(trustLevelFor(CASED, '/home/me/app')).toBe('trusted');
      }
      for (const platform of ['linux', 'freebsd'] as NodeJS.Platform[]) {
        setPlatform(platform);
        expect(trustLevelFor(CASED, '/home/me/app')).toBeNull();
      }
    } finally {
      setPlatform(original);
    }
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
