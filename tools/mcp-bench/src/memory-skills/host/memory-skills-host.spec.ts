import 'reflect-metadata';

jest.mock('vscode', () => ({}), { virtual: true });

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import * as netModule from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MEMORY_CONTRACT_TOKENS } from '@ptah-extension/memory-contracts';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import type { ProviderHealth } from '@ptah-extension/shared';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import { container as rootContainer, type DependencyContainer } from 'tsyringe';

/** Same symbol as `SKILL_SYNTHESIS_TOKENS.LANE_RUNNER_SERVICE`. */
const LANE_RUNNER_SERVICE = Symbol.for('PtahSkillLaneRunnerService');

import type {
  BenchHostHandle,
  BootCodeExecutionHostOptions,
  IsolatedPaths,
} from '../../transport/bench-host-boot';
import type {
  NetAttempt,
  NetRecorderHandle,
  NetRecorderOptions,
} from '../runner/net-recorder';
import { RecordedCuratorLlm } from '../doubles/recorded-curator-llm';
import { startNetRecorder } from '../runner/net-recorder';
import { MODEL_DISPATCH_PROVENANCE_TAP } from '../recorder/provider-provenance';
import { canonicalProductSettingsSha256 } from '../runner/runner-plan';
import {
  HOST_COMPLETION_FILE,
  HOST_ERROR_FILE,
  HOST_LOG_FILE,
  retainHostLog,
  runMemorySkillsHost,
  type HostCompletion,
  type MemorySkillsHostDeps,
  type MemorySkillsHostSuite,
  type MemorySkillsHostSuiteContext,
} from './memory-skills-host';
import {
  CODEX_AUTH_SOURCE_ENV,
  ISOLATED_FILE_SETTINGS_FILE,
  ISOLATED_PRODUCT_CONFIG_FILE,
  RECORDING_DEADLINE_ENV,
  UNREACHABLE_OAUTH_TOKEN_ENDPOINT,
} from './recording-bootstrap';
import {
  MEMORY_SKILLS_PLAN_ENV,
  MEMORY_SKILLS_PLAN_SCHEMA_ID,
  MemorySkillsPlanError,
} from './plan.schema';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('runMemorySkillsHost', () => {
  let root: string;
  let bench: string;
  let runDir: string;
  let planPath: string;
  let workspace: string;
  let isolation: IsolatedPaths;
  let events: string[];
  let wire: Record<string, unknown>[];
  let stop: jest.Mock;
  let shutdown: Deferred<string>;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ptah-620-host-'));
    bench = join(root, 'bench');
    runDir = join(bench, 'runs', 'r1');
    mkdirSync(runDir, { recursive: true });
    planPath = join(runDir, 'plan.json');
    workspace = join(root, 'workspace');
    mkdirSync(workspace);
    const home = join(root, 'iso');
    mkdirSync(join(home, '.ptah', 'state'), { recursive: true });
    isolation = {
      home,
      userDataPath: join(home, '.ptah'),
      dbPath: join(home, '.ptah', 'state', 'ptah.sqlite'),
    };
    events = [];
    wire = [];
    stop = jest.fn(async () => {
      events.push('stop');
    });
    shutdown = deferred<string>();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writePlan(overrides: Record<string, unknown> = {}): void {
    writeFileSync(
      planPath,
      JSON.stringify({
        schemaId: MEMORY_SKILLS_PLAN_SCHEMA_ID,
        runId: 'r1',
        benchDataDir: bench,
        runDir,
        realHome: join(root, 'real-home'),
        cassetteMode: 'replay',
        ci: false,
        cassettes: {
          curator: { path: join(bench, 'curator.jsonl'), model: 'm' },
          laneRunner: { path: join(bench, 'lane.jsonl'), model: 'm' },
        },
        fixtures: [],
        suites: [],
        ...overrides,
      }),
    );
  }

  /** Mirrors bootCodeExecutionHost's hook order without an engine. */
  function fakeBoot(
    options: BootCodeExecutionHostOptions,
  ): Promise<BenchHostHandle> {
    return (async () => {
      events.push('boot');
      await options.beforeEngineBoot?.({
        workspace: options.workspace,
        isolation,
      });
      events.push('engine');
      const container = rootContainer.createChildContainer();
      await options.afterContainerReady?.(container, {
        workspaceRoot: options.workspace,
        isolation,
      });
      events.push('mcp');
      return {
        port: 4321,
        workspaceRoot: options.workspace,
        isolation,
        container,
        stop,
      };
    })();
  }

  class MemorySettings {
    readonly written = new Map<string, unknown>();
    constructor(private readonly readBack?: (key: string) => unknown) {}
    async setConfiguration(
      section: string,
      key: string,
      value: unknown,
    ): Promise<void> {
      this.written.set(`${section}.${key}`, value);
    }
    getConfiguration<T>(section: string, key: string, fallback?: T): T {
      const name = `${section}.${key}`;
      if (this.readBack) return this.readBack(name) as T;
      return (this.written.has(name) ? this.written.get(name) : fallback) as T;
    }
  }

  function registerSdkAdapter(
    container: DependencyContainer,
    sdkHealth: () => ProviderHealth = () => ({
      status: 'available',
      lastCheck: 0,
    }),
    sdkInitialize: () => Promise<boolean> = async () => true,
  ): void {
    container.register(SDK_TOKENS.SDK_AGENT_ADAPTER, {
      useValue: { getHealth: sdkHealth, initialize: sdkInitialize },
    });
  }

  function bootWith(
    settings: MemorySettings,
    registerProviders: boolean,
    sdkHealth: () => ProviderHealth = () => ({
      status: 'available',
      lastCheck: 0,
    }),
    sdkInitialize: () => Promise<boolean> = async () => true,
  ): MemorySkillsHostDeps['boot'] {
    return async (options) => {
      events.push('boot');
      await options.beforeEngineBoot?.({
        workspace: options.workspace,
        isolation,
      });
      events.push('engine');
      const container = rootContainer.createChildContainer();
      container.register(PLATFORM_TOKENS.WORKSPACE_PROVIDER, {
        useValue: settings,
      });
      registerSdkAdapter(container, sdkHealth, sdkInitialize);
      if (registerProviders) {
        container.register(MEMORY_CONTRACT_TOKENS.CURATOR_LLM, {
          useValue: {},
        });
        container.register(LANE_RUNNER_SERVICE, { useValue: {} });
      }
      await options.afterContainerReady?.(container, {
        workspaceRoot: options.workspace,
        isolation,
      });
      events.push('mcp');
      return {
        port: 4321,
        workspaceRoot: options.workspace,
        isolation,
        container,
        stop,
      };
    };
  }

  function deps(
    overrides: Partial<MemorySkillsHostDeps> = {},
  ): MemorySkillsHostDeps {
    return {
      assertIsolated: () => {
        events.push('isolation');
        return isolation;
      },
      readWorkspace: () => {
        events.push('workspace');
        return workspace;
      },
      env: { [MEMORY_SKILLS_PLAN_ENV]: planPath },
      boot: fakeBoot,
      suites: [],
      shutdownRequested: shutdown.promise,
      startNetRecorder: () => {
        throw new Error('no recorder outside CI');
      },
      writeWire: (message) => {
        wire.push(message);
        events.push(`wire:${String(message['benchHost'])}`);
        if (message['benchHost'] === 'complete') {
          // The completion is on disk before the host waits for EOF.
          events.push(
            existsSync(join(runDir, HOST_COMPLETION_FILE))
              ? 'completion-on-disk'
              : 'completion-missing',
          );
          shutdown.resolve('stdin-eof');
        }
      },
      homedir: () => isolation.home,
      now: () => 0,
      ...overrides,
    };
  }

  function completion(): HostCompletion {
    return JSON.parse(
      readFileSync(join(runDir, HOST_COMPLETION_FILE), 'utf8'),
    ) as HostCompletion;
  }

  it('runs an empty plan: isolation first, ready, completion on disk, then stop', async () => {
    writePlan();
    const result = await runMemorySkillsHost(deps());

    expect(events).toEqual([
      'isolation',
      'workspace',
      'boot',
      'engine',
      'mcp',
      'wire:ready',
      'wire:complete',
      'completion-on-disk',
      'stop',
    ]);
    expect(wire[0]).toEqual({
      benchHost: 'ready',
      port: 4321,
      workspaceRoot: workspace,
      homedir: isolation.home,
      userDataPath: isolation.userDataPath,
      dbPath: isolation.dbPath,
    });
    expect(wire[1]).toEqual({
      benchHost: 'complete',
      runId: 'r1',
      status: 'complete',
      completionFile: join(runDir, HOST_COMPLETION_FILE),
    });
    expect(result.shutdownReason).toBe('stdin-eof');
    expect(completion()).toEqual({
      schemaId: '620.host-completion.v1',
      runId: 'r1',
      cassetteMode: 'replay',
      ci: false,
      status: 'complete',
      seeded: [],
      suites: [],
      net: null,
    });
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('refuses before anything else when the isolation check throws', async () => {
    writePlan();
    const boot = jest.fn();
    const readWorkspace = jest.fn();
    await expect(
      runMemorySkillsHost(
        deps({
          assertIsolated: () => {
            throw new Error('not isolated');
          },
          readWorkspace,
          boot,
        }),
      ),
    ).rejects.toThrow('not isolated');
    expect(readWorkspace).not.toHaveBeenCalled();
    expect(boot).not.toHaveBeenCalled();
    expect(wire).toEqual([]);
  });

  it('refuses a plan naming an unregistered suite before boot', async () => {
    writePlan({ suites: [{ id: 'mem.unknown' }] });
    const boot = jest.fn();
    await expect(runMemorySkillsHost(deps({ boot }))).rejects.toThrow(
      'the plan names suites this host does not have: mem.unknown',
    );
    expect(boot).not.toHaveBeenCalled();
  });

  it('refuses before boot a plan that breaks a registered placement', async () => {
    const run = jest.fn(async () => undefined);
    const suites: MemorySkillsHostSuite[] = [
      { id: 'a', run },
      { id: 'fresh', placement: 'first', run },
      { id: 'rewrite', placement: 'last', run },
    ];
    const boot = jest.fn();
    writePlan({ suites: [{ id: 'rewrite' }, { id: 'a' }] });
    await expect(runMemorySkillsHost(deps({ suites, boot }))).rejects.toThrow(
      'the plan orders host suites unsafely: suite a must run before rewrite',
    );
    writePlan({ suites: [{ id: 'a' }, { id: 'fresh' }] });
    await expect(runMemorySkillsHost(deps({ suites, boot }))).rejects.toThrow(
      'suite fresh must be the first host suite',
    );
    expect(boot).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('refuses a host with two suites under one id', async () => {
    writePlan();
    const suite: MemorySkillsHostSuite = {
      id: 's',
      run: async () => undefined,
    };
    await expect(
      runMemorySkillsHost(deps({ suites: [suite, suite] })),
    ).rejects.toBeInstanceOf(MemorySkillsPlanError);
  });

  it('seeds fixtures before the engine and installs the doubles before MCP', async () => {
    mkdirSync(join(bench, 'snapshots'));
    writeFileSync(join(bench, 'snapshots', 'seed.sqlite'), 'DB');
    writePlan({
      fixtures: [
        { kind: 'database', source: join(bench, 'snapshots', 'seed.sqlite') },
      ],
      suites: [{ id: 'probe', options: { n: 1 } }],
    });
    let seen: MemorySkillsHostSuiteContext | undefined;
    const probe: MemorySkillsHostSuite = {
      id: 'probe',
      run: async (context) => {
        seen = context;
        expect(readFileSync(isolation.dbPath, 'utf8')).toBe('DB');
      },
    };
    await runMemorySkillsHost(deps({ suites: [probe] }));

    expect(seen?.options).toEqual({ n: 1 });
    expect(seen?.runDir).toBe(runDir);
    expect(seen?.doubles.curator).toBeInstanceOf(RecordedCuratorLlm);
    expect(seen?.container.resolve(MEMORY_CONTRACT_TOKENS.CURATOR_LLM)).toBe(
      seen?.doubles.curator,
    );
    expect(completion().seeded).toEqual([
      expect.objectContaining({
        kind: 'database',
        target: isolation.dbPath,
        files: 1,
      }),
    ]);
  });

  it('records a throwing suite as error and still runs the next one', async () => {
    writePlan({ suites: [{ id: 'a' }, { id: 'b' }] });
    const ran: string[] = [];
    await runMemorySkillsHost(
      deps({
        suites: [
          {
            id: 'a',
            run: async () => {
              ran.push('a');
              throw new Error('suite a broke');
            },
          },
          { id: 'b', run: async () => void ran.push('b') },
        ],
      }),
    );
    expect(ran).toEqual(['a', 'b']);
    expect(completion().suites).toEqual([
      { id: 'a', status: 'error', durationMs: 0, error: 'suite a broke' },
      { id: 'b', status: 'completed', durationMs: 0 },
    ]);
  });

  it('skips the remaining suites once shutdown is requested', async () => {
    writePlan({ suites: [{ id: 'a' }, { id: 'b' }] });
    await runMemorySkillsHost(
      deps({
        suites: [
          {
            id: 'a',
            run: async () => {
              shutdown.resolve('SIGTERM');
              await Promise.resolve();
            },
          },
          { id: 'b', run: async () => fail('b must not run') },
        ],
      }),
    );
    expect(completion().suites).toEqual([
      { id: 'a', status: 'completed', durationMs: 0 },
      { id: 'b', status: 'skipped', reason: 'shutdown-requested' },
    ]);
  });

  it('CI: runs suites under the net recorder and flags recorded attempts', async () => {
    writePlan({ ci: true, suites: [{ id: 'a' }] });
    const attempt: NetAttempt = {
      kind: 'tcp-connect',
      tag: 'memory-skills-host',
      detail: '{"host":"api.example.com","port":443}',
    };
    const started: NetRecorderOptions[] = [];
    const recorderStop = jest.fn(() => {
      events.push('recorder-stop');
      return [attempt];
    });
    const startNetRecorder = (
      options: NetRecorderOptions,
    ): NetRecorderHandle => {
      started.push(options);
      events.push('recorder-start');
      return {
        logFile: options.logFile ?? '',
        stop: recorderStop,
      } as unknown as NetRecorderHandle;
    };
    await runMemorySkillsHost(
      deps({
        startNetRecorder,
        suites: [{ id: 'a', run: async () => void events.push('suite-a') }],
      }),
    );
    expect(started).toEqual([
      expect.objectContaining({ logFile: join(runDir, 'net-recorder.log') }),
    ]);
    expect(events.indexOf('recorder-start')).toBeLessThan(
      events.indexOf('suite-a'),
    );
    expect(events.indexOf('recorder-stop')).toBeLessThan(
      events.indexOf('wire:complete'),
    );
    expect(completion()).toMatchObject({
      status: 'net-violation',
      net: { logFile: join(runDir, 'net-recorder.log'), attempts: [attempt] },
    });
    expect(wire[1]).toMatchObject({ status: 'net-violation' });
  });

  it('CI: the real net recorder installs and restores around the suites', async () => {
    writePlan({ ci: true, suites: [{ id: 'a' }] });
    const connect = netModule.Socket.prototype.connect;
    let patchedDuringSuite = false;
    await runMemorySkillsHost(
      deps({
        startNetRecorder,
        suites: [
          {
            id: 'a',
            run: async () => {
              patchedDuringSuite =
                netModule.Socket.prototype.connect !== connect;
            },
          },
        ],
      }),
    );
    expect(patchedDuringSuite).toBe(true);
    expect(netModule.Socket.prototype.connect).toBe(connect);
    expect(completion()).toMatchObject({
      status: 'complete',
      suites: [{ id: 'a', status: 'completed' }],
      net: { logFile: join(runDir, 'net-recorder.log'), attempts: [] },
    });
  });

  it('refuses a run directory that already holds a completed run', async () => {
    writePlan();
    writeFileSync(join(runDir, HOST_COMPLETION_FILE), '{}');
    await expect(runMemorySkillsHost(deps())).rejects.toThrow(
      /already holds a completed run/,
    );
    expect(events).not.toContain('engine');
  });

  it('stops the host and fails when the boot skipped afterContainerReady', async () => {
    writePlan();
    const boot = async (): Promise<BenchHostHandle> => ({
      port: 1,
      workspaceRoot: workspace,
      isolation,
      container: rootContainer.createChildContainer(),
      stop,
    });
    await expect(runMemorySkillsHost(deps({ boot }))).rejects.toThrow(
      'the record/replay doubles were not installed before MCP started',
    );
    expect(stop).toHaveBeenCalledTimes(1);
    expect(wire).toEqual([]);
  });

  it('writes product settings and fails when the read-back differs', async () => {
    writePlan({
      settings: { 'memory.curatorProvider': 'openai-codex', turns: 3 },
    });
    const settings = new MemorySettings(() => 'other');
    await expect(
      runMemorySkillsHost(deps({ boot: bootWith(settings, false) })),
    ).rejects.toThrow(
      'product setting memory.curatorProvider read back a different value',
    );
    expect(existsSync(join(runDir, HOST_COMPLETION_FILE))).toBe(false);
    expect(
      settings.written.get('ptah.provider.openai-codex.oauthTokenEndpoint'),
    ).toBeUndefined();
  });

  it('does not set the codex token endpoint in replay', async () => {
    writePlan({
      settings: {
        'memory.curatorProvider': 'openai-codex',
        'memory.curatorModel': 'gpt-5.6-terra',
      },
    });
    const settings = new MemorySettings();
    await runMemorySkillsHost(deps({ boot: bootWith(settings, false) }));
    expect(
      settings.written.get('ptah.provider.openai-codex.oauthTokenEndpoint'),
    ).toBeUndefined();
    expect(settings.written.get('ptah.memory.curatorProvider')).toBe(
      'openai-codex',
    );
    expect(completion().settings).toEqual({
      names: ['memory.curatorModel', 'memory.curatorProvider'],
      sha256: canonicalProductSettingsSha256({
        'memory.curatorProvider': 'openai-codex',
        'memory.curatorModel': 'gpt-5.6-terra',
      }),
    });
  });

  describe('record-mode SDK readiness', () => {
    function health(status: ProviderHealth['status']): ProviderHealth {
      return { status, lastCheck: 0 };
    }

    it('initializes the SDK once and runs after it becomes available', async () => {
      writePlan({ cassetteMode: 'record', suites: [{ id: 'a' }] });
      let status: ProviderHealth['status'] = 'initializing';
      const initialize = jest.fn(async () => {
        status = 'available';
        return true;
      });
      const suite: MemorySkillsHostSuite = {
        id: 'a',
        run: async () => {
          events.push('suite-a');
        },
      };

      await runMemorySkillsHost(
        deps({
          suites: [suite],
          boot: bootWith(
            new MemorySettings(),
            true,
            () => health(status),
            initialize,
          ),
        }),
      );
      expect(events).toContain('suite-a');
      expect(initialize).toHaveBeenCalledTimes(1);
    });

    it('never initializes the SDK during replay', async () => {
      writePlan({ cassetteMode: 'replay' });
      const initialize = jest.fn(async () => true);
      await runMemorySkillsHost(
        deps({
          boot: bootWith(
            new MemorySettings(),
            true,
            () => health('initializing'),
            initialize,
          ),
        }),
      );
      expect(initialize).not.toHaveBeenCalled();
    });

    it('waits for an initializing SDK before running suites', async () => {
      writePlan({ cassetteMode: 'record', suites: [{ id: 'a' }] });
      const states: ProviderHealth['status'][] = ['initializing', 'available'];
      const suite: MemorySkillsHostSuite = {
        id: 'a',
        run: async () => {
          events.push('suite-a');
        },
      };

      await runMemorySkillsHost(
        deps({
          suites: [suite],
          boot: bootWith(new MemorySettings(), true, () =>
            health(states.shift() ?? 'available'),
          ),
          sdkReadiness: {
            sleep: async () => {
              events.push('sdk-wait');
            },
          },
        }),
      );
      expect(events.indexOf('sdk-wait')).toBeLessThan(
        events.indexOf('suite-a'),
      );
    });

    it.each([
      ['error', health('error'), {}, /SDK adapter initialization failed/],
      [
        'timeout',
        health('initializing'),
        { timeoutMs: 0 },
        /SDK adapter did not become ready within 0ms/,
      ],
    ])(
      'fails loudly on SDK %s and does not run suites',
      async (_, sdk, gate, expected) => {
        writePlan({ cassetteMode: 'record', suites: [{ id: 'a' }] });
        const suite: MemorySkillsHostSuite = {
          id: 'a',
          run: async () => {
            events.push('suite-a');
          },
        };

        await expect(
          runMemorySkillsHost(
            deps({
              suites: [suite],
              boot: bootWith(new MemorySettings(), true, () => sdk),
              sdkReadiness: gate,
            }),
          ),
        ).rejects.toThrow(expected);
        expect(events).not.toContain('suite-a');
        expect(stop).toHaveBeenCalledTimes(1);
        expect(readFileSync(join(runDir, HOST_ERROR_FILE), 'utf8')).toMatch(
          expected,
        );
      },
    );

    it('fails with the redacted health message when initialization returns false', async () => {
      writePlan({ cassetteMode: 'record' });
      await expect(
        runMemorySkillsHost(
          deps({
            boot: bootWith(
              new MemorySettings(),
              true,
              () => ({
                ...health('error'),
                errorMessage: 'access_token=top-secret',
              }),
              async () => false,
            ),
          }),
        ),
      ).rejects.toThrow('access_token=<redacted>');
    });

    it('times out when SDK initialization never resolves', async () => {
      writePlan({ cassetteMode: 'record' });
      await expect(
        runMemorySkillsHost(
          deps({
            boot: bootWith(
              new MemorySettings(),
              true,
              () => health('initializing'),
              () => new Promise<boolean>(() => undefined),
            ),
            sdkReadiness: { timeoutMs: 0 },
          }),
        ),
      ).rejects.toThrow('SDK adapter did not become ready within 0ms');
      expect(stop).toHaveBeenCalledTimes(1);
    });

    it('fails loudly when the SDK adapter is not registered', async () => {
      writePlan({ cassetteMode: 'record' });
      const boot: MemorySkillsHostDeps['boot'] = async (options) => {
        const container = rootContainer.createChildContainer();
        container.register(PLATFORM_TOKENS.WORKSPACE_PROVIDER, {
          useValue: new MemorySettings(),
        });
        container.register(MEMORY_CONTRACT_TOKENS.CURATOR_LLM, {
          useValue: {},
        });
        container.register(LANE_RUNNER_SERVICE, { useValue: {} });
        await options.afterContainerReady?.(container, {
          workspaceRoot: options.workspace,
          isolation,
        });
        return {
          port: 4321,
          workspaceRoot: options.workspace,
          isolation,
          container,
          stop,
        };
      };

      await expect(runMemorySkillsHost(deps({ boot }))).rejects.toThrow(
        'record mode needs the SDK agent adapter; it is not registered in the bench host',
      );
      expect(stop).toHaveBeenCalledTimes(1);
    });
  });

  it('stops the host when retaining its log fails', async () => {
    writePlan();
    mkdirSync(join(runDir, HOST_LOG_FILE));
    await runMemorySkillsHost(deps());
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('notes an unreadable individual host log with a redacted error', () => {
    const logsDir = join(isolation.userDataPath, 'logs');
    mkdirSync(logsDir, { recursive: true });
    writeFileSync(join(logsDir, 'engine.log'), 'not read', 'utf8');

    retainHostLog(isolation.userDataPath, runDir, () => {
      throw new Error('apiKey mysecret\nsecond line');
    });

    expect(readFileSync(join(runDir, HOST_LOG_FILE), 'utf8')).toBe(
      '[unable to retain engine.log: apiKey <redacted> second line]\n',
    );
  });

  it('sets the unreachable oauth endpoint only in record mode', async () => {
    writePlan({ cassetteMode: 'record' });
    const settings = new MemorySettings();
    await runMemorySkillsHost(deps({ boot: bootWith(settings, true) }));
    expect(
      settings.written.get('ptah.provider.openai-codex.oauthTokenEndpoint'),
    ).toBe(UNREACHABLE_OAUTH_TOKEN_ENDPOINT);
    expect(completion().settings?.names).toEqual([
      'provider.openai-codex.oauthTokenEndpoint',
    ]);
  });

  it('discards a staged cassette when provenance is an alias', async () => {
    const curatorPath = join(bench, 'curator.jsonl');
    writePlan({
      cassetteMode: 'record',
      settings: {
        'memory.curatorProvider': 'openai-codex',
        'memory.curatorModel': 'gpt-5.6-terra',
      },
      cassettes: {
        curator: { path: curatorPath, model: 'gpt-5.6-terra' },
        laneRunner: { path: join(bench, 'lane.jsonl'), model: 'none' },
      },
      suites: [{ id: 'mem.extraction' }],
    });
    const suite: MemorySkillsHostSuite = {
      id: 'mem.extraction',
      run: async (context) => {
        writeFileSync(
          curatorPath,
          `${JSON.stringify({
            key: 'k1',
            method: 'extract',
            model: 'gpt-5.6-terra',
            promptSha: 'ab',
            response: { ok: true },
          })}\n`,
        );
        const tap = context.container.resolve<{
          onModelDispatched(provenance: {
            resolvedProviderId: string;
            resolvedModelId: string;
            component: 'memory-curator';
            laneId: string;
          }): void;
        }>(MODEL_DISPATCH_PROVENANCE_TAP);
        tap.onModelDispatched({
          resolvedProviderId: 'openai',
          resolvedModelId: 'gpt-5.6-terra',
          component: 'memory-curator',
          laneId: 'memory-curator',
        });
      },
    };
    await expect(
      runMemorySkillsHost(
        deps({ boot: bootWith(new MemorySettings(), true), suites: [suite] }),
      ),
    ).rejects.toThrow(/provenance provider openai does not match openai-codex/);
    expect(existsSync(curatorPath)).toBe(false);
    expect(existsSync(`${curatorPath}.provenance.json`)).toBe(false);
    expect(existsSync(join(runDir, HOST_COMPLETION_FILE))).toBe(false);
  });

  it('discards a staged cassette when the isolated auth file changes', async () => {
    const curatorPath = join(bench, 'curator.jsonl');
    const source = join(root, 'operator-auth.json');
    const now = Date.now();
    const exp = Math.floor(now / 1000) + 3600;
    const header = Buffer.from('{"alg":"none"}').toString('base64url');
    const body = Buffer.from(JSON.stringify({ exp })).toString('base64url');
    writeFileSync(
      source,
      JSON.stringify({ tokens: { access_token: `${header}.${body}.x` } }),
    );
    writePlan({
      cassetteMode: 'record',
      settings: {
        'memory.curatorProvider': 'openai-codex',
        'memory.curatorModel': 'gpt-5.6-terra',
      },
      cassettes: {
        curator: { path: curatorPath, model: 'gpt-5.6-terra' },
        laneRunner: { path: join(bench, 'lane.jsonl'), model: 'none' },
      },
      suites: [{ id: 'mem.extraction' }],
    });
    const previous = process.env['CODEX_HOME'];
    const suite: MemorySkillsHostSuite = {
      id: 'mem.extraction',
      run: async (context) => {
        writeFileSync(
          curatorPath,
          `${JSON.stringify({
            key: 'k1',
            method: 'extract',
            model: 'gpt-5.6-terra',
            promptSha: 'ab',
            response: {},
          })}\n`,
        );
        const tap = context.container.resolve<{
          onModelDispatched(provenance: {
            resolvedProviderId: string;
            resolvedModelId: string;
            component: 'memory-curator';
            laneId: string;
          }): void;
        }>(MODEL_DISPATCH_PROVENANCE_TAP);
        tap.onModelDispatched({
          resolvedProviderId: 'openai-codex',
          resolvedModelId: 'gpt-5.6-terra',
          component: 'memory-curator',
          laneId: 'memory-curator',
        });
        writeFileSync(
          join(isolation.home, '.codex', 'auth.json'),
          '{"tokens":{"access_token":"rotated"}}\n',
        );
      },
    };
    try {
      await expect(
        runMemorySkillsHost(
          deps({
            env: {
              [MEMORY_SKILLS_PLAN_ENV]: planPath,
              [CODEX_AUTH_SOURCE_ENV]: source,
              [RECORDING_DEADLINE_ENV]: '1000',
            },
            boot: bootWith(new MemorySettings(), true),
            suites: [suite],
          }),
        ),
      ).rejects.toThrow(/isolated auth.json changed during recording/);
      expect(existsSync(curatorPath)).toBe(false);
      expect(process.env['CODEX_HOME']).toBe(join(isolation.home, '.codex'));
    } finally {
      if (previous === undefined) delete process.env['CODEX_HOME'];
      else process.env['CODEX_HOME'] = previous;
    }
  });

  it('seeds active Codex auth into file settings and the oauth endpoint into config.json before the engine starts', async () => {
    writePlan({ cassetteMode: 'record' });
    const configPath = join(
      isolation.userDataPath,
      ISOLATED_PRODUCT_CONFIG_FILE,
    );
    const settingsPath = join(
      isolation.userDataPath,
      ISOLATED_FILE_SETTINGS_FILE,
    );
    writeFileSync(configPath, `${JSON.stringify({ ptah: { mcpPort: 1 } })}\n`);
    let endpointBeforeEngine = '';
    let authMethodBeforeEngine = '';
    let providerBeforeEngine = '';
    let preserved: unknown;
    const boot: MemorySkillsHostDeps['boot'] = async (options) => {
      events.push('boot');
      await options.beforeEngineBoot?.({
        workspace: options.workspace,
        isolation,
      });
      const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
        ptah: Record<string, unknown>;
      };
      endpointBeforeEngine = String(
        config.ptah['provider.openai-codex.oauthTokenEndpoint'],
      );
      const settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as Record<
        string,
        unknown
      >;
      authMethodBeforeEngine = String(settings['authMethod']);
      providerBeforeEngine = String(settings['anthropicProviderId']);
      preserved = config.ptah['mcpPort'];
      events.push('engine');
      const container = rootContainer.createChildContainer();
      container.register(PLATFORM_TOKENS.WORKSPACE_PROVIDER, {
        useValue: new MemorySettings(),
      });
      registerSdkAdapter(container);
      container.register(MEMORY_CONTRACT_TOKENS.CURATOR_LLM, { useValue: {} });
      container.register(LANE_RUNNER_SERVICE, { useValue: {} });
      await options.afterContainerReady?.(container, {
        workspaceRoot: options.workspace,
        isolation,
      });
      events.push('mcp');
      return {
        port: 4321,
        workspaceRoot: options.workspace,
        isolation,
        container,
        stop,
      };
    };
    await runMemorySkillsHost(deps({ boot }));
    expect(events.indexOf('boot')).toBeLessThan(events.indexOf('engine'));
    expect(events.indexOf('engine')).toBeLessThan(events.indexOf('mcp'));
    expect(endpointBeforeEngine).toBe(UNREACHABLE_OAUTH_TOKEN_ENDPOINT);
    expect(authMethodBeforeEngine).toBe('thirdParty');
    expect(providerBeforeEngine).toBe('openai-codex');
    expect(preserved).toBe(1);
  });

  it('does not seed isolated config.json before the engine in replay', async () => {
    writePlan();
    const configPath = join(
      isolation.userDataPath,
      ISOLATED_PRODUCT_CONFIG_FILE,
    );
    let configExisted = true;
    const boot: MemorySkillsHostDeps['boot'] = async (options) => {
      await options.beforeEngineBoot?.({
        workspace: options.workspace,
        isolation,
      });
      configExisted = existsSync(configPath);
      events.push('engine');
      const container = rootContainer.createChildContainer();
      await options.afterContainerReady?.(container, {
        workspaceRoot: options.workspace,
        isolation,
      });
      return {
        port: 4321,
        workspaceRoot: options.workspace,
        isolation,
        container,
        stop,
      };
    };
    await runMemorySkillsHost(deps({ boot }));
    expect(events).toContain('engine');
    expect(configExisted).toBe(false);
  });
});
