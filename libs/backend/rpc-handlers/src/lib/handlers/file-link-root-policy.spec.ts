import 'reflect-metadata';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * `homedir` is a non-configurable property on the `node:os` namespace, so
 * `jest.spyOn(os, 'homedir')` throws `Cannot redefine property`. The module
 * factory is the seam that actually works here, and it is the right one: the
 * alternative would be a test-only constructor parameter on the production
 * policy, which would let a caller widen its own authorized roots.
 *
 * `tmpdir` stays real, so the temp trees below are created normally. The
 * `mock` name prefix is what permits the out-of-scope reference.
 */
let mockHome: string | undefined;
jest.mock('node:os', () => {
  const actual = jest.requireActual('node:os');
  return { ...actual, homedir: () => mockHome ?? actual.homedir() };
});

import {
  CREDENTIAL_DENY_LIST,
  FileLinkRootPolicy,
  isCredentialPath,
} from './file-link-root-policy';

describe('isCredentialPath', () => {
  it.each([
    ['an SSH directory', '/home/me/.ssh/id_ed25519'],
    ['a GPG directory', '/home/me/.gnupg/secring.gpg'],
    ['an AWS directory', '/home/me/.aws/credentials'],
    ['an Azure directory', '/home/me/.azure/token.json'],
    ['a kube config', '/home/me/.kube/config'],
    ['a docker config', '/home/me/.docker/config.json'],
    ['a gcloud config', '/home/me/.config/gcloud/creds.db'],
    ['a gh hosts file', '/home/me/.config/gh/hosts.yml'],
    ['a git config directory', '/home/me/.config/git/credentials'],
  ])('denies %s', (_label, candidate) => {
    expect(isCredentialPath(candidate, 'linux')).toBe(true);
  });

  it.each([
    ['a netrc', '/home/me/.netrc'],
    ['a Windows netrc', '/home/me/_netrc'],
    ['git credentials', '/home/me/.git-credentials'],
    ['an npmrc', '/home/me/.npmrc'],
    ['a pypirc', '/home/me/.pypirc'],
    ['a pgpass', '/home/me/.pgpass'],
    ['the agent credential store', '/home/me/.claude/.credentials.json'],
    ['the rival CLI auth file', '/home/me/.codex/auth.json'],
    ["Ptah's own secret envelope store", '/home/me/.ptah/secrets.enc.json'],
  ])('denies %s', (_label, candidate) => {
    expect(isCredentialPath(candidate, 'linux')).toBe(true);
  });

  it.each([
    ['an RSA key', '/tmp/id_rsa'],
    ['an ed25519 key', '/tmp/id_ed25519.pub'],
    ['an ECDSA key', '/tmp/id_ecdsa'],
    ['a PEM', '/tmp/server.pem'],
    ['a private key', '/tmp/server.key'],
    ['a PKCS#12 bundle', '/tmp/cert.p12'],
    ['a PFX bundle', '/tmp/cert.pfx'],
    ['a dotenv', '/tmp/.env'],
    ['a scoped dotenv', '/tmp/.env.production'],
  ])('denies %s by basename', (_label, candidate) => {
    expect(isCredentialPath(candidate, 'linux')).toBe(true);
  });

  it.each([
    ['an ordinary source file', '/home/me/project/src/a.ts'],
    ['a readme', '/home/me/notes/readme.md'],
    // `.environment` must not be caught by the `.env.` rule.
    ['a file merely starting with env', '/home/me/.environment'],
    ['a directory merely containing ssh in its name', '/home/me/sshkeys/a.ts'],
  ])('allows %s', (_label, candidate) => {
    expect(isCredentialPath(candidate, 'linux')).toBe(false);
  });

  it('matches case-insensitively on win32', () => {
    expect(isCredentialPath('C:\\Users\\Me\\.SSH\\id_rsa', 'win32')).toBe(true);
    expect(
      isCredentialPath(
        'C:\\Users\\Me\\AppData\\Roaming\\Microsoft\\Credentials\\x',
        'win32',
      ),
    ).toBe(true);
    expect(
      isCredentialPath(
        'C:\\Users\\Me\\AppData\\Local\\Microsoft\\Credentials\\x',
        'win32',
      ),
    ).toBe(true);
    expect(
      isCredentialPath(
        'C:\\Users\\Me\\AppData\\Roaming\\Microsoft\\Protect\\x',
        'win32',
      ),
    ).toBe(true);
  });

  it('is case-SENSITIVE for directories on posix, where names differ', () => {
    // `.SSH` is a genuinely different directory from `.ssh` on ext4/apfs.
    // The basename must be innocuous too, or the basename rules would deny
    // this for an unrelated reason and prove nothing about directory casing.
    expect(isCredentialPath('/home/me/.SSH/notes.md', 'linux')).toBe(false);
  });

  it('keeps the deny-list non-empty in every class', () => {
    expect(CREDENTIAL_DENY_LIST.directories.length).toBeGreaterThan(0);
    expect(CREDENTIAL_DENY_LIST.files.length).toBeGreaterThan(0);
    expect(CREDENTIAL_DENY_LIST.basenames.length).toBeGreaterThan(0);
  });
});

describe('FileLinkRootPolicy', () => {
  let base: string;
  let home: string;
  let workspace: string;

  const gitInfo = { getWorktrees: jest.fn(async () => []) };

  function build(folders: string[]): FileLinkRootPolicy {
    return new FileLinkRootPolicy(
      { getWorkspaceFolders: () => folders } as never,
      gitInfo as never,
    );
  }

  beforeAll(async () => {
    base = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'ptah-policy-')),
    );
    // Siblings, so neither is a prefix of the other.
    home = path.join(base, 'home');
    workspace = path.join(base, 'ws');
    await fs.mkdir(path.join(home, '.ssh'), { recursive: true });
    await fs.mkdir(path.join(home, 'notes'), { recursive: true });
    await fs.mkdir(workspace, { recursive: true });

    await fs.writeFile(path.join(home, '.ssh', 'id_ed25519'), 'KEY', 'utf8');
    await fs.writeFile(path.join(home, 'notes', 'todo.md'), 'todo', 'utf8');
    // A dotenv INSIDE the opened project — ordinary project content.
    await fs.writeFile(path.join(workspace, '.env'), 'A=1', 'utf8');
  });

  afterAll(async () => {
    await fs.rm(base, { recursive: true, force: true });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockHome = home;
  });

  afterEach(() => {
    mockHome = undefined;
  });

  it('allows an ordinary file under home for external open', async () => {
    const result = await build([workspace]).resolveForExternalOpen({
      path: path.join(home, 'notes', 'todo.md'),
    });
    expect(result).toMatchObject({ kind: 'file' });
  });

  it('refuses a credential under home, disclosing no path', async () => {
    const result = await build([workspace]).resolveForExternalOpen({
      path: path.join(home, '.ssh', 'id_ed25519'),
    });
    expect(result).toMatchObject({
      kind: 'rejected',
      reason: 'outside-roots',
    });
    // Absent `lexicalPath` is what makes `externalOpenAllowed` false, so no
    // Open In affordance is ever offered for a credential.
    expect(result).not.toHaveProperty('lexicalPath');
  });

  it('refuses a benign-looking symlink whose REALPATH lands in .ssh', async () => {
    const link = path.join(home, 'notes', 'harmless.md');
    try {
      await fs.symlink(path.join(home, '.ssh', 'id_ed25519'), link, 'file');
    } catch {
      // Unprivileged Windows cannot create a file symlink.
      return;
    }
    const result = await build([workspace]).resolveForExternalOpen({
      path: link,
    });
    expect(result).toMatchObject({
      kind: 'rejected',
      reason: 'outside-roots',
    });
    await fs.rm(link, { force: true });
  });

  /**
   * The deny-list guards the home/temp WIDENING only. A `.env` in a repository
   * the user opened is ordinary project content: the agent can already read it
   * there, so refusing to open it in the user's editor would break a normal
   * workflow while protecting nothing.
   */
  it('does not apply the deny-list inside a registered workspace root', async () => {
    const result = await build([workspace]).resolveForExternalOpen({
      path: path.join(workspace, '.env'),
    });
    expect(result).toMatchObject({ kind: 'file' });
  });

  it('does not authorize home for the in-app viewer', async () => {
    const result = await build([workspace]).resolveForView({
      path: path.join(home, 'notes', 'todo.md'),
    });
    expect(result).toMatchObject({
      kind: 'rejected',
      reason: 'outside-roots',
    });
  });

  it('applies the 2 MiB cap by default on the view policy only', async () => {
    const big = path.join(workspace, 'big.txt');
    await fs.writeFile(big, 'x'.repeat(64), 'utf8');

    await expect(
      build([workspace]).resolveForView({ path: big }, { maxBytes: 10 }),
    ).resolves.toMatchObject({ kind: 'rejected', reason: 'too-large' });

    // The external-open policy reads nothing, so it carries no cap.
    await expect(
      build([workspace]).resolveForExternalOpen({ path: big }),
    ).resolves.toMatchObject({ kind: 'file' });

    await fs.rm(big, { force: true });
  });

  it('drops UNC worktrees rather than authorizing a network share', async () => {
    gitInfo.getWorktrees.mockResolvedValueOnce([
      { path: '\\\\server\\share\\wt', branch: 'b', head: 'h' },
    ] as never);

    // Deliberately OUTSIDE every registered root, so the lexical miss forces
    // the lazy worktree widening. Without that, the call would fail earlier at
    // `realpath` and the UNC entry would never be exercised at all.
    const result = await build([workspace]).resolveForView({
      path: path.join(base, 'elsewhere', 'x.ts'),
    });

    expect(gitInfo.getWorktrees).toHaveBeenCalledWith(workspace);
    // The UNC worktree never enters the authorized set, so this stays a miss.
    expect(result).toMatchObject({ kind: 'rejected', reason: 'outside-roots' });
  });
});
