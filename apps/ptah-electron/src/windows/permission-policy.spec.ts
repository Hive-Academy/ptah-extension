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
    'midiSysex',
    'display-capture',
    'unknown',
  ] as const;

  function invoke(
    handler: 'request' | 'check',
    permission: Parameters<CheckHandler>[1],
    subject: WebContents | null,
    details: Record<string, unknown> = {},
    origin = 'file:///',
  ): boolean {
    const requestDetails = {
      requestingUrl: RENDERER,
      isMainFrame: true,
      securityOrigin: 'file:///',
      mediaTypes: ['audio'],
      mediaType: 'audio',
      ...details,
    };
    if (handler === 'check') {
      return check(
        subject,
        permission,
        origin,
        requestDetails as Electron.PermissionCheckHandlerHandlerDetails,
      );
    }
    const callback = jest.fn();
    // Exercise null defensively even though Electron types requests non-null.
    request(
      subject as WebContents,
      permission,
      callback,
      requestDetails as Electron.PermissionRequest,
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
              invoke(handler, permission, noRequester ? null : contents, {
                isMainFrame,
                requestingUrl,
              }),
            ).toBe(expected);
          });
          it.each(denied)('non-allowlist cell: %s', (permission) => {
            expect(
              invoke(handler, permission, noRequester ? null : contents, {
                isMainFrame,
                requestingUrl,
              }),
            ).toBe(false);
          });
        },
      );

      it.each([
        'https:///C:/app/renderer/index.html', // different scheme
        'file://evil/C:/app/renderer/index.html', // empty host is a prefix of every host
        'file:///C:/app/renderer/other.html',
        'data:text/html,hello',
        'not a URL',
        '',
      ])('denies near matches and malformed subjects: %s', (requestingUrl) => {
        expect(invoke(handler, 'media', contents, { requestingUrl })).toBe(
          false,
        );
      });

      it.each([
        { isMainFrame: undefined },
        { isMainFrame: 'true' },
        { requestingUrl: undefined },
        { securityOrigin: 'https://evil.example' },
        { securityOrigin: 'null' },
        { securityOrigin: undefined },
        { embeddingOrigin: 'https://evil.example' },
        { mediaTypes: ['video'], mediaType: 'video' },
        { mediaTypes: ['audio', 'video'], mediaType: 'unknown' },
        { mediaTypes: [], mediaType: undefined },
        { mediaTypes: undefined, mediaType: undefined },
      ])('fails closed on incomplete or conflicting details: %j', (details) => {
        expect(invoke(handler, 'media', contents, details)).toBe(false);
      });

      it('does not grant a different window even if its id matches', () => {
        expect(invoke(handler, 'media', { ...contents } as WebContents)).toBe(
          false,
        );
      });
      it('checks the top-level document as well as the requesting document', () => {
        currentUrl = 'file:///C:/app/assets/preparing-workspace.html';
        expect(invoke(handler, 'media', contents)).toBe(false);
      });
      it('allows clipboard writes without media-specific fields', () => {
        expect(
          invoke(handler, 'clipboard-sanitized-write', contents, {
            mediaTypes: undefined,
            mediaType: undefined,
            securityOrigin: undefined,
          }),
        ).toBe(true);
      });
    },
  );

  it.each(['https://evil.example', 'file://evil/', 'null', ''])(
    'checks the permission-check origin argument: %s',
    (origin) => {
      expect(invoke('check', 'media', contents, {}, origin)).toBe(false);
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
