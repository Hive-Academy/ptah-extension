import { z } from 'zod';
import type { PlanLimitWindow } from '@ptah-extension/shared';
import type { IKimiCodeAuthService, KimiCodeRequestCredential } from '../../providers/kimi-code/kimi-code-provider.types';
import type { PlanCredentialSource } from '../plan-credential.source';
import { cliStoreOwnerKey, credentialOwnerKey } from '../provider-owner.resolver';
import { KimiCodeHomeResolver } from '../../providers/kimi-code/kimi-code-home-resolver';
import type { PlanUsageReader, PlanUsageReading } from './plan-usage-reader.types';

export const KIMI_CODE_USAGE_URL = 'https://api.kimi.ai/coding/v1/usages';
const TIMEOUT_MS = 8_000;
const finiteNumber = z.union([
  z.number().finite(),
  z.string().trim().min(1).transform(Number).pipe(z.number().finite()),
]);
const ratio = finiteNumber.refine((value) => value >= 0 && value <= 1);
const window = z.object({
  used_ratio: ratio,
  reset_time: z.union([z.literal(''), z.string().datetime({ offset: true })]).optional(),
});
const usage = z.object({
  usages: z.object({
    limit_5h: window,
    limit_7d: window,
    limit_month_total: window.optional(),
    limit_month_code: window.optional(),
  }),
  usage: z.object({ used: finiteNumber.refine((value) => value >= 0) }).optional(),
});

const reading = (status: PlanUsageReading['status']): PlanUsageReading => ({
  status,
  windowSetEstablished: false,
  windows: [],
});

function matchesOwner(ownerKey: string, kind: string, value: string): boolean {
  return kind === 'apiKey' && credentialOwnerKey('kimi-code', value) === ownerKey;
}

function windowsFrom(data: z.infer<typeof usage>, observedAt: number): PlanLimitWindow[] {
  const entries = [
    ['limit_5h', 'five_hour', 'five_hour', 'Kimi Code · 5-hour', 300],
    ['limit_7d', 'weekly', 'weekly', 'Kimi Code · Weekly', 10080],
    ['limit_month_total', 'monthly', 'monthly', 'Kimi Code · Monthly total', undefined],
    ['limit_month_code', 'other:monthly-code', 'monthly', 'Kimi Code · Monthly code', undefined],
  ] as const;
  return entries.flatMap(([source, key, kind, label, durationMins]) => {
    const value = data.usages[source];
    if (!value) return [];
    return [{
      key, kind, label,
      ...(durationMins !== undefined && { durationMins }),
      used: { kind: 'percent' as const, percent: Math.max(0, Math.min(100, value.used_ratio * 100)) },
      usedSource: 'provider-api' as const,
      usedObservedAt: observedAt,
      ...(value.reset_time && {
        resetsAt: Date.parse(value.reset_time),
        resetSource: 'provider-api' as const,
      }),
      observedAt,
    }];
  });
}

export function createKimiCodePlanUsageReader(
  auth: Pick<IKimiCodeAuthService, 'resolveRequestCredential' | 'forceRefresh'>,
  credentials: Pick<PlanCredentialSource, 'resolve'>,
  now: () => number = Date.now,
  fetcher: typeof fetch = fetch,
  home: KimiCodeHomeResolver = new KimiCodeHomeResolver(),
): PlanUsageReader {
  return async ({ target, signal }) => {
    if (signal?.aborted) return reading('service-unavailable');
    let selected: KimiCodeRequestCredential;
    if (target.credentialRef?.kind === 'ptah-cli-key') {
      const slot = await credentials.resolve(target.credentialRef);
      if (slot.kind === 'available') {
        selected = { kind: 'apiKey', apiKey: slot.secret.reveal() };
      } else if (slot.status === 'service-unavailable') {
        return reading('service-unavailable');
      } else {
        try {
          selected = await auth.resolveRequestCredential();
        } catch {
          return reading('unsupported-auth');
        }
      }
    } else {
      try {
        selected = await auth.resolveRequestCredential();
      } catch {
        return reading('unsupported-auth');
      }
    }
    const owner = target.ownerRef;
    const owns = (credential: KimiCodeRequestCredential): boolean =>
      credential.kind === 'apiKey'
        ? owner.identityKind === 'credential' && matchesOwner(owner.key, credential.kind, credential.apiKey)
        : owner.identityKind === 'cli-store' && owner.key === cliStoreOwnerKey('kimi-code', home.path);
    if (!owns(selected)) return reading('service-unavailable');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const request = (credential: KimiCodeRequestCredential) => fetcher(KIMI_CODE_USAGE_URL, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${credential.kind === 'oauth' ? credential.accessToken : credential.apiKey}`,
        Accept: 'application/json',
      },
      redirect: 'error',
      signal: controller.signal,
    });
    try {
      let response = await request(selected);
      if ((response.status === 401 || response.status === 403) && selected.kind === 'oauth') {
        if (!(await auth.forceRefresh())) return reading('unsupported-auth');
        selected = await auth.resolveRequestCredential();
        if (!owns(selected) || selected.kind !== 'oauth') return reading('service-unavailable');
        response = await request(selected);
      }
      if (response.status === 401 || response.status === 403) return reading('unsupported-auth');
      if (!response.ok) return reading('service-unavailable');
      const parsed = usage.safeParse(await response.json());
      if (!parsed.success) return reading('service-unavailable');
      if (parsed.data.usage?.used && parsed.data.usages.limit_7d.used_ratio === 0) {
        return reading('service-unavailable');
      }
      const observedAt = now();
      return {
        status: 'available',
        fetchedAt: observedAt,
        windowSetEstablished: true,
        windows: windowsFrom(parsed.data, observedAt),
      };
    } catch {
      return reading('service-unavailable');
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    }
  };
}
