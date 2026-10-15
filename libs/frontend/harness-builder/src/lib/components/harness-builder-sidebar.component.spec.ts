import { Component, input, output, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { AppStateManager, LoggingService } from '@ptah-extension/core';
import { HarnessHealthStore } from '@ptah-extension/marketplace/services';
import type { HarnessConfig } from '@ptah-extension/shared';
import { SessionStatsSummaryComponent } from '@ptah-extension/chat-ui';
import { HarnessBuilderSidebarComponent } from './harness-builder-sidebar.component';
import { HarnessConfigPreviewComponent } from './harness-config-preview.component';
import { HarnessBuilderRecordsService } from '../services/harness-builder-records.service';
import { HarnessProposalHydrationService } from '../services/harness-proposal-hydration.service';
import { HarnessHelperService } from '../services/harness-helper.service';
import { HarnessRpcService } from '../services/harness-rpc.service';

@Component({
  selector: 'ptah-harness-config-preview',
  standalone: true,
  template: '',
})
class PreviewStub {
  readonly config = input<unknown>();
  readonly document = input<unknown>();
  readonly mode = input<unknown>();
  readonly status = input<unknown>();
  readonly retry = output<void>();
  readonly proposeAgain = output<void>();
}
@Component({
  selector: 'ptah-session-stats-summary',
  standalone: true,
  template: '',
})
class StatsStub {
  readonly snapshot = input<unknown>();
  readonly liveModelStats = input<unknown>();
}

describe('HarnessBuilderSidebarComponent', () => {
  let fixture: ComponentFixture<HarnessBuilderSidebarComponent>;
  const config = signal<Partial<HarnessConfig>>({
    persona: { label: 'Team', description: 'A team', goals: [] },
  });
  const hydration = {
    config,
    status: signal<'ready' | 'loading' | 'error' | 'unavailable'>('ready'),
    isConfigComplete: signal(false),
    setSnapshot: jest.fn(),
    retry: jest.fn(),
  };
  const records = {
    readStackProfile: jest.fn().mockReturnValue(null),
    readSnapshot: jest.fn().mockReturnValue(null),
    writeSnapshot: jest.fn().mockReturnValue(true),
  };
  const rpc = {
    loadPresets: jest.fn().mockResolvedValue({ presets: [] }),
    apply: jest
      .fn()
      .mockResolvedValue({
        appliedPaths: ['C:/repo/.claude/agents/a.md', 'C:/repo/b.md'],
        warnings: ['Review one file'],
      }),
    savePreset: jest.fn(),
  };
  const helper = {
    busy: signal(null),
    result: signal(null),
    error: signal(null),
    dismiss: jest.fn(),
    addToPreview: jest.fn(),
    suggestConfig: jest.fn().mockResolvedValue(true),
  };
  const health = {
    loading: signal(false),
    summary: signal({ level: 'unknown', label: '' }),
    refresh: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    config.set({
      persona: { label: 'Team', description: 'A team', goals: [] },
    });
    hydration.isConfigComplete.set(false);
    jest.clearAllMocks();
    TestBed.overrideComponent(HarnessBuilderSidebarComponent, {
      remove: {
        imports: [HarnessConfigPreviewComponent, SessionStatsSummaryComponent],
      },
      add: { imports: [PreviewStub, StatsStub] },
    });
    await TestBed.configureTestingModule({
      imports: [HarnessBuilderSidebarComponent],
      providers: [
        { provide: HarnessProposalHydrationService, useValue: hydration },
        { provide: HarnessBuilderRecordsService, useValue: records },
        { provide: HarnessRpcService, useValue: rpc },
        { provide: HarnessHelperService, useValue: helper },
        { provide: HarnessHealthStore, useValue: health },
        {
          provide: AppStateManager,
          useValue: { requestComposerPrefill: jest.fn() },
        },
        { provide: LoggingService, useValue: { error: jest.fn() } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(HarnessBuilderSidebarComponent);
    fixture.componentRef.setInput('tabId', 'tab-1');
    fixture.componentRef.setInput('workspaceRoot', 'C:/repo');
    fixture.componentRef.setInput('initialized', true);
    fixture.detectChanges();
  });

  it.each([360, 400, 720, 960])(
    'keeps one scroll body below a fixed strip at %ipx host width and 480px height',
    (width) => {
      const host = fixture.nativeElement as HTMLElement;
      host.style.width = `${width}px`;
      host.style.height = '480px';
      fixture.detectChanges();
      const aside = host.querySelector('aside') as HTMLElement;
      const strip = host.querySelector(
        '[data-testid="sidebar-strip"]',
      ) as HTMLElement;
      const body = host.querySelector(
        '[data-testid="sidebar-scroll-body"]',
      ) as HTMLElement;
      expect(aside.classList.contains('min-h-0')).toBe(true);
      expect(aside.classList.contains('flex-col')).toBe(true);
      expect(strip.classList.contains('shrink-0')).toBe(true);
      expect(strip.parentElement).toBe(aside);
      expect(body.parentElement).toBe(aside);
      expect(body.contains(strip)).toBe(false);
      expect(body.classList.contains('flex-1')).toBe(true);
      expect(body.classList.contains('min-h-0')).toBe(true);
      expect(host.querySelectorAll('.overflow-y-auto')).toHaveLength(1);
    },
  );

  it('applies to the pinned root and retains paths and warnings', async () => {
    const button = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).find((item) => item.textContent?.trim() === 'Apply to Workspace');
    button?.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(rpc.apply).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceRoot: 'C:/repo' }),
    );
    const host = fixture.nativeElement as HTMLElement;
    expect(
      host.querySelector('[aria-label="Files written"]')?.textContent,
    ).toContain('.claude/agents/a.md');
    expect(host.textContent).toContain('Review one file');
    expect(host.textContent).toContain('2 files written');
  });

  it('keeps the preview after an apply failure and offers retry', async () => {
    rpc.apply.mockRejectedValueOnce(new Error('private host error'));
    const button = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).find((item) => item.textContent?.trim() === 'Apply to Workspace');
    button?.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Apply failed',
    );
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Try again',
    );
    expect(config().persona?.label).toBe('Team');
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain(
      'private host error',
    );
  });

  it('routes the persona helper through the helper service', async () => {
    const button = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).find((item) => item.textContent?.includes('Suggest from persona'));
    button?.click();
    await fixture.whenStable();
    expect(helper.suggestConfig).toHaveBeenCalledWith({
      personaDescription: 'A team',
      goals: [],
    });
  });
});
