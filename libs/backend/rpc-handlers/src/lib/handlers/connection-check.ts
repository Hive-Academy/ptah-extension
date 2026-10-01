/**
 * Explicit check of one SAVED connection, behind `auth:checkConnection`
 * (TASK_2026_555 Batch 28c, Task 28c.2).
 *
 * - Built-in API-key connections and direct Anthropic run the stored-key probe
 *   of `auth:verifyDraftConnection` (`DraftVerificationService.verify` with
 *   `credential: { kind: 'stored' }` and no base URL, so it is bound to the
 *   saved endpoint). That is one minimal inference request; with no stored key
 *   it answers `no-stored-credential` before any request is made.
 * - Custom entries run the same round trip as `provider:testCustomEntry`
 *   (`probeCustomProvider` with the stored key), so both write one verdict.
 * - Sign-in and CLI connections (Copilot, Codex, Claude CLI) are checked by
 *   their existing token read or CLI detection. No request is made, so they
 *   record `latencyMs: null`.
 *
 * Every outcome is recorded in {@link ConnectionCheckRecorder} and returned.
 * A check never rejects: a probe that throws records `failed`/`unclassified`.
 * Concurrent checks of one connection JOIN the one in flight, so a double
 * click never sends two provider requests.
 *
 * SECURITY: the stored key is read inside `DraftVerificationService` or passed
 * straight to `probeCustomProvider`; it is never logged or returned. The
 * probe's `detail` text is discarded; the record carries the fixed reason
 * union, and logs carry the provider id, the reason and the error type only.
 */

import type { Logger } from '@ptah-extension/vscode-core';
import type { ClaudeCliDetector } from '@ptah-extension/agent-sdk';
import type {
  CopilotAuthService,
  DraftVerificationService,
  ICodexAuthService,
} from '@ptah-extension/auth-providers';
import {
  ANTHROPIC_DIRECT_PROVIDER_ID,
  getAnthropicProvider,
  getCustomProviderEntry,
} from '@ptah-extension/shared';
import type {
  AuthVerifyDraftConnectionResult,
  ConnectionCheckFailureReason,
  ConnectionCheckRecord,
  CustomProviderEntry,
  ProviderTestCustomEntryResult,
} from '@ptah-extension/shared';
import type { ConnectionCheckRecorder } from '../utils/connection-check-recorder';
import {
  probeCustomProvider,
  type CustomProviderProbeResult,
} from '../utils/custom-provider-probe';

/** How a saved connection is checked. */
export type ConnectionCheckKind =
  'apiKey' | 'custom' | 'copilot' | 'codex' | 'claude-cli';

const COPILOT_PROVIDER_ID = 'github-copilot';
const CODEX_PROVIDER_ID = 'openai-codex';

/** Classify a saved connection. `undefined` = unknown id; `null` = no check (local servers). */
export function connectionCheckKind(
  providerId: string,
): ConnectionCheckKind | null | undefined {
  if (providerId === ANTHROPIC_DIRECT_PROVIDER_ID) return 'apiKey';
  const provider = getAnthropicProvider(providerId);
  if (!provider) return undefined;
  if (provider.nativeAuth) return 'claude-cli';
  if (provider.id === COPILOT_PROVIDER_ID) return 'copilot';
  if (provider.id === CODEX_PROVIDER_ID) return 'codex';
  if (provider.isCustom) return 'custom';
  // Local servers and key-optional routes (e.g. Ollama Cloud) have no stored-key check.
  return (provider.authType ?? 'apiKey') === 'apiKey' && !provider.isLocal
    ? 'apiKey'
    : null;
}

export interface ConnectionCheckerDeps {
  readonly recorder: ConnectionCheckRecorder;
  readonly draftVerification: Pick<DraftVerificationService, 'verify'>;
  readonly copilotAuth: Pick<CopilotAuthService, 'isAuthenticated'>;
  readonly codexAuth: Pick<ICodexAuthService, 'getTokenStatus' | 'clearCache'>;
  readonly cliDetector: Pick<ClaudeCliDetector, 'performHealthCheck'>;
  /** Stored key of a custom entry, for its probe (`IAuthSecretsService.getProviderKey`). */
  readonly readProviderKey: (providerId: string) => Promise<string | undefined>;
  readonly logger: Logger;
}

export class ConnectionChecker {
  /** One in-flight check per connection; later callers join it. */
  private readonly inFlight = new Map<string, Promise<ConnectionCheckRecord>>();

  constructor(private readonly deps: ConnectionCheckerDeps) {}

  /** `kind` comes from {@link connectionCheckKind}; the caller validated the id. */
  check(
    providerId: string,
    kind: ConnectionCheckKind,
  ): Promise<ConnectionCheckRecord> {
    const running = this.inFlight.get(providerId);
    if (running) return running;
    const pending = this.run(providerId, kind).finally(() => {
      if (this.inFlight.get(providerId) === pending)
        this.inFlight.delete(providerId);
    });
    this.inFlight.set(providerId, pending);
    return pending;
  }

  private async run(
    providerId: string,
    kind: ConnectionCheckKind,
  ): Promise<ConnectionCheckRecord> {
    const ticket = this.deps.recorder.begin(providerId);
    let record: ConnectionCheckRecord;
    try {
      record = await this.probe(providerId, kind, ticket.sequence);
    } catch (error: unknown) {
      // Never the message: a provider or SDK error can echo request details.
      this.deps.logger.warn('Connection check failed unexpectedly', {
        providerId,
        errorType: error instanceof Error ? error.name : 'unknown',
      });
      record = failedCheck('unclassified');
    }
    this.deps.recorder.complete(ticket, record);
    this.deps.logger.info('Connection check recorded', {
      providerId,
      status: record.status,
      reason: record.reason,
      latencyMs: record.latencyMs,
    });
    return record;
  }

  private async probe(
    providerId: string,
    kind: ConnectionCheckKind,
    sequence: number,
  ): Promise<ConnectionCheckRecord> {
    switch (kind) {
      case 'apiKey':
        return fromDraftProbe(
          await this.deps.draftVerification.verify({
            probeId: `connection-check:${providerId}:${sequence}`,
            providerId,
            authMode: 'apiKey',
            credential: { kind: 'stored' },
          }),
        );
      case 'custom': {
        // The same probe as `provider:testCustomEntry`, so both write the same
        // verdict for one gateway (a tool-less gateway fails both).
        const entry = getCustomProviderEntry(providerId);
        if (!entry) return failedCheck('unclassified');
        return customProbeCheckRecord(
          await probeCustomProvider(
            entry,
            await this.deps.readProviderKey(providerId),
          ),
        );
      }
      case 'copilot':
        return (await this.deps.copilotAuth.isAuthenticated())
          ? verified(null)
          : failedCheck('signed-out');
      case 'codex': {
        // An explicit check re-reads ~/.codex/auth.json instead of the cache.
        this.deps.codexAuth.clearCache();
        const token = await this.deps.codexAuth.getTokenStatus();
        return token.authenticated && !token.stale
          ? verified(null)
          : failedCheck('signed-out');
      }
      case 'claude-cli':
        return (await this.deps.cliDetector.performHealthCheck()).available
          ? verified(null)
          : failedCheck('not-installed');
    }
  }
}

function verified(latencyMs: number | null): ConnectionCheckRecord {
  return {
    status: 'verified',
    reason: null,
    latencyMs,
    checkedAt: new Date().toISOString(),
  };
}

/** A failed check never carries a latency: there is no successful round trip to report. */
export function failedCheck(
  reason: ConnectionCheckFailureReason,
): ConnectionCheckRecord {
  return {
    status: 'failed',
    reason,
    latencyMs: null,
    checkedAt: new Date().toISOString(),
  };
}

/** Keep the outcome, the reason and the latency; drop `detail` and `modelUsed`. */
function fromDraftProbe(
  result: AuthVerifyDraftConnectionResult,
): ConnectionCheckRecord {
  if (result.outcome === 'verified') {
    return verified(
      result.latencyMs === null
        ? null
        : Math.max(0, Math.round(result.latencyMs)),
    );
  }
  return failedCheck(result.reason ?? 'unclassified');
}

/**
 * `provider:testCustomEntry`: one real round trip for a saved custom entry,
 * recorded as its last check.
 *
 * - The ticket is taken before the first await, so an older test that
 *   finishes late never replaces a newer check.
 * - A key-store or probe throw is recorded as `failed`/`unclassified` and
 *   answers fixed text; its message can carry key material, so only the error
 *   type is logged.
 * - The wire result is exactly `{ ok, message, latencyMs? }`: `failure` is an
 *   internal classification for logs, tests and the record.
 */
export async function testCustomEntryAndRecord(
  recorder: ConnectionCheckRecorder,
  logger: Logger,
  entry: CustomProviderEntry,
  readKey: () => Promise<string | undefined>,
): Promise<ProviderTestCustomEntryResult> {
  const ticket = recorder.begin(entry.id);
  let result: CustomProviderProbeResult;
  try {
    result = await probeCustomProvider(entry, await readKey());
  } catch (error: unknown) {
    recorder.complete(ticket, failedCheck('unclassified'));
    logger.warn('RPC: provider:testCustomEntry could not run', {
      providerId: entry.id,
      errorType: error instanceof Error ? error.name : 'unknown',
    });
    return { ok: false, message: 'Could not test the connection.' };
  }
  recorder.complete(ticket, customProbeCheckRecord(result));
  logger.info('RPC: provider:testCustomEntry completed', {
    providerId: entry.id,
    lane: entry.lane,
    ok: result.ok,
    failure: result.failure,
    latencyMs: result.latencyMs,
  });
  return {
    ok: result.ok,
    message: result.message,
    ...(result.latencyMs === undefined ? {} : { latencyMs: result.latencyMs }),
  };
}

/** `provider:testCustomEntry`'s real round trip, as a check record. */
export function customProbeCheckRecord(
  result: CustomProviderProbeResult,
): ConnectionCheckRecord {
  if (result.ok) {
    return verified(
      result.latencyMs === undefined
        ? null
        : Math.max(0, Math.round(result.latencyMs)),
    );
  }
  switch (result.failure) {
    case 'timeout':
      return failedCheck('timeout');
    case 'dns':
    case 'unreachable':
    case 'tls':
      return failedCheck('unreachable');
    case 'unauthorized':
      return failedCheck('credential-rejected');
    case 'not-found':
    case 'no-model':
      return failedCheck('model-unavailable');
    default:
      return failedCheck('unclassified');
  }
}

/** Custom-entry fields that do not change what a check talks to or with. */
const DISPLAY_ONLY_ENTRY_FIELDS: ReadonlySet<string> = new Set([
  'name',
  'keyPrefix',
  'helpUrl',
  'pricing',
  'createdAt',
]);

/**
 * True when a `provider:updateCustomEntry` edit makes the entry's last check
 * stale: a supplied key (replaced or cleared), or any change to the endpoint,
 * lane, auth variable, models endpoint or tier models. Unknown fields count as
 * stale, so a new field is safe by default.
 */
export function customEntryEditStalesCheck(
  changes: object,
  apiKey: string | undefined,
): boolean {
  if (apiKey !== undefined) return true;
  return Object.keys(changes).some(
    (field) => !DISPLAY_ONLY_ENTRY_FIELDS.has(field),
  );
}
