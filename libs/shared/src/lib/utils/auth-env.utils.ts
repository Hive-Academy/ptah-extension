import type { AuthEnv } from '../types/auth-env.types';

export function isDirectAnthropic(authEnv: AuthEnv): boolean {
  const baseUrl = authEnv.ANTHROPIC_BASE_URL?.trim();
  return !baseUrl || /^https?:\/\/api\.anthropic\.com\/?$/i.test(baseUrl);
}
