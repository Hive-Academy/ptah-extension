import {
  isTrustedIpcSender,
  type IpcSenderIdentity,
  type TrustedIpcSender,
} from './ipc-sender-policy';

const WIN_TRUSTED: TrustedIpcSender = {
  webContentsId: 7,
  documentPaths: [
    'C:\\app\\renderer\\index.html',
    'C:\\app\\assets\\preparing-workspace.html',
  ],
};
const WIN_RENDERER_URL = 'file:///C:/app/renderer/index.html';

const POSIX_TRUSTED: TrustedIpcSender = {
  webContentsId: 7,
  documentPaths: [
    '/opt/app/renderer/index.html',
    '/opt/app/assets/preparing-workspace.html',
  ],
};
const POSIX_RENDERER_URL = 'file:///opt/app/renderer/index.html';

function sender(overrides: Partial<IpcSenderIdentity> = {}): IpcSenderIdentity {
  return {
    webContentsId: 7,
    frameUrl: WIN_RENDERER_URL,
    isMainFrame: true,
    ...overrides,
  };
}

const onWindows = (s: IpcSenderIdentity, t: TrustedIpcSender = WIN_TRUSTED) =>
  isTrustedIpcSender(s, t, 'win32');
const onPosix = (s: IpcSenderIdentity, t: TrustedIpcSender = POSIX_TRUSTED) =>
  isTrustedIpcSender(s, t, 'linux');

describe('isTrustedIpcSender', () => {
  describe('accepts', () => {
    it('the renderer document in the main frame of the main window', () => {
      expect(onWindows(sender())).toBe(true);
    });

    it('the preparing-workspace boot shell', () => {
      expect(
        onWindows(
          sender({
            frameUrl: 'file:///C:/app/assets/preparing-workspace.html',
          }),
        ),
      ).toBe(true);
    });

    it.each([
      ['a hash route', `${WIN_RENDERER_URL}#/chat`],
      ['a query', `${WIN_RENDERER_URL}?x=1`],
      ['a query and a hash', `${WIN_RENDERER_URL}?x=1#/chat`],
    ])('the renderer document with %s', (_label, frameUrl) => {
      expect(onWindows(sender({ frameUrl }))).toBe(true);
    });

    it('a different drive-letter case on Windows', () => {
      expect(
        onWindows(sender({ frameUrl: 'file:///c:/app/renderer/index.html' })),
      ).toBe(true);
    });

    it('a different path case on Windows', () => {
      expect(
        onWindows(sender({ frameUrl: 'file:///C:/APP/Renderer/INDEX.html' })),
      ).toBe(true);
    });

    it('a non-normalized path that resolves to the renderer', () => {
      expect(
        onWindows(
          sender({ frameUrl: 'file:///C:/app/assets/../renderer/index.html' }),
        ),
      ).toBe(true);
    });

    it('the renderer document on POSIX', () => {
      expect(onPosix(sender({ frameUrl: POSIX_RENDERER_URL }))).toBe(true);
    });
  });

  describe('rejects', () => {
    it('any sender before a window exists (webContentsId null)', () => {
      expect(onWindows(sender(), { ...WIN_TRUSTED, webContentsId: null })).toBe(
        false,
      );
    });

    it('another webContents showing the same document', () => {
      expect(onWindows(sender({ webContentsId: 8 }))).toBe(false);
    });

    it('a subframe of the main window', () => {
      expect(onWindows(sender({ isMainFrame: false }))).toBe(false);
    });

    it('a missing frame URL (destroyed frame)', () => {
      expect(onWindows(sender({ frameUrl: undefined }))).toBe(false);
    });

    it.each([
      ['an empty URL', ''],
      ['a malformed URL', 'not a url'],
    ])('%s', (_label, frameUrl) => {
      expect(onWindows(sender({ frameUrl }))).toBe(false);
    });

    it.each([
      ['http:', 'http://localhost/renderer/index.html'],
      ['https:', 'https://example.com/C:/app/renderer/index.html'],
      ['devtools:', 'devtools://devtools/bundled/inspector.html'],
      ['data:', 'data:text/html,<p>hi</p>'],
    ])('a %s URL', (_label, frameUrl) => {
      expect(onWindows(sender({ frameUrl }))).toBe(false);
    });

    it.each([
      ['a sibling file', 'file:///C:/app/renderer/other.html'],
      ['a parent-directory escape', 'file:///C:/app/renderer/../../etc/x.html'],
      ['another drive', 'file:///D:/app/renderer/index.html'],
      ['a UNC share', 'file://server/app/renderer/index.html'],
    ])('another file: path (%s)', (_label, frameUrl) => {
      expect(onWindows(sender({ frameUrl }))).toBe(false);
    });

    it('a different path case on POSIX', () => {
      expect(
        onPosix(sender({ frameUrl: 'file:///opt/APP/renderer/index.html' })),
      ).toBe(false);
    });

    it('a file: URL with a remote host on POSIX', () => {
      expect(
        onPosix(
          sender({ frameUrl: 'file://evil/opt/app/renderer/index.html' }),
        ),
      ).toBe(false);
    });

    it('everything when no document paths are trusted', () => {
      expect(onWindows(sender(), { ...WIN_TRUSTED, documentPaths: [] })).toBe(
        false,
      );
    });
  });
});
