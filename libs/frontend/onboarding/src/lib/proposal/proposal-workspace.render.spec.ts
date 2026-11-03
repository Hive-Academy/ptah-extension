import { Component, ElementRef, NO_ERRORS_SCHEMA, inject, input, output, signal, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { ComposerAttachmentsService, FilePickerService } from '@ptah-extension/chat';
import { TabManagerService } from '@ptah-extension/chat-state';
import { ClaudeRpcService } from '@ptah-extension/core';
import { BehaviorSubject } from 'rxjs';
import { LiveRunLayoutComponent } from '../shared/live-run-layout.component';
import { ProposalFlowStore } from './proposal-flow.store';
import { AnswerDockComponent } from './answer-dock.component';
import { ProposalWorkspacePage } from './proposal-workspace.page';
import { ReplyDraftStore } from './reply-draft.store';

@Component({ selector: 'ptah-details-log', standalone: true, template: '<div #region role="log" tabindex="0">Session log</div><ng-content /><p>{{ footerNote() }}</p>' })
class LogStub {
  readonly variant = input('pane');
  readonly mode = input('tab');
  readonly tabId = input<string | null>(null);
  readonly sessionInitialized = input(false);
  readonly statsSnapshot = input<unknown>(null);
  readonly liveModelStats = input<unknown>(null);
  readonly liveState = input('idle');
  readonly composer = input(false);
  readonly footerNote = input('');
  private readonly region = viewChild<ElementRef<HTMLElement>>('region');
  focus(): void { this.region()?.nativeElement.focus(); }
}
@Component({ selector: 'ptah-reply-composer', standalone: true, template: '<textarea #field aria-label="Desktop reply" [value]="draft.reply()" (input)="onInput($event)"></textarea>' })
class ComposerStub {
  readonly draft = inject(ReplyDraftStore);
  readonly status = input('waiting');
  private readonly field = viewChild<ElementRef<HTMLTextAreaElement>>('field');
  focus(): void { this.field()?.nativeElement.focus(); }
  onInput(event: Event): void { if (event.target instanceof HTMLTextAreaElement) this.draft.setReply(event.target.value); }
}
@Component({ selector: 'ptah-proposal-status-card', standalone: true, template: '<section><span>{{ status() }}</span><button [disabled]="!reviewEligible()" (click)="review.emit()">Review</button><button (click)="saveAsPreset.emit()">Save as preset</button>@if(canRetryBrief()){<button (click)="retryBrief.emit()">Retry sending brief</button>}</section>' })
class StatusStub {
  readonly status = input('loading');
  readonly reviewEligible = input(false);
  readonly canRetryBrief = input(false);
  readonly error = input<string | null>(null);
  readonly meta = input('');
  readonly saveDraft = output<void>();
  readonly review = output<void>();
  readonly saveAsPreset = output<void>();
  readonly retryBrief = output<void>();
}

describe('ProposalWorkspacePage rendered parity', () => {
  const restoreState = signal<'loading' | 'ready' | 'proposal-unavailable' | 'missing'>('loading');
  const record = signal<{ tabId: string; sessionId: string; workspacePath: string; teamIntent: string; sendAttempt?: { ackedAt: string } } | null>(null);
  const phase = signal('idle');
  const actionError = signal<string | null>(null);
  const sessionStatus = signal<'loading' | 'waiting' | 'working' | 'stopping' | 'ready' | 'failed' | 'not-connected'>('loading');
  const reviewEligible = signal(false);
  const current = signal<{ id: string; ordinal: number } | null>(null);
  const revision = signal(0);
  const findTab = jest.fn();
  const params = new BehaviorSubject(convertToParamMap({ tab: 'tab' }));
  const send = jest.fn<Promise<boolean>, [string, unknown]>().mockResolvedValue(true);
  let wide = false;
  const flow = {
    mode: 'team-builder', restoreState, actionError, sessionStatus, reviewEligible,
    session: { record, phase, error: signal<string | null>(null), send, attachView: jest.fn(() => jest.fn()) },
    hydration: { config: signal({}), isConfigComplete: signal(false) },
    changeTags: signal([]), current, revisions: signal([]), generatedDocument: signal(null),
    workspaceRoot: signal('/ws'), records: { readStackProfile: jest.fn(), readDraft: jest.fn() },
    restore: jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined),
  };
  beforeEach(() => {
    restoreState.set('loading'); record.set(null); phase.set('idle'); actionError.set(null);
    sessionStatus.set('loading'); reviewEligible.set(false); current.set(null); revision.set(0);
    findTab.mockReset(); send.mockClear(); wide = false;
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: jest.fn(() => ({ matches: wide, media: '(min-width: 721px)', addEventListener: jest.fn(), removeEventListener: jest.fn() } as unknown as MediaQueryList)) });
    TestBed.configureTestingModule({ providers: [
      { provide: ProposalFlowStore, useValue: flow },
      { provide: ActivatedRoute, useValue: { queryParamMap: params.asObservable() } },
      { provide: Router, useValue: { navigate: jest.fn() } },
      { provide: TabManagerService, useValue: { backgroundTabsRevision: revision, findTabByIdAcrossWorkspaces: findTab } },
      { provide: ClaudeRpcService, useValue: { call: jest.fn() } },
      { provide: FilePickerService, useValue: { isFileSupported: () => true } },
    ] });
    TestBed.overrideComponent(ProposalWorkspacePage, { set: {
      imports: [LiveRunLayoutComponent, LogStub, ComposerStub, AnswerDockComponent, StatusStub], schemas: [NO_ERRORS_SCHEMA],
    } });
  });
  afterEach(() => TestBed.resetTestingModule());
  function render() {
    const fixture = TestBed.createComponent(ProposalWorkspacePage);
    fixture.detectChanges();
    return { fixture, root: fixture.nativeElement as HTMLElement };
  }
  function bind() { record.set({ tabId: 'tab', sessionId: 'session', workspacePath: '/ws', teamIntent: 'A team' }); sessionStatus.set('ready'); }

  it('case 1: mounts a live transcript on the left without a disclosure', () => {
    bind(); restoreState.set('ready'); const { root } = render();
    expect(root.querySelector('[role="log"]')).not.toBeNull();
    expect(root.querySelector('details[data-testid="details-log"]')).toBeNull();
  });
  it('case 2: focuses the log once when ready and does not refocus on status changes', async () => {
    bind(); restoreState.set('ready'); const { fixture, root } = render();
    await fixture.whenStable(); fixture.detectChanges();
    expect(document.activeElement).toBe(root.querySelector('[role="log"]'));
    const other = document.createElement('button'); document.body.append(other); other.focus();
    sessionStatus.set('waiting'); fixture.detectChanges(); await fixture.whenStable();
    expect(document.activeElement).toBe(other); other.remove();
  });
  it('case 3: keeps loading status in the right status area', () => {
    const { root } = render(); expect(root.querySelector('ptah-proposal-status-card')?.textContent).toContain('loading');
  });
  it('case 4a: bound unavailable state keeps log and composer for Propose again', () => {
    bind(); restoreState.set('proposal-unavailable'); sessionStatus.set('failed'); wide = true; const { fixture, root } = render();
    [...root.querySelectorAll('button')].find((button) => button.textContent?.includes('Propose again'))?.click();
    fixture.detectChanges();
    expect(root.querySelector('[role="log"]')).not.toBeNull();
    expect(root.querySelector<HTMLTextAreaElement>('textarea[aria-label="Desktop reply"]')?.value).toContain('Please propose');
    expect(document.activeElement).toBe(root.querySelector('textarea[aria-label="Desktop reply"]'));
    expect(send).not.toHaveBeenCalled();
  });
  it('case 4b: missing state keeps heading and excludes composer', () => {
    restoreState.set('missing'); const { root } = render();
    expect(root.querySelector('h1')?.tabIndex).toBe(-1);
    expect(root.querySelector('ptah-reply-composer')).toBeNull();
  });
  it('case 5: failed status exposes retry action', () => {
    bind(); restoreState.set('ready'); phase.set('failed'); sessionStatus.set('failed');
    const { root } = render(); expect(root.querySelector('ptah-proposal-status-card')?.textContent).toContain('Retry sending brief');
  });
  it('case 6: review eligibility reaches the status card', () => {
    bind(); restoreState.set('ready'); reviewEligible.set(true);
    const { root } = render(); expect(root.querySelector<HTMLButtonElement>('ptah-proposal-status-card button')?.disabled).toBe(false);
  });
  it('case 7: omits latest message tile and Show full message', () => {
    bind(); restoreState.set('ready'); const { root } = render();
    expect(root.textContent).not.toContain('Show full message');
    expect(root.textContent).not.toContain('Latest agent message');
  });
  it('case 8: preserves Save as preset path', () => {
    bind(); restoreState.set('ready'); const { root } = render();
    expect(root.querySelector('ptah-builder-presets-section')).not.toBeNull();
  });
  it('case 9: includes the log column in sheet background elements', () => {
    bind(); restoreState.set('ready'); const { fixture, root } = render(); fixture.detectChanges();
    const page = fixture.componentInstance as unknown as { backgroundElements(): HTMLElement[] };
    expect(page.backgroundElements()).toContain(root.querySelector('ptah-live-run-layout'));
  });
  it('case 10: status changes do not remove the mounted log', () => {
    bind(); restoreState.set('ready'); const { fixture, root } = render();
    const log = root.querySelector('[role="log"]'); sessionStatus.set('waiting'); fixture.detectChanges();
    expect(root.querySelector('[role="log"]')).toBe(log);
  });
  it('case 11: reads stats from the cross-workspace tab', () => {
    bind(); restoreState.set('ready'); findTab.mockReturnValue({ tab: { sessionStats: [] } });
    const { fixture } = render();
    const page = fixture.componentInstance as unknown as { tab(): unknown };
    expect(page.tab()).toEqual({ sessionStats: [] });
    expect(findTab).toHaveBeenCalledWith('tab');
  });
  it('case 12: places composer after log region inside the log card', () => {
    bind(); restoreState.set('ready'); const { root } = render();
    expect(root.querySelector('ptah-details-log ptah-reply-composer')).not.toBeNull();
  });
  it('case 13: places the bar after the layout', () => {
    bind(); restoreState.set('ready'); const { root } = render();
    expect(root.querySelector('ptah-live-run-layout + ptah-answer-dock')).not.toBeNull();
  });

  it('shows the composer and dock for a bound ready session', () => {
    bind(); restoreState.set('ready');
    const { root } = render();
    expect(root.querySelector('ptah-reply-composer')).not.toBeNull();
    expect(root.querySelector('ptah-answer-dock')).not.toBeNull();
  });
  it.each(['ready', 'waiting', 'working', 'loading', 'failed', 'stopping', 'not-connected'] as const)(
    'keeps composer and dock for a bound %s session', (state) => {
      bind(); restoreState.set('ready'); sessionStatus.set(state);
      const { root } = render();
      expect(root.querySelector('ptah-reply-composer')).not.toBeNull();
      expect(root.querySelector('ptah-answer-dock')).not.toBeNull();
    },
  );
  it.each(['loading', 'missing', 'ready'] as const)('shows read-only footer without a record in %s', (state) => {
    restoreState.set(state);
    const { root } = render();
    expect(root.querySelector('ptah-reply-composer')).toBeNull();
    expect(root.querySelector('ptah-answer-dock')).toBeNull();
    expect(root.querySelector('ptah-details-log')?.textContent).toContain(state === 'loading' ? 'Restoring session' : 'No live session is bound');
  });
  it('keeps one announcement mounted as a send changes status to working', async () => {
    bind(); restoreState.set('ready');
    send.mockImplementationOnce(async () => { sessionStatus.set('working'); return true; });
    const { fixture, root } = render();
    const region = root.querySelector<HTMLElement>('[role="status"][aria-live="polite"]');
    const draft = fixture.debugElement.injector.get(ReplyDraftStore);
    draft.setReply('Please revise');
    await draft.send(); fixture.detectChanges();
    expect(root.querySelector('[role="status"][aria-live="polite"]')).toBe(region);
    expect(region?.textContent).toBe('Reply sent');
    expect(root.querySelectorAll('[role="status"][aria-live="polite"]')).toHaveLength(1);
  });
  it('keeps failure announcement and draft available after status fails', async () => {
    bind(); restoreState.set('ready');
    send.mockImplementationOnce(async () => { sessionStatus.set('failed'); return false; });
    const { fixture, root } = render();
    const draft = fixture.debugElement.injector.get(ReplyDraftStore);
    draft.setReply('Please revise');
    await draft.send(); fixture.detectChanges();
    expect(root.querySelector('[role="status"][aria-live="polite"]')?.textContent).toBe('Reply could not be sent. Try again.');
    expect(root.querySelector('ptah-reply-composer')).not.toBeNull();
    expect(draft.reply()).toBe('Please revise');
  });
  it('case 14: composer and sheet share the one page draft', () => {
    bind(); restoreState.set('ready'); const { fixture, root } = render();
    const composer = root.querySelector<HTMLTextAreaElement>('textarea[aria-label="Desktop reply"]')!;
    composer.value = 'Shared'; composer.dispatchEvent(new Event('input', { bubbles: true })); fixture.detectChanges();
    root.querySelector<HTMLButtonElement>('button[aria-controls="answer-dock-sheet"]')!.click(); fixture.detectChanges();
    expect(root.querySelector<HTMLTextAreaElement>('#dock-sheet-reply')?.value).toBe('Shared');
  });
});
