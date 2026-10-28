import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SURFACE_ACTIVE } from '@ptah-extension/core';
import { SESSION_CARD_ACTIONS } from '../../../tokens/session-context.token';
import { LaneEventRowComponent } from './lane-event-row.component';
import { provideMarkdown } from 'ngx-markdown';
import type { LaneEventRow } from './lane-event-row.types';

const envelope = 'Lane Glm finished: completed (exit code 0) after 26s.\nTask: Read alpha.md.\nDeliverables: none were declared at spawn, so nothing was checked. Read the lane output before you trust this result, and declare "deliverables" next time.\nReports sent by this lane before it ended: 2.\nCLI Session ID: sess-1 — pass it as resume_session_id to continue this lane instead of respawning it.\nNext: read the lane output.';
const row: LaneEventRow = {
  rowKey: 'm1', agentId: 'agent-1', agent: 'Glm', cli: 'ptah-cli', peerLabel: 'peer session', liveLane: false, earlier: [],
  events: [
    { kind: 'report', body: 'First line\nSecond line', timestamp: 1_700_000_000_000, messageId: 'm1', files: ['/tmp/file.txt'], imageCount: 1 },
    { kind: 'report', body: 'Applied fix\nFull explanation', timestamp: 1_700_000_001_000, messageId: 'm2' },
    { kind: 'completed', verdict: 'unverified', body: envelope, timestamp: 1_700_000_002_000, messageId: 'm3' },
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

  it('renders exactly two collapsed lines with one chip and no raw task or horizontal scroll', () => {
    const fixture = TestBed.createComponent(LaneEventRowComponent);
    fixture.componentRef.setInput('row', row);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelectorAll('[data-testid="lane-event-chip"]')).toHaveLength(1);
    expect(element.querySelector('[data-testid="lane-event-chip"]')?.textContent).toContain('Completed · unverified');
    const second = element.querySelector('[data-testid="lane-event-second-line"]')!;
    expect(second.textContent).toContain('Applied fix');
    expect(second.textContent).toContain('26s · 2 reports');
    expect(second.textContent).toContain('self-reported');
    expect(second.className).toContain('overflow-hidden');
    expect(element.querySelector('[data-testid="lane-event-unverified-caption"]')?.getAttribute('title')).toContain('Sent from another session');
    expect(element.textContent).not.toContain('Read alpha.md');
    expect(element.textContent).not.toContain('peer session');
    expect(element.querySelector('article')?.getAttribute('title')).toContain('peer session');
    expect(element.querySelector('[data-testid="lane-event-body"]')?.hasAttribute('hidden')).toBe(true);
    expect(element.textContent).not.toContain('file.txt');
  });

  it('centers a capped lane card with comfortable two-line spacing', () => {
    const fixture = TestBed.createComponent(LaneEventRowComponent);
    fixture.componentRef.setInput('row', row);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const card = element.querySelector('article')!;
    expect(card.classList.contains('mx-auto')).toBe(true);
    expect(card.classList.contains('w-full')).toBe(true);
    expect(card.classList.contains('max-w-[min(640px,var(--chat-content-max-width,758px))]')).toBe(true);
    expect(card.classList.contains('px-4')).toBe(true);
    expect(card.classList.contains('py-3')).toBe(true);
    expect(card.classList.contains('text-sm')).toBe(true);
    const second = element.querySelector('[data-testid="lane-event-second-line"]')!;
    expect(second.className).toContain('text-xs');
    expect(second.className).toContain('leading-5');
    expect(second.className).toContain('overflow-hidden');
  });

  it('expands to markdown reports and parsed completion fields without orchestrator text', () => {
    const fixture = TestBed.createComponent(LaneEventRowComponent);
    fixture.componentRef.setInput('row', row);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const toggle = element.querySelector<HTMLButtonElement>('[data-testid="lane-event-toggle"]')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBeTruthy();
    toggle.click(); fixture.detectChanges();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(element.querySelectorAll('[data-testid="lane-event-body"] markdown')).toHaveLength(2);
    const completion = element.querySelector('[data-testid="lane-event-completion"]')!;
    expect(completion.textContent).toContain('Duration');
    expect(completion.textContent).toContain('none declared');
    expect(completion.textContent).toContain('Read alpha.md.');
    expect(completion.textContent).toContain('sess-1');
    expect(completion.textContent).not.toMatch(/Next:|resume_session_id|trust this result/);
    expect(element.textContent).toContain('file.txt');
    expect(element.textContent).toContain('1 image');
    expect(element.querySelector('[role="status"]')?.textContent).toContain('lane completed');
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

  it('disables expansion when a single report reveals nothing more', () => {
    const fixture = TestBed.createComponent(LaneEventRowComponent);
    fixture.componentRef.setInput('row', { ...row, events: [{ kind: 'report', body: 'One line', timestamp: 1, messageId: 'single' }] });
    fixture.detectChanges();
    const toggle = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-testid="lane-event-toggle"]')!;
    expect(toggle.disabled).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBeNull();
    expect(toggle.querySelector(':scope > lucide-angular')).toBeNull();
  });

  it('hides Open lane when no session actions are provided', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [LaneEventRowComponent], providers: [provideMarkdown(), { provide: SURFACE_ACTIVE, useValue: signal(false) }] });
    const fixture = TestBed.createComponent(LaneEventRowComponent);
    fixture.componentRef.setInput('row', row);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="lane-event-open"]')).toBeNull();
  });
});
