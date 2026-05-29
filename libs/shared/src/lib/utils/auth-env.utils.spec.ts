import type { AuthEnv } from '../types/auth-env.types';
import { isDirectAnthropic } from './auth-env.utils';

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
