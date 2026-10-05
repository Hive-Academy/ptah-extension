import 'reflect-metadata';
import { container as rootContainer } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import { SETTINGS_TOKENS } from '@ptah-extension/settings-core';
import { createMockLogger } from '@ptah-extension/shared/testing';
import { AUTH_PROVIDERS_TOKENS } from './tokens';
import {
  registerAuthProvidersServices,
  registerCuratorAuthServices,
} from './register';
import { ProviderAuthResolver } from '../auth/provider-auth-resolver';
import { DraftVerificationService } from '../auth/draft-verification.service';
import { OpenRouterPricingService } from '../providers/openrouter';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import { PlanLimitLedgerService } from '../quota/plan-limit-ledger.service';
import { ProviderOwnerResolver } from '../quota/provider-owner.resolver';
import { PlanCredentialSource } from '../quota/plan-credential.source';
import { PlanUsageService } from '../quota/plan-usage.service';

describe('required auth registration without the memory curator', () => {
  afterEach(() => jest.restoreAllMocks());

  function setup() {
    const c = rootContainer.createChildContainer();
    const logger = createMockLogger() as unknown as Logger;
    jest
      .spyOn(OpenRouterPricingService.prototype, 'warmup')
      .mockImplementation(() => undefined);
    c.registerInstance(TOKENS.LOGGER, logger);
    c.registerInstance(TOKENS.CONFIG_MANAGER, { get: jest.fn() });
    c.registerInstance(TOKENS.AUTH_SECRETS_SERVICE, {});
    c.registerInstance(SETTINGS_TOKENS.WORKSPACE_SCOPE_RESOLVER, {});
    c.registerInstance(SDK_TOKENS.SDK_INTERNAL_QUERY_SERVICE, {});
    // The Codex proxy reads its quota owner from the Codex account service,
    // which needs these two agent-sdk boundaries (registered by every host).
    c.registerInstance(SDK_TOKENS.SDK_PROCESS_SPAWNER, {});
    c.registerInstance(SDK_TOKENS.SDK_ADAPTER_EVENTS, {
      onAuthFileChanged: jest.fn(),
    });
    registerAuthProvidersServices(c, logger);
    // Host-specific auth boundaries are outside this registration contract.
    c.registerInstance(AUTH_PROVIDERS_TOKENS.SDK_COPILOT_AUTH, {});
    c.registerInstance(AUTH_PROVIDERS_TOKENS.SDK_CODEX_AUTH, {});
    return { c, logger };
  }

  it('resolves the draft verifier and its real resolver/proxy graph before optional curator setup', () => {
    const { c } = setup();
    expect(c.resolve(SDK_TOKENS.SDK_PROVIDER_AUTH_RESOLVER)).toBeInstanceOf(
      ProviderAuthResolver,
    );
    expect(
      c.resolve(AUTH_PROVIDERS_TOKENS.SDK_DRAFT_VERIFICATION),
    ).toBeInstanceOf(DraftVerificationService);
  });

  it('resolves the plan-limit services lazily, with agent-sdk tokens registered afterwards', () => {
    const { c } = setup();
    // Hosts run `registerSdkServices` after this library; register the
    // agent-sdk and platform boundaries only now to prove nothing resolved early.
    const registry = { register: jest.fn(() => jest.fn()) };
    c.registerInstance(SDK_TOKENS.SDK_SESSION_PLAN_LIMIT_REGISTRY, registry);
    c.registerInstance(SDK_TOKENS.SDK_SESSION_QUOTA_PROBE, {});
    c.registerInstance(PLATFORM_TOKENS.STATE_STORAGE, {
      get: () => undefined,
      update: async () => undefined,
      keys: () => [],
    });

    const ledger = c.resolve<PlanLimitLedgerService>(
      AUTH_PROVIDERS_TOKENS.PLAN_LIMIT_LEDGER,
    );
    expect(ledger).toBeInstanceOf(PlanLimitLedgerService);
    expect(c.resolve(AUTH_PROVIDERS_TOKENS.PLAN_LIMIT_LEDGER)).toBe(ledger);
    expect(registry.register).toHaveBeenCalledTimes(1);
    expect(
      c.resolve(AUTH_PROVIDERS_TOKENS.PROVIDER_OWNER_RESOLVER),
    ).toBeInstanceOf(ProviderOwnerResolver);
    expect(
      c.resolve(AUTH_PROVIDERS_TOKENS.PLAN_CREDENTIAL_SOURCE),
    ).toBeInstanceOf(PlanCredentialSource);
    const usage = c.resolve(AUTH_PROVIDERS_TOKENS.PLAN_USAGE_SERVICE);
    expect(usage).toBeInstanceOf(PlanUsageService);
    expect(c.resolve(AUTH_PROVIDERS_TOKENS.PLAN_USAGE_SERVICE)).toBe(usage);
    ledger.dispose();
  });

  it('preserves the resolver and proxy singletons when a host registers curator auth again', () => {
    const { c, logger } = setup();
    const resolver = c.resolve(SDK_TOKENS.SDK_PROVIDER_AUTH_RESOLVER);
    const manager = c.resolve(AUTH_PROVIDERS_TOKENS.SDK_CURATOR_PROXY_MANAGER);
    registerCuratorAuthServices(c, logger);
    expect(c.resolve(SDK_TOKENS.SDK_PROVIDER_AUTH_RESOLVER)).toBe(resolver);
    expect(c.resolve(AUTH_PROVIDERS_TOKENS.SDK_CURATOR_PROXY_MANAGER)).toBe(
      manager,
    );
  });
});
