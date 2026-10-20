import { TestBed } from '@angular/core/testing';
import {
  ATTENTION_ACTION_DISPATCHER, NotificationService, type AttentionItem,
} from '@ptah-extension/core';
import { NotificationSnackbarComponent } from './notification-snackbar.component';

describe('NotificationSnackbarComponent', () => {
  const dispatch = jest.fn<Promise<boolean>, [string, number, string]>();
  let notifications: NotificationService;

  const item = (key: string, kind: AttentionItem['kind'] = 'failure'): AttentionItem => ({
    key, generation: 1, kind, source: 'test', workspacePath: '/workspace',
    workspaceName: 'Workspace', severity: kind === 'failure' ? 'error' : 'info',
    title: `${kind} ${key}`, context: 'Workspace',
    actions: [{ id: 'open', label: 'Open session' }], actionable: true,
    soundEligible: false,
  });

  beforeEach(() => {
    jest.useFakeTimers();
    dispatch.mockReset().mockResolvedValue(true);
    TestBed.configureTestingModule({
      imports: [NotificationSnackbarComponent],
      providers: [{ provide: ATTENTION_ACTION_DISPATCHER, useValue: { dispatch } }],
    });
    notifications = TestBed.inject(NotificationService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    jest.useRealTimers();
  });

  it('renders the shared identity and safe detail as text', () => {
    notifications.upsert({ ...item('request', 'permission'), sessionTitle: 'Fix notifications', provider: 'Claude', detail: 'Tool: Bash <private>' });
    const fixture = TestBed.createComponent(NotificationSnackbarComponent);
    fixture.detectChanges();
    const card = (fixture.nativeElement as HTMLElement).querySelector('.snackbar-card');
    expect(card?.textContent).toContain('Permission required');
    expect(card?.textContent).toContain('Fix notifications');
    expect(card?.textContent).toContain('Claude');
    expect(card?.textContent).toContain('Tool: Bash <private>');
    expect(card?.querySelector('.bg-state-need')).not.toBeNull();
    expect(card?.querySelector('private')).toBeNull();
  });

  it('shows Session unavailable for a request without a session title', () => {
    notifications.upsert({ ...item('request', 'permission'), title: 'Permission required' });
    const fixture = TestBed.createComponent(NotificationSnackbarComponent);
    fixture.detectChanges();
    const card = (fixture.nativeElement as HTMLElement).querySelector('.snackbar-card');
    expect(card?.querySelector('p[title="Session unavailable"]')?.textContent).toBe('Session unavailable');
    expect(card?.textContent).toContain('Permission required');
  });

  it('dispatches an action and dismisses only the presentation', async () => {
    notifications.upsert(item('request', 'permission'));
    const fixture = TestBed.createComponent(NotificationSnackbarComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('[role="status"], [role="alert"]')).toBeNull();
    const action = [...host.querySelectorAll('button')].find(button => button.textContent?.includes('Open session'));
    action?.click();
    await Promise.resolve();
    expect(dispatch).toHaveBeenCalledWith('request', 1, 'open');
    host.querySelector<HTMLButtonElement>('[aria-label^="Dismiss Permission required presentation"]')?.click();
    fixture.detectChanges();
    expect(host.querySelector('.snackbar-card')).toBeNull();
    expect(notifications.badgeCount()).toBe(1);
  });

  it('shows stale and unavailable outcomes and disables unavailable action', async () => {
    const dispatchOutcome = jest.fn().mockResolvedValueOnce({ kind: 'stale' }).mockResolvedValueOnce({ kind: 'unavailable', reason: 'No owner' });
    TestBed.inject(ATTENTION_ACTION_DISPATCHER).dispatchOutcome = dispatchOutcome;
    notifications.upsert(item('request', 'permission'));
    const fixture = TestBed.createComponent(NotificationSnackbarComponent);
    fixture.detectChanges();
    const button = () => [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('.snackbar-card button')]
      .find(candidate => candidate.textContent?.includes('Open session'));
    button()?.click();
    await Promise.resolve();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Already answered');
    button()?.click();
    await Promise.resolve();
    fixture.detectChanges();
    expect(button()?.disabled).toBe(true);
    expect(button()?.title).toBe('No owner');
  });

  it('shows a fixed status when dispatch rejects', async () => {
    dispatch.mockRejectedValueOnce(new Error('private dispatch detail'));
    notifications.upsert(item('request', 'permission'));
    const fixture = TestBed.createComponent(NotificationSnackbarComponent);
    fixture.detectChanges();
    const action = [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('Open session'));
    action?.click();
    await Promise.resolve();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Action unavailable');
    expect(fixture.nativeElement.textContent).not.toContain('private dispatch detail');
  });

  it('does not bubble the overflow click to the bell document closer', () => {
    for (let index = 0; index < 4; index += 1) notifications.upsert(item(`failure-${index}`));
    const fixture = TestBed.createComponent(NotificationSnackbarComponent);
    fixture.detectChanges();
    const outside = jest.fn();
    document.addEventListener('click', outside);
    try {
      (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.snackbar-more')?.click();
      expect(outside).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('click', outside);
    }
  });

  it('shows three desktop cards and keeps overflow in the bell', () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 });
    try {
      for (let index = 0; index < 4; index += 1) notifications.upsert(item(`failure-${index}`));
      const fixture = TestBed.createComponent(NotificationSnackbarComponent);
      fixture.detectChanges();
      const host = fixture.nativeElement as HTMLElement;
      expect(host.querySelectorAll('.snackbar-card')).toHaveLength(3);
      expect(host.textContent).toContain('+1 more');
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
    }
  });

  it('pauses the remaining failure time on hover and resumes without restarting it', () => {
    notifications.upsert(item('failure'));
    const fixture = TestBed.createComponent(NotificationSnackbarComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    jest.advanceTimersByTime(3000);
    host.querySelector('.snackbar-card')?.dispatchEvent(new Event('mouseenter'));
    jest.advanceTimersByTime(20000);
    expect(notifications.snackbars()).toHaveLength(1);
    host.querySelector('.snackbar-card')?.dispatchEvent(new Event('mouseleave'));
    jest.advanceTimersByTime(4999);
    expect(notifications.snackbars()).toHaveLength(1);
    jest.advanceTimersByTime(1);
    expect(notifications.snackbars()).toHaveLength(0);
  });

  it('resumes a hovered snackbar before dismissing it', () => {
    notifications.upsert(item('hovered'));
    const resume = jest.spyOn(notifications, 'resumeSnackbar');
    const fixture = TestBed.createComponent(NotificationSnackbarComponent);
    fixture.detectChanges();
    const card = (fixture.nativeElement as HTMLElement).querySelector('.snackbar-card');
    card?.dispatchEvent(new Event('mouseenter'));
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[aria-label="Dismiss failure hovered"]')?.click();
    expect(resume).toHaveBeenCalledWith('hovered');
  });

  it('does not expire while focus remains inside a snackbar', () => {
    notifications.upsert(item('focused'));
    const fixture = TestBed.createComponent(NotificationSnackbarComponent);
    fixture.detectChanges();
    const card = (fixture.nativeElement as HTMLElement).querySelector('.snackbar-card');
    jest.advanceTimersByTime(2000);
    card?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    jest.advanceTimersByTime(12000);
    expect(notifications.snackbars()).toHaveLength(1);
    card?.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    jest.advanceTimersByTime(5999);
    expect(notifications.snackbars()).toHaveLength(1);
    jest.advanceTimersByTime(1);
    expect(notifications.snackbars()).toHaveLength(0);
  });

  it('shows one card with overflow at a narrow viewport', () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 900 });
    try {
      notifications.upsert(item('first'));
      notifications.upsert(item('second'));
      const fixture = TestBed.createComponent(NotificationSnackbarComponent);
      fixture.detectChanges();
      const host = fixture.nativeElement as HTMLElement;
      expect(host.querySelectorAll('.snackbar-card')).toHaveLength(1);
      expect(host.textContent).toContain('+1 more');
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
    }
  });

  it('keeps the desktop count when vertical space is short and hides cards while the bell is open', () => {
    const originalWidth = window.innerWidth;
    const originalHeight = window.innerHeight;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });
    try {
      notifications.upsert(item('first'));
      notifications.upsert(item('second'));
      const fixture = TestBed.createComponent(NotificationSnackbarComponent);
      fixture.detectChanges();
      expect((fixture.nativeElement as HTMLElement).querySelectorAll('.snackbar-card')).toHaveLength(2);
      fixture.componentRef.setInput('panelOpen', true);
      fixture.detectChanges();
      expect((fixture.nativeElement as HTMLElement).querySelectorAll('.snackbar-card')).toHaveLength(0);
      jest.advanceTimersByTime(20000);
      expect(notifications.snackbars()).toHaveLength(2);
      fixture.componentRef.setInput('panelOpen', false);
      fixture.detectChanges();
      jest.advanceTimersByTime(8000);
      expect(notifications.snackbars()).toHaveLength(0);
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalHeight });
    }
  });
});
