import {
  ComponentFixture,
  TestBed,
  fakeAsync,
  tick,
} from '@angular/core/testing';
import { SessionSearchOverlayComponent } from './session-search-overlay.component';
import { SessionSummary, SessionId } from '@ptah-extension/shared';
import { signal } from '@angular/core';

describe('SessionSearchOverlayComponent', () => {
  let component: SessionSearchOverlayComponent;
  let fixture: ComponentFixture<SessionSearchOverlayComponent>;

  const createMockSession = (
    name: string,
    lastActiveAt: number,
    messageCount = 5
  ): SessionSummary => ({
    id: SessionId.create(),
    name,
    lastActiveAt,
    messageCount,
    createdAt: lastActiveAt,
  });

  const now = Date.now();
  const oneDayMs = 1000 * 60 * 60 * 24;

  const mockSessions: SessionSummary[] = [
    createMockSession('Today Session', now - 1000 * 60), // 1 minute ago
    createMockSession('Yesterday Session', now - oneDayMs - 1000), // Yesterday
    createMockSession('Last Week Session', now - oneDayMs * 5), // 5 days ago
    createMockSession('Last Month Session', now - oneDayMs * 15), // 15 days ago
    createMockSession('Older Session', now - oneDayMs * 60), // 60 days ago
    createMockSession('Another Today', now - 1000 * 60 * 30), // 30 minutes ago
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SessionSearchOverlayComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(SessionSearchOverlayComponent);
    component = fixture.componentInstance;

    // Set default inputs
    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput('currentSessionId', null);
    fixture.componentRef.setInput('sessions', mockSessions);

    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render overlay when isOpen is true', () => {
    const overlay = fixture.nativeElement.querySelector('.overlay-backdrop');
    expect(overlay).toBeTruthy();
  });

  it('should not render overlay when isOpen is false', () => {
    fixture.componentRef.setInput('isOpen', false);
    fixture.detectChanges();

    const overlay = fixture.nativeElement.querySelector('.overlay-backdrop');
    expect(overlay).toBeFalsy();
  });

  it('should filter sessions based on search query', fakeAsync(() => {
    // Use component method directly instead of UI event
    component.onSearchInput('Today');
    fixture.detectChanges();

    // Wait for debounce (300ms)
    tick(300);
    fixture.detectChanges();

    const filtered = component.filteredSessions();
    expect(filtered.length).toBe(2); // 'Today Session' and 'Another Today'
    expect(filtered[0].name).toContain('Today');
  }));

  it('should debounce search input by 300ms', fakeAsync(() => {
    component.onSearchInput('test');
    fixture.detectChanges();

    expect(component.debouncedQuery()).toBe(''); // Not yet debounced

    tick(300);
    fixture.detectChanges();

    expect(component.debouncedQuery()).toBe('test'); // After debounce
  }));

  it('should group sessions by date correctly', () => {
    const groups = component.groupedSessions();

    expect(groups.today.length).toBe(2); // 2 sessions today
    expect(groups.yesterday.length).toBe(1); // 1 session yesterday
    expect(groups.lastWeek.length).toBe(1); // 1 session in last 7 days
    expect(groups.lastMonth.length).toBe(1); // 1 session in last 30 days
    expect(groups.older.length).toBe(1); // 1 older session
  });

  it('should emit sessionSelected when session is clicked', () => {
    const sessionId = mockSessions[0].id;
    let emittedSessionId: SessionId | undefined;

    component.sessionSelected.subscribe((id) => {
      emittedSessionId = id;
    });

    component.selectSession(sessionId as SessionId);

    expect(emittedSessionId).toBe(sessionId);
  });

  it('should emit closed when backdrop is clicked', () => {
    let closedEmitted = false;

    component.closed.subscribe(() => {
      closedEmitted = true;
    });

    const backdrop = fixture.nativeElement.querySelector(
      '.overlay-backdrop'
    ) as HTMLElement;
    backdrop.click();

    expect(closedEmitted).toBe(true);
  });

  it('should emit closed on Escape key', () => {
    let closedEmitted = false;

    component.closed.subscribe(() => {
      closedEmitted = true;
    });

    const event = new KeyboardEvent('keydown', { key: 'Escape' });
    component.onKeyDown(event);

    expect(closedEmitted).toBe(true);
  });

  it('should show no results empty state when search has no matches', fakeAsync(() => {
    // Use component method directly
    component.onSearchInput('NonexistentSession');
    fixture.detectChanges();

    tick(300);
    fixture.detectChanges();

    expect(component.showNoResults()).toBe(true);

    const emptyState = fixture.nativeElement.querySelector('.empty-state');
    const emptyTitle = fixture.nativeElement.querySelector('.empty-title');

    expect(emptyState).toBeTruthy();
    expect(emptyTitle?.textContent).toContain('No sessions found');
  }));

  it('should show no sessions empty state when there are no sessions', () => {
    fixture.componentRef.setInput('sessions', []);
    fixture.detectChanges();

    const emptyState = fixture.nativeElement.querySelector('.empty-state');
    const emptyTitle = fixture.nativeElement.querySelector('.empty-title');

    expect(component.showNoSessions()).toBe(true);
    expect(emptyState).toBeTruthy();
    expect(emptyTitle?.textContent).toContain('No sessions yet');
  });

  it('should focus search input when overlay opens', fakeAsync(() => {
    fixture.componentRef.setInput('isOpen', false);
    fixture.detectChanges();
    tick();

    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();

    // Wait for focus effect (100ms timeout in component)
    tick(100);
    fixture.detectChanges();

    const searchInput = document.getElementById(
      'session-search-input'
    ) as HTMLInputElement;
    expect(document.activeElement).toBe(searchInput);
  }));

  it('should highlight active session', () => {
    const activeSessionId = mockSessions[0].id;
    fixture.componentRef.setInput('currentSessionId', activeSessionId);
    fixture.detectChanges();

    expect(component.isActiveSession(activeSessionId as SessionId)).toBe(true);
    expect(component.isActiveSession(mockSessions[1].id as SessionId)).toBe(
      false
    );
  });

  it('should clear search query when closing', () => {
    component.onSearchInput('test query');
    fixture.detectChanges();

    expect(component.searchQuery()).toBe('test query');

    component.close();

    expect(component.searchQuery()).toBe('');
  });

  it('should close overlay after selecting a session', () => {
    let closedEmitted = false;

    component.closed.subscribe(() => {
      closedEmitted = true;
    });

    component.selectSession(mockSessions[0].id as SessionId);

    expect(closedEmitted).toBe(true);
  });

  it('should calculate relative time correctly', () => {
    const oneMinuteAgo = now - 1000 * 60;
    const oneHourAgo = now - 1000 * 60 * 60;
    const oneDayAgo = now - oneDayMs;
    const oneWeekAgo = now - oneDayMs * 7;

    expect(component.getRelativeTime(now)).toBe('Just now');
    expect(component.getRelativeTime(oneMinuteAgo)).toBe('1m ago');
    expect(component.getRelativeTime(oneHourAgo)).toBe('1h ago');
    // days < 1 returns "Yesterday", days >= 1 returns "X days ago"
    expect(component.getRelativeTime(oneDayAgo)).toBe('1 days ago');
    expect(component.getRelativeTime(oneWeekAgo)).toContain('days ago');
  });

  it('should have visible groups for non-empty date groups', () => {
    const visibleGroups = component.visibleGroups();

    expect(visibleGroups.length).toBe(5); // All 5 groups have sessions
    expect(visibleGroups[0].label).toBe('Today');
    expect(visibleGroups[1].label).toBe('Yesterday');
    expect(visibleGroups[2].label).toBe('Last 7 Days');
    expect(visibleGroups[3].label).toBe('Last 30 Days');
    expect(visibleGroups[4].label).toBe('Older');
  });

  it('should not show groups with no sessions after filtering', fakeAsync(() => {
    component.onSearchInput('Today');
    fixture.detectChanges();

    tick(300);
    fixture.detectChanges();

    const filtered = component.filteredSessions();
    const visibleGroups = component.visibleGroups();

    // After filtering for "Today", we should only have sessions with "Today" in the name
    expect(filtered.length).toBe(2); // 'Today Session' and 'Another Today'
    expect(visibleGroups.length).toBe(1); // Only 'Today' group should be visible
    expect(visibleGroups[0].label).toBe('Today');
  }));
});
