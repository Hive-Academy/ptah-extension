import type { DisplaySurface } from '@ptah-extension/chat-ui/display-panel';
import type { TurnSummaryModel } from '@ptah-extension/chat-ui/turn-recap';
import type { SurfaceViewState } from '@ptah-extension/declarative-dashboard';
import type { ArtifactRecord } from '@ptah-extension/shared';
import {
  actionToWire,
  parseActionPush,
  parseWireState,
  selectionForKey,
  selectionKey,
  toJsonValue,
  toWire,
  utf8ByteLength,
  type DisplayWindowView,
} from './display-window-wire';

const artifact: ArtifactRecord = {
  id: 'abcdefghijklmnop',
  title: 'Preview',
  revision: 2,
  sessionId: 'tab-1',
  viewerUrl: 'ptah-artifact://abcdefghijklmnop/index.html',
  createdAt: '2026-10-20T12:00:00.000Z',
};

const surface: DisplaySurface = {
  key: 'id:stats',
  displayId: 'stats',
  content: {
    contract: 'dashboard-spec/2',
    surface: {
      schemaVersion: 'dashboard-spec/2',
      catalogVersion: 'ptah-catalog/3',
      surfaceId: 'stats',
      title: 'Stats',
      root: 'root',
      components: [],
    },
    dataModel: { count: 3, rows: [{ name: 'a' }] },
  } as DisplaySurface['content'],
  title: 'Stats',
  description: null,
  turnKey: 'u1',
  fenceKey: 'm1:n1:0',
  createdSeq: 1,
  updatedSeq: 2,
  componentSignatures: new Map([['root', 'sig-root']]),
  retainedViewStateIds: new Set(['root']),
};

const tokens = { kind: 'tokens', input: 10, output: 20 } as const;
const cost = { kind: 'cost', value: '$0.01' } as const;
const duration = { kind: 'duration', value: '3s' } as const;
const summary: TurnSummaryModel = {
  incomplete: false,
  testsInBackground: false,
  files: null,
  lines: null,
  tokens,
  cost,
  duration,
  tests: null,
  cards: [tokens, cost, duration],
};

const viewState: SurfaceViewState = {
  components: {
    root: { page: 1, sort: { columnKey: 'name', direction: 'asc' } },
  },
  drafts: { note: 'hi' },
};

function view(partial: Partial<DisplayWindowView> = {}): DisplayWindowView {
  return {
    theme: { name: 'ptah-glass', mode: 'dark' },
    open: true,
    pinned: false,
    count: 3,
    selectedKey: 'artifact:abcdefghijklmnop',
    scrollToSelectedOnMount: true,
    fullscreenArtifactId: null,
    summary,
    summaryTurnKey: 'u1',
    surfaces: [surface],
    viewStates: new Map([['id:stats', viewState]]),
    artifacts: [artifact],
    actionError: null,
    notice: null,
    ...partial,
  };
}

describe('display-window-wire', () => {
  describe('selection keys', () => {
    it.each([
      [{ kind: 'summary' } as const, 'summary'],
      [{ kind: 'artifact', artifactId: 'abc' } as const, 'artifact:abc'],
      [{ kind: 'surface', surfaceKey: 'id:stats' } as const, 'id:stats'],
    ])('round-trips %j', (selection, key) => {
      expect(selectionKey(selection)).toBe(key);
      expect(selectionForKey(key)).toEqual(selection);
    });

    it('maps no selection to no key', () => {
      expect(selectionKey(null)).toBeNull();
    });
  });

  describe('toJsonValue', () => {
    it('turns Maps and Sets into arrays and drops undefined and functions', () => {
      expect(
        toJsonValue({
          map: new Map([['a', 1]]),
          set: new Set(['x']),
          gone: undefined,
          fn: () => 1,
          nan: Number.NaN,
          nested: [{ ok: true }],
        }),
      ).toEqual({
        map: [['a', 1]],
        set: ['x'],
        nan: null,
        nested: [{ ok: true }],
      });
    });
  });

  it('round-trips a view through JSON text', async () => {
    const original = view();
    const text = JSON.stringify({
      tabId: 'tab-1',
      revision: 4,
      state: toWire(original),
    });
    const parsed = await parseWireState(JSON.parse(text));

    expect(parsed).not.toBeNull();
    expect(parsed?.tabId).toBe('tab-1');
    expect(parsed?.revision).toBe(4);
    const result = parsed!.view;
    expect(result.artifacts).toEqual([artifact]);
    expect(result.summary).toEqual(JSON.parse(JSON.stringify(summary)));
    expect(result.surfaces[0].componentSignatures).toEqual(
      new Map([['root', 'sig-root']]),
    );
    expect(result.surfaces[0].retainedViewStateIds).toEqual(new Set(['root']));
    expect(result.surfaces[0].content).toEqual(surface.content);
    expect(result.viewStates.get('id:stats')).toEqual(viewState);
    expect(result.theme).toEqual({ name: 'ptah-glass', mode: 'dark' });
    expect(result.selectedKey).toBe('artifact:abcdefghijklmnop');
  });

  it.each<
    [string, (state: Record<string, unknown>) => Record<string, unknown>]
  >([
    ['an unknown version', (state) => ({ ...state, version: 99 })],
    ['an extra field', (state) => ({ ...state, extra: 1 })],
    [
      'a bad theme name',
      (state) => ({ ...state, theme: { name: 'x" onload', mode: 'dark' } }),
    ],
    ['a bad artifact', (state) => ({ ...state, artifacts: [{ id: 'x' }] })],
    [
      'an unknown surface contract',
      (state) => ({
        ...state,
        surfaces: [
          {
            ...(state['surfaces'] as Record<string, unknown>[])[0],
            content: { contract: 'html' },
          },
        ],
      }),
    ],
    [
      'a summary without cards',
      (state) => ({ ...state, summary: { incomplete: false } }),
    ],
  ])('refuses %s', async (_label, mutate) => {
    const state = JSON.parse(JSON.stringify(toWire(view()))) as Record<
      string,
      unknown
    >;
    await expect(
      parseWireState({ tabId: 'tab-1', revision: 1, state: mutate(state) }),
    ).resolves.toBeNull();
  });

  it('refuses a snapshot without a tab id', async () => {
    await expect(
      parseWireState({ tabId: '', revision: 1, state: toWire(view()) }),
    ).resolves.toBeNull();
    await expect(parseWireState(null)).resolves.toBeNull();
  });

  describe('actions', () => {
    it('round-trips a view-state action', () => {
      const wire = actionToWire('tab-1', {
        type: 'view-state',
        surfaceKey: 'id:stats',
        viewState,
      });
      expect(parseActionPush(JSON.parse(JSON.stringify(wire)))).toEqual({
        tabId: 'tab-1',
        action: { type: 'view-state', surfaceKey: 'id:stats', viewState },
      });
    });

    it.each([
      { type: 'select', key: 'summary' },
      { type: 'fullscreen-closed' },
      { type: 'open-file', path: 'src/a.ts' },
      { type: 'review' },
      { type: 'attach' },
    ])('accepts %j', (action) => {
      expect(parseActionPush({ tabId: 'tab-1', action })).toEqual({
        tabId: 'tab-1',
        action,
      });
    });

    it.each([
      ['an unknown type', { tabId: 'tab-1', action: { type: 'eval' } }],
      [
        'an extra field',
        { tabId: 'tab-1', action: { type: 'review', path: 'x' } },
      ],
      ['a missing tab', { action: { type: 'review' } }],
      [
        'a bad view state',
        {
          tabId: 't',
          action: {
            type: 'view-state',
            surfaceKey: 'k',
            viewState: { components: { a: { page: -1 } }, drafts: {} },
          },
        },
      ],
    ])('refuses %s', (_label, payload) => {
      expect(parseActionPush(payload)).toBeNull();
    });
  });

  it('counts UTF-8 bytes', () => {
    expect(utf8ByteLength('abc')).toBe(3);
    expect(utf8ByteLength('é')).toBe(2);
    expect(utf8ByteLength('…')).toBe(3);
    expect(utf8ByteLength('😀')).toBe(4);
  });
});
