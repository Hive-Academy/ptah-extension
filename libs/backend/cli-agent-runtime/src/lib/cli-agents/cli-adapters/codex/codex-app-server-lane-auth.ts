import { readFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import { z } from 'zod';
import { isCodexAccessTokenStale } from '@ptah-extension/shared';

const authSchema = z.object({
  openai_api_key: z.string().nullish(),
  OPENAI_API_KEY: z.string().nullish(),
  tokens: z.object({ access_token: z.string().nullish() }).nullish(),
  last_refresh: z.string().nullish(),
});

export type CodexLaneCredentialStatus = 'fresh' | 'stale' | 'missing' | 'unreadable';

export interface CodexLaneCredentialProbe {
  check(): Promise<CodexLaneCredentialStatus>;
}

/** Reads only the selected account home; no refresh or login is possible here. */
export class FileCodexLaneCredentialProbe implements CodexLaneCredentialProbe {
  async check(): Promise<CodexLaneCredentialStatus> {
    const home = process.env['HOME'] || process.env['USERPROFILE'] || homedir();
    const selected = process.env['CODEX_HOME'] !== undefined
      ? process.env['CODEX_HOME'] : join(home, '.codex');
    if (!selected) return 'unreadable';
    let raw: string;
    try {
      raw = await readFile(join(selected, 'auth.json'), 'utf-8');
    } catch (error: unknown) {
      // degradation-audit: reported - the status reaches the caller; ensureTokensFresh warns on 'unreadable' and fails on both
      const code = typeof error === 'object' && error !== null && 'code' in error
        ? error.code : undefined;
      return code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : 'unreadable';
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      // degradation-audit: reported - invalid JSON is returned as 'unreadable', which the caller warns on
      return 'unreadable';
    }
    const parsed = authSchema.safeParse(json);
    if (!parsed.success) return 'unreadable';
    const auth = parsed.data;
    if (auth.openai_api_key || auth.OPENAI_API_KEY) return 'fresh';
    const accessToken = auth.tokens?.access_token;
    if (!accessToken) return 'missing';
    return isCodexAccessTokenStale({
      accessToken, lastRefresh: auth.last_refresh ?? undefined,
    }) ? 'stale' : 'fresh';
  }
}
