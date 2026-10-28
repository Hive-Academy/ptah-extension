import type { GenerationTargetInfo } from '@ptah-extension/shared';
import {
  installToLabel,
  openedFolderNotice,
  packFileStatuses,
  packResultCounts,
} from './pack-install-result';

const target: GenerationTargetInfo = {
  harnessRoot: 'D:/work/acme',
  openedFolder: 'D:/work/acme/packages/api',
  chosen: 'harness-root',
  openedIsHarnessRoot: false,
};

describe('pack install helpers', () => {
  it('maps an older host result without per-file outcomes by overall success', () => {
    expect(
      packFileStatuses(['a.md'], {
        success: true,
        agentsDownloaded: 1,
        fromCache: true,
      }),
    ).toEqual({ 'a.md': 'installed' });
    expect(
      packFileStatuses(['a.md'], {
        success: false,
        agentsDownloaded: 0,
        fromCache: false,
      }),
    ).toEqual({ 'a.md': 'failed' });
  });

  it('counts installed, kept and failed files', () => {
    expect(
      packResultCounts({
        a: 'installed',
        b: 'kept',
        c: 'failed',
        d: 'installed',
      }),
    ).toEqual({ installed: 2, kept: 1, failed: 1 });
  });

  it('words the opened-folder notice per host and omits it for the project root', () => {
    const opened = { ...target, chosen: 'opened-folder' as const };
    expect(openedFolderNotice(opened, true)).toBe(
      'These agents are in packages/api/.claude/agents. They will not reach other CLIs and will not appear in the Library.',
    );
    expect(openedFolderNotice(opened, false)).toBe(
      'These agents are in packages/api/.claude/agents. They will not reach other CLIs.',
    );
    expect(openedFolderNotice(target, true)).toBeNull();
  });

  it('labels the install folder from the last install roots', () => {
    expect(installToLabel(null)).toEqual({
      path: '.claude/agents',
      suffix: '(project root)',
    });
    expect(installToLabel(target)).toEqual({
      path: 'D:/work/acme/.claude/agents',
      suffix: '(project root)',
    });
    expect(installToLabel({ ...target, chosen: 'opened-folder' })).toEqual({
      path: 'D:/work/acme/packages/api/.claude/agents',
      suffix: '(opened folder only)',
    });
  });
});
