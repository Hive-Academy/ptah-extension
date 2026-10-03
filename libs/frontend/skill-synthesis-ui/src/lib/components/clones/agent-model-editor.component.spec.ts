import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ClaudeRpcService, VSCodeService } from '@ptah-extension/core';
import { HarnessHealthStore } from '@ptah-extension/marketplace/services';
import {
  MESSAGE_TYPES,
  type HarnessHealth,
  type SkillSynthesisGetAgentModelsResult,
} from '@ptah-extension/shared';

import {
  SkillSynthesisRpcService,
  type AgentModelSaveOutcome,
} from '../../services/skill-synthesis-rpc.service';
import { ReconcileGuardComponent } from './reconcile-guard';
import { AgentModelsStore } from './agent-models.store';
import {
  AgentModelEditorComponent,
  GUARD_FAILED_COPY,
  MACHINE_SCOPE_COPY,
  SYNC_SKIPPED_COPY,
} from './agent-model-editor.component';

/** jsdom implements no HTMLDialogElement methods (same stub as reconcile-guard.spec). */
beforeAll(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal(
      this: HTMLDialogElement,
    ) {
      this.setAttribute('open', '');
    } as HTMLDialogElement['showModal'];
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close(
      this: HTMLDialogElement,
    ) {
      this.removeAttribute('open');
    } as HTMLDialogElement['close'];
  }
});

/** The editor as the view places it: inside a card, next to the one guard. */
@Component({
  standalone: true,
  imports: [ReconcileGuardComponent, AgentModelEditorComponent],
  providers: [AgentModelsStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ptah-reconcile-guard #guard />
    <ptah-agent-model-editor slug="reviewer" [guard]="guard" />
  `,
})
class EditorHostComponent implements OnInit {
  public readonly store = inject(AgentModelsStore);
  public ngOnInit(): void {
    void this.store.load();
  }
}

function models(
  overrides: Partial<SkillSynthesisGetAgentModelsResult> = {},
): SkillSynthesisGetAgentModelsResult {
  return {
    workspaceRoot: '/ws/resolved',
    machine: { '*': { copilot: 'gpt-4.1' } },
    workspace: { reviewer: { codex: 'gpt-5' } },
    lists: {
      claude: [],
      codex: [{ id: 'gpt-5' }, { id: 'o3' }],
      copilot: [{ id: 'gpt-4.1' }],
      cursor: [],
      opencode: [{ id: 'anthropic/claude-sonnet-4-5' }],
    },
    classification: {
      machine: { '*': { copilot: 'listed' } },
      workspace: { reviewer: { codex: 'listed' } },
    },
    unsupportedProviders: ['cursor'],
    ...overrides,
  };
}

/** A fresh report object per read, as the real RPC deserialises one. */
function report(localEdit: string[] = []): HarnessHealth {
  return {
    workspaceRoot: '/ws/resolved',
    generatedAt: '2026-10-04T00:00:00.000Z',
    mode: 'preflight',
    reason: 'test',
    sources: 'ok',
    targets:
      localEdit.length === 0
        ? []
        : [
            {
              target: 'codex',
              localEdit,
            } as unknown as HarnessHealth['targets'][number],
          ],
    collisions: [],
  };
}

const ok = <T>(data: T) => ({ success: true, isSuccess: () => true, data });
const fail = (error: string) => ({
  success: false,
  isSuccess: () => false,
  error,
});

/** A promise plus its resolver, to hold a reply until the test releases it. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const saved = (): AgentModelSaveOutcome => ({
  ok: true,
  result: {
    classification: 'listed',
    machine: { '*': { copilot: 'gpt-4.1' } },
    workspace: { reviewer: { codex: 'o3' } },
  },
});

describe('AgentModelEditorComponent', () => {
  let fixture: ComponentFixture<EditorHostComponent>;
  /** Every call that reaches a backend, in order. */
  let log: string[];
  let rpc: {
    getAgentModels: jest.Mock;
    listCliModels: jest.Mock;
    getAgentLaneConfig: jest.Mock;
    setAgentModel: jest.Mock;
  };
  /** What the next `harness:health` / `harness:reconcile` answers. */
  let healthReply: () => unknown;
  let reconcileReply: () => unknown;
  let config: ReturnType<typeof signal<Record<string, unknown>>>;

  function setup(snapshot = models()): void {
    log = [];
    healthReply = () => ok({ health: report() });
    reconcileReply = () => ok({ health: report() });
    rpc = {
      getAgentModels: jest.fn(async () => {
        log.push('getAgentModels');
        return snapshot;
      }),
      listCliModels: jest.fn(async () => ({
        codex: [
          { id: 'gpt-5', name: 'GPT-5' },
          { id: 'o3', name: 'o3' },
        ],
        copilot: [],
        cursor: [],
        antigravity: [],
        opencode: [],
        pi: [],
      })),
      getAgentLaneConfig: jest.fn(async () => ({
        codexModel: 'gpt-5-codex',
        copilotModel: '',
        cursorModel: '',
        opencodeModel: '',
      })),
      setAgentModel: jest.fn(async (params: { value: string | null }) => {
        log.push(`set:${params.value}`);
        return saved();
      }),
    };
    const harnessCall = jest.fn(async (method: string) => {
      log.push(method);
      return method === 'harness:reconcile' ? reconcileReply() : healthReply();
    });
    config = signal<Record<string, unknown>>({
      isElectron: true,
      workspaceRoot: '/ws',
    });
    TestBed.configureTestingModule({
      imports: [EditorHostComponent],
      providers: [
        { provide: SkillSynthesisRpcService, useValue: rpc },
        {
          provide: ClaudeRpcService,
          useValue: {
            call: harnessCall as unknown as ClaudeRpcService['call'],
          },
        },
        { provide: VSCodeService, useValue: { config } },
      ],
    });
    fixture = TestBed.createComponent(EditorHostComponent);
    fixture.detectChanges();
  }

  afterEach(() => TestBed.resetTestingModule());

  const root = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement = HTMLElement>(
    testId: string,
    scope: ParentNode = root(),
  ): T | null => scope.querySelector<T>(`[data-testid="${testId}"]`);
  const row = (provider: string): HTMLElement =>
    root().querySelector<HTMLElement>(
      `[data-testid="agent-model-row"][data-provider="${provider}"]`,
    ) as HTMLElement;

  /** Drains the mocked RPCs and the guard's async chain. */
  async function settle(): Promise<void> {
    for (let i = 0; i < 4; i++) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      fixture.detectChanges();
    }
  }

  async function click(el: HTMLElement | null): Promise<void> {
    expect(el).not.toBeNull();
    el?.click();
    fixture.detectChanges();
    await settle();
  }

  async function type(value: string): Promise<void> {
    const input = q<HTMLInputElement>('agent-model-input');
    expect(input).not.toBeNull();
    if (input === null) return;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await settle();
  }

  async function editCodex(value: string): Promise<void> {
    await click(q('agent-model-edit-btn', row('codex')));
    await type(value);
  }

  describe('rows', () => {
    it('shows each effective value with its source, and what an empty row inherits', async () => {
      setup();
      await settle();

      expect(q('agent-model-source', row('claude'))?.textContent).toContain(
        'template',
      );
      expect(q('agent-model-value', row('codex'))?.textContent).toContain(
        'gpt-5',
      );
      expect(q('agent-model-source', row('codex'))?.textContent).toContain(
        'workspace override',
      );
      expect(q('agent-model-class', row('codex'))?.textContent).toContain(
        'listed',
      );
      expect(q('agent-model-source', row('copilot'))?.textContent).toContain(
        'machine default, all agents',
      );
      expect(q('agent-model-source', row('opencode'))?.textContent).toContain(
        'inherits: CLI default',
      );
    });

    it('names the lane default an empty row inherits', async () => {
      setup(
        models({
          workspace: null,
          classification: { machine: {}, workspace: {} },
        }),
      );
      await settle();

      expect(q('agent-model-source', row('codex'))?.textContent).toContain(
        'inherits: gpt-5-codex (lane default)',
      );
    });

    it('labels a stored value from the server classification', async () => {
      setup(
        models({
          classification: {
            machine: { '*': { copilot: 'listed' } },
            workspace: { reviewer: { codex: 'unlisted' } },
          },
        }),
      );
      await settle();

      expect(q('agent-model-class', row('codex'))?.textContent).toContain(
        'not in provider list',
      );
    });

    it('disables an unsupported provider row up front', async () => {
      setup();
      await settle();

      const edit = q<HTMLButtonElement>('agent-model-edit-btn', row('cursor'));
      expect(edit?.disabled).toBe(true);
      expect(
        q('agent-model-unsupported', row('cursor'))?.textContent,
      ).toContain('Not supported for Cursor');
    });

    it('with no folder open offers no editing', async () => {
      setup(models({ workspaceRoot: null, machine: null, workspace: null }));
      await settle();

      expect(q('agent-model-no-folder')).not.toBeNull();
      expect(q('agent-model-edit-btn')).toBeNull();
    });

    it('feeds the input suggestions from agent:listCliModels', async () => {
      setup();
      await settle();
      await click(q('agent-model-edit-btn', row('codex')));

      const options = Array.from(
        root().querySelectorAll('datalist option'),
      ).map((o) => (o as HTMLOptionElement).value);
      expect(options).toEqual(['gpt-5', 'o3']);
    });
  });

  describe('editing', () => {
    it('states the machine scope applies to every workspace before saving (AC7)', async () => {
      setup();
      await settle();
      await click(q('agent-model-edit-btn', row('codex')));
      expect(q('agent-model-machine-copy')).toBeNull();

      await click(q('agent-model-scope-machine'));

      expect(q('agent-model-machine-copy')?.textContent).toContain(
        MACHINE_SCOPE_COPY,
      );
    });

    it('blocks a malformed value before any call', async () => {
      setup();
      await settle();
      await editCodex('gpt 5');

      expect(q<HTMLButtonElement>('agent-model-save-btn')?.disabled).toBe(true);
      expect(log).not.toContain('harness:health');
    });
  });

  describe('save', () => {
    it('with no hand-edited files saves with the loaded workspaceRoot, then reconciles', async () => {
      setup();
      await settle();
      await editCodex('o3');
      await click(q('agent-model-save-btn'));

      expect(rpc.setAgentModel).toHaveBeenCalledTimes(1);
      expect(rpc.setAgentModel).toHaveBeenCalledWith({
        workspaceRoot: '/ws/resolved',
        slug: 'reviewer',
        provider: 'codex',
        scope: 'workspace',
        value: 'o3',
      });
      expect(log.slice(-3)).toEqual([
        'harness:health',
        'set:o3',
        'harness:reconcile',
      ]);
      expect(q('agent-model-form')).toBeNull();
      expect(q('agent-model-value', row('codex'))?.textContent).toContain('o3');
    });

    it('health-read failure: nothing is saved, the value stays, Retry is offered', async () => {
      setup();
      await settle();
      healthReply = () => fail('verify failed');
      await editCodex('o3');
      await click(q('agent-model-save-btn'));
      // The guard says it could not check; the user closes it.
      await click(q('reconcile-guard-cancel'));

      expect(rpc.setAgentModel).not.toHaveBeenCalled();
      expect(q('agent-model-guard-failed')?.textContent).toContain(
        GUARD_FAILED_COPY,
      );
      expect(q<HTMLInputElement>('agent-model-input')?.value).toBe('o3');
      expect(log).not.toContain('harness:reconcile');
    });

    it('Retry after the health read recovers saves exactly once', async () => {
      setup();
      await settle();
      healthReply = () => fail('verify failed');
      await editCodex('o3');
      await click(q('agent-model-save-btn'));
      await click(q('reconcile-guard-cancel'));

      healthReply = () => ok({ health: report() });
      await click(q('agent-model-retry-btn'));

      expect(rpc.setAgentModel).toHaveBeenCalledTimes(1);
      expect(q('agent-model-guard-failed')).toBeNull();
      expect(log.at(-1)).toBe('harness:reconcile');
    });

    it('user Cancel at the guard saves nothing and shows no failure', async () => {
      setup();
      await settle();
      healthReply = () =>
        ok({ health: report(['.codex/agents/reviewer.toml']) });
      await editCodex('o3');
      await click(q('agent-model-save-btn'));
      expect(q('reconcile-guard-confirm')).not.toBeNull();

      await click(q('reconcile-guard-cancel'));

      expect(rpc.setAgentModel).not.toHaveBeenCalled();
      expect(q('agent-model-guard-failed')).toBeNull();
      expect(q('agent-model-save-failed')).toBeNull();
      expect(q('agent-model-form')).toBeNull();
      expect(q('agent-model-value', row('codex'))?.textContent).toContain(
        'gpt-5',
      );
    });

    it('asks before saving an unlisted value, then sends confirmUnlisted', async () => {
      setup();
      await settle();
      await editCodex('gpt-6-preview');
      await click(q('agent-model-save-btn'));

      expect(q('agent-model-confirm-unlisted')).not.toBeNull();
      expect(rpc.setAgentModel).not.toHaveBeenCalled();

      await click(q('agent-model-confirm-unlisted-btn'));

      expect(rpc.setAgentModel).toHaveBeenCalledWith(
        expect.objectContaining({
          value: 'gpt-6-preview',
          confirmUnlisted: true,
        }),
      );
    });

    it('MODEL_NOT_AVAILABLE from the server asks, then resends confirmed', async () => {
      setup();
      await settle();
      rpc.setAgentModel.mockResolvedValueOnce({
        ok: false,
        code: 'MODEL_NOT_AVAILABLE',
        message: 'needs confirmation',
      });
      await editCodex('o3');
      await click(q('agent-model-save-btn'));

      expect(q('agent-model-confirm-unlisted')?.textContent).toContain(
        'needs confirmation',
      );
      await click(q('agent-model-confirm-unlisted-btn'));

      expect(rpc.setAgentModel).toHaveBeenCalledTimes(2);
      expect(rpc.setAgentModel.mock.calls[1][0]).toEqual(
        expect.objectContaining({ confirmUnlisted: true }),
      );
    });

    it.each(['INVALID_PARAMS', 'PERSISTENCE_UNAVAILABLE'])(
      '%s keeps the previous value and shows the reason',
      async (code) => {
        setup();
        await settle();
        rpc.setAgentModel.mockResolvedValueOnce({
          ok: false,
          code,
          message: 'the save failed',
        });
        await editCodex('o3');
        await click(q('agent-model-save-btn'));

        expect(q('agent-model-save-failed')?.textContent).toContain(
          'Not saved: the save failed',
        );
        expect(q('agent-model-value', row('codex'))?.textContent).toContain(
          'gpt-5',
        );
        expect(q<HTMLInputElement>('agent-model-input')?.value).toBe('o3');
        expect(log).not.toContain('harness:reconcile');
      },
    );

    it('UNAUTHORIZED_WORKSPACE reloads the models and saves nothing', async () => {
      setup();
      await settle();
      rpc.setAgentModel.mockResolvedValueOnce({
        ok: false,
        code: 'UNAUTHORIZED_WORKSPACE',
        message: 'workspace changed; reload',
      });
      await editCodex('o3');
      await click(q('agent-model-save-btn'));

      expect(rpc.getAgentModels).toHaveBeenCalledTimes(2);
      expect(q('agent-model-notice', row('codex'))?.textContent).toContain(
        'workspace changed',
      );
      expect(log).not.toContain('harness:reconcile');
    });

    it('reconcile failure after a save says so and offers Sync', async () => {
      setup();
      await settle();
      reconcileReply = () => fail('codex target is locked');
      await editCodex('o3');
      await click(q('agent-model-save-btn'));

      expect(q('agent-model-notice', row('codex'))?.textContent).toContain(
        'Saved; provider copies not updated: codex target is locked',
      );
      expect(q('agent-model-sync-btn', row('codex'))).not.toBeNull();
    });
  });

  describe('lifecycle and stale replies', () => {
    it.each([
      ['no hand-edited files', [] as string[]],
      ['hand-edited files', ['.codex/agents/reviewer.toml']],
    ])(
      'destroyed while the guard health read is pending (%s): nothing is saved or reconciled',
      async (_label, localEdit) => {
        setup();
        await settle();
        const health = deferred<unknown>();
        healthReply = () => health.promise;
        await editCodex('o3');
        await click(q('agent-model-save-btn'));
        expect(log.at(-1)).toBe('harness:health');

        fixture.destroy();
        health.resolve(ok({ health: report(localEdit) }));
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        await new Promise<void>((resolve) => setTimeout(resolve, 0));

        expect(rpc.setAgentModel).not.toHaveBeenCalled();
        expect(log).not.toContain('harness:reconcile');
      },
    );

    it('a save reply that arrives after a workspace switch is discarded', async () => {
      setup();
      await settle();
      const save = deferred<AgentModelSaveOutcome>();
      rpc.setAgentModel.mockImplementationOnce(() => save.promise);
      await editCodex('o3');
      await click(q('agent-model-save-btn'));
      expect(rpc.setAgentModel).toHaveBeenCalledTimes(1);

      rpc.getAgentModels.mockResolvedValue(
        models({
          workspaceRoot: '/other/resolved',
          workspace: { reviewer: { codex: 'gpt-5' } },
        }),
      );
      config.set({ isElectron: true, workspaceRoot: '/other' });
      fixture.detectChanges();
      await settle();
      // The draft belonged to the old workspace.
      expect(q('agent-model-form')).toBeNull();

      save.resolve(saved());
      await settle();

      expect(q('agent-model-value', row('codex'))?.textContent).toContain(
        'gpt-5',
      );
      expect(fixture.componentInstance.store.snapshot()?.workspaceRoot).toBe(
        '/other/resolved',
      );
      expect(log).not.toContain('harness:reconcile');
      expect(q('agent-model-notice')).toBeNull();
    });

    it('a workspace switch drops an open draft', async () => {
      setup();
      await settle();
      await editCodex('o3');
      expect(q('agent-model-form')).not.toBeNull();

      config.set({ isElectron: true, workspaceRoot: '/other' });
      fixture.detectChanges();
      await settle();

      expect(q('agent-model-form')).toBeNull();
    });

    it('a load that started before a successful save cannot restore the older value', async () => {
      setup();
      await settle();
      const load = deferred<SkillSynthesisGetAgentModelsResult>();
      rpc.getAgentModels.mockImplementationOnce(() => load.promise);
      const refresh = fixture.componentInstance.store.load();

      await editCodex('o3');
      await click(q('agent-model-save-btn'));
      expect(q('agent-model-value', row('codex'))?.textContent).toContain('o3');

      load.resolve(models());
      await refresh;
      fixture.detectChanges();

      expect(q('agent-model-value', row('codex'))?.textContent).toContain('o3');
      expect(fixture.componentInstance.store.loading()).toBe(false);
    });

    it('guard unverified, then a healthChanged push before Close: still unverified, draft kept', async () => {
      setup();
      await settle();
      // The fresh read answers with no report (workspace still opening).
      healthReply = () => ok({ health: null });
      await editCodex('o3');
      await click(q('agent-model-save-btn'));
      expect(q('reconcile-guard-unverified')).not.toBeNull();

      TestBed.inject(HarnessHealthStore).handleMessage({
        type: MESSAGE_TYPES.HARNESS_HEALTH_CHANGED,
        payload: { health: report() },
      });
      await click(q('reconcile-guard-cancel'));

      expect(rpc.setAgentModel).not.toHaveBeenCalled();
      expect(q('agent-model-guard-failed')?.textContent).toContain(
        GUARD_FAILED_COPY,
      );
      expect(q('agent-model-retry-btn')).not.toBeNull();
      expect(q<HTMLInputElement>('agent-model-input')?.value).toBe('o3');
    });
  });

  describe('after the save', () => {
    it('a reconcile skipped because another pass is running says so and offers Sync', async () => {
      setup();
      await settle();
      const harness = TestBed.inject(HarnessHealthStore);
      const other = deferred<unknown>();
      rpc.setAgentModel.mockImplementationOnce(
        async (params: { value: string | null }) => {
          log.push(`set:${params.value}`);
          // Another surface starts a pass while this save is in flight.
          reconcileReply = () => other.promise;
          void harness.reconcile();
          return saved();
        },
      );
      await editCodex('o3');
      await click(q('agent-model-save-btn'));

      expect(q('agent-model-notice', row('codex'))?.textContent).toContain(
        SYNC_SKIPPED_COPY,
      );
      expect(q('agent-model-sync-btn', row('codex'))).not.toBeNull();
      expect(log.filter((m) => m === 'harness:reconcile')).toHaveLength(1);

      other.resolve(ok({ health: report() }));
      await settle();
      expect(
        q<HTMLButtonElement>('agent-model-sync-btn', row('codex'))?.disabled,
      ).toBe(false);
    });

    it('a reconcile report with writeFailed is a partial failure with paths, reasons and Sync', async () => {
      setup();
      await settle();
      reconcileReply = () =>
        ok({
          health: {
            ...report(),
            targets: [
              {
                target: 'codex',
                localEdit: [],
                writeFailed: [
                  { relPath: '.codex/agents/reviewer.toml', reason: 'EACCES' },
                ],
              } as unknown as HarnessHealth['targets'][number],
            ],
          },
        });
      await editCodex('o3');
      await click(q('agent-model-save-btn'));

      const notice = q('agent-model-notice', row('codex'))?.textContent ?? '';
      expect(notice).toContain('Saved; provider copies not fully updated');
      expect(notice).toContain(
        '1 file could not be written: .codex/agents/reviewer.toml (EACCES)',
      );
      expect(q('agent-model-sync-btn', row('codex'))).not.toBeNull();
    });
  });

  it('reloads the models when the workspace changes (WORKSPACE_CHANGED)', async () => {
    setup();
    await settle();
    expect(rpc.getAgentModels).toHaveBeenCalledTimes(1);

    config.set({ isElectron: true, workspaceRoot: '/other' });
    fixture.detectChanges();
    await settle();

    expect(rpc.getAgentModels).toHaveBeenCalledTimes(2);
  });

  it('shows a load failure with its reason', async () => {
    setup();
    await settle();
    rpc.getAgentModels.mockRejectedValueOnce(new Error('no settings here'));
    await fixture.componentInstance.store.load();
    fixture.detectChanges();

    expect(q('agent-model-load-error')?.textContent).toContain(
      'no settings here',
    );
  });
});
