import { signal } from '@angular/core';
import {
  DeferBlockBehavior,
  DeferBlockState,
  TestBed,
} from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { TabManagerService } from '@ptah-extension/chat-state';
import { SetupStatusStore } from '@ptah-extension/chat-ui';
import { buildLaunchers } from '@ptah-extension/chat-ui/vitals';
import { AppStateManager, VSCodeService } from '@ptah-extension/core';
import {
  ChatVitalsStore,
  type ChatVitalsHost,
} from '../../../services/vitals/chat-vitals.store';
import { ChatEmptyStateComponent } from './chat-empty-state.component';
import { ChatEmptyStateViewComponent } from './chat-empty-state-screen.component';

describe('empty chat', () => {
  const ready = signal(false);
  const resume = signal<{ id: string; name: string } | null>(null);
  const bind = jest.fn<void, [ChatVitalsHost]>();
  const retry = jest.fn();
  const launchWizard = jest.fn();
  const launchGeneration = jest.fn();
  const openMarketplace = jest.fn();
  const nextAction = signal<
    'open-library' | 'run-setup' | 'generate-agents' | null
  >('run-setup');
  const setupError = signal<string | null>(null);

  beforeEach(async () => {
    ready.set(false);
    resume.set(null);
    nextAction.set('run-setup');
    setupError.set(null);
    jest.clearAllMocks();
    await TestBed.configureTestingModule({
      imports: [ChatEmptyStateComponent, ChatEmptyStateViewComponent],
      deferBlockBehavior: DeferBlockBehavior.Manual,
      providers: [
        {
          provide: TabManagerService,
          useValue: {
            activeWorkspacePath: '/workspace',
            findTabByIdAcrossWorkspaces: () => ({
              tab: { claudeSessionId: 'current' },
              workspacePath: '/other',
            }),
          },
        },
        { provide: AppStateManager, useValue: { openMarketplace } },
        {
          provide: VSCodeService,
          useValue: { isElectron: true, getPtahIconUri: () => 'ptah.svg' },
        },
        {
          provide: SetupStatusStore,
          useValue: {
            allReady: ready,
            skillsReady: signal(true),
            scanReady: signal(false),
            agentsReady: signal(false),
            nextAction,
            error: setupError,
            scanError: signal(null),
            launchError: signal(null),
            retry,
            launchWizard,
            launchGeneration,
          },
        },
      ],
    })
      .overrideComponent(ChatEmptyStateViewComponent, {
        set: {
          providers: [
            {
              provide: ChatVitalsStore,
              useValue: {
                bind,
                context: signal(null),
                model: signal('Test model'),
                planRing: signal({ status: 'empty' }),
                spend7: signal({ status: 'empty' }),
                resume,
              },
            },
          ],
        },
      })
      .compileComponents();
  });

  it('defers the screen and forwards prompts and resume without sending a message', async () => {
    const fixture = TestBed.createComponent(ChatEmptyStateComponent);
    const prompt = jest.fn();
    const resumed = jest.fn();
    fixture.componentInstance.promptSelected.subscribe(prompt);
    fixture.componentInstance.resumeRequested.subscribe(resumed);
    fixture.componentRef.setInput('showReadiness', true);
    resume.set({ id: 'previous', name: 'Fix auth refresh' });
    fixture.detectChanges();
    expect(bind).not.toHaveBeenCalled();
    const [block] = await fixture.getDeferBlocks();
    await block.render(DeferBlockState.Complete);
    fixture.detectChanges();
    const buttons = fixture.debugElement.queryAll(By.css('[data-launcher]'));
    expect(buttons).toHaveLength(4);
    buttons.forEach((button) => button.triggerEventHandler('click'));
    expect(prompt.mock.calls.map((call) => call[0])).toEqual(
      buildLaunchers().map((launcher) => launcher.text),
    );
    fixture.debugElement
      .query(By.css('.empty-chat__resume'))
      .triggerEventHandler('click');
    expect(resumed).toHaveBeenCalledWith('previous');
    expect(
      fixture.debugElement.query(By.css('ptah-readiness-ring')),
    ).not.toBeNull();
  });

  it('does not render Resume in the VS Code webview even with a recent session', () => {
    TestBed.overrideProvider(VSCodeService, {
      useValue: { isElectron: false, getPtahIconUri: () => 'ptah.svg' },
    });
    resume.set({ id: 'previous', name: 'Fix auth refresh' });
    const fixture = TestBed.createComponent(ChatEmptyStateViewComponent);
    fixture.detectChanges();
    expect(
      fixture.debugElement.query(By.css('.empty-chat__resume')),
    ).toBeNull();
  });

  it('gates readiness, hides it when complete, and binds the correct tab workspace', () => {
    const fixture = TestBed.createComponent(ChatEmptyStateViewComponent);
    fixture.detectChanges();
    expect(
      fixture.debugElement.query(By.css('ptah-readiness-ring')),
    ).toBeNull();
    const host = bind.mock.calls[0][0];
    expect(host.workspacePath()).toBe('/workspace');
    expect(host.sessionId()).toBeNull();
    fixture.componentRef.setInput('tabId', 'tab-2');
    fixture.componentRef.setInput('showReadiness', true);
    fixture.detectChanges();
    expect(host.workspacePath()).toBe('/other');
    expect(host.sessionId()).toBe('current');
    expect(
      fixture.debugElement.query(By.css('ptah-readiness-ring')),
    ).not.toBeNull();
    ready.set(true);
    fixture.detectChanges();
    expect(
      fixture.debugElement.query(By.css('ptah-readiness-ring')),
    ).toBeNull();
  });

  it('offers real setup actions and a retry on unavailable readiness', () => {
    const fixture = TestBed.createComponent(ChatEmptyStateViewComponent);
    fixture.componentRef.setInput('showReadiness', true);
    fixture.detectChanges();
    const ring = fixture.debugElement.query(By.css('ptah-readiness-ring'));
    ring.triggerEventHandler('actionRequested', 'run-setup');
    ring.triggerEventHandler('actionRequested', 'generate-agents');
    ring.triggerEventHandler('actionRequested', 'open-library');
    expect(launchWizard).toHaveBeenCalledTimes(1);
    expect(launchGeneration).toHaveBeenCalledWith('setup-agent-generation');
    expect(openMarketplace).toHaveBeenCalledWith({
      page: 'skills',
      source: 'ptah-plugins',
    });
    setupError.set('private host error');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain(
      'private host error',
    );
    fixture.debugElement
      .query(By.css('.empty-chat__notice button'))
      .triggerEventHandler('click');
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('renders unknown context honestly, zero spend, no resume and no legacy tiles', () => {
    const fixture = TestBed.createComponent(ChatEmptyStateViewComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Orchestrator ready');
    expect(fixture.nativeElement.textContent).toContain('$0.00');
    const contextValue = fixture.debugElement.query(By.css('ptah-stat-value'));
    expect(contextValue.componentInstance.text()).toBe('\u2014');
    expect(fixture.nativeElement.textContent).not.toContain('null%');
    expect(
      fixture.debugElement.query(By.css('.empty-chat__resume')),
    ).toBeNull();
    expect(
      fixture.debugElement.query(
        By.css('ptah-project-setup-card, ptah-prompt-suggestions'),
      ),
    ).toBeNull();
    expect(
      fixture.debugElement.query(By.css('img')).attributes['aria-hidden'],
    ).toBe('true');
  });
});
