import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ConfigGetScopesResult, RpcMethodName } from '@ptah-extension/shared';
import { ClaudeRpcService, RpcResult } from './claude-rpc.service';
import { ProvidersCommitService, type ProvidersCommitHooks } from './providers-commit.service';
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
  let scopes: ReturnType<typeof signal<ProvidersSettingsSection<ConfigGetScopesResult>>>;
  let ready: boolean;
  let events: string[];
  let hooks: ProvidersCommitHooks;
  let call: jest.Mock<Promise<RpcResult<unknown>>, [RpcMethodName, unknown, unknown?]>;

  const scopesAt = (activePath: string | null): ProvidersSettingsSection<ConfigGetScopesResult> => ({
    status: 'ready',
    data: { activePath, entries: [] },
    error: null,
  });
  /** Records each operation's write so the matrix can assert which ones ran. */
  function op(name: string, write: Write, stage?: SaveStage, readBack?: () => Promise<boolean>): SaveOperation {
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
    call = jest.fn(async () => success({ success: true }));
    TestBed.configureTestingModule({
      providers: [WorkspaceScopeService, { provide: ClaudeRpcService, useValue: { call } }],
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
    expect(service.commit()).toMatchObject({ status: 'idle', saved: [], unsaved: [], unconfirmed: [] });
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
    await expect(service.run([op('a', acknowledged)], context, hooks)).resolves.toBe(true);
    expect(events).toEqual(['refreshScopes', 'write:a', 'refresh', 'sectionsReady']);
    expect(service.commit()).toMatchObject({ status: 'saved', saved: ['a'], refreshFailed: false, message: null });
  });

  it('blocks every field without writing when the context or the target is not allowed', async () => {
    await service.run([op('a', acknowledged), op('b', acknowledged)], context, hooks, () => false);
    expect(service.commit()).toMatchObject({ status: 'blocked', unsaved: ['a', 'b'] });
    scopes.set(scopesAt('/other'));
    await service.run([op('c', acknowledged)], context, hooks);
    expect(service.commit()).toMatchObject({ status: 'blocked', unsaved: ['c'] });
    expect(events.filter((event) => event.startsWith('write:'))).toEqual([]);
  });

  it('refuses a second save while one is in flight and keeps the in-flight feedback', async () => {
    let release!: () => void;
    const gate = new Promise<void>((done) => (release = done));
    const first = service.run([op('slow', async () => {
      await gate;
      return true;
    })], context, hooks);
    await Promise.resolve();
    await expect(service.run([op('second', acknowledged)], context, hooks)).resolves.toBe(false);
    expect(service.commit().status).toBe('saving');
    release();
    await expect(first).resolves.toBe(true);
    expect(events).not.toContain('write:second');
    expect(service.commit()).toMatchObject({ status: 'saved', saved: ['slow'] });
  });

  describe('D15 outcomes', () => {
    it.each([
      ['acknowledged, no read-back', acknowledged, undefined, 'saved'],
      ['acknowledged, read-back matches', acknowledged, async () => true, 'saved'],
      ['acknowledged, read-back mismatches', acknowledged, async () => false, 'unsaved'],
      ['acknowledged, read-back throws', acknowledged, async () => { throw new Error('x'); }, 'unconfirmed'],
      ['rejected, read-back would match', rejected, async () => true, 'unsaved'],
      ['thrown, read-back would match', throwing, async () => true, 'unconfirmed'],
      ['conflict, read-back would match', conflicting, async () => true, 'unsaved'],
    ] as const)('%s → %s', async (_label, write, readBack, bucket) => {
      const readBackSpy = readBack ? jest.fn(readBack) : undefined;
      await service.run([op('field', write, undefined, readBackSpy)], context, hooks);
      const commit = service.commit();
      expect(commit[bucket]).toEqual(['field']);
      expect(commit.saved).toEqual(bucket === 'saved' ? ['field'] : []);
      // Read-back runs only after an acknowledged write.
      if (readBackSpy) expect(readBackSpy).toHaveBeenCalledTimes(write === acknowledged ? 1 : 0);
      expect(JSON.stringify(commit)).not.toContain('sk-secret');
    });

    it('names conflicts in the message and never claims a saved field after the workspace changes', async () => {
      await service.run([op('tier', conflicting), op('other', acknowledged)], context, hooks);
      expect(service.commit()).toMatchObject({ status: 'partial', saved: ['other'], unsaved: ['tier'] });
      expect(service.commit().message).toBe(
        'Changed elsewhere since setup opened, not overwritten: tier. Reopen setup to review the current value.',
      );
      hooks.refresh = async () => {
        scopes.set(scopesAt('/other'));
      };
      await service.run([op('late', acknowledged)], context, hooks);
      expect(service.commit()).toMatchObject({ status: 'unconfirmed', saved: [], unconfirmed: ['late'] });
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
    const ran = () => events.filter((event) => event.startsWith('write:')).map((event) => event.slice(6));

    it('a failed setup write skips later setup, tier and activation writes but not independent ones', async () => {
      await service.run([
        op('credential', rejected, 'setup'),
        op('endpoint', acknowledged, 'setup'),
        op('independent', acknowledged),
        op('tier', acknowledged, 'tier'),
        op('activation', acknowledged, 'activation'),
      ], context, hooks);
      expect(ran()).toEqual(['credential', 'independent']);
      expect(service.commit()).toMatchObject({
        status: 'partial',
        saved: ['independent'],
        unsaved: ['credential', 'endpoint', 'tier', 'activation'],
      });
    });

    it('a tier conflict skips only activation; later tiers still save', async () => {
      await service.run([
        op('credential', acknowledged, 'setup'),
        op('sonnet', conflicting, 'tier'),
        op('opus', acknowledged, 'tier'),
        op('activation', acknowledged, 'activation'),
      ], context, hooks);
      expect(ran()).toEqual(['credential', 'sonnet', 'opus']);
      expect(service.commit()).toMatchObject({
        saved: ['credential', 'opus'],
        unsaved: ['sonnet', 'activation'],
      });
    });

    it('an unconfirmed setup write stops the chain; a failed independent write still stops activation', async () => {
      await service.run([op('credential', throwing, 'setup'), op('tier', acknowledged, 'tier')], context, hooks);
      expect(ran()).toEqual(['credential']);
      expect(service.commit()).toMatchObject({ unconfirmed: ['credential'], unsaved: ['tier'] });
      events = [];
      await service.run([op('independent', rejected), op('activation', acknowledged, 'activation')], context, hooks);
      expect(ran()).toEqual(['independent']);
      expect(service.commit()).toMatchObject({ status: 'failed', unsaved: ['independent', 'activation'] });
    });

    it('activation runs when every earlier write saved', async () => {
      await service.run([
        op('credential', acknowledged, 'setup'),
        op('tier', acknowledged, 'tier'),
        op('activation', acknowledged, 'activation'),
      ], context, hooks);
      expect(ran()).toEqual(['credential', 'tier', 'activation']);
      expect(service.commit().status).toBe('saved');
    });
  });

  describe('operations', () => {
    it('builds one operation per patch field and writes through the host', async () => {
      const operations = service.operations({ judging: { judgeModel: '  ' }, memory: { curatorModel: 'm' } });
      expect(operations.map((operation) => operation.fields)).toEqual([['memory.curatorModel'], ['skillSynthesis.judgeModel']]);
      call.mockImplementation(async () => success({ updated: true }));
      await operations[1].write();
      // The picker's blank model is the resolver's 'inherit'.
      expect(call).toHaveBeenCalledWith('skillSynthesis:updateSettings', { settings: { judgeModel: 'inherit' } }, undefined);
    });

    it('never names a CLI credential value, only its field', () => {
      const [operation] = service.operations({
        cli: [{ action: 'update', params: { id: 'agent-id', name: 'Worker', apiKey: 'raw-key' } }],
      });
      expect(operation.fields).toEqual(['ptahCliAgents.agent-id.name', 'ptahCliAgents.agent-id.apiKey']);
      expect(JSON.stringify(operation.fields)).not.toContain('raw-key');
    });
  });
});
