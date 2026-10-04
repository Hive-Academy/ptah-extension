import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type {
  ConfigGetScopesResult,
  RpcMethodName,
} from '@ptah-extension/shared';
import { ClaudeRpcService, RpcResult } from './claude-rpc.service';
import {
  ProvidersCommitService,
  type ProvidersCommitHooks,
} from './providers-commit.service';
import type {
  ProvidersEditContext,
  ProvidersSettingsSection,
  SaveOperation,
  SaveStage,
} from './providers-settings.types';
import { WorkspaceScopeService } from './workspace-scope.service';

const success = <T>(data: T) => new RpcResult(true, data);
type Write = SaveOperation['write'];
const acknowledged: Write = async () => true;
const rejected: Write = async () => false;
const conflicting: Write = async () => 'conflict';
const throwing: Write = async () => {
  throw new Error('raw host error with sk-secret');
};

describe('ProvidersCommitService', () => {
  let service: ProvidersCommitService;
  let workspace: WorkspaceScopeService;
  let context: ProvidersEditContext;
  let scopes: ReturnType<
    typeof signal<ProvidersSettingsSection<ConfigGetScopesResult>>
  >;
  let ready: boolean;
  let events: string[];
  let hooks: ProvidersCommitHooks;
  let call: jest.Mock<
    Promise<RpcResult<unknown>>,
    [RpcMethodName, unknown, unknown?]
  >;

  const scopesAt = (
    activePath: string | null,
  ): ProvidersSettingsSection<ConfigGetScopesResult> => ({
    status: 'ready',
    data: { activePath, entries: [] },
    error: null,
  });
  /** Records each operation's write so the matrix can assert which ones ran. */
  function op(
    name: string,
    write: Write,
    stage?: SaveStage,
    readBack?: () => Promise<boolean>,
  ): SaveOperation {
    return {
      fields: [name],
      stage,
      readBack,
      write: async () => {
        events.push(`write:${name}`);
        return write();
      },
    };
  }

  beforeEach(() => {
    events = [];
    ready = true;
    call = jest.fn<
      Promise<RpcResult<unknown>>,
      [RpcMethodName, unknown, unknown?]
    >(async () => success({ success: true }));
    TestBed.configureTestingModule({
      providers: [
        WorkspaceScopeService,
        { provide: ClaudeRpcService, useValue: { call } },
      ],
    });
    workspace = TestBed.inject(WorkspaceScopeService);
    workspace.switchTo('/workspace');
    service = TestBed.inject(ProvidersCommitService);
    context = { scopeKey: workspace.scopeKey(), activePath: '/workspace' };
    scopes = signal(scopesAt('/workspace'));
    hooks = {
      refreshScopes: async () => {
        events.push('refreshScopes');
      },
      refresh: async () => {
        events.push('refresh');
      },
      scopes: () => scopes(),
      sectionsReady: () => {
        events.push('sectionsReady');
        return ready;
      },
    };
  });
  afterEach(() => TestBed.resetTestingModule());

  it('starts idle and reports a block without writing', () => {
    expect(service.commit()).toMatchObject({
      status: 'idle',
      saved: [],
      unsaved: [],
      unconfirmed: [],
    });
    service.block(['Connection'], 'Verify first.');
    expect(service.commit()).toEqual({
      status: 'blocked',
      saved: [],
      unsaved: ['Connection'],
      unconfirmed: [],
      refreshFailed: false,
      message: 'Verify first.',
    });
  });

  it('refreshes scopes before any write and refreshes every section after, in order', async () => {
    await expect(
      service.run([op('a', acknowledged)], context, hooks),
    ).resolves.toBe(true);
    expect(events).toEqual([
      'refreshScopes',
      'write:a',
      'refresh',
      'sectionsReady',
    ]);
    expect(service.commit()).toMatchObject({
      status: 'saved',
      saved: ['a'],
      refreshFailed: false,
      message: null,
    });
  });

  it('blocks every field without writing when the context or the target is not allowed', async () => {
    await service.run(
      [op('a', acknowledged), op('b', acknowledged)],
      context,
      hooks,
      () => false,
    );
    expect(service.commit()).toMatchObject({
      status: 'blocked',
      unsaved: ['a', 'b'],
    });
    scopes.set(scopesAt('/other'));
    await service.run([op('c', acknowledged)], context, hooks);
    expect(service.commit()).toMatchObject({
      status: 'blocked',
      unsaved: ['c'],
    });
    expect(events.filter((event) => event.startsWith('write:'))).toEqual([]);
  });

  it('refuses a second save while one is in flight and keeps the in-flight feedback', async () => {
    let release!: () => void;
    const gate = new Promise<void>((done) => (release = done));
    const first = service.run(
      [
        op('slow', async () => {
          await gate;
          return true;
        }),
      ],
      context,
      hooks,
    );
    await Promise.resolve();
    await expect(
      service.run([op('second', acknowledged)], context, hooks),
    ).resolves.toBe(false);
    expect(service.commit().status).toBe('saving');
    release();
    await expect(first).resolves.toBe(true);
    expect(events).not.toContain('write:second');
    expect(service.commit()).toMatchObject({
      status: 'saved',
      saved: ['slow'],
    });
  });

  describe('D15 outcomes', () => {
    it.each([
      ['acknowledged, no read-back', acknowledged, undefined, 'saved'],
      [
        'acknowledged, read-back matches',
        acknowledged,
        async (): Promise<boolean> => true,
        'saved',
      ],
      [
        'acknowledged, read-back mismatches',
        acknowledged,
        async (): Promise<boolean> => false,
        'unsaved',
      ],
      [
        'acknowledged, read-back throws',
        acknowledged,
        async (): Promise<boolean> => {
          throw new Error('x');
        },
        'unconfirmed',
      ],
      [
        'rejected, read-back would match',
        rejected,
        async (): Promise<boolean> => true,
        'unsaved',
      ],
      [
        'thrown, read-back would match',
        throwing,
        async (): Promise<boolean> => true,
        'unconfirmed',
      ],
      [
        'conflict, read-back would match',
        conflicting,
        async (): Promise<boolean> => true,
        'unsaved',
      ],
    ] as const)('%s → %s', async (_label, write, readBack, bucket) => {
      const readBackSpy = readBack ? jest.fn(readBack) : undefined;
      await service.run(
        [op('field', write, undefined, readBackSpy)],
        context,
        hooks,
      );
      const commit = service.commit();
      expect(commit[bucket]).toEqual(['field']);
      expect(commit.saved).toEqual(bucket === 'saved' ? ['field'] : []);
      // Read-back runs only after an acknowledged write.
      if (readBackSpy)
        expect(readBackSpy).toHaveBeenCalledTimes(
          write === acknowledged ? 1 : 0,
        );
      expect(JSON.stringify(commit)).not.toContain('sk-secret');
    });

    it('names conflicts in the message and never claims a saved field after the workspace changes', async () => {
      await service.run(
        [op('tier', conflicting), op('other', acknowledged)],
        context,
        hooks,
      );
      expect(service.commit()).toMatchObject({
        status: 'partial',
        saved: ['other'],
        unsaved: ['tier'],
      });
      expect(service.commit().message).toBe(
        'Changed elsewhere since setup opened, not overwritten: tier. Reopen setup to review the current value.',
      );
      hooks.refresh = async () => {
        scopes.set(scopesAt('/other'));
      };
      await service.run([op('late', acknowledged)], context, hooks);
      expect(service.commit()).toMatchObject({
        status: 'unconfirmed',
        saved: [],
        unconfirmed: ['late'],
      });
    });

    it('reports a failed post-save refresh without changing the outcome', async () => {
      ready = false;
      await service.run([op('a', acknowledged)], context, hooks);
      expect(service.commit()).toMatchObject({
        status: 'saved',
        refreshFailed: true,
        message: 'Some settings could not be refreshed. Retry those sections.',
      });
    });
  });

  describe('stage matrix (552)', () => {
    const ran = () =>
      events
        .filter((event) => event.startsWith('write:'))
        .map((event) => event.slice(6));

    it('a failed setup write skips later setup, tier and activation writes but not independent ones', async () => {
      await service.run(
        [
          op('credential', rejected, 'setup'),
          op('endpoint', acknowledged, 'setup'),
          op('independent', acknowledged),
          op('tier', acknowledged, 'tier'),
          op('activation', acknowledged, 'activation'),
        ],
        context,
        hooks,
      );
      expect(ran()).toEqual(['credential', 'independent']);
      expect(service.commit()).toMatchObject({
        status: 'partial',
        saved: ['independent'],
        unsaved: ['credential', 'endpoint', 'tier', 'activation'],
      });
    });

    it('a tier conflict skips only activation; later tiers still save', async () => {
      await service.run(
        [
          op('credential', acknowledged, 'setup'),
          op('sonnet', conflicting, 'tier'),
          op('opus', acknowledged, 'tier'),
          op('activation', acknowledged, 'activation'),
        ],
        context,
        hooks,
      );
      expect(ran()).toEqual(['credential', 'sonnet', 'opus']);
      expect(service.commit()).toMatchObject({
        saved: ['credential', 'opus'],
        unsaved: ['sonnet', 'activation'],
      });
    });

    it('an unconfirmed setup write stops the chain; a failed independent write still stops activation', async () => {
      await service.run(
        [op('credential', throwing, 'setup'), op('tier', acknowledged, 'tier')],
        context,
        hooks,
      );
      expect(ran()).toEqual(['credential']);
      expect(service.commit()).toMatchObject({
        unconfirmed: ['credential'],
        unsaved: ['tier'],
      });
      events = [];
      await service.run(
        [
          op('independent', rejected),
          op('activation', acknowledged, 'activation'),
        ],
        context,
        hooks,
      );
      expect(ran()).toEqual(['independent']);
      expect(service.commit()).toMatchObject({
        status: 'failed',
        unsaved: ['independent', 'activation'],
      });
    });

    it('activation runs when every earlier write saved', async () => {
      await service.run(
        [
          op('credential', acknowledged, 'setup'),
          op('tier', acknowledged, 'tier'),
          op('activation', acknowledged, 'activation'),
        ],
        context,
        hooks,
      );
      expect(ran()).toEqual(['credential', 'tier', 'activation']);
      expect(service.commit().status).toBe('saved');
    });
  });

  describe('operations', () => {
    it('builds one operation per patch field and writes through the host', async () => {
      const operations = service.operations({
        judging: { judgeModel: '  ' },
        memory: { curatorModel: 'm' },
      });
      expect(operations.map((operation) => operation.fields)).toEqual([
        ['memory.curatorModel'],
        ['skillSynthesis.judgeModel'],
      ]);
      call.mockImplementation(async () => success({ updated: true }));
      await operations[1].write();
      // The picker's blank model is the resolver's 'inherit'.
      expect(call).toHaveBeenCalledWith(
        'skillSynthesis:updateSettings',
        { settings: { judgeModel: 'inherit' } },
        undefined,
      );
    });

    it('never names a CLI credential value, only its field', () => {
      const [operation] = service.operations({
        cli: [
          {
            action: 'update',
            params: { id: 'agent-id', name: 'Worker', apiKey: 'raw-key' },
          },
        ],
      });
      expect(operation.fields).toEqual([
        'ptahCliAgents.agent-id.name',
        'ptahCliAgents.agent-id.apiKey',
      ]);
      expect(JSON.stringify(operation.fields)).not.toContain('raw-key');
    });
  });

  describe('tier and orchestration writes (Component 7)', () => {
    /** Answers each RPC from a table; an unlisted method fails the test. */
    function host(
      table: Partial<Record<RpcMethodName, () => RpcResult<unknown>>>,
    ) {
      call.mockImplementation(async (method) => {
        const answer = table[method];
        if (!answer) throw new Error(`Unexpected RPC: ${method}`);
        return answer();
      });
    }
    const methods = () => call.mock.calls.map(([method]) => method);
    const failure = () => new RpcResult(false, undefined, 'raw sk-secret');

    describe('mainAgentTierOperation', () => {
      it('sets a model in the main-agent scope and reads it back', async () => {
        host({
          'provider:setModelTier': () => success({ success: true }),
          'provider:getModelTiers': () =>
            success({ sonnet: null, opus: 'o-1', haiku: null }),
        });
        await service.run(
          [service.mainAgentTierOperation('openrouter', 'opus', 'o-1')],
          context,
          hooks,
        );
        expect(service.commit()).toMatchObject({
          status: 'saved',
          saved: ['Main agent opus model'],
        });
        expect(call).toHaveBeenCalledWith(
          'provider:setModelTier',
          {
            providerId: 'openrouter',
            tier: 'opus',
            modelId: 'o-1',
            scope: 'mainAgent',
          },
          undefined,
        );
      });
      it('clears the tier for an empty model', async () => {
        host({
          'provider:clearModelTier': () => success({ success: true }),
          'provider:getModelTiers': () =>
            success({ sonnet: null, opus: null, haiku: null }),
        });
        await service.run(
          [service.mainAgentTierOperation('openrouter', 'opus', '')],
          context,
          hooks,
        );
        expect(service.commit().status).toBe('saved');
        expect(methods()).toEqual([
          'provider:clearModelTier',
          'provider:getModelTiers',
        ]);
      });
      it.each([
        ['rejected', () => success({ success: false }), 'failed'],
        ['failed call', failure, 'unconfirmed'],
      ] as const)('%s write is never saved', async (_label, write, status) => {
        host({
          'provider:setModelTier': write,
          'provider:getModelTiers': () => success({ opus: 'o-1' }),
        });
        await service.run(
          [service.mainAgentTierOperation('openrouter', 'opus', 'o-1')],
          context,
          hooks,
        );
        expect(service.commit()).toMatchObject({ status, saved: [] });
        expect(JSON.stringify(service.commit())).not.toContain('sk-secret');
      });
      it('a read-back mismatch is not saved', async () => {
        host({
          'provider:setModelTier': () => success({ success: true }),
          'provider:getModelTiers': () => success({ opus: 'someone-else' }),
        });
        await service.run(
          [service.mainAgentTierOperation('openrouter', 'opus', 'o-1')],
          context,
          hooks,
        );
        expect(service.commit()).toMatchObject({
          status: 'failed',
          unsaved: ['Main agent opus model'],
        });
      });
    });

    describe('cliInstanceTiersOperation (D5)', () => {
      const stored = (tierMappings: unknown) => () =>
        success({
          success: true,
          value: [{ id: 'other' }, { id: 'agent-1', tierMappings }],
        });

      it('writes the full object without blank tiers and reads the instance back', async () => {
        host({
          'ptahCli:update': () => success({ success: true }),
          'settings:get': stored({ sonnet: 's-1', haiku: 'h-1' }),
        });
        await service.run(
          [
            service.cliInstanceTiersOperation('agent-1', {
              sonnet: ' s-1 ',
              opus: '  ',
              haiku: 'h-1',
            }),
          ],
          context,
          hooks,
        );
        expect(call).toHaveBeenCalledWith(
          'ptahCli:update',
          { id: 'agent-1', tierMappings: { sonnet: 's-1', haiku: 'h-1' } },
          undefined,
        );
        expect(service.commit()).toMatchObject({
          status: 'saved',
          saved: ['ptahCliAgents.agent-1.tierMappings'],
        });
      });
      it.each([
        [
          'rejected',
          () => success({ success: false, error: 'raw sk-secret' }),
          'failed',
        ],
        ['failed call', failure, 'unconfirmed'],
      ] as const)('%s write is never saved', async (_label, write, status) => {
        host({
          'ptahCli:update': write,
          'settings:get': stored({ sonnet: 's-1' }),
        });
        await service.run(
          [service.cliInstanceTiersOperation('agent-1', { sonnet: 's-1' })],
          context,
          hooks,
        );
        expect(service.commit()).toMatchObject({ status, saved: [] });
        expect(JSON.stringify(service.commit())).not.toContain('sk-secret');
      });
      it('clearing every tier on an existing instance is saved', async () => {
        host({
          'ptahCli:update': () => success({ success: true }),
          'settings:get': stored({}),
        });
        await service.run(
          [
            service.cliInstanceTiersOperation('agent-1', {
              sonnet: '',
              opus: ' ',
            }),
          ],
          context,
          hooks,
        );
        expect(call).toHaveBeenCalledWith(
          'ptahCli:update',
          { id: 'agent-1', tierMappings: {} },
          undefined,
        );
        expect(service.commit()).toMatchObject({
          status: 'saved',
          saved: ['ptahCliAgents.agent-1.tierMappings'],
        });
      });
      it('clearing every tier is not saved when the instance is gone', async () => {
        host({
          'ptahCli:update': () => success({ success: true }),
          'settings:get': () =>
            success({ success: true, value: [{ id: 'other' }] }),
        });
        await service.run(
          [service.cliInstanceTiersOperation('agent-1', {})],
          context,
          hooks,
        );
        expect(service.commit()).toMatchObject({
          status: 'failed',
          saved: [],
          unsaved: ['ptahCliAgents.agent-1.tierMappings'],
        });
      });
      it('clearing every tier is unconfirmed when the instances cannot be read', async () => {
        host({
          'ptahCli:update': () => success({ success: true }),
          'settings:get': () => new RpcResult(false, undefined, 'raw'),
        });
        await service.run(
          [service.cliInstanceTiersOperation('agent-1', {})],
          context,
          hooks,
        );
        expect(service.commit()).toMatchObject({
          status: 'unconfirmed',
          saved: [],
        });
      });
      it.each([
        ['a different model', { sonnet: 's-2' }],
        ['a tier left over from before', { sonnet: 's-1', opus: 'old' }],
        ['a missing instance', undefined],
      ])('read-back with %s is not saved', async (_label, tierMappings) => {
        host({
          'ptahCli:update': () => success({ success: true }),
          'settings:get': tierMappings
            ? stored(tierMappings)
            : () => success({ success: true, value: [] }),
        });
        await service.run(
          [service.cliInstanceTiersOperation('agent-1', { sonnet: 's-1' })],
          context,
          hooks,
        );
        expect(service.commit()).toMatchObject({ status: 'failed', saved: [] });
      });
    });

    describe('orchestration policy fields', () => {
      const config = (overrides: Record<string, unknown>) => () =>
        success({
          disabledClis: [],
          preferredAgentOrder: [],
          maxConcurrentAgents: 3,
          copilotAutoApprove: true,
          ...overrides,
        });

      it('saves each policy field and reads arrays back element by element', async () => {
        host({
          'agent:setConfig': () => success({ success: true }),
          'agent:getConfig': config({
            disabledClis: ['copilot'],
            preferredAgentOrder: ['codex', 'ptah-cli-1'],
            maxConcurrentAgents: 5,
            copilotAutoApprove: false,
          }),
        });
        await service.run(
          service.operations({
            orchestration: {
              disabledClis: ['copilot'],
              preferredAgentOrder: ['codex', 'ptah-cli-1'],
              maxConcurrentAgents: 5,
              copilotAutoApprove: false,
            },
          }),
          context,
          hooks,
        );
        expect(service.commit()).toMatchObject({
          status: 'saved',
          saved: [
            'agentOrchestration.disabledClis',
            'agentOrchestration.preferredAgentOrder',
            'agentOrchestration.maxConcurrentAgents',
            'agentOrchestration.copilotAutoApprove',
          ],
        });
        expect(call).toHaveBeenCalledWith(
          'agent:setConfig',
          { preferredAgentOrder: ['codex', 'ptah-cli-1'] },
          undefined,
        );
      });
      it.each([
        ['reordered', ['ptah-cli-1', 'codex']],
        ['shorter', ['codex']],
        ['longer', ['codex', 'ptah-cli-1', 'copilot']],
        ['not an array', 'codex,ptah-cli-1'],
      ])('an order read back %s is not saved', async (_label, storedOrder) => {
        host({
          'agent:setConfig': () => success({ success: true }),
          'agent:getConfig': config({ preferredAgentOrder: storedOrder }),
        });
        await service.run(
          service.operations({
            orchestration: { preferredAgentOrder: ['codex', 'ptah-cli-1'] },
          }),
          context,
          hooks,
        );
        expect(service.commit()).toMatchObject({
          status: 'failed',
          unsaved: ['agentOrchestration.preferredAgentOrder'],
        });
      });
      it.each([
        [
          'rejected',
          () => success({ success: false, error: 'raw sk-secret' }),
          'failed',
        ],
        ['failed call', failure, 'unconfirmed'],
      ] as const)(
        'a %s write is never saved',
        async (_label, write, status) => {
          host({
            'agent:setConfig': write,
            'agent:getConfig': config({ maxConcurrentAgents: 5 }),
          });
          await service.run(
            service.operations({ orchestration: { maxConcurrentAgents: 5 } }),
            context,
            hooks,
          );
          expect(service.commit()).toMatchObject({ status, saved: [] });
          expect(JSON.stringify(service.commit())).not.toContain('sk-secret');
        },
      );
      it('writes the subagent prompt-cache TTL alone and confirms it by read-back', async () => {
        host({
          'agent:setConfig': () => success({ success: true }),
          'agent:getConfig': config({
            subagentPromptCacheTtl: '1h',
            subagentPromptCacheTtlEnvOverride: '5m',
          }),
        });
        await service.run(
          service.operations({
            orchestration: { subagentPromptCacheTtl: '1h' },
          }),
          context,
          hooks,
        );
        expect(service.commit()).toMatchObject({
          status: 'saved',
          saved: ['agentOrchestration.subagentPromptCacheTtl'],
        });
        // The env override is read-only: only the setting is sent.
        expect(call).toHaveBeenCalledWith(
          'agent:setConfig',
          { subagentPromptCacheTtl: '1h' },
          undefined,
        );
      });
      it.each([
        ['a different value', '5m'],
        ['no value (a host without the field)', undefined],
      ])(
        'a subagent prompt-cache TTL read back as %s is not saved',
        async (_label, stored) => {
          host({
            'agent:setConfig': () => success({ success: true }),
            'agent:getConfig': config({ subagentPromptCacheTtl: stored }),
          });
          await service.run(
            service.operations({
              orchestration: { subagentPromptCacheTtl: '1h' },
            }),
            context,
            hooks,
          );
          expect(service.commit()).toMatchObject({
            status: 'failed',
            unsaved: ['agentOrchestration.subagentPromptCacheTtl'],
          });
        },
      );
    });
  });
});
