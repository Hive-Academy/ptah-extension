import { Component, input } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  SessionEmbedComponent,
  type SessionStartGuard,
  type SessionStopHandler,
} from '@ptah-extension/chat';
import type { LiveModelStats } from '@ptah-extension/chat-ui';
import { BuilderSessionSectionComponent } from '@ptah-extension/harness-builder';
import { AnalysisTranscriptComponent } from '@ptah-extension/setup-wizard';
import type { SessionStatsEntry } from '@ptah-extension/shared';
import { DetailsLogComponent } from './details-log.component';

let embedInstanceSeq = 0;

@Component({
  selector: 'ptah-session-embed',
  standalone: true,
  template: '<div data-testid="session-embed-stub"></div>',
})
class SessionEmbedStubComponent {
  public readonly instanceId = ++embedInstanceSeq;
  public readonly tabId = input.required<string>();
  public readonly chrome = input('full');
  public readonly readOnly = input(false);
  public readonly startGuard = input<SessionStartGuard | null>(null);
  public readonly stopHandler = input<SessionStopHandler | null>(null);
}

@Component({
  selector: 'ptah-analysis-transcript',
  standalone: true,
  template: '<div data-testid="analysis-transcript-stub"></div>',
})
class AnalysisTranscriptStubComponent {}

@Component({
  selector: 'ptah-builder-session-section',
  standalone: true,
  template: '<div data-testid="session-section-stub"></div>',
})
class BuilderSessionSectionStubComponent {
  public readonly initialized = input(false);
  public readonly statsSnapshot = input<SessionStatsEntry | null>(null);
  public readonly liveModelStats = input<LiveModelStats | null>(null);
}

describe('DetailsLogComponent', () => {
  let fixture: ComponentFixture<DetailsLogComponent>;

  function render(
    mode: 'analysis' | 'tab',
    extras: { tabId?: string | null } = {},
  ): HTMLElement {
    TestBed.configureTestingModule({ imports: [DetailsLogComponent] });
    TestBed.overrideComponent(DetailsLogComponent, {
      remove: {
        imports: [
          SessionEmbedComponent,
          AnalysisTranscriptComponent,
          BuilderSessionSectionComponent,
        ],
      },
      add: {
        imports: [
          SessionEmbedStubComponent,
          AnalysisTranscriptStubComponent,
          BuilderSessionSectionStubComponent,
        ],
      },
    });
    fixture = TestBed.createComponent(DetailsLogComponent);
    fixture.componentRef.setInput('mode', mode);
    if (extras.tabId !== undefined) {
      fixture.componentRef.setInput('tabId', extras.tabId);
    }
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  function openLog(el: HTMLElement): void {
    const details = el.querySelector('details') as HTMLDetailsElement;
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    fixture.detectChanges();
  }

  function closeLog(el: HTMLElement): void {
    const details = el.querySelector('details') as HTMLDetailsElement;
    details.open = false;
    details.dispatchEvent(new Event('toggle'));
    fixture.detectChanges();
  }

  afterEach(() => {
    TestBed.resetTestingModule();
    embedInstanceSeq = 0;
  });

  it('keeps the tab embed unmounted while collapsed and releases it on close', () => {
    const el = render('tab', { tabId: 'tab-1' });
    expect(el.querySelector('[data-testid="session-embed-stub"]')).toBeNull();
    expect(el.querySelector('[data-testid="details-log-body"]')).toBeNull();

    openLog(el);
    expect(el.querySelector('[data-testid="session-embed-stub"]')).not.toBeNull();
    const stub = fixture.debugElement.query(
      (node) => node.componentInstance instanceof SessionEmbedStubComponent,
    )?.componentInstance as SessionEmbedStubComponent;
    expect(stub.tabId()).toBe('tab-1');
    expect(stub.chrome()).toBe('bare');
    expect(stub.readOnly()).toBe(true);

    closeLog(el);
    expect(el.querySelector('[data-testid="session-embed-stub"]')).toBeNull();
    expect(el.querySelector('[data-testid="details-log-body"]')).toBeNull();
  });

  it('mounts the analysis transcript only while open', () => {
    const el = render('analysis');
    expect(
      el.querySelector('[data-testid="analysis-transcript-stub"]'),
    ).toBeNull();
    openLog(el);
    expect(
      el.querySelector('[data-testid="analysis-transcript-stub"]'),
    ).not.toBeNull();
    expect(el.querySelector('[data-testid="session-embed-stub"]')).toBeNull();
    closeLog(el);
    expect(
      el.querySelector('[data-testid="analysis-transcript-stub"]'),
    ).toBeNull();
  });

  it('shows an unavailable message in tab mode without a tabId', () => {
    const el = render('tab', { tabId: null });
    openLog(el);
    expect(
      (el.querySelector('[data-testid="details-log-unavailable"]') as HTMLElement)
        .textContent,
    ).toContain('Session is not available.');
    expect(el.querySelector('[data-testid="session-embed-stub"]')).toBeNull();
    expect(el.querySelector('[data-testid="session-section-stub"]')).toBeNull();
  });

  it('remounts the tab embed when tabId changes while open', () => {
    const el = render('tab', { tabId: 'tab-1' });
    openLog(el);
    const first = fixture.debugElement.query(
      (node) => node.componentInstance instanceof SessionEmbedStubComponent,
    )?.componentInstance as SessionEmbedStubComponent;
    const firstId = first.instanceId;
    expect(first.tabId()).toBe('tab-1');

    fixture.componentRef.setInput('tabId', 'tab-2');
    fixture.detectChanges();
    const second = fixture.debugElement.query(
      (node) => node.componentInstance instanceof SessionEmbedStubComponent,
    )?.componentInstance as SessionEmbedStubComponent;
    expect(second.tabId()).toBe('tab-2');
    expect(second.instanceId).not.toBe(firstId);
  });

  it('replaces the embed with unavailable copy when tabId becomes null while open', () => {
    const el = render('tab', { tabId: 'tab-1' });
    openLog(el);
    expect(el.querySelector('[data-testid="session-embed-stub"]')).not.toBeNull();

    fixture.componentRef.setInput('tabId', null);
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="session-embed-stub"]')).toBeNull();
    expect(
      (el.querySelector('[data-testid="details-log-unavailable"]') as HTMLElement)
        .textContent,
    ).toContain('Session is not available.');
  });

  it('remounts when mode changes while open', () => {
    const el = render('tab', { tabId: 'tab-1' });
    openLog(el);
    expect(el.querySelector('[data-testid="session-embed-stub"]')).not.toBeNull();

    fixture.componentRef.setInput('mode', 'analysis');
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="session-embed-stub"]')).toBeNull();
    expect(
      el.querySelector('[data-testid="analysis-transcript-stub"]'),
    ).not.toBeNull();
    expect(el.querySelector('[data-testid="details-log-unavailable"]')).toBeNull();
  });

  it('renders stream counts in the header when attached', () => {
    const el = render('analysis');
    fixture.componentRef.setInput('streamCounts', {
      total: 142,
      text: 31,
      thinking: 12,
      tool: 88,
      errors: 0,
    });
    fixture.detectChanges();
    expect(
      (el.querySelector('[data-testid="details-log-counts"]') as HTMLElement)
        .textContent,
    ).toMatch(/142 events:\s*31 text,\s*12 thinking,\s*88 tool,\s*0 errors/);
  });
});
