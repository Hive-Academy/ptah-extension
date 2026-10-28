import {
  buildCertifiedClaudeEnv,
  certifiedEnvDigest,
} from './claude-certified-launch';

// Requirement 3 criterion 9: building a named environment must not mutate the
// host process.env, and two routes must not share one env object.
describe('buildCertifiedClaudeEnv does not touch the host environment', () => {
  const FOREIGN: Record<string, string> = {
    CLAUDE_CONFIG_DIR: 'D:/ambient-config',
    CLAUDE_SECURESTORAGE_CONFIG_DIR: 'D:/ambient-store',
    CLAUDE_CODE_FORCE_WINDOWS_CREDMAN: '1',
    ANTHROPIC_BASE_URL: 'https://gateway.example.test',
  };
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const [key, value] of Object.entries(FOREIGN)) {
      saved[key] = process.env[key];
      process.env[key] = value;
    }
  });

  afterEach(() => {
    for (const key of Object.keys(FOREIGN)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('leaves process.env and the source object unchanged and strips the foreign keys', () => {
    const before = { ...process.env };
    const source = { ...process.env };
    const sourceBefore = { ...source };

    const envA = buildCertifiedClaudeEnv(source, 'D:/accounts/a');
    const envB = buildCertifiedClaudeEnv(source, 'D:/accounts/b');

    expect(process.env).toEqual(before);
    expect(source).toEqual(sourceBefore);
    expect(envA).not.toBe(envB);
    expect(envA['CLAUDE_CONFIG_DIR']).not.toBe(envB['CLAUDE_CONFIG_DIR']);
    for (const env of [envA, envB]) {
      expect(env['CLAUDE_CODE_FORCE_WINDOWS_CREDMAN']).toBeUndefined();
      expect(env['ANTHROPIC_BASE_URL']).toBeUndefined();
    }
    expect(certifiedEnvDigest(envA)).not.toBe(certifiedEnvDigest(envB));
    expect(process.env['CLAUDE_CONFIG_DIR']).toBe(FOREIGN['CLAUDE_CONFIG_DIR']);
  });
});
