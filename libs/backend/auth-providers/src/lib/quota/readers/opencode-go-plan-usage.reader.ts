/**
 * OpenCode Go subscription quota, separate from local `opencode stats`.
 *
 * The Bearer token comes from the OpenCode credential store, in this order:
 *
 * 1. a stored Ptah credential (`identityKind: "credential"` targets);
 * 2. v1 — `auth.json` key `opencode-go` or `OPENCODE_API_KEY` (via
 *    `readOpenCodeGoKey`);
 * 3. v2 — the `opencode` integration's credential in `<data dir>/opencode.db`
 *    (`readOpenCodeGoStoreCredential` in ../opencode-go-credential, the one
 *    store lookup shared with `hasOpenCodeGoCredentialSync`), which is where
 *    `opencode auth login` has stored accounts since OpenCode 2.x (it no
 *    longer writes `auth.json`).
 *
 * Both v2 credential shapes work on the usage endpoint: an API key
 * (`{ type: "key", key }`, the Go product) and the logged-in account's OAuth
 * token (`{ type: "oauth", access }`, the Zen product) — verified live against
 * `https://opencode.ai/zen/go/v1/usage` (HTTP 200 for both; no
 * `/zen/v1/usage` endpoint exists).
 *
 * An OAuth credential whose stored `expires` is in the past — or a 401 from
 * the endpoint — is a sign-in-again answer (`unsupported-auth`), not a service
 * outage. This reader never refreshes tokens: OpenCode rotates its own
 * refresh tokens, and refreshing here would invalidate its copy.
 */
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { PlanLimitWindow } from '@ptah-extension/shared';
import {
  readOpenCodeGoKey,
  readOpenCodeGoStoreCredential,
  type OpenCodeStoreCredential,
} from '../opencode-go-credential';
import type {
  PlanUsageReader,
  PlanUsageReading,
} from './plan-usage-reader.types';

export const OPENCODE_GO_USAGE_URL = 'https://opencode.ai/zen/go/v1/usage';
const WindowSchema = z.object({
  percent: z.number().finite(),
  resetsAt: z.string().datetime({ offset: true }),
});
const UsageSchema = z.object({
  usage: z.object({
    rolling: WindowSchema,
    weekly: WindowSchema,
    monthly: WindowSchema,
  }),
});
const noPlan = (): PlanUsageReading => ({
  status: 'no-usage-source',
  windowSetEstablished: false,
  windows: [],
});
const unavailable = (): PlanUsageReading => ({
  status: 'service-unavailable',
  windowSetEstablished: false,
  windows: [],
});
/**
 * A rejected or expired stored credential: the account needs a sign-in
 * again. The same state the Ollama Cloud reader uses for a rejected key.
 */
const authRejected = (): PlanUsageReading => ({
  status: 'unsupported-auth',
  windowSetEstablished: false,
  windows: [],
});

/**
 * Reads the OpenCode v2 credential store's key material; `undefined` = none.
 * A plain string is a v1-style key with no expiry; an object is the v2
 * store's credential with the OAuth token's `expiresAt` when known.
 */
export type OpenCodeStoreKeyReader = (
  env: NodeJS.ProcessEnv,
) => Promise<string | OpenCodeStoreCredential | undefined>;

export function createOpenCodeGoPlanUsageReader(
  now: () => number = Date.now,
  fetcher: typeof fetch = fetch,
  readAuth: typeof readFile = readFile,
  env: NodeJS.ProcessEnv = process.env,
  readStoreKey: OpenCodeStoreKeyReader = readOpenCodeGoStoreCredential,
): PlanUsageReader {
  return async ({ signal, target, credential }) => {
    if (signal?.aborted) return unavailable();
    let key: string | undefined;
    let storedExpiresAt: number | undefined;
    if (target.ownerRef.identityKind === 'credential') {
      key = credential?.reveal().trim();
      if (!key)
        return {
          status: 'unsupported-config',
          windowSetEstablished: false,
          windows: [],
        };
    } else if (target.ownerRef.identityKind === 'cli-store') {
      try {
        const v1Key = await readOpenCodeGoKey(env, readAuth);
        if (v1Key !== undefined) {
          key = v1Key;
        } else {
          const stored = await readStoreKey(env);
          if (typeof stored === 'string') key = stored;
          else if (stored) {
            key = stored.key;
            storedExpiresAt = stored.expiresAt;
          }
        }
      } catch {
        return unavailable();
      }
    } else return noPlan();
    if (!key) return noPlan();
    // A stored OAuth access token whose `expires` is in the past needs a
    // sign-in again, not a request or a refresh (OpenCode rotates its own
    // refresh tokens); skip the endpoint call entirely (review defect 5).
    if (storedExpiresAt !== undefined && storedExpiresAt <= now()) {
      return authRejected();
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const response = await fetcher(OPENCODE_GO_USAGE_URL, {
        headers: { Authorization: `Bearer ${key}` },
        redirect: 'error',
        signal: controller.signal,
      });
      // 401: the stored token is expired or rejected — sign in again, not a
      // service outage (review defect 5).
      if (response.status === 401) return authRejected();
      if (response.status === 403) return noPlan();
      if (!response.ok) return unavailable();
      const parsed = UsageSchema.safeParse(await response.json());
      if (!parsed.success) return unavailable();
      const observedAt = now();
      const windows: PlanLimitWindow[] = (
        [
          ['rolling', 'five_hour', 'Go · 5-hour', 300],
          ['weekly', 'weekly', 'Go · Weekly', 10080],
          ['monthly', 'monthly', 'Go · Monthly', undefined],
        ] as const
      ).map(([source, kind, label, durationMins]) => ({
        key: kind,
        kind,
        label,
        ...(durationMins && { durationMins }),
        used: {
          kind: 'percent',
          percent: Math.max(
            0,
            Math.min(100, parsed.data.usage[source].percent),
          ),
        },
        usedSource: 'provider-api',
        usedObservedAt: observedAt,
        resetsAt: Date.parse(parsed.data.usage[source].resetsAt),
        resetSource: 'provider-api',
        observedAt,
      }));
      return {
        status: 'available',
        fetchedAt: observedAt,
        windowSetEstablished: true,
        windows,
      };
    } catch {
      return unavailable();
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    }
  };
}
