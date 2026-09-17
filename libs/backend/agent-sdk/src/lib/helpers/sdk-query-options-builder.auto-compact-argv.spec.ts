/**
 * Effective compaction settings on the INTERACTIVE path, proven through the
 * real pinned `@anthropic-ai/claude-agent-sdk` (TASK_2026_414 / 411 B8).
 *
 * An assertion against Ptah's options object is not enough: what matters is
 * what the SDK hands the CLI. Each case builds options with the real
 * `SdkQueryOptionsBuilder` and the real `CompactionConfigProvider`, then runs
 * the pinned SDK's `query()` in a child Node process (the SDK is ESM-only)
 * with a FAKE `spawnClaudeCodeProcess` that records `SpawnOptions.args` and
 * the `initialize` control request written to stdin. Nothing is launched.
 */

import 'reflect-metadata';

import { spawnSync } from 'child_process';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';

import type { AISessionConfig, AuthEnv } from '@ptah-extension/shared';
import type { ConfigManager, Logger } from '@ptah-extension/vscode-core';

import { SdkQueryOptionsBuilder } from './sdk-query-options-builder';
import { CompactionConfigProvider } from './compaction-config-provider';

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
    const root = path.join(
      dir,
      'node_modules',
      '@anthropic-ai',
      'claude-agent-sdk',
    );
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
    outputStyleName: 'Explanatory',
  },
];

function makeLogger(): jest.Mocked<Logger> {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as jest.Mocked<Logger>;
}

function makeBuilder(
  values: Record<string, unknown>,
  logger: jest.Mocked<Logger>,
): SdkQueryOptionsBuilder {
  const noopHooks = { createHooks: jest.fn().mockReturnValue({}) };
  const config = {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigManager;
  const ctor = SdkQueryOptionsBuilder as unknown as new (
    ...args: unknown[]
  ) => SdkQueryOptionsBuilder;
  return new ctor(
    logger,
    {
      createCallback: jest.fn().mockReturnValue(() => ({ behavior: 'allow' })),
    },
    noopHooks,
    new CompactionConfigProvider(config, logger),
    noopHooks,
    noopHooks,
    {} as AuthEnv,
    {
      resolveModelId: jest.fn().mockImplementation((m: string) => m),
      hasCachedModels: jest.fn().mockReturnValue(false),
      getSupportedModels: jest.fn(),
    },
    {
      buildBlock: jest.fn().mockResolvedValue(''),
      buildSessionStartBlock: jest.fn().mockResolvedValue(''),
      buildCorpusBlock: jest.fn().mockResolvedValue(''),
    },
    noopHooks,
    noopHooks,
    noopHooks,
    noopHooks,
    noopHooks,
    noopHooks,
    noopHooks,
    noopHooks,
    noopHooks,
    noopHooks,
    noopHooks,
    noopHooks,
  );
}

describe('interactive path — compaction settings on the real SDK argv', () => {
  const MODEL = 'claude-sonnet-4-5';
  const results = new Map<
    CaseName,
    {
      probe: ProbeResult;
      options: Record<string, unknown>;
      logger: jest.Mocked<Logger>;
    }
  >();
  let sdkVersion = '';

  beforeAll(async () => {
    const sdk = findPinnedSdk();
    sdkVersion = sdk.version;
    const built: Array<{
      name: CaseName;
      options: Record<string, unknown>;
      logger: jest.Mocked<Logger>;
    }> = [];
    for (const testCase of CASES) {
      const logger = makeLogger();
      const cfg = await makeBuilder(testCase.values, logger).build({
        userMessageStream: (async function* () {
          // Intentionally empty.
        })(),
        abortController: new AbortController(),
        sessionConfig: {
          model: MODEL,
          projectPath: 'D:/tmp/ws',
          tabId: 'tab-fixture',
          ...(testCase.outputStyleName
            ? { outputStyleName: testCase.outputStyleName }
            : {}),
        } as AISessionConfig,
      });
      built.push({
        name: testCase.name,
        logger,
        options: {
          model: cfg.options.model,
          settings: cfg.options.settings,
          systemPrompt: cfg.options.systemPrompt,
          settingSources: cfg.options.settingSources,
        },
      });
    }
    const probes = runProbe(
      sdk.entry,
      built.map((entry) => entry.options),
    );
    built.forEach((entry, index) => {
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

  /**
   * The keys every interactive session puts on the flag tier, whatever the
   * compaction settings are.
   *
   * `crossSessionInbound: 'accept'` is here rather than in each case because it
   * is not a compaction concern — it is what makes a turn injected by a peer
   * session arrive instead of being held until it expires. It reaching the real
   * argv is the point: the installed `Settings` interface does not model the
   * key, so the value only survives because `buildFlagSettingsArg` serializes
   * the whole tier and the SDK passes a non-object `settings` through to
   * `--settings` untouched.
   */
  const ALWAYS = {
    autoMemoryEnabled: false,
    autoDreamEnabled: false,
    crossSessionInbound: 'accept',
  } as const;

  it('runs against the pinned SDK version', () => {
    expect(sdkVersion).toBe(PINNED_SDK_VERSION);
  });

  it('enabled + unset threshold → no autoCompactWindow and no autoCompactEnabled', () => {
    expect(argvSettings('enabled-unset')).toEqual({ ...ALWAYS });
  });

  it('disabled → autoCompactEnabled false (auto compact off, no window)', () => {
    expect(argvSettings('disabled')).toEqual({
      ...ALWAYS,
      autoCompactEnabled: false,
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
      expect(argvSettings(name)).toEqual({ ...ALWAYS });
      expect(results.get(name)?.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Invalid compaction threshold'),
        expect.anything(),
      );
    },
  );

  it('output style and window coexist on the flag tier', () => {
    expect(argvSettings('style-and-window')).toEqual({
      ...ALWAYS,
      outputStyle: 'Explanatory',
      autoCompactWindow: 400_000,
    });
  });

  it('preserves model, setting sources and the system prompt in every case', () => {
    for (const [name, { probe, options }] of results) {
      const args = probe.args;
      if (!args) throw new Error(`no argv captured for ${name}`);
      expect(flagValue(args, '--model')).toBe(MODEL);
      expect(flagValue(args, '--setting-sources')).toBe(
        (options['settingSources'] as string[]).join(','),
      );
      const init = initializeRequest(probe.stdinText);
      const systemPrompt = options['systemPrompt'];
      if (typeof systemPrompt === 'string') {
        expect(init['systemPrompt']).toBe(systemPrompt);
      } else {
        expect(init['appendSystemPrompt']).toBe(
          (systemPrompt as { append?: string }).append,
        );
      }
    }
  });
});
