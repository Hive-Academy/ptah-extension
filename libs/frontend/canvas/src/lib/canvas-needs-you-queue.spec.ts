import type {
  AskUserQuestionRequest,
  PermissionRequest,
} from '@ptah-extension/shared';
import type { MonitoredAgent } from '@ptah-extension/chat-streaming';
import { buildNeedsYouItems } from './canvas-needs-you-queue';

const tiles = [
  { tabId: 'a', sessionId: 's1', title: 'Alpha' },
  { tabId: 'b', sessionId: 's2', title: 'Beta' },
];
const permission = (
  id: string,
  extra: Partial<PermissionRequest> = {},
): PermissionRequest => ({
  id,
  toolName: 'Write',
  toolInput: {},
  description: 'Edit file',
  timestamp: 10,
  timeoutAt: 0,
  ...extra,
});
const question = (
  id: string,
  extra: Partial<AskUserQuestionRequest> = {},
): AskUserQuestionRequest => ({
  id,
  toolName: 'AskUserQuestion',
  questions: [
    {
      question: 'Which file?',
      header: 'File',
      options: [],
      multiSelect: false,
    },
  ],
  timestamp: 20,
  timeoutAt: 0,
  ...extra,
});

describe('buildNeedsYouItems', () => {
  it('merges both sessions in timestamp order and resolves direct tab before targets and session', () => {
    const items = buildNeedsYouItems(
      [
        permission('p2', { tabId: 'b', sessionId: 's1', timestamp: 30 }),
        permission('p1', { sessionId: 's1' }),
      ],
      [question('q', { sessionId: 's2' })],
      [],
      tiles,
      (id) => (id === 'p1' ? ['b'] : []),
    );
    expect(items.map(({ key, tabId }) => [key, tabId])).toEqual([
      ['perm:p1', 'b'],
      ['q:q', 'b'],
      ['perm:p2', 'b'],
    ]);
    expect(tiles.map((tile) => tile.tabId)).toEqual(['a', 'b']);
  });

  it('uses question targets, skips surface requests and unknown tiles', () => {
    const items = buildNeedsYouItems(
      [
        permission('surface', { sessionId: 's1', surfaceMode: true }),
        permission('lost'),
      ],
      [question('q', { sessionId: 's1' })],
      [],
      tiles,
      () => [],
      () => ['b'],
    );
    expect(items.map((item) => [item.key, item.tabId])).toEqual([['q:q', 'b']]);
  });

  it('shows lane requests only under an exact parent session', () => {
    const agents = [
      {
        agentId: 'owned',
        parentSessionId: 's2',
        displayName: 'Codex',
        permissionQueue: [
          {
            requestId: 'r',
            toolName: 'bash',
            description: 'Run command',
            timestamp: 5,
          },
        ],
      },
      {
        agentId: 'unresolved',
        permissionQueue: [{ requestId: 'x', timestamp: 6 }],
      },
    ] as MonitoredAgent[];
    const items = buildNeedsYouItems([], [], agents, tiles, () => []);
    expect(items.map((item) => [item.key, item.tabId, item.requester])).toEqual(
      [['lane:owned:r', 'b', 'Codex']],
    );
  });
});
