import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ClaudeRpcService } from '@ptah-extension/core';
import type {
  HarnessHealth,
  QuarantinedAgentEntry,
  SkillSynthesisListQuarantinedAgentsResult,
  SkillSynthesisRestoreQuarantinedAgentResult,
} from '@ptah-extension/shared';

import { SkillSynthesisRpcService } from '../../services/skill-synthesis-rpc.service';
import { SkillClonesStateService } from '../../services/skill-clones-state.service';
import { ReconcileGuardComponent } from './reconcile-guard';
import {
  QUARANTINE_SYNC_OFF_COPY,
  QUARANTINE_SYNC_RETRY_COPY,
  QuarantinedAgentsPanelComponent,
  type QuarantineNotice,
} from './quarantined-agents-panel.component';

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

/** The panel as the view places it: next to the one guard. */
@Component({
  standalone: true,
  imports: [ReconcileGuardComponent, QuarantinedAgentsPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ptah-reconcile-guard #guard />
    <ptah-quarantined-agents-panel
      [guard]="guard"
      (notice)="notices.push($event)"
      (notOwnedChange)="notOwned.push($event)"
    />
  `,
})
class PanelHostComponent {
  public readonly notices: QuarantineNotice[] = [];
  public readonly notOwned: (readonly string[])[] = [];
}

function entry(
  overrides: Partial<QuarantinedAgentEntry> = {},
): QuarantinedAgentEntry {
  return {
    slug: 'video-director',
    state: 'quarantined',
    quarantinedAt: '2026-09-30T12:00:00.000Z',
    hasSnapshot: true,
    sourcePath: '/ws/.claude/agents/video-director.md',
    ...overrides,
  };
}

function listing(
  overrides: Partial<SkillSynthesisListQuarantinedAgentsResult> = {},
): SkillSynthesisListQuarantinedAgentsResult {
  return {
    workspaceRoot: '/ws',
    agentSync: 'enabled',
    quarantined: [entry()],
    notOwned: [],
    ...overrides,
  };
}

function restoreResult(
  overrides: Partial<SkillSynthesisRestoreQuarantinedAgentResult> = {},
): SkillSynthesisRestoreQuarantinedAgentResult {
  return {
    outcome: 'restored',
    path: '/ws/.claude/agents/video-director.md',
    agentSync: 'enabled',
    ...overrides,
  };
}

const report: HarnessHealth = {
  workspaceRoot: '/ws',
  generatedAt: '2026-10-03T00:00:00.000Z',
  mode: 'preflight',
  reason: 'test',
  sources: 'ok',
  targets: [],
  collisions: [],
};

const ok = <T>(data: T) => ({ success: true, isSuccess: () => true, data });

/** A reconcile report whose Codex copy of the agent could not be written. */
const partialReport: HarnessHealth = {
  ...report,
  targets: [
    {
      target: 'codex',
      writeFailed: [
        { relPath: '.codex/agents/video-director.toml', reason: 'EACCES' },
      ],
    } as unknown as HarnessHealth['targets'][number],
  ],
};

describe('QuarantinedAgentsPanelComponent', () => {
  let fixture: ComponentFixture<PanelHostComponent>;
  let host: PanelHostComponent;
  /** Every call that reaches a backend, in order. */
  let log: string[];
  let rpc: {
    listQuarantinedAgents: jest.Mock;
    restoreQuarantinedAgent: jest.Mock;
  };
  let harnessCall: jest.Mock;
  let refreshClones: jest.Mock;

  function setup(
    list: SkillSynthesisListQuarantinedAgentsResult | Error = listing(),
  ): void {
    log = [];
    rpc = {
      listQuarantinedAgents: jest.fn(async () => {
        log.push('list');
        if (list instanceof Error) throw list;
        return list;
      }),
      restoreQuarantinedAgent: jest.fn(async (slug: string) => {
        log.push(`restore:${slug}`);
        return restoreResult();
      }),
    };
    harnessCall = jest.fn(async (method: string) => {
      log.push(method);
      return ok({ health: report });
    });
    refreshClones = jest.fn(async () => {
      log.push('refreshClones');
    });
    TestBed.configureTestingModule({
      imports: [PanelHostComponent],
      providers: [
        { provide: SkillSynthesisRpcService, useValue: rpc },
        { provide: SkillClonesStateService, useValue: { refreshClones } },
        {
          provide: ClaudeRpcService,
          useValue: {
            call: harnessCall as unknown as ClaudeRpcService['call'],
          },
        },
      ],
    });
    fixture = TestBed.createComponent(PanelHostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  }

  afterEach(() => TestBed.resetTestingModule());

  const root = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement = HTMLElement>(testId: string): T | null =>
    root().querySelector<T>(`[data-testid="${testId}"]`);
  const all = (testId: string): HTMLElement[] =>
    Array.from(root().querySelectorAll(`[data-testid="${testId}"]`));

  /** One macrotask turn drains the mocked RPCs and the async chains. */
  async function settle(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
  }

  async function click(testId: string): Promise<void> {
    q<HTMLButtonElement>(testId)?.click();
    fixture.detectChanges();
    await settle();
  }

  describe('listing', () => {
    it('shows the count, each slug, its date or "date unknown", and its state', async () => {
      setup(
        listing({
          quarantined: [
            entry(),
            entry({
              slug: 'figma-designer',
              quarantinedAt: null,
              state: 'source-restored',
            }),
          ],
        }),
      );
      await settle();

      expect(q('quarantine-count')?.textContent?.trim()).toBe('2');
      const items = all('quarantine-item');
      expect(items).toHaveLength(2);
      expect(items[0].textContent).toContain('video-director');
      expect(items[0].querySelector('time')?.getAttribute('datetime')).toBe(
        '2026-09-30T12:00:00.000Z',
      );
      expect(
        items[0].querySelector('[data-testid="quarantine-state"]')?.textContent,
      ).toContain('quarantined');
      expect(
        items[1].querySelector('[data-testid="quarantine-date"]')?.textContent,
      ).toContain('date unknown');
      expect(
        items[1].querySelector('[data-testid="quarantine-state"]')?.textContent,
      ).toContain('restored, not yet synced');
    });

    it('shows the empty copy when a folder is open and nothing is quarantined', async () => {
      setup(listing({ quarantined: [] }));
      await settle();

      expect(q('quarantine-empty')?.textContent).toContain(
        'No agents are quarantined',
      );
      expect(q('quarantine-no-folder')).toBeNull();
      expect(q('quarantine-count')?.textContent?.trim()).toBe('0');
    });

    it('with no folder open shows a distinct state and offers no Restore', async () => {
      setup(
        listing({
          workspaceRoot: null,
          agentSync: 'unknown',
          quarantined: [],
          notOwned: [],
        }),
      );
      await settle();

      expect(q('quarantine-no-folder')?.textContent).toContain(
        'Open a workspace folder',
      );
      expect(q('quarantine-empty')).toBeNull();
      expect(q('quarantine-count')).toBeNull();
      expect(q('quarantine-restore-btn')).toBeNull();
      expect(q('quarantine-finish-btn')).toBeNull();
    });

    it('shows a thrown list error as an error with its message, not as an empty list', async () => {
      setup(new Error('Persistence is unavailable'));
      await settle();

      expect(q('quarantine-error')?.textContent).toContain(
        'Persistence is unavailable',
      );
      expect(q('quarantine-empty')).toBeNull();
      expect(q('quarantine-no-folder')).toBeNull();
      expect(host.notOwned.at(-1)).toEqual([]);
    });

    it('shows an unreadable quarantine record as a muted note, not an error', async () => {
      setup(listing({ recordUnreadable: true, quarantined: [] }));
      await settle();

      const note = q('quarantine-record-unreadable');
      expect(note?.textContent).toContain('could not be read');
      expect(note?.getAttribute('role')).toBeNull();
      expect(q('quarantine-error')).toBeNull();
    });

    it('reports the kept foreign slugs to the host', async () => {
      setup(listing({ notOwned: ['local-helper'] }));
      await settle();
      expect(host.notOwned.at(-1)).toEqual(['local-helper']);
    });

    it('disables Restore and says why when there is no snapshot', async () => {
      setup(listing({ quarantined: [entry({ hasSnapshot: false })] }));
      await settle();

      expect(q<HTMLButtonElement>('quarantine-restore-btn')?.disabled).toBe(
        true,
      );
      expect(q('quarantine-no-snapshot')?.textContent).toContain(
        'no snapshot found',
      );
    });
  });

  describe('Restore with agent sync on', () => {
    it('discloses the destination file before anything runs; Cancel writes nothing', async () => {
      setup();
      await settle();

      await click('quarantine-restore-btn');

      expect(q('quarantine-restore-disclosure')?.textContent?.trim()).toBe(
        'Adds .claude/agents/video-director.md to this workspace as a source file it owns (visible to git); the quarantine snapshot is kept.',
      );
      expect(q('quarantine-restore-sync-off')).toBeNull();

      await click('quarantine-restore-cancel');
      expect(log).toEqual(['list']);
    });

    it('cancel at the reconcile guard restores nothing and reconciles nothing', async () => {
      setup();
      await settle();

      await click('quarantine-restore-btn');
      await click('quarantine-restore-confirm');
      expect(q('reconcile-guard-confirm')?.textContent?.trim()).toBe('Restore');

      await click('reconcile-guard-cancel');

      expect(rpc.restoreQuarantinedAgent).not.toHaveBeenCalled();
      expect(log).toEqual(['list', 'harness:health']);
    });

    it('runs guard → restore → reconcile → re-list → refresh clones, in that order', async () => {
      setup();
      await settle();

      await click('quarantine-restore-btn');
      await click('quarantine-restore-confirm');
      await click('reconcile-guard-confirm');
      await settle();

      expect(log).toEqual([
        'list',
        'harness:health',
        'restore:video-director',
        'harness:reconcile',
        'list',
        'refreshClones',
      ]);
      expect(host.notices.at(-1)).toEqual({
        message:
          'Restored "video-director" to .claude/agents/video-director.md.',
        kind: 'success',
      });
    });

    it('a thrown restore is an error with its message, never success, and reconciles nothing', async () => {
      setup();
      await settle();
      rpc.restoreQuarantinedAgent.mockRejectedValueOnce(
        new Error('Open a workspace folder to restore a quarantined agent.'),
      );

      await click('quarantine-restore-btn');
      await click('quarantine-restore-confirm');
      await click('reconcile-guard-confirm');
      await settle();

      expect(host.notices.at(-1)?.kind).toBe('error');
      expect(host.notices.at(-1)?.message).toContain(
        'Open a workspace folder to restore a quarantined agent.',
      );
      expect(log).not.toContain('harness:reconcile');
    });

    it('a conflict names the conflicting path and reconciles nothing', async () => {
      setup();
      await settle();
      rpc.restoreQuarantinedAgent.mockResolvedValueOnce(
        restoreResult({
          outcome: 'conflict',
          path: '/ws/.claude/agents/video-director.md',
        }),
      );

      await click('quarantine-restore-btn');
      await click('quarantine-restore-confirm');
      await click('reconcile-guard-confirm');
      await settle();

      expect(host.notices.at(-1)?.kind).toBe('error');
      expect(host.notices.at(-1)?.message).toContain(
        '/ws/.claude/agents/video-director.md',
      );
      expect(log).not.toContain('harness:reconcile');
    });

    it('a copy failure names the path and the reason', async () => {
      setup();
      await settle();
      rpc.restoreQuarantinedAgent.mockResolvedValueOnce(
        restoreResult({ outcome: 'copy-failed', reason: 'EACCES' }),
      );

      await click('quarantine-restore-btn');
      await click('quarantine-restore-confirm');
      await click('reconcile-guard-confirm');
      await settle();

      const last = host.notices.at(-1);
      expect(last?.kind).toBe('error');
      expect(last?.message).toContain('/ws/.claude/agents/video-director.md');
      expect(last?.message).toContain('EACCES');
      expect(log).not.toContain('harness:reconcile');
    });

    it('a reconcile report with writeFailed is a partial failure naming each path and reason, with Sync as the retry', async () => {
      setup();
      await settle();
      harnessCall.mockImplementation(async (method: string) => {
        log.push(method);
        return ok({
          health: method === 'harness:reconcile' ? partialReport : report,
        });
      });

      await click('quarantine-restore-btn');
      await click('quarantine-restore-confirm');
      await click('reconcile-guard-confirm');
      await settle();

      const last = host.notices.at(-1);
      expect(last?.kind).toBe('warning');
      expect(last?.message).toContain(
        'Restored "video-director" to .claude/agents/video-director.md, but provider copies were not fully updated',
      );
      expect(last?.message).toContain(
        '.codex/agents/video-director.toml (EACCES)',
      );
      expect(last?.message).toContain(QUARANTINE_SYNC_RETRY_COPY);
    });
  });

  describe('Restore with agent sync off', () => {
    it('states sync stays off, restores without the guard, and never reconciles', async () => {
      setup(listing({ agentSync: 'disabled' }));
      rpc.restoreQuarantinedAgent.mockImplementation(async (slug: string) => {
        log.push(`restore:${slug}`);
        return restoreResult({ agentSync: 'disabled' });
      });
      await settle();

      expect(q('quarantine-sync-off')?.textContent?.trim()).toBe(
        QUARANTINE_SYNC_OFF_COPY,
      );
      await click('quarantine-restore-btn');
      expect(q('quarantine-restore-sync-off')?.textContent?.trim()).toBe(
        QUARANTINE_SYNC_OFF_COPY,
      );
      expect(q('quarantine-restore-disclosure')?.textContent).toContain(
        '.claude/agents/video-director.md',
      );

      await click('quarantine-restore-confirm');
      await settle();

      expect(q('reconcile-guard-confirm')).toBeNull();
      expect(log).toEqual([
        'list',
        'restore:video-director',
        'list',
        'refreshClones',
      ]);
      expect(host.notices.at(-1)?.kind).toBe('success');
      expect(host.notices.at(-1)?.message).toContain(QUARANTINE_SYNC_OFF_COPY);
    });
  });

  describe('Finish restore', () => {
    it('a source-restored item offers Finish restore = guard → reconcile, with no restore RPC', async () => {
      setup(listing({ quarantined: [entry({ state: 'source-restored' })] }));
      await settle();

      expect(q('quarantine-restore-btn')).toBeNull();
      await click('quarantine-finish-btn');
      expect(q('reconcile-guard-confirm')?.textContent?.trim()).toBe(
        'Finish restore',
      );
      await click('reconcile-guard-confirm');
      await settle();

      expect(rpc.restoreQuarantinedAgent).not.toHaveBeenCalled();
      expect(log).toEqual([
        'list',
        'harness:health',
        'harness:reconcile',
        'list',
        'refreshClones',
      ]);
      expect(host.notices.at(-1)?.kind).toBe('success');
    });

    it('a reconcile report with writeFailed is not announced as updated', async () => {
      setup(listing({ quarantined: [entry({ state: 'source-restored' })] }));
      await settle();
      harnessCall.mockImplementation(async (method: string) => {
        log.push(method);
        return ok({
          health: method === 'harness:reconcile' ? partialReport : report,
        });
      });

      await click('quarantine-finish-btn');
      await click('reconcile-guard-confirm');
      await settle();

      const last = host.notices.at(-1);
      expect(last?.kind).toBe('warning');
      expect(last?.message).not.toContain('Updated provider copies');
      expect(last?.message).toContain(
        '1 file could not be written: .codex/agents/video-director.toml (EACCES)',
      );
      expect(last?.message).toContain(QUARANTINE_SYNC_RETRY_COPY);
    });

    it('cancel at the guard reconciles nothing', async () => {
      setup(listing({ quarantined: [entry({ state: 'source-restored' })] }));
      await settle();

      await click('quarantine-finish-btn');
      await click('reconcile-guard-cancel');

      expect(log).toEqual(['list', 'harness:health']);
    });
  });
});
