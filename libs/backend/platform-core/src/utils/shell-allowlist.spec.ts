/**
 * shell-allowlist.spec.ts
 *
 * Unit specs for the per-platform shell basename allowlist. `platform` is
 * always driven via the function argument so these assertions are
 * OS-independent (they run identically on the CI Linux box and a dev's win32
 * machine).
 */
import { isAllowedShell, WIN_SHELLS, POSIX_SHELLS } from './shell-allowlist';

describe('isAllowedShell', () => {
  describe('absent shell (host default)', () => {
    it('permits undefined regardless of platform', () => {
      expect(isAllowedShell(undefined, 'win32')).toBe(true);
      expect(isAllowedShell(undefined, 'linux')).toBe(true);
      expect(isAllowedShell(undefined, 'darwin')).toBe(true);
    });
  });

  describe('path separators are rejected outright', () => {
    it('rejects any value containing a forward slash', () => {
      expect(isAllowedShell('/bin/bash', 'linux')).toBe(false);
      expect(isAllowedShell('./bash', 'linux')).toBe(false);
      expect(isAllowedShell('/usr/local/bin/fish', 'darwin')).toBe(false);
    });

    it('rejects any value containing a backslash', () => {
      expect(isAllowedShell('C:\\Windows\\System32\\cmd.exe', 'win32')).toBe(
        false,
      );
      expect(isAllowedShell('..\\cmd.exe', 'win32')).toBe(false);
      expect(isAllowedShell('\\\\host\\share\\bash.exe', 'win32')).toBe(false);
    });

    it('rejects a separator even when the basename is allowlisted', () => {
      // basename('/tmp/evil/bash') === 'bash' but the path must NOT pass.
      expect(isAllowedShell('/tmp/evil/bash', 'linux')).toBe(false);
      expect(isAllowedShell('C:\\evil\\cmd.exe', 'win32')).toBe(false);
    });
  });

  describe('win32', () => {
    it('permits every allowlisted basename', () => {
      for (const shell of WIN_SHELLS) {
        expect(isAllowedShell(shell, 'win32')).toBe(true);
      }
    });

    it('matches case-insensitively', () => {
      expect(isAllowedShell('CMD.EXE', 'win32')).toBe(true);
      expect(isAllowedShell('PowerShell.exe', 'win32')).toBe(true);
      expect(isAllowedShell('PWSH.EXE', 'win32')).toBe(true);
    });

    it('rejects an unknown basename', () => {
      expect(isAllowedShell('rm', 'win32')).toBe(false);
      expect(isAllowedShell('calc.exe', 'win32')).toBe(false);
      // POSIX bare names are not win32 shells.
      expect(isAllowedShell('bash', 'win32')).toBe(false);
    });
  });

  describe('posix', () => {
    it('permits every allowlisted basename', () => {
      for (const shell of POSIX_SHELLS) {
        expect(isAllowedShell(shell, 'linux')).toBe(true);
        expect(isAllowedShell(shell, 'darwin')).toBe(true);
      }
    });

    it('is case-sensitive (does not lowercase)', () => {
      expect(isAllowedShell('BASH', 'linux')).toBe(false);
      expect(isAllowedShell('Zsh', 'darwin')).toBe(false);
    });

    it('rejects an unknown basename', () => {
      expect(isAllowedShell('rm', 'linux')).toBe(false);
      expect(isAllowedShell('node', 'linux')).toBe(false);
      // win32-only names are not posix shells.
      expect(isAllowedShell('cmd.exe', 'linux')).toBe(false);
    });
  });
});
