import {
  WORKSPACE_WATCH_PROTOCOL_LIMITS,
  clipWorkspaceWatchText,
  parseWorkspaceWatchHostInbound,
  parseWorkspaceWatchHostOutbound,
  toWorkspaceWatchBatchMessage,
  toWorkspaceWatchSubscribeMessage,
} from './workspace-watch-protocol';

const baseOptions = {
  excludeGlobs: ['**/dist/**'],
  excludeDirNames: ['node_modules'],
  excludeSegmentRules: [['.claude', 'worktrees']],
  nestedRepoDetection: true,
};

describe('workspace watch protocol', () => {
  describe('inbound (adapter → host)', () => {
    it('round-trips a subscribe built from port options', () => {
      const message = toWorkspaceWatchSubscribeMessage(7, '/repo', {
        ...baseOptions,
        nestedRepoRoots: ['/repo/wt'],
        minBatchIntervalMs: 500,
        maxPathsPerBatch: 10,
      });

      expect(parseWorkspaceWatchHostInbound(message)).toEqual(message);
    });

    it('omits optional options that were not given', () => {
      const message = toWorkspaceWatchSubscribeMessage(1, '/repo', baseOptions);

      expect(Object.keys(message.options).sort()).toEqual([
        'excludeDirNames',
        'excludeGlobs',
        'excludeSegmentRules',
        'nestedRepoDetection',
      ]);
    });

    it('accepts unsubscribe', () => {
      expect(
        parseWorkspaceWatchHostInbound({ type: 'unsubscribe', id: 3 }),
      ).toEqual({ type: 'unsubscribe', id: 3 });
    });

    it.each([
      ['a non-object', 'subscribe'],
      ['an unknown type', { type: 'kill', id: 1 }],
      ['a zero id', { type: 'unsubscribe', id: 0 }],
      ['a fractional id', { type: 'unsubscribe', id: 1.5 }],
      ['an extra key', { type: 'unsubscribe', id: 1, extra: true }],
      [
        'an empty root',
        { type: 'subscribe', id: 1, root: '', options: baseOptions },
      ],
      [
        'missing exclusion lists',
        { type: 'subscribe', id: 1, root: '/r', options: {} },
      ],
      [
        'an oversized glob list',
        {
          type: 'subscribe',
          id: 1,
          root: '/r',
          options: {
            ...baseOptions,
            excludeGlobs: Array.from(
              { length: WORKSPACE_WATCH_PROTOCOL_LIMITS.maxListEntries + 1 },
              (_, i) => `g${i}/**`,
            ),
          },
        },
      ],
    ])('rejects %s', (_label, value) => {
      expect(parseWorkspaceWatchHostInbound(value)).toBeUndefined();
    });
  });

  describe('outbound (host → adapter)', () => {
    it('round-trips a batch built from a coalescer batch', () => {
      const message = toWorkspaceWatchBatchMessage(4, {
        root: '/repo',
        changes: [{ path: '/repo/a.ts', kind: 'create' }],
        truncated: false,
        overflow: false,
        droppedCount: 0,
      });

      expect(message).not.toHaveProperty('root');
      expect(parseWorkspaceWatchHostOutbound(message)).toEqual(message);
    });

    it.each([
      [{ type: 'heartbeat', seq: 0, subscriptions: 2, eventsPerSec: 10 }],
      [{ type: 'error', code: 'native-error', message: 'overflow' }],
      [{ type: 'error', id: 2, code: 'listener-error', message: 'x' }],
      [{ type: 'notice', code: 'storm-entered', root: '/r' }],
      [
        {
          type: 'notice',
          code: 'nested-root-detected',
          root: '/r',
          detail: '/r/a',
        },
      ],
      [{ type: 'fatal', message: 'engine missing' }],
      [{ type: 'subscribed', id: 3 }],
    ])('accepts %j', (value) => {
      expect(parseWorkspaceWatchHostOutbound(value)).toEqual(value);
    });

    it.each([
      [
        'a batch above the path ceiling',
        {
          type: 'batch',
          id: 1,
          changes: Array.from(
            { length: WORKSPACE_WATCH_PROTOCOL_LIMITS.maxChangesPerBatch + 1 },
            (_, i) => ({ path: `/r/${i}`, kind: 'update' }),
          ),
          truncated: false,
          overflow: false,
          droppedCount: 0,
        },
      ],
      [
        'an unknown change kind',
        {
          type: 'batch',
          id: 1,
          changes: [{ path: '/r/a', kind: 'rename' }],
          truncated: false,
          overflow: false,
          droppedCount: 0,
        },
      ],
      [
        'a negative dropped count',
        {
          type: 'batch',
          id: 1,
          changes: [],
          truncated: false,
          overflow: true,
          droppedCount: -1,
        },
      ],
      ['an unknown error code', { type: 'error', code: 'boom', message: '' }],
      ['a subscribed ack without an id', { type: 'subscribed' }],
      [
        'a subscribed ack with extra fields',
        { type: 'subscribed', id: 1, root: '/r' },
      ],
      [
        'an over-long message',
        {
          type: 'fatal',
          message: 'x'.repeat(
            WORKSPACE_WATCH_PROTOCOL_LIMITS.maxMessageLength + 1,
          ),
        },
      ],
    ])('rejects %s', (_label, value) => {
      expect(parseWorkspaceWatchHostOutbound(value)).toBeUndefined();
    });
  });

  it('clips diagnostic text to the protocol limit', () => {
    const max = WORKSPACE_WATCH_PROTOCOL_LIMITS.maxMessageLength;
    expect(clipWorkspaceWatchText('short')).toBe('short');
    const clipped = clipWorkspaceWatchText('y'.repeat(max * 2));
    expect(clipped).toHaveLength(max);
    expect(
      parseWorkspaceWatchHostOutbound({ type: 'fatal', message: clipped }),
    ).toBeDefined();
  });
});
