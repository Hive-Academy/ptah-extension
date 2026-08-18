import type { AuthEnv } from '../types/auth-env.types';
import { isDirectAnthropic, includesUserSettingSource } from './auth-env.utils';

describe('isDirectAnthropic', () => {
  it('returns true when ANTHROPIC_BASE_URL is undefined', () => {
    const authEnv: AuthEnv = { ANTHROPIC_BASE_URL: undefined };
    expect(isDirectAnthropic(authEnv)).toBe(true);
  });

  it('returns true when ANTHROPIC_BASE_URL is an empty string', () => {
    const authEnv: AuthEnv = { ANTHROPIC_BASE_URL: '' };
    expect(isDirectAnthropic(authEnv)).toBe(true);
  });

  it('returns true when ANTHROPIC_BASE_URL is whitespace-only', () => {
    const authEnv: AuthEnv = { ANTHROPIC_BASE_URL: '   ' };
    expect(isDirectAnthropic(authEnv)).toBe(true);
  });

  it('returns true for https://api.anthropic.com (no trailing slash)', () => {
    const authEnv: AuthEnv = {
      ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
    };
    expect(isDirectAnthropic(authEnv)).toBe(true);
  });

  it('returns true for https://api.anthropic.com/ (trailing slash)', () => {
    const authEnv: AuthEnv = {
      ANTHROPIC_BASE_URL: 'https://api.anthropic.com/',
    };
    expect(isDirectAnthropic(authEnv)).toBe(true);
  });

  it('returns true for http (insecure) anthropic URL', () => {
    const authEnv: AuthEnv = { ANTHROPIC_BASE_URL: 'http://api.anthropic.com' };
    expect(isDirectAnthropic(authEnv)).toBe(true);
  });

  it('returns false for OpenRouter base URL', () => {
    const authEnv: AuthEnv = {
      ANTHROPIC_BASE_URL: 'https://openrouter.ai/api/v1',
    };
    expect(isDirectAnthropic(authEnv)).toBe(false);
  });

  it('returns false for a localhost proxy URL', () => {
    const authEnv: AuthEnv = { ANTHROPIC_BASE_URL: 'http://127.0.0.1:8080' };
    expect(isDirectAnthropic(authEnv)).toBe(false);
  });
});

/**
 * The ONE definition of "does this session keep the `'user'` setting source?".
 *
 * `SdkQueryOptionsBuilder` calls it to BUILD `Options.settingSources`;
 * `output-styles` calls it to PREDICT the same value, because a user-tier style
 * file is only visible to the binary when that source survives. The two used to
 * be separate regex literals kept in step by a spec that read the builder's
 * source text — these cases are that coverage, moved to the single definition.
 */
describe('includesUserSettingSource', () => {
  it.each([
    ['http://127.0.0.1:11434'],
    ['http://localhost:1234'],
    ['https://LOCALHOST:443'],
    ['  http://127.0.0.1:8000  '],
  ])('excludes the user source for the local proxy %s', (baseUrl) => {
    expect(includesUserSettingSource(baseUrl)).toBe(false);
  });

  it.each([
    ['https://api.anthropic.com'],
    ['https://api.moonshot.cn/anthropic'],
    // Near-misses: the predicate is anchored, so neither of these is local.
    ['http://127.0.0.2:11434'],
    ['http://not-localhost.example.com'],
  ])('keeps the user source for the remote provider %s', (baseUrl) => {
    expect(includesUserSettingSource(baseUrl)).toBe(true);
  });

  it.each([[undefined], [''], ['   ']])(
    'treats %s as first-party Anthropic and keeps the user source',
    (baseUrl) => {
      expect(includesUserSettingSource(baseUrl)).toBe(true);
    },
  );

  it('is stateless across calls (no global regex flag)', () => {
    expect(includesUserSettingSource('http://127.0.0.1:11434')).toBe(false);
    expect(includesUserSettingSource('http://127.0.0.1:11434')).toBe(false);
  });
});
