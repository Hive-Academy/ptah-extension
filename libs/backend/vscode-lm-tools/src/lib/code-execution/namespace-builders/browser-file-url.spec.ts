import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  canonicalPathInsideRoot,
  evaluateFileUrl,
  fileUrlFailsClosedLexically,
  MAX_CONTAINED_FILE_BYTES,
  readContainedWorkspaceFile,
  toolMayReadPage,
  type ContainedFileHandle,
  type ContainedFileIdentity,
  type ContainedFileSystem,
} from './browser-file-url';

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  const code = error.code;
  return typeof code === 'string' ? code : undefined;
}

describe('canonicalPathInsideRoot', () => {
  it('uses Windows case-insensitivity and rejects a string-prefix escape', () => {
    expect(
      canonicalPathInsideRoot(
        'C:\\Work\\a.html',
        'c:\\work',
        'win32',
      ),
    ).toBe(true);
    expect(
      canonicalPathInsideRoot('C:\\Work\\a.html', 'C:\\Work', 'win32'),
    ).toBe(true);
    expect(
      canonicalPathInsideRoot(
        'C:\\Workspace\\a.html',
        'C:\\Work',
        'win32',
      ),
    ).toBe(false);
    expect(
      canonicalPathInsideRoot('D:\\Work\\a.html', 'C:\\Work', 'win32'),
    ).toBe(false);
  });

  it('keeps POSIX comparison case-sensitive', () => {
    expect(
      canonicalPathInsideRoot('/Work/a.html', '/Work', 'linux'),
    ).toBe(true);
    expect(
      canonicalPathInsideRoot('/work/a.html', '/Work', 'linux'),
    ).toBe(false);
  });

  it('allows a child named ..preview.html and still rejects a .. segment', () => {
    expect(
      canonicalPathInsideRoot('/Work/..preview.html', '/Work', 'linux'),
    ).toBe(true);
    expect(
      canonicalPathInsideRoot('/Work/../secret.html', '/Work', 'linux'),
    ).toBe(false);
    expect(
      canonicalPathInsideRoot(
        'C:\\Work\\..preview.html',
        'C:\\Work',
        'win32',
      ),
    ).toBe(true);
    expect(
      canonicalPathInsideRoot(
        'C:\\Work\\..\\secret.html',
        'C:\\Work',
        'win32',
      ),
    ).toBe(false);
  });
});

describe('fileUrlFailsClosedLexically', () => {
  it('rejects hosts, dot segments, encoded separators and drive-relative paths', () => {
    expect(fileUrlFailsClosedLexically('file://server/share/a.html')).toBe(
      true,
    );
    expect(fileUrlFailsClosedLexically('file://localhost/C:/a.html')).toBe(
      true,
    );
    expect(fileUrlFailsClosedLexically('file:///C:/a/../b.html')).toBe(true);
    expect(fileUrlFailsClosedLexically('file:///C:/a/%2e%2e/b.html')).toBe(
      true,
    );
    expect(fileUrlFailsClosedLexically('file:///C:/a/%2Fetc/passwd')).toBe(
      true,
    );
    expect(fileUrlFailsClosedLexically('file:///C:/a/%ZZ')).toBe(true);
    expect(fileUrlFailsClosedLexically('file:///C:relative/a.html')).toBe(
      true,
    );
    expect(fileUrlFailsClosedLexically('file:///C:/CON')).toBe(true);
    expect(fileUrlFailsClosedLexically('https://example.com')).toBe(false);
    expect(fileUrlFailsClosedLexically('file://?/C:/page.html')).toBe(true);
    expect(fileUrlFailsClosedLexically('file://#/C:/page.html')).toBe(true);
    expect(fileUrlFailsClosedLexically('file://user@host/share')).toBe(true);
    expect(fileUrlFailsClosedLexically('file://host:445/share')).toBe(true);
  });
});

describe('evaluateFileUrl', () => {
  let root: string;
  let outside: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'ptah-file-root-'));
    outside = await fs.mkdtemp(path.join(os.tmpdir(), 'ptah-file-out-'));
    await fs.writeFile(path.join(root, 'page.html'), '<p>ok</p>');
    await fs.writeFile(path.join(outside, 'secret.html'), 'SECRET');
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  });

  it('allows an existing file inside a realpath root and rejects one outside', async () => {
    const inside = pathToFileURL(path.join(root, 'page.html')).href;
    const outsideUrl = pathToFileURL(path.join(outside, 'secret.html')).href;
    await expect(evaluateFileUrl(inside, [root])).resolves.toEqual({
      allowed: true,
    });
    await expect(evaluateFileUrl(outsideUrl, [root])).resolves.toEqual({
      allowed: false,
    });
    await expect(evaluateFileUrl(inside, [])).resolves.toEqual({
      allowed: false,
    });
  });

  it('rejects a symlink or junction whose realpath leaves the root', async () => {
    const secret = path.join(outside, 'secret.html');
    const linkPath = await escapingLink(root, outside, secret);
    if (linkPath === undefined) {
      // Symlink and junction creation were both denied in this environment.
      expect(process.platform === 'win32' || process.platform === 'linux').toBe(
        true,
      );
      return;
    }
    const decision = await evaluateFileUrl(pathToFileURL(linkPath).href, [
      root,
    ]);
    expect(decision).toEqual({ allowed: false });
  });

  it('allows a real file whose name is ..preview.html', async () => {
    const preview = path.join(root, '..preview.html');
    await fs.writeFile(preview, 'preview');
    await expect(
      evaluateFileUrl(pathToFileURL(preview).href, [root]),
    ).resolves.toEqual({ allowed: true });
  });

  it('rejects file URLs whose authority contains ? # @ or :', async () => {
    await expect(evaluateFileUrl('file://?/C:/page.html', [root])).resolves.toEqual({
      allowed: false,
    });
    await expect(evaluateFileUrl('file://#/page.html', [root])).resolves.toEqual({
      allowed: false,
    });
    await expect(
      evaluateFileUrl('file://user@host/share', [root]),
    ).resolves.toEqual({ allowed: false });
    await expect(
      evaluateFileUrl('file://localhost:445/share', [root]),
    ).resolves.toEqual({ allowed: false });
  });
});

describe('readContainedWorkspaceFile', () => {
  let root: string;
  let outside: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'ptah-file-read-'));
    outside = await fs.mkdtemp(path.join(os.tmpdir(), 'ptah-file-read-out-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  });

  it('returns canonical bytes and fails when the body exceeds the cap', async () => {
    const page = path.join(root, 'page.html');
    await fs.writeFile(page, '<p>SAFE</p>');
    const payload = await readContainedWorkspaceFile(
      pathToFileURL(page).href,
      [root],
    );
    expect(payload?.bodyBase64).toBe(
      Buffer.from('<p>SAFE</p>').toString('base64'),
    );
    expect(payload?.contentType).toBe('text/html; charset=utf-8');
    await expect(
      readContainedWorkspaceFile(pathToFileURL(page).href, [root], 4),
    ).resolves.toBeUndefined();
    const secret = path.join(outside, 'secret.html');
    await fs.writeFile(secret, 'SECRET');
    await expect(
      readContainedWorkspaceFile(pathToFileURL(secret).href, [root]),
    ).resolves.toBeUndefined();
  });

  it('refuses a descriptor whose dev/ino differ from the checked path', async () => {
    const page = path.join(root, 'page.html');
    await fs.writeFile(page, 'SAFE');
    const checked = identity(1n, 2n, true, 4n);
    const opened = identity(1n, 9n, true, 4n);
    const open = jest.fn(async (): Promise<ContainedFileHandle> => {
      return handleFrom(opened, Buffer.from('LEAK'));
    });
    const payload = await readContainedWorkspaceFile(
      pathToFileURL(page).href,
      [root],
      MAX_CONTAINED_FILE_BYTES,
      fakeFs(checked, open),
    );
    expect(payload).toBeUndefined();
    expect(open).toHaveBeenCalled();
  });

  it('refuses a FIFO before open', async () => {
    const page = path.join(root, 'page.html');
    await fs.writeFile(page, 'SAFE');
    const open = jest.fn(async (): Promise<ContainedFileHandle> => {
      throw new Error('open must not run for a FIFO');
    });
    const payload = await readContainedWorkspaceFile(
      pathToFileURL(page).href,
      [root],
      MAX_CONTAINED_FILE_BYTES,
      fakeFs(identity(1n, 1n, false, 0n), open),
    );
    expect(payload).toBeUndefined();
    expect(open).not.toHaveBeenCalled();
  });
});

function identity(
  dev: bigint,
  ino: bigint,
  regularFile: boolean,
  size: bigint,
): ContainedFileIdentity {
  return { dev, ino, size, regularFile };
}

function handleFrom(
  opened: ContainedFileIdentity,
  body: Buffer,
): ContainedFileHandle {
  return {
    stat: async () => opened,
    read: async (buffer, offset, length) => {
      body.copy(buffer, offset, 0, length);
      return { bytesRead: body.length };
    },
    close: async () => undefined,
  };
}

function fakeFs(
  checked: ContainedFileIdentity,
  open: ContainedFileSystem['open'],
): ContainedFileSystem {
  return {
    lstat: async () => checked,
    open,
    realpath: async (filePath: string) => fs.realpath(filePath),
  };
}

describe('toolMayReadPage', () => {
  it('allows about:blank and https, and refuses data: and javascript:', async () => {
    await expect(toolMayReadPage('about:blank', [], false)).resolves.toBe(true);
    await expect(
      toolMayReadPage('https://example.com/path', [], false),
    ).resolves.toBe(true);
    await expect(
      toolMayReadPage('data:text/html,hi', [], false),
    ).resolves.toBe(false);
    await expect(toolMayReadPage('javascript:alert(1)', [], false)).resolves.toBe(
      false,
    );
    await expect(toolMayReadPage('blob:https://example.com/id', [], false)).resolves.toBe(
      false,
    );
    await expect(
      toolMayReadPage('http://localhost:3000/', [], false),
    ).resolves.toBe(false);
    await expect(
      toolMayReadPage('http://localhost:3000/', [], true),
    ).resolves.toBe(true);
  });
});

async function escapingLink(
  root: string,
  outsideDir: string,
  outsideFile: string,
): Promise<string | undefined> {
  const fileLink = path.join(root, 'escape-link.html');
  try {
    await fs.symlink(outsideFile, fileLink);
    return fileLink;
  } catch (error: unknown) {
    const code = errorCode(error);
    if (code !== 'EPERM' && code !== 'EACCES' && code !== 'ENOTSUP') {
      throw error;
    }
  }
  if (process.platform !== 'win32') {
    return undefined;
  }
  const junction = path.join(root, 'escape-junction');
  try {
    await fs.symlink(outsideDir, junction, 'junction');
    return path.join(junction, path.basename(outsideFile));
  } catch (error: unknown) {
    const code = errorCode(error);
    if (code === 'EPERM' || code === 'EACCES' || code === 'ENOTSUP') {
      return undefined;
    }
    throw error;
  }
}
