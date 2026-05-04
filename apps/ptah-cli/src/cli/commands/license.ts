/**
 * `ptah license` command — license status / set-key / clear.
 *
 * TASK_2026_104 Sub-batch B5d.
 *
 * Sub-commands (per task-description.md §3.1) — all delegate to the shared
 * LicenseRpcHandlers:
 *
 *   status                      RPC `license:getStatus` (license key never
 *                               leaves the backend; only tier + flags surface)
 *   set --key <ptah_lic_...>    RPC `license:setKey`
 *   clear                       RPC `license:clearKey`
 *
 * No DI mocking in production; tests inject hooks via {@link LicenseExecuteHooks}.
 */

import { withEngine } from '../bootstrap/with-engine.js';
import { buildFormatter, type Formatter } from '../output/formatter.js';
import { ExitCode } from '../jsonrpc/types.js';
import type { GlobalOptions } from '../router.js';
import type { CliMessageTransport } from '../../transport/cli-message-transport.js';

export type LicenseSubcommand = 'status' | 'set' | 'clear';

export interface LicenseOptions {
  subcommand: LicenseSubcommand;
  /** For `set`: the license key (`ptah_lic_` + 64 hex chars). */
  key?: string;
}

export interface LicenseStderrLike {
  write(chunk: string): boolean;
}

export interface LicenseExecuteHooks {
  stderr?: LicenseStderrLike;
  formatter?: Formatter;
  withEngine?: typeof withEngine;
}

export async function execute(
  opts: LicenseOptions,
  globals: GlobalOptions,
  hooks: LicenseExecuteHooks = {},
): Promise<number> {
  const formatter = hooks.formatter ?? buildFormatter(globals);
  const stderr: LicenseStderrLike = hooks.stderr ?? process.stderr;
  const engine = hooks.withEngine ?? withEngine;

  try {
    switch (opts.subcommand) {
      case 'status':
        return await runStatus(globals, formatter, engine);
      case 'set':
        return await runSet(opts, globals, formatter, stderr, engine);
      case 'clear':
        return await runClear(globals, formatter, engine);
      default:
        stderr.write(
          `ptah license: unknown sub-command '${String(opts.subcommand)}'\n`,
        );
        return ExitCode.UsageError;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await formatter.writeNotification('task.error', {
      ptah_code: 'internal_failure',
      message,
    });
    return ExitCode.InternalFailure;
  }
}

async function runStatus(
  globals: GlobalOptions,
  formatter: Formatter,
  engine: typeof withEngine,
): Promise<number> {
  return engine(globals, { mode: 'full' }, async (ctx) => {
    const result = await callRpc<unknown>(
      ctx.transport,
      'license:getStatus',
      {},
    );
    // Backend never returns the license key in this payload — safe to forward verbatim.
    await formatter.writeNotification('license.status', wrapResult(result));
    return ExitCode.Success;
  });
}

async function runSet(
  opts: LicenseOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: LicenseStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  if (!opts.key) {
    stderr.write('ptah license set: --key is required\n');
    return ExitCode.UsageError;
  }
  return engine(globals, { mode: 'full' }, async (ctx) => {
    const key = Array.isArray(opts.key) ? opts.key[0] : opts.key;
    const result = await callRpc<{
      success?: boolean;
      tier?: string;
      plan?: { name?: string };
      error?: string;
    }>(ctx.transport, 'license:setKey', { licenseKey: key });
    if (result?.success === false) {
      throw new Error(result.error ?? 'license:setKey failed');
    }

    // After a successful key write, fetch the verified status so we can
    // surface a near-expiry warning to the operator. The backend may
    // emit `daysRemaining: <14` for paid Pro keys when the License row
    // still carries a stale trial `expiresAt` (server-side bug — see
    // license-rpc.handlers.ts mapLicenseStatusToResponse comment).
    let expiryWarning: 'near_expiry' | 'critical' | null = null;
    let daysRemaining: number | null = null;
    try {
      const status = await callRpc<{
        tier?: string;
        daysRemaining?: number | null;
        expiryWarning?: 'near_expiry' | 'critical' | null;
      }>(ctx.transport, 'license:getStatus', {});
      daysRemaining =
        typeof status?.daysRemaining === 'number' ? status.daysRemaining : null;
      // Prefer server/handler-computed warning; fall back to local math
      // so we still warn if the remote omits the field. Thresholds match
      // the user-facing spec: <7d critical, <30d near_expiry. Pro tier only
      // (trial_pro expiring is the expected case, not a defensive warning).
      if (status?.expiryWarning) {
        expiryWarning = status.expiryWarning;
      } else if (
        status?.tier === 'pro' &&
        typeof daysRemaining === 'number' &&
        daysRemaining < 30
      ) {
        expiryWarning = daysRemaining < 7 ? 'critical' : 'near_expiry';
      }
    } catch {
      // Status fetch is best-effort. A failure here must not turn a
      // successful set-key into a failure exit.
    }

    if (expiryWarning) {
      const noColor = globals.noColor === true || !!process.env['NO_COLOR'];
      const days = daysRemaining ?? 0;
      const isCritical = expiryWarning === 'critical';
      const prefix = isCritical ? 'CRITICAL' : 'WARNING';
      const colorOpen = noColor ? '' : isCritical ? '\u001b[31m' : '\u001b[33m';
      const colorClose = noColor ? '' : '\u001b[0m';
      stderr.write(
        `${colorOpen}${prefix}: license expires in ${days} day${days === 1 ? '' : 's'} (${expiryWarning}).${colorClose}\n`,
      );
    }

    await formatter.writeNotification('license.updated', {
      success: true,
      tier: result?.tier,
      plan: result?.plan,
      expiryWarning,
      daysRemaining,
    });
    return ExitCode.Success;
  });
}

async function runClear(
  globals: GlobalOptions,
  formatter: Formatter,
  engine: typeof withEngine,
): Promise<number> {
  return engine(globals, { mode: 'full' }, async (ctx) => {
    const result = await callRpc<{ success?: boolean; error?: string }>(
      ctx.transport,
      'license:clearKey',
      {},
    );
    if (result?.success === false) {
      throw new Error(result.error ?? 'license:clearKey failed');
    }
    await formatter.writeNotification('license.cleared', { success: true });
    return ExitCode.Success;
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wrapResult(result: unknown): Record<string, unknown> {
  if (result === null || result === undefined) return {};
  if (typeof result === 'object' && !Array.isArray(result)) {
    return result as Record<string, unknown>;
  }
  return { result };
}

async function callRpc<T = unknown>(
  transport: CliMessageTransport,
  method: string,
  params: unknown,
): Promise<T> {
  const response = await transport.call<unknown, T>(method, params);
  if (!response.success) {
    const err = new Error(response.error ?? `${method} failed`);
    if (response.errorCode) {
      (err as unknown as { code: string }).code = response.errorCode;
    }
    throw err;
  }
  return (response.data as T) ?? (null as unknown as T);
}
