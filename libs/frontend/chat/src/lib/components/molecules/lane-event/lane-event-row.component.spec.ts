import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SURFACE_ACTIVE } from '@ptah-extension/core';
import { SESSION_CARD_ACTIONS } from '../../../tokens/session-context.token';
import { LaneEventRowComponent } from './lane-event-row.component';
import { provideMarkdown } from 'ngx-markdown';
import type { LaneEventRow } from './lane-event-row.types';

const row: LaneEventRow = {
  rowKey: 'm1', agentId: 'agent-1', agent: 'Glm', cli: 'ptah-cli', peerLabel: 'peer session', liveLane: false, earlier: [],
  events: [
    { kind: 'report', body: 'First line\nSecond line', timestamp: 1_700_000_000_000, messageId: 'm1', files: ['/tmp/file.txt'], imageCount: 1 },
    { kind: 'report', body: 'Applied fix', timestamp: 1_700_000_001_000, messageId: 'm2' },
    { kind: 'completed', verdict: 'delivered', body: 'Done', timestamp: 1_700_000_002_000, messageId: 'm3' },
  ],
};

describe('LaneEventRowComponent', () => {
  const openLane = jest.fn();
  beforeEach(() => {
    openLane.mockClear();
    TestBed.configureTestingModule({ imports: [LaneEventRowComponent], providers: [
      provideMarkdown(),
      { provide: SURFACE_ACTIVE, useValue: signal(false) },
      { provide: SESSION_CARD_ACTIONS, useValue: { openLane } },
    ] });
  });

  it('shows report and completion chips, peer details, attachments and expands with ARIA', () => {
    const fixture = TestBed.createComponent(LaneEventRowComponent);
    fixture.componentRef.setInput('row', row);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect([...element.querySelectorAll('[data-testid="lane-event-chip"]')].map(chip => chip.textContent?.trim())).toEqual(['Report x2', 'Completed']);
    expect(element.textContent).toContain('self-reported and unverified');
    expect(element.textContent).toContain('peer session');
    expect(element.textContent).toContain('file.txt');
    expect(element.textContent).toContain('1 image');
    expect(element.querySelector('[data-testid="lane-event-show-more"]')?.textContent).toContain('Show more');
    const toggle = element.querySelector<HTMLButtonElement>('[data-testid="lane-event-toggle"]')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click(); fixture.detectChanges();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(element.querySelector('[data-testid="lane-event-show-more"]')?.textContent).toContain('Show less');
    expect(element.querySelector('[data-testid="lane-event-body"]')?.textContent).toContain('verdict: delivered');
  });

  it('opens cli lane and sends the final envelope id for Branch and active Rewind', () => {
    const fixture = TestBed.createComponent(LaneEventRowComponent);
    fixture.componentRef.setInput('row', row);
    fixture.componentRef.setInput('isSessionActive', true);
    const branch = jest.fn(); const rewind = jest.fn();
    fixture.componentInstance.branchRequested.subscribe(branch);
    fixture.componentInstance.rewindRequested.subscribe(rewind);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    element.querySelector<HTMLButtonElement>('[data-testid="lane-event-open"]')!.click();
    element.querySelector<HTMLButtonElement>('[data-testid="lane-event-branch"]')!.click();
    element.querySelector<HTMLButtonElement>('[data-testid="lane-event-rewind"]')!.click();
    expect(openLane).toHaveBeenCalledWith('cli:agent-1');
    expect(branch).toHaveBeenCalledWith('m3');
    expect(rewind).toHaveBeenCalledWith('m3');
    fixture.componentRef.setInput('isSessionActive', false); fixture.detectChanges();
    expect(element.querySelector<HTMLButtonElement>('[data-testid="lane-event-rewind"]')!.disabled).toBe(true);
  });

  it('hides Open lane without actions and caps the timeline', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [LaneEventRowComponent], providers: [provideMarkdown(), { provide: SURFACE_ACTIVE, useValue: signal(false) }] });
    const fixture = TestBed.createComponent(LaneEventRowComponent);
    fixture.componentRef.setInput('row', { ...row, events: [...row.events, ...Array.from({ length: 5 }, (_, index) => ({ kind: 'report' as const, body: 'more', timestamp: 1_700_000_003_000 + index, messageId: `extra-${index}` }))] });
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('[data-testid="lane-event-open"]')).toBeNull();
    expect(element.querySelector('[data-testid="lane-event-timeline"]')?.textContent).toContain('+4 earlier');
  });
});
