import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
  signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { BehaviorSubject } from 'rxjs';

jest.mock('ngx-markdown', () => ({
  MarkdownModule: class {},
  MarkdownComponent: class {},
  MarkdownService: class {},
  provideMarkdown: () => [],
  MARKED_OPTIONS: 'MARKED_OPTIONS',
  CLIPBOARD_OPTIONS: 'CLIPBOARD_OPTIONS',
  MARKED_EXTENSIONS: 'MARKED_EXTENSIONS',
  MERMAID_OPTIONS: 'MERMAID_OPTIONS',
  SANITIZE: 'SANITIZE',
}));

import { TabManagerService } from '@ptah-extension/chat-state';
import {
  AppStateManager,
  ClaudeRpcService,
  LoggingService,
  SurfaceRouterService,
} from '@ptah-extension/core';
import { HarnessBuilderViewComponent } from './harness-builder-view.component';
import { HarnessBuilderLeaveDialogComponent } from './harness-builder-leave-dialog.component';
import { HarnessBuilderRecordsService } from '../services/harness-builder-records.service';
import { HarnessBuilderStateService } from '../services/harness-builder-state.service';
import { HarnessProposalHydrationService } from '../services/harness-proposal-hydration.service';
import { HarnessWorkflowRequestService } from '../services/harness-workflow-request.service';
import { HarnessRpcService } from '../services/harness-rpc.service';

@Component({
  selector: 'ptah-session-embed',
  standalone: true,
  template: '<div role="log">Shared chat</div>',
})
class EmbedStub {
  readonly tabId = input.required<string>();
  readonly chrome = input('full');
}
@Component({ selector: 'ptah-workflow-badge', standalone: true, template: '' })
class BadgeStub {
  readonly workflow = input<unknown>();
  readonly variant = input('full');
}
@Component({
  selector: 'ptah-harness-builder-sidebar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template:
    '<aside id="builder-sidebar" class="flex flex-col h-full min-h-0"><div data-testid="sidebar-strip" class="shrink-0"></div><div data-testid="sidebar-scroll-body" class="flex-1 min-h-0 overflow-y-auto"></div></aside>',
})
class SidebarStub {
  readonly tabId = input.required<string>();
  readonly workspaceRoot = input('');
  readonly mode = input('configure-harness');
  readonly initialized = input(false);
  readonly initError = input(false);
  readonly agentBusy = input(false);
  readonly statsSnapshot = input<unknown>(null);
  readonly liveModelStats = input<unknown>(null);
  readonly sheet = input(false);
  readonly retrySetup = output<void>();
}
const params = new BehaviorSubject(
  convertToParamMap({ mode: 'configure-harness', tabId: 'tab-a' }),
);
const tabs = signal([
  {
    id: 'tab-a',
    workflow: 'harness-configure',
    claudeSessionId: 'session-a',
    status: 'loaded',
    sessionStats: null,
    liveModelStats: null,
  },
]);
const pendingIntent = signal<null | {
  sourceTabId: string;
  targetMode: 'new-project' | 'configure-harness';
}>(null);
const entryErrors = signal<Readonly<Record<string, string>>>({});
const closeTab = jest.fn(async (id: string) =>
  tabs.update((all) => all.filter((tab) => tab.id !== id)),
);
const bind = jest.fn(async () => undefined);
const navigate = jest.fn(async () => 'landed');
const canvasRequest = jest.fn();
const writeDraft = jest.fn(() => true);
const abort = jest.fn(async () => ({ success: true, data: { success: true } }));
const reportAbortFailure = jest.fn();
const cancelPendingIntent = jest.fn();
const retryFirstSend = jest.fn(async () => true);
const logError = jest.fn();
let lookupRoot: string | null = '/workspace/a';
let rawRoot = '/workspace/a';
const resumedIntake = signal<{ tabId: string; text: string } | null>(null);
const initialize = jest.fn(
  async (workspaceRoot: string | null = '/workspace/a') => ({
    workspaceRoot,
    workspaceContext: {
      projectName: 'A',
      projectType: 'app',
      frameworks: [],
      languages: [],
    },
    availableAgents: [],
    availableSkills: [],
    existingPresets: [],
  }),
);

async function render() {
  TestBed.configureTestingModule({
    imports: [HarnessBuilderViewComponent],
    providers: [
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: { paramMap: params.value },
          paramMap: params.asObservable(),
        },
      },
      {
        provide: TabManagerService,
        useValue: {
          tabs,
          streamingTabIds: signal(new Set<string>()),
          markLoaded: jest.fn(),
          resetTabToFresh: jest.fn(),
          findTabByIdAcrossWorkspaces: (id: string) => {
            const tab = tabs().find((item) => item.id === id);
            return tab ? { tab, workspacePath: lookupRoot } : null;
          },
          switchTab: jest.fn(),
          markTabIdle: jest.fn(),
          closeTab,
        },
      },
      {
        provide: SurfaceRouterService,
        useValue: { navigateToSurface: navigate },
      },
      {
        provide: AppStateManager,
        useValue: { requestCanvasTab: canvasRequest },
      },
      { provide: ClaudeRpcService, useValue: { call: abort } },
      { provide: HarnessRpcService, useValue: { initialize } },
      {
        provide: HarnessBuilderRecordsService,
        useValue: {
          readSnapshot: jest.fn(() => null),
          readDraft: jest.fn(() => null),
          replaceDraft: writeDraft,
          clearTab: jest.fn(),
        },
      },
      { provide: HarnessProposalHydrationService, useValue: { bind } },
      {
        provide: HarnessWorkflowRequestService,
        useValue: {
          workspaceRoot: '/workspace/a',
          get rawWorkspaceRoot() {
            return rawRoot;
          },
          resumedIntake,
          pendingIntent,
          entryErrors,
          cancelPendingIntent,
          completePendingIntent: jest.fn(async () => 'landed'),
          retryFirstSend,
          reportAbortFailure,
        },
      },
      {
        provide: HarnessBuilderStateService,
        useValue: {
          configSummary: signal('No configuration yet'),
          bindTab: jest.fn(),
          initialize: jest.fn(),
          reset: jest.fn(),
        },
      },
      { provide: LoggingService, useValue: { error: logError } },
    ],
  });
  TestBed.overrideComponent(HarnessBuilderViewComponent, {
    set: {
      imports: [
        EmbedStub,
        BadgeStub,
        SidebarStub,
        HarnessBuilderLeaveDialogComponent,
      ],
    },
  });
  const fixture = TestBed.createComponent(HarnessBuilderViewComponent);
  fixture.detectChanges();
  TestBed.flushEffects();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

describe('HarnessBuilderViewComponent shared session host', () => {
  beforeEach(() => {
    params.next(
      convertToParamMap({ mode: 'configure-harness', tabId: 'tab-a' }),
    );
    lookupRoot = '/workspace/a';
    rawRoot = '/workspace/a';
    resumedIntake.set(null);
    tabs.set([
      {
        id: 'tab-a',
        workflow: 'harness-configure',
        claudeSessionId: 'session-a',
        status: 'loaded',
        sessionStats: null,
        liveModelStats: null,
      },
    ]);
    pendingIntent.set(null);
    entryErrors.set({});
    closeTab.mockClear();
    bind.mockClear();
    navigate.mockClear();
    writeDraft.mockClear();
    abort.mockClear();
    canvasRequest.mockClear();
    reportAbortFailure.mockClear();
    cancelPendingIntent.mockClear();
    retryFirstSend.mockClear();
    initialize.mockClear();
    logError.mockClear();
  });

  it('keeps the route tab when another tab becomes active', async () => {
    const fixture = await render();
    tabs.update((all) => [...all, { ...all[0], id: 'tab-b' }]);
    fixture.detectChanges();
    expect(
      fixture.debugElement
        .query(By.directive(EmbedStub))
        .componentInstance.tabId(),
    ).toBe('tab-a');
    expect(fixture.componentInstance.tabId()).toBe('tab-a');
    expect(bind).toHaveBeenCalledWith(
      '/workspace/a',
      'tab-a',
      ['session-a'],
      null,
    );
  });

  it('uses the original pinned UNC path for setup, hydration and sidebar actions', async () => {
    const originalRoot = '\\\\wsl.localhost\\Ubuntu\\home\\User\\Proj';
    lookupRoot = originalRoot;
    initialize.mockImplementationOnce(async () => ({
      workspaceRoot: originalRoot,
      workspaceContext: {
        projectName: 'Proj',
        projectType: 'app',
        frameworks: [],
        languages: [],
      },
      availableAgents: [],
      availableSkills: [],
      existingPresets: [],
    }));
    const fixture = await render();
    expect(initialize).toHaveBeenCalledWith(originalRoot);
    expect(bind).toHaveBeenCalledWith(
      originalRoot,
      'tab-a',
      ['session-a'],
      null,
    );
    expect(
      fixture.debugElement
        .query(By.directive(SidebarStub))
        .componentInstance.workspaceRoot(),
    ).toBe(originalRoot);
    expect(fixture.componentInstance.initialized()).toBe(true);
  });

  it('uses the raw active root when a VS Code tab has no workspace path', async () => {
    lookupRoot = null;
    rawRoot = 'C:\\Users\\Ann\\MyApp';
    initialize.mockImplementationOnce(async () => ({
      workspaceRoot: 'c:\\users\\ann\\myapp',
      workspaceContext: {
        projectName: 'MyApp',
        projectType: 'app',
        frameworks: [],
        languages: [],
      },
      availableAgents: [],
      availableSkills: [],
      existingPresets: [],
    }));
    const fixture = await render();
    expect(initialize).toHaveBeenCalledWith(rawRoot);
    expect(fixture.componentInstance.initialized()).toBe(true);
  });

  it('shows a resumed intake on the builder page for review', async () => {
    resumedIntake.set({ tabId: 'tab-a', text: 'Clinic scheduler intake' });
    const fixture = await render();
    expect(fixture.nativeElement.textContent).toContain(
      'Clinic scheduler intake',
    );
  });

  it('always queues the pinned tab for canvas adoption', async () => {
    await render();
    expect(canvasRequest).toHaveBeenCalledWith(
      'tab-a',
      '/workspace/a',
      'AI Team Builder',
    );
  });

  it('retries the first message for the routed tab without dismissing a failed notice', async () => {
    entryErrors.set({ 'tab-a': 'The first message could not be sent.' });
    retryFirstSend.mockResolvedValueOnce(false);
    const fixture = await render();
    const button = (
      fixture.nativeElement as HTMLElement
    ).querySelector<HTMLButtonElement>('[role="alert"] button');
    expect(button?.textContent).toContain('Retry message');
    button?.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(retryFirstSend).toHaveBeenCalledWith('tab-a');
    expect(
      fixture.nativeElement.querySelector('[role="alert"]'),
    ).not.toBeNull();
  });

  it('reports a missing workspace root from initialization as an error', async () => {
    initialize.mockImplementationOnce(async () => ({
      workspaceRoot: null,
      workspaceContext: {
        projectName: 'A',
        projectType: 'app',
        frameworks: [],
        languages: [],
      },
      availableAgents: [],
      availableSkills: [],
      existingPresets: [],
    }));
    const fixture = await render();
    expect(fixture.componentInstance.initError()).toBe(true);
    expect(fixture.componentInstance.initialized()).toBe(false);
    expect(
      fixture.nativeElement.querySelector('ptah-session-embed'),
    ).not.toBeNull();
    expect(
      fixture.debugElement
        .query(By.directive(SidebarStub))
        .componentInstance.initError(),
    ).toBe(true);
    expect(logError).toHaveBeenCalledWith(
      'HarnessBuilderViewComponent',
      'Builder setup failed',
      expect.any(Error),
    );
  });

  it.each([360, 400, 720, 960])(
    'bounds the page and sidebar at %ipx',
    async (width) => {
      const fixture = await render();
      fixture.componentInstance.hostWidth.set(width);
      if (width < 720) fixture.componentInstance.sheetOpen.set(true);
      fixture.detectChanges();
      const host = fixture.nativeElement as HTMLElement;
      expect(host.querySelector('main')?.className).toContain(
        'overflow-hidden',
      );
      expect(
        host.querySelector('[data-testid="sidebar-strip"]')?.className,
      ).toContain('shrink-0');
      expect(
        host.querySelector('[data-testid="sidebar-scroll-body"]')?.className,
      ).toContain('overflow-y-auto');
      if (width < 720)
        expect(host.querySelector('.absolute.inset-0')).not.toBeNull();
      else expect(host.querySelector('.border-l')).not.toBeNull();
    },
  );

  it('keeps the 480px high host bounded', async () => {
    const fixture = await render();
    (fixture.nativeElement as HTMLElement).style.height = '480px';
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('.flex-1.min-h-0.overflow-hidden'),
    ).not.toBeNull();
    expect(fixture.nativeElement.querySelector('main')?.className).toContain(
      'min-h-0',
    );
  });

  it('rejects missing and wrong-kind route tabs before mounting chat', async () => {
    const fixture = await render();
    params.next(
      convertToParamMap({ mode: 'configure-harness', tabId: 'missing' }),
    );
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('no longer open');
    expect(
      fixture.nativeElement.querySelector('ptah-session-embed'),
    ).toBeNull();
    params.next(convertToParamMap({ mode: 'new-project', tabId: 'tab-a' }));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(
      'not a New Project session',
    );
    expect(
      fixture.nativeElement.querySelector('ptah-session-embed'),
    ).toBeNull();
  });

  it('writes a draft before aborting and leaves once', async () => {
    const fixture = await render();
    const page = fixture.componentInstance;
    page.requestStartOver(fixture.nativeElement.querySelector('button'));
    await page.chooseLeave('save');
    expect(writeDraft).toHaveBeenCalledWith(
      '/workspace/a',
      'configure-harness',
      'tab-a',
    );
    expect(abort).toHaveBeenCalledWith('chat:abort', {
      sessionId: 'session-a',
    });
    expect(writeDraft.mock.invocationCallOrder[0]).toBeLessThan(
      abort.mock.invocationCallOrder[0],
    );
    expect(navigate).toHaveBeenCalledWith('setup-hub');
  });

  it('cancels a pending handoff without stopping the tab', async () => {
    const fixture = await render();
    fixture.componentInstance.requestStartOver(
      fixture.nativeElement.querySelector('button'),
    );
    await fixture.componentInstance.chooseLeave('cancel');
    expect(abort).not.toHaveBeenCalled();
    expect(closeTab).not.toHaveBeenCalled();
    expect(cancelPendingIntent).toHaveBeenCalledTimes(1);
  });

  it.each(['cancel', 'Escape', 'backdrop'] as const)(
    'restores the builder and trigger focus after %s',
    async (dismissal) => {
      const fixture = await render();
      const host = fixture.nativeElement as HTMLElement;
      const trigger = host.querySelector<HTMLButtonElement>(
        '[aria-label="Start over: leave this workflow"]',
      );
      expect(trigger).not.toBeNull();
      trigger!.focus();
      trigger!.click();
      fixture.detectChanges();
      await Promise.resolve();

      const dialog = host.querySelector<HTMLElement>('[role="dialog"]');
      expect(dialog).not.toBeNull();
      if (dismissal === 'cancel')
        dialog!.querySelector<HTMLButtonElement>('button')!.click();
      else if (dismissal === 'Escape')
        dialog!.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        );
      else dialog!.parentElement!.click();
      fixture.detectChanges();
      await Promise.resolve();

      expect(host.querySelector('[inert]')).toBeNull();
      expect(document.activeElement).toBe(trigger);
    },
  );

  it('keeps the chat inert when a narrow sheet remains open after Cancel', async () => {
    const fixture = await render();
    const host = fixture.nativeElement as HTMLElement;
    fixture.componentInstance.hostWidth.set(400);
    fixture.componentInstance.sheetOpen.set(true);
    fixture.detectChanges();
    const trigger = host.querySelector<HTMLButtonElement>(
      '[aria-label="Start over: leave this workflow"]',
    );
    trigger!.click();
    fixture.detectChanges();
    host.querySelector<HTMLElement>('[role="dialog"] button')!.click();
    fixture.detectChanges();
    await Promise.resolve();

    expect(host.querySelector('main')?.hasAttribute('inert')).toBe(true);
    expect(host.querySelector('.shrink-0[inert]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('cancels an open pending handoff when the view is destroyed', async () => {
    const fixture = await render();
    pendingIntent.set({ sourceTabId: 'tab-a', targetMode: 'new-project' });
    fixture.detectChanges();
    TestBed.flushEffects();
    expect(fixture.componentInstance.dialogOpen()).toBe(true);
    fixture.destroy();
    expect(cancelPendingIntent).toHaveBeenCalledTimes(1);
  });

  it('reports an abort failure and still reaches the Hub', async () => {
    const fixture = await render();
    abort.mockRejectedValueOnce(new Error('abort rejected'));
    await fixture.componentInstance.chooseLeave('discard');
    expect(reportAbortFailure).toHaveBeenCalledWith(expect.any(Error));
    expect(navigate).toHaveBeenCalledWith('setup-hub');
  });
});
