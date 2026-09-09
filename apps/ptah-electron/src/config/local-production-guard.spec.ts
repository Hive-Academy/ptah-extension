import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const { readCleanGitSha, sanitizedEnvironment, validateBaseConfig } =
  require('../../scripts/package-local-production.js') as {
    readCleanGitSha: (
      run: (file: string, args: string[]) => string,
      root: string,
    ) => string;
    sanitizedEnvironment: (
      source: NodeJS.ProcessEnv,
      sha: string,
    ) => Record<string, string>;
    validateBaseConfig: (config: string) => void;
  };
const { assertUnsignedStatuses } =
  require('../../scripts/verify-local-production-unsigned.js') as {
    assertUnsignedStatuses: (
      records: Array<{ Path: string; Status: string }>,
      paths: string[],
    ) => void;
  };

describe('local-production packaging guard', () => {
  it('preserves production identity and rejects signing hooks', () => {
    const config = readFileSync(
      join(__dirname, '..', '..', 'electron-builder.yml'),
      'utf8',
    );
    expect(() => validateBaseConfig(config)).not.toThrow();
    expect(() =>
      validateBaseConfig(
        'appId: com.ptah.desktop\nproductName: Ptah\nafterSign: ./sign.js\n',
      ),
    ).toThrow('afterSign');
    expect(() =>
      validateBaseConfig(
        'appId: com.ptah.desktop\nproductName: Ptah\n  afterAllArtifactBuild : ./mutate.js\n',
      ),
    ).toThrow('afterAllArtifactBuild');
  });

  it('removes inherited signing credentials without exposing their values', () => {
    const env = sanitizedEnvironment(
      {
        PATH: 'safe',
        CSC_LINK: 'secret-one',
        WIN_CSC_KEY_PASSWORD: 'secret-two',
        AZURE_CLIENT_SECRET: 'secret-three',
        SSL_COM_PASSWORD: 'secret-four',
      },
      'a'.repeat(40),
    );
    expect(env).toEqual({
      PATH: 'safe',
      CSC_IDENTITY_AUTO_DISCOVERY: 'false',
      PTAH_LOCAL_PRODUCTION_GIT_SHA: 'a'.repeat(40),
    });
  });

  it('refuses a dirty checkout and accepts only a full SHA', () => {
    const run = jest
      .fn()
      .mockReturnValueOnce(`${'a'.repeat(40)}\n`)
      .mockReturnValueOnce(' M source.ts\n');
    expect(() => readCleanGitSha(run, 'C:\\repo')).toThrow('clean checkout');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('requires every packaged Windows executable to be unsigned', () => {
    const files = [
      'C:\\out\\Ptah Setup.exe',
      'C:\\out\\win-unpacked\\Ptah.exe',
    ];
    expect(() =>
      assertUnsignedStatuses(
        files.map((Path) => ({ Path, Status: 'NotSigned' })),
        files,
      ),
    ).not.toThrow();
    expect(() =>
      assertUnsignedStatuses(
        [
          { Path: files[0], Status: 'Valid' },
          { Path: files[1], Status: 'NotSigned' },
        ],
        files,
      ),
    ).toThrow('Expected unsigned');
  });
});
