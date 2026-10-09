import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CODEX_TOKEN_EXPIRY_SKEW_MS } from '@ptah-extension/shared';
import { CliWorkspaceProvider } from '@ptah-extension/platform-cli';

import {
  ISOLATED_FILE_SETTINGS_FILE,
  ISOLATED_PRODUCT_CONFIG_FILE,
  RECORDING_EXPIRY_SLACK_MS,
  RecordingBootstrapError,
  bootstrapIsolatedCodexAuth,
  seedRecordModeOAuthEndpoint,
} from './recording-bootstrap';

function jwt(expSeconds: number): string {
  const header = Buffer.from('{"alg":"none","typ":"JWT"}').toString(
    'base64url',
  );
  const body = Buffer.from(JSON.stringify({ exp: expSeconds })).toString(
    'base64url',
  );
  return `${header}.${body}.sig`;
}

function authFile(expSeconds: number): string {
  return JSON.stringify({
    tokens: { access_token: jwt(expSeconds), refresh_token: 'refresh' },
  });
}

describe('bootstrapIsolatedCodexAuth', () => {
  let root: string;
  let home: string;
  let source: string;
  let previous: string | undefined;
  const nowMs = Date.parse('2026-10-07T00:00:00Z');
  const deadlineMs = 60_000;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ptah-620-codex-auth-'));
    home = join(root, 'iso');
    mkdirSync(home);
    source = join(root, 'auth.json');
    previous = process.env['CODEX_HOME'];
  });

  afterEach(() => {
    if (previous === undefined) delete process.env['CODEX_HOME'];
    else process.env['CODEX_HOME'] = previous;
    rmSync(root, { recursive: true, force: true });
  });

  function run(
    sourcePath = source,
  ): ReturnType<typeof bootstrapIsolatedCodexAuth> {
    return bootstrapIsolatedCodexAuth({
      isolationHome: home,
      sourcePath,
      deadlineMs,
      nowMs,
      env: {},
    });
  }

  it('copies a regular file, sets CODEX_HOME, and records the hash', () => {
    const exp = Math.floor(nowMs / 1000) + 3600;
    writeFileSync(source, authFile(exp));
    if (process.platform !== 'win32') chmodSync(source, 0o644);
    const copied = run();
    expect(copied.codexHome).toBe(join(home, '.codex'));
    expect(process.env['CODEX_HOME']).toBe(copied.codexHome);
    expect(readFileSync(copied.authFile, 'utf8')).toBe(authFile(exp));
    expect(copied.sha256).toBe(
      createHash('sha256').update(readFileSync(copied.authFile)).digest('hex'),
    );
    if (process.platform !== 'win32') {
      expect(statSync(copied.authFile).mode & 0o777).toBe(0o600);
    }
  });

  it('rejects a symbolic link and a non-file', () => {
    const outside = join(root, 'outside');
    mkdirSync(outside);
    const link = join(root, 'auth-link');
    symlinkSync(
      outside,
      link,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    expect(() => run(link)).toThrow(RecordingBootstrapError);
    expect(() => run(link)).toThrow(/symbolic link/);
    expect(process.env['CODEX_HOME']).not.toBe(join(home, '.codex'));

    const directory = join(root, 'not-a-file');
    mkdirSync(directory);
    expect(() => run(directory)).toThrow(/not a regular file/);
  });

  it('rejects an access token that expires before the deadline plus 10 minutes', () => {
    const exp = Math.floor((nowMs + deadlineMs + 9 * 60 * 1000) / 1000);
    writeFileSync(source, authFile(exp));
    expect(() => run()).toThrow(
      /expires before the recording deadline plus 10 minutes/,
    );
    expect(process.env['CODEX_HOME']).not.toBe(join(home, '.codex'));
  });

  it('rejects a token that clears the deadline slack but not the Codex skew', () => {
    const expMs = nowMs + deadlineMs + RECORDING_EXPIRY_SLACK_MS;
    writeFileSync(source, authFile(Math.floor(expMs / 1000)));
    expect(() => run()).toThrow(/Codex expiry skew/);
    expect(process.env['CODEX_HOME']).not.toBe(join(home, '.codex'));
  });

  it('accepts a token that outlives the deadline, the slack, and the skew', () => {
    const earliest =
      nowMs +
      deadlineMs +
      RECORDING_EXPIRY_SLACK_MS +
      CODEX_TOKEN_EXPIRY_SKEW_MS;
    writeFileSync(source, authFile(Math.floor(earliest / 1000) + 1));
    expect(run().codexHome).toBe(join(home, '.codex'));
  });

  it('rejects a codex home that resolves outside the isolated home', () => {
    const exp = Math.floor(nowMs / 1000) + 3600;
    writeFileSync(source, authFile(exp));
    const outside = join(root, 'outside');
    mkdirSync(outside);
    symlinkSync(
      outside,
      join(home, '.codex'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    expect(() => run()).toThrow(/symbolic link|escapes the isolated home/);
    expect(existsSync(join(outside, 'auth.json'))).toBe(false);
    expect(process.env['CODEX_HOME']).not.toBe(join(home, '.codex'));
  });
});

describe('seedRecordModeOAuthEndpoint', () => {
  let root: string;
  let userDataPath: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ptah-620-file-settings-'));
    userDataPath = join(root, '.ptah');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('writes active auth where the real CLI workspace provider reads file-routed settings', () => {
    seedRecordModeOAuthEndpoint(userDataPath);

    const provider = new CliWorkspaceProvider(userDataPath, root);
    expect(provider.getConfiguration('ptah', 'authMethod')).toBe('thirdParty');
    expect(provider.getConfiguration('ptah', 'anthropicProviderId')).toBe(
      'openai-codex',
    );

    const config = JSON.parse(
      readFileSync(join(userDataPath, ISOLATED_PRODUCT_CONFIG_FILE), 'utf8'),
    ) as { ptah: Record<string, unknown> };
    expect(config.ptah['authMethod']).toBeUndefined();
    expect(config.ptah['anthropicProviderId']).toBeUndefined();
    expect(existsSync(join(userDataPath, ISOLATED_FILE_SETTINGS_FILE))).toBe(
      true,
    );
  });
});
