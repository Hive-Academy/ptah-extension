/** Default grok.com login billing, separate from local session accounting. */
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { PlanLimitWindow } from '@ptah-extension/shared';
import type {
  PlanUsageReader,
  PlanUsageReading,
} from './plan-usage-reader.types';

export const GROK_BILLING_URL =
  'https://cli-chat-proxy.grok.com/v1/billing?format=credits';
const CredentialSchema = z.record(
  z.string(),
  z.object({
    key: z.string().optional(),
    auth_mode: z.string().optional(),
    email: z.string().optional(),
  }),
);
const BillingSchema = z.object({
  config: z
    .object({
      creditUsagePercent: z.number().finite().optional(),
      currentPeriod: z
        .object({ type: z.string().optional(), end: z.string().optional() })
        .optional(),
    })
    .optional(),
});
const noPlan = (): PlanUsageReading => ({
  status: 'no-usage-source',
  windowSetEstablished: false,
  windows: [],
});
/** API-key login: no subscription quota exists; local usage is all there is. */
const apiKeyNoPlan = (): PlanUsageReading => ({
  ...noPlan(),
  statusReason: 'api-key-no-subscription-quota',
});
const unavailable = (): PlanUsageReading => ({
  status: 'service-unavailable',
  windowSetEstablished: false,
  windows: [],
});
const CUSTOM_ENV = [
  'GROK_OIDC_ISSUER',
  'GROK_OIDC_CLIENT_ID',
  'GROK_OAUTH2_ISSUER',
  'GROK_OAUTH2_CLIENT_ID',
  'GROK_OAUTH2_PRINCIPAL_TYPE',
  'GROK_OAUTH2_PRINCIPAL_ID',
  'GROK_AUTH_PROVIDER_COMMAND',
  'GROK_LOCAL_AUTH',
  'GROK_CLI_CHAT_PROXY_BASE_URL',
  'GROK_MODELS_BASE_URL',
  'GROK_CONFIG',
  'GROK_CONFIG_PATH',
];

export function createGrokAccountPlanUsageReader(
  now: () => number = Date.now,
  fetcher: typeof fetch = fetch,
  readAuth: typeof readFile = readFile,
  env: NodeJS.ProcessEnv = process.env,
): PlanUsageReader {
  return async ({ signal, target }) => {
    if (signal?.aborted) return unavailable();
    if (target.ownerRef.identityKind !== 'cli-store') return noPlan();
    if (env['XAI_API_KEY']?.trim()) return apiKeyNoPlan();
    if (CUSTOM_ENV.some((name) => env[name]?.trim())) return noPlan();
    const home =
      env['GROK_HOME']?.trim() ||
      join(env['HOME'] || env['USERPROFILE'] || homedir(), '.grok');
    try {
      for (const path of [
        join(home, 'config.toml'),
        join(home, 'managed_config.toml'),
        join(home, 'requirements.toml'),
        ...(process.platform === 'win32'
          ? []
          : ['/etc/grok/managed_config.toml', '/etc/grok/requirements.toml']),
      ]) {
        let config = '';
        try {
          config = await readAuth(path, 'utf8');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
            return unavailable();
        }
        if (
          /^\s*(?:\[\[?\s*)?["']?(?:auth|grok_com_config|endpoints)["']?\s*[.\]=]/m.test(
            config,
          )
        )
          return noPlan();
      }
      let contents = env['GROK_AUTH']?.trim();
      if (!contents) {
        try {
          contents = await readAuth(join(home, 'auth.json'), 'utf8');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
            return unavailable();
          contents = '{}';
        }
      }
      const credentials = CredentialSchema.safeParse(JSON.parse(contents));
      if (!credentials.success) return unavailable();
      const credential =
        credentials.data[
          'https://auth.x.ai::b1a00492-073a-47ea-816f-4c329264a828'
        ] ?? credentials.data['https://accounts.x.ai/sign-in'];
      const key =
        credential?.auth_mode === 'api_key'
          ? undefined
          : credential?.key?.trim();
      if (!key) {
        return credential?.auth_mode === 'api_key' ? apiKeyNoPlan() : noPlan();
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5_000);
      const abort = () => controller.abort();
      signal?.addEventListener('abort', abort, { once: true });
      try {
        const response = await fetcher(GROK_BILLING_URL, {
          headers: { Authorization: `Bearer ${key}` },
          redirect: 'error',
          signal: controller.signal,
        });
        if (response.status === 401)
          return {
            status: 'unsupported-auth',
            windowSetEstablished: false,
            windows: [],
          };
        if (response.status === 403) return noPlan();
        if (!response.ok) return unavailable();
        const parsed = BillingSchema.safeParse(await response.json());
        if (!parsed.success) return unavailable();
        const observedAt = now();
        const percent = parsed.data.config?.creditUsagePercent;
        const period = parsed.data.config?.currentPeriod;
        const type = period?.type?.replace(/^USAGE_PERIOD_TYPE_/, '');
        const kind =
          type === 'WEEKLY'
            ? 'weekly'
            : type === 'MONTHLY'
              ? 'monthly'
              : 'other';
        const resetsAt = Date.parse(period?.end ?? '');
        const windows: PlanLimitWindow[] =
          percent === undefined
            ? []
            : [
                {
                  key: 'other:subscription',
                  kind,
                  label:
                    kind === 'weekly'
                      ? 'Weekly'
                      : kind === 'monthly'
                        ? 'Monthly'
                        : 'Subscription',
                  used: {
                    kind: 'percent',
                    percent: Math.max(0, Math.min(100, percent)),
                  },
                  usedSource: 'provider-api',
                  usedObservedAt: observedAt,
                  ...(Number.isFinite(resetsAt) && {
                    resetsAt,
                    resetSource: 'provider-api' as const,
                  }),
                  observedAt,
                },
              ];
        return {
          status: 'available',
          fetchedAt: observedAt,
          windowSetEstablished: true,
          windows,
        };
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', abort);
      }
    } catch {
      return unavailable();
    }
  };
}
