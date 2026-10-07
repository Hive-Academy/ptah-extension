/**
 * Redacted live plan-usage probe.
 *
 * Run:
 * npx ts-node --transpile-only --project scripts/agent-usage/tsconfig.json -r tsconfig-paths/register scripts/agent-usage/probe-plan-usage.ts
 *
 * This never reads or prints auth files, tokens, emails, account IDs, or raw
 * provider responses. It uses the production readers; Codex also uses the
 * production App Server account-usage service and process-launch shape.
 */
import 'reflect-metadata';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

// The production providers share logging tokens from vscode-core. Its root
// barrel also imports the VS Code host API, which a standalone Node script
// intentionally does not load. Keep the host-only module inert before the
// production reader modules are required.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Module = require('node:module') as {
  _load: (...args: unknown[]) => unknown;
};
const vscodeStub: CallableFunction = new Proxy(function vscodeHostStub() {}, {
  get: () => vscodeStub,
  apply: () => vscodeStub,
  construct: () => vscodeStub,
});
const nativeLoad = Module._load;
Module._load = function loadWithVscodeStub(
  request: unknown,
  ...args: unknown[]
): unknown {
  if (request === 'vscode') return vscodeStub;
  // PlanLimitsSnapshotService only needs these runtime DI keys. Loading either
  // public barrel in a Node probe eagerly reaches extension-only modules.
  if (request === '@ptah-extension/auth-providers') {
    return { AUTH_PROVIDERS_TOKENS: {} };
  }
  if (request === '@ptah-extension/cli-agent-runtime') {
    return { CLI_AGENT_RUNTIME_TOKENS: {} };
  }
  return nativeLoad.call(this, request, ...args);
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { CodexAccountUsageService } =
  require('../../libs/backend/auth-providers/src/lib/providers/codex/codex-account-usage.service') as typeof import('../../libs/backend/auth-providers/src/lib/providers/codex/codex-account-usage.service');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createCodexPlanUsageReader } =
  require('../../libs/backend/auth-providers/src/lib/quota/readers/codex-plan-usage.reader') as typeof import('../../libs/backend/auth-providers/src/lib/quota/readers/codex-plan-usage.reader');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createAntigravityPlanUsageReader } =
  require('../../libs/backend/auth-providers/src/lib/quota/readers/antigravity-plan-usage.reader') as typeof import('../../libs/backend/auth-providers/src/lib/quota/readers/antigravity-plan-usage.reader');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createClaudePlanUsageReader } =
  require('../../libs/backend/auth-providers/src/lib/quota/readers/claude-plan-usage.reader') as typeof import('../../libs/backend/auth-providers/src/lib/quota/readers/claude-plan-usage.reader');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createOllamaCloudPlanUsageReader } =
  require('../../libs/backend/auth-providers/src/lib/quota/readers/ollama-cloud-plan-usage.reader') as typeof import('../../libs/backend/auth-providers/src/lib/quota/readers/ollama-cloud-plan-usage.reader');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createOpenCodeLocalUsageReader } =
  require('../../libs/backend/auth-providers/src/lib/quota/readers/opencode-local-usage.reader') as typeof import('../../libs/backend/auth-providers/src/lib/quota/readers/opencode-local-usage.reader');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createGrokSessionUsageReader } =
  require('../../libs/backend/auth-providers/src/lib/quota/readers/grok-session-usage.reader') as typeof import('../../libs/backend/auth-providers/src/lib/quota/readers/grok-session-usage.reader');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PlanUsageService } =
  require('../../libs/backend/auth-providers/src/lib/quota/plan-usage.service') as typeof import('../../libs/backend/auth-providers/src/lib/quota/plan-usage.service');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PlanLimitsSnapshotService } =
  require('../../libs/backend/rpc-handlers/src/lib/services/plan-limits-snapshot.service') as typeof import('../../libs/backend/rpc-handlers/src/lib/services/plan-limits-snapshot.service');

type ProbeResult = {
  provider: string;
  state: string;
  reason: string;
  windows: Array<{
    label: string;
    percent: number | null;
    resetAt: string | null;
  }>;
  localUsage?: {
    kind: 'local-usage';
    label: string;
    hasTokens: true;
    hasEstimatedCost: true;
    hasRange: boolean;
  };
  failure?: { step: string; errorClass: string; message: string };
};

type WindowProjection = Array<{
  label: string;
  percent: number | null;
  resetAt: string | null;
}>;

type CodexDelivery = {
  reader: WindowProjection;
  providerGetAccountUsage: WindowProjection;
  providerGetPlanLimits: WindowProjection;
};

type CodexRateLimitWindowShape = {
  windowDurationMins: number | null;
  usedPercent: number | null;
  resetsAt: number | null;
};

type CodexRateLimitBucketShape = {
  bucket: string;
  limitId: string | null;
  limitName: string | null;
  primary: CodexRateLimitWindowShape | null;
  secondary: CodexRateLimitWindowShape | null;
};

function redactedWindowShape(value: unknown): CodexRateLimitWindowShape | null {
  if (value === null || typeof value !== 'object') return null;
  const window = value as Record<string, unknown>;
  return {
    windowDurationMins:
      typeof window.windowDurationMins === 'number'
        ? window.windowDurationMins
        : null,
    usedPercent:
      typeof window.usedPercent === 'number' ? window.usedPercent : null,
    resetsAt: typeof window.resetsAt === 'number' ? window.resetsAt : null,
  };
}

function redactedBucketShape(
  bucket: string,
  value: unknown,
): CodexRateLimitBucketShape {
  const snapshot =
    value !== null && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {};
  return {
    bucket,
    limitId: typeof snapshot.limitId === 'string' ? snapshot.limitId : null,
    limitName:
      typeof snapshot.limitName === 'string' ? snapshot.limitName : null,
    primary: redactedWindowShape(snapshot.primary),
    secondary: redactedWindowShape(snapshot.secondary),
  };
}

async function codexShape(): Promise<{
  rateLimitsByLimitIdKeys: string[];
  buckets: CodexRateLimitBucketShape[];
}> {
  const home = join(homedir(), '.codex');
  // Keep this separate from the production service: the diagnostic must read
  // the unprojected multi-bucket response while still using its App Server.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const packageJson = require.resolve('@openai/codex/package.json') as string;
  const child = spawn(
    process.execPath,
    [join(dirname(packageJson), 'bin', 'codex.js'), 'app-server'],
    {
      env: { ...process.env, CODEX_HOME: home },
      stdio: ['pipe', 'pipe', 'ignore'],
    },
  );
  const response = await new Promise<unknown>(
    (resolvePromise, rejectPromise) => {
      let buffer = '';
      let complete = false;
      const finish = (action: () => void) => {
        if (complete) return;
        complete = true;
        clearTimeout(timeout);
        child.kill();
        action();
      };
      const timeout = setTimeout(
        () => finish(() => rejectPromise(new Error('App Server timeout'))),
        10_000,
      );
      child.once('error', (error) => finish(() => rejectPromise(error)));
      child.once('close', () =>
        finish(() => rejectPromise(new Error('App Server closed'))),
      );
      child.stdout.on('data', (chunk: Buffer) => {
        buffer += String(chunk);
        let newline: number;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line) continue;
          try {
            const message = JSON.parse(line) as {
              id?: number;
              result?: unknown;
              error?: unknown;
            };
            if (message.id === 1) {
              child.stdin.write(
                `${JSON.stringify({ method: 'initialized' })}\n`,
              );
              child.stdin.write(
                `${JSON.stringify({ id: 2, method: 'account/rateLimits/read' })}\n`,
              );
            } else if (message.id === 2) {
              if (message.error !== undefined)
                finish(() =>
                  rejectPromise(
                    new Error('App Server rate-limits read failed'),
                  ),
                );
              else finish(() => resolvePromise(message.result));
            }
          } catch {
            finish(() =>
              rejectPromise(new Error('App Server emitted invalid JSON')),
            );
          }
        }
      });
      child.stdin.write(
        `${JSON.stringify({
          id: 1,
          method: 'initialize',
          params: {
            clientInfo: { name: 'ptah-plan-usage-probe', version: '1' },
          },
        })}\n`,
      );
    },
  );
  const payload =
    response !== null && typeof response === 'object'
      ? (response as Record<string, unknown>)
      : {};
  const byLimitId =
    payload.rateLimitsByLimitId !== null &&
    typeof payload.rateLimitsByLimitId === 'object'
      ? (payload.rateLimitsByLimitId as Record<string, unknown>)
      : {};
  return {
    rateLimitsByLimitIdKeys: Object.keys(byLimitId),
    buckets: [
      redactedBucketShape('default', payload.rateLimits),
      ...Object.entries(byLimitId).map(([key, bucket]) =>
        redactedBucketShape(key, bucket),
      ),
    ],
  };
}

const logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const target = (providerId: string) => ({
  providerId,
  ownerRef: {
    providerId,
    identityKind: 'unknown' as const,
    key: `${providerId}#unknown:probe`,
    label: `${providerId} probe`,
  },
});

function windowsOf(reading: {
  windows: readonly {
    label: string;
    used?: { kind: string; percent?: number };
    resetsAt?: number;
  }[];
}): WindowProjection {
  return reading.windows.map((window) => ({
    label: window.label,
    percent: window.used?.kind === 'percent' ? window.used.percent : null,
    resetAt:
      window.resetsAt === undefined
        ? null
        : new Date(window.resetsAt).toISOString(),
  }));
}

function toResult(
  provider: string,
  reading: {
    status: string;
    windows: readonly {
      label: string;
      used?: { kind: string; percent?: number };
      resetsAt?: number;
    }[];
    localUsage?: {
      kind: 'local-usage';
      label: string;
      tokens: number;
      estimatedCostUsd: number;
      range?: string;
    };
  },
  reason: string,
): ProbeResult {
  return {
    provider,
    state: reading.status,
    reason,
    windows: windowsOf(reading),
    ...(reading.localUsage && {
      localUsage: {
        kind: 'local-usage' as const,
        label: reading.localUsage.label,
        hasTokens: true as const,
        hasEstimatedCost: true as const,
        hasRange: reading.localUsage.range !== undefined,
      },
    }),
  };
}

function failure(provider: string, step: string, error: unknown): ProbeResult {
  const value = error instanceof Error ? error : new Error(String(error));
  return {
    provider,
    state: 'service-unavailable',
    reason: 'probe-failure',
    windows: [],
    failure: {
      step,
      errorClass: value.name,
      // Provider errors can contain identity material; keep a bounded type-only diagnostic.
      message: value.message
        .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g, '[redacted-email]')
        .slice(0, 160),
    },
  };
}

async function codex(): Promise<ProbeResult & { delivery?: CodexDelivery }> {
  const home = join(homedir(), '.codex');
  const spawner = {
    spawnProcess: ({ command, args, env }) =>
      spawn(command, [...args], {
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      }),
  };
  const usage = new CodexAccountUsageService(
    logger,
    { getAccountUsageEligibility: async () => 'supported' } as never,
    { path: home } as never,
    spawner,
    { onAuthFileChanged: () => undefined } as never,
  );
  try {
    // Use a synthetic anonymous route only to avoid identity lookup. The App
    // Server reader, ledger merge, and snapshot/RPC layers are production
    // classes and still read the logged-in machine's actual plan limits.
    const codexTarget = target('openai-codex');
    const windowsByOwner = new Map<string, readonly unknown[]>();
    const ledger = {
      snapshotFor: (ownerKey: string) => {
        const windows = windowsByOwner.get(ownerKey);
        return windows ? { windows, ownerEvidence: [] } : undefined;
      },
      recordWindowEvidence: (owner: { key: string }, window: unknown) => {
        windowsByOwner.set(owner.key, [
          ...(windowsByOwner.get(owner.key) ?? []),
          window,
        ]);
      },
      sessionOwners: () => ({}),
    };
    const planUsage = new PlanUsageService(
      logger as never,
      ledger as never,
      {
        resolve: async () => ({
          kind: 'unavailable',
          status: 'unsupported-config',
        }),
      } as never,
      { readPlanUsage: async () => null } as never,
      usage,
    );
    const entry = {
      kind: 'read' as const,
      origin: 'selected-provider' as const,
      target: codexTarget,
    };
    const snapshots = new PlanLimitsSnapshotService(
      logger as never,
      {
        discoverSelectedProvider: async () => ({
          kind: 'owner' as const,
          entry,
        }),
        discoverTargets: async () => [entry],
      } as never,
      planUsage,
      ledger as never,
    );
    const accountUsage = await snapshots.ownerSnapshotForProvider(
      'openai-codex',
      true,
    );
    const planLimits = await snapshots.snapshot({ providerId: 'openai-codex' });
    if (accountUsage.kind !== 'snapshot') {
      return {
        ...toResult(
          'Codex',
          { status: 'service-unavailable', windows: [] },
          'snapshot/unavailable',
        ),
      };
    }
    const reading = await createCodexPlanUsageReader(usage)({
      target: codexTarget,
      refresh: false,
    });
    return {
      ...toResult(
        'Codex',
        reading,
        reading.status === 'available' ? 'app-server' : 'account-usage-service',
      ),
      delivery: {
        reader: windowsOf(reading),
        // provider:getAccountUsage uses ownerSnapshotForProvider's windows.
        providerGetAccountUsage: windowsOf(accountUsage.snapshot),
        // provider:getPlanLimits uses the first matching owner snapshot.
        providerGetPlanLimits: windowsOf(
          planLimits.owners[0] ?? { windows: [] },
        ),
      },
    };
  } catch (error) {
    return failure('Codex', 'account/rateLimits/read', error);
  } finally {
    await usage.close();
  }
}

async function antigravity(): Promise<ProbeResult> {
  try {
    const reading = await createAntigravityPlanUsageReader(logger)({
      target: target('antigravity'),
      refresh: true,
    });
    return toResult(
      'Antigravity',
      reading,
      reading.status === 'available'
        ? 'language-server-status'
        : 'process/discovery',
    );
  } catch (error) {
    return failure('Antigravity', 'process/discovery', error);
  }
}

async function opencode(): Promise<ProbeResult> {
  try {
    const reading = await createOpenCodeLocalUsageReader(logger)({
      target: target('opencode'),
      refresh: true,
    });
    return toResult('OpenCode', reading, 'local-cli:stats-json-cost');
  } catch (error) {
    return failure('OpenCode', 'local-cli:stats-json-cost', error);
  }
}

async function grok(): Promise<ProbeResult> {
  // The harness intentionally has no Ptah-started Grok session id. Do not
  // discover one: production only invokes this reader with a recorded id.
  const reading = await createGrokSessionUsageReader(logger)({
    target: target('grok'),
    refresh: true,
  });
  return toResult('Grok', reading, 'skipped:no-ptah-session-id');
}

async function ollamaCloud(): Promise<ProbeResult> {
  try {
    const reading = await createOllamaCloudPlanUsageReader(logger)({
      target: target('ollama-cloud'),
      refresh: true,
    });
    return toResult('Ollama Cloud', reading, 'credential/read');
  } catch (error) {
    return failure('Ollama Cloud', 'credential/read', error);
  }
}

async function claude(): Promise<ProbeResult> {
  try {
    const reading = await createClaudePlanUsageReader(
      { readPlanUsage: async () => null },
      logger,
    )({ target: target('anthropic'), refresh: true });
    return toResult('Claude', reading, 'account/read:no-open-session');
  } catch (error) {
    return failure('Claude', 'account/read', error);
  }
}

async function main(): Promise<void> {
  if (process.argv.includes('--codex-shape')) {
    console.log(JSON.stringify(await codexShape(), null, 2));
    return;
  }
  const results = await Promise.all([
    codex(),
    antigravity(),
    opencode(),
    grok(),
    ollamaCloud(),
    claude(),
  ]);
  console.log(
    JSON.stringify(
      { generatedAt: new Date().toISOString(), providers: results },
      null,
      2,
    ),
  );
}

void main().catch((error: unknown) => {
  console.log(JSON.stringify(failure('harness', 'initialize', error), null, 2));
  process.exitCode = 1;
});
