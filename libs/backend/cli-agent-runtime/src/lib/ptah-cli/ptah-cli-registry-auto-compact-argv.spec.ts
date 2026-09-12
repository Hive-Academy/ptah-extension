/**
 * Effective compaction settings on the PTAH-CLI spawn path, proven through the
 * real pinned `@anthropic-ai/claude-agent-sdk` (TASK_2026_414 / 411 B8).
 *
 * `PtahCliRegistry.spawnAgent` builds the options with the REAL
 * `PtahCliSpawnOptions` and the REAL `CompactionConfigProvider`; the captured
 * options are then handed to the pinned SDK's `query()` in a child Node
 * process (the SDK is ESM-only) with a FAKE `spawnClaudeCodeProcess` that
 * records argv and the `initialize` request. Nothing is launched.
 *
 * This path used to send `compactionControl`, which is not an SDK option and
 * was silently ignored.
 */

import 'reflect-metadata';

import { spawnSync } from 'child_process';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';

import { createMockLogger } from '@ptah-extension/shared/testing';
import type {
  ConfigManager,
  IAuthSecretsService,
  Logger,
} from '@ptah-extension/vscode-core';
import type {
  Options,
  SdkMessageTransformer,
  SdkModuleLoader,
  SdkPermissionHandler,
} from '@ptah-extension/agent-sdk';
import { CompactionConfigProvider } from '@ptah-extension/agent-sdk';
import type { ProviderModelsService } from '@ptah-extension/auth-providers';
import type { PtahCliConfig } from '@ptah-extension/shared';
import type { SpawnedProcess } from '@anthropic-ai/claude-agent-sdk';

// The `agent-generation` barrel reaches tree-sitter's `import.meta.url`, which
// this Jest transform cannot parse. Only the DI token is needed.
jest.mock('@ptah-extension/agent-generation', () => ({
  AGENT_GENERATION_TOKENS: {
    ENHANCED_PROMPTS_SERVICE: Symbol.for('EnhancedPromptsService'),
  },
}));

jest.mock('@ptah-extension/agent-sdk', () => {
  const actual = jest.requireActual('@ptah-extension/agent-sdk');
  return {
    ...actual,
    getAnthropicProvider: jest.fn(() => ({
      id: 'moonshot',
      name: 'Moonshot (Kimi)',
      baseUrl: 'https://api.moonshot.ai/anthropic/',
      authEnvVar: 'ANTHROPIC_AUTH_TOKEN',
      keyPrefix: '',
      helpUrl: '',
      description: '',
      keyPlaceholder: '',
      maskedKeyDisplay: '',
      staticModels: [{ id: 'kimi-k2', name: 'Kimi K2' }],
      defaultTiers: {
        sonnet: 'kimi-tier-sonnet',
        opus: 'kimi-tier-opus',
        haiku: 'kimi-tier-haiku',
      },
    })),
    getProviderAuthEnvVar: jest.fn(() => 'ANTHROPIC_AUTH_TOKEN'),
    seedStaticModelPricing: jest.fn(),
    buildSafeEnv: jest.fn((env: unknown) => env),
  };
});

import { PtahCliRegistry } from './ptah-cli-registry';
import { PtahCliSpawnOptions } from './helpers/ptah-cli-spawn-options.service';
import type { ISdkProcessSpawner } from '../spawn/sdk-process-spawner.port';

const PINNED_SDK_VERSION = '0.3.150';

// The probe payload (system prompts across 7 cases routinely exceed 100 KB
// combined) is read from stdin, never argv or env — both are capped by the
// OS (Linux MAX_ARG_STRLEN is 131072 bytes per string; spawnSync fails with
// E2BIG once argv+environ crosses ARG_MAX). See assertWithinArgLimit below.
const PROBE_SCRIPT = `
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const { sdkUrl, runs } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
const { query } = await import(sdkUrl);
const { PassThrough } = await import('node:stream');
const { EventEmitter } = await import('node:events');
const results = [];
for (const options of runs) {
  let captured = null;
  let stdinText = '';
  const q = query({ prompt: 'probe', options: { ...options, cwd: process.cwd(), pathToClaudeCodeExecutable: process.execPath, spawnClaudeCodeProcess: (spawnOptions) => {
    captured = { args: spawnOptions.args };
    const stdin = new PassThrough();
    stdin.on('data', (chunk) => { stdinText += String(chunk); });
    const stdout = new PassThrough();
    const events = new EventEmitter();
    return { stdin, stdout, killed: false, exitCode: null, kill: () => true, on: events.on.bind(events), once: events.once.bind(events), off: events.off.bind(events) };
  } } });
  q[Symbol.asyncIterator]().next().catch(() => undefined);
  const deadline = Date.now() + 10000;
  while ((!captured || !stdinText.includes('"initialize"')) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  results.push({ args: captured ? captured.args : null, stdinText });
}
// Exit only once the payload has actually left the process. stdout is a PIPE
// here, so process.stdout.write() buffers and an immediate process.exit(0)
// truncates a large JSON result — the parent then fails at JSON.parse.
process.stdout.write(JSON.stringify(results), () => process.exit(0));
`;

interface ProbeResult {
  readonly args: string[] | null;
  readonly stdinText: string;
}

function findPinnedSdk(): { entry: string; version: string } {
  let dir = __dirname;
  for (;;) {
    const root = path.join(dir, 'node_modules', '@anthropic-ai', 'claude-agent-sdk');
    const entry = path.join(root, 'sdk.mjs');
    if (existsSync(entry)) {
      const pkg = JSON.parse(
        readFileSync(path.join(root, 'package.json'), 'utf8'),
      ) as { version: string };
      return { entry, version: pkg.version };
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error('@anthropic-ai/claude-agent-sdk is not installed');
    }
    dir = parent;
  }
}

// Linux caps a single argv/env string at MAX_ARG_STRLEN (131072 bytes) and
// the whole argv+environ block at ARG_MAX; exceeding either fails spawnSync
// with E2BIG (`child.status === null`, `child.error.code === 'E2BIG'`).
// Windows enforces no such limit, so a regression here passes locally and
// only fails in CI. Guarding argv/env directly — rather than only moving the
// known-large payload off them — makes a future regression fail everywhere.
const MAX_ARG_BYTES = 100_000;

function assertWithinArgLimit(label: string, value: string): void {
  const bytes = Buffer.byteLength(value, 'utf8');
  if (bytes >= MAX_ARG_BYTES) {
    throw new Error(
      `${label} is ${bytes} bytes, at/over the ${MAX_ARG_BYTES}-byte guard ` +
        '(Linux argv/env strings are capped at 131072 bytes and spawnSync ' +
        'fails with E2BIG well before that on the full argv+env block). ' +
        'Send this payload over stdin or a temp file instead.',
    );
  }
}

function runProbe(
  sdkEntry: string,
  runs: ReadonlyArray<Record<string, unknown>>,
): ProbeResult[] {
  const scriptPath = path.join(
    os.tmpdir(),
    `ptah-sdk-argv-probe-${process.pid}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}.mjs`,
  );
  writeFileSync(scriptPath, PROBE_SCRIPT, 'utf8');
  try {
    const args = [scriptPath];
    for (const arg of args) assertWithinArgLimit(`argv "${arg}"`, arg);
    for (const [key, value] of Object.entries(process.env)) {
      if (typeof value === 'string') {
        assertWithinArgLimit(`env[${key}]`, value);
      }
    }
    const payload = JSON.stringify({
      sdkUrl: pathToFileURL(sdkEntry).href,
      runs,
    });
    const child = spawnSync(process.execPath, args, {
      encoding: 'utf8',
      timeout: 120_000,
      input: payload,
      env: process.env,
    });
    if (child.status !== 0) {
      throw new Error(
        `SDK probe failed (${child.status}): ${child.stderr || child.error}`,
      );
    }
    return JSON.parse(child.stdout) as ProbeResult[];
  } finally {
    try {
      unlinkSync(scriptPath);
    } catch {
      // best-effort cleanup; a leftover temp file is not worth failing the test over
    }
  }
}

function flagValue(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index >= 0) return args[index + 1];
  const joined = args.find((arg) => arg.startsWith(`${flag}=`));
  return joined?.slice(flag.length + 1);
}

function settingsFromArgv(args: readonly string[]): Record<string, unknown> {
  const raw = flagValue(args, '--settings');
  if (raw === undefined) throw new Error('no --settings on argv');
  return JSON.parse(raw) as Record<string, unknown>;
}

function initializeRequest(stdinText: string): Record<string, unknown> {
  for (const line of stdinText.split('\n')) {
    if (!line.trim()) continue;
    const message = JSON.parse(line) as {
      type?: string;
      request?: Record<string, unknown>;
    };
    if (
      message.type === 'control_request' &&
      message.request?.['subtype'] === 'initialize'
    ) {
      return message.request;
    }
  }
  throw new Error('no initialize request was written');
}

const BASE_CONFIG: PtahCliConfig = {
  id: 'pc-auto-compact-001',
  name: 'Auto Compact Agent',
  providerId: 'moonshot',
  enabled: true,
  tierMappings: undefined,
  updatedAt: 0,
};

async function* emptyStream(): AsyncGenerator<never, void, unknown> {
  // No messages — the stream loop resolves with exit code 0.
}

async function captureSpawnOptions(
  values: Record<string, unknown>,
  outputStyleName: string | undefined,
): Promise<{
  options: Options;
  logger: ReturnType<typeof createMockLogger>;
}> {
  const logger = createMockLogger();
  let captured: Options | undefined;
  const queryFn = jest.fn((args: { options?: Options }) => {
    captured = args.options;
    return emptyStream();
  });
  const config = {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigManager;
  const compactionConfigProvider = new CompactionConfigProvider(
    config,
    logger as unknown as Logger,
  );
  const spawnOptions = new PtahCliSpawnOptions(
    logger as unknown as Logger,
    { createHooks: jest.fn().mockReturnValue({}) } as never,
    { createHooks: jest.fn().mockReturnValue({}) } as never,
    compactionConfigProvider,
    {
      getProjectGuidanceContent: jest.fn().mockResolvedValue(undefined),
    } as never,
    undefined,
    {
      resolveSessionFields: jest
        .fn()
        .mockResolvedValue(outputStyleName ? { outputStyleName } : {}),
    } as never,
  );
  const dummyProcess: SpawnedProcess = {
    stdin: {} as never,
    stdout: {} as never,
    killed: false,
    exitCode: null,
    kill: jest.fn().mockReturnValue(true),
    on: jest.fn(),
    once: jest.fn(),
    off: jest.fn(),
  };
  const spawner: ISdkProcessSpawner = {
    spawn: jest.fn().mockReturnValue(dummyProcess),
  };
  const registry = new PtahCliRegistry(
    logger as unknown as Logger,
    {
      getProviderKey: jest.fn().mockResolvedValue('sk-test-key'),
    } as unknown as IAuthSecretsService,
    {
      getQueryFunction: jest.fn().mockResolvedValue(queryFn),
      getCliJsPath: jest.fn().mockResolvedValue(undefined),
    } as unknown as SdkModuleLoader,
    {
      createIsolated: jest.fn().mockReturnValue({
        transform: jest.fn().mockReturnValue([]),
      }),
    } as unknown as SdkMessageTransformer,
    {
      getPermissionLevel: jest.fn().mockReturnValue('yolo'),
      createCallback: jest.fn(),
    } as unknown as SdkPermissionHandler,
    null as never, // subagentHookHandler
    null as never, // compactionHookHandler
    compactionConfigProvider,
    {
      getModelTiers: jest
        .fn()
        .mockReturnValue({ sonnet: null, opus: null, haiku: null }),
    } as unknown as ProviderModelsService,
    { loadConfigs: jest.fn().mockReturnValue([BASE_CONFIG]) } as never,
    spawnOptions,
    null as never, // modelResolver
    { get: jest.fn(() => undefined) } as unknown as never, // configManager
    spawner,
  );
  await registry.spawnAgent(BASE_CONFIG.id, 'do work');
  if (!captured) throw new Error('spawnAgent did not call query()');
  return { options: captured, logger };
}

type CaseName =
  | 'enabled-unset'
  | 'disabled'
  | 'min'
  | 'max'
  | 'invalid-low'
  | 'invalid-high'
  | 'style-and-window';

const CASES: ReadonlyArray<{
  readonly name: CaseName;
  readonly values: Record<string, unknown>;
  readonly outputStyleName?: string;
}> = [
  { name: 'enabled-unset', values: {} },
  {
    name: 'disabled',
    values: { 'compaction.enabled': false, 'compaction.threshold': 300_000 },
  },
  { name: 'min', values: { 'compaction.threshold': 100_000 } },
  { name: 'max', values: { 'compaction.threshold': 1_000_000 } },
  { name: 'invalid-low', values: { 'compaction.threshold': 50_000 } },
  { name: 'invalid-high', values: { 'compaction.threshold': 1_000_001 } },
  {
    name: 'style-and-window',
    values: { 'compaction.threshold': 400_000 },
    outputStyleName: 'Terse',
  },
];

describe('ptah-cli spawn path — compaction settings on the real SDK argv', () => {
  const results = new Map<
    CaseName,
    {
      probe: ProbeResult;
      options: Options;
      logger: ReturnType<typeof createMockLogger>;
    }
  >();
  let sdkVersion = '';

  beforeAll(async () => {
    const sdk = findPinnedSdk();
    sdkVersion = sdk.version;
    const captured: Array<{
      name: CaseName;
      options: Options;
      logger: ReturnType<typeof createMockLogger>;
    }> = [];
    for (const testCase of CASES) {
      const { options, logger } = await captureSpawnOptions(
        testCase.values,
        testCase.outputStyleName,
      );
      captured.push({ name: testCase.name, options, logger });
    }
    const probes = runProbe(
      sdk.entry,
      captured.map(({ options }) => ({
        model: options.model,
        settings: options.settings,
        systemPrompt: options.systemPrompt,
        settingSources: options.settingSources,
      })),
    );
    captured.forEach((entry, index) => {
      results.set(entry.name, {
        probe: probes[index],
        options: entry.options,
        logger: entry.logger,
      });
    });
  }, 180_000);

  function argvSettings(name: CaseName): Record<string, unknown> {
    const args = results.get(name)?.probe.args;
    if (!args) throw new Error(`no argv captured for ${name}`);
    return settingsFromArgv(args);
  }

  it('runs against the pinned SDK version', () => {
    expect(sdkVersion).toBe(PINNED_SDK_VERSION);
  });

  it('no longer sends the non-existent compactionControl option', () => {
    for (const { options } of results.values()) {
      expect('compactionControl' in options).toBe(false);
    }
  });

  it('enabled + unset threshold → no autoCompactWindow and no autoCompactEnabled', () => {
    expect(argvSettings('enabled-unset')).toEqual({
      autoMemoryEnabled: false,
      autoDreamEnabled: false,
      // TASK_2026_402: the spawn path now asks the CLI to ACCEPT a turn
      // injected by a peer session instead of holding it until it expires.
      crossSessionInbound: 'accept',
    });
  });

  it('disabled → autoCompactEnabled false (auto compact off, no window)', () => {
    expect(argvSettings('disabled')).toEqual({
      autoMemoryEnabled: false,
      autoDreamEnabled: false,
      autoCompactEnabled: false,
      crossSessionInbound: 'accept',
    });
  });

  it('min threshold → autoCompactWindow 100000 on argv', () => {
    expect(argvSettings('min')).toMatchObject({ autoCompactWindow: 100_000 });
  });

  it('max threshold → autoCompactWindow 1000000 on argv', () => {
    expect(argvSettings('max')).toMatchObject({
      autoCompactWindow: 1_000_000,
    });
  });

  it.each(['invalid-low', 'invalid-high'] as const)(
    'invalid persisted threshold (%s) → warn + treated as unset',
    (name) => {
      expect(argvSettings(name)).toEqual({
        autoMemoryEnabled: false,
        autoDreamEnabled: false,
        crossSessionInbound: 'accept',
      });
      expect(results.get(name)?.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Invalid compaction threshold'),
        expect.anything(),
      );
    },
  );

  it('output style and window coexist on the flag tier', () => {
    expect(argvSettings('style-and-window')).toEqual({
      autoMemoryEnabled: false,
      autoDreamEnabled: false,
      outputStyle: 'Terse',
      autoCompactWindow: 400_000,
      crossSessionInbound: 'accept',
    });
  });

  it('preserves model, setting sources and the system prompt in every case', () => {
    for (const [name, { probe, options }] of results) {
      const args = probe.args;
      if (!args) throw new Error(`no argv captured for ${name}`);
      expect(flagValue(args, '--model')).toBe(options.model);
      expect(flagValue(args, '--setting-sources')).toBe(
        (options.settingSources ?? []).join(','),
      );
      const init = initializeRequest(probe.stdinText);
      const systemPrompt = options.systemPrompt;
      if (typeof systemPrompt === 'string') {
        expect(init['systemPrompt']).toBe(systemPrompt);
      } else if (systemPrompt && 'append' in systemPrompt) {
        expect(init['appendSystemPrompt']).toBe(systemPrompt.append);
      }
    }
  });
});
