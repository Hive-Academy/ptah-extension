import {
  ChangeDetectionStrategy,
  Component,
  inject,
  viewChild,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ClaudeRpcService } from '@ptah-extension/core';
import { HarnessHealthStore } from '@ptah-extension/marketplace/services';
import type {
  HarnessHealth,
  HarnessTargetHealth,
  HarnessTargetId,
} from '@ptah-extension/shared';

import {
  RECONCILE_HISTORY_NOTE,
  RECONCILE_OVERWRITE_NOTE,
  RECONCILE_WHOLE_WORKSPACE_NOTICE,
  ReconcileGuardComponent,
  groupLocalEdits,
  type ReconcileGuardOptions,
} from './reconcile-guard';

/**
 * jsdom implements no HTMLDialogElement methods; the stub reflects the `open`
 * attribute (same approach as `native-modal.component.spec.ts`).
 */
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

function target(
  id: HarnessTargetId,
  localEdit: string[] = [],
): HarnessTargetHealth {
  return {
    target: id,
    detected: true,
    facets: {
      skills: 'supported',
      commands: 'supported',
      agents: id === 'claude' ? 'source-managed' : 'supported',
      mcp: 'supported',
    },
    expected: 0,
    found: 0,
    missing: [],
    foreign: [],
    writeFailed: [],
    overwrittenLocalEdit: [],
    removed: [],
    localEdit,
    agentsInSync: [],
    durationMs: 1,
  };
}

function health(targets: HarnessTargetHealth[]): HarnessHealth {
  return {
    workspaceRoot: '/ws',
    generatedAt: '2026-10-03T00:00:00.000Z',
    mode: 'preflight',
    reason: 'test',
    sources: 'ok',
    targets,
    collisions: [],
  };
}

const ok = <T>(data: T) => ({ success: true, isSuccess: () => true, data });
const fail = (error: string) => ({
  success: false,
  isSuccess: () => false,
  error,
});

/**
 * A caller shaped exactly like the Sync action B-3b wires: guard first, the
 * mutation only on `true`.
 */
@Component({
  standalone: true,
  imports: [ReconcileGuardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<ptah-reconcile-guard />`,
})
class SyncHostComponent {
  public readonly guard = viewChild.required(ReconcileGuardComponent);
  public readonly store = inject(HarnessHealthStore);

  public async sync(options?: ReconcileGuardOptions): Promise<boolean> {
    if (!(await this.guard().confirm(options))) return false;
    await this.store.reconcile();
    return true;
  }
}

describe('ReconcileGuardComponent', () => {
  let fixture: ComponentFixture<SyncHostComponent>;
  let host: SyncHostComponent;
  let rpcCall: jest.Mock;
  /** Report `harness:health` answers with for a `{ refresh: true }` call. */
  let freshReport: HarnessHealth;
  /** Report `harness:health` answers with for a cached (`{}`) call. */
  let cachedReport: HarnessHealth;

  beforeEach(() => {
    cachedReport = health([target('claude'), target('codex')]);
    freshReport = cachedReport;
    rpcCall = jest.fn(async (method: string, params: { refresh?: boolean }) => {
      if (method === 'harness:health') {
        return ok({
          health: params.refresh === true ? freshReport : cachedReport,
        });
      }
      if (method === 'harness:reconcile') {
        return ok({ health: freshReport });
      }
      throw new Error(`unexpected RPC ${method}`);
    });
    TestBed.configureTestingModule({
      imports: [SyncHostComponent],
      providers: [
        {
          provide: ClaudeRpcService,
          useValue: { call: rpcCall as unknown as ClaudeRpcService['call'] },
        },
      ],
    });
    fixture = TestBed.createComponent(SyncHostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => TestBed.resetTestingModule());

  const root = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const q = (testId: string): HTMLElement | null =>
    root().querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  const paths = (section: string): string[] =>
    Array.from(
      q(section)?.querySelectorAll(
        '[data-testid="reconcile-guard-path"] code',
      ) ?? [],
    ).map((node) => node.textContent?.trim() ?? '');
  const methods = (): string[] =>
    rpcCall.mock.calls.map((call) => call[0] as string);

  /**
   * Let the fresh read settle and render the modal. A macrotask turn drains
   * every microtask the mocked RPC and the store's `async` chain queue.
   */
  async function settle(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
  }

  it('cancel resolves false and performs no reconcile', async () => {
    freshReport = health([target('codex', ['.codex/agents/reviewer.toml'])]);
    const result = host.sync({ confirmLabel: 'Sync' });
    await settle();

    expect(q('reconcile-guard-confirm')?.textContent?.trim()).toBe('Sync');
    q('reconcile-guard-cancel')?.click();
    fixture.detectChanges();

    await expect(result).resolves.toBe(false);
    expect(methods()).toEqual(['harness:health']);
    expect(q('native-modal-dialog')?.hasAttribute('open')).toBe(false);
  });

  it('Escape (the native dialog cancel) resolves false and performs no reconcile', async () => {
    const result = host.sync();
    await settle();

    q('native-modal-dialog')?.dispatchEvent(new Event('cancel'));
    fixture.detectChanges();

    await expect(result).resolves.toBe(false);
    expect(methods()).not.toContain('harness:reconcile');
  });

  it('confirm resolves true and the caller reconciles after the fresh read', async () => {
    const result = host.sync();
    await settle();

    q('reconcile-guard-confirm')?.click();
    await expect(result).resolves.toBe(true);
    expect(methods()).toEqual(['harness:health', 'harness:reconcile']);
  });

  it('always reads fresh: an edit made after the tab loaded is listed', async () => {
    // Tab entry: the cached report, no edits.
    await host.store.refresh();
    expect(groupLocalEdits(host.store.health() as HarnessHealth)).toEqual({
      snapshotted: [],
      overwriteOnly: [],
    });

    // The user hand-edits a Codex agent copy while the tab is open.
    freshReport = health([
      target('claude'),
      target('codex', ['.codex/agents/reviewer.toml']),
    ]);
    const result = host.sync();
    await settle();

    expect(rpcCall).toHaveBeenNthCalledWith(
      1,
      'harness:health',
      {},
      expect.any(Object),
    );
    expect(rpcCall).toHaveBeenNthCalledWith(
      2,
      'harness:health',
      { refresh: true },
      expect.any(Object),
    );
    expect(paths('reconcile-guard-snapshotted')).toEqual([
      '.codex/agents/reviewer.toml',
    ]);

    q('reconcile-guard-cancel')?.click();
    await expect(result).resolves.toBe(false);
  });

  it('lists unrelated skill and MCP edits, not only agent copies', async () => {
    freshReport = health([
      target('claude'),
      target('codex', ['.agents/skills/lint-fix']),
      target('cursor', ['.cursor/mcp.json#github']),
    ]);
    const result = host.sync();
    await settle();

    expect(paths('reconcile-guard-snapshotted')).toEqual([
      '.agents/skills/lint-fix',
    ]);
    expect(paths('reconcile-guard-overwrite-only')).toEqual([
      '.cursor/mcp.json#github',
    ]);

    q('reconcile-guard-cancel')?.click();
    await expect(result).resolves.toBe(false);
  });

  it('promises a .history snapshot only for the Codex path, not for the Claude or MCP path', async () => {
    freshReport = health([
      target('claude', ['.claude/skills/orchestration']),
      target('codex', [
        '.codex/agents/reviewer.toml',
        '.codex/config.toml#ptah',
      ]),
    ]);
    const result = host.sync();
    await settle();

    const snapshotted = q('reconcile-guard-snapshotted');
    const overwriteOnly = q('reconcile-guard-overwrite-only');
    expect(paths('reconcile-guard-snapshotted')).toEqual([
      '.codex/agents/reviewer.toml',
    ]);
    expect(snapshotted?.textContent).toContain(RECONCILE_HISTORY_NOTE);
    expect(paths('reconcile-guard-overwrite-only')).toEqual([
      '.claude/skills/orchestration',
      '.codex/config.toml#ptah',
    ]);
    expect(overwriteOnly?.textContent).toContain(RECONCILE_OVERWRITE_NOTE);
    expect(overwriteOnly?.textContent).not.toContain('.history');
    expect(
      root().querySelectorAll('[data-testid="reconcile-guard-history-note"]'),
    ).toHaveLength(1);

    q('reconcile-guard-cancel')?.click();
    await expect(result).resolves.toBe(false);
  });

  it('makes no snapshot promise at all when only a Claude path is edited', async () => {
    freshReport = health([target('claude', ['.claude/commands/review.md'])]);
    const result = host.sync();
    await settle();

    expect(q('reconcile-guard-snapshotted')).toBeNull();
    expect(q('reconcile-guard-history-note')).toBeNull();
    expect(root().textContent).not.toContain('.ptah/harness/.history/');
    expect(q('reconcile-guard-overwrite-note')?.textContent?.trim()).toBe(
      RECONCILE_OVERWRITE_NOTE,
    );

    q('reconcile-guard-cancel')?.click();
    await expect(result).resolves.toBe(false);
  });

  it('always shows the whole-workspace notice verbatim, and says when nothing is edited', async () => {
    const result = host.sync();
    await settle();

    expect(q('reconcile-guard-scope')?.textContent?.trim()).toBe(
      RECONCILE_WHOLE_WORKSPACE_NOTICE,
    );
    expect(RECONCILE_WHOLE_WORKSPACE_NOTICE).toBe(
      'This updates every Ptah-managed file in this workspace (agents, skills, commands, MCP config) for all detected providers.',
    );
    expect(q('reconcile-guard-no-edits')).not.toBeNull();

    q('reconcile-guard-cancel')?.click();
    await expect(result).resolves.toBe(false);
  });

  it('onlyWhenEdits: passes without a modal when the fresh report has no edits', async () => {
    await expect(host.sync({ onlyWhenEdits: true })).resolves.toBe(true);
    expect(methods()).toEqual(['harness:health', 'harness:reconcile']);
    expect(rpcCall.mock.calls[0][1]).toEqual({ refresh: true });
  });

  it('onlyWhenEdits: still asks when the fresh report has an edit', async () => {
    freshReport = health([target('codex', ['.codex/agents/reviewer.toml'])]);
    const result = host.sync({ onlyWhenEdits: true });
    await settle();

    expect(q('native-modal-dialog')?.hasAttribute('open')).toBe(true);
    q('reconcile-guard-cancel')?.click();
    await expect(result).resolves.toBe(false);
    expect(methods()).not.toContain('harness:reconcile');
  });

  it('a failed fresh read is shown and blocks the mutation, even with onlyWhenEdits', async () => {
    rpcCall.mockImplementation(async (method: string) =>
      method === 'harness:health' ? fail('health read timed out') : ok({}),
    );
    const result = host.sync({ onlyWhenEdits: true });
    await settle();

    expect(q('reconcile-guard-unverified')?.textContent).toContain(
      'health read timed out',
    );
    expect(q('reconcile-guard-confirm')).toBeNull();
    q('reconcile-guard-cancel')?.click();
    await expect(result).resolves.toBe(false);
    expect(methods()).toEqual(['harness:health']);
  });

  it('a harness call already in flight blocks the guard instead of trusting a stale report', async () => {
    let release: (() => void) | undefined;
    rpcCall.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(ok({ health: cachedReport }));
        }),
    );
    const tabLoad = host.store.refresh();
    expect(host.store.busy()).toBe(true);

    const result = host.sync();
    await Promise.resolve();
    fixture.detectChanges();

    expect(q('reconcile-guard-unverified')).not.toBeNull();
    q('reconcile-guard-cancel')?.click();
    await expect(result).resolves.toBe(false);
    expect(methods()).toEqual(['harness:health']);

    release?.();
    await tabLoad;
  });

  it('a second confirm while one is open resolves false without touching the first', async () => {
    const first = host.sync();
    await settle();

    await expect(host.guard().confirm()).resolves.toBe(false);

    q('reconcile-guard-confirm')?.click();
    await expect(first).resolves.toBe(true);
  });
});

describe('groupLocalEdits', () => {
  it('collects every target and facet, de-duplicated per target', () => {
    const report = health([
      target('claude', ['.claude/agents/reviewer.md', '.mcp.json#github']),
      target('codex', [
        '.codex/agents/reviewer.toml',
        '.codex/agents/reviewer.toml',
      ]),
      target('opencode', ['.opencode/command/review.md']),
      target('cursor'),
    ]);

    expect(groupLocalEdits(report)).toEqual({
      snapshotted: [
        { target: 'codex', path: '.codex/agents/reviewer.toml' },
        { target: 'opencode', path: '.opencode/command/review.md' },
      ],
      overwriteOnly: [
        { target: 'claude', path: '.claude/agents/reviewer.md' },
        { target: 'claude', path: '.mcp.json#github' },
      ],
    });
  });

  it('treats a report without localEdit (an older host) as no edits', () => {
    const legacy = { ...target('codex'), localEdit: undefined };
    expect(groupLocalEdits(health([legacy]))).toEqual({
      snapshotted: [],
      overwriteOnly: [],
    });
  });
});
