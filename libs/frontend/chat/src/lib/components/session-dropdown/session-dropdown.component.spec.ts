import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SessionDropdownComponent } from './session-dropdown.component';
import { SessionSummary } from '@ptah-extension/shared';

describe('SessionDropdownComponent', () => {
  let component: SessionDropdownComponent;
  let fixture: ComponentFixture<SessionDropdownComponent>;

  const mockSessions: SessionSummary[] = [
    {
      id: 'session-1' as any,
      name: 'Test Session 1',
      messageCount: 12,
      lastActiveAt: Date.now() - 1000 * 60 * 5, // 5 minutes ago
      createdAt: Date.now() - 1000 * 60 * 60 * 24, // 1 day ago
    },
    {
      id: 'session-2' as any,
      name: 'Test Session 2',
      messageCount: 8,
      lastActiveAt: Date.now() - 1000 * 60 * 60, // 1 hour ago
      createdAt: Date.now() - 1000 * 60 * 60 * 24 * 2, // 2 days ago
    },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SessionDropdownComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(SessionDropdownComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('recentSessions', mockSessions);
    fixture.componentRef.setInput('currentSessionId', 'session-1');
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should toggle dropdown on button click', () => {
    const trigger = fixture.nativeElement.querySelector('.dropdown-trigger');

    expect(component.isOpen()).toBe(false);

    trigger.click();
    fixture.detectChanges();

    expect(component.isOpen()).toBe(true);

    trigger.click();
    fixture.detectChanges();

    expect(component.isOpen()).toBe(false);
  });

  it('should render recent sessions from input', () => {
    component.toggleDropdown();
    fixture.detectChanges();

    const sessionItems =
      fixture.nativeElement.querySelectorAll('.session-item');
    expect(sessionItems.length).toBe(2);

    expect(sessionItems[0].textContent).toContain('Test Session 1');
    expect(sessionItems[1].textContent).toContain('Test Session 2');
  });

  it('should emit sessionSelected when session clicked', (done) => {
    component.sessionSelected.subscribe((sessionId) => {
      expect(sessionId).toBe('session-2' as any);
      done();
    });

    component.toggleDropdown();
    fixture.detectChanges();

    const sessionItems =
      fixture.nativeElement.querySelectorAll('.session-item');
    sessionItems[1].click();
  });

  it('should emit newSessionClicked when New Session clicked', (done) => {
    component.newSessionClicked.subscribe(() => {
      done();
    });

    component.toggleDropdown();
    fixture.detectChanges();

    const actionButtons =
      fixture.nativeElement.querySelectorAll('.action-button');
    actionButtons[0].click(); // First action button is New Session
  });

  it('should emit searchAllClicked when Search All clicked', (done) => {
    component.searchAllClicked.subscribe(() => {
      done();
    });

    component.toggleDropdown();
    fixture.detectChanges();

    const actionButtons =
      fixture.nativeElement.querySelectorAll('.action-button');
    actionButtons[1].click(); // Second action button is Search All
  });

  it('should close dropdown after emitting events', () => {
    component.toggleDropdown();
    fixture.detectChanges();
    expect(component.isOpen()).toBe(true);

    const sessionItems =
      fixture.nativeElement.querySelectorAll('.session-item');
    sessionItems[0].click();
    fixture.detectChanges();

    expect(component.isOpen()).toBe(false);
  });

  it('should highlight active session', () => {
    component.toggleDropdown();
    fixture.detectChanges();

    const sessionItems =
      fixture.nativeElement.querySelectorAll('.session-item');
    expect(sessionItems[0].classList.contains('active')).toBe(true);
    expect(sessionItems[1].classList.contains('active')).toBe(false);
  });

  it('should format relative time correctly', () => {
    const now = Date.now();

    expect(component.getRelativeTime(now - 1000 * 30)).toBe('Just now'); // 30 seconds
    expect(component.getRelativeTime(now - 1000 * 60 * 5)).toBe('5m ago'); // 5 minutes
    expect(component.getRelativeTime(now - 1000 * 60 * 60 * 2)).toBe('2h ago'); // 2 hours
    expect(component.getRelativeTime(now - 1000 * 60 * 60 * 24 * 3)).toBe(
      '3 days ago'
    ); // 3 days
  });

  it('should show New Session and Search All buttons', () => {
    component.toggleDropdown();
    fixture.detectChanges();

    const actionButtons =
      fixture.nativeElement.querySelectorAll('.action-button');
    expect(actionButtons.length).toBe(2);
    expect(actionButtons[0].textContent).toContain('New Session');
    expect(actionButtons[1].textContent).toContain('Search All Sessions');
  });

  it('should have correct ARIA attributes', () => {
    const trigger = fixture.nativeElement.querySelector('.dropdown-trigger');

    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.getAttribute('aria-controls')).toBe('session-dropdown-menu');
    expect(trigger.getAttribute('aria-label')).toBe('Recent sessions');

    component.toggleDropdown();
    fixture.detectChanges();

    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    const menu = fixture.nativeElement.querySelector('.dropdown-menu');
    expect(menu.getAttribute('role')).toBe('menu');
    expect(menu.getAttribute('id')).toBe('session-dropdown-menu');
  });

  it('should display "Untitled Session" for sessions without name', () => {
    const sessionWithoutName: SessionSummary = {
      id: 'session-3' as any,
      name: '',
      messageCount: 5,
      lastActiveAt: Date.now(),
      createdAt: Date.now(),
    };

    fixture.componentRef.setInput('recentSessions', [sessionWithoutName]);
    fixture.detectChanges();

    component.toggleDropdown();
    fixture.detectChanges();

    const sessionItem = fixture.nativeElement.querySelector('.session-item');
    expect(sessionItem.textContent).toContain('Untitled Session');
  });
});
