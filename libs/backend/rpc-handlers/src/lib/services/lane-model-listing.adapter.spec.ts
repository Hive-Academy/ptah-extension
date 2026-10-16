import 'reflect-metadata';

jest.mock('@ptah-extension/cli-agent-runtime', () => ({
  CLI_AGENT_RUNTIME_TOKENS: {
    SDK_PTAH_CLI_CONFIG_PERSISTENCE: Symbol.for('SdkPtahCliConfigPersistence'),
  },
}));

jest.mock('@ptah-extension/auth-providers', () => ({
  AUTH_PROVIDERS_TOKENS: {
    SDK_PROVIDER_MODELS: Symbol.for('SdkProviderModels'),
    SDK_CODEX_AUTH: Symbol.for('SdkCodexAuth'),
    SDK_COPILOT_AUTH: Symbol.for('SdkCopilotAuth'),
  },
}));

import type {
  AgentListCliModelsResult,
  AgentModelEntry,
  AgentModelProvider,
  CliDetectionResult,
  PtahCliConfig,
} from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import { CliModelListService } from './cli-model-list.service';
import { LaneModelListingAdapter } from './lane-model-listing.adapter';

type FetchResult = {
  models: readonly { readonly id: string }[];
  totalCount: number;
  isStatic: boolean;
};

function emptyListed(): AgentListCliModelsResult {
  return {
    codex: [],
    copilot: [],
    cursor: [],
    antigravity: [],
    opencode: [],
    pi: [],
    grok: [],
  };
}

function emptyClassified(): Record<AgentModelProvider, AgentModelEntry[]> {
  return {
    claude: [],
    codex: [],
    copilot: [],
    cursor: [],
    opencode: [],
  };
}

function cliRow(
  cli: CliDetectionResult['cli'],
  extra: Partial<CliDetectionResult> = {},
): CliDetectionResult {
  return {
    cli,
    installed: true,
    messagingMode: 'none',
    ...extra,
  };
}

function ptahConfig(overrides: Partial<PtahCliConfig> = {}): PtahCliConfig {
  return {
    id: 'cli-1',
    name: 'Lane',
    providerId: 'openrouter',
    enabled: true,
    updatedAt: 1,
    selectedModel: 'chosen',
    tierMappings: { sonnet: 'tier-s', opus: 'tier-o', haiku: 'tier-h' },
    ...overrides,
  };
}

function makeHarness(options?: {
  listed?: AgentListCliModelsResult;
  classified?: Record<AgentModelProvider, AgentModelEntry[]>;
  configs?: PtahCliConfig[];
  apiKey?: string | undefined;
  fetch?: () => Promise<FetchResult>;
}) {
  const listAll = jest.fn(() =>
    Promise.resolve(options?.listed ?? emptyListed()),
  );
  const listForClassification = jest.fn(() =>
    Promise.resolve(options?.classified ?? emptyClassified()),
  );
  const loadConfigs = jest.fn(() => options?.configs ?? []);
  const fetchModels = jest.fn(
    (_providerId: string, _apiKey: string | null, _toolUseOnly?: boolean) =>
      options?.fetch?.() ??
      Promise.resolve({ models: [], totalCount: 0, isStatic: false }),
  );
  const getProviderKey = jest.fn(() => Promise.resolve(options?.apiKey));
  const debug = jest.fn();
  const logger: Pick<Logger, 'debug'> = { debug };
  const cliModels: Pick<
    CliModelListService,
    'listAll' | 'listForClassification'
  > = { listAll, listForClassification };
  const adapter = new LaneModelListingAdapter(
    logger,
    cliModels,
    { loadConfigs },
    { fetchModels },
    { getProviderKey },
  );
  return {
    adapter,
    listAll,
    listForClassification,
    loadConfigs,
    fetchModels,
    getProviderKey,
    debug,
  };
}

describe('LaneModelListingAdapter', () => {
  it('tags a live system-cli id reported and a fallback id fallback', async () => {
    const listed = emptyListed();
    listed.codex = [
      { id: 'gpt-live', name: 'GPT Live' },
      { id: 'gpt-old', name: 'GPT Old' },
    ];
    const classified = emptyClassified();
    classified.codex = [
      { id: 'gpt-live' },
      { id: 'gpt-old', isFallback: true },
    ];
    const { adapter, listAll, listForClassification } = makeHarness({
      listed,
      classified,
    });

    const entries = await adapter.list(
      cliRow('codex'),
      new AbortController().signal,
    );

    expect(listAll).toHaveBeenCalledTimes(1);
    expect(listForClassification).toHaveBeenCalledTimes(1);
    expect(entries).toEqual([
      { id: 'gpt-live', provenance: 'reported' },
      { id: 'gpt-old', provenance: 'fallback' },
    ]);
  });

  it('tags an unclassified curated cli list as reported when isFallback is unset', async () => {
    const listed = emptyListed();
    listed.pi = [{ id: 'pi-model', name: 'Pi' }];
    const { adapter } = makeHarness({ listed });

    await expect(
      adapter.list(cliRow('pi'), new AbortController().signal),
    ).resolves.toEqual([{ id: 'pi-model', provenance: 'reported' }]);
  });

  it('keeps configured, then tier, then live discovery ids without duplicates', async () => {
    const { adapter, fetchModels } = makeHarness({
      configs: [
        ptahConfig({
          tierMappings: { sonnet: 'tier-s', opus: 'chosen', haiku: 'tier-h' },
        }),
      ],
      apiKey: 'sk-test',
      fetch: () =>
        Promise.resolve({
          models: [{ id: 'chosen' }, { id: 'tier-s' }, { id: 'live-new' }],
          totalCount: 3,
          isStatic: false,
        }),
    });

    const entries = await adapter.list(
      cliRow('ptah-cli', { ptahCliId: 'cli-1', providerId: 'openrouter' }),
      new AbortController().signal,
    );

    expect(fetchModels).toHaveBeenCalledWith('openrouter', 'sk-test', false);
    expect(entries).toEqual([
      { id: 'chosen', provenance: 'configured' },
      { id: 'tier-s', provenance: 'tier' },
      { id: 'tier-h', provenance: 'tier' },
      { id: 'live-new', provenance: 'reported' },
    ]);
  });

  it('tags static discovery ids as fallback', async () => {
    const { adapter } = makeHarness({
      configs: [ptahConfig({ selectedModel: 'chosen', tierMappings: {} })],
      apiKey: 'sk-test',
      fetch: () =>
        Promise.resolve({
          models: [{ id: 'static-id' }],
          totalCount: 1,
          isStatic: true,
        }),
    });

    await expect(
      adapter.list(
        cliRow('ptah-cli', { ptahCliId: 'cli-1' }),
        new AbortController().signal,
      ),
    ).resolves.toEqual([
      { id: 'chosen', provenance: 'configured' },
      { id: 'static-id', provenance: 'fallback' },
    ]);
  });

  it('returns configured and tier entries and logs once when discovery throws', async () => {
    const { adapter, debug } = makeHarness({
      configs: [ptahConfig()],
      apiKey: 'sk-test',
      fetch: () => Promise.reject(new Error('network down')),
    });

    const entries = await adapter.list(
      cliRow('ptah-cli', { ptahCliId: 'cli-1', providerId: 'openrouter' }),
      new AbortController().signal,
    );

    expect(entries).toEqual([
      { id: 'chosen', provenance: 'configured' },
      { id: 'tier-s', provenance: 'tier' },
      { id: 'tier-o', provenance: 'tier' },
      { id: 'tier-h', provenance: 'tier' },
    ]);
    expect(debug).toHaveBeenCalledTimes(1);
    expect(debug).toHaveBeenCalledWith(
      '[LaneModelListing] discovery unavailable',
      { ptahCliId: 'cli-1', providerId: 'openrouter', reason: 'threw' },
    );
  });

  it('does not call fetchModels when a purely dynamic provider has no key', async () => {
    const { adapter, fetchModels, debug } = makeHarness({
      configs: [ptahConfig({ providerId: 'openrouter' })],
      apiKey: undefined,
    });

    const entries = await adapter.list(
      cliRow('ptah-cli', { ptahCliId: 'cli-1', providerId: 'openrouter' }),
      new AbortController().signal,
    );

    expect(fetchModels).not.toHaveBeenCalled();
    expect(debug).not.toHaveBeenCalled();
    expect(entries.map((entry) => entry.provenance)).toEqual([
      'configured',
      'tier',
      'tier',
      'tier',
    ]);
  });

  it('still fetches when a provider with a static catalog has no key', async () => {
    const { adapter, fetchModels } = makeHarness({
      configs: [ptahConfig({ providerId: 'moonshot', selectedModel: 'kimi' })],
      apiKey: undefined,
      fetch: () =>
        Promise.resolve({
          models: [{ id: 'kimi-k3' }],
          totalCount: 1,
          isStatic: true,
        }),
    });

    await adapter.list(
      cliRow('ptah-cli', { ptahCliId: 'cli-1', providerId: 'moonshot' }),
      new AbortController().signal,
    );

    expect(fetchModels).toHaveBeenCalledWith('moonshot', null, false);
  });

  it('logs empty and keeps configured and tier entries when discovery returns nothing', async () => {
    const { adapter, debug } = makeHarness({
      configs: [ptahConfig({ tierMappings: { sonnet: 'tier-s' } })],
      apiKey: 'sk-test',
      fetch: () =>
        Promise.resolve({ models: [], totalCount: 0, isStatic: false }),
    });

    await expect(
      adapter.list(
        cliRow('ptah-cli', { ptahCliId: 'cli-1' }),
        new AbortController().signal,
      ),
    ).resolves.toEqual([
      { id: 'chosen', provenance: 'configured' },
      { id: 'tier-s', provenance: 'tier' },
    ]);
    expect(debug).toHaveBeenCalledWith(
      '[LaneModelListing] discovery unavailable',
      expect.objectContaining({ reason: 'empty' }),
    );
  });

  it('shares one in-flight fetch across two rows on the same provider', async () => {
    let release: (result: FetchResult) => void = () => undefined;
    const pending = new Promise<FetchResult>((resolve) => {
      release = resolve;
    });
    const { adapter, fetchModels } = makeHarness({
      configs: [
        ptahConfig({ id: 'cli-1', selectedModel: 'chosen-a' }),
        ptahConfig({
          id: 'cli-2',
          selectedModel: 'chosen-b',
          tierMappings: { haiku: 'tier-b' },
        }),
      ],
      apiKey: 'sk-test',
      fetch: () => pending,
    });
    const signal = new AbortController().signal;

    const first = adapter.list(
      cliRow('ptah-cli', { ptahCliId: 'cli-1', providerId: 'openrouter' }),
      signal,
    );
    const second = adapter.list(
      cliRow('ptah-cli', { ptahCliId: 'cli-2', providerId: 'openrouter' }),
      signal,
    );
    await Promise.resolve();
    expect(fetchModels).toHaveBeenCalledTimes(1);

    release({
      models: [{ id: 'live-new' }],
      totalCount: 1,
      isStatic: false,
    });

    await expect(first).resolves.toEqual([
      { id: 'chosen-a', provenance: 'configured' },
      { id: 'tier-s', provenance: 'tier' },
      { id: 'tier-o', provenance: 'tier' },
      { id: 'tier-h', provenance: 'tier' },
      { id: 'live-new', provenance: 'reported' },
    ]);
    await expect(second).resolves.toEqual([
      { id: 'chosen-b', provenance: 'configured' },
      { id: 'tier-b', provenance: 'tier' },
      { id: 'live-new', provenance: 'reported' },
    ]);
  });

  it('fetches again after the shared discovery promise settles', async () => {
    const { adapter, fetchModels } = makeHarness({
      configs: [ptahConfig()],
      apiKey: 'sk-test',
      fetch: () =>
        Promise.resolve({
          models: [{ id: 'live-new' }],
          totalCount: 1,
          isStatic: false,
        }),
    });
    const row = cliRow('ptah-cli', { ptahCliId: 'cli-1' });
    const signal = new AbortController().signal;

    await adapter.list(row, signal);
    await adapter.list(row, signal);

    expect(fetchModels).toHaveBeenCalledTimes(2);
  });

  it('returns saved entries when discovery never settles and the signal aborts at 2000ms', async () => {
    jest.useFakeTimers();
    try {
      const { adapter, debug } = makeHarness({
        configs: [ptahConfig()],
        apiKey: 'sk-test',
        fetch: () => new Promise<FetchResult>(() => undefined),
        listed: {
          ...emptyListed(),
          codex: [{ id: 'gpt-live', name: 'GPT Live' }],
        },
        classified: {
          ...emptyClassified(),
          codex: [{ id: 'gpt-live' }],
        },
      });
      const ptahController = new AbortController();
      const ptahPending = adapter.list(
        cliRow('ptah-cli', { ptahCliId: 'cli-1', providerId: 'openrouter' }),
        ptahController.signal,
      );
      const cliPending = adapter.list(
        cliRow('codex'),
        new AbortController().signal,
      );
      await Promise.resolve();
      setTimeout(() => ptahController.abort(), 2000);
      jest.advanceTimersByTime(2000);

      await expect(ptahPending).resolves.toEqual([
        { id: 'chosen', provenance: 'configured' },
        { id: 'tier-s', provenance: 'tier' },
        { id: 'tier-o', provenance: 'tier' },
        { id: 'tier-h', provenance: 'tier' },
      ]);
      await expect(cliPending).resolves.toEqual([
        { id: 'gpt-live', provenance: 'reported' },
      ]);
      expect(debug).toHaveBeenCalledTimes(1);
      expect(debug).toHaveBeenCalledWith(
        '[LaneModelListing] discovery unavailable',
        expect.objectContaining({
          ptahCliId: 'cli-1',
          providerId: 'openrouter',
          reason: 'aborted',
        }),
      );
    } finally {
      jest.useRealTimers();
    }
  });
});
