import { evaluateUnattendedBash } from './unattended-bash-policy';

const ALLOWLIST = ['git status', 'git diff', 'npm test', 'ls'];

describe('evaluateUnattendedBash', () => {
  it.each([
    ['exact entry', 'git status'],
    ['entry plus arguments', 'git status --short'],
    ['extra whitespace between tokens', '  git   diff\t--stat  '],
    ['single-token entry', 'ls -la src'],
    ['another entry', 'npm test -- --watch=false'],
  ])('allows %s: %p', (_label, command) => {
    expect(evaluateUnattendedBash(command, ALLOWLIST)).toEqual({
      allowed: true,
    });
  });

  it.each([
    ['newline', 'git status\nrm -rf /'],
    ['carriage return', 'git status\rrm -rf /'],
    ['semicolon', 'git status; rm -rf /'],
    ['ampersand', 'git status && rm -rf /'],
    ['single ampersand', 'git status & rm -rf /'],
    ['pipe', 'git status | sh'],
    ['backtick', 'git status `rm -rf /`'],
    ['command substitution', 'git status $(rm -rf /)'],
    ['input redirect', 'git status < /etc/passwd'],
    ['output redirect', 'git status > out.txt'],
  ])('refuses a command containing a %s', (_label, command) => {
    const decision = evaluateUnattendedBash(command, ALLOWLIST);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/chain or redirect/);
  });

  it('matches on a token boundary: `git statusx` is refused', () => {
    expect(evaluateUnattendedBash('git statusx', ALLOWLIST).allowed).toBe(
      false,
    );
  });

  it('refuses a command shorter than the entry', () => {
    expect(evaluateUnattendedBash('git', ALLOWLIST).allowed).toBe(false);
  });

  it('is case-sensitive', () => {
    expect(evaluateUnattendedBash('Git status', ALLOWLIST).allowed).toBe(false);
    expect(evaluateUnattendedBash('LS', ALLOWLIST).allowed).toBe(false);
  });

  it('refuses a command that matches no entry', () => {
    const decision = evaluateUnattendedBash('rm -rf build', ALLOWLIST);
    expect(decision).toEqual({
      allowed: false,
      reason: 'the command does not start with an allowlisted command',
    });
  });

  it.each([
    ['empty string', ''],
    ['whitespace only', '   '],
    ['non-string', 42],
    ['undefined', undefined],
  ])('refuses an %s command', (_label, command) => {
    expect(evaluateUnattendedBash(command, ALLOWLIST).allowed).toBe(false);
  });

  it('refuses everything with an empty allowlist', () => {
    expect(evaluateUnattendedBash('git status', []).allowed).toBe(false);
  });

  it('ignores blank allowlist entries instead of matching everything', () => {
    expect(evaluateUnattendedBash('rm -rf /', ['', '   ']).allowed).toBe(false);
  });

  it('treats an exception while deciding as not allowed', () => {
    const hostile = {
      [Symbol.iterator]: () => {
        throw new Error('boom');
      },
    } as unknown as readonly string[];
    const decision = evaluateUnattendedBash('git status', hostile);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('boom');
  });
});
