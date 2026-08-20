import 'reflect-metadata';
import { experimentalBetaEnv } from './build-safe-env';

describe('experimentalBetaEnv', () => {
  const KEY = 'PTAH_ENABLE_EXPERIMENTAL_BETAS';
  let original: string | undefined;

  beforeEach(() => {
    original = process.env[KEY];
    delete process.env[KEY];
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env[KEY];
    } else {
      process.env[KEY] = original;
    }
  });

  it('disables experimental betas for a remote third-party base URL', () => {
    expect(experimentalBetaEnv('https://api.moonshot.cn/anthropic')).toEqual({
      CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: '1',
    });
  });

  it('does NOT disable for a local translation proxy (Codex/Copilot)', () => {
    expect(experimentalBetaEnv('http://127.0.0.1:61010')).toEqual({});
    expect(experimentalBetaEnv('http://localhost:51234')).toEqual({});
  });

  it('does not disable for the Anthropic base URL', () => {
    expect(experimentalBetaEnv('https://api.anthropic.com')).toEqual({});
  });

  it('does not disable when no base URL is set', () => {
    expect(experimentalBetaEnv(undefined)).toEqual({});
  });

  it('keeps experimental betas on for a remote third-party URL when the override is set', () => {
    process.env[KEY] = '1';
    expect(experimentalBetaEnv('https://api.moonshot.cn/anthropic')).toEqual(
      {},
    );
  });
});
