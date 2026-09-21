import type { Session, WebContents } from 'electron';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { installPermissionPolicy } from './permission-policy';

type RequestHandler = NonNullable<
  Parameters<Session['setPermissionRequestHandler']>[0]
>;
type CheckHandler = NonNullable<
  Parameters<Session['setPermissionCheckHandler']>[0]
>;
const RENDERER = 'file:///C:/app/renderer/index.html';

/**
 * Every fixture below is the shape Electron 44 was MEASURED to deliver, not a
 * hand-written optimistic one. The measurement is recorded in
 * `.ptah/specs/TASK_2026_491_e0da/implementation-notes.md`: a throwaway
 * Electron main process installed grant-everything handlers, loaded a `file:`
 * document and logged every `(permission, details)` pair.
 *
 * The two shapes differ, and the difference is the whole point:
 *
 * - request (`PermissionRequest` / `MediaAccessPermissionRequest`,
 *   `electron.d.ts:10885,9479`) — `{ isMainFrame, requestingUrl }`, plus
 *   `mediaTypes` and `securityOrigin` for `media` only.
 * - check (`PermissionCheckHandlerHandlerDetails`, `electron.d.ts:23372`) —
 *   `{ isMainFrame, requestingUrl?, embeddingOrigin? }`, plus `mediaType` for
 *   a typed media query. `securityOrigin` is ABSENT on the check Chromium
 *   raises for `navigator.permissions.query({ name: 'microphone' })`, and a
 *   `media` check with no `mediaType` at all is also raised around capture.
 */
function detailsFor(
  kind: 'request' | 'check',
  permission: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const base =
    kind === 'request'
      ? { isMainFrame: true, requestingUrl: RENDERER }
      : {
          isMainFrame: true,
          requestingUrl: RENDERER,
          embeddingOrigin: 'file:///',
        };
  const media =
    kind === 'request'
      ? { mediaTypes: ['audio'], securityOrigin: 'file:///' }
      : { mediaType: 'audio' };
  return {
    ...base,
    ...(permission === 'media' ? media : {}),
    ...overrides,
  };
}

describe('Electron shell permission handlers', () => {
  let request: RequestHandler;
  let check: CheckHandler;
  let contents: WebContents;
  let currentUrl: string;

  beforeEach(() => {
    currentUrl = RENDERER;
    contents = {
      id: 7,
      getURL: () => currentUrl,
      session: {
        setPermissionRequestHandler: (handler: RequestHandler) => {
          request = handler;
        },
        setPermissionCheckHandler: (handler: CheckHandler) => {
          check = handler;
        },
      },
    } as unknown as WebContents;
    installPermissionPolicy(contents, RENDERER);
  });

  const allowed = ['media', 'clipboard-sanitized-write'] as const;
  const denied = [
    'geolocation',
    'notifications',
    'clipboard-read',
    'deprecated-sync-clipboard-read',
    'midiSysex',
    'display-capture',
    'speaker-selection',
    'openExternal',
    'unknown',
  ] as const;

  function invoke(
    handler: 'request' | 'check',
    permission: Parameters<CheckHandler>[1],
    subject: WebContents | null,
    details: Record<string, unknown>,
    origin = 'file:///',
  ): boolean {
    if (handler === 'check') {
      return check(
        subject,
        permission,
        origin,
        details as unknown as Electron.PermissionCheckHandlerHandlerDetails,
      );
    }
    const callback = jest.fn();
    // Exercise null defensively even though Electron types requests non-null.
    request(
      subject as WebContents,
      permission,
      callback,
      details as unknown as Electron.PermissionRequest,
    );
    expect(callback).toHaveBeenCalledTimes(1);
    return callback.mock.calls[0][0];
  }

  describe.each(['request', 'check'] as const)(
    '%s handler decision matrix',
    (handler) => {
      const rows = [
        ['trusted main frame', true, RENDERER, false, true],
        ['trusted subframe', false, RENDERER, false, false],
        [
          'other origin main frame',
          true,
          'https://evil.example/',
          false,
          false,
        ],
        ['other origin subframe', false, 'https://evil.example/', false, false],
        ['no requester', true, RENDERER, true, false],
      ] as const;
      describe.each(rows)(
        '%s',
        (_label, isMainFrame, requestingUrl, noRequester, expected) => {
          it.each(allowed)('allowlist cell: %s', (permission) => {
            expect(
              invoke(
                handler,
                permission,
                noRequester ? null : contents,
                detailsFor(handler, permission, { isMainFrame, requestingUrl }),
              ),
            ).toBe(expected);
          });
          it.each(denied)('non-allowlist cell: %s', (permission) => {
            expect(
              invoke(
                handler,
                permission,
                noRequester ? null : contents,
                detailsFor(handler, permission, { isMainFrame, requestingUrl }),
              ),
            ).toBe(false);
          });
        },
      );

      it.each([
        'https:///C:/app/renderer/index.html', // different scheme
        'file://evil/C:/app/renderer/index.html', // empty host is a prefix of every host
        'file:///C:/app/renderer/other.html',
        'file:///C:/app/renderer/index.html.bak',
        'data:text/html,hello',
        'not a URL',
        '',
      ])('denies near matches and malformed subjects: %s', (requestingUrl) => {
        expect(
          invoke(
            handler,
            'media',
            contents,
            detailsFor(handler, 'media', { requestingUrl }),
          ),
        ).toBe(false);
      });

      it.each([
        { isMainFrame: undefined },
        { isMainFrame: 'true' },
        { requestingUrl: undefined },
        { securityOrigin: 'https://evil.example' },
        { securityOrigin: 'null' },
      ])('fails closed on a hostile or missing field: %j', (details) => {
        expect(
          invoke(
            handler,
            'media',
            contents,
            detailsFor(handler, 'media', details),
          ),
        ).toBe(false);
      });

      it('denies a video media grant', () => {
        expect(
          invoke(
            handler,
            'media',
            contents,
            detailsFor(
              handler,
              'media',
              handler === 'request'
                ? { mediaTypes: ['video'] }
                : { mediaType: 'video' },
            ),
          ),
        ).toBe(false);
      });

      it('denies a media grant that also asks for video', () => {
        expect(
          invoke(
            handler,
            'media',
            contents,
            detailsFor(
              handler,
              'media',
              handler === 'request'
                ? { mediaTypes: ['audio', 'video'] }
                : { mediaType: 'unknown' },
            ),
          ),
        ).toBe(false);
      });

      it('does not grant a different window even if its id matches', () => {
        expect(
          invoke(
            handler,
            'media',
            { ...contents } as WebContents,
            detailsFor(handler, 'media'),
          ),
        ).toBe(false);
      });

      it('checks the top-level document as well as the requesting document', () => {
        currentUrl = 'file:///C:/app/assets/preparing-workspace.html';
        expect(
          invoke(handler, 'media', contents, detailsFor(handler, 'media')),
        ).toBe(false);
      });

      it('allows the measured clipboard-write shape, which carries no media field', () => {
        expect(
          invoke(
            handler,
            'clipboard-sanitized-write',
            contents,
            detailsFor(handler, 'clipboard-sanitized-write'),
          ),
        ).toBe(true);
      });

      it.each([
        'file:///c:/app/renderer/index.html',
        'file:///C:/app/renderer/index.html',
      ])(
        'accepts either drive-letter case for the same document: %s',
        (requestingUrl) => {
          currentUrl = requestingUrl;
          expect(
            invoke(
              handler,
              'media',
              contents,
              detailsFor(handler, 'media', { requestingUrl }),
            ),
          ).toBe(true);
        },
      );
    },
  );

  // The measured request shape. Chromium raises a `media` request only through
  // getUserMedia, and always with mediaTypes. A request without it cannot be
  // proved audio-only, so it is denied.
  it.each([{ mediaTypes: undefined }, { mediaTypes: [] }])(
    'denies a media request with no stated media type: %j',
    (details) => {
      expect(
        invoke(
          'request',
          'media',
          contents,
          detailsFor('request', 'media', details),
        ),
      ).toBe(false);
    },
  );

  // The measured check shapes. Electron omits securityOrigin for a
  // same-document permission query, and omits mediaType entirely on the
  // internal checks it raises around capture. Neither absence may deny: a
  // check reports state only, and capture itself stays gated by the request
  // handler above.
  it.each([
    { securityOrigin: undefined, mediaType: 'audio' },
    { securityOrigin: undefined, mediaType: undefined },
    { securityOrigin: 'file:///', mediaType: 'audio' },
    { securityOrigin: 'file:///', mediaType: undefined },
    { embeddingOrigin: undefined, mediaType: 'audio' },
  ])('allows the measured media check shape: %j', (details) => {
    expect(
      invoke('check', 'media', contents, detailsFor('check', 'media', details)),
    ).toBe(true);
  });

  // embeddingOrigin is a check-only field: Electron never sends it on a
  // request, so only the check handler can weigh it.
  it('denies a check embedded by another origin', () => {
    expect(
      invoke(
        'check',
        'media',
        contents,
        detailsFor('check', 'media', {
          embeddingOrigin: 'https://evil.example',
        }),
      ),
    ).toBe(false);
  });

  it('denies a check whose requestingUrl Electron omitted', () => {
    expect(
      invoke(
        'check',
        'media',
        contents,
        detailsFor('check', 'media', { requestingUrl: undefined }),
      ),
    ).toBe(false);
  });

  it.each(['https://evil.example', 'file://evil/', 'null', ''])(
    'checks the permission-check origin argument: %s',
    (origin) => {
      expect(
        invoke(
          'check',
          'media',
          contents,
          detailsFor('check', 'media'),
          origin,
        ),
      ).toBe(false);
    },
  );

  it.each(['development', 'production'])(
    'pins the %s load origin to file: with an empty host',
    () => {
      const activation = readFileSync(
        join(__dirname, '../activation/post-window.ts'),
        'utf8',
      );
      expect(activation).toContain(
        "path.join(__dirname, 'renderer', 'index.html')",
      );
      expect(activation).toContain('mainWindow.loadFile(rendererPath)');
      expect(activation).not.toContain('loadURL(');
      expect(new URL(RENDERER).protocol).toBe('file:');
      expect(new URL(RENDERER).host).toBe('');
      expect(new URL(RENDERER).origin).toBe('null');
    },
  );

  it('pins permission installation and existing window protections', () => {
    const factory = readFileSync(join(__dirname, 'main-window.ts'), 'utf8');
    expect(factory).toContain('installPermissionPolicy(');
    expect(factory).toContain(
      "pathToFileURL(path.join(__dirname, 'renderer', 'index.html')).href",
    );
    for (const setting of [
      'contextIsolation: true',
      'nodeIntegration: false',
      'sandbox: true',
      'webSecurity: true',
      'installNavigationGuard(mainWindow)',
    ]) {
      expect(factory).toContain(setting);
    }
  });
});
