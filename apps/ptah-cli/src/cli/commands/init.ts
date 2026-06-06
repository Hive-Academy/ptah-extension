import * as clack from '@clack/prompts';

import { resolveEffectiveAuthRoute } from '@ptah-extension/auth-providers';
import type {
  EffectiveRouteProvider,
  EffectiveRouteResult,
} from '@ptah-extension/auth-providers';

import { withEngine } from '../bootstrap/with-engine.js';
import { buildFormatter, type Formatter } from '../output/formatter.js';
import { ExitCode } from '../jsonrpc/types.js';
import type { GlobalOptions } from '../router.js';
import type { CliMessageTransport } from '../../transport/cli-message-transport.js';
import { executeSessionStart } from './session.js';

const CANCEL_EXIT_CODE = 130;

export interface InitOptions {
  verbose?: boolean;
}

export interface InitStderrLike {
  write(chunk: string): boolean;
}

type ClackLike = Pick<
  typeof clack,
  | 'intro'
  | 'outro'
  | 'text'
  | 'password'
  | 'select'
  | 'confirm'
  | 'spinner'
  | 'note'
  | 'log'
  | 'isCancel'
  | 'cancel'
>;

export interface InitExecuteHooks {
  stderr?: InitStderrLike;
  formatter?: Formatter;
  withEngine?: typeof withEngine;
  clack?: ClackLike;
  isInteractive?: () => boolean;
  runSmokeTurn?: typeof executeSessionStart;
}

interface ProviderCatalogEntry {
  id: string;
  displayName: string;
  authType: 'apiKey' | 'oauth' | 'cli' | 'none';
  isLocal: boolean;
  hasApiKey: boolean;
  isDefault: boolean;
  baseUrl: string | null;
}

interface ReadinessSnapshot {
  license: {
    tier: string;
    valid: boolean;
    daysRemaining: number | null;
  };
  auth: {
    authMethod: string | null;
    defaultProvider: string | null;
    anthropicProviderId: string | null;
  };
  providers: ProviderCatalogEntry[];
  effective: EffectiveRouteResult;
}

const API_KEY_PROVIDER_PRIORITY = [
  'anthropic',
  'openrouter',
  'z-ai',
  'moonshot',
  'ollama-cloud',
];

const OAUTH_LOGIN_HINTS: Record<string, string> = {
  'github-copilot': 'ptah auth login github-copilot',
  copilot: 'ptah auth login github-copilot',
  'openai-codex': 'codex login --device-auth && ptah auth use openai-codex',
  codex: 'codex login --device-auth && ptah auth use openai-codex',
};

export async function execute(
  opts: InitOptions,
  globals: GlobalOptions,
  hooks: InitExecuteHooks = {},
): Promise<number> {
  const formatter = hooks.formatter ?? buildFormatter(globals);
  const stderr: InitStderrLike = hooks.stderr ?? process.stderr;
  const engine = hooks.withEngine ?? withEngine;
  const interactive = (hooks.isInteractive ?? defaultIsInteractive)(globals);

  try {
    if (!interactive) {
      return await runMachineMode(globals, formatter, engine);
    }
    return await runInteractive(
      opts,
      globals,
      formatter,
      stderr,
      engine,
      hooks,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`ptah init: ${message}\n`);
    await formatter.writeNotification('task.error', {
      ptah_code: 'internal_failure',
      message,
    });
    return ExitCode.InternalFailure;
  }
}

function defaultIsInteractive(globals: GlobalOptions): boolean {
  if (globals.json === true) return false;
  if (globals.quiet === true) return false;
  return process.stdout.isTTY === true;
}

async function runMachineMode(
  globals: GlobalOptions,
  formatter: Formatter,
  engine: typeof withEngine,
): Promise<number> {
  return engine(globals, { mode: 'full', requireSdk: false }, async (ctx) => {
    const snapshot = await readReadiness(ctx.transport);
    const steps = buildPlanSteps(snapshot);
    await formatter.writeNotification('init.plan', {
      ready: snapshot.effective.ready,
      route: snapshot.effective.route,
      blockers: snapshot.effective.blockers,
      license: snapshot.license,
      auth: snapshot.auth,
      steps,
    });
    return ExitCode.Success;
  });
}

interface PlanStep {
  id: string;
  description: string;
  command: string;
  satisfied: boolean;
}

function buildPlanSteps(snapshot: ReadinessSnapshot): PlanStep[] {
  const steps: PlanStep[] = [];

  steps.push({
    id: 'license',
    description:
      'Set a Ptah license key (optional — Community tier works without one)',
    command: 'ptah license set --key ptah_lic_...',
    satisfied:
      snapshot.license.valid === true && snapshot.license.tier !== 'free',
  });

  const defaultProvider = snapshot.auth.defaultProvider;
  const hasDefault =
    typeof defaultProvider === 'string' && defaultProvider.length > 0;
  steps.push({
    id: 'provider.default',
    description: 'Choose a default provider',
    command: 'ptah provider default set <provider-id>',
    satisfied: hasDefault,
  });

  const defaultEntry = hasDefault
    ? snapshot.providers.find((p) => p.id === defaultProvider)
    : undefined;

  if (defaultEntry?.authType === 'apiKey') {
    steps.push({
      id: 'provider.credential',
      description: `Store an API key for ${defaultEntry.id}`,
      command: `ptah provider set-key --provider ${defaultEntry.id} --key <KEY>`,
      satisfied: defaultEntry.hasApiKey === true,
    });
  } else if (defaultEntry?.authType === 'oauth') {
    steps.push({
      id: 'provider.credential',
      description: `Complete the OAuth device-code login for ${defaultEntry.id}`,
      command:
        OAUTH_LOGIN_HINTS[defaultEntry.id] ??
        `ptah auth login ${defaultEntry.id}`,
      satisfied: false,
    });
  } else if (defaultEntry?.authType === 'cli') {
    steps.push({
      id: 'provider.credential',
      description: 'Authenticate the Claude CLI',
      command: 'claude login && ptah auth use claude-cli',
      satisfied: snapshot.effective.ready,
    });
  } else if (defaultEntry?.authType === 'none') {
    steps.push({
      id: 'provider.credential',
      description: `${defaultEntry.id} is keyless — ensure the local daemon is running`,
      command: `ptah provider default set ${defaultEntry.id}`,
      satisfied: true,
    });
  } else {
    steps.push({
      id: 'provider.credential',
      description:
        'Store credentials for the chosen provider (depends on its auth type)',
      command: 'ptah provider set-key --provider <provider-id> --key <KEY>',
      satisfied: false,
    });
  }

  steps.push({
    id: 'verify',
    description: 'Verify readiness',
    command: 'ptah doctor',
    satisfied: snapshot.effective.ready,
  });

  return steps;
}

async function runInteractive(
  _opts: InitOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: InitStderrLike,
  engine: typeof withEngine,
  hooks: InitExecuteHooks,
): Promise<number> {
  const p = hooks.clack ?? clack;
  const runSmoke = hooks.runSmokeTurn ?? executeSessionStart;

  p.intro('Ptah CLI setup');
  p.note(
    [
      'Three things get you running:',
      '  1. A Ptah license (optional — Community tier works without one)',
      '  2. A provider (Anthropic, OpenRouter, Ollama, Copilot, ...)',
      '  3. Credentials for that provider',
    ].join('\n'),
    'What you need',
  );

  return engine(globals, { mode: 'full', requireSdk: false }, async (ctx) => {
    const transport = ctx.transport;

    const licenseResult = await stepLicense(p, transport);
    if (licenseResult === 'cancelled') return abort(p);

    const provider = await stepPickProvider(p, transport);
    if (provider === 'cancelled') return abort(p);

    const credentialResult = await stepCredential(
      p,
      transport,
      provider,
      stderr,
    );
    if (credentialResult === 'cancelled') return abort(p);

    if (credentialResult === 'configured') {
      const tierResult = await stepTier(p, transport, provider);
      if (tierResult === 'cancelled') return abort(p);
    }

    const snapshot = await stepVerify(p, transport);

    if (snapshot.effective.ready) {
      const smokeChoice = await p.confirm({
        message: 'Run a quick test turn now? (uses a small amount of credit)',
        initialValue: false,
      });
      if (p.isCancel(smokeChoice)) return abort(p);
      if (smokeChoice === true) {
        await runSmokeTurn(p, globals, runSmoke);
      }
    } else {
      const remaining = buildPlanSteps(snapshot).filter((s) => !s.satisfied);
      if (remaining.length > 0) {
        p.log.warn('Setup is not complete yet. Remaining commands:');
        for (const step of remaining) {
          p.log.message(`  ${step.command}`);
        }
      }
    }

    p.outro(
      [
        'Next steps:',
        '  One-shot task:   ptah session start --task "..." --once',
        '  Agent/machine:   ptah interact',
        '  Re-run setup:    ptah init',
      ].join('\n'),
    );
    return ExitCode.Success;
  });
}

async function stepLicense(
  p: ClackLike,
  transport: CliMessageTransport,
): Promise<'done' | 'cancelled'> {
  const hasLicense = await p.confirm({
    message: 'Do you have a Ptah license key?',
    initialValue: false,
  });
  if (p.isCancel(hasLicense)) return 'cancelled';

  if (hasLicense !== true) {
    p.log.info(
      'Community tier is fine for most usage — continuing without a license.',
    );
    return 'done';
  }

  const key = await p.password({
    message: 'Paste your license key (ptah_lic_...)',
  });
  if (p.isCancel(key)) return 'cancelled';

  const spin = p.spinner();
  spin.start('Validating license key');
  const result = await safeCall<{
    success?: boolean;
    tier?: string;
    error?: string;
  }>(transport, 'license:setKey', { licenseKey: key });
  spin.stop('License check complete');

  if (result?.success === true) {
    const status = await safeCall<{ tier?: string }>(
      transport,
      'license:getStatus',
      {},
    );
    p.note(
      `Tier: ${status?.tier ?? result.tier ?? 'unknown'}`,
      'License activated',
    );
  } else {
    p.log.error(
      `License rejected: ${result?.error ?? 'invalid key'}. Continuing on Community tier.`,
    );
  }
  return 'done';
}

async function stepPickProvider(
  p: ClackLike,
  transport: CliMessageTransport,
): Promise<ProviderCatalogEntry | 'cancelled'> {
  const catalog = await fetchProviderCatalog(transport);

  const options = catalog.map((entry) => ({
    value: entry.id,
    label: `${entry.displayName} (${authTypeLabel(entry)})`,
  }));

  const selected = await p.select({
    message: 'Pick a provider',
    options,
  });
  if (p.isCancel(selected)) return 'cancelled';

  const entry = catalog.find((c) => c.id === selected);
  if (!entry) {
    return catalog[0];
  }
  return entry;
}

function authTypeLabel(entry: ProviderCatalogEntry): string {
  if (entry.authType === 'apiKey') return 'API key';
  if (entry.authType === 'oauth') return 'OAuth device-code';
  if (entry.authType === 'cli') return 'subscription CLI';
  if (entry.isLocal) return 'local, keyless';
  return 'keyless';
}

type CredentialResult = 'configured' | 'deferred' | 'cancelled';

async function stepCredential(
  p: ClackLike,
  transport: CliMessageTransport,
  provider: ProviderCatalogEntry,
  stderr: InitStderrLike,
): Promise<CredentialResult> {
  if (provider.authType === 'apiKey') {
    return stepApiKeyCredential(p, transport, provider, stderr);
  }
  if (provider.authType === 'none') {
    return stepKeylessCredential(p, transport, provider);
  }
  if (provider.authType === 'cli') {
    return stepCliCredential(p, transport, provider);
  }
  return stepOAuthCredential(p, transport, provider);
}

async function stepApiKeyCredential(
  p: ClackLike,
  transport: CliMessageTransport,
  provider: ProviderCatalogEntry,
  _stderr: InitStderrLike,
): Promise<CredentialResult> {
  for (;;) {
    const key = await p.password({
      message: `Enter your ${provider.displayName} API key`,
    });
    if (p.isCancel(key)) return 'cancelled';

    const spin = p.spinner();
    spin.start('Storing and verifying key');
    const result = await safeCall<{
      success?: boolean;
      verified?: boolean;
      error?: string;
    }>(transport, 'llm:setApiKey', { provider: provider.id, apiKey: key });
    spin.stop('Key check complete');

    if (result?.success === true && result.verified === true) {
      p.log.success(`Key verified for ${provider.id}.`);
      await setDefaultProvider(p, transport, provider.id);
      return 'configured';
    }

    p.log.error(`Key rejected: ${result?.error ?? 'failed validation'}.`);
    const retry = await p.confirm({
      message: 'Try a different key?',
      initialValue: true,
    });
    if (p.isCancel(retry)) return 'cancelled';
    if (retry !== true) {
      p.log.warn(`Skipping ${provider.id} — default provider not changed.`);
      return 'deferred';
    }
  }
}

async function stepKeylessCredential(
  p: ClackLike,
  transport: CliMessageTransport,
  provider: ProviderCatalogEntry,
): Promise<CredentialResult> {
  if (typeof provider.baseUrl === 'string' && provider.baseUrl.length > 0) {
    const spin = p.spinner();
    spin.start(`Checking ${provider.id} daemon reachability`);
    const reachable = await probeLocal(provider.baseUrl);
    spin.stop(
      reachable
        ? `${provider.id} daemon is reachable`
        : `${provider.id} daemon not reachable`,
    );
    if (!reachable) {
      p.log.warn(
        `Could not reach ${provider.baseUrl}. Make sure the ${provider.id} daemon is running.`,
      );
    }
  } else {
    p.log.info(
      `${provider.displayName} is keyless. Make sure its local daemon is running before you start a turn.`,
    );
  }
  await setDefaultProvider(p, transport, provider.id);
  return 'configured';
}

async function stepCliCredential(
  p: ClackLike,
  transport: CliMessageTransport,
  provider: ProviderCatalogEntry,
): Promise<CredentialResult> {
  p.note(
    [
      'This provider authenticates through the Claude CLI.',
      'Run `claude login` in your shell if you have not already,',
      'then this wizard will switch Ptah to the CLI strategy.',
    ].join('\n'),
    'Claude CLI',
  );
  const proceed = await p.confirm({
    message: 'Switch Ptah to the Claude CLI auth strategy now?',
    initialValue: true,
  });
  if (p.isCancel(proceed)) return 'cancelled';
  if (proceed !== true) return 'deferred';

  const result = await safeCall<{ success?: boolean; error?: string }>(
    transport,
    'auth:testConnection',
    undefined,
  );
  await setDefaultProvider(p, transport, provider.id);
  if (result?.success === false) {
    p.log.warn(
      'Claude CLI is set as the strategy, but a connection test did not pass. Run `claude login` and re-run `ptah doctor`.',
    );
  }
  return 'configured';
}

async function stepOAuthCredential(
  p: ClackLike,
  transport: CliMessageTransport,
  provider: ProviderCatalogEntry,
): Promise<CredentialResult> {
  const hint =
    OAUTH_LOGIN_HINTS[provider.id] ?? `ptah auth login ${provider.id}`;
  p.note(
    [
      `${provider.displayName} uses a device-code OAuth flow.`,
      'Run this in your shell to finish signing in:',
      `  ${hint}`,
    ].join('\n'),
    'OAuth login required',
  );
  const setDefault = await p.confirm({
    message: `Set ${provider.id} as the default provider so the login lands correctly?`,
    initialValue: true,
  });
  if (p.isCancel(setDefault)) return 'cancelled';
  if (setDefault === true) {
    await setDefaultProvider(p, transport, provider.id);
  }
  return 'deferred';
}

async function setDefaultProvider(
  p: ClackLike,
  transport: CliMessageTransport,
  providerId: string,
): Promise<void> {
  const result = await safeCall<{ success?: boolean; error?: string }>(
    transport,
    'llm:setDefaultProvider',
    { provider: providerId },
  );
  if (result?.success === false) {
    p.log.warn(
      `Could not set ${providerId} as default: ${result.error ?? 'unknown error'}`,
    );
    return;
  }
  p.log.success(`Default provider set to ${providerId}.`);
}

async function stepTier(
  p: ClackLike,
  transport: CliMessageTransport,
  provider: ProviderCatalogEntry,
): Promise<'done' | 'cancelled'> {
  const wantsTiers = await p.confirm({
    message: 'Map model tiers now? (sonnet / opus / haiku)',
    initialValue: false,
  });
  if (p.isCancel(wantsTiers)) return 'cancelled';
  if (wantsTiers !== true) return 'done';

  const models = await fetchProviderModels(transport, provider.id);
  for (const tier of ['sonnet', 'opus', 'haiku'] as const) {
    const modelId = await p.text({
      message: `Model id for the ${tier} tier (leave blank to skip)`,
      placeholder: models[0] ?? '',
    });
    if (p.isCancel(modelId)) return 'cancelled';
    const trimmed = (modelId ?? '').trim();
    if (trimmed.length === 0) continue;

    const result = await safeCall<{ success?: boolean; error?: string }>(
      transport,
      'provider:setModelTier',
      { tier, modelId: trimmed, scope: 'mainAgent' },
    );
    if (result?.success === true) {
      p.log.success(`${tier} → ${trimmed}`);
    } else {
      p.log.error(`Could not map ${tier}: ${result?.error ?? 'unknown error'}`);
    }
  }
  return 'done';
}

async function stepVerify(
  p: ClackLike,
  transport: CliMessageTransport,
): Promise<ReadinessSnapshot> {
  const spin = p.spinner();
  spin.start('Verifying readiness');
  const snapshot = await readReadiness(transport);
  spin.stop('Readiness check complete');

  const summary = [
    `License tier: ${snapshot.license.tier}`,
    `Provider:     ${snapshot.auth.defaultProvider ?? '(unset)'}`,
    `Auth route:   ${snapshot.effective.route}`,
    `Ready:        ${snapshot.effective.ready ? 'yes' : 'no'}`,
  ];
  if (snapshot.effective.blockers.length > 0) {
    summary.push('Blockers:');
    for (const blocker of snapshot.effective.blockers) {
      summary.push(`  - ${blocker}`);
    }
  }
  p.note(summary.join('\n'), 'Readiness');
  return snapshot;
}

async function runSmokeTurn(
  p: ClackLike,
  globals: GlobalOptions,
  runSmoke: typeof executeSessionStart,
): Promise<void> {
  const spin = p.spinner();
  spin.start('Running a quick test turn');
  try {
    const exit = await runSmoke(
      { task: 'Reply with the single word: ready', once: true },
      { ...globals, json: true },
    );
    spin.stop(
      exit === ExitCode.Success ? 'Test turn succeeded' : 'Test turn failed',
    );
    if (exit !== ExitCode.Success) {
      p.log.warn(`Test turn exited with code ${exit}.`);
    }
  } catch (error) {
    spin.stop('Test turn failed');
    const message = error instanceof Error ? error.message : String(error);
    p.log.error(`Test turn error: ${message}`);
  }
}

function abort(p: ClackLike): number {
  p.cancel('Setup aborted');
  return CANCEL_EXIT_CODE;
}

async function readReadiness(
  transport: CliMessageTransport,
): Promise<ReadinessSnapshot> {
  const licenseRaw = await safeCall<{
    tier?: string;
    valid?: boolean;
    daysRemaining?: number | null;
  }>(transport, 'license:getStatus', {});
  const license: ReadinessSnapshot['license'] = {
    tier: licenseRaw?.tier ?? 'unknown',
    valid: licenseRaw?.valid === true,
    daysRemaining:
      typeof licenseRaw?.daysRemaining === 'number'
        ? licenseRaw.daysRemaining
        : null,
  };

  const authStatus = await safeCall<{
    authMethod?: string | null;
    anthropicProviderId?: string | null;
  }>(transport, 'auth:getAuthStatus', {});
  const defaultProviderResp = await safeCall<{
    provider?: string | null;
    defaultProvider?: string | null;
  }>(transport, 'llm:getDefaultProvider', {});
  const auth: ReadinessSnapshot['auth'] = {
    authMethod: authStatus?.authMethod ?? null,
    defaultProvider:
      defaultProviderResp?.provider ??
      defaultProviderResp?.defaultProvider ??
      null,
    anthropicProviderId: authStatus?.anthropicProviderId ?? null,
  };

  const providers = await fetchProviderCatalog(transport);
  const oauthHealth = await safeCall<{
    copilotAuthenticated?: boolean;
    codexAuthenticated?: boolean;
  }>(transport, 'auth:getHealth', undefined);

  const routeProviders: EffectiveRouteProvider[] = providers.map((entry) =>
    toRouteProvider(entry, oauthHealth),
  );
  const effective = resolveEffectiveAuthRoute(auth, routeProviders);

  return { license, auth, providers, effective };
}

function toRouteProvider(
  entry: ProviderCatalogEntry,
  oauthHealth: {
    copilotAuthenticated?: boolean;
    codexAuthenticated?: boolean;
  } | null,
): EffectiveRouteProvider {
  if (entry.authType === 'apiKey') {
    return {
      id: entry.id,
      type: 'apiKey',
      status: entry.hasApiKey ? 'connected' : 'needs-key',
    };
  }
  if (entry.authType === 'oauth') {
    let status: EffectiveRouteProvider['status'] = 'unknown';
    if (entry.id === 'github-copilot' || entry.id === 'copilot') {
      status =
        oauthHealth?.copilotAuthenticated === true
          ? 'connected'
          : 'unauthenticated';
    } else if (entry.id === 'openai-codex' || entry.id === 'codex') {
      status =
        oauthHealth?.codexAuthenticated === true
          ? 'connected'
          : 'unauthenticated';
    }
    return { id: entry.id, type: 'oauth', status };
  }
  if (entry.authType === 'cli') {
    return { id: entry.id, type: 'cli', status: 'unknown' };
  }
  return {
    id: entry.id,
    type: 'local-native',
    status: entry.baseUrl ? 'reachable' : 'skipped',
  };
}

async function fetchProviderCatalog(
  transport: CliMessageTransport,
): Promise<ProviderCatalogEntry[]> {
  const status = await safeCall<{
    providers?: Array<{
      name?: string;
      displayName?: string;
      authType?: 'apiKey' | 'oauth' | 'cli' | 'none';
      isLocal?: boolean;
      hasApiKey?: boolean;
      isDefault?: boolean;
      baseUrl?: string | null;
    }>;
  }>(transport, 'llm:getProviderStatus', undefined);

  const raw = status?.providers ?? [];
  const entries: ProviderCatalogEntry[] = [];
  for (const provider of raw) {
    const id = provider.name ?? '';
    if (!id) continue;
    entries.push({
      id,
      displayName: provider.displayName ?? id,
      authType: provider.authType ?? 'apiKey',
      isLocal: provider.isLocal === true,
      hasApiKey: provider.hasApiKey === true,
      isDefault: provider.isDefault === true,
      baseUrl: typeof provider.baseUrl === 'string' ? provider.baseUrl : null,
    });
  }
  return sortCatalog(entries);
}

function sortCatalog(entries: ProviderCatalogEntry[]): ProviderCatalogEntry[] {
  const rank = (entry: ProviderCatalogEntry): number => {
    if (entry.authType === 'apiKey') {
      const idx = API_KEY_PROVIDER_PRIORITY.indexOf(entry.id);
      return idx >= 0 ? idx : API_KEY_PROVIDER_PRIORITY.length;
    }
    if (entry.authType === 'none') return 100;
    if (entry.authType === 'cli') return 200;
    return 300;
  };
  return entries
    .slice()
    .sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
}

async function fetchProviderModels(
  transport: CliMessageTransport,
  providerId: string,
): Promise<string[]> {
  const result = await safeCall<{
    models?: Array<{ id?: string }>;
  }>(transport, 'llm:listProviderModels', { provider: providerId });
  return (result?.models ?? [])
    .map((m) => m.id ?? '')
    .filter((id) => id.length > 0);
}

async function probeLocal(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    const res = await fetch(url, { method: 'GET', signal: controller.signal });
    await res.text();
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function safeCall<T>(
  transport: CliMessageTransport,
  method: string,
  params: unknown,
): Promise<T | null> {
  try {
    const response = await transport.call<unknown, T>(method, params);
    if (!response.success) return null;
    return (response.data as T) ?? null;
  } catch {
    return null;
  }
}
