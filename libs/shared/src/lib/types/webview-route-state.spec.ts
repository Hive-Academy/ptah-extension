import {
  WEBVIEW_ROUTE_STATE_KEY,
  parseWebviewRouteState,
  type WebviewRouteState,
} from './webview-route-state';

const VALID: WebviewRouteState = {
  v: 1,
  route: '/chat/550e8400-e29b-41d4-a716-446655440000',
  seed: 'analytics',
  panelId: 'ptah.panel.550e8400-e29b-41d4-a716-446655440000',
};

/** A whole `getState()` record whose route entry is `VALID` patched by `entry`. */
function stateWith(entry: Record<string, unknown>): Record<string, unknown> {
  return {
    theme: 'dark',
    [WEBVIEW_ROUTE_STATE_KEY]: { ...VALID, ...entry },
  };
}

describe('parseWebviewRouteState', () => {
  it('uses the ptahRoute key', () => {
    expect(WEBVIEW_ROUTE_STATE_KEY).toBe('ptahRoute');
  });

  describe('valid records', () => {
    it('returns the route entry of a valid record', () => {
      expect(parseWebviewRouteState(stateWith({}))).toEqual(VALID);
    });

    it.each([
      ['/settings'],
      ['/thoth/skills'],
      ['/marketplace/servers/smithery'],
      ['/settings;panel=auth'],
      ['/'],
      ['/marketplace/connectors?category=dev-tools'],
      ['/chat/a%20b'],
      // `/marketplace/skills/:skillRef` — the one colon-bearing route.
      ['/marketplace/skills/ptah-plugin:ptah-core'],
      ['/marketplace/skills/community-skill:pdf'],
      ['/marketplace/skills/marketplace-plugin:external:owner%2Frepo%2Fplugin'],
      ['/marketplace/skills/marketplace-plugin:plain-id'],
      ['/marketplace/skills/community-skill:pdf?category=docs'],
    ])('accepts the route %s', (route) => {
      expect(parseWebviewRouteState(stateWith({ route }))?.route).toBe(route);
    });

    it('accepts a null seed', () => {
      expect(
        parseWebviewRouteState(stateWith({ seed: null }))?.seed,
      ).toBeNull();
    });

    it('accepts a seed of exactly 64 characters', () => {
      const seed = 'a'.repeat(64);
      expect(parseWebviewRouteState(stateWith({ seed }))?.seed).toBe(seed);
    });

    it('accepts a route of exactly 2048 characters', () => {
      const route = '/' + 'a'.repeat(2047);
      expect(parseWebviewRouteState(stateWith({ route }))?.route).toBe(route);
    });

    it.each([[''], ['electron-main'], ['ptah.panel.abc_DEF-1.2']])(
      'accepts the panelId %p',
      (panelId) => {
        expect(parseWebviewRouteState(stateWith({ panelId }))?.panelId).toBe(
          panelId,
        );
      },
    );

    it('ignores extra keys and returns only the contract fields', () => {
      const parsed = parseWebviewRouteState(
        stateWith({ extra: 'x', title: 'Settings' }),
      );
      expect(parsed).toEqual(VALID);
      expect(Object.keys(parsed ?? {}).sort()).toEqual(
        ['panelId', 'route', 'seed', 'v'].sort(),
      );
    });
  });

  describe('the record and the entry', () => {
    it.each([
      ['undefined', undefined],
      ['null', null],
      ['a string', 'ptahRoute'],
      ['a number', 1],
      ['an array', [VALID]],
    ])('returns null for %s as the whole record', (_label, record) => {
      expect(parseWebviewRouteState(record)).toBeNull();
    });

    it('returns null when the key is absent', () => {
      expect(parseWebviewRouteState({ theme: 'dark' })).toBeNull();
    });

    it.each([
      ['null', null],
      ['a string', '/settings'],
      ['an array', ['/settings']],
    ])('returns null when the entry is %s', (_label, entry) => {
      expect(
        parseWebviewRouteState({ [WEBVIEW_ROUTE_STATE_KEY]: entry }),
      ).toBeNull();
    });

    it('does not read the entry itself as a record', () => {
      expect(parseWebviewRouteState(VALID)).toBeNull();
    });
  });

  describe('v', () => {
    it.each([[0], [2], ['1'], [undefined]])('rejects v = %p', (v) => {
      expect(parseWebviewRouteState(stateWith({ v }))).toBeNull();
    });
  });

  describe('route', () => {
    it('rejects a missing route', () => {
      expect(
        parseWebviewRouteState(stateWith({ route: undefined })),
      ).toBeNull();
    });

    it.each([
      ['not a string', 42],
      ['empty', ''],
      ['not /-rooted', 'settings'],
      ['an authority', '//evil.example/settings'],
      ['a doubled slash inside', '/chat//settings'],
      ['an absolute URL', 'http://evil.example'],
      ['a scheme segment', '/http:evil'],
      ['a javascript: segment', '/chat/javascript:alert(1)'],
      ['a backslash', '/chat\\settings'],
      ['a leading backslash', '/\\evil.example'],
      ['a NUL', '/chat\u0000'],
      ['a newline', '/chat\n/settings'],
      ['a tab', '/chat\t'],
      ['a DEL', '/chat\u007f'],
      ['a C1 control', '/chat\u0085'],
      ['over 2048 characters', '/' + 'a'.repeat(2048)],
      // Schemes outside the start of a path segment.
      ['a scheme in the query', '/settings?next=javascript:alert(1)'],
      ['a scheme as a query key', '/settings?javascript:x=1'],
      ['a scheme in a matrix parameter', '/chat;next=http:evil'],
      ['a scheme in the fragment', '/chat#javascript:alert(1)'],
      ['a scheme mid-segment', '/chat/abc-javascript:alert(1)'],
      [
        'a scheme after an allowed prefix',
        '/x/ptah-plugin:javascript:alert(1)',
      ],
      // Skill-ref prefixes outside the skill-detail segment.
      ['an allowed prefix in the query', '/settings?next=external:attacker'],
      ['an allowed prefix in a matrix parameter', '/chat;r=ptah-plugin:x'],
      ['an allowed prefix in the fragment', '/chat#community-skill:x'],
      ['an allowed prefix in an unrelated segment', '/chat/external:attacker'],
      [
        'a skill ref under a source page',
        '/marketplace/skills/community/community-skill:pdf',
      ],
      ['a skill ref one level too deep', '/marketplace/skills/ptah-plugin:x/y'],
      [
        'a skill ref outside /marketplace/skills',
        '/chat/ptah-plugin:external:attacker',
      ],
      // Invalid skill-ref combinations.
      [
        'external under ptah-plugin',
        '/marketplace/skills/ptah-plugin:external:x',
      ],
      [
        'external under community-skill',
        '/marketplace/skills/community-skill:external:x',
      ],
      ['external used as a kind', '/marketplace/skills/external:x'],
      ['an unknown kind', '/marketplace/skills/javascript:alert(1)'],
      ['an empty id', '/marketplace/skills/ptah-plugin:'],
      [
        'a third colon in a marketplace id',
        '/marketplace/skills/marketplace-plugin:external:a:b',
      ],
      [
        'a colon in the skill-ref query',
        '/marketplace/skills/ptah-plugin:x?next=http:evil',
      ],
      [
        'an encoded colon in a skill ref',
        '/marketplace/skills/ptah-plugin%3Ax',
      ],
      ['a bare colon', '/chat/:x'],
      // Percent-encoded forms of every rejected character.
      ['an encoded //', '/chat/%2F%2Fevil'],
      ['an encoded / beside a raw /', '/chat/%2F/evil'],
      ['an encoded backslash', '/chat/%5Cevil'],
      ['an encoded NUL', '/chat/%00x'],
      ['an encoded newline', '/chat/%0Ax'],
      ['an encoded C1 control', '/chat/%C2%85x'],
      ['an encoded scheme colon', '/chat/javascript%3Aalert(1)'],
      ['an encoded scheme in the query', '/settings?next=http%3A%2F%2Fevil'],
      // Malformed escapes the Router cannot decode.
      ['a lone %', '/%'],
      ['a non-hex escape', '/%GG'],
      ['a truncated escape', '/chat/%2'],
      ['an invalid UTF-8 escape', '/chat/%C2'],
    ])('rejects a route that is %s', (_label, route) => {
      expect(parseWebviewRouteState(stateWith({ route }))).toBeNull();
    });
  });

  describe('seed', () => {
    it.each([
      ['missing', undefined],
      ['a number', 3],
      ['over 64 characters', 'a'.repeat(65)],
    ])('rejects a seed that is %s', (_label, seed) => {
      expect(parseWebviewRouteState(stateWith({ seed }))).toBeNull();
    });
  });

  describe('panelId', () => {
    it.each([
      ['missing', undefined],
      ['null', null],
      ['an invalid character', 'ptah.panel.abc/def'],
      ['a space', 'ptah.panel.abc def'],
      ['a non-ASCII character', 'ptah.panel.abé'],
      ['an unknown shape', 'sidebar'],
      ['an empty panel suffix', 'ptah.panel.'],
      ['over 128 characters', 'ptah.panel.' + 'a'.repeat(118)],
    ])('rejects a panelId that is %s', (_label, panelId) => {
      expect(parseWebviewRouteState(stateWith({ panelId }))).toBeNull();
    });

    it('accepts a panelId of exactly 128 characters', () => {
      const panelId = 'ptah.panel.' + 'a'.repeat(117);
      expect(panelId).toHaveLength(128);
      expect(parseWebviewRouteState(stateWith({ panelId }))?.panelId).toBe(
        panelId,
      );
    });
  });

  describe('never throws', () => {
    it('returns null when the record has a throwing getter', () => {
      const record = {
        get [WEBVIEW_ROUTE_STATE_KEY](): unknown {
          throw new Error('hostile getter');
        },
      };
      expect(parseWebviewRouteState(record)).toBeNull();
    });

    it('returns null when the entry has a throwing getter', () => {
      const entry = {
        v: 1,
        seed: null,
        panelId: '',
        get route(): string {
          throw new Error('hostile getter');
        },
      };
      expect(
        parseWebviewRouteState({ [WEBVIEW_ROUTE_STATE_KEY]: entry }),
      ).toBeNull();
    });

    it('returns null when the record is a proxy whose get trap throws', () => {
      const record = new Proxy(
        {},
        {
          get(): never {
            throw new Error('hostile trap');
          },
        },
      );
      expect(parseWebviewRouteState(record)).toBeNull();
    });

    it('returns null for a revoked proxy', () => {
      const { proxy, revoke } = Proxy.revocable({}, {});
      revoke();
      expect(parseWebviewRouteState(proxy)).toBeNull();
    });
  });
});
