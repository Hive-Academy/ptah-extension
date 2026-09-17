import type { WorkspaceWatchOptions } from '../interfaces/workspace-watcher.interface';
import {
  planNativeIgnoreSet,
  type NativeIgnoreSubscriber,
} from './native-ignore-set-planner';
import { toWorkspaceWatchPathKey } from './workspace-watch-protocol';

function subscriber(
  overrides: Partial<WorkspaceWatchOptions> = {},
): NativeIgnoreSubscriber {
  const options: WorkspaceWatchOptions = {
    excludeGlobs: [],
    excludeDirNames: [],
    excludeSegmentRules: [],
    nestedRepoDetection: false,
    ...overrides,
  };
  return {
    options,
    seededNestedRootKeys: new Set(
      (options.nestedRepoRoots ?? []).map(toWorkspaceWatchPathKey),
    ),
  };
}

const plan = (
  subscribers: NativeIgnoreSubscriber[],
  detected: Array<[string, string]> = [],
) =>
  planNativeIgnoreSet({
    rootKey: '/repo',
    subscribers,
    detectedNestedRoots: new Map(detected),
  });

describe('planNativeIgnoreSet', () => {
  it('is empty without subscribers', () => {
    expect(plan([])).toEqual([]);
  });

  it('keeps subtree-only forms, never .git, and only nested roots under the root', () => {
    expect(
      plan([
        subscriber({
          excludeDirNames: ['node_modules', 'dist', '.git', 'we*rd'],
          excludeSegmentRules: [
            ['.claude', 'worktrees'],
            ['.GIT', 'x'],
          ],
          excludeGlobs: ['**/build/**', '**/*.log', '**/.git/**'],
          nestedRepoRoots: ['/repo/wt-a', '/repo/wt-b', '/elsewhere/wt'],
        }),
      ]),
    ).toEqual(
      [
        '**/node_modules/**',
        '**/dist/**',
        '**/.[cC][lL][aA][uU][dD][eE]/[wW][oO][rR][kK][tT][rR][eE][eE][sS]/**',
        '**/build/**',
        '/repo/wt-a',
        '/repo/wt-b',
      ].sort(),
    );
  });

  it('is the intersection of every subscriber, with segment rules compared case-insensitively', () => {
    expect(
      plan([
        subscriber({
          excludeDirNames: ['node_modules', 'dist'],
          excludeSegmentRules: [['.claude', 'worktrees']],
          excludeGlobs: ['**/build/**'],
          nestedRepoRoots: ['/repo/wt-a'],
        }),
        subscriber({
          excludeDirNames: ['node_modules'],
          excludeSegmentRules: [['.CLAUDE', 'Worktrees']],
          nestedRepoRoots: ['/repo/wt-a'],
        }),
      ]),
    ).toEqual(
      [
        '**/node_modules/**',
        '**/.[cC][lL][aA][uU][dD][eE]/[wW][oO][rR][kK][tT][rR][eE][eE][sS]/**',
        '/repo/wt-a',
      ].sort(),
    );
  });

  it('includes detected nested roots only when every subscriber has detection on', () => {
    const detected: Array<[string, string]> = [
      ['/repo/pkg', '/repo/pkg'],
      ['/elsewhere/x', '/elsewhere/x'],
    ];
    expect(
      plan(
        [
          subscriber({ nestedRepoDetection: true }),
          subscriber({ nestedRepoDetection: true }),
        ],
        detected,
      ),
    ).toEqual(['/repo/pkg']);
    expect(
      plan(
        [
          subscriber({ nestedRepoDetection: true }),
          subscriber({ nestedRepoDetection: false }),
        ],
        detected,
      ),
    ).toEqual([]);
  });
});
